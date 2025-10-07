// js/wallet-chips.js
// Adds a Chips trigger to the wallet pill and shares bankroll UI across pages.
(function () {
  if (window.__WalletChipsMounted) return;
  window.__WalletChipsMounted = true;

  const buildTag = window.__BUILD_TAG || Date.now();
  const CDN_ETHERS = 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js';
  const SRC = {
    dcmon: `/js/DCMonABI.js?v=${buildTag}`,
    wmon: `/js/WMONABI.js?v=${buildTag}`,
    bankroll: `/js/bankroll.js?v=${buildTag}`
  };

  const scriptCache = new Map();
  function loadScriptOnce(src, target = 'head') {
    if (scriptCache.has(src)) return scriptCache.get(src);
    const promise = new Promise((resolve, reject) => {
      try {
        const el = document.createElement('script');
        el.defer = true;
        el.src = src;
        el.onload = () => resolve();
        el.onerror = (err) => reject(err);
        (target === 'body' ? document.body : document.head).appendChild(el);
      } catch (err) {
        reject(err);
      }
    });
    scriptCache.set(src, promise);
    return promise;
  }

  function signalEthersReady() {
    try { document.dispatchEvent(new CustomEvent('wallet:ethers-ready')); } catch (_) {}
  }

  function loadDependencies() {
    const deps = [];
    const ethersPromise = window.ethers ? Promise.resolve() : loadScriptOnce(CDN_ETHERS);
    deps.push(ethersPromise.then(() => { signalEthersReady(); }));
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
  function ensureReady() {
    if (readyPromise) return readyPromise;
    readyPromise = loadDependencies()
      .catch((err) => {
        console.error('wallet-chips: dependency load failed', err);
        try { loadScriptOnce('/js/DCMonABI.js?v=' + Date.now()); } catch {}
        try { loadScriptOnce('/js/WMONABI.js?v=' + Date.now()); } catch {}
        try { loadScriptOnce('/js/bankroll.js?v=' + Date.now(), 'body'); } catch {}
      })
      .finally(() => waitFor(() => Array.isArray(window.DCMonABI) && Array.isArray(window.WMONABI)(window.Bankroll || window.__PokerBankroll)))
      .catch((err) => console.error(err));
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
      const anchor = pill.querySelector('#wi-disconnect');
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

  function createModal() {
    let overlay = document.getElementById('wi-chips-modal');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'wi-chips-modal';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0,0,0,0.65)';
    overlay.style.zIndex = '13000';

    const dialog = document.createElement('div');
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

    return overlay;
  }

  function openModal() {
    const overlay = createModal();
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.body.dataset.chipsModalOpen = '1';

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
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    delete document.body.dataset.chipsModalOpen;
  }

  function init() {
    ensureBalanceBadges();
    const pill = document.getElementById('wallet-inline');
    if (pill && !document.getElementById('wi-chips-btn')) {
      const btn = document.createElement('button');
      btn.id = 'wi-chips-btn';
      btn.textContent = 'Chips';
      btn.style.padding = '6px 12px';
      btn.style.borderRadius = '10px';
      btn.style.fontWeight = '600';
      pill.appendChild(btn);
      btn.addEventListener('click', openModal);
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && document.body.dataset.chipsModalOpen) {
          closeModal();
        }
      });
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

