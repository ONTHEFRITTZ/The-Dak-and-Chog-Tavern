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
    'function transfer(address to, uint256 amount) returns (bool)',
    'function exchangeRate() view returns (uint256 numerator, uint256 denominator)',
    'function previewDeposit(uint256 amountUnderlying) view returns (uint256 mintedShares)',
    'function previewRedeem(uint256 shares) view returns (uint256 amountUnderlying)',
    'function totalUnderlying() view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function underlying() view returns (address)',
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
  const SMART_ACCOUNT_KEY_PREFIX = 'aa:toolkit:account:';
  const HEX40 = /^0x[0-9a-fA-F]{40}$/i;
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

  function createEthersCompat(ethers) {
    const hasRuntime = !!ethers;
    const hasBigNumber = !!ethers?.BigNumber?.isBigNumber;
    const BigNumberCtor = hasRuntime ? ethers.BigNumber : null;

    function toBigInt(value) {
      if (value == null) return 0n;
      if (value === '') return 0n;
      if (typeof value === 'bigint') return value;
      if (typeof value === 'number') return BigInt(Math.trunc(value));
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return 0n;
        if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed);
        const sign = trimmed.startsWith('-') ? '-' : '';
        const digits = sign ? trimmed.slice(1) : trimmed;
        if (/^[0-9]+$/.test(digits)) return BigInt(trimmed);
      }
      if (hasBigNumber && BigNumberCtor.isBigNumber(value)) {
        try {
          return BigInt(value.toString());
        } catch {}
      }
      if (typeof value === 'object') {
        if (value && typeof value.toString === 'function') {
          try {
            const str = value.toString();
            if (str && str !== '[object Object]') return toBigInt(str);
          } catch {}
        }
        if (value instanceof Uint8Array) {
          let hex = '0x';
          for (let i = 0; i < value.length; i += 1) {
            hex += value[i].toString(16).padStart(2, '0');
          }
          try {
            return BigInt(hex);
          } catch {}
        }
      }
      throw new Error('Unsupported numeric value');
    }

    const numeric = {
      from: (value) => toBigInt(value),
      add: (a, b) => numeric.from(a) + numeric.from(b),
      sub: (a, b) => numeric.from(a) - numeric.from(b),
      mul: (a, b) => numeric.from(a) * numeric.from(b),
      div: (a, b) => {
        const divisor = numeric.from(b);
        if (divisor === 0n) throw new Error('Division by zero');
        return numeric.from(a) / divisor;
      },
      gt: (a, b) => numeric.from(a) > numeric.from(b),
      gte: (a, b) => numeric.from(a) >= numeric.from(b),
      lt: (a, b) => numeric.from(a) < numeric.from(b),
      lte: (a, b) => numeric.from(a) <= numeric.from(b),
      eq: (a, b) => numeric.from(a) === numeric.from(b),
      isZero: (value) => numeric.from(value) === 0n,
      clampToZero: (value) => {
        const n = numeric.from(value);
        return n < 0n ? 0n : n;
      },
      toBigNumberish: (value) => {
        const bigIntValue = numeric.from(value);
        if (hasBigNumber) return BigNumberCtor.from(bigIntValue.toString());
        return bigIntValue;
      },
      toString: (value) => numeric.from(value).toString()
    };

    const weiPerEtherRaw = ethers?.constants?.WeiPerEther ?? ethers?.WeiPerEther ?? '1000000000000000000';
    const maxUintRaw = ethers?.constants?.MaxUint256 ?? ethers?.MaxUint256 ?? '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    const constants = {
      WeiPerEther: numeric.from(weiPerEtherRaw),
      MaxUint256: numeric.from(maxUintRaw)
    };

    const formatEtherFn = ethers?.formatEther ?? ethers?.utils?.formatEther ?? null;
    const formatUnitsFn = ethers?.formatUnits ?? ethers?.utils?.formatUnits ?? null;
    const parseEtherFn = ethers?.parseEther ?? ethers?.utils?.parseEther ?? null;
    const parseUnitsFn = ethers?.parseUnits ?? ethers?.utils?.parseUnits ?? null;

    function formatEtherCompat(value) {
      if (!formatEtherFn) return null;
      try {
        return formatEtherFn(numeric.toBigNumberish(value));
      } catch {
        return null;
      }
    }

    function formatUnitsCompat(value, decimals) {
      if (!formatUnitsFn) return null;
      try {
        return formatUnitsFn(numeric.toBigNumberish(value), decimals);
      } catch {
        return null;
      }
    }

    function parseEtherCompat(value) {
      if (!parseEtherFn) return null;
      try {
        const raw = parseEtherFn(String(value));
        return numeric.from(raw);
      } catch {
        return null;
      }
    }

    function parseUnitsCompat(value, decimals) {
      if (!parseUnitsFn) return null;
      try {
        const raw = parseUnitsFn(String(value), decimals);
        return numeric.from(raw);
      } catch {
        return null;
      }
    }

    function createInjectedProvider(injected) {
      if (!ethers) throw new Error('ethers runtime unavailable');
      if (ethers?.providers?.Web3Provider) {
        return new ethers.providers.Web3Provider(injected, 'any');
      }
      if (ethers?.BrowserProvider) {
        return new ethers.BrowserProvider(injected);
      }
      throw new Error('No compatible injected provider');
    }

    async function resolveSigner(provider, index) {
      if (!provider || typeof provider.getSigner !== 'function') return null;
      const signerLike = provider.getSigner(index);
      if (signerLike && typeof signerLike.then === 'function') {
        return signerLike.then((resolved) => resolved);
      }
      return signerLike || null;
    }

    function createJsonRpcProvider(url) {
      if (!ethers) throw new Error('ethers runtime unavailable');
      if (ethers?.providers?.JsonRpcProvider) {
        return new ethers.providers.JsonRpcProvider(url);
      }
      if (typeof ethers?.JsonRpcProvider === 'function') {
        return new ethers.JsonRpcProvider(url);
      }
      throw new Error('No JsonRpcProvider available');
    }

    if (ethers) {
      if (!ethers.utils) ethers.utils = {};
      if (formatEtherFn && !ethers.utils.formatEther) {
        ethers.utils.formatEther = (value) => formatEtherFn(value);
      }
      if (formatUnitsFn && !ethers.utils.formatUnits) {
        ethers.utils.formatUnits = (value, decimals) => formatUnitsFn(value, decimals);
      }
      if (parseEtherFn && !ethers.utils.parseEther) {
        ethers.utils.parseEther = (value) => parseEtherFn(String(value));
      }
      if (parseUnitsFn && !ethers.utils.parseUnits) {
        ethers.utils.parseUnits = (value, decimals) => parseUnitsFn(String(value), decimals);
      }
      if (!ethers.constants) ethers.constants = {};
      if (ethers.constants.WeiPerEther == null) {
        ethers.constants.WeiPerEther = numeric.toBigNumberish(constants.WeiPerEther);
      }
      if (ethers.constants.MaxUint256 == null) {
        ethers.constants.MaxUint256 = numeric.toBigNumberish(constants.MaxUint256);
      }
      if (!ethers.providers) ethers.providers = {};
      if (!ethers.providers.JsonRpcProvider && typeof ethers.JsonRpcProvider === 'function') {
        ethers.providers.JsonRpcProvider = ethers.JsonRpcProvider;
      }
      if (!ethers.providers.Web3Provider && typeof ethers.BrowserProvider === 'function') {
        ethers.providers.Web3Provider = ethers.BrowserProvider;
      }
    }

    return {
      numeric,
      constants,
      formatEther: formatEtherCompat,
      formatUnits: formatUnitsCompat,
      parseEther: parseEtherCompat,
      parseUnits: parseUnitsCompat,
      createInjectedProvider,
      getSigner: resolveSigner,
      createJsonRpcProvider
    };
  }

  function bootstrap() {
    if (bootstrapped) return;
    bootstrapped = true;
  
    const ethers = window.ethers;
    const compat = createEthersCompat(ethers);
    const numeric = compat.numeric;
    const state = {
      lastStatus: null,
      statusTargets: new Set(['wi-bank-status']),
      balances: { eoaDcmonWei: null, eoaMonWei: null, smartDcmonWei: null, smartMonWei: null }
    };

    const balanceTargets = {
      eoaDcmon: new Set(['wi-dcmon-balance-eoa']),
      eoaMon: new Set(['wi-mon-balance-eoa']),
      smartDcmon: new Set(['wi-dcmon-balance-smart']),
      smartMon: new Set(['wi-mon-balance-smart'])
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
  
    function sanitizeAmount(value) {
      if (value == null) return null;
      if (typeof value === 'bigint') {
        return value > 0n ? value : null;
      }
      if (ethers?.BigNumber?.isBigNumber && ethers.BigNumber.isBigNumber(value)) {
        try {
          const big = numeric.from(value);
          return numeric.gt(big, 0n) ? big : null;
        } catch {
          return null;
        }
      }
      if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) return null;
        return value.toString();
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const normalized = trimmed.replace(/,/g, '');
        const parsed = Number(normalized);
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return normalized;
      }
      if (typeof value === 'object' && typeof value.valueOf === 'function' && value.valueOf() !== value) {
        return sanitizeAmount(value.valueOf());
      }
      return null;
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
  
    function normalizeAddress(value) {
      if (!value) return '';
      const str = String(value).trim();
      return HEX40.test(str) ? str : '';
    }

    function storedSmartAccount(chainId) {
      const key = `${SMART_ACCOUNT_KEY_PREFIX}${chainId || ''}`;
      try {
        const val = localStorage.getItem(key) || sessionStorage.getItem(key);
        return normalizeAddress(val);
      } catch {
        return '';
      }
    }

    async function resolveSmartAccountAddress() {
      const prefer = (addr) => {
        const normalized = normalizeAddress(addr);
        return normalized || null;
      };
      try {
        const aaDirect = prefer(window.AA?.smartAccountAddress);
        if (aaDirect) return aaDirect;
      } catch {}
      try {
        const clientAddr = prefer(window.AAClient?.smartAccountAddress);
        if (clientAddr) return clientAddr;
      } catch {}
      try {
        const smartAddr = prefer(window.smartAccount?.address);
        if (smartAddr) return smartAddr;
      } catch {}
      const mon = await loadMonConfig();
      const stored = storedSmartAccount(mon?.id || 0) || storedSmartAccount((window.MONAD && window.MONAD.id) || 0);
      return stored || null;
    }

    let aaClientCache = null;
    let aaClientInitPromise = null;

    async function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitForAAClient(maxAttempts = 20, delayMs = 200) {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (window.AAClient && typeof window.AAClient.sendTransaction === 'function') {
          return window.AAClient;
        }
        await wait(delayMs);
      }
      return null;
    }

    async function ensureAAClient() {
      try {
        if (typeof window.ensureDelegationToolkitReady === 'function') {
          await window.ensureDelegationToolkitReady();
        }
      } catch (err) {
        console.warn('bankroll: ensureDelegationToolkitReady failed', err);
      }
      if (aaClientCache && typeof aaClientCache.sendTransaction === 'function') {
        return aaClientCache;
      }
      if (window.AAClient && typeof window.AAClient.sendTransaction === 'function') {
        aaClientCache = window.AAClient;
        return aaClientCache;
      }
      if (aaClientInitPromise) {
        await aaClientInitPromise;
        return aaClientCache && typeof aaClientCache.sendTransaction === 'function' ? aaClientCache : null;
      }

      aaClientInitPromise = (async () => {
        try {
          if (!window.AAClient) {
            try {
              await import('/js/aaClient.js');
            } catch (err) {
              console.warn('bankroll: aaClient import failed', err);
            }
          }

          if (window.AA && typeof window.AA.init === 'function') {
            try {
              await window.AA.init();
            } catch (err) {
              console.warn('bankroll: AA init failed', err);
            }
          }

          const clientAfterInit = await waitForAAClient(15, 200);
          if (clientAfterInit) {
            aaClientCache = clientAfterInit;
            return;
          }

          if (typeof window.enableSmartAccountNow === 'function') {
            try {
              await window.enableSmartAccountNow();
            } catch (err) {
              console.warn('bankroll: enableSmartAccountNow failed', err);
            }
          }

          const clientAfterEnable = await waitForAAClient(20, 250);
          if (clientAfterEnable) {
            aaClientCache = clientAfterEnable;
            return;
          }

          if (window.AA && typeof window.AA.initAA === 'function') {
            try {
              await window.AA.initAA({});
            } catch (err) {
              console.warn('bankroll: AA.initAA failed', err);
            }
          }

          aaClientCache = await waitForAAClient(20, 250);
        } finally {
          aaClientInitPromise = null;
        }
      })();

      await aaClientInitPromise;
      return aaClientCache && typeof aaClientCache.sendTransaction === 'function' ? aaClientCache : null;
    }

    async function resolveActiveSmartAccount(ownerAddress) {
      if (!ownerAddress) return null;
      const ownerLower = ownerAddress.toLowerCase();
      let smartAddr = null;
      try {
        smartAddr = await resolveSmartAccountAddress();
      } catch {}
      let smartLower = smartAddr ? smartAddr.toLowerCase() : '';
      const considerCandidates = async () => {
        const candidates = [];
        const aaClient = await ensureAAClient();
        if (aaClient && typeof aaClient.smartAccountAddress === 'string') {
          candidates.push(aaClient.smartAccountAddress);
        }
        if (window.AA && typeof window.AA.smartAccountAddress === 'string') {
          candidates.push(window.AA.smartAccountAddress);
        }
        return candidates;
      };
      if (!smartAddr || smartLower === ownerLower) {
        const candidates = await considerCandidates();
        for (const candidate of candidates) {
          if (candidate && candidate.toLowerCase() !== ownerLower) {
            smartAddr = candidate;
            smartLower = candidate.toLowerCase();
            break;
          }
        }
      }
      if (smartAddr && smartAddr.toLowerCase() !== ownerLower) {
        return smartAddr;
      }
      return null;
    }

    async function waitForTransaction(hash) {
      if (!hash) return null;
      const base = rpcProvider || await getProvider();
      if (!base) return null;
      try {
        if (typeof base.waitForTransaction === 'function') {
          return await base.waitForTransaction(hash);
        }
        if (base.provider && typeof base.provider.waitForTransaction === 'function') {
          return await base.provider.waitForTransaction(hash);
        }
        if (typeof base.getTransactionReceipt === 'function') {
          let receipt = null;
          let attempts = 0;
          while (!receipt && attempts < 40) {
            attempts += 1;
            receipt = await base.getTransactionReceipt(hash).catch(() => null);
            if (receipt) break;
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
          return receipt;
        }
      } catch (err) {
        console.warn('bankroll: waitForTransaction failed', err);
      }
      return null;
    }
    let providerCache = null;
    let injectedProvider = null;
    function getRequestFn(src) {
      if (!src) return null;
      if (typeof src.request === 'function') return (payload) => src.request(payload);
      if (typeof src.send === 'function') return (payload) => src.send(payload?.method, payload?.params || []);
      if (src.provider) return getRequestFn(src.provider);
      return null;
    }
    function getInjectedProvider() {
      return injectedProvider || null;
    }

    async function getProvider() {
      if (providerCache) return providerCache;
      let injected = null;
      try {
        if (typeof window.__getSelectedProvider === 'function') injected = window.__getSelectedProvider();
      } catch {}
      if (!injected && window.ethereum) injected = window.ethereum;
      if (!injected && window.phantom?.ethereum) injected = window.phantom.ethereum;
      if (!injected) return null;
      try {
        injectedProvider = injected;
        providerCache = compat.createInjectedProvider(injected);
        return providerCache;
      } catch (err) {
        console.error('bankroll: provider init failed', err);
        injectedProvider = null;
        return null;
      }
    }
  
    let signerCache = null;
    async function getSigner() {
      if (signerCache) return signerCache;
      const provider = await getProvider();
      if (!provider) return null;
      try {
        const signer = await compat.getSigner(provider);
        if (!signer) return null;
        await signer.getAddress();
        signerCache = signer;
        return signerCache;
      } catch (err) {
        console.warn('bankroll: signer unavailable', err);
        signerCache = null;
        return null;
      }
    }
  
    let configModulePromise = null;
  const TABLE_MODE = (typeof document !== 'undefined' && document.documentElement)
    ? (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase()
    : '';
  const IS_ONCHAIN_MODE = TABLE_MODE !== 'f2p';

    async function loadConfigModule() {
      if (!configModulePromise) {
        const tag = (typeof window !== 'undefined' && (window.__BUILD_TAG || Date.now())) || Date.now();
        configModulePromise = import(`/js/config.js?v=${encodeURIComponent(tag)}`).catch((err) => {
          console.error('bankroll: config import failed', err);
          return null;
        });
      }
      return configModulePromise;
    }
  
  let cachedConfig = null;
  async function loadMonConfig() {
    if (!cachedConfig) {
      const mod = await loadConfigModule();
      cachedConfig = mod?.MONAD || window.MONAD || null;
    }
    return cachedConfig;
  }

    async function ensureTargetNetwork(provider) {
      if (!provider) return false;
      const request = getRequestFn(getInjectedProvider()) || getRequestFn(provider);
      if (!request) {
        setStatus('Add the Monad Testnet (Chain ID 10143) in your wallet, then retry.', 'info');
        console.warn('bankroll: no request-capable provider; cannot automate network switch');
        return false;
      }
      try {
        const mon = await loadMonConfig();
        if (!mon?.id) return true;
      const currentHex = await request({ method: 'eth_chainId' }).catch(() => null);
      const currentId = currentHex != null ? parseInt(String(currentHex), 16) : null;
      if (currentId === mon.id) return true;
      const chainHex = '0x' + Number(mon.id).toString(16);
      try {
        await request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainHex }]
        });
        return true;
      } catch (switchErr) {
        if (switchErr?.code === 4902) {
          try {
            await request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: chainHex,
                chainName: mon.name || 'Monad Testnet',
                rpcUrls: mon.rpcHttp ? [mon.rpcHttp] : [],
                nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
                blockExplorerUrls: mon.explorer ? [mon.explorer] : undefined
              }]
            });
            return true;
          } catch (addErr) {
            console.warn('bankroll: wallet_addEthereumChain failed', addErr);
            setStatus('Add Monad Testnet to your wallet to continue.', 'info');
            return false;
          }
        }
        if (switchErr?.code === -32601 || String(switchErr?.message || '').toLowerCase().includes('not supported')) {
          setStatus('Open Phantom ? Settings ? Networks and add Monad Testnet (Chain ID 10143), then try again.', 'info');
          return false;
        }
        console.warn('bankroll: wallet_switchEthereumChain failed', switchErr);
        setStatus('Switch to Monad Testnet in your wallet.', 'info');
        return false;
      }
    } catch (err) {
      console.warn('bankroll: ensure network failed', err);
      return false;
    }
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
    let rpcProvider = null;
    let dcmonAbiCache = null;
    let wmonAbiCache = null;
  
    async function ensureReadContracts() {
      if (!IS_ONCHAIN_MODE) return false;
      if (!ethers) {
        setStatus('Wallet runtime unavailable.', 'error');
        return false;
      }
      const mon = await loadMonConfig();
      if (!rpcProvider && mon?.rpcHttp) {
        try {
          rpcProvider = compat.createJsonRpcProvider(mon.rpcHttp);
        } catch (err) {
          console.error('bankroll: rpc provider init failed', err);
        }
      }
      const addressProvider = rpcProvider || await getProvider();
      if (!addressProvider) {
        setStatus('Connect wallet first.', 'error');
        return false;
      }
      if (!dcmonAddress) dcmonAddress = await resolveAddress('dcmon', addressProvider);
      if (!wmonAddress) wmonAddress = await resolveAddress('wmon', addressProvider);
      if (!dcmonAddress || !wmonAddress) {
        setStatus('Bankroll contracts not configured.', 'error');
        return false;
      }
      if (!dcmonAbiCache || !wmonAbiCache) {
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
        dcmonAbiCache = dcmonAbi;
        wmonAbiCache = Array.isArray(window.WMONABI) ? window.WMONABI : wmonAbi;
      }
      const readBase = rpcProvider || addressProvider;
      if (!readBase) {
        setStatus('Monad RPC unavailable.', 'error');
        return false;
      }
      if (!dcmonRead) dcmonRead = new ethers.Contract(dcmonAddress, dcmonAbiCache, readBase);
      if (!wmonRead) wmonRead = new ethers.Contract(wmonAddress, wmonAbiCache, readBase);
      return true;
    }
  
    async function ensureWriteContracts() {
      if (!await ensureReadContracts()) return false;
      const provider = await getProvider();
      const signer = await getSigner();
      if (!provider || !signer) {
        setStatus('Connect wallet first.', 'error');
        return false;
      }
      const onMonad = await ensureTargetNetwork(provider);
      if (!onMonad) return false;
      if (!dcmonWrite) dcmonWrite = new ethers.Contract(dcmonAddress, dcmonAbiCache, signer);
      if (!wmonWrite) wmonWrite = new ethers.Contract(wmonAddress, wmonAbiCache, signer);
      return true;
    }
  
    function formatEther(value) {
      const formatted = compat.formatEther(value);
      if (formatted == null) return '-';
      const num = Number.parseFloat(formatted);
      if (!Number.isFinite(num)) return '-';
      const fixed = num.toFixed(3);
      return fixed === '-0.000' ? '0.000' : fixed;
    }
  
    async function refreshBalance(addr) {
      const address = addr || currentAddress();
      const smartAddr = await resolveActiveSmartAccount(address || '');
      const hasSmartAccount = !!smartAddr;

      const resetAll = () => {
        state.balances.eoaDcmonWei = null;
        state.balances.eoaMonWei = null;
        state.balances.smartDcmonWei = null;
        state.balances.smartMonWei = null;
        updateTargetSet(balanceTargets.eoaDcmon, '-');
        updateTargetSet(balanceTargets.eoaMon, '-');
        updateTargetSet(balanceTargets.smartDcmon, '-');
        updateTargetSet(balanceTargets.smartMon, '-');
      };

      if (!address) {
        resetAll();
        return null;
      }

      const ok = await ensureReadContracts();
      if (!ok) {
        resetAll();
        return null;
      }

      try {
        const balRaw = await dcmonRead.balanceOf(address);
        const bal = numeric.from(balRaw);
        state.balances.eoaDcmonWei = numeric.toBigNumberish(bal);
        updateTargetSet(balanceTargets.eoaDcmon, formatEther(bal));
        setStatus('');
      } catch (err) {
        console.error('bankroll: DCMon balance failed', err);
        state.balances.eoaDcmonWei = null;
        updateTargetSet(balanceTargets.eoaDcmon, '-');
      }

      {
        const rateEl = document.getElementById('wi-exchange-rate');
        const rateRow = document.getElementById('wi-exchange-rate-row');
        if (rateEl && dcmonRead) {
          let rateStr = '-';
          if (typeof dcmonRead.exchangeRate === 'function') {
            try {
              const res = await dcmonRead.exchangeRate();
              const num = res && (res.numerator != null ? res.numerator : res[0]);
              if (num != null) {
                const val = compat.formatUnits(num, 18);
                if (val != null) rateStr = String(Number.parseFloat(val).toFixed(6));
              }
            } catch {}
          }
          if ((rateStr === '-' || rateStr == null) && typeof dcmonRead.previewRedeem === 'function' && compat.constants?.WeiPerEther != null) {
            try {
              const out = await dcmonRead.previewRedeem(numeric.toBigNumberish(compat.constants.WeiPerEther));
              if (out) {
                const val = compat.formatEther(out);
                if (val != null) rateStr = String(Number.parseFloat(val).toFixed(6));
              }
            } catch {}
          }
          if ((rateStr === '-' || rateStr == null)
              && typeof dcmonRead.totalUnderlying === 'function'
              && typeof dcmonRead.totalSupply === 'function'
              && compat.constants?.WeiPerEther != null) {
            try {
              const tvlRaw = await dcmonRead.totalUnderlying();
              const supplyRaw = await dcmonRead.totalSupply();
              const supply = numeric.from(supplyRaw);
              if (!numeric.isZero(supply)) {
                const tvl = numeric.from(tvlRaw);
                const ratio = numeric.div(numeric.mul(tvl, compat.constants.WeiPerEther), supply);
                const val = compat.formatUnits(numeric.toBigNumberish(ratio), 18);
                if (val != null) rateStr = String(Number.parseFloat(val).toFixed(6));
              }
            } catch {}
          }
          if ((rateStr === '-' || rateStr == null)
              && typeof dcmonRead.underlying === 'function'
              && typeof dcmonRead.totalSupply === 'function'
              && compat.constants?.WeiPerEther != null) {
            try {
              const uAddr = await dcmonRead.underlying();
              if (uAddr && /^0x[0-9a-fA-F]{40}$/.test(String(uAddr))) {
                const ERC20_MIN_ABI = ['function balanceOf(address) view returns (uint256)'];
                const base = rpcProvider || await getProvider();
                if (base && window.ethers?.Contract) {
                  const u = new window.ethers.Contract(uAddr, ERC20_MIN_ABI, base);
                  const tvlRaw = await u.balanceOf(dcmonAddress);
                  const supplyRaw = await dcmonRead.totalSupply();
                  const supply = numeric.from(supplyRaw);
                  if (!numeric.isZero(supply)) {
                    const tvl = numeric.from(tvlRaw);
                    const ratio = numeric.div(numeric.mul(tvl, compat.constants.WeiPerEther), supply);
                    const val = compat.formatUnits(numeric.toBigNumberish(ratio), 18);
                    if (val != null) rateStr = String(Number.parseFloat(val).toFixed(6));
                  }
                }
              }
            } catch {}
          }
          const hasRate = !!(rateStr && rateStr !== '-');
          rateEl.textContent = hasRate ? `1 DCMon = ${rateStr} MON` : '-';
          if (rateRow) rateRow.style.display = hasRate ? 'flex' : 'none';
        }
      }

      const balanceProvider = rpcProvider || await getProvider();
      if (balanceProvider) {
        try {
          const monWeiRaw = await balanceProvider.getBalance(address);
          const monWei = numeric.from(monWeiRaw);
          state.balances.eoaMonWei = numeric.toBigNumberish(monWei);
          updateTargetSet(balanceTargets.eoaMon, formatEther(monWei));
        } catch (err) {
          console.error('bankroll: MON balance failed', err);
          state.balances.eoaMonWei = null;
          updateTargetSet(balanceTargets.eoaMon, '-');
        }
      } else {
        state.balances.eoaMonWei = null;
        updateTargetSet(balanceTargets.eoaMon, '-');
      }

      if (hasSmartAccount) {
        try {
          const smartBalRaw = await dcmonRead.balanceOf(smartAddr);
          const smartBal = numeric.from(smartBalRaw);
          state.balances.smartDcmonWei = numeric.toBigNumberish(smartBal);
          updateTargetSet(balanceTargets.smartDcmon, formatEther(smartBal));
        } catch (err) {
          console.warn('bankroll: smart DCMon balance failed', err);
          state.balances.smartDcmonWei = null;
          updateTargetSet(balanceTargets.smartDcmon, '-');
        }

        if (balanceProvider) {
          try {
            const smartMonRaw = await balanceProvider.getBalance(smartAddr);
            const smartMon = numeric.from(smartMonRaw);
            state.balances.smartMonWei = numeric.toBigNumberish(smartMon);
            updateTargetSet(balanceTargets.smartMon, formatEther(smartMon));
          } catch (err) {
            console.warn('bankroll: smart MON balance failed', err);
            state.balances.smartMonWei = null;
            updateTargetSet(balanceTargets.smartMon, '-');
          }
        } else {
          state.balances.smartMonWei = null;
          updateTargetSet(balanceTargets.smartMon, '-');
        }
      } else {
        state.balances.smartDcmonWei = null;
        state.balances.smartMonWei = null;
        updateTargetSet(balanceTargets.smartDcmon, '-');
        updateTargetSet(balanceTargets.smartMon, '-');
      }

      return true;
    }    async function ensureWrap(amountWei, address) {
      if (!IS_ONCHAIN_MODE) return false;
      if (!await ensureWriteContracts()) return false;
      if (!wmonRead || !wmonWrite) return false;
      const targetAmount = numeric.from(amountWei);
      const currentRaw = await wmonRead.balanceOf(address);
      const current = numeric.from(currentRaw);
      if (numeric.gte(current, targetAmount)) return true;
      const deficit = numeric.sub(targetAmount, current);
      if (!numeric.gt(deficit, 0n)) return true;
      setStatus('Wrapping MON...', 'info');
      const tx = await wmonWrite.deposit({ value: numeric.toBigNumberish(deficit) });
      await tx.wait();
      return true;
    }
  
    async function ensureWmonAllowance(amountWei, address) {
      if (!IS_ONCHAIN_MODE) return false;
      if (!await ensureWriteContracts()) return false;
      const required = numeric.from(amountWei);
      const allowanceRaw = await wmonRead.allowance(address, dcmonAddress);
      const allowance = numeric.from(allowanceRaw);
      if (numeric.gte(allowance, required)) return true;
      setStatus('Approving WMON...', 'info');
      const tx = await wmonWrite.approve(dcmonAddress, numeric.toBigNumberish(compat.constants.MaxUint256));
      await tx.wait();
      return true;
    }
  
    async function ensureDcmonAllowance(amountWei, address, spender) {
      if (!IS_ONCHAIN_MODE) return false;
      if (!await ensureWriteContracts()) return false;
      const target = spender || dcmonAddress;
      if (!target) return false;
      const required = numeric.from(amountWei);
      const allowanceRaw = await dcmonRead.allowance(address, target);
      const allowance = numeric.from(allowanceRaw);
      if (numeric.gte(allowance, required)) return true;
      setStatus('Approving DCMon...', 'info');
      const tx = await dcmonWrite.approve(target, numeric.toBigNumberish(compat.constants.MaxUint256));
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
      const normalized = sanitizeAmount(amount);
      if (normalized == null) return null;
      if (typeof normalized === 'bigint') {
        return normalized;
      }
      if (!compat.parseEther) return null;
      try {
        const wei = compat.parseEther(normalized);
        if (wei == null) return null;
        return numeric.gt(wei, 0n) ? wei : null;
      } catch {
        return null;
      }
    }
  
    async function buyIn(amountOverride) {
      setStatus('');
      if (!await ensureWriteContracts()) return;

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
        const depositTx = await dcmonWrite.deposit(numeric.toBigNumberish(amountWei), addr);
        await depositTx.wait();

        const smartAddr = await resolveActiveSmartAccount(addr);
        if (!smartAddr) {
          setStatus('Smart account unavailable. Reconnect your wallet and try again.', 'error');
          return;
        }
        try {
          setStatus('Funding smart account...', 'info');
          const transferTx = await dcmonWrite.transfer(smartAddr, numeric.toBigNumberish(amountWei));
          await transferTx.wait();
        } catch (transferErr) {
          console.error('bankroll: smart account funding failed', transferErr);
          const msg = transferErr?.error?.message || transferErr?.data?.message || transferErr?.reason || transferErr?.message || 'Failed to fund smart account.';
          setStatus(msg, 'error');
          return;
        }

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
      if (!await ensureWriteContracts()) return;

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
        const smartAddr = await resolveActiveSmartAccount(addr);
        if (smartAddr) {
          try {
            const smartBalRaw = await dcmonRead.balanceOf(smartAddr);
            const smartBal = numeric.from(smartBalRaw);
            if (!numeric.gte(smartBal, amountWei)) {
              const readable = formatEther(smartBal);
              setStatus(`Smart account balance is ${readable} DCMon. Adjust cash-out amount.`, 'error');
              return;
            }
          } catch (balErr) {
            console.error('bankroll: smart account balance lookup failed', balErr);
            setStatus('Unable to read smart account balance. Try again.', 'error');
            return;
          }
          const aaClient = await ensureAAClient();
          if (!aaClient) {
            setStatus('Smart account client unavailable. Reconnect your wallet and try again.', 'error');
            return;
          }
          setStatus('Moving DCMon to your wallet...', 'info');
          let saHash = null;
          try {
            const encoded = dcmonWrite.interface.encodeFunctionData('transfer', [addr, numeric.toBigNumberish(amountWei)]);
            saHash = await aaClient.sendTransaction({
              to: dcmonAddress,
              data: encoded,
              value: 0n,
              noSignerFallback: true,
            });
          } catch (transferErr) {
            console.error('bankroll: smart account cash-out transfer failed', transferErr);
            const msg = transferErr?.error?.message || transferErr?.data?.message || transferErr?.reason || transferErr?.message || 'Failed to pull DCMon from smart account.';
            setStatus(msg, 'error');
            return;
          }
          const finalHash = typeof saHash === 'string' ? saHash : (saHash?.hash || saHash?.transactionHash);
          if (!finalHash) {
            setStatus('Smart account transfer blocked.', 'error');
            return;
          }
          await waitForTransaction(finalHash);
        }

        setStatus('Redeeming DCMon...', 'info');
        const tx = await dcmonWrite.redeem(numeric.toBigNumberish(amountWei), addr);
        await tx.wait();
        if (wmonWrite) {
          setStatus('Unwrapping MON...', 'info');
          const unwrapTx = await wmonWrite.withdraw(numeric.toBigNumberish(amountWei));
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

    async function transferDcmonOwnerToSmart(amountWei, opts = {}) {
      const addr = currentAddress();
      if (!addr) {
        throw new Error('Connect wallet first.');
      }
      const smartAddr = await resolveActiveSmartAccount(addr);
      if (!smartAddr) {
        throw new Error('Smart account unavailable.');
      }
      if (!await ensureWriteContracts()) {
        throw new Error('Unable to initialise contracts.');
      }
      const required = numeric.from(amountWei);
      const walletBalRaw = await dcmonRead.balanceOf(addr);
      const walletBal = numeric.from(walletBalRaw);
      if (!numeric.gte(walletBal, required)) {
        throw new Error('Insufficient DCMon in wallet.');
      }
      opts.onProgress?.('Transferring DCMon to smart account...');
      const tx = await dcmonWrite.transfer(smartAddr, numeric.toBigNumberish(required));
      await tx.wait();
      await refreshBalance(addr);
      return true;
    }

    async function transferDcmonSmartToOwner(amountWei, opts = {}) {
      const addr = currentAddress();
      if (!addr) {
        throw new Error('Connect wallet first.');
      }
      const smartAddr = await resolveActiveSmartAccount(addr);
      if (!smartAddr) {
        throw new Error('Smart account unavailable.');
      }
      if (!await ensureWriteContracts()) {
        throw new Error('Unable to initialise contracts.');
      }
      const required = numeric.from(amountWei);
      const smartBalRaw = await dcmonRead.balanceOf(smartAddr);
      const smartBal = numeric.from(smartBalRaw);
      if (!numeric.gte(smartBal, required)) {
        throw new Error('Insufficient DCMon in smart account.');
      }
      const aaClient = await ensureAAClient();
      if (!aaClient) {
        throw new Error('Smart account client unavailable.');
      }
      opts.onProgress?.('Transferring DCMon to wallet...');
      const encoded = dcmonWrite.interface.encodeFunctionData('transfer', [
        addr,
        numeric.toBigNumberish(required),
      ]);
      const op = await aaClient.sendTransaction({
        to: dcmonAddress,
        data: encoded,
        value: 0n,
        noSignerFallback: true,
      });
      const finalHash = typeof op === 'string' ? op : (op?.hash || op?.transactionHash);
      if (!finalHash) {
        throw new Error('Transfer cancelled.');
      }
      await waitForTransaction(finalHash);
      await refreshBalance(addr);
      return true;
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
      ready: async () => ensureWriteContracts(),
      refreshBalance,
      ensureContracts: ensureWriteContracts,
      ensureReadContracts,
      getProvider,
      getSigner,
      getAddresses: () => ({ dcmon: dcmonAddress, wmon: wmonAddress }),
      getContracts: () => ({ dcmonRead, dcmonWrite, wmonRead, wmonWrite }),
      getLastBalances: () => ({ dcmonWei: state.balances.eoaDcmonWei, monWei: state.balances.eoaMonWei, smartDcmonWei: state.balances.smartDcmonWei, smartMonWei: state.balances.smartMonWei }),
      getSmartAccountAddress: async () => {
        const owner = currentAddress();
        if (!owner) return null;
        return await resolveActiveSmartAccount(owner);
      },
      ensureWrap,
      ensureWmonAllowance,
      ensureDcmonAllowance,
      buyIn,
      cashOut,
      transferDcmonOwnerToSmart,
      transferDcmonSmartToOwner,
      getLastStatus: () => state.lastStatus,
      registerBalanceTargets: (token, ids) => {
        if (token === 'mon') registerToSet(balanceTargets.eoaMon, ids);
        else if (token === 'dcmon') registerToSet(balanceTargets.eoaDcmon, ids);
        else if (token === 'smart-mon') registerToSet(balanceTargets.smartMon, ids);
        else if (token === 'smart-dcmon') registerToSet(balanceTargets.smartDcmon, ids);
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




