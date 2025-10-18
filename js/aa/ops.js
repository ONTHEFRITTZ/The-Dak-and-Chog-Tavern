// /js/aa/ops.js
// Helpers to run delegated executions through the MetaMask Delegation Toolkit smart account,
// and fall back to direct EOA transactions when delegation/toolkit is unavailable.

import { ethers } from '../tavern.js';
import { getSmartAccount } from '../tavern.js';
import { ensureDelegationToolkitContext } from './toolkit.js';

function resolveBuildTag() {
  return window.__BUILD_TAG || window.__ASSET_TAG || Date.now();
}

let aaClientModulePromise = null;
async function ensureAAClientModule() {
  if (!aaClientModulePromise) {
    const tag = encodeURIComponent(resolveBuildTag());
    const candidates = [
      `/js/aaClient.js?v=${tag}`,
      `/js/aa/aaClient.js?v=${tag}`
    ];
    aaClientModulePromise = (async () => {
      for (const candidate of candidates) {
        try {
          return await import(/* @vite-ignore */ candidate);
        } catch (err) {
          if (candidate === candidates[candidates.length - 1]) {
            console.warn('[aa/ops] Failed to load aaClient module', err);
          }
        }
      }
      return null;
    })();
  }
  return aaClientModulePromise;
}

async function getAAClient() {
  const mod = await ensureAAClientModule();
  if (!mod) return { AA: null, initAA: null };
  return {
    AA: mod.AA || null,
    initAA: typeof mod.initAA === 'function' ? mod.initAA : null
  };
}

// ---------- Utilities ----------
function toWeiMON(valueMON) {
  if (valueMON == null || valueMON === '') return 0n;
  // Accept number | string
  return BigInt(ethers.utils.parseEther(String(valueMON)).toString());
}
function ensureHexBytes(v) {
  if (!v) return '0x';
  if (typeof v === 'string') return v;
  // Bytes-like
  return ethers.utils.hexlify(v);
}

// Encode from a signature string like "contribute(uint8)"
export function encodeFromSignature(signature, args = []) {
  if (typeof signature !== 'string' || !signature.includes('(')) {
    throw new Error(`Invalid signature: ${signature}`);
  }
  const fn = signature.slice(0, signature.indexOf('('));
  const iface = new ethers.utils.Interface([`function ${signature}`]);
  return iface.encodeFunctionData(fn, args);
}

// ---------- Core: send via AA ----------
/**
 * sendTxViaAA
 * @param {Object} p
 * @param {string} p.to          contract address
 * @param {string|Uint8Array} p.data  calldata (hex string or bytes)
 * @param {string|number} [p.valueMON] optional MON value, human string
 * @returns {Promise<string>} txHash
 */
export async function sendTxViaAA({ to, data, valueMON }) {
  const mod = await ensureAAClientModule();
  let sendFn = null;
  if (mod && mod.client && typeof mod.client.sendTransaction === 'function') {
    sendFn = (tx) => mod.client.sendTransaction(tx);
  } else {
    const smart = await getSmartAccount();
    if (smart && typeof smart.sendTransaction === 'function') {
      sendFn = (tx) => smart.sendTransaction(tx);
    } else if (typeof window !== 'undefined' && window.smartAccount && typeof window.smartAccount.sendTransaction === 'function') {
      sendFn = (tx) => window.smartAccount.sendTransaction(tx);
    }
  }
  if (!sendFn) return null;

  if (!to) throw new Error('Missing "to" address');

  const tx = {
    to,
    data: ensureHexBytes(data),
    value: valueMON != null ? toWeiMON(valueMON) : 0n,
  };

  try {
    const res = await sendFn(tx);
    const txHash = typeof res === 'string' ? res : (res?.hash || res?.transactionHash);
    if (!txHash) {
      console.warn('sendTransaction result:', res);
      return null;
    }
    return txHash;
  } catch (err) {
    try {
      const code = (err && (err.code || err?.data?.code)) || null;
      const msg = String(err?.message || '').toLowerCase();
      // 4001 / ACTION_REJECTED: user cancelled in wallet — suppress noisy logs
      if (code === 4001 || code === 'ACTION_REJECTED' || msg.includes('user denied') || msg.includes('user rejected')) {
        return null;
      }
    } catch {}
    console.warn('[aa/ops] sendTxViaAA failed', err);
    return null;
  }
}

// ---------- Delegation-aware helper ----------
// Ensures an active delegation session, then encodes and sends a tx via AA.
// Returns txHash or null. Suppresses user-cancel noise.
export async function callWithDelegation({ to, signature, args = [], valueMON }) {
  try {
    // Ensure delegation is active (best-effort; do not block if unavailable)
    try {
      const mod = await import('./delegation.js');
      if (mod && typeof mod.ensureDelegationActive === 'function') {
        await mod.ensureDelegationActive({});
      }
    } catch {}
    const data = encodeFromSignature(signature, args);
    return await sendTxViaAA({ to, data, valueMON });
  } catch (err) {
    try {
      const code = (err && (err.code || err?.data?.code)) || null;
      const msg = String(err?.message || '').toLowerCase();
      if (code === 4001 || code === 'ACTION_REJECTED' || msg.includes('user denied') || msg.includes('user rejected')) {
        return null;
      }
    } catch {}
    console.warn('[aa/ops] callWithDelegation failed', err);
    return null;
  }
}
const SMART_ACCOUNT_OPT_IN_KEY = 'aa.smartAccount.optIn';
function isSmartAccountOptedIn() {
  try { return localStorage.getItem(SMART_ACCOUNT_OPT_IN_KEY) === 'true'; } catch { return false; }
}



