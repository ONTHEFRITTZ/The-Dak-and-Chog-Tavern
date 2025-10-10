(function () {
  if (window.__WalletPillSyncMounted) return;
  window.__WalletPillSyncMounted = true;

  const HEX40 = /^0x[0-9a-fA-F]{40}$/;
  const state = {
    address: '',
    provider: null,
    poller: null
  };

  function lcAddr(value) {
    if (!value) return '';
    const str = String(value).trim();
    return HEX40.test(str) ? str.toLowerCase() : '';
  }

  function shortAddr(addr) {
    return addr && addr.length > 10 ? addr.slice(0, 6) + '...' + addr.slice(-4) : (addr || '');
  }

  function getStoredAddress() {
    try {
      const direct = sessionStorage.getItem('walletAddress') || localStorage.getItem('walletAddress');
      const normalized = lcAddr(direct);
      if (normalized) return normalized;
    } catch {}
    try {
      const msg = sessionStorage.getItem('walletMsg') || localStorage.getItem('walletMsg') || '';
      const match = msg.match(/Address:\s*(0x[0-9a-fA-F]{40})/i);
      if (match && match[1]) return lcAddr(match[1]);
    } catch {}
    return '';
  }

  function persistAddress(addr) {
    const normalized = lcAddr(addr);
    if (!normalized) return clearPersistedAddress();
    try { sessionStorage.setItem('walletConnected', 'true'); } catch {}
    try { localStorage.setItem('walletConnected', 'true'); } catch {}
    try { sessionStorage.setItem('walletAddress', normalized); } catch {}
    try { localStorage.setItem('walletAddress', normalized); } catch {}
    return normalized;
  }

  function clearPersistedAddress() {
    const keys = [
      'walletConnected',
      'walletAddress',
      'walletProvider',
      'walletMsg',
      'walletSig'
    ];
    keys.forEach((key) => {
      try { sessionStorage.removeItem(key); } catch {}
      try { localStorage.removeItem(key); } catch {}
    });
    try { sessionStorage.removeItem('walletSigned'); } catch {}
    return '';
  }

  function getPillElements() {
    const pill = document.getElementById('wallet-inline');
    const addrEl = document.getElementById('wi-address');
    const discEl = document.getElementById('wi-disconnect');
    return { pill, addrEl, discEl };
  }

  function ensureDisconnectHandler() {
    const { discEl } = getPillElements();
    if (!discEl || discEl.dataset.walletSyncBound) return;
    discEl.dataset.walletSyncBound = '1';
    discEl.addEventListener('click', () => {
      clearPersistedAddress();
      try { document.dispatchEvent(new CustomEvent('wallet:disconnected')); } catch {}
      try { location.replace('/landing.html'); } catch { location.href = '/landing.html'; }
    });
  }

  function updatePillDisplay(addr) {
    const { addrEl, discEl } = getPillElements();
    if (addrEl) addrEl.textContent = addr ? shortAddr(addr) : '-';
    if (discEl) discEl.style.display = addr ? '' : 'none';
    ensureDisconnectHandler();
  }

  function refreshBalances(addr) {
    const helper = window.Bankroll || window.__PokerBankroll;
    if (helper && typeof helper.refreshBalance === 'function') {
      try { helper.refreshBalance(addr); } catch {}
    }
  }

  function applyAddress(next, { persist = false } = {}) {
    const normalized = lcAddr(next);
    if (!normalized) {
      if (state.address) {
        state.address = '';
        updatePillDisplay('');
        refreshBalances('');
      }
      if (persist) clearPersistedAddress();
      return '';
    }
    if (persist) persistAddress(normalized);
    if (state.address === normalized) return normalized;
    state.address = normalized;
    updatePillDisplay(normalized);
    refreshBalances(normalized);
    try {
      document.dispatchEvent(new CustomEvent('wallet:pill-ready', { detail: { address: normalized } }));
    } catch {}
    return normalized;
  }

  function resolveProvider() {
    try {
      if (typeof window.__getSelectedProvider === 'function') {
        const selected = window.__getSelectedProvider();
        if (selected && typeof selected.request === 'function') return selected;
      }
    } catch {}
    const choice = window.walletChoice?.provider;
    if (choice && typeof choice.request === 'function') return choice;
    try {
      if (window.ethereum && typeof window.ethereum.request === 'function') return window.ethereum;
    } catch {}
    try {
      if (window.phantom?.ethereum && typeof window.phantom.ethereum.request === 'function') {
        return window.phantom.ethereum;
      }
    } catch {}
    return null;
  }

  async function pollAccountsOnce() {
    const provider = state.provider || resolveProvider();
    if (!provider || typeof provider.request !== 'function') return;
    state.provider = provider;
    try {
      const accounts = await provider.request({ method: 'eth_accounts' }).catch(() => []);
      if (Array.isArray(accounts) && accounts[0]) {
        applyAddress(accounts[0], { persist: true });
      }
    } catch {}
  }

  function startPolling() {
    if (state.poller) return;
    state.poller = setInterval(pollAccountsOnce, 4000);
    pollAccountsOnce();
  }

  function stopPolling() {
    if (state.poller) {
      clearInterval(state.poller);
      state.poller = null;
    }
  }

  function handleWalletConnected(ev) {
    const addr = ev?.detail?.address || ev?.detail?.account || ev?.detail?.addr;
    if (!addr) return;
    state.provider = resolveProvider();
    applyAddress(addr, { persist: true });
    startPolling();
  }

  function handleWalletDisconnected() {
    stopPolling();
    state.provider = null;
    applyAddress('', { persist: true });
  }

  function boot() {
    const initial = getStoredAddress();
    if (initial) {
      applyAddress(initial, { persist: false });
      startPolling();
    } else {
      updatePillDisplay('');
    }
    ensureDisconnectHandler();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('wallet:connected', handleWalletConnected);
  window.addEventListener('wallet:provider:pinned', () => {
    state.provider = resolveProvider();
    if (state.address) startPolling();
  });
  window.addEventListener('wallet:disconnected', handleWalletDisconnected);

  window.addEventListener('focus', () => {
    if (document.hasFocus()) pollAccountsOnce();
  });

  window.addEventListener('storage', (ev) => {
    if (!ev || !ev.key) return;
    const key = String(ev.key).toLowerCase();
    if (key.includes('wallet')) {
      const next = getStoredAddress();
      if (next) applyAddress(next);
      else handleWalletDisconnected();
    }
  });

  document.addEventListener('bankroll:ready', () => {
    if (state.address) refreshBalances(state.address);
  });
})();

