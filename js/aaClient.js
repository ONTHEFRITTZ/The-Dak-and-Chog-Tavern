// aa-client.js — minimal AA/session-key client w/ budget guardrails (onchain mode only)
// Works with your importmap (viem/permissionless) if present; otherwise falls back to injected.
import { MONAD, AA_FEATURES, getPokerTableAddress, MONAD_BUNDLER_RPC, ZD_PAYMASTER_RPC } from './aa/config.js';
import { MONAD_DELEGATION_ENV } from './aa/delegation-config.js';
import { ethers } from './tavern.js';
import { ensureDelegationToolkitContext } from './aa/toolkit.js';
import { detectBundler, walletSendCalls, extractTxHash } from './bundler.js';

const LS = {
  SESSION: 'aa:session',
  SPONSORED: 'aa:sponsored',
  BUDGET: 'aa:budget',
};
const SMART_ACCOUNT_KEY_PREFIX = 'aa:toolkit:account:';
const TOOLKIT_SUPPRESS_KEY = 'aa:toolkit:suppress';

function now() { return Math.floor(Date.now() / 1000); }
function toHex(v) { try { return '0x' + BigInt(v).toString(16); } catch { return '0x0'; } }
function short(a){ return (a && a.length>10) ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }
function lc(s){ return (s||'').toLowerCase(); }
function ensureHexData(data) {
  if (!data) return '0x';
  if (typeof data === 'string') return data;
  try { return ethers.utils.hexlify(data); } catch { return '0x'; }
}

async function getInjected() {
  // Respect your “provider pin”
  if (typeof window.__getSelectedProvider === 'function') {
    const p = window.__getSelectedProvider();
    if (p && typeof p.request === 'function') return p;
  }
  if (window.ethereum && typeof window.ethereum.request === 'function') return window.ethereum;
  if (window.phantom && window.phantom.ethereum && typeof window.phantom.ethereum.request === 'function') return window.phantom.ethereum;
  return null;
}

async function getChainId(provider){
  try {
    const id = await provider.request({ method: 'eth_chainId' });
    return Number(id);
  } catch { return 0; }
}

// In-memory + persisted session
function readSession() {
  try {
    const j = localStorage.getItem(LS.SESSION); if (!j) return null;
    const s = JSON.parse(j);
    if (!s || !s.exp || s.exp < now()) return null;
    return s;
  } catch { return null; }
}
function writeSession(s) {
  try { if (s) localStorage.setItem(LS.SESSION, JSON.stringify(s));
        else localStorage.removeItem(LS.SESSION); } catch {}
}
function readBudget() { try { return Number(localStorage.getItem(LS.BUDGET) || '0'); } catch { return 0; } }
function writeSponsored(on){ try{ localStorage.setItem(LS.SPONSORED, on?'true':'false'); }catch{} }
function readSponsored(){ try{ return localStorage.getItem(LS.SPONSORED) === 'true'; }catch{ return false; } }

function smartAccountStorageKey(chainId) {
  return `${SMART_ACCOUNT_KEY_PREFIX}${chainId || MONAD.id}`;
}
function loadStoredSmartAccount(chainId) {
  try { return localStorage.getItem(smartAccountStorageKey(chainId)) || null; } catch { return null; }
}
function storeSmartAccount(chainId, address) {
  if (!address) return;
  try { localStorage.setItem(smartAccountStorageKey(chainId), address); } catch {}
}

function clearSmartAccount(chainId) {
  try { localStorage.removeItem(smartAccountStorageKey(chainId)); } catch {}
}

function isToolkitSuppressed() {
  try { return sessionStorage.getItem(TOOLKIT_SUPPRESS_KEY) === 'true'; } catch { return false; }
}

function suppressToolkit(reason) {
  try { sessionStorage.setItem(TOOLKIT_SUPPRESS_KEY, 'true'); } catch {}
  if (reason) console.warn('[aaClient] MetaMask smart account suppressed for this session:', reason);
  else console.warn('[aaClient] MetaMask smart account suppressed for this session.');
}

export function enableToolkitSmartAccount() {
  try { sessionStorage.removeItem(TOOLKIT_SUPPRESS_KEY); } catch {}
  console.info('[aaClient] MetaMask smart account toolkit re-enabled for this session.');
}

