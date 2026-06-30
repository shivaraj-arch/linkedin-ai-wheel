const api = globalThis.browser ?? globalThis.chrome;

async function init() {
  const cfg = await api.storage.local.get(['enabled', 'provider']);
  document.getElementById('enabled').checked = cfg.enabled !== false;
  document.getElementById('providerLine').textContent = 'Provider: ' + (cfg.provider || 'pollinations');
}

document.getElementById('enabled').addEventListener('change', (e) => {
  api.storage.local.set({ enabled: e.target.checked });
});
document.getElementById('settings').addEventListener('click', () => api.runtime.openOptionsPage());

init();
