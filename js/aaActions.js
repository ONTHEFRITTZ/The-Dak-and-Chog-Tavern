// js/aaActions.js
// Thin, defensive helpers to invoke HoldemPoker via AA (ZeroDev) or fall back to injected signer.
// Assumes HoldemPokerABI.js has been loaded globally and exposes window.HoldemPokerABI.

import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';
import { MONAD_BUNDLER_RPC, getAddressFor, detectChainId } from './config.js';

// We expect aaClient.js to live next to this file and export initAA() / getAASigner() / isAAReady()
// If it doesn't, we gracefully fall back to injected signer.
let aaReady = false;
let aaSigner = null;

async function tryLoadAA() {
  try {
    const mod = await import('./aaClient.js');
    if (!mod || typeof mod.initAA !== 'function') return false;
    await mod.initAA({ bundlerUrl: MONAD_BUNDLER_RPC });
    if (typeof mod.getAASigner === 'function') {
      aaSigner = await mod.getAASigner();
      aaReady = !!aaSigner;
    } else if (mod.client && typeof mod.client.getSigner === 'function') {
      aaSigner = await mod.client.getSigner();
      aaReady = !!aaSigner;
    }
    return aaReady;
  } catch {
    return false;
  }
}

async function getFallbackSigner() {
  // Reuse tavern exports if available
  try {
    const tavern = await import('./tavern.js');
    if (tavern && tavern.signer) return tavern.signer;
  } catch {}
  // Final fallback: build from injected provider
  const injected = (window && (window.__walletProvider || window.ethereum)) || null;
  if (!injected || typeof injected.request !== 'function') throw new Error('No wallet available');
  const provider = new ethers.providers.Web3Provider(injected, 'any');
  return provider.getSigner();
}

async function getSignerPreferAA() {
  if (!aaReady) {
    await tryLoadAA();
  }
  if (aaReady && aaSigner) return aaSigner;
  return getFallbackSigner();
}

async function getPokerContract(signerLike) {
  const signer = signerLike || (await getSignerPreferAA());
  const chainId = await detectChainId(signer.provider || null);
  const addr = await getAddressFor('pokerTable', signer.provider || null);
  if (!addr) throw new Error(`Poker table address not configured for chain ${chainId || '?'}`);
  const abi = (window && window.HoldemPokerABI) || (window && window.holdempokerABI) || null;
  if (!abi) throw new Error('HoldemPoker ABI not found on window (HoldemPokerABI.js must be loaded)');
  return new ethers.Contract(addr, abi, signer);
}

/**
 * Contribute native value to current hand for a given seat.
 * @param {number} seatId
 * @param {string|number|ethers.BigNumber} valueWei
 */
export async function contributeToHand(seatId, valueWei) {
  const signer = await getSignerPreferAA();
  const c = await getPokerContract(signer);
  const v = ethers.BigNumber.from(String(valueWei));
  const tx = await c.contribute(seatId, { value: v });
  return tx.wait?.() || tx;
}

/**
 * Leave during active hand (forfeits contributed amount).
 * @param {number} seatId
 */
export async function leaveDuringHand(seatId) {
  const signer = await getSignerPreferAA();
  const c = await getPokerContract(signer);
  const tx = await c.leaveDuringHand(seatId);
  return tx.wait?.() || tx;
}

// Optional: helper to check AA is ready (for UI badges)
export async function isAAAvailable() {
  if (aaReady) return true;
  return tryLoadAA();
}
