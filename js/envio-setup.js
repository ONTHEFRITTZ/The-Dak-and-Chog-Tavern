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
    function mountIntoWalletModal(dialog){
      if (!dialog) return;
      let box = document.getElementById('envio-inline');
      if (!box) {
        box = document.createElement('div');
        box.id = 'envio-inline';
        box.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';
        const label = document.createElement('span'); label.textContent = 'Envio:'; label.style.cssText = 'font-size:11px;opacity:0.85;';
        const input = document.createElement('input'); input.type = 'text'; input.id = 'envio-inline-url'; input.placeholder = 'https://<envio-endpoint>';
        input.style.cssText = 'flex:1;min-width:120px;padding:4px 8px;border-radius:8px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.14);color:#f4e6d3;font-size:11px;';
        try { input.value = getSaved(); } catch {}
        const save = document.createElement('button'); save.textContent = 'Save'; save.style.cssText = 'padding:4px 8px;border-radius:8px;background:#2d6aee;color:#fff;border:none;font-size:11px;cursor:pointer;';
        const local = document.createElement('button'); local.textContent = 'Use Local'; local.style.cssText = 'padding:4px 8px;border-radius:8px;background:rgba(255,255,255,0.06);color:#f4e6d3;border:none;font-size:11px;cursor:pointer;';
        async function persist(v){ try { const mod = await import('/js/envio-activity.js'); mod.setEnvioUrl(v); } catch {} }
        save.addEventListener('click', async () => { const v = input.value || ''; await persist(v); try{ location.reload(); }catch{} });
        local.addEventListener('click', async () => { const v = (location && location.origin) || ''; input.value = v; await persist(v); try{ location.reload(); }catch{} });
        box.appendChild(label); box.appendChild(input); box.appendChild(save); box.appendChild(local);
      }
      if (box.parentElement !== dialog) dialog.appendChild(box);
    }
    function watchForWalletModal(){
      const existing = document.getElementById('wi-wallet-dialog');
      if (existing) { mountIntoWalletModal(existing); return; }
      const mo = new MutationObserver(() => {
        const dlg = document.getElementById('wi-wallet-dialog');
        if (dlg) { try { mountIntoWalletModal(dlg); } catch {} mo.disconnect(); }
      });
      try { mo.observe(document.body, { childList: true, subtree: true }); } catch {}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', watchForWalletModal, { once: true });
    } else {
      watchForWalletModal();
    }
  } catch {}
})();
