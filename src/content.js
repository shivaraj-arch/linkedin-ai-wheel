// Injects a ✨ "draft AI comment" button into each LinkedIn feed post.
// Assist-only: it drafts text you review and post yourself — it never auto-submits.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const DEBUG = true; // logs match counts to the console; set false to silence

  const TEXT_SELECTORS = [
    '.update-components-text',
    '.feed-shared-update-v2__description',
    '.feed-shared-inline-show-more-text',
    '.update-components-update-v2__commentary',
    '.feed-shared-text',
    '[class*="update-components-text"]',
  ];

  const seen = new WeakSet();
  const log = (...a) => DEBUG && console.debug('[aiw]', ...a);

  // Guardrail: scrub anything key/secret-shaped from the post text before it ever
  // leaves the page (defense in depth — feed text shouldn't contain these anyway).
  const redactSecrets = (s) =>
    String(s || '')
      .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[redacted]') // OpenAI-style keys
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]') // Google API keys
      .replace(/AKIA[0-9A-Z]{16}/g, '[redacted]') // AWS access key id
      .replace(/\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/g, '[redacted]') // GitHub tokens
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]') // JWT
      .replace(/\b[A-Fa-f0-9]{40,}\b/g, '[redacted]'); // long hex secrets

  // Skip non-post surfaces (notifications, nav, messaging, sidebars).
  const inChrome = (el) =>
    !!(el.closest && el.closest('.nt-card, [class*="notification"], .msg-overlay, .global-nav, nav, header, aside'));

  // --- find posts: try explicit markers, then derive from the stable Comment button ---
  function findPosts() {
    let posts = Array.from(document.querySelectorAll('[data-finite-scroll-hotkey-item]'));
    if (posts.length) {
      log('strategy: hotkey-item ×', posts.length);
      return posts;
    }
    posts = Array.from(document.querySelectorAll('div.feed-shared-update-v2'));
    if (posts.length) {
      log('strategy: feed-shared-update-v2 ×', posts.length);
      return posts;
    }
    posts = Array.from(document.querySelectorAll('[data-urn*="urn:li:activity"], [data-id*="urn:li:activity"]'));
    if (posts.length) {
      log('strategy: activity-urn ×', posts.length);
      return posts;
    }
    const set = new Set();
    document.querySelectorAll('button[aria-label*="omment" i]').forEach((btn) => {
      const c =
        btn.closest('div.feed-shared-update-v2, [data-urn], [data-id], article, li') || btn.parentElement;
      if (c) set.add(c);
    });
    log('strategy: comment-button ×', set.size);
    return Array.from(set);
  }

  // Climb to the post container that actually holds the text.
  function richestRoot(node) {
    const anchor = node.closest && node.closest('[data-finite-scroll-hotkey-item], div.feed-shared-update-v2');
    if (anchor) return anchor;
    let el = node;
    for (let i = 0; i < 14 && el.parentElement; i++) {
      el = el.parentElement;
      const hasComment = el.querySelector('button[aria-label*="omment" i]');
      const len = (el.textContent || '').trim().length;
      if (hasComment && len > 80) return el;
    }
    return (node.closest && node.closest('[data-urn], [data-id], article, li')) || node;
  }

  // UI/metadata to strip from the fallback so the model doesn't comment on
  // reaction counts, buttons, or our own panel.
  const NOISE_SELECTORS = [
    '.aiw-panel',
    '.aiw-wheel',
    '.social-details-social-counts',
    '.feed-shared-social-action-bar',
    '.social-actions-buttons',
    '.feed-shared-social-actions',
    '.comments-comment-list',
    '.update-components-actor__meta',
    'button',
  ].join(', ');

  const MAX_TEXT = 1500; // max characters of post text we send, so long posts don't create oversized requests

  const getPostText = (post) => {
    const root = richestRoot(post);
    // 1) the post's commentary element (cleanest — excludes counts & our panel)
    for (const sel of TEXT_SELECTORS) {
      const el = root.querySelector(sel);
      if (el && el.innerText.trim().length > 1) {
        log('text via selector', sel);
        return el.innerText.trim().slice(0, MAX_TEXT);
      }
    }
    // 2) fallback: clone, strip noise (counts/buttons/our UI), read textContent
    // (innerText is empty on a detached clone, so use textContent)
    const clone = root.cloneNode(true);
    clone.querySelectorAll(NOISE_SELECTORS).forEach((n) => n.remove());
    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    log('text via clone fallback — len', text.length, '| root', root.className || root.tagName);
    return text.slice(0, MAX_TEXT);
  };

  function makeWheel(post) {
    const wheel = document.createElement('button');
    wheel.type = 'button';
    wheel.className = 'aiw-wheel';
    wheel.title = 'Draft an AI comment (assist — you review & post)';
    wheel.textContent = '✨';
    wheel.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      log('wheel clicked');
      try {
        togglePanel(post);
      } catch (err) {
        console.error('[aiw] togglePanel error', err);
      }
    });
    return wheel;
  }

  function injectWheel(node) {
    if (inChrome(node)) return; // skip notifications / nav / messaging / sidebars
    const root = richestRoot(node);
    if (inChrome(root) || seen.has(root) || root.querySelector('.aiw-wheel')) {
      seen.add(root);
      return;
    }
    seen.add(root);

    const wheel = makeWheel(root);

    // Place top-right of the post, next to the native "···" control menu.
    const menu = root.querySelector(
      '.feed-shared-control-menu, [class*="control-menu"], button[aria-label*="control menu" i], button[aria-label*="More actions" i]'
    );
    if (menu && menu.parentElement) {
      wheel.classList.add('aiw-inline');
      menu.parentElement.insertBefore(wheel, menu);
    } else {
      // fallback: absolutely position it in the post's top-right corner
      wheel.classList.add('aiw-float');
      if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
      root.appendChild(wheel);
    }
  }

  function togglePanel(post) {
    log('togglePanel for', post.tagName, post.className || '(no class)');
    const open = post.querySelector('.aiw-panel');
    if (open) {
      open.remove();
      return;
    }
    const panel = document.createElement('div');
    panel.className = 'aiw-panel';
    panel.innerHTML = `
      <div class="aiw-row">
        <select class="aiw-mode" aria-label="What to do">
          <option value="explain">Explain</option>
          <option value="both">Explain + fact-check</option>
          <option value="factcheck">Fact-check</option>
        </select>
        <button type="button" class="aiw-gen">Regenerate</button>
      </div>
      <div class="aiw-out">Analyzing…</div>
      <div class="aiw-sources"></div>
      <div class="aiw-row">
        <button type="button" class="aiw-copy">Copy</button>
        <span class="aiw-status"></span>
      </div>
      <div class="aiw-foot">AI explanation — may be imperfect; check the sources. <a href="#" class="aiw-settings">Settings</a></div>`;
    post.appendChild(panel);
    log('panel appended');
    panel.scrollIntoView({ block: 'nearest' });

    const out = panel.querySelector('.aiw-out');
    const sourcesEl = panel.querySelector('.aiw-sources');
    const mode = panel.querySelector('.aiw-mode');
    const status = panel.querySelector('.aiw-status');
    let lastText = '';
    let lastSources = [];

    const esc = (s) =>
      String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    // Strip Markdown so the output reads as plain text (leave tables/pipes alone).
    const plainify = (s) =>
      String(s || '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*[-*]\s+/gm, '• ')
        .trim();

    const run = async () => {
      status.textContent = 'analyzing…';
      out.textContent = 'Analyzing…';
      sourcesEl.innerHTML = '';
      const text = redactSecrets(getPostText(post));
      log('extracted text:', text.length, 'chars →', JSON.stringify(text.slice(0, 120)));
      try {
        const r = await api.runtime.sendMessage({ type: 'generate', text, mode: mode.value });
        if (r && r.ok) {
          lastText = plainify(r.text || '(no response)');
          lastSources = r.sources || [];
          out.textContent = lastText;
          status.textContent = 'via ' + r.provider;
          if (lastSources.length) {
            sourcesEl.innerHTML =
              '<div class="aiw-src-title">Sources</div><ul>' +
              lastSources
                .map((s) => `<li><a href="${esc(s.uri)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`)
                .join('') +
              '</ul>';
          } else if (r.grounded === false) {
            sourcesEl.innerHTML =
              '<div class="aiw-src-note">No live sources — this provider has no web access. Switch to Gemini or OpenRouter for fact-check links.</div>';
          }
        } else {
          out.textContent = '';
          status.textContent = (r && r.error) || 'failed';
        }
      } catch (e) {
        out.textContent = '';
        status.textContent = String((e && e.message) || e);
      }
    };

    panel.querySelector('.aiw-gen').addEventListener('click', run);
    mode.addEventListener('change', run);
    panel.querySelector('.aiw-copy').addEventListener('click', async () => {
      const srcText = lastSources.length
        ? '\n\nSources:\n' + lastSources.map((s) => `- ${s.title}: ${s.uri}`).join('\n')
        : '';
      await navigator.clipboard.writeText(lastText + srcText);
      status.textContent = 'copied';
    });
    panel.querySelector('.aiw-settings').addEventListener('click', (e) => {
      e.preventDefault();
      api.runtime.sendMessage({ type: 'openOptions' });
    });
    run();
  }

  function scan() {
    const posts = findPosts();
    log('posts found:', posts.length);
    posts.forEach(injectWheel);
  }

  api.storage.local.get(['enabled']).then(({ enabled }) => {
    if (enabled === false) {
      log('disabled in popup');
      return;
    }
    log('content script active on', location.href);
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    scan();
    // safety re-scan for slow/virtualized feeds
    setInterval(scan, 2500);
  });
})();
