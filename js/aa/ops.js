// /js/aa/ops.js
// Helpers to run delegated executions through the MetaMask Delegation Toolkit smart account,
// and fall back to direct EOA transactions when delegation/toolkit is unavailable.

import { ethers } from '../tavern.js';
import { getSmartAccount } from '../tavern.js';
import { loadDelegation } from './delegation.js';
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
  await ensureAAClientModule();
  const smart = await getSmartAccount();
  if (!smart || typeof smart.sendTransaction !== 'function') return null;
  if (!to) throw new Error('Missing "to" address');

  const tx = {
    to,
    data: ensureHexBytes(data),
    value: valueMON != null ? toWeiMON(valueMON) : 0n,
  };

  try {
    const res = await smart.sendTransaction(tx);
    const txHash = typeof res === 'string' ? res : (res?.hash || res?.transactionHash);
    if (!txHash) {
      console.warn('sendTransaction result:', res);
      return null;
    }
    return txHash;
  } catch (err) {
    console.warn('[aa/ops] sendTxViaAA failed', err);
    return null;
  }
}

/**
 * callWithDelegation
 * A convenience wrapper that:
 *  - encodes a function call from a signature string
 *  - uses AA to send (the "delegation" is managed on-chain or in the session layer)
 *
 * @param {Object} p
 * @param {string} p.to                 contract address (default: HoldemPoker if provided)
 * @param {string} p.signature          e.g. "contribute(uint8)"
 * @param {Array}  p.args               array of args for the function
 * @param {string|number} [p.valueMON]  optional value in MON
 * @returns {Promise<string>} txHash
 */
export async function callWithDelegation({ to, signature, args = [], valueMON }) {
  // If the page loaded window.HoldemPokerABI + a known contract address, we can default `to`.
  // But since your app routes per-page, best to pass `to`.
  if (!to) {
    // Try to discover from window if omitted (safe best-effort)
    try {
      if (window && window.HoldemPokerAddress) {
        to = window.HoldemPokerAddress;
      }
    } catch (_) {}
  }
  if (!to) throw new Error('Missing "to" address for callWithDelegation');

  const data = encodeFromSignature(signature, args);

  try {
    const { AA, initAA } = await getAAClient();
    if (!AA || typeof initAA !== 'function') {
      const directHash = await sendTxViaAA({ to, data, valueMON });
      return directHash || false;
    }

    const delegationRecord = loadDelegation();
    if (!delegationRecord) {
      const directHash = await sendTxViaAA({ to, data, valueMON });
      return directHash || false;
    }

    if (!AA.smartAccountType || AA.smartAccountType !== 'delegation-toolkit') {
      await initAA({});
    }

    if (AA.smartAccountType !== 'delegation-toolkit') {
      const directHash = await sendTxViaAA({ to, data, valueMON });
      return directHash || false;
    }

    const ctx = AA.toolkitContext || await ensureDelegationToolkitContext();
    if (!ctx) {
      const directHash = await sendTxViaAA({ to, data, valueMON });
      return directHash || false;
    }

    const { toolkit, walletClient, publicClient, environment } = ctx;
    if (!toolkit || !walletClient || !publicClient || !environment?.DelegationManager) {
      const directHash = await sendTxViaAA({ to, data, valueMON });
      return directHash || false;
    }

    const executionBuilder = toolkit.createExecution;
    const redeemDelegations = toolkit.redeemDelegations;
    const ExecutionMode = toolkit.ExecutionMode;

    if (typeof executionBuilder !== 'function' || typeof redeemDelegations !== 'function') {
      const directHash = await sendTxViaAA({ to, data, valueMON });
      return directHash || false;
    }

    const executions = [
      executionBuilder({
        target: to,
        value: valueMON != null ? toWeiMON(valueMON) : 0n,
        callData: data
      })
    ];

    const redemption = {
      permissionContext: delegationRecord.permissionContext || [[delegationRecord.delegation]],
      executions,
      mode: ExecutionMode?.SingleDefault || '0x0000000000000000000000000000000000000000000000000000000000000000'
    };

    const txHash = await redeemDelegations(
      walletClient,
      publicClient,
      environment.DelegationManager,
      [redemption]
    );

    if (!txHash) {
      throw new Error('Delegation redemption returned no transaction hash');
    }

    return txHash;
  } catch (err) {
    console.warn('[aa/ops] Delegated call failed, falling back to AA send', err);
    const directHash = await sendTxViaAA({ to, data, valueMON });
    return directHash || false;
  }
}
