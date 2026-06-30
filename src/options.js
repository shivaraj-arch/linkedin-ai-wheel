const api = globalThis.browser ?? globalThis.chrome;

const PROVIDERS = {
  gemini:       { label: 'Google Gemini — grounded, has live sources (recommended)', model: 'gemini-2.5-flash',                  keyless: false, keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter:   { label: 'OpenRouter — web search, has live sources',                model: 'meta-llama/llama-3.3-70b-instruct', keyless: false, keyUrl: 'https://openrouter.ai/keys' },
  groq:         { label: 'Groq — fast, no live sources',                             model: 'llama-3.3-70b-versatile',           keyless: false, keyUrl: 'https://console.groq.com/keys' },
  openai:       { label: 'OpenAI — no live sources',                                 model: 'gpt-4o-mini',                       keyless: false, keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic:    { label: 'Anthropic Claude — no live sources',                       model: 'claude-haiku-4-5-20251001',         keyless: false, keyUrl: 'https://console.anthropic.com/settings/keys' },
  pollinations: { label: 'Pollinations — no key, no live sources',                   model: 'openai',                            keyless: true },
};

const $ = (id) => document.getElementById(id);

const providerSel = $('provider');
Object.entries(PROVIDERS).forEach(([id, p]) => {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = p.label;
  providerSel.appendChild(opt);
});

let state = { provider: 'pollinations', keys: {}, models: {}, tone: 'thoughtful', enabled: true };

function renderForProvider() {
  const id = providerSel.value;
  const p = PROVIDERS[id];
  $('apiKey').value = state.keys[id] || '';
  $('model').value = state.models[id] || '';
  $('model').placeholder = p.model;
  $('keyField').style.display = p.keyless ? 'none' : '';
  const hint = $('keyHint');
  hint.replaceChildren();
  if (p.keyless) {
    hint.textContent = 'No key needed for this provider. Quality is lower — good for trying it out.';
  } else if (p.keyUrl) {
    hint.append('Get a free key: ');
    const a = document.createElement('a');
    a.href = p.keyUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = p.keyUrl;
    hint.appendChild(a);
  }
}

async function load() {
  const cfg = await api.storage.local.get(['provider', 'keys', 'models', 'tone', 'enabled']);
  state = {
    provider: cfg.provider || 'pollinations',
    keys: cfg.keys || {},
    models: cfg.models || {},
    tone: cfg.tone || 'thoughtful',
    enabled: cfg.enabled !== false,
  };
  providerSel.value = state.provider;
  $('tone').value = state.tone;
  $('enabled').checked = state.enabled;
  renderForProvider();
}

providerSel.addEventListener('change', () => {
  // persist the in-progress key/model for the previous provider into state first
  renderForProvider();
});

$('save').addEventListener('click', async () => {
  const id = providerSel.value;
  state.provider = id;
  state.keys[id] = $('apiKey').value.trim();
  state.models[id] = $('model').value.trim();
  state.tone = $('tone').value;
  state.enabled = $('enabled').checked;
  await api.storage.local.set(state);
  $('status').textContent = 'Saved ✓';
  setTimeout(() => ($('status').textContent = ''), 1500);
});

load();
