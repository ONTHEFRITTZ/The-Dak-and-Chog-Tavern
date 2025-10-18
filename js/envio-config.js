// js/envio-config.js
// Loads a single Envio endpoint for the whole site.
// Only checks envio/ files; no assets/ fallback.
(function(){
  async function load() {
    const paths = ['/envio/endpoint.json', '/envio/config.json'];
    for (const p of paths) {
      try {
        const res = await fetch(p, { cache: 'no-store' });
        if (!res.ok) continue;
        const json = await res.json().catch(() => null);
        const ep = json && typeof json.endpoint === 'string' ? json.endpoint.trim() : '';
        if (ep) {
          try { window.ENVIO_HYPERSYNC_URL = ep; } catch {}
          break;
        }
      } catch {}
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