export const AA = {
  provider: null,
  address: null,
  controllerAddress: null,
  internalAddress: null,
  chainId: 0,
  sponsored: false,
  session: null,  // { allowlist:[{to, selectors:[sig,...]}], spendLimitWei:string, spentWei:string, exp:number }
  budgetWei: 0n,
  smartAccountAddress: null,
  smartAccountType: 'fallback',
  toolkitContext: null,

  async init() {
    this.provider = await getInjected();
    if (!this.provider) throw new Error('No EVM provider');
    this.chainId = await getChainId(this.provider);
    this.sponsored = readSponsored();
    this.session = readSession();
    this.budgetWei = BigInt(Math.floor(readBudget() * 1e18));

    try { window.dispatchEvent(new CustomEvent('aa:budget', { detail: { budgetWei: this.budgetWei } })); } catch {}
    try { window.dispatchEvent(new CustomEvent('aa:session', { detail: { session: this.session } })); } catch {}

    // Resolve primary address (used for from:)
    try {
      const accs = await this.provider.request({ method: 'eth_accounts' });
      const first = accs && accs[0] ? String(accs[0]).toLowerCase() : null;
      this.address = first;
      if (!this.controllerAddress) {
        this.controllerAddress = first;
      }
    } catch {}

    try {
      if (!this.controllerAddress) {
        const stored = localStorage.getItem('aa.controllerAddress');
        if (stored) this.controllerAddress = String(stored).toLowerCase();
      }
      if (!this.internalAddress) {
        const storedInternal = localStorage.getItem('aa.smartAccountAddress');
        if (storedInternal) this.internalAddress = String(storedInternal).toLowerCase();
      }
    } catch {}
    if (this.controllerAddress) {
      this.address = this.controllerAddress;
    }

    // emit initial sponsor state for pill
    window.dispatchEvent(new CustomEvent('aa:sponsored', { detail: { active: this.sponsored } }));
    try {
      window.dispatchEvent(new CustomEvent('aa:controller', { detail: { controller: this.controllerAddress } }));
    } catch {}

    return this;
  },

  isOnMonad(){ return this.chainId === MONAD.id; },

  setSponsored(on) {
    this.sponsored = !!on;
    writeSponsored(this.sponsored);
    window.dispatchEvent(new CustomEvent('aa:sponsored', { detail: { active: this.sponsored } }));
  },

  setBudget(monFloat) {
    const n = Number(monFloat || 0);
    this.budgetWei = BigInt(Math.max(0, Math.floor(n * 1e18)));
    try { localStorage.setItem(LS.BUDGET, String(n)); } catch {}
    try { window.dispatchEvent(new CustomEvent('aa:budget', { detail: { budgetWei: this.budgetWei } })); } catch {}
  },

  // Create a simple local session w/ allowlist + cap (valid for ~2 hours by default)
  async grantSessionKey({ minutes = 120, monCap = 0.1, allowlist = [] } = {}) {
    const capWei = BigInt(Math.floor(Number(monCap || 0) * 1e18));
    const sess = {
      allowlist: (allowlist || []).map(x => ({ to: lc(x.to), selectors: (x.selectors||[]).map(lc) })),
      spendLimitWei: '0x' + capWei.toString(16),
      spentWei: '0x0',
      exp: now() + Math.max(30, minutes * 60),
      note: 'local-session',
    };
    this.session = sess;
    writeSession(sess);
    try { window.dispatchEvent(new CustomEvent('aa:session', { detail: { session: this.session } })); } catch {}
    return sess;
  },

  revokeSession() {
    this.session = null;
    writeSession(null);
    try { window.dispatchEvent(new CustomEvent('aa:session', { detail: { session: this.session } })); } catch {}
  },

  // Guard check for a tx against session + budget
  _allowedBySession(tx) {
    const s = this.session;
    if (!s) return false;
    if (!s.exp || s.exp < now()) return false;

    const to = lc(tx.to || '');
    const data = lc(tx.data || '');
    const sig = data.slice(0,10); // 4-byte selector

    const a = (s.allowlist||[]).find(x => x.to === to);
    if (!a) return false;
    if (a.selectors && a.selectors.length && !a.selectors.includes(sig)) return false;

    // Check session cap
    const val = BigInt(tx.value ? BigInt(tx.value) : 0n);
    const spent = BigInt(s.spentWei || '0x0');
    const limit = BigInt(s.spendLimitWei || '0x0');
    if (val + spent > limit) return false;

    // Check user budget
    if (this.budgetWei > 0n && val + spent > this.budgetWei) return false;

    return true;
  },

  _commitSpend(valueWei) {
    try {
      if (!this.session) return;
      const spent = BigInt(this.session.spentWei || '0x0');
      const v = BigInt(valueWei||0n);
      this.session.spentWei = '0x' + (spent + v).toString(16);
      writeSession(this.session);
      try { window.dispatchEvent(new CustomEvent('aa:session', { detail: { session: this.session } })); } catch {}
    } catch {}
  },

  // Send a TX (delegated if within session policy; otherwise require user confirmation)
  async sendTx(tx) {
    if (!this.provider) throw new Error('No provider');
    const from = this.address || (await this.provider.request({ method:'eth_requestAccounts' }))[0];

    const safeTx = {
      from,
      to: tx.to,
      data: tx.data || '0x',
      value: tx.value ? toHex(tx.value) : '0x0',
      chainId: this.chainId ? toHex(this.chainId) : undefined,
    };

    // If within session policy -> fire directly (no extra wallet prompts expected when a sponsor/bundler is set up)
    if (this._allowedBySession(safeTx)) {
      const hash = await this.provider.request({ method: 'eth_sendTransaction', params: [ safeTx ] });
      this._commitSpend(BigInt(safeTx.value || '0x0'));
      return hash;
    }

    // Fallback: normal “ask the wallet” path
    return await this.provider.request({ method: 'eth_sendTransaction', params: [ safeTx ] });
  }
};

