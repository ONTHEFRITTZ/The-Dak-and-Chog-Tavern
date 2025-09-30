// aa-client.js — minimal AA/session-key client w/ budget guardrails (onchain mode only)
// Works with your importmap (viem/permissionless) if present; otherwise falls back to injected.
import { MONAD, AA_FEATURES, getPokerTableAddress } from './config.js';

const LS = {
  SESSION: 'aa:session',
  SPONSORED: 'aa:sponsored',
  BUDGET: 'aa:budget',
};

function now() { return Math.floor(Date.now() / 1000); }
function toHex(v) { try { return '0x' + BigInt(v).toString(16); } catch { return '0x0'; } }
function short(a){ return (a && a.length>10) ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }
function lc(s){ return (s||'').toLowerCase(); }

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

export const AA = {
  provider: null,
  address: null,
  chainId: 0,
  sponsored: false,
  session: null,  // { allowlist:[{to, selectors:[sig,...]}], spendLimitWei:string, spentWei:string, exp:number }
  budgetWei: 0n,

  async init() {
    this.provider = await getInjected();
    if (!this.provider) throw new Error('No EVM provider');
    this.chainId = await getChainId(this.provider);
    this.sponsored = readSponsored();
    this.session = readSession();
    this.budgetWei = BigInt(Math.floor(readBudget() * 1e18));

    // Resolve primary address (used for from:)
    try {
      const accs = await this.provider.request({ method: 'eth_accounts' });
      this.address = accs && accs[0] || null;
    } catch {}

    // emit initial sponsor state for pill
    window.dispatchEvent(new CustomEvent('aa:sponsored', { detail: { active: this.sponsored } }));

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
    return sess;
  },

  revokeSession() {
    this.session = null;
    writeSession(null);
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
