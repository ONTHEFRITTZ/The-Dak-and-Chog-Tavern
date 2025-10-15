// aa-client.js — minimal AA/session-key client w/ budget guardrails (onchain mode only)
// Works with your importmap (viem/permissionless) if present; otherwise falls back to injected.
import { MONAD, AA_FEATURES, getPokerTableAddress, MONAD_BUNDLER_RPC, ZD_PAYMASTER_RPC } from './aa/config.js';
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

async function resolveInjectedProvider(override) {
  if (override && typeof override.request === 'function') return override;
  if (AA.provider) return AA.provider;
  await AA.init();
  return AA.provider;
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

    const deployParams = [ownerAddress, [], [], []];
    let mmAccount;
    try {
      // Build strictly with v0.15+ signature only
      const chainObj = (walletClient && walletClient.chain) || toolkitCtx?.walletChain || publicClient?.chain || {
        id: MONAD.id,
        name: 'Monad Testnet',
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }
      };
      mmAccount = await toMetaMaskSmartAccount({
        owner: ownerAddress,
        chain: chainObj,
        implementation: (Implementation?.Hybrid || Implementation?.EIP7702Stateless || Implementation?.MultiSig),
        transport: walletClient?.transport,
        // Include signer/client for libs that still read them
        signer: { walletClient },
        client: publicClient,
        ...(stored ? { address: stored } : { deployParams, deploySalt: '0x0' })
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
  const injected = await resolveInjectedProvider(provider);
  if (!injected) throw new Error('No provider available for AA');

  if (aaReady && aaSmartAccount && lastBundlerUrl === bundlerUrl) {
    return aaSmartAccount;
  }

  let created = await buildToolkitSmartAccount(injected, { bundlerUrl, paymasterUrl });
  if (!created) {
    created = await createFallbackAccount(injected);
  }

  aaSmartAccount = created.smartAccount;
  aaSigner = created.signer;
  aaReady = true;
  lastBundlerUrl = bundlerUrl;
  AA.smartAccountAddress = aaSmartAccount?.address || null;
  AA.smartAccountType = aaSmartAccount?.type || 'fallback';
  AA.toolkitContext = aaSmartAccount?.context || null;
  AA.controllerAddress = AA.toolkitContext?.ownerAccount || AA.toolkitContext?.account || AA.address || null;
  AA.internalAddress = AA.toolkitContext?.internalAccount || AA.smartAccountAddress || null;
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

export async function getSmartAccountAddress() {
  // If already initialized and not fallback, return it
  if (aaReady && aaSmartAccount && aaSmartAccount.type === 'delegation-toolkit' && aaSmartAccount.address) {
    return aaSmartAccount.address;
  }

  // Attempt a lightweight v15 derivation to compute address without full wiring
  try {
    const toolkitCtx = await ensureDelegationToolkitContext();
    AA.toolkitContext = toolkitCtx;
    let { toolkit, publicClient, walletClient } = toolkitCtx || {};
    let t = toolkit;
    try { if (!t?.toMetaMaskSmartAccount && t?.default) t = t.default; } catch {}
    const toMetaMaskSmartAccount = t?.toMetaMaskSmartAccount;
    const Implementation = t?.Implementation;
    if (typeof toMetaMaskSmartAccount !== 'function') {
      return null;
    }
    const owner = toolkitCtx?.account || toolkitCtx?.ownerAccount;
    if (!owner) return null;
    const chainObj = (walletClient && walletClient.chain) || toolkitCtx?.walletChain || publicClient?.chain || {
      id: MONAD.id,
      name: 'Monad Testnet',
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }
    };
    const deployParams = [owner, [], [], []];
    const acc = await toMetaMaskSmartAccount({
      owner,
      chain: chainObj,
      implementation: (Implementation?.Hybrid || Implementation?.EIP7702Stateless || Implementation?.MultiSig),
      transport: walletClient?.transport,
      deployParams,
      deploySalt: '0x0',
      signer: { walletClient },
      client: publicClient
    });
    const addr = acc && (typeof acc.getAddress === 'function' ? await acc.getAddress() : acc.address);
    if (addr) {
      AA.smartAccountAddress = String(addr).toLowerCase();
      storeSmartAccount(MONAD.id, AA.smartAccountAddress);
      return AA.smartAccountAddress;
    }
  } catch {}

  // Final fallback: initialize AA (may still return fallback EOA)
  if (!aaReady || !aaSmartAccount) {
    await initAA({});
  }
  return aaSmartAccount?.address || null;
}

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
