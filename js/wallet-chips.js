// js/wallet-chips.js
// Injects a Chips button into the wallet pill and opens a bankroll modal on demand.
(function () {
  if (window.__WalletChipsMounted) return;
  window.__WalletChipsMounted = true;

  const MODAL_ID = 'wi-chips-modal';
  const BUTTON_ID = 'wi-chips-btn';

  function createModal() {
    if (document.getElementById(MODAL_ID)) {
      document.dispatchEvent(new CustomEvent('bankroll:ui-ready'));
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0,0,0,0.65)';
    overlay.style.zIndex = '13000';

    const dialog = document.createElement('div');
    dialog.style.background = 'var(--panel-bg-soft, rgba(24,20,16,0.96))';
    dialog.style.border = '1px solid rgba(255,255,255,0.12)';
    dialog.style.borderRadius = '16px';
    dialog.style.padding = '20px';
    dialog.style.width = 'min(92vw, 360px)';
    dialog.style.boxShadow = '0 24px 60px rgba(0,0,0,0.6)';
    dialog.style.color = '#f4e6d3';
    dialog.style.display = 'flex';
    dialog.style.flexDirection = 'column';
    dialog.style.gap = '14px';

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
    closeBtn.textContent = 'Close';
    closeBtn.id = 'wi-chips-close';
    closeBtn.style.padding = '6px 10px';
    closeBtn.style.borderRadius = '8px';

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '10px';

    const bankroll = document.createElement('div');
    bankroll.id = 'wi-bankroll';
    bankroll.style.display = 'flex';
    bankroll.style.flexDirection = 'column';
    bankroll.style.gap = '8px';

    const balanceRow = document.createElement('div');
    balanceRow.style.display = 'flex';
    balanceRow.style.justifyContent = 'space-between';
    balanceRow.style.alignItems = 'center';
    balanceRow.style.fontSize = '13px';

    const balanceLabel = document.createElement('span');
    balanceLabel.textContent = 'DCMon Balance';
    const balanceValue = document.createElement('span');
    balanceValue.id = 'wi-dcmon-balance';
    balanceValue.textContent = '-';

    balanceRow.appendChild(balanceLabel);
    balanceRow.appendChild(balanceValue);

    const buyRow = document.createElement('div');
    buyRow.style.display = 'flex';
    buyRow.style.gap = '8px';

    const buyInput = document.createElement('input');
    buyInput.id = 'wi-buy-input';
    buyInput.type = 'number';
    buyInput.min = '0';
    buyInput.step = '0.01';
    buyInput.placeholder = 'Amount';
    buyInput.style.flex = '1';
    buyInput.style.padding = '6px';
    buyInput.style.borderRadius = '8px';

    const buyBtn = document.createElement('button');
    buyBtn.id = 'wi-buy-btn';
    buyBtn.textContent = 'Buy In';
    buyBtn.style.padding = '6px 10px';
    buyBtn.style.borderRadius = '8px';

    buyRow.appendChild(buyInput);
    buyRow.appendChild(buyBtn);

    const cashRow = document.createElement('div');
    cashRow.style.display = 'flex';
    cashRow.style.gap = '8px';

    const cashInput = document.createElement('input');
    cashInput.id = 'wi-cash-input';
    cashInput.type = 'number';
    cashInput.min = '0';
    cashInput.step = '0.01';
    cashInput.placeholder = 'Amount';
    cashInput.style.flex = '1';
    cashInput.style.padding = '6px';
    cashInput.style.borderRadius = '8px';

    const cashBtn = document.createElement('button');
    cashBtn.id = 'wi-cash-btn';
    cashBtn.textContent = 'Cash Out';
    cashBtn.style.padding = '6px 10px';
    cashBtn.style.borderRadius = '8px';

    cashRow.appendChild(cashInput);
    cashRow.appendChild(cashBtn);

    const status = document.createElement('div');
    status.id = 'wi-bank-status';
    status.style.minHeight = '18px';
    status.style.fontSize = '12px';

    bankroll.appendChild(balanceRow);
    bankroll.appendChild(buyRow);
    bankroll.appendChild(cashRow);
    bankroll.appendChild(status);

    body.appendChild(bankroll);

    dialog.appendChild(header);
    dialog.appendChild(body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    document.dispatchEvent(new CustomEvent('bankroll:ui-ready'));

    return { overlay, closeBtn, dialog };
  }

  function openModal(overlay) {
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.dataset.chipsModalOpen = '1';
    document.body.style.overflow = 'hidden';
    if (window.__PokerBankroll?.refreshBalance) {
      window.__PokerBankroll.refreshBalance();
    }
  }

  function closeModal(overlay) {
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    delete document.body.dataset.chipsModalOpen;
  }

  function mount() {
    const wallet = document.getElementById('wallet-inline');
    if (!wallet || document.getElementById(BUTTON_ID)) return;

    const { overlay, closeBtn, dialog } = createModal() || {};

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.textContent = 'Chips';
    btn.style.padding = '6px 10px';
    btn.style.borderRadius = '8px';
    wallet.appendChild(btn);

    function show() {
      const modal = document.getElementById(MODAL_ID) || overlay;
      if (!modal) return;
      openModal(modal);
    }

    function hide() {
      const modal = document.getElementById(MODAL_ID) || overlay;
      if (!modal) return;
      closeModal(modal);
    }

    btn.addEventListener('click', show);
    if (closeBtn) closeBtn.addEventListener('click', hide);
    if (overlay) {
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) hide();
      });
    }
    if (dialog) {
      dialog.addEventListener('click', (ev) => ev.stopPropagation());
    }

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && document.body.dataset.chipsModalOpen) {
        hide();
      }
    });

    document.addEventListener('bankroll:ready', (ev) => {
      if (document.body.dataset.chipsModalOpen && ev?.detail?.ok) {
        setTimeout(() => window.__PokerBankroll?.refreshBalance(), 150);
      }
    });
  }

  function init() {
    mount();
    document.dispatchEvent(new CustomEvent('bankroll:ui-ready'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
