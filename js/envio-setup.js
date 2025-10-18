// js/envio-setup.js
// Replace Envio inline controls with a simple "View Your Activity" link in the wallet modal.
(function(){
  try {
    if (window.__EnvioSetupMounted) return; window.__EnvioSetupMounted = true;
    function resolveAddress() {
      try { if (window.userAddress) return String(window.userAddress); } catch {}
      try { const a = sessionStorage.getItem('walletAddress') || localStorage.getItem('walletAddress'); if (a) return String(a); } catch {}
      try { const msg = sessionStorage.getItem('walletMsg')||''; const m = msg.match(/Address:\s*(0x[a-fA-F0-9]{40})/); if (m && m[1]) return m[1]; } catch {}
      return '';
    }
    function mountIntoWalletModal(dialog){
      if (!dialog) return;
      let box = document.getElementById('envio-inline');
      if (!box) {
        box = document.createElement('div'); box.id = 'envio-inline';
        box.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;';
        const label = document.createElement('span'); label.textContent = 'Activity:'; label.style.cssText='font-size:11px;opacity:0.85;';
        const link = document.createElement('a'); link.textContent = 'View Your Activity'; link.href = '#';
        link.style.cssText = 'padding:4px 8px;border-radius:8px;background:#2d6aee;color:#fff;font-size:11px;font-weight:700;text-decoration:none;';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const addr = resolveAddress();
          const u = new URL('/activity.html', location.origin);
          if (addr) u.searchParams.set('addr', addr);
          try { window.open(u.toString(), '_blank', 'noopener'); } catch { location.assign(u.toString()); }
        });
        box.appendChild(label); box.appendChild(link);
      }
      if (box.parentElement !== dialog) dialog.appendChild(box);
    }
    function watchForWalletModal(){
      const existing = document.getElementById('wi-wallet-dialog');
      if (existing) { mountIntoWalletModal(existing); return; }
      const mo = new MutationObserver(() => { const dlg = document.getElementById('wi-wallet-dialog'); if (dlg) { try { mountIntoWalletModal(dlg); } catch {} mo.disconnect(); } });
      try { mo.observe(document.body, { childList: true, subtree: true }); } catch {}
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchForWalletModal, { once: true });
    else watchForWalletModal();
  } catch {}
})();
