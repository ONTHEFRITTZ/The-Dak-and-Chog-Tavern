// js/bankroll.js
// Global DCMon/MON bankroll helper shared across Tavern experiences.
(function () {
  if (window.Bankroll && window.Bankroll.__isGlobalBankroll) {
    window.__PokerBankroll = window.Bankroll;
    return;
  }
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
  try {
    if (!Array.isArray(window.DCMonABI)) window.DCMonABI = FALLBACK_DCMON_ABI;
  } catch {}
  try {
    if (!Array.isArray(window.WMONABI) && !Array.isArray(window.WMON_ABI)) {
      window.WMONABI = FALLBACK_WMON_ABI;
      window.WMON_ABI = FALLBACK_WMON_ABI;
    } else if (!Array.isArray(window.WMONABI) && Array.isArray(window.WMON_ABI)) {
      window.WMONABI = window.WMON_ABI;
    }
  } catch {}
  try {
    window.__BANKROLL_FALLBACK_ABIS__ = {
      dcmon: FALLBACK_DCMON_ABI,
      wmon: FALLBACK_WMON_ABI
    };
  } catch {}
  let bootstrapped = false;
  let abisPromise = null;
  function hasAbis() {
    return Array.isArray(window.DCMonABI) && (Array.isArray(window.WMONABI) || Array.isArray(window.WMON_ABI));
  }



  function waitForAbis(timeout = 9000) {
    if (hasAbis()) return Promise.resolve(true);
    if (!abisPromise) {
      abisPromise = new Promise((resolve) => {
        const deadline = Date.now() + timeout;
        let poller = null;

        function cleanup() {
          if (poller) {
            clearInterval(poller);
            poller = null;
          }
          document.removeEventListener('wallet:abis-ready', onReady);
        }

        function onReady() {
          cleanup();
          abisPromise = null;
          resolve(true);
        }

        poller = setInterval(() => {
          if (hasAbis()) { 
            onReady();
            return;
          }
          if (Date.now() > deadline) {
            cleanup();
            abisPromise = null;
            resolve(false);
          }
        }, 50);

        document.addEventListener('wallet:abis-ready', onReady);
      });
    }
    return abisPromise;
  }

  function bootstrap() {
    if (bootstrapped) return;
    bootstrapped = true;
  
    const ethers = window.ethers;
    const state = {
      lastStatus: null,
      statusTargets: new Set(['wi-bank-status'])
    };
  
    const balanceTargets = {
      dcmon: new Set(['wi-dcmon-balance', 'wi-dcmon-balance-pill']),
      mon: new Set(['wi-mon-balance-modal', 'wi-mon-balance-pill'])
    };
  
    const controlTargets = {
      buyInputs: new Set(['wi-buy-input']),
      buyButtons: new Set(['wi-buy-btn']),
      cashInputs: new Set(['wi-cash-input']),
      cashButtons: new Set(['wi-cash-btn'])
    };
  
    function getEl(id) {
      if (!id) return null;
      try {
        return document.getElementById(id);
      } catch {
        return null;
      }
    }
  
    function updateTargetSet(targetSet, value) {
      targetSet.forEach((id) => {
        const el = getEl(id);
        if (el) el.textContent = value;
      });
    }
  
    function registerToSet(targetSet, ids) {
      if (!ids) return;
      const list = Array.isArray(ids) ? ids : [ids];
      list.forEach((id) => {
        if (typeof id === 'string' && id.trim()) targetSet.add(id.trim());
      });
    }
  
    function setStatus(message, tone) {
      state.lastStatus = { message: message || '', tone: tone || '' };
      const palette = { error: '#ff9a9a', success: '#9ef89e', info: '#d7d7d7' };
      state.statusTargets.forEach((id) => {
        const el = getEl(id);
        if (!el) return;
        el.textContent = message || '';
        if (!message) return;
        el.style.color = palette[tone] || palette.info;
      });
    }
  
    function sanitizeAmount(value, fallback) {
      if (ethers?.BigNumber?.isBigNumber && ethers.BigNumber.isBigNumber(value)) {
        return value;
      }
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = parseFloat(value.trim());
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
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
      try {
        if (typeof window.__getSelectedProvider === 'function') injected = window.__getSelectedProvider();
      } catch {}
      if (!injected && window.ethereum) injected = window.ethereum;
      if (!injected && window.phantom?.ethereum) injected = window.phantom.ethereum;
      if (!injected) return null;
      try {
        providerCache = new ethers.providers.Web3Provider(injected, 'any');
        return providerCache;
      } catch (err) {
        console.error('bankroll: provider init failed', err);
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
        console.warn('bankroll: signer unavailable', err);
        signerCache = null;
        return null;
      }
    }
  
    let configModulePromise = null;
    async function loadConfigModule() {
      if (!configModulePromise) {
        configModulePromise = import('./config.js').catch((err) => {
          console.error('bankroll: config import failed', err);
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
      let dcmonAbi = Array.isArray(window.DCMonABI) ? window.DCMonABI : null;
      let wmonAbi = Array.isArray(window.WMONABI) ? window.WMONABI : (Array.isArray(window.WMON_ABI) ? window.WMON_ABI : null);
      if (!dcmonAbi || !wmonAbi) {
        const abisOk = await waitForAbis();
        dcmonAbi = Array.isArray(window.DCMonABI) ? window.DCMonABI : null;
        wmonAbi = Array.isArray(window.WMONABI) ? window.WMONABI : (Array.isArray(window.WMON_ABI) ? window.WMON_ABI : null);
        if (!abisOk || !dcmonAbi || !wmonAbi) {
          setStatus('Token ABIs unavailable.', 'error');
          return false;
        }
      }
      if (!Array.isArray(window.WMONABI) && Array.isArray(window.WMON_ABI)) {
        window.WMONABI = window.WMON_ABI;
      }
      if (!dcmonRead || !dcmonWrite) {
        dcmonRead = new ethers.Contract(dcmonAddress, dcmonAbi, provider);
        dcmonWrite = dcmonRead.connect(signer);
      }
      if (!wmonRead || !wmonWrite) {
        wmonRead = new ethers.Contract(wmonAddress, wmonAbi, provider);
        wmonWrite = wmonRead.connect(signer);
      }
      return true;
    }
  
    function formatEther(bn) {
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
      const address = addr || currentAddress();
      if (!address) {
        updateTargetSet(balanceTargets.dcmon, '-');
        updateTargetSet(balanceTargets.mon, '-');
        return null;
      }
      const ok = await ensureContracts();
      if (!ok) {
        updateTargetSet(balanceTargets.dcmon, '-');
        updateTargetSet(balanceTargets.mon, '-');
        return null;
      }
      try {
        const bal = await dcmonRead.balanceOf(address);
        updateTargetSet(balanceTargets.dcmon, formatEther(bal));
      } catch (err) {
        console.error('bankroll: DCMon balance failed', err);
        updateTargetSet(balanceTargets.dcmon, '-');
      }
      try {
        const provider = await getProvider();
        if (provider) {
          const monWei = await provider.getBalance(address);
          updateTargetSet(balanceTargets.mon, formatEther(monWei));
        }
      } catch (err) {
        console.error('bankroll: MON balance failed', err);
        updateTargetSet(balanceTargets.mon, '-');
      }
      return true;
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
  
    function resolveInputValue(targetSet) {
      for (const id of targetSet) {
        const el = getEl(id);
        if (el && typeof el.value !== 'undefined') {
          return el.value;
        }
      }
      return null;
    }
  
    function clearInput(targetSet) {
      targetSet.forEach((id) => {
        const el = getEl(id);
        if (el && typeof el.value !== 'undefined') el.value = '';
      });
    }
  
    function parseAmountToWei(amount) {
      if (!ethers?.utils?.parseEther) return null;
      if (ethers.BigNumber.isBigNumber(amount)) return amount;
      const parsed = sanitizeAmount(amount, null);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      try {
        return ethers.utils.parseEther(String(parsed));
      } catch {
        return null;
      }
    }
  
    async function buyIn(amountOverride) {
      setStatus('');
      if (!await ensureContracts()) return;
  
      let amountWei = parseAmountToWei(amountOverride);
      if (!amountWei) {
        const fromInput = resolveInputValue(controlTargets.buyInputs);
        amountWei = parseAmountToWei(fromInput ?? undefined);
      }
      if (!amountWei) {
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
        clearInput(controlTargets.buyInputs);
        setStatus('Buy-in complete.', 'success');
        await refreshBalance(addr);
      } catch (err) {
        console.error('bankroll: buy-in failed', err);
        const msg = err?.error?.message || err?.data?.message || err?.reason || err?.message || 'Buy-in failed.';
        setStatus(msg, 'error');
      }
    }
  
    async function cashOut(amountOverride) {
      setStatus('');
      if (!await ensureContracts()) return;
  
      let amountWei = parseAmountToWei(amountOverride);
      if (!amountWei) {
        const fromInput = resolveInputValue(controlTargets.cashInputs);
        amountWei = parseAmountToWei(fromInput ?? undefined);
      }
      if (!amountWei) {
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
        clearInput(controlTargets.cashInputs);
        setStatus('Cash-out complete.', 'success');
        await refreshBalance(addr);
      } catch (err) {
        console.error('bankroll: cash-out failed', err);
        const msg = err?.error?.message || err?.data?.message || err?.reason || err?.message || 'Cash-out failed.';
        setStatus(msg, 'error');
      }
    }
  
    function bindClick(el, handler) {
      if (!el || el.dataset.bankrollBound) return;
      el.dataset.bankrollBound = '1';
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        handler();
      });
    }
  
    function bindKey(el, handler) {
      if (!el || el.dataset.bankrollBound) return;
      el.dataset.bankrollBound = '1';
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          handler();
        }
      });
    }
  
    function bindUi() {
      controlTargets.buyButtons.forEach((id) => bindClick(getEl(id), () => buyIn()));
      controlTargets.cashButtons.forEach((id) => bindClick(getEl(id), () => cashOut()));
      controlTargets.buyInputs.forEach((id) => bindKey(getEl(id), () => buyIn()));
      controlTargets.cashInputs.forEach((id) => bindKey(getEl(id), () => cashOut()));
    }
  
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
  
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindUi);
    } else {
      bindUi();
    }
  
    const api = {
      __isGlobalBankroll: true,
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
      buyIn,
      cashOut,
      getLastStatus: () => state.lastStatus,
      registerBalanceTargets: (token, ids) => {
        if (token === 'mon') registerToSet(balanceTargets.mon, ids);
        else if (token === 'dcmon') registerToSet(balanceTargets.dcmon, ids);
      },
      registerStatusTarget: (ids) => registerToSet(state.statusTargets, ids),
      registerControls: (type, ids) => {
        if (type === 'buy-input') registerToSet(controlTargets.buyInputs, ids);
        else if (type === 'buy-button') registerToSet(controlTargets.buyButtons, ids);
        else if (type === 'cash-input') registerToSet(controlTargets.cashInputs, ids);
        else if (type === 'cash-button') registerToSet(controlTargets.cashButtons, ids);
        bindUi();
      }
    };
  
    window.Bankroll = api;
    window.__PokerBankroll = api;
  
    document.dispatchEvent(new CustomEvent('bankroll:ready', { detail: { ok: !!ethers } }));
  }

  if (window.ethers) {
    bootstrap();
    return;
  }

  const start = Date.now();
  const maxDelay = 9000;
  let timer = null;

  function cleanup() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    document.removeEventListener('wallet:ethers-ready', handleReady);
  }

  function handleReady() {
    cleanup();
    bootstrap();
  }

  timer = setInterval(() => {
    if (window.ethers) {
      cleanup();
      bootstrap();
    } else if (Date.now() - start > maxDelay) {
      cleanup();
      console.warn('bankroll: ethers runtime missing after wait; continuing without provider');
      bootstrap();
    }
  }, 50);

  document.addEventListener('wallet:ethers-ready', handleReady);
})();
