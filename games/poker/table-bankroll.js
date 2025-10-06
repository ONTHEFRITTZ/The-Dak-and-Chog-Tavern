// games/poker/table-bankroll.js
// Adds DCMon buy-in and cash-out helpers inside the wallet pill without altering layout.
(function () {
  const mode = (document.documentElement.getAttribute('data-table-mode') || 'f2p').toLowerCase();
  const section = document.getElementById('wi-bankroll');
  if (!section) { window.__PokerBankroll = null; return; }

  if (mode !== 'onchain') {
    window.__PokerBankroll = null;
    section.style.display = 'none';
    return;
  }

  const ethers = window.ethers;
  if (!ethers) {
    window.__PokerBankroll = null;
    section.style.display = 'none';
    console.error('Ethers.js not available; poker bankroll helpers disabled');
    return;
  }

  section.style.display = section.style.display || 'flex';
  section.style.flexDirection = section.style.flexDirection || 'column';
  section.style.gap = section.style.gap || '6px';

  const balanceEl = document.getElementById('wi-dcmon-balance');
  const buyInput = document.getElementById('wi-buy-input');
  const buyBtn = document.getElementById('wi-buy-btn');
  const cashInput = document.getElementById('wi-cash-input');
  const cashBtn = document.getElementById('wi-cash-btn');
  const statusEl = document.getElementById('wi-bank-status');

  const { utils, BigNumber } = ethers;

  let providerCache = null;
  let signerCache = null;
  let configModulePromise = null;
  let dcmonAddress = null;
  let wmonAddress = null;
  let dcmonRead = null;
  let dcmonWrite = null;
  let wmonRead = null;
  let wmonWrite = null;

  function setStatus(message, tone) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    if (!message) return;
    const palette = {
      error: '#ff9a9a',
      success: '#9ef89e',
      info: '#d7d7d7'
    };
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
    try {
      const pill = document.getElementById('wi-address');
      const txt = (pill?.textContent || '').trim();
      if (/^0x[0-9a-fA-F]{40}$/i.test(txt)) return txt;
    } catch {}
    try {
      if (window.__ADDR && /^0x[0-9a-fA-F]{40}$/i.test(String(window.__ADDR))) return String(window.__ADDR);
    } catch {}
    return '';
  }

  async function getProvider() {
    if (providerCache) return providerCache;
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

  async function ensureContracts() {
    const provider = await getProvider();
    const signer = await getSigner();
    if (!provider || !signer) {
      setStatus('Connect wallet first.', 'error');
      return false;
    }

    if (!dcmonAddress) dcmonAddress = await resolveAddress('dcmon', provider);
    if (!wmonAddress) wmonAddress = await resolveAddress('wmon', provider);

    if (!dcmonAddress || !wmonAddress) {
      setStatus('DCMon contracts not configured.', 'error');
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
      const val = parseFloat(utils.formatEther(bn));
      if (!Number.isFinite(val)) return '-';
      if (val >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (val >= 1) return val.toFixed(3).replace(/\.0+$/, '').replace(/(\..*?)0+$/, '');
      return val.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
    } catch {
      return '-';
    }
  }

  async function refreshBalance(addr) {
    if (!balanceEl) return;
    const address = addr || currentAddress();
    if (!address) {
      balanceEl.textContent = '-';
      return;
    }
    try {
      const ok = await ensureContracts();
      if (!ok) { balanceEl.textContent = '-'; return; }
      const bal = await dcmonRead.balanceOf(address);
      balanceEl.textContent = formatBalance(bal);
    } catch (err) {
      console.error('Poker bankroll: balance refresh failed', err);
      balanceEl.textContent = '-';
    }
  }

  async function ensureWrap(amountWei, address) {
    if (!wmonRead || !wmonWrite) return false;
    const current = await wmonRead.balanceOf(address);
    if (current.gte(amountWei)) return true;
    const deficit = amountWei.sub(current);
    if (deficit.lte(BigNumber.from(0))) return true;
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
    const target = spender || await resolveAddress('pokerTable', await getProvider());
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

    const amountValue = sanitizeAmount(buyInput?.value, 1);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setStatus('Enter a valid buy-in amount.', 'error');
      return;
    }

    let amountWei;
    try {
      amountWei = utils.parseEther(String(amountValue));
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

    const amountValue = sanitizeAmount(cashInput?.value, null);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setStatus('Enter a valid cash-out amount.', 'error');
      return;
    }

    let amountWei;
    try {
      amountWei = utils.parseEther(String(amountValue));
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

  if (buyBtn) {
    buyBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      handleBuyIn();
    });
  }
  if (buyInput) {
    buyInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        handleBuyIn();
      }
    });
  }

  if (cashBtn) {
    cashBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      handleCashOut();
    });
  }
  if (cashInput) {
    cashInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        handleCashOut();
      }
    });
  }

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
    cashOut: handleCashOut
  };

  refreshBalance();
  setInterval(refreshBalance, 30000);
})();
