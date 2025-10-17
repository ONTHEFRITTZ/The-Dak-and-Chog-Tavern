// js/envio-config.js
// Loads a single Envio endpoint for the whole site.
// Place your endpoint in assets/envio.json as: { "endpoint": "https://your-envio-endpoint" }
(function(){
  async function load() {
    try {
      const res = await fetch('/assets/envio.json', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      const ep = json && typeof json.endpoint === 'string' ? json.endpoint.trim() : '';
      if (ep) {
        try { window.ENVIO_HYPERSYNC_URL = ep; } catch {}
      }
    } catch {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();

