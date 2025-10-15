// provider-pin.js — Pin the user's chosen wallet across all pages (MetaMask or Phantom EVM).
// Runs early (non-module). Safe no-op if only one wallet or none is present.

(function () {
  /** Utilities **/
  const lc = (s) => String(s || '').toLowerCase();
  const readPref = () => {
    try {
      const a = sessionStorage.getItem('walletProvider') || localStorage.getItem('walletProvider');
      return lc(a);
    } catch { return ''; }
  };
  const savePref = (v) => {
    try {
      sessionStorage.setItem('walletProvider', lc(v));
      localStorage.setItem('walletProvider', lc(v));
    } catch {}
  };

  /** Discover providers **/
  function getAll() {
    const all = { metamask: null, phantom: null, rawEthereum: null, allEthProviders: [] };

    const eth = window.ethereum;
    if (eth) {
      all.rawEthereum = eth;
      if (eth.isMetaMask) all.metamask = eth;
      if (Array.isArray(eth.providers)) {
        all.allEthProviders = eth.providers.slice();
        const mm = eth.providers.find(p => p && p.isMetaMask);
        if (mm) all.metamask = mm;
      }
    }
    const phEvm = window?.phantom?.ethereum;
    if (phEvm && typeof phEvm.request === 'function') {
      all.phantom = phEvm;
    }
    return all;
  }

  /** Choose by preference, with sensible fallback **/
  function chooseProvider(pref, all) {
    // Explicit pick
    if (pref === 'metamask' && all.metamask) return { name: 'metamask', provider: all.metamask };
    if (pref === 'phantom'  && all.phantom ) return { name: 'phantom',  provider: all.phantom  };

    // Auto fallback: if only one is present, use it
    if (all.metamask && !all.phantom) return { name: 'metamask', provider: all.metamask };
    if (all.phantom  && !all.metamask) return { name: 'phantom',  provider: all.phantom  };

    // Default (no pref or both present): keep existing window.ethereum if it’s MM, else Phantom
    if (all.metamask) return { name: 'metamask', provider: all.metamask };
    if (all.phantom)  return { name: 'phantom',  provider: all.phantom  };

    return { name: '', provider: null };
  }

  /** Attempt to set window.ethereum to the chosen provider (best effort). */
  function pinGlobalEthereum(chosen) {
    if (!chosen) return false;

    // Some wallet inpages define window.ethereum as non-configurable.
    // Try direct assignment first; fall back to defineProperty if allowed.
    try {
      // Direct replace if writable
      window.ethereum = chosen;
      return true;
    } catch {}

    try {
      const desc = Object.getOwnPropertyDescriptor(window, 'ethereum');
      if (!desc || desc.configurable) {
        Object.defineProperty(window, 'ethereum', {
          value: chosen, writable: false, enumerable: true, configurable: true
        });
        return true;
      }
    } catch {}

    return false;
  }

  /** Main */
  const pref  = readPref();           // 'metamask' | 'phantom' | ''
  const all   = getAll();
  const pick  = chooseProvider(pref, all); // {name, provider}

  // Expose the pinned choice for app code (even if we can’t override window.ethereum)
  window.walletChoice = {
    name: pick.name,                 // 'metamask' | 'phantom' | ''
    provider: pick.provider,         // EIP-1193 provider or null
    save: savePref
  };
  window.getPreferredProvider = function () { return window.walletChoice?.provider || null; };

  // Best-effort: point window.ethereum to the chosen provider so legacy code “just works”
  const pinned = pinGlobalEthereum(pick.provider);

  // Also expose both for callers that want to be explicit
  window.ethereumPreferred = pick.provider || null;
  window.ethereumAll = {
    metamask: all.metamask || null,
    phantom:  all.phantom  || null,
    rawEthereum: all.rawEthereum || null,
    providers: all.allEthProviders || []
  };

  // Tell the app we’re ready
  try {
    window.dispatchEvent(new CustomEvent('wallet:provider:pinned', {
      detail: { pinned, name: pick.name }
    }));
  } catch {}

  // Optional nicety: keep the preference if the user opens the other wallet later
  // by clicking its extension, so future pages stick to the most recent approval.
  function wireOnAccountsChanged(p, tag) {
    if (!p || typeof p.on !== 'function') return;
    p.on('accountsChanged', (accs) => {
      if (Array.isArray(accs) && accs[0]) {
        savePref(tag); // remember the last wallet that produced a real account
      }
    });
  }
  wireOnAccountsChanged(all.metamask, 'metamask');
  wireOnAccountsChanged(all.phantom,  'phantom');

  // Ensure the site-wide AA init module is loaded immediately after provider pin.
  try {
    const hasInit = document.querySelector('script[type="module"][src$="/js/aa/init-all.js"]');
    if (!hasInit) {
      const m = document.createElement('script');
      m.type = 'module';
      m.src = '/js/aa/init-all.js';
      // Prefer head to load as early as possible
      (document.head || document.documentElement || document.body).appendChild(m);
    }
  } catch {}
})();
