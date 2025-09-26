// provider-pin.js
// Pin the selected wallet provider onto window.ethereum before any other script reads it.
(function(){
  try {
    var key = '';
    try { key = String((sessionStorage.getItem('walletProvider') || window.__walletProviderKey || '')).toLowerCase(); } catch(e) {}
    var prov = null;
    if (key === 'phantom') {
      try { if (window.phantom && window.phantom.ethereum) prov = window.phantom.ethereum; } catch(e) {}
    } else if (key === 'metamask') {
      try {
        var eth = window.ethereum;
        if (eth && Array.isArray(eth.providers)) prov = eth.providers.find(function(p){return p && p.isMetaMask;}) || eth;
        else if (eth && eth.isMetaMask) prov = eth;
        else prov = eth || null;
      } catch(e) {}
    }
    if (!prov) {
      try { if (window.__walletProvider && typeof window.__walletProvider.request === 'function') prov = window.__walletProvider; } catch(e) {}
      try { if (!prov && window.ethereum && typeof window.ethereum.request === 'function') prov = window.ethereum; } catch(e) {}
      try { if (!prov && window.phantom && window.phantom.ethereum && typeof window.phantom.ethereum.request === 'function') prov = window.phantom.ethereum; } catch(e) {}
    }
    if (prov) {
      try { window.__walletProvider = prov; } catch(e){}
      try { window.__walletProviderKey = key; } catch(e){}
      try { window.ethereum = prov; } catch(e){}
      try { Object.defineProperty(window, 'ethereum', { value: prov, configurable: true, writable: true }); } catch(e){}
    }
  } catch(e) {}
})();