// Helper for building an allowlist easily
export async function defaultAllowlist() {
  const out = [];
  try {
    const pokerAddr = await getPokerTableAddress(/* provider irrelevant here */ null);
    if (pokerAddr) {
      // Unknown ABI on your side, so we just demonstrate selector whitelisting:
      // add known selectors here if you want to narrow: e.g. joinTable(bytes32) => '0x12345678'
      out.push({ to: pokerAddr, selectors: [] }); // empty selectors = allow all to that contract
    }
  } catch {}
  try {
    const faroAddr = window?.CONTRACTS?.FaroV3 || null;
    if (faroAddr) out.push({ to: faroAddr, selectors: [] });
  } catch {}
  return out;
}

// ---------------------------------------------------------------------------
// Delegation Toolkit / Smart Account bootstrap
// ---------------------------------------------------------------------------

let aaSmartAccount = null;
let aaSigner = null;
let aaReady = false;
let lastBundlerUrl = null;

// resolveInjectedProvider and createFallbackAccount defined later (single implementations)

async function buildToolkitSmartAccount(injected, { bundlerUrl, paymasterUrl }) {
  if (isToolkitSuppressed()) {
    console.warn('[aaClient] Delegation toolkit suppressed for this session; using fallback account.');
    return null;
  }
  try {
    const toolkitCtx = await ensureDelegationToolkitContext();
    try { AA.toolkitContext = toolkitCtx; } catch {}
    const { toolkit, publicClient, walletClient } = toolkitCtx || {};
    const toMetaMaskSmartAccount = toolkit?.toMetaMaskSmartAccount;
    const Implementation = toolkit?.Implementation;

    if (typeof toMetaMaskSmartAccount !== 'function') {
      return null;
    }

    const web3 = new ethers.providers.Web3Provider(injected, 'any');
    const signer = web3.getSigner();
    const ownerAddress = toolkitCtx?.account || await signer.getAddress();
    const chainId = MONAD.id;
    const stored = loadStoredSmartAccount(chainId);

    const multiSigDeployParams = [[ownerAddress], 1n];
    const hybridDeployParams = [ownerAddress, [], [], []];
    let mmAccount;
    try {
      // Build strictly with v0.15+ signature only
      const chainObj = (walletClient && walletClient.chain) || toolkitCtx?.walletChain || publicClient?.chain || {
        id: MONAD.id,
        name: 'Monad Testnet',
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }
      };
      const implementation =
        Implementation?.MultiSig ?? Implementation?.Stateless7702 ?? Implementation?.Hybrid;
      const signerConfig = implementation === Implementation?.MultiSig
        ? [{ walletClient }]
        : { walletClient };
      const accountOpts = stored
        ? { address: stored }
        : (implementation === Implementation?.MultiSig
            ? { deployParams: multiSigDeployParams, deploySalt: '0x0' }
            : implementation === Implementation?.Hybrid
              ? { deployParams: hybridDeployParams, deploySalt: '0x0' }
              : {});
      mmAccount = await toMetaMaskSmartAccount({
        owner: ownerAddress,
        chain: chainObj,
        implementation,
        transport: walletClient?.transport,
        // Include signer/client for libs that still read them
        signer: signerConfig,
        client: publicClient,
        ...accountOpts
      });
    } catch (err) {
      if (err?.code === 4001 || /User rejected/i.test(err?.message || '')) {
        suppressToolkit('user rejected MetaMask smart account upgrade');
        return null;
      }
      throw err;
    }

    const mmAddress = lc(await mmAccount.getAddress());
    if (mmAddress && mmAddress !== stored) {
      storeSmartAccount(chainId, mmAddress);
    }

    async function sendViaSmartAccount(tx) {
      if (!tx || !tx.to) throw new Error('Missing "to" for smart account send');
      const target = tx.to;
      const data = ensureHexData(tx.data);
      const valueHex = toHex(tx.value || 0n);
      let valueBigInt = 0n;
      try { valueBigInt = BigInt(tx.value || 0); } catch { valueBigInt = 0n; }
      const chainHex = '0x' + chainId.toString(16);

      try {
        const { provider: bundlerProvider, available } = await detectBundler(injected);
        if (available && bundlerProvider) {
          const result = await walletSendCalls({
            provider: bundlerProvider,
            from: mmAddress,
            chainId: chainHex,
            calls: [{ to: target, data, value: valueHex }]
          });
          const hash = extractTxHash(result);
          if (hash) return hash;
        }
      } catch (err) {
        console.warn('[aaClient] wallet_sendCalls failed, falling back', err);
      }

      if (mmAccount && typeof mmAccount.sendTransactions === 'function') {
        try {
          const result = await mmAccount.sendTransactions(
            [{ to: target, data, value: valueHex }],
            { chainId, bundlerRpc: bundlerUrl, paymasterRpc: paymasterUrl }
          );
          const hash = extractTxHash(result);
          if (hash) return hash;
          if (result?.hash) return result.hash;
          if (result?.transactionHash) return result.transactionHash;
        } catch (err) {
          console.warn('[aaClient] mmAccount.sendTransactions failed', err);
        }
      }

      if (walletClient && typeof walletClient.sendTransaction === 'function') {
        try {
          const txHash = await walletClient.sendTransaction({
            account: mmAccount,
            to: target,
            data,
            value: valueBigInt
          });
          if (txHash) return txHash;
        } catch (err) {
          console.warn('[aaClient] walletClient.sendTransaction failed', err);
        }
      }

      const fallbackTx = {
        to: target,
        data,
        value: (() => {
          try { return ethers.BigNumber.from(valueBigInt); } catch { return ethers.BigNumber.from(0); }
        })()
      };
      const res = await signer.sendTransaction(fallbackTx);
      const hash = typeof res === 'string' ? res : (res?.hash || res?.transactionHash);
      if (!hash) {
        console.warn('sendTransaction result:', res);
        throw new Error('Failed to obtain tx hash from fallback send');
      }
      return hash;
    }

    const wrappedAccount = {
      address: mmAddress,
      type: 'delegation-toolkit',
      getAddress: async () => mmAddress,
      mmAccount,
      context: toolkitCtx,
      bundlerUrl,
      paymasterUrl,
      sendTransaction: (tx) => sendViaSmartAccount(tx)
    };

    return { smartAccount: wrappedAccount, signer };
  } catch (err) {
    if (err?.code === 4001 || /User rejected/i.test(err?.message || '')) {
      suppressToolkit('user rejected MetaMask smart account request');
    } else {
      console.warn('[aaClient] Delegation Toolkit init failed, falling back to EOA', err);
    }
    return null;
  }
}

