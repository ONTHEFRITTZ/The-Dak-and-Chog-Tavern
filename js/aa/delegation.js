// js/aa/delegation.js
// Delegation helpers backed by the MetaMask Delegation Toolkit.

import { MONAD, getPokerTableAddress } from './config.js';
import { ensureDelegationToolkitContext, resetDelegationToolkitContext } from './toolkit.js';
import { getSmartAccount } from '../tavern.js';

const STORAGE_KEY = 'aa:delegation:active';
const DEFAULT_TTL = 2 * 60 * 60; // 2 hours

let presetCache = null;
let delegationTarget = null;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function randomSalt() {
  try {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    return '0x' + Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '0x' + Math.random().toString(16).slice(2).padEnd(64, '0');
  }
}

function normalizeAddress(addr) {
  if (!addr) return null;
  return addr.toLowerCase();
}

async function buildCaveats(toolkitCtx, target, selectors) {
  const { environment, viem } = toolkitCtx;
  const caveats = [];

  if (target && environment?.caveatEnforcers?.AllowedTargetsEnforcer) {
    const { concat } = viem;
    const enforcerDef = environment.caveatEnforcers.AllowedTargetsEnforcer;
    const enforcerAddress = typeof enforcerDef === 'string' ? enforcerDef : enforcerDef?.address;
    if (enforcerAddress) {
      caveats.push({
        enforcer: {
          address: enforcerAddress,
          type: 'AllowedTargetsEnforcer'
        },
        terms: concat([target]),
        args: '0x'
      });
    }
  }

  if (selectors && selectors.length && environment?.caveatEnforcers?.AllowedMethodsEnforcer) {
    const { concat } = viem;
    const enforcerDef = environment.caveatEnforcers.AllowedMethodsEnforcer;
    const enforcerAddress = typeof enforcerDef === 'string' ? enforcerDef : enforcerDef?.address;
    if (enforcerAddress) {
      caveats.push({
        enforcer: {
          address: enforcerAddress,
          type: 'AllowedMethodsEnforcer'
        },
        terms: concat(selectors),
        args: '0x'
      });
    }
  }

  return caveats;
}

async function resolveDelegatorAddress() {
  try {
    const smart = await getSmartAccount();
    if (!smart) return null;
    if (typeof smart.getAddress === 'function') {
      return normalizeAddress(await smart.getAddress());
    }
    if (smart.address) return normalizeAddress(smart.address);
  } catch {}
  return null;
}

async function ensurePresetMap() {
  if (presetCache && delegationTarget) return presetCache;

  const ctx = await ensureDelegationToolkitContext();
  const { viem } = ctx;
  delegationTarget = normalizeAddress(await getPokerTableAddress(ctx.provider));

  const toSelector = viem.toFunctionSelector || ((sig) => {
    const { toFunctionSelector } = viem;
    return toFunctionSelector(sig);
  });

  const baseSelectors = [
    'joinSeat(uint8)',
    'unseat(uint8)',
    'leaveDuringHand(uint8)',
    'contribute(uint8,uint256)',
    'beginHand(uint8,uint8,uint8)',
    'settleHand(address[],uint256[])'
  ].map(toSelector);

  const extendedSelectors = baseSelectors.concat([
    'pause(bool)',
    'setPool(address)',
    'setBlinds(uint256,uint256)'
  ].map(toSelector));

  presetCache = {
    playOnly: {
      key: 'playOnly',
      label: 'Poker gameplay only',
      ttlSeconds: DEFAULT_TTL,
      selectors: baseSelectors
    },
    playPlusTableOps: {
      key: 'playPlusTableOps',
      label: 'Poker + table ops',
      ttlSeconds: DEFAULT_TTL,
      selectors: extendedSelectors
    }
  };

  return presetCache;
}

export async function presets() {
  return ensurePresetMap();
}

export async function createDelegation({ address, preset }) {
  const ctx = await ensureDelegationToolkitContext();
  const presetsMap = await ensurePresetMap();
  const choice = preset?.key ? preset : presetsMap[preset] || preset;
  if (!choice || !choice.key) {
    throw new Error('Unknown delegation preset');
  }

  const delegate = normalizeAddress(address || ctx.account);
  if (!delegate) {
    throw new Error('Wallet address is required to create a delegation');
  }
  const delegator = await resolveDelegatorAddress() || delegate;
  const caveats = await buildCaveats(ctx, delegationTarget, choice.selectors || []);

  const { toolkit, environment, walletClient } = ctx;
  const delegation = toolkit.createDelegation({
    from: delegator,
    to: delegate,
    caveats,
    salt: randomSalt()
  });

  const typedData = toolkit.prepareSignDelegationTypedData({
    delegation,
    delegationManager: environment.DelegationManager,
    chainId: MONAD.id,
    allowInsecureUnrestrictedDelegation: caveats.length === 0
  });

  const signature = await walletClient.signTypedData({
    account: delegate,
    ...typedData
  });

  const signedDelegation = { ...delegation, signature };
  const record = {
    preset: choice.key,
    delegation: signedDelegation,
    permissionContext: [[signedDelegation]],
    from: delegator,
    to: delegate,
    createdAt: nowSec(),
    end: nowSec() + (choice.ttlSeconds || DEFAULT_TTL),
    chainId: MONAD.id
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (_) {}

  return record;
}

export function loadDelegation() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.delegation || (parsed.chainId && Number(parsed.chainId) !== MONAD.id)) return null;
    if (parsed.end && Number(parsed.end) < nowSec()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (!parsed.permissionContext) {
      parsed.permissionContext = [[parsed.delegation]];
    }
    return parsed;
  } catch {
    return null;
  }
}

export function revokeDelegation() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  resetDelegationToolkitContext();
  presetCache = null;
  delegationTarget = null;
}

export function isDelegationActive() {
  return !!loadDelegation();
}

export { nowSec };
