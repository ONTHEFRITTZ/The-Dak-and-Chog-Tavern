// js/wallet-chips.js (fixed)
// Wallet pill: adds Wallet button, balance badges, and a simple bankroll modal.
(function () {
  if (window.__WalletChipsMounted) return;
  window.__WalletChipsMounted = true;

  const OPEN_HISTORY_EVENT = "tavern:poker:openHistory";
  const CHANGE_NAME_EVENT = "tavern:poker:changeName";
  const BLINDS_EVENT = "poker:blinds";
  let blindsLabelCache = "";

  const getGamePage = () =>
    (document.body && document.body.dataset && document.body.dataset.gamePage) || "";

  function ensureBlindsLine() {
    const pill = document.getElementById('wallet-inline');
    if (!pill) return null;
    let line = document.getElementById('wi-blinds-line');
    if (!line) {
      line = document.createElement('div');
      line.id = 'wi-blinds-line';
      line.className = 'wi-blinds-line';
      pill.appendChild(line);
    }
    return line;
  }

  function updateBlindsIndicator(label, contextPage) {
    blindsLabelCache = label || "";
    const page = contextPage || getGamePage();
    const line = ensureBlindsLine();
    if (!line) return;
    if (page === 'poker-table' && blindsLabelCache) {
      line.textContent = `Blinds ${blindsLabelCache}`;
      line.style.display = 'block';
    } else if (page === 'poker-table') {
      line.textContent = '';
      line.style.display = 'none';
    } else {
      line.textContent = '';
      line.style.display = 'none';
    }
  }

  function cleanupLegacyBalanceBadges() {
    const wrap = document.getElementById('wi-balance-wrap');
    if (wrap && wrap.parentElement) {
      wrap.parentElement.removeChild(wrap);
    }
    const legacyIds = ['wi-mon-balance-pill', 'wi-dcmon-balance-pill', 'wi-mon-balance', 'wi-dcmon-balance', 'wi-mon-balance-modal', 'wi-dcmon-balance-modal'];
    legacyIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.parentElement) {
        el.parentElement.removeChild(el);
      }
    });
    ensureBlindsLine();
    updateBlindsIndicator(blindsLabelCache);
  }

  function buildBankrollMarkup(container) {
    container.innerHTML = '';
    container.insertAdjacentHTML('beforeend', `
      <div class="wi-balance-section" style="display:flex;flex-direction:column;gap:6px;">
        <div class="wi-balance-heading" style="font-weight:600;font-size:13px;opacity:0.85;">Owner Wallet (EOA)</div>
        <div class="wi-balance-row" style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
          <span>MON</span>
          <span id="wi-mon-balance-eoa">-</span>
        </div>
        <div class="wi-balance-row" style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
          <span>DCMon</span>
          <span id="wi-dcmon-balance-eoa">-</span>
        </div>
      </div>
      <div class="wi-balance-section" style="display:flex;flex-direction:column;gap:6px;">
        <div class="wi-balance-heading" style="font-weight:600;font-size:13px;opacity:0.85;">Smart Account</div>
        <div class="wi-balance-row" style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
          <span>MON</span>
          <span id="wi-mon-balance-smart">-</span>
        </div>
        <div class="wi-balance-row" style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
          <span>DCMon</span>
          <span id="wi-dcmon-balance-smart">-</span>
        </div>
      </div>
      <div id="wi-exchange-rate-row" style="display:flex;justify-content:space-between;align-items:center;font-size:12px;opacity:0.9;">
        <span>Exchange Rate</span>
        <span id="wi-exchange-rate">-</span>
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
      const h = document.createElement('div');
      h.className = 'wi-wallet-actions-heading';
      h.textContent = 'Wallet Controls';
      h.style.fontWeight = '600'; h.style.fontSize = '13px'; h.style.opacity = '0.85';
      actions.appendChild(h);
    }
    if (actions.parentElement !== dialog) dialog.appendChild(actions);

    const disconnect = document.getElementById('wi-disconnect');
    if (disconnect && disconnect.parentElement !== actions) {
      disconnect.style.display = 'inline-flex';
      disconnect.style.alignItems = 'center';
      disconnect.style.justifyContent = 'center';
      disconnect.style.width = '100%';
      disconnect.style.margin = '0';
      disconnect.style.fontSize = '13px';
      disconnect.style.padding = '8px 0';
      actions.appendChild(disconnect);
    }

    const gamePage = (document.body && document.body.dataset && document.body.dataset.gamePage) || '';
    const supportsHistory = gamePage === 'poker-table' || gamePage === 'blackjack';
    const supportsName = supportsHistory;

    const applyButtonStyles = (btn) => {
      if (!btn.classList.contains('wi-modal-action')) {
        btn.classList.add('wi-modal-action');
      }
    };

    const ensureButton = (id, label, handler) => {
      const shouldShow =
        (id === 'wi-open-history' && supportsHistory) ||
        (id === 'wi-change-name' && supportsName);
      if (!shouldShow) {
        const existing = document.getElementById(id);
        if (existing && existing.parentElement === actions) {
          existing.onclick = null;
          existing.remove();
        }
        return null;
      }
      let btn = document.getElementById(id);
      if (!btn || btn.parentElement !== actions) {
        btn = btn && btn.parentElement ? btn : document.createElement('button');
        btn.id = id;
        btn.type = 'button';
        btn.textContent = label;
        applyButtonStyles(btn);
        if (disconnect && disconnect.parentElement === actions) {
          actions.insertBefore(btn, disconnect);
        } else {
          actions.appendChild(btn);
        }
      } else {
        btn.textContent = label;
        applyButtonStyles(btn);
      }
      btn.onclick = handler;
      return btn;
    };

    ensureButton('wi-open-history', 'Recent Hands', () => {
      closeModal();
      try {
        window.dispatchEvent(new CustomEvent(OPEN_HISTORY_EVENT));
      } catch {}
    });

    ensureButton('wi-change-name', 'Change Table Name', () => {
      closeModal();
      try {
        window.dispatchEvent(new CustomEvent(CHANGE_NAME_EVENT));
      } catch {}
    });
    updateBlindsIndicator(blindsLabelCache, gamePage);
  }

  function createModal() {
    let overlay = document.getElementById('wi-chips-modal');
    let dialog;
    if (!overlay) {
      overlay = document.createElement('div'); overlay.id = 'wi-chips-modal';
      overlay.style.position = 'fixed'; overlay.style.inset = '0';
      overlay.style.display = 'none'; overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center'; overlay.style.background = 'rgba(0,0,0,0.65)'; overlay.style.zIndex = '13000';
      dialog = document.createElement('div'); dialog.id = 'wi-wallet-dialog';
      dialog.style.background = 'var(--panel-bg-soft, rgba(24,20,16,0.95))';
      dialog.style.border = '1px solid rgba(255,255,255,0.12)';
      dialog.style.borderRadius = '18px'; dialog.style.padding = '20px';
      dialog.style.width = 'min(92vw, 360px)'; dialog.style.boxShadow = '0 24px 60px rgba(0,0,0,0.6)';
      dialog.style.color = '#f4e6d3'; dialog.style.display = 'flex';
      dialog.style.flexDirection = 'column'; dialog.style.gap = '16px';
      const header = document.createElement('div'); header.style.display = 'flex'; header.style.alignItems = 'center'; header.style.justifyContent = 'space-between'; header.style.gap = '12px';
      const title = document.createElement('h3'); title.textContent = 'DCMon Bankroll'; title.style.margin = '0'; title.style.fontSize = '18px';
      const closeBtn = document.createElement('button'); closeBtn.id = 'wi-chips-close'; closeBtn.textContent = 'Close'; closeBtn.style.padding = '6px 14px'; closeBtn.style.borderRadius = '10px';
      header.appendChild(title); header.appendChild(closeBtn);
      let container = document.getElementById('wi-bankroll');
      if (container) { container.innerHTML = ''; if (container.parentElement) container.parentElement.removeChild(container); }
      else { container = document.createElement('div'); container.id = 'wi-bankroll'; }
      container.style.display = 'flex'; container.style.flexDirection = 'column'; container.style.gap = '12px';
      buildBankrollMarkup(container);
      dialog.appendChild(header); dialog.appendChild(container);
      overlay.appendChild(dialog); document.body.appendChild(overlay);
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
    overlay.style.display = 'flex'; overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden'; document.body.dataset.chipsModalOpen = '1';
    const statusEl = document.getElementById('wi-bank-status'); if (statusEl && !statusEl.textContent) statusEl.textContent = 'Loading bankroll...';
    try { document.dispatchEvent(new CustomEvent('bankroll:ui-ready')); } catch {}
  }

  function closeModal() {
    const overlay = document.getElementById('wi-chips-modal'); if (!overlay) return;
    const trigger = document.getElementById('wi-wallet-btn');
    const active = document.activeElement;
    if (active && overlay.contains(active)) { try { trigger ? trigger.focus() : active.blur(); } catch {} }
    overlay.style.display = 'none'; overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = ''; delete document.body.dataset.chipsModalOpen;
    if (trigger) { trigger.classList.remove('active'); trigger.setAttribute('aria-expanded', 'false'); }
  }

  function init() {
    try { if (!window.openWalletChipsModal) window.openWalletChipsModal = openModal; } catch {}
    cleanupLegacyBalanceBadges();
    updateBlindsIndicator(blindsLabelCache);
    const pill = document.getElementById('wallet-inline');
    if (pill && !document.getElementById('wi-wallet-btn')) {
      const btn = document.createElement('button'); btn.id = 'wi-wallet-btn'; btn.type = 'button'; btn.textContent = 'Wallet';
      btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => { if (document.body.dataset.chipsModalOpen) { closeModal(); } else { openModal(); } });
      pill.appendChild(btn);
    }
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && document.body.dataset.chipsModalOpen) closeModal(); });
    createModal();
    window.addEventListener(BLINDS_EVENT, (ev) => {
      try {
        const label = ev && ev.detail && typeof ev.detail.label === 'string' ? ev.detail.label : '';
        updateBlindsIndicator(label, getGamePage());
      } catch {}
    });

    // Gasless indicator: flip the pill address background when gasless is active
    try {
      const addrEl = document.getElementById('wi-address');
      function mark(on) {
        try { (pill||document.getElementById('wallet-inline'))?.classList.toggle('gasless-on', !!on); } catch {}
      }
      window.addEventListener('aa:sponsored', (e) => { try { mark(!!(e && e.detail && e.detail.active)); } catch {} });
      window.addEventListener('aa:gasless',  () => { try { mark(true); } catch {} });
      try { mark(!!((window.AA && window.AA.sponsored) || window.FORCE_GASLESS)); } catch {}
    } catch {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

