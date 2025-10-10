// /js/aa/ops.js
// Helpers to run delegated executions through the MetaMask Delegation Toolkit smart account,
// and fall back to direct EOA transactions when delegation/toolkit is unavailable.

import { ethers } from '../tavern.js';
import { getSmartAccount } from '../tavern.js';
import { AA, initAA } from '../aaClient.js';
import { loadDelegation } from './delegation.js';
import { ensureDelegationToolkitContext } from './toolkit.js';

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
  const smart = await getSmartAccount();
  if (!smart) throw new Error('Smart Account not initialized. Connect wallet first.');
  if (!to) throw new Error('Missing "to" address');

  const tx = {
    to,
    data: ensureHexBytes(data),
    value: valueMON != null ? toWeiMON(valueMON) : 0n,
  };

  // ZeroDev SDK returns { hash } or a tx response. We standardize to string.
  const res = await smart.sendTransaction(tx);
  const txHash = typeof res === 'string' ? res : (res?.hash || res?.transactionHash);
  if (!txHash) {
    console.warn('sendTransaction result:', res);
    throw new Error('Failed to obtain tx hash from AA send');
  }
  return txHash;
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
    const delegationRecord = loadDelegation();
    if (!delegationRecord) {
      return sendTxViaAA({ to, data, valueMON });
    }

    if (!AA.smartAccountType || AA.smartAccountType !== 'delegation-toolkit') {
      await initAA({});
    }

    if (AA.smartAccountType !== 'delegation-toolkit') {
      return sendTxViaAA({ to, data, valueMON });
    }

    const ctx = AA.toolkitContext || await ensureDelegationToolkitContext();
    if (!ctx) {
      return sendTxViaAA({ to, data, valueMON });
    }

    const { toolkit, walletClient, publicClient, environment } = ctx;
    if (!toolkit || !walletClient || !publicClient || !environment?.DelegationManager) {
      return sendTxViaAA({ to, data, valueMON });
    }

    const executionBuilder = toolkit.createExecution;
    const redeemDelegations = toolkit.redeemDelegations;
    const ExecutionMode = toolkit.ExecutionMode;

    if (typeof executionBuilder !== 'function' || typeof redeemDelegations !== 'function') {
      return sendTxViaAA({ to, data, valueMON });
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
    return sendTxViaAA({ to, data, valueMON });
  }
}