export async function initAA({ bundlerUrl = MONAD_BUNDLER_RPC, paymasterUrl = ZD_PAYMASTER_RPC, provider } = {}) {
  const injected = resolveInjectedProvider(provider);
  if (!injected) throw new Error('No provider available for AA');

  if (aaReady && aaSmartAccount && lastBundlerUrl === bundlerUrl) {
    return aaSmartAccount;
  }

  let created = await (async () => { try { return await buildAA4337Account(injected, { bundlerUrl, paymasterUrl }); } catch { return null; } })();
  if (!created) {
    created = await createFallbackAccount(injected);
  }

  aaSmartAccount = created.smartAccount;
  aaSigner = created.signer;
  aaReady = true;
  lastBundlerUrl = bundlerUrl;
  AA.smartAccountAddress = null;
  AA.smartAccountType = aaSmartAccount?.type || 'aa4337';
  AA.toolkitContext = null;
  AA.controllerAddress = AA.address || null;
  AA.internalAddress = null;
  AA.address = AA.controllerAddress || AA.address;

  try {
    window.dispatchEvent(new CustomEvent('aa:smartaccount', {
      detail: {
        address: AA.smartAccountAddress,
        type: AA.smartAccountType
      }
    }));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('aa:controller', {
      detail: { controller: AA.controllerAddress }
    }));
  } catch {}

  try { window.smartAccount = aaSmartAccount; } catch {}
  return aaSmartAccount;
}

function resolveInjectedProvider(override){
  if (override && typeof override.request === 'function') return override;
  if (typeof window.__getSelectedProvider === 'function') {
    const p = window.__getSelectedProvider();
    if (p && typeof p.request === 'function') return p;
  }
  if (window.ethereum && typeof window.ethereum.request === 'function') return window.ethereum;
  if (window.phantom && window.phantom.ethereum && typeof window.phantom.ethereum.request === 'function') return window.phantom.ethereum;
  return null;
}

async function createFallbackAccount(injected) {
  const web3 = new ethers.providers.Web3Provider(injected, 'any');
  const signer = web3.getSigner();
  const address = await signer.getAddress();
  const fallbackAccount = {
    address,
    provider: web3,
    signer,
    type: 'fallback',
    getAddress: async () => address,
    sendTransaction: (tx) => signer.sendTransaction(tx)
  };
  return { smartAccount: fallbackAccount, signer };
}

