// games/poker/table-bankroll.js
// Provides DCMon buy-in / cash-out helpers and exposes them via window.__PokerBankroll.
(function () {
  const ethers = window.ethers;
  const state = { lastStatus: null };

  function getEl(id) {
    return document.getElementById(id);
  }

  function ensureBankrollContainer() {
    if (document.getElementById('wi-bankroll')) return;
    const wrapper = document.createElement('div');
    wrapper.id = 'wi-bankroll';
    wrapper.style.display = 'none';
    document.body.appendChild(wrapper);
  }

  ensureBankrollContainer();

  function setStatus(message, tone) {
    state.lastStatus = { message: message || '', tone: tone || '' };
    const statusEl = getEl('wi-bank-status');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    if (!message) return;
    const palette = { error: '#ff9a9a', success: '#9ef89e', info: '#d7d7d7' };
    statusEl.style.color = palette[tone] || palette.info;
  }

  function sanitizeAmount(value, fallback) {
    const num = parseFloat(String(value || '').trim());
    if (Number.isFinite(num) && num > 0) return num;
    return fallback;
  }

  function storedAddress() {
    try {
      const direct = sessionStorage.getItem('walletAddress') || localStorage.getItem('walletAddress');
      if (direct && /^0x[0-9a-fA-F]{40}$/i.test(direct)) return direct;
    } catch {}
    try {
      const msg = sessionStorage.getItem('walletMsg') || localStorage.getItem('walletMsg') || '';
      const match = msg.match(/Address:\s*(0x[0-9a-fA-F]{40})/i);
      if (match && match[1]) return match[1];
    } catch {}
    return '';
  }

  function currentAddress() {
    const stored = storedAddress();
    if (stored) return stored;
    const pill = getEl('wi-address');
    const txt = (pill?.textContent || '').trim();
    if (/^0x[0-9a-fA-F]{40}$/i.test(txt)) return txt;
    if (window.__ADDR && /^0x[0-9a-fA-F]{40}$/i.test(String(window.__ADDR))) return String(window.__ADDR);
    return '';
  }

  let providerCache = null;
  async function getProvider() {
    if (providerCache) return providerCache;
    if (!ethers?.providers) return null;
    let injected = null;
    try { if (typeof window.__getSelectedProvider === 'function') injected = window.__getSelectedProvider(); } catch {}
    if (!injected && window.ethereum) injected = window.ethereum;
    if (!injected && window.phantom?.ethereum) injected = window.phantom.ethereum;
    if (!injected) return null;
    try {
      providerCache = new ethers.providers.Web3Provider(injected, 'any');
      return providerCache;
    } catch (err) {
      console.error('Poker bankroll: provider init failed', err);
      return null;
    }
  }

  let signerCache = null;
  async function getSigner() {
    if (signerCache) return signerCache;
    const provider = await getProvider();
    if (!provider) return null;
    try {
      signerCache = provider.getSigner();
      await signerCache.getAddress();
      return signerCache;
    } catch (err) {
      console.warn('Poker bankroll: signer unavailable', err);
      signerCache = null;
      return null;
    }
  }

  let configModulePromise = null;
  async function loadConfigModule() {
    if (!configModulePromise) {
      configModulePromise = import('../../js/config.js').catch((err) => {
        console.error('Poker bankroll: config import failed', err);
        return null;
      });
    }
    return configModulePromise;
  }

  async function resolveAddress(key, provider) {
    const mod = await loadConfigModule();
    if (mod?.getAddressFor) {
      try {
        const addr = await mod.getAddressFor(key, provider).catch(() => null);
        if (addr) return addr;
      } catch {}
    }
    if (mod?.CONTRACTS?.[key]) return mod.CONTRACTS[key];
    if (window.CONTRACTS?.[key]) return window.CONTRACTS[key];
    return null;
  }

  let dcmonAddress = null;
  let wmonAddress = null;
  let dcmonRead = null;
  let dcmonWrite = null;
  let wmonRead = null;
  let wmonWrite = null;

  async function ensureContracts() {
    if (!ethers) {
      setStatus('Wallet runtime unavailable.', 'error');
      return false;
    }
    const provider = await getProvider();
    const signer = await getSigner();
    if (!provider || !signer) {
      setStatus('Connect wallet first.', 'error');
      return false;
    }
    if (!dcmonAddress) dcmonAddress = await resolveAddress('dcmon', provider);
    if (!wmonAddress) wmonAddress = await resolveAddress('wmon', provider);
    if (!dcmonAddress || !wmonAddress) {
      setStatus('Bankroll contracts not configured.', 'error');
      return false;
    }
    if (!window.DCMonABI || !window.WMONABI) {
      setStatus('Token ABIs unavailable.', 'error');
      return false;
    }
    if (!dcmonRead || !dcmonWrite) {
      dcmonRead = new ethers.Contract(dcmonAddress, window.DCMonABI, provider);
      dcmonWrite = dcmonRead.connect(signer);
    }
    if (!wmonRead || !wmonWrite) {
      wmonRead = new ethers.Contract(wmonAddress, window.WMONABI, provider);
      wmonWrite = wmonRead.connect(signer);
    }
    return true;
  }

  function formatBalance(bn) {
    try {
      const val = parseFloat(ethers.utils.formatEther(bn));
      if (!Number.isFinite(val)) return '-';
      if (val >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (val >= 1) return val.toFixed(3).replace(/\.0+$/, '').replace(/(\..*?)0+$/, '');
      return val.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
    } catch {
      return '-';
    }
  }

  async function refreshBalance(addr) {
    const balanceEl = getEl('wi-dcmon-balance');
    const address = addr || currentAddress();
    if (!balanceEl) return null;
    if (!address) {
      balanceEl.textContent = '-';
      return null;
    }
    if (!await ensureContracts()) {
      balanceEl.textContent = '-';
      return null;
    }
    try {
      const bal = await dcmonRead.balanceOf(address);
      balanceEl.textContent = formatBalance(bal);
      return bal;
    } catch (err) {
      console.error('Poker bankroll: balance refresh failed', err);
      balanceEl.textContent = '-';
      return null;
    }
  }

  async function ensureWrap(amountWei, address) {
    if (!wmonRead || !wmonWrite) return false;
    const current = await wmonRead.balanceOf(address);
    if (current.gte(amountWei)) return true;
    const deficit = amountWei.sub(current);
    if (deficit.lte(ethers.BigNumber.from(0))) return true;
    setStatus('Wrapping MON...', 'info');
    const tx = await wmonWrite.deposit({ value: deficit });
    await tx.wait();
    return true;
  }

  async function ensureWmonAllowance(amountWei, address) {
    const allowance = await wmonRead.allowance(address, dcmonAddress);
    if (allowance.gte(amountWei)) return true;
    setStatus('Approving WMON...', 'info');
    const tx = await wmonWrite.approve(dcmonAddress, ethers.constants.MaxUint256);
    await tx.wait();
    return true;
  }

  async function ensureDcmonAllowance(amountWei, address, spender) {
    const target = spender || dcmonAddress;
    if (!target) return false;
    const allowance = await dcmonRead.allowance(address, target);
    if (allowance.gte(amountWei)) return true;
    setStatus('Approving DCMon...', 'info');
    const tx = await dcmonWrite.approve(target, ethers.constants.MaxUint256);
    await tx.wait();
    return true;
  }

  async function handleBuyIn() {
    setStatus('');
    if (!await ensureContracts()) return;

    const buyInput = getEl('wi-buy-input');
    const amountValue = sanitizeAmount(buyInput?.value, 1);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setStatus('Enter a valid buy-in amount.', 'error');
      return;
    }

    let amountWei;
    try {
      amountWei = ethers.utils.parseEther(String(amountValue));
    } catch {
      setStatus('Enter a valid buy-in amount.', 'error');
      return;
    }

    const addr = currentAddress();
    if (!addr) {
      setStatus('Connect wallet first.', 'error');
      return;
    }

    try {
      await ensureWrap(amountWei, addr);
      await ensureWmonAllowance(amountWei, addr);
      setStatus('Minting DCMon...', 'info');
      const tx = await dcmonWrite.deposit(amountWei, addr);
      await tx.wait();
      if (buyInput) buyInput.value = '';
      setStatus('Buy-in complete.', 'success');
      await refreshBalance(addr);
    } catch (err) {
      console.error('Poker bankroll: buy-in failed', err);
      const msg = err?.error?.message || err?.data?.message || err?.reason || err?.message || 'Buy-in failed.';
      setStatus(msg, 'error');
    }
  }

  async function handleCashOut() {
    setStatus('');
    if (!await ensureContracts()) return;

    const cashInput = getEl('wi-cash-input');
    const amountValue = sanitizeAmount(cashInput?.value, null);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setStatus('Enter a valid cash-out amount.', 'error');
      return;
    }

    let amountWei;
    try {
      amountWei = ethers.utils.parseEther(String(amountValue));
    } catch {
      setStatus('Enter a valid cash-out amount.', 'error');
      return;
    }

    const addr = currentAddress();
    if (!addr) {
      setStatus('Connect wallet first.', 'error');
      return;
    }

    try {
      setStatus('Redeeming DCMon...', 'info');
      const tx = await dcmonWrite.redeem(amountWei, addr);
      await tx.wait();
      if (wmonWrite) {
        setStatus('Unwrapping MON...', 'info');
        const unwrapTx = await wmonWrite.withdraw(amountWei);
        await unwrapTx.wait();
      }
      if (cashInput) cashInput.value = '';
      setStatus('Cash-out complete.', 'success');
      await refreshBalance(addr);
    } catch (err) {
      console.error('Poker bankroll: cash-out failed', err);
      const msg = err?.error?.message || err?.data?.message || err?.reason || err?.message || 'Cash-out failed.';
      setStatus(msg, 'error');
    }
  }

  function bindUi() {
    const buyBtn = getEl('wi-buy-btn');
    if (buyBtn && !buyBtn.dataset.bankrollBound) {
      buyBtn.dataset.bankrollBound = '1';
      buyBtn.addEventListener('click', (ev) => { ev.preventDefault(); handleBuyIn(); });
    }
    const buyInput = getEl('wi-buy-input');
    if (buyInput && !buyInput.dataset.bankrollBound) {
      buyInput.dataset.bankrollBound = '1';
      buyInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          handleBuyIn();
        }
      });
    }
    const cashBtn = getEl('wi-cash-btn');
    if (cashBtn && !cashBtn.dataset.bankrollBound) {
      cashBtn.dataset.bankrollBound = '1';
      cashBtn.addEventListener('click', (ev) => { ev.preventDefault(); handleCashOut(); });
    }
    const cashInput = getEl('wi-cash-input');
    if (cashInput && !cashInput.dataset.bankrollBound) {
      cashInput.dataset.bankrollBound = '1';
      cashInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          handleCashOut();
        }
      });
    }
  }

  bindUi();
  document.addEventListener('bankroll:ui-ready', () => {
    bindUi();
    setTimeout(() => refreshBalance(), 200);
  });

  window.addEventListener('wallet:connected', (ev) => {
    const addr = ev?.detail?.address;
    setTimeout(() => refreshBalance(addr), 250);
  });
  window.addEventListener('storage', (ev) => {
    if (!ev) return;
    if (ev.key && ev.key.toLowerCase().includes('wallet')) {
      setTimeout(() => refreshBalance(), 250);
    }
  });

  window.__PokerBankroll = {
    ready: async () => ensureContracts(),
    refreshBalance,
    ensureContracts,
    getProvider,
    getSigner,
    getAddresses: () => ({ dcmon: dcmonAddress, wmon: wmonAddress }),
    getContracts: () => ({ dcmonRead, dcmonWrite, wmonRead, wmonWrite }),
    ensureWrap,
    ensureWmonAllowance,
    ensureDcmonAllowance,
    buyIn: handleBuyIn,
    cashOut: handleCashOut,
    getLastStatus: () => state.lastStatus
  };

  document.dispatchEvent(new CustomEvent('bankroll:ready', { detail: { ok: !!ethers } }));

  if (ethers) {
    refreshBalance();
    setInterval(refreshBalance, 30000);
  }
})();
