// js/envio-setup.js
// Lightweight Envio (HyperSync/HyperIndex) endpoint picker injected into the UI.
(function(){
  try {
    if (window.__EnvioSetupMounted) return; window.__EnvioSetupMounted = true;
    function getSaved() {
      try { if (typeof window.ENVIO_HYPERSYNC_URL === 'string' && window.ENVIO_HYPERSYNC_URL) return window.ENVIO_HYPERSYNC_URL; } catch {}
      try { const u = localStorage.getItem('envio.hypersync.url'); if (u) return u; } catch {}
      try { return (location && location.origin) || ''; } catch { return ''; }
    }
    function mountInto(host){
      if (!host) return;
      let box = document.getElementById('envio-inline');
      if (!box) {
        box = document.createElement('div');
        box.id = 'envio-inline';
        box.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:6px;';
        const label = document.createElement('span'); label.textContent = 'Envio:'; label.style.cssText = 'font-size:11px;opacity:0.85;';
        const input = document.createElement('input'); input.type = 'text'; input.id = 'envio-inline-url'; input.placeholder = 'https://<envio-endpoint>';
        input.style.cssText = 'width:240px;max-width:42vw;padding:4px 8px;border-radius:8px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.14);color:#f4e6d3;font-size:11px;';
        try { input.value = getSaved(); } catch {}
        const save = document.createElement('button'); save.textContent = 'Save'; save.style.cssText = 'padding:4px 8px;border-radius:8px;background:#2d6aee;color:#fff;border:none;font-size:11px;cursor:pointer;';
        const local = document.createElement('button'); local.textContent = 'Use Local'; local.style.cssText = 'padding:4px 8px;border-radius:8px;background:rgba(255,255,255,0.06);color:#f4e6d3;border:none;font-size:11px;cursor:pointer;';
        async function persist(v){ try { const mod = await import('/js/envio-activity.js'); mod.setEnvioUrl(v); } catch {} }
        save.addEventListener('click', async () => { const v = input.value || ''; await persist(v); try{ location.reload(); }catch{} });
        local.addEventListener('click', async () => { const v = (location && location.origin) || ''; input.value = v; await persist(v); try{ location.reload(); }catch{} });
        box.appendChild(label); box.appendChild(input); box.appendChild(save); box.appendChild(local);
      }
      if (box.parentElement !== host) host.appendChild(box);
    }
    function tryMount(){
      const inline = document.getElementById('wallet-inline');
      if (inline) { mountInto(inline); return; }
      // Fallback: mount into body top-right if wallet-inline is missing
      let host = document.getElementById('envio-inline-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'envio-inline-host';
        host.style.cssText = 'position:fixed;top:12px;left:12px;z-index:12000;background:rgba(0,0,0,0.35);padding:4px 6px;border-radius:10px;display:flex;align-items:center;';
        document.body.appendChild(host);
      }
      mountInto(host);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryMount, { once: true });
    } else {
      tryMount();
    }
  } catch {}
})();

