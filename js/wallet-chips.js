// js/wallet-chips.js
// Adds a Chips trigger to the wallet pill and shares bankroll UI across pages.
(function () {
  if (window.__WalletChipsMounted) return;
  window.__WalletChipsMounted = true;

  const buildTag = window.__BUILD_TAG || Date.now();
const CDN_ETHERS_ESM = 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';
  const SRC = {
    dcmon: `/js/DCMonABI.js?v=${buildTag}`,
    wmon: `/js/WMONABI.js?v=${buildTag}`,
    bankroll: `/js/bankroll.js?v=${buildTag}`
  };
  const FALLBACK_DCMON_ABI = [
    'function deposit(uint256 amount, address receiver) returns (uint256)',
    'function redeem(uint256 amount, address receiver) returns (uint256)',
    'function recordRewards(uint256 amount)',
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function houseTreasury() view returns (address)',
    'function playerRewardPool() view returns (address)'
  ];
  const FALLBACK_WMON_ABI = [
    'function deposit() payable',
    'function withdraw(uint256 wad)',
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)'
  ];

  const scriptCache = new Map();
  function loadScriptOnce(src, target = 'head') {
    if (scriptCache.has(src)) return scriptCache.get(src);
    const promise = new Promise((resolve, reject) => {
      function appendScript() {
        try {
          const el = document.createElement('script');
          el.defer = true;
          el.src = src;
          el.onload = () => resolve();
          el.onerror = (err) => reject(err);
          const parent = (target === 'body') ? document.body : document.head;
          (parent || document.documentElement).appendChild(el);
        } catch (err) {
          reject(err);
        }
      }
      if (target === 'body' && !document.body) {
        const waitForBody = () => {
          if (document.body) {
            appendScript();
            return;
          }
          if (document.readyState === 'loading') {
            setTimeout(waitForBody, 25);
            return;
          }
          appendScript();
        };
        waitForBody();
      } else {
        appendScript();
      }
    });
    scriptCache.set(src, promise);
    return promise;
  }

  function signalEthersReady() {
    try { document.dispatchEvent(new CustomEvent('wallet:ethers-ready')); } catch (_) {}
  }

  async function ensureEthers() {
    if (window.ethers) {
      signalEthersReady();
      return;
    }
    try {
      const mod = await import(/* @vite-ignore */ CDN_ETHERS_ESM);
      const maybe = mod?.ethers || mod?.default || mod;
      if (maybe) {
        window.ethers = maybe;
        signalEthersReady();
        return;
      }
      throw new Error('ethers module missing exports');
    } catch (err) {
      console.error('wallet-chips: ethers import failed', err);
      throw err;
    }
  }

  function loadDependencies() {
    const deps = [];
    deps.push(ensureEthers());
    deps.push(loadScriptOnce(SRC.dcmon));
    deps.push(loadScriptOnce(SRC.wmon));
    deps.push(loadScriptOnce(SRC.bankroll, 'body'));
    return Promise.all(deps).then(() => { signalAbisReady(); });
  }
  function signalAbisReady() {
    try { document.dispatchEvent(new CustomEvent('wallet:abis-ready')); } catch (_) {}
  }


  function waitFor(condition, timeout = 9000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function check() {
        if (condition()) {
          resolve();
          return;
        }
        if (Date.now() - start > timeout) {
          reject(new Error('wallet-chips: dependency wait timed out'));
          return;
        }
        setTimeout(check, 50);
      })();
    });
  }

  let readyPromise = null;
  let escapeListenerAttached = false;
  function ensureReady() {
    if (readyPromise) return readyPromise;
    readyPromise = loadDependencies()
      .catch((err) => {
        console.error('wallet-chips: dependency load failed', err);
        try { if (!Array.isArray(window.DCMonABI)) window.DCMonABI = FALLBACK_DCMON_ABI; } catch {}
        try {
          if (!Array.isArray(window.WMONABI) && !Array.isArray(window.WMON_ABI)) {
            window.WMONABI = FALLBACK_WMON_ABI;
            window.WMON_ABI = FALLBACK_WMON_ABI;
          } else if (!Array.isArray(window.WMONABI) && Array.isArray(window.WMON_ABI)) {
            window.WMONABI = window.WMON_ABI;
          }
        } catch {}
        try { if (!window.__BANKROLL_FALLBACK_ABIS__) window.__BANKROLL_FALLBACK_ABIS__ = { dcmon: FALLBACK_DCMON_ABI, wmon: FALLBACK_WMON_ABI }; } catch {}
        return null;
      })
      .then(() => {
        const fallback = window.__BANKROLL_FALLBACK_ABIS__ || null;
        if (!Array.isArray(window.DCMonABI) && fallback?.dcmon) window.DCMonABI = fallback.dcmon;
        if (!Array.isArray(window.WMONABI) && fallback?.wmon) window.WMONABI = fallback.wmon;
        if (!Array.isArray(window.WMONABI) && Array.isArray(window.WMON_ABI)) window.WMONABI = window.WMON_ABI;
      })
      .then(() => waitFor(() => Array.isArray(window.DCMonABI) && Array.isArray(window.WMONABI)))
      .then(() => {
        if (!Array.isArray(window.WMON_ABI) && Array.isArray(window.WMONABI)) window.WMON_ABI = window.WMONABI;
        return true;
      })
      .catch((err) => { console.error('wallet-chips: dependency load failed', err); throw err; });
    return readyPromise;
  }
  function ensureBalanceBadges() {
    const pill = document.getElementById('wallet-inline');
    if (!pill) return;

    let wrap = document.getElementById('wi-balance-wrap');
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.id = 'wi-balance-wrap';
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '8px';
      const anchor = pill.querySelector('#wi-wallet-btn') || pill.querySelector('#wi-disconnect');
      pill.insertBefore(wrap, anchor || null);
    }

    function ensureBadge(id, label) {
      if (document.getElementById(id)) return;
      const badge = document.createElement('span');
      badge.className = 'wi-balance-badge';
      badge.style.display = 'flex';
      badge.style.alignItems = 'center';
      badge.style.fontSize = '12px';
      badge.style.background = 'rgba(0,0,0,0.35)';
      badge.style.borderRadius = '12px';
      badge.style.padding = '2px 6px';
      badge.style.gap = '4px';
      const strong = document.createElement('strong');
      strong.textContent = label;
      const value = document.createElement('span');
      value.id = id;
      value.textContent = '-';
      badge.appendChild(strong);
      badge.appendChild(value);
      wrap.appendChild(badge);
    }

    ensureBadge('wi-mon-balance-pill', 'MON');
    ensureBadge('wi-dcmon-balance-pill', 'DCMon');
  }

  function buildBankrollMarkup(container) {
    container.innerHTML = '';
    container.insertAdjacentHTML('beforeend', `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
        <span>MON Balance</span>
        <span id="wi-mon-balance-modal">-</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
        <span>DCMon Balance</span>
        <span id="wi-dcmon-balance">-</span>
      </div>
      <div style="display:flex;gap:10px;">
        <input id="wi-buy-input" type="number" min="0" step="0.01" placeholder="Amount" style="flex:1;padding:8px;border-radius:10px;" />
        <button id="wi-buy-btn" style="flex:0 0 110px;padding:8px 0;border-radius:10px;font-weight:600;background:rgba(80,160,120,0.85);">Buy In</button>
      </div>
      <div style="display:flex;gap:10px;">
        <input id="wi-cash-input" type="number" min="0" step="0.01" placeholder="Amount" style="flex:1;padding:8px;border-radius:10px;" />
        <button id="wi-cash-btn" style="flex:0 0 110px;padding:8px 0;border-radius:10px;font-weight:600;background:rgba(160,120,80,0.85);">Cash Out</button>
      </div>
      <div id="wi-bank-status" style="min-height:18px;font-size:12px;"></div>
    `);
  }

  function ensureModalSections(dialog) {
    if (!dialog) return;

    let actions = document.getElementById('wi-wallet-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'wi-wallet-actions';
      actions.style.display = 'flex';
      actions.style.flexDirection = 'column';
      actions.style.gap = '12px';
      const heading = document.createElement('div');
      heading.className = 'wi-wallet-actions-heading';
      heading.textContent = 'Wallet Controls';
      heading.style.fontWeight = '600';
      heading.style.fontSize = '13px';
      heading.style.opacity = '0.85';
      actions.appendChild(heading);
    }
    if (actions.parentElement !== dialog) {
      dialog.appendChild(actions);
    }

    const disconnect = document.getElementById('wi-disconnect');
    if (disconnect) {
      disconnect.style.display = 'inline-flex';
      disconnect.style.alignItems = 'center';
      disconnect.style.justifyContent = 'center';
      disconnect.style.width = '100%';
      disconnect.style.margin = '0';
      disconnect.style.fontSize = '13px';
      disconnect.style.padding = '8px 0';
      if (disconnect.parentElement !== actions) {
        const heading = actions.querySelector('.wi-wallet-actions-heading');
        if (heading) {
          heading.insertAdjacentElement('afterend', disconnect);
        } else {
          actions.insertBefore(disconnect, actions.firstChild);
        }
      }
    }

    let aaHost = document.getElementById('wi-aa-panel-host');
    if (!aaHost) {
      aaHost = document.createElement('div');
      aaHost.id = 'wi-aa-panel-host';
      aaHost.style.display = 'flex';
      aaHost.style.flexDirection = 'column';
      aaHost.style.gap = '8px';
    }
    if (aaHost.parentElement !== actions) {
      actions.appendChild(aaHost);
    }

    const aaControls = document.getElementById('aa-controls');
    if (aaControls && aaControls.parentElement !== aaHost) {
      aaHost.appendChild(aaControls);
      aaControls.style.width = '100%';
    }

    const aaPanel = document.getElementById('aa-panel');
    if (aaPanel && aaPanel.parentElement !== aaHost) {
      aaPanel.style.display = 'flex';
      aaPanel.style.width = '100%';
      aaHost.appendChild(aaPanel);
    }
  }

  function createModal() {
    let overlay = document.getElementById('wi-chips-modal');
    let dialog;

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wi-chips-modal';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.display = 'none';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.background = 'rgba(0,0,0,0.65)';
      overlay.style.zIndex = '13000';

      dialog = document.createElement('div');
      dialog.id = 'wi-wallet-dialog';
      dialog.style.background = 'var(--panel-bg-soft, rgba(24,20,16,0.95))';
      dialog.style.border = '1px solid rgba(255,255,255,0.12)';
      dialog.style.borderRadius = '18px';
      dialog.style.padding = '20px';
      dialog.style.width = 'min(92vw, 360px)';
      dialog.style.boxShadow = '0 24px 60px rgba(0,0,0,0.6)';
      dialog.style.color = '#f4e6d3';
      dialog.style.display = 'flex';
      dialog.style.flexDirection = 'column';
      dialog.style.gap = '16px';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.justifyContent = 'space-between';
      header.style.gap = '12px';

      const title = document.createElement('h3');
      title.textContent = 'DCMon Bankroll';
      title.style.margin = '0';
      title.style.fontSize = '18px';

      const closeBtn = document.createElement('button');
      closeBtn.id = 'wi-chips-close';
      closeBtn.textContent = 'Close';
      closeBtn.style.padding = '6px 14px';
      closeBtn.style.borderRadius = '10px';

      header.appendChild(title);
      header.appendChild(closeBtn);

      let container = document.getElementById('wi-bankroll');
      if (container) {
        container.innerHTML = '';
        if (container.parentElement) container.parentElement.removeChild(container);
      } else {
        container = document.createElement('div');
        container.id = 'wi-bankroll';
      }
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '12px';
      buildBankrollMarkup(container);

      dialog.appendChild(header);
      dialog.appendChild(container);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      closeBtn.addEventListener('click', closeModal);
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });
      dialog.addEventListener('click', (ev) => ev.stopPropagation());
    } else {
      dialog = overlay.querySelector('#wi-wallet-dialog') || overlay.firstElementChild;
    }

    ensureModalSections(dialog);
    return overlay;
  }

  function openModal() {
    const overlay = createModal();
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.body.dataset.chipsModalOpen = '1';

    const trigger = document.getElementById('wi-wallet-btn');
    if (trigger) {
      trigger.classList.add('active');
      trigger.setAttribute('aria-expanded', 'true');
    }

    const statusEl = document.getElementById('wi-bank-status');
    if (statusEl && !statusEl.textContent) statusEl.textContent = 'Loading bankroll...';

    ensureReady()
      .then(() => {
        document.dispatchEvent(new CustomEvent('bankroll:ui-ready'));
        const bankroll = window.Bankroll || window.__PokerBankroll;
        if (!bankroll) {
          const handler = function once() {
            document.removeEventListener('bankroll:ready', handler);
            const globalBankroll = window.Bankroll || window.__PokerBankroll;
            if (globalBankroll?.refreshBalance) globalBankroll.refreshBalance();
          };
          document.addEventListener('bankroll:ready', handler);
        } else if (bankroll?.refreshBalance) {
          bankroll.refreshBalance();
        }
      })
      .catch((err) => {
        console.error(err);
        if (statusEl) statusEl.textContent = 'Bankroll helper failed to load.';
      });
  }

  function closeModal() {
    const overlay = document.getElementById('wi-chips-modal');
    if (!overlay) return;

    const trigger = document.getElementById('wi-wallet-btn');
    const active = document.activeElement;
    if (active && overlay.contains(active)) {
      if (trigger) {
        try { trigger.focus(); } catch {}
      } else {
        try { active.blur(); } catch {}
      }
    }

    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    delete document.body.dataset.chipsModalOpen;

    if (trigger) {
      trigger.classList.remove('active');
      trigger.setAttribute('aria-expanded', 'false');
    }
  }

  function init() {
    try {
      if (!window.openWalletChipsModal) window.openWalletChipsModal = openModal;
    } catch {}
    ensureBalanceBadges();
    const pill = document.getElementById('wallet-inline');
    if (pill && !document.getElementById('wi-wallet-btn')) {
      const btn = document.createElement('button');
      btn.id = 'wi-wallet-btn';
      btn.type = 'button';
      btn.textContent = 'Wallet';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        if (document.body.dataset.chipsModalOpen) {
          closeModal();
        } else {
          openModal();
        }
      });
      pill.appendChild(btn);
    }
    if (!escapeListenerAttached) {
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && document.body.dataset.chipsModalOpen) {
          closeModal();
        }
      });
      escapeListenerAttached = true;
    }

    createModal();
    ensureReady().then(() => document.dispatchEvent(new CustomEvent('bankroll:ui-ready')));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
