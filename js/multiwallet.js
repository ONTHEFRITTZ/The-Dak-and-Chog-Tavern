// EIP-6963 multiwallet discovery (no auto-connect)
// Exposes window.__EIP6963 with discovered providers and helpers

(function(){
  try {
    if (!window.__EIP6963) window.__EIP6963 = { discovered: [], byId: new Map(), ready: false };
    const state = window.__EIP6963;
    function onAnnounce(event){
      try {
        const d = event && event.detail; if (!d || !d.info || !d.provider) return;
        if (!state.byId.has(d.info.uuid)) {
          state.discovered.push(d);
          state.byId.set(d.info.uuid, d);
        }
      } catch {}
    }
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    // ask wallets to announce themselves
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch {}
    // mark ready on next tick (providers usually announce synchronously)
    setTimeout(function(){ state.ready = true; }, 0);
  } catch {}
})();

export function listWallets(){ try { return (window.__EIP6963 && window.__EIP6963.discovered) ? window.__EIP6963.discovered.slice() : []; } catch { return []; } }
export function getProviderByUuid(uuid){ try { const s=window.__EIP6963; if (!s) return null; const d=s.byId.get(uuid); return d ? d.provider : null; } catch { return null; } }
