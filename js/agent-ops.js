// js/agent-ops.js
// On-chain helpers for poker tables — ZERO direct ZeroDev imports here.
// Uses aaClient.js (if present) to get a Smart Account client, or window.smartAccount.

import { ethers } from './tavern.js';
import { getAddressFor, showToast } from './config.js';

// ---- local state ------------------------------------------------------------
let _isOnChain = false;
let _initialized = false;

// Determine table mode from <html data-table-mode> or ?mode=onchain
function detectOnChain() {
  try {
    const htmlMode = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
    const urlMode = (new URL(location.href)).searchParams.get('mode') || '';
    if (urlMode.toLowerCase() === 'onchain') return true;
    if (htmlMode === 'onchain') return true;
    // also allow naming convention poker-nl-* / poker-fl-* to imply on-chain
    const tableId = (new URL(location.href)).searchParams.get('table') || '';
    if (/^poker-(nl|fl)-/i.test(tableId)) return true;
  } catch {}
  return false;
}

// Provider resolution that doesn't assume tavern.js export timing
function getProvider() {
  try {
    // preferred: tavern.js may have exported provider to window
    if (window.provider && typeof window.provider.getNetwork === 'function') return window.provider;
  } catch {}
  try {
    // fallback: construct from injected
    if (window.ethereum && ethers?.providers?.Web3Provider) {
      return new ethers.providers.Web3Provider(window.ethereum, 'any');
    }
  } catch {}
  return null;
}

function getPokerAbi() {
  const abi = (window && window.HoldemPokerABI);
  if (!abi) throw new Error('HoldemPokerABI not found on window');
  return abi;
}

async function getPokerAddress(provider) {
  const addr = await getAddressFor('pokerTable', provider);
  if (!addr) throw new Error('No pokerTable address for this chain');
  return addr;
}

// Prefer an already-initialized smart account on window; otherwise try aaClient.initSmartAccount
async function getSmartAccount(provider) {
  // If tavern init already placed an SA on window, use it
  try { if (window.smartAccount?.sendTransaction) return window.smartAccount; } catch {}
  // Try lazy init via aaClient.js if present (no direct zerodev import here)
  try {
    const tag = (window.__BUILD_TAG ? String(window.__BUILD_TAG) : String(Date.now()));
    const aa = await import(`./aaClient.js?v=${encodeURIComponent(tag)}`).catch(()=>null);
    if (aa && typeof aa.initSmartAccount === 'function') {
      const sa = await aa.initSmartAccount(provider);
      if (sa?.sendTransaction) {
        try { window.smartAccount = sa; } catch {}
        return sa;
      }
    }
  } catch (e) {
    // surface once in console; UI toasts handled by callers
    console.warn('[AgentOps] Smart account init failed', e);
  }
  return null;
}

async function sendUserOpCall({ provider, to, data, value = 0 }) {
  const sa = await getSmartAccount(provider);
  if (!sa) throw new Error('Smart Account unavailable (aaClient init failed)');
  const tx = {
    to,
    data,
    value: ethers.BigNumber.from(value || 0).toHexString(),
  };
  const uoHash = await sa.sendTransaction(tx);
  // Try to normalize a receipt wait method across SDK variants
  if (typeof sa.waitForUserOperationTransaction === 'function') {
    const mined = await sa.waitForUserOperationTransaction(uoHash);
    return mined || { hash: uoHash };
  }
  if (typeof sa.waitForTx === 'function') {
    const mined = await sa.waitForTx(uoHash);
    return mined || { hash: uoHash };
  }
  // Fallback: return the hash if no waiter available
  return { hash: uoHash };
}

// ---- public API -------------------------------------------------------------
const AgentOps = {
  /**
   * Initialize on first use; detects table mode and warms SA (best-effort).
   */
  async init() {
    if (_initialized) return _isOnChain;
    _initialized = true;
    _isOnChain = detectOnChain();
    if (!_isOnChain) return false;

    // Best-effort warmup: creates provider and smart account so first click is fast
    try {
      const provider = getProvider();
      if (!provider) return true; // still on-chain, but wallet not connected yet
      await getSmartAccount(provider); // ignore result; just warming
    } catch {}
    return true;
  },

  /**
   * Join/sit a seat on-chain (HoldemPoker.joinSeat(uint8)).
   * Off-chain tables: this is a no-op (your socket flow remains the authority).
   */
  async sitSeat(seatIndex) {
    if (!_isOnChain) return null;
    const i = Number(seatIndex) | 0;
    try {
      const provider = getProvider();
      if (!provider) throw new Error('Wallet provider not ready');
      const pokerAddress = await getPokerAddress(provider);
      const iface = new ethers.utils.Interface(getPokerAbi());
      const data = iface.encodeFunctionData('joinSeat', [i]);

      showToast('Requesting on-chain seat…', 'info');
      const rcpt = await sendUserOpCall({ provider, to: pokerAddress, data });
      showToast('Seated on-chain ✓', 'success');
      return rcpt;
    } catch (e) {
      console.warn('[AgentOps.sitSeat] failed', e);
      showToast(e?.message || 'On-chain seat failed', 'error');
      throw e;
    }
  },

  // Alias for API symmetry with some callers
  async joinSeat(seatIndex) {
    return this.sitSeat(seatIndex);
  },

  /**
   * Leave a seat (unseat) — HoldemPoker.unseat(uint8)
   * If you need a forced variant during a hand, pass { force:true } to call leaveDuringHand(uint8).
   */
  async leaveSeat(seatIndex, opts = { force: false }) {
    if (!_isOnChain) return null;
    const i = Number(seatIndex) | 0;
    try {
      const provider = getProvider();
      if (!provider) throw new Error('Wallet provider not ready');
      const pokerAddress = await getPokerAddress(provider);
      const iface = new ethers.utils.Interface(getPokerAbi());
      const fn = opts?.force ? 'leaveDuringHand' : 'unseat';
      const data = iface.encodeFunctionData(fn, [i]);

      showToast('Leaving seat on-chain…', 'info');
      const rcpt = await sendUserOpCall({ provider, to: pokerAddress, data });
      showToast('Left seat on-chain ✓', 'success');
      return rcpt;
    } catch (e) {
      console.warn('[AgentOps.leaveSeat] failed', e);
      showToast(e?.message || 'On-chain leave failed', 'error');
      throw e;
    }
  },

  /**
   * Post contribution (blind/call/raise) — HoldemPoker.contribute(uint8) payable.
   * valueWei is a decimal/hex string or number (wei).
   */
  async contribute(seatIndex, valueWei) {
    if (!_isOnChain) return null;
    const i = Number(seatIndex) | 0;
    try {
      const provider = getProvider();
      if (!provider) throw new Error('Wallet provider not ready');
      const pokerAddress = await getPokerAddress(provider);
      const iface = new ethers.utils.Interface(getPokerAbi());
      const data = iface.encodeFunctionData('contribute', [i]);

      showToast('Posting contribution…', 'info');
      const rcpt = await sendUserOpCall({
        provider,
        to: pokerAddress,
        data,
        value: String(valueWei ?? '0'),
      });
      showToast('Contribution sent ✓', 'success');
      return rcpt;
    } catch (e) {
      console.warn('[AgentOps.contribute] failed', e);
      showToast(e?.message || 'Contribution failed', 'error');
      throw e;
    }
  },
};

// Expose globally so table.js can call it without imports
try { window.AgentOps = AgentOps; } catch {}

// Kick a best-effort init, but don’t block page
AgentOps.init().catch(()=>{});

export default AgentOps;