async function buildAA4337Account(injected, { bundlerUrl, paymasterUrl }) {
  const web3 = new ethers.providers.Web3Provider(injected, 'any');
  const signer = web3.getSigner();
  const address = (await signer.getAddress()).toLowerCase();
  const aaBundlerEndpoint = bundlerUrl || MONAD_BUNDLER_RPC;
  const aaPaymasterEndpoint = paymasterUrl || ZD_PAYMASTER_RPC;
  async function sendViaAA(tx){
    const to = tx.to;
    const data = ensureHexData(tx.data);
    const valueHex = toHex(tx.value || 0n);
    const chainHex = '0x' + (AA.chainId || MONAD.id).toString(16);
    // 1) Direct 4337 to ZeroDev bundler first (silent)
    try {
      const hashUo = await sendViaZeroDevUO(tx);
      if (hashUo) return hashUo;
    } catch (err4337) {
      try { console.warn('[aaClient] 4337 submission failed', err4337); } catch {}
    }
    // 2) If wallet advertises 5792 capabilities, try wallet_sendCalls
    try {
      const { provider: bProvider, available } = await detectBundler(injected);
      if (available && bProvider) {
        const res2 = await walletSendCalls({ provider: bProvider, from: address, chainId: chainHex, calls: [{ to, data, value: valueHex }] });
        const hash2 = extractTxHash(res2);
        if (hash2) return hash2;
      }
    } catch (_) { /* ignore */ }
    if (!tx || !tx.noSignerFallback) {
      const txReq = { to, data, value: (()=>{ try { return ethers.BigNumber.from(tx.value||0); } catch { return ethers.BigNumber.from(0); }})() };
      const res = await signer.sendTransaction(txReq);
      return typeof res === 'string' ? res : (res?.hash || res?.transactionHash);
    }
    try { console.warn('[aaClient] gasless-only mode: signer fallback suppressed'); } catch {}
    return null;
  }

  // Direct 4337 using MetaMask Delegation Toolkit + viem/account-abstraction
  async function sendViaZeroDevUO(tx){
    try {
      const ctx = await ensureDelegationToolkitContext();
      if (!ctx || !ctx.walletClient || !ctx.publicClient) { console.warn('[aaClient] toolkit context unavailable'); return null; }
      async function loadDelegationVendor() {
        const tag = encodeURIComponent(window.__BUILD_TAG || Date.now());
        const withTag = (src) => src.includes('?') ? `${src}&v=${tag}` : `${src}?v=${tag}`;
        const sources = [
          withTag('/js/vendor/delegation-toolkit-bundled.mjs'),
          withTag('/js/vendor/delegation-toolkit-shim.mjs'),
          withTag('/js/vendor/metamask-delegation-toolkit-latest.bundle.mjs'),
          withTag('/js/vendor/metamask-delegation-toolkit.mjs'),
          withTag('/js/vendor/metamask-delegation-toolkit-esm.mjs'),
          withTag('https://cdn.jsdelivr.net/npm/@metamask/delegation-toolkit@0.13.0/dist/index.mjs'),
          withTag('https://esm.sh/@metamask/delegation-toolkit@0.13.0?bundle&target=es2022'),
          withTag('https://cdn.skypack.dev/@metamask/delegation-toolkit@0.13.0?min')
        ];
        const isSameOrigin = (url) => {
          try {
            const parsed = new URL(url, window.location.origin);
            return parsed.origin === window.location.origin;
          } catch {
            return !/^https?:/i.test(url);
          }
        };
        for (const src of sources) {
          const resolved = (() => {
            if (/^https?:/i.test(src)) return src;
            try { return new URL(src, window.location.origin).href; }
            catch { return src; }
          })();
          try {
            if (!isSameOrigin(resolved)) {
              return await import(/* @vite-ignore */ resolved);
            }
            const res = await fetch(resolved, { cache: 'no-store', mode: 'cors' });
            if (!res || !res.ok) throw new Error(String(res && res.status));
            const code = await res.text();
            const blob = new Blob([code], { type: 'text/javascript' });
            const url = URL.createObjectURL(blob);
            try { return await import(/* @vite-ignore */ url); }
            finally { URL.revokeObjectURL(url); }
          } catch (err) {
            console.warn('[aaClient] delegation toolkit fetch import failed', resolved, err);
          }
        }
        return null;
      }
      const rawVendor = await loadDelegationVendor();
      if (!rawVendor) { console.warn('[aaClient] delegation toolkit vendor unavailable'); return null; }
      const vendor = rawVendor.default ? rawVendor.default : rawVendor;
      const encodeCallsForCaller = typeof vendor.encodeCallsForCaller === 'function'
        ? vendor.encodeCallsForCaller.bind(vendor)
        : (async (caller, calls) => {
            if (!calls || !calls.length) return '0x';
            const single = calls[0] || {};
            if (calls.length === 1 && single.data) return ensureHexData(single.data);
            const createExecution = vendor.createExecution || (({ to, value, data }) => ({ target: to, value: value || 0n, callData: data || '0x' }));
            const executions = calls.map((call) => createExecution({ to: call.to, value: call.value, data: ensureHexData(call.data) }));
            const encodeBatch = vendor.encodeExecutionCalldatas || vendor.encodeExecutionCalldata || (() => ensureHexData(single.data));
            try {
              const encoded = encodeBatch(executions.length === 1 ? [executions[0]] : executions);
              return encoded || ensureHexData(single.data);
            } catch {
              return ensureHexData(single.data);
            }
          });
      const implementations = vendor.Implementation || {};
      const chainId = (ctx.walletChain && ctx.walletChain.id) || MONAD.id;
      let cachedAddress = loadStoredSmartAccount(chainId);
      if (cachedAddress) {
        let deployedCode = null;
        try {
          deployedCode = await ctx.publicClient.getBytecode({ address: cachedAddress });
        } catch {}
        if (!deployedCode || deployedCode === '0x' || deployedCode === '0X' || deployedCode === '') {
          clearSmartAccount(chainId);
          cachedAddress = null;
        }
      }
      const ownerAddress = ctx.ownerAccount || (ctx.accounts && ctx.accounts[0]) || (ctx.walletClient?.account && ctx.walletClient.account.address);
      let implementation = implementations.MultiSig ?? implementations.Stateless7702 ?? implementations.Hybrid ?? undefined;
      if (!implementation) {
        console.warn('[aaClient] delegation toolkit implementation unavailable');
        return null;
      }
      const mergeEnvironments = (preferred, fallback) => {
        const base = fallback || {};
        const extra = preferred || {};
        return {
          ...base,
          ...extra,
          implementations: { ...(base.implementations || {}), ...(extra.implementations || {}) },
          caveatEnforcers: { ...(base.caveatEnforcers || {}), ...(extra.caveatEnforcers || {}) }
        };
      };
      let vendorEnvironment = null;
      try {
        vendorEnvironment = vendor.getDeleGatorEnvironment ? vendor.getDeleGatorEnvironment(chainId) : null;
      } catch (envErr) {
        console.warn('[aaClient] getDeleGatorEnvironment failed', envErr);
      }
      const baseEnvironment = ctx.environment || {};
      const environment = mergeEnvironments(vendorEnvironment, baseEnvironment);
      const fallbackEnvironment = MONAD_DELEGATION_ENV || {};
      const entryPointAddress =
        environment.EntryPoint ||
        baseEnvironment.EntryPoint ||
        fallbackEnvironment.EntryPoint ||
        '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
      const simpleFactoryAddress =
        environment.SimpleFactory ||
        baseEnvironment.SimpleFactory ||
        fallbackEnvironment.SimpleFactory ||
        null;
      const delegationManagerAddress =
        environment.DelegationManager ||
        baseEnvironment.DelegationManager ||
        fallbackEnvironment.DelegationManager ||
        null;
      if (!entryPointAddress || !simpleFactoryAddress) {
        console.warn('[aaClient] delegation environment incomplete', { entryPointAddress, simpleFactoryAddress, environment });
        return null;
      }
      environment.EntryPoint = entryPointAddress;
      environment.SimpleFactory = simpleFactoryAddress;
      if (delegationManagerAddress) environment.DelegationManager = delegationManagerAddress;
      try { ctx.environment = environment; } catch {}
      const signer = implementation === implementations.MultiSig
        ? [{ walletClient: ctx.walletClient }]
        : { walletClient: ctx.walletClient };
      const accountArgs = {
        client: ctx.publicClient,
        signer,
        implementation,
        environment,
        delegations: []
      };
      if (cachedAddress) {
        accountArgs.address = cachedAddress;
      } else {
        if (!ownerAddress) {
          console.warn('[aaClient] unable to determine owner address for smart account deployment');
          return null;
        }
        if (implementation === implementations.MultiSig) {
          accountArgs.deployParams = [[ownerAddress], 1n];
          accountArgs.deploySalt = '0x0';
        } else if (implementation === implementations.Hybrid) {
          accountArgs.deployParams = [ownerAddress, [], [], []];
          accountArgs.deploySalt = '0x0';
        } else {
          console.warn('[aaClient] selected implementation requires pre-deployed address');
          return null;
        }
      }
      // Derive a smart account bound to the controller wallet
      const account = await vendor.toMetaMaskSmartAccount(accountArgs);
      let derivedAddress = null;
      try {
        derivedAddress = account && typeof account.getAddress === 'function' ? await account.getAddress() : account?.address;
      } catch {}
      let accountDeployed = false;
      if (derivedAddress) {
        try {
          if (typeof account.isDeployed === 'function') {
            accountDeployed = await account.isDeployed();
          } else {
            const code = await ctx.publicClient.getBytecode({ address: derivedAddress });
            accountDeployed = !!code && code !== '0x' && code !== '0X';
          }
        } catch {}
      }
      if (derivedAddress && accountDeployed) {
        storeSmartAccount(chainId, lc(derivedAddress));
      } else {
        clearSmartAccount(chainId);
      }
      const value = (()=>{ try { return BigInt(tx.value || 0); } catch { return 0n; } })();
      const sender = derivedAddress || await (account?.getAddress ? account.getAddress() : Promise.resolve(account?.address || null));
      if (!sender) { console.warn('[aaClient] unable to resolve smart account address'); return null; }
      const callList = [{ to: tx.to, value, data: ensureHexData(tx.data) }];
      let callData = null;
      try { callData = await encodeCallsForCaller(sender, callList); }
      catch (encodeErr) { console.warn('[aaClient] encodeCallsForCaller failed', encodeErr); return null; }
      if (!callData) { callData = ensureHexData(tx.data); }
      const implementationName = String(implementation || '');
      const contractName = (() => {
        if (implementationName === 'Hybrid') return 'HybridDeleGator';
        if (implementationName === 'Stateless7702' || implementationName === 'EIP7702Stateless') return 'EIP7702StatelessDeleGator';
        return 'MultiSigDeleGator';
      })();
      let nonce = 0n;
      try { nonce = (typeof account.getNonce === 'function') ? await account.getNonce() : 0n; } catch {}
      let factoryArgs = null;
      try { factoryArgs = (typeof account.getFactoryArgs === 'function') ? await account.getFactoryArgs() : null; }
      catch {}
      const unsignedOp = {
        sender,
        nonce,
        factory: factoryArgs?.factory,
        factoryData: factoryArgs?.factoryData,
        callData,
        callGasLimit: 0n,
        verificationGasLimit: 0n,
        preVerificationGas: 0n,
        maxFeePerGas: 0n,
        maxPriorityFeePerGas: 0n,
        paymaster: undefined,
        paymasterData: '0x',
        paymasterVerificationGasLimit: 0n,
        paymasterPostOpGasLimit: 0n
      };
      const chainNumeric = Number(chainId || MONAD.id);
      const toHexValue = (v) => {
        try {
          if (typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v)) return v;
          if (typeof v === 'number') return '0x' + BigInt(v).toString(16);
          if (typeof v === 'bigint') return '0x' + v.toString(16);
          if (v && typeof v.toHexString === 'function') return v.toHexString();
        } catch {}
        return undefined;
      };
      const toBigValue = (val) => {
        if (val == null) return undefined;
        if (typeof val === 'bigint') return val;
        if (typeof val === 'number') return BigInt(val);
        if (typeof val === 'string') {
          try { return BigInt(val); } catch { return undefined; }
        }
        return undefined;
      };
      const toRpcUserOp = (op) => ({
        sender: op.sender,
        nonce: toHexValue(op.nonce) || '0x0',
        factory: op.factory,
        factoryData: op.factoryData,
        callData: op.callData,
        callGasLimit: toHexValue(op.callGasLimit) || '0x0',
        verificationGasLimit: toHexValue(op.verificationGasLimit) || '0x0',
        preVerificationGas: toHexValue(op.preVerificationGas) || '0x0',
        maxFeePerGas: toHexValue(op.maxFeePerGas) || '0x0',
        maxPriorityFeePerGas: toHexValue(op.maxPriorityFeePerGas) || '0x0',
        paymaster: op.paymaster,
        paymasterData: op.paymasterData || '0x',
        paymasterVerificationGasLimit: op.paymasterVerificationGasLimit != null ? toHexValue(op.paymasterVerificationGasLimit) : undefined,
        paymasterPostOpGasLimit: op.paymasterPostOpGasLimit != null ? toHexValue(op.paymasterPostOpGasLimit) : undefined,
        signature: op.signature
      });
      let rpcUserOp = toRpcUserOp(unsignedOp);
      const sponsorResponse = async () => {
        if (!aaPaymasterEndpoint) return null;
        try {
          const body = {
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'pm_sponsorUserOperation',
            params: [rpcUserOp, { entryPoint: entryPointAddress, chainId: toHex(chainNumeric) }]
          };
          const res = await fetch(aaPaymasterEndpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          }).catch((err) => ({ __err: err }));
          if (!res || res.__err) throw res && res.__err || new Error('paymaster_http_error');
          const payload = await res.json();
          if (payload?.error) {
            const err = new Error(payload.error.message || 'paymaster_error');
            err.data = payload.error;
            throw err;
          }
          return payload?.result || null;
        } catch (err) {
          console.warn('[aaClient] paymaster sponsorship failed', err);
          return null;
        }
      };
      const sponsorship = await sponsorResponse();
      if (sponsorship) {
        if (typeof sponsorship.paymaster === 'string') {
          unsignedOp.paymaster = sponsorship.paymaster;
        }
        if (typeof sponsorship.paymasterData === 'string') {
          unsignedOp.paymasterData = sponsorship.paymasterData;
        } else if (typeof sponsorship.paymasterAndData === 'string' && sponsorship.paymasterAndData.length >= 42) {
          unsignedOp.paymaster = '0x' + sponsorship.paymasterAndData.slice(2, 42);
          unsignedOp.paymasterData = '0x' + sponsorship.paymasterAndData.slice(42);
        }
        const maybeAssign = (key, value) => {
          const big = toBigValue(value);
          if (big != null) unsignedOp[key] = big;
        };
        maybeAssign('preVerificationGas', sponsorship.preVerificationGasHex || sponsorship.preVerificationGas);
        maybeAssign('verificationGasLimit', sponsorship.verificationGasLimitHex || sponsorship.verificationGasLimit);
        maybeAssign('callGasLimit', sponsorship.callGasLimitHex || sponsorship.callGasLimit);
        maybeAssign('maxFeePerGas', sponsorship.maxFeePerGasHex || sponsorship.maxFeePerGas);
        maybeAssign('maxPriorityFeePerGas', sponsorship.maxPriorityFeePerGasHex || sponsorship.maxPriorityFeePerGas);
        maybeAssign('paymasterVerificationGasLimit', sponsorship.verificationGasLimit);
        maybeAssign('paymasterPostOpGasLimit', sponsorship.postOpGasLimit);
        rpcUserOp = toRpcUserOp(unsignedOp);
      }
      const actionSigner = (typeof vendor.signUserOperationActions === 'function')
        ? vendor.signUserOperationActions()(ctx.walletClient)
        : null;
      const signUserOperationFn = actionSigner && typeof actionSigner.signUserOperation === 'function'
        ? actionSigner.signUserOperation
        : (account && typeof account.signUserOperation === 'function'
            ? (params) => account.signUserOperation(params)
            : null);
      if (!signUserOperationFn) {
        console.warn('[aaClient] signUserOperation helper unavailable');
        return null;
      }
      let signedOpSignature = null;
      try {
        if (actionSigner && typeof actionSigner.signUserOperation === 'function') {
          signedOpSignature = await actionSigner.signUserOperation({
            userOperation: unsignedOp,
            entryPoint: { address: entryPointAddress },
            chainId: chainNumeric,
            address: sender,
            name: contractName,
            version: '1'
          });
        } else {
          signedOpSignature = await signUserOperationFn({
            ...unsignedOp,
            chainId: chainNumeric
          });
        }
      } catch (signErr) {
        console.warn('[aaClient] signUserOperation failed', signErr);
        return null;
      }
      let uo = { ...unsignedOp, signature: signedOpSignature };
      rpcUserOp = toRpcUserOp(uo);
      // Helper for bundler RPC
      async function rpcCall(method, params){
        const body = { jsonrpc: '2.0', id: Date.now(), method, params };
        const res = await fetch(aaBundlerEndpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch((e)=>({ __err:e }));
        if (!res || res.__err) throw res && res.__err || new Error('bundler_http_error');
        let payload = null; try { payload = await res.json(); } catch { payload = null; }
        if (!payload) throw new Error('bundler_bad_json');
        if (payload.error) { const err = new Error(payload.error.message||'bundler_error'); err.data = payload.error; throw err; }
        return payload.result;
      }
      // Estimate gas for the UO (fill required limits)
      const entryPoint = entryPointAddress;
      try {
        const est = await rpcCall('eth_estimateUserOperationGas', [rpcUserOp, entryPoint]);
        if (est) {
          const cg = est.callGasLimitHex || est.callGasLimit || est.callGas || est.callGasHex;
          const vg = est.verificationGasLimitHex || est.verificationGasLimit || est.verificationGas;
          const pg = est.preVerificationGasHex || est.preVerificationGas;
          const cgBig = toBigValue(cg);
          const vgBig = toBigValue(vg);
          const pgBig = toBigValue(pg);
          if (cgBig != null) uo.callGasLimit = cgBig;
          if (vgBig != null) uo.verificationGasLimit = vgBig;
          if (pgBig != null) uo.preVerificationGas = pgBig;
          rpcUserOp = toRpcUserOp(uo);
        }
      } catch (estErr) {
        try { console.warn('[aaClient] eth_estimateUserOperationGas failed', estErr); } catch {}
      }
      try {
        const feeData = ctx.publicClient.getFeeData ? await ctx.publicClient.getFeeData() : null;
        if (feeData) {
          const maxFee = toBigValue(feeData.maxFeePerGas || feeData.gasPrice);
          const maxPriority = toBigValue(feeData.maxPriorityFeePerGas || feeData.maxFeePerGas || feeData.gasPrice);
          if (maxFee != null) uo.maxFeePerGas = maxFee;
          if (maxPriority != null) uo.maxPriorityFeePerGas = maxPriority;
          rpcUserOp = toRpcUserOp(uo);
        }
      } catch (feeErr) {
        try { console.warn('[aaClient] fee data fetch failed', feeErr); } catch {}
      }
      uo.callGasLimit = uo.callGasLimit || 1n;
      uo.verificationGasLimit = uo.verificationGasLimit || 0x186a0n;
      uo.preVerificationGas = uo.preVerificationGas || 0x186a0n;
      uo.maxFeePerGas = uo.maxFeePerGas || 0x3b9aca00n;
      uo.maxPriorityFeePerGas = uo.maxPriorityFeePerGas || 0x3b9aca00n;
      rpcUserOp = toRpcUserOp(uo);
      // Submit to bundler
      let opHash = null;
      try { opHash = await rpcCall('eth_sendUserOperation', [rpcUserOp, entryPoint]); }
      catch (sendErr) { try { console.warn('[aaClient] eth_sendUserOperation failed', sendErr); } catch {}; return null; }
      // Poll for receipt to get tx hash
      let txHash = null; const deadline = Date.now() + 20000;
      while (!txHash && Date.now() < deadline) {
        try {
          const rec = await rpcCall('eth_getUserOperationReceipt', [opHash]);
          txHash = (rec && rec.receipt && rec.receipt.transactionHash) || null;
          if (txHash) break;
        } catch (pollErr) { /* keep polling */ }
        await new Promise(r => setTimeout(r, 800));
      }
      if (!txHash) { try { console.warn('[aaClient] no txHash after sendUserOperation', opHash); } catch {} return null; }
      try { window.dispatchEvent(new CustomEvent('aa:gasless', { detail: { mode: '4337', hash: txHash } })); } catch {}
      return txHash;
    } catch (err) {
      console.warn('[aaClient] sendViaZeroDevUO error', err);
      return null;
    }
  }
  const account = { address, type: 'aa4337', getAddress: async () => address, context: null, sendTransaction: (tx) => sendViaAA(tx) };
  return { smartAccount: account, signer };
}
// Expose AA on window for debugging/inspection in the console
try {
  if (typeof window !== 'undefined') {
    window.AA = AA;
  }
} catch {}

export async function initSmartAccount(provider) {
  return initAA({ provider });
}

export async function getAASigner() {
  if (!aaReady || !aaSigner) {
    await initAA({});
  }
  return aaSigner;
}

export function isAAReady() {
  return aaReady;
}

export async function getSmartAccountAddress() { return null; }

export const client = {
  getSigner: () => getAASigner(),
  get smartAccount() { return aaSmartAccount; },
  get smartAccountAddress() { return aaSmartAccount?.address || null; },
  get toolkitContext() { return AA.toolkitContext || null; },
  async sendTransaction(tx) {
    const smart = await initAA({});
    if (smart && typeof smart.sendTransaction === 'function') {
      return smart.sendTransaction(tx);
    }
    const signer = await getAASigner();
    return signer.sendTransaction(tx);
  }
};

// Expose helpers on window for console debugging without import path issues
try {
  if (typeof window !== 'undefined') {
    window.getSmartAccountAddress = getSmartAccountAddress;
  }
} catch {}











