// Service worker: receives {text, mode} from the content script, asks the chosen LLM
// to EXPLAIN and/or FACT-CHECK the post, and returns the analysis + source links.
// Real links/fact-checking need live web grounding: Gemini (Google Search grounding)
// and OpenRouter (web plugin) return real sources; other providers explain from
// training knowledge only (no live sources).
const api = globalThis.browser ?? globalThis.chrome;

const PROVIDERS = {
  gemini:       { label: 'Google Gemini (grounded · key)',    kind: 'gemini',    model: 'gemini-2.5-flash',                       keyless: false, grounded: true },
  openrouter:   { label: 'OpenRouter (web search · key)',     kind: 'openai',    base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct', keyless: false, grounded: true },
  groq:         { label: 'Groq (no live web · key)',          kind: 'openai',    base: 'https://api.groq.com/openai/v1',          model: 'llama-3.3-70b-versatile',  keyless: false, grounded: false },
  openai:       { label: 'OpenAI (no live web · key)',        kind: 'openai',    base: 'https://api.openai.com/v1',               model: 'gpt-4o-mini',              keyless: false, grounded: false },
  anthropic:    { label: 'Anthropic Claude (no live web · key)', kind: 'anthropic', model: 'claude-haiku-4-5-20251001',           keyless: false, grounded: false },
  pollinations: { label: 'Pollinations (no key · no live web)', kind: 'pollinations', model: 'openai',                            keyless: true,  grounded: false },
};

function buildPrompt(text, mode) {
  const post = (text || '').slice(0, 4000);
  const base =
    'You are an assistant that helps a reader quickly understand a LinkedIn post. ' +
    'Be concise, neutral, and specific. Write in plain text — no Markdown, no asterisks ' +
    'for emphasis, no "#" headings, no code fences. Use simple labels (e.g. "Explanation:", ' +
    '"Fact-check:") and short paragraphs. Do not write a comment to post.';
  let task;
  if (mode === 'explain') {
    task = 'Explain this post in plain language: what it is about, who it is for, and any jargon or context a newcomer would need. 2–5 short sentences.';
  } else if (mode === 'factcheck') {
    task =
      'Identify the main factual claims in this post and fact-check each against reliable, current web sources. ' +
      'For each claim: the claim, a verdict (Supported / Partly true / Disputed / Unverifiable), and a one-line reason. ' +
      'If nothing is factually checkable, say so briefly.';
  } else {
    task =
      '1) **Explain** the post in 2–4 sentences (what it is about + useful context).\n' +
      '2) **Fact-check** the main claims against reliable, current web sources — for each: verdict ' +
      '(Supported / Partly true / Disputed / Unverifiable) + a one-line reason. Keep it tight.';
  }
  return `${base}\n\n${task}\n\nPOST:\n"""${post}"""`;
}

async function callOpenAICompatible(base, key, model, prompt, opts = {}) {
  const body = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 900 };
  if (opts.web) body.plugins = [{ id: 'web', max_results: 4 }];
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(opts.headers || {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const j = await res.json();
  const msg = j.choices?.[0]?.message || {};
  const sources = (msg.annotations || [])
    .filter((a) => a.type === 'url_citation' && a.url_citation)
    .map((a) => ({ title: a.url_citation.title || a.url_citation.url, uri: a.url_citation.url }));
  return { text: (msg.content || '').trim(), sources };
}

async function callGemini(key, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }], // live Google Search grounding → real sources
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const j = await res.json();
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
  const sources = [];
  const seenUrl = new Set();
  for (const c of cand?.groundingMetadata?.groundingChunks || []) {
    const uri = c.web?.uri;
    if (uri && !seenUrl.has(uri)) {
      seenUrl.add(uri);
      sources.push({ title: c.web?.title || uri, uri });
    }
  }
  return { text, sources };
}

async function callAnthropic(key, model, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const j = await res.json();
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { text, sources: [] };
}

async function callPollinations(prompt) {
  const res = await fetch('https://text.pollinations.ai/' + encodeURIComponent(prompt));
  if (!res.ok) throw new Error(`${res.status}`);
  return { text: (await res.text()).trim(), sources: [] };
}

async function generate(text, mode) {
  const cfg = await api.storage.local.get(['provider', 'keys', 'models']);
  const provider = cfg.provider || 'gemini';
  const meta = PROVIDERS[provider];
  if (!meta) throw new Error('Unknown provider — open Settings');

  const model = cfg.models?.[provider] || meta.model;
  const key = cfg.keys?.[provider] || '';
  if (!meta.keyless && !key) throw new Error('No API key set — open Settings');

  const prompt = buildPrompt(text, mode || 'both');
  let result;
  if (meta.kind === 'openai') {
    const web = provider === 'openrouter';
    const headers = web ? { 'HTTP-Referer': 'https://www.linkedin.com', 'X-Title': 'LinkedIn AI Wheel' } : {};
    result = await callOpenAICompatible(meta.base, key, model, prompt, { web, headers });
  } else if (meta.kind === 'gemini') {
    result = await callGemini(key, model, prompt);
  } else if (meta.kind === 'anthropic') {
    result = await callAnthropic(key, model, prompt);
  } else {
    result = await callPollinations(prompt);
  }
  return { text: result.text, sources: result.sources || [], provider, grounded: !!meta.grounded };
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'generate') {
    generate(msg.text, msg.mode)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg?.type === 'openOptions') api.runtime.openOptionsPage();
});
