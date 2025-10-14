// js/aa/delegation.js
// Delegation helpers backed by the MetaMask Delegation Toolkit.

import { MONAD, getPokerTableAddress } from './config.js';
let viemImportPromise;
async function ensureViem() {
  if (!viemImportPromise) {
    viemImportPromise = import('https://esm.sh/viem@2.31.4');
  }
  return viemImportPromise;
}

import { ensureDelegationToolkitContext, resetDelegationToolkitContext } from './toolkit.js';
import { getSmartAccount } from '../tavern.js';

const STORAGE_KEY = 'aa:delegation:active';
const DEFAULT_TTL = 2 * 60 * 60; // 2 hours

const SIGNABLE_DELEGATION_TYPED_DATA_FALLBACK = {
  Caveat: [
    { name: 'enforcer', type: 'address' },
    { name: 'terms', type: 'bytes' }
  ],
  Delegation: [
    { name: 'delegate', type: 'address' },
    { name: 'delegator', type: 'address' },
    { name: 'authority', type: 'bytes32' },
    { name: 'caveats', type: 'Caveat[]' },
    { name: 'salt', type: 'uint256' }
  ]
};

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

async function resolveDelegateAddress(ctx, fallback, avoid) {
  const avoidLc = normalizeAddress(avoid);
  const candidates = [];
  const push = (value, { prioritize = false } = {}) => {
    if (!value || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const lc = trimmed.toLowerCase();
    if (lc === avoidLc) return;
    if (prioritize) {
      candidates.unshift(lc);
    } else if (!candidates.includes(lc)) {
      candidates.push(lc);
    }
  };

  try {
    const walletAccounts = await ctx?.provider?.request?.({ method: 'wallet_accounts' });
    if (Array.isArray(walletAccounts)) {
      for (const entry of walletAccounts) {
        const addr = entry?.address || entry?.account || entry?.id || entry?.address?.address;
        const type = String(entry?.type || entry?.accountType || '').toLowerCase();
        if (addr && (!type || type.includes('eoa') || type.includes('external'))) {
          const normalized = normalizeAddress(addr);
          if (normalized && normalized !== avoidLc) {
            return normalized;
          }
        }
      }
    }
  } catch {}

  push(ctx?.account, { prioritize: true });
  push(ctx?.ownerAccount, { prioritize: true });
  push(ctx?.internalAccount, { prioritize: false });
  try { push(ctx?.provider?.selectedAddress, { prioritize: true }); } catch {}
  try { push(ctx?.provider?.selectedWalletAddress, { prioritize: true }); } catch {}

  try { push(window?.walletChoice?.provider?.selectedAddress, { prioritize: true }); } catch {}

  try { push(sessionStorage.getItem('walletAddress'), { prioritize: true }); } catch {}
  try { push(localStorage.getItem('walletAddress'), { prioritize: true }); } catch {}
  try { push(sessionStorage.getItem('walletMsgAddress'), { prioritize: true }); } catch {}
  try { push(localStorage.getItem('aa.controllerAddress'), { prioritize: true }); } catch {}
  try { push(localStorage.getItem('aa.smartAccountAddress'), { prioritize: false }); } catch {}

  (ctx?.accounts || []).forEach((value) => push(value, { prioritize: true }));
  push(fallback, { prioritize: false });

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  if (avoidLc) return avoidLc;

  try {
    const accounts = await ctx?.provider?.request?.({ method: 'eth_accounts' });
    if (Array.isArray(accounts)) {
      const found = accounts.map(normalizeAddress).find((acc) => acc && acc !== avoidLc);
      if (found) return found;
    }
  } catch {}

  return avoidLc || normalizeAddress(fallback || ctx?.accounts?.[0] || null);
}

async function buildFunctionCallScope(toolkitCtx, target, selectors) {
  const viem = toolkitCtx.viem || (await ensureViem());
  const { isAddress, isHex } = viem;

  if (!target) {
    throw new Error('Unable to resolve poker table contract address.');
  }
  if (isAddress && !isAddress(target, { strict: false })) {
    throw new Error('Resolved poker table address is invalid.');
  }

  const selectorList = Array.isArray(selectors) ? selectors.slice() : [];
  const normalized = selectorList
    .map((sig) => (typeof sig === 'string' ? sig.trim() : ''))
    .map((sig) => (sig.startsWith('0x') ? sig.toLowerCase() : `0x${sig.toLowerCase()}`))
    .filter((sig) => sig.length === 10 && (!isHex || isHex(sig)));

  const unique = Array.from(new Set(normalized));
  if (!unique.length) {
    throw new Error('No valid function selectors available for delegation scope.');
  }

  return {
    type: 'functionCall',
    targets: [target],
    selectors: unique
  };
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
  const viemModule = ctx.viem || (await ensureViem());
  delegationTarget = normalizeAddress(await getPokerTableAddress(ctx.provider));

  const toSelector = viemModule.toFunctionSelector || ((sig) => {
    const { toFunctionSelector } = viemModule;
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

export async function createDelegation({ address, preset, presetKey }) {
  const ctx = await ensureDelegationToolkitContext();
  const presetsMap = await ensurePresetMap();
  let choice = null;
  if (preset?.key) {
    choice = preset;
  } else if (presetKey && presetsMap[presetKey]) {
    choice = presetsMap[presetKey];
  } else if (preset && presetsMap[preset]) {
    choice = presetsMap[preset];
  } else {
    choice = presetsMap.playPlusTableOps
      || presetsMap.playOnly
      || Object.values(presetsMap)[0]
      || null;
  }
  if (!choice || !choice.key) {
    throw new Error('Unknown delegation preset');
  }

  const delegatorResolved = await resolveDelegatorAddress();
  const delegate = await resolveDelegateAddress(ctx, address || ctx.ownerAccount || ctx.account, delegatorResolved);
  if (!delegate) {
    throw new Error('Wallet address is required to create a delegation');
  }
  if (delegatorResolved && delegatorResolved === delegate) {
    throw new Error('MetaMask returned a smart account address. Please select the base MetaMask account and try again.');
  }
  const delegator = delegatorResolved || delegate;
  let scope;
  try {
    scope = await buildFunctionCallScope(ctx, delegationTarget, choice.selectors || []);
  } catch (err) {
    console.warn('[aa/delegation] scope creation failed', err);
    throw err;
  }

  const { toolkit, environment, walletClient } = ctx;
  const delegation = toolkit.createDelegation({
    from: delegator,
    to: delegate,
    environment,
    scope,
    salt: randomSalt()
  });

  const toStruct = typeof toolkit.toDelegationStruct === 'function'
    ? toolkit.toDelegationStruct.bind(toolkit)
    : (input) => ({
        delegate: input.delegate,
        delegator: input.delegator || input.from,
        authority: input.authority,
        caveats: Array.isArray(input.caveats) ? input.caveats : [],
        salt: (() => {
          try {
            if (typeof input.salt === 'bigint') return input.salt;
            if (typeof input.salt === 'number') return BigInt(input.salt);
            if (typeof input.salt === 'string' && input.salt) return BigInt(input.salt);
          } catch {}
          return 0n;
        })()
      });

  let typedData;
  if (typeof toolkit.prepareSignDelegationTypedData === 'function') {
    typedData = toolkit.prepareSignDelegationTypedData({
      delegation,
      delegationManager: environment.DelegationManager,
      chainId: MONAD.id,
      allowInsecureUnrestrictedDelegation: !delegation.caveats || delegation.caveats.length === 0
    });
  } else {
    const types = toolkit.SIGNABLE_DELEGATION_TYPED_DATA || SIGNABLE_DELEGATION_TYPED_DATA_FALLBACK;
    typedData = {
      domain: {
        chainId: MONAD.id,
        name: 'DelegationManager',
        version: '1',
        verifyingContract: environment.DelegationManager
      },
      types,
      primaryType: 'Delegation',
      message: toStruct({ ...delegation, delegator, signature: '0x' })
    };
  }

  let signature;
  try {
    signature = await walletClient.signTypedData({
      account: delegate,
      ...typedData
    });
  } catch (err) {
    const msg = String(err?.message || err?.data?.message || '').toLowerCase();
    if (msg.includes('external signature requests') && msg.includes('internal accounts')) {
      const helper = new Error(
        'MetaMask needs to sign this delegation from your base account. Open MetaMask, temporarily disable Smart Accounts for this wallet, approve the signature, then re-enable Smart Accounts.'
      );
      helper.cause = err;
      helper.code = 'delegate_internal_account';
      throw helper;
    }
    throw err;
  }

  const signedDelegation = { ...delegation, signature };
  const record = {
    preset: choice.key,
    scope,
    delegation: signedDelegation,
    permissionContext: [[signedDelegation]],
    from: delegator,
    to: delegate,
    delegate,
    controller: delegator,
    createdAt: nowSec(),
    end: nowSec() + (choice.ttlSeconds || DEFAULT_TTL),
    chainId: MONAD.id
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (_) {}

  return record;
}

let ensureDelegationPromise = null;
export async function ensureDelegationActive({ presetKey, address, force = false } = {}) {
  if (!force) {
    const existing = loadDelegation();
    if (existing && existing.end && nowSec() < existing.end) {
      return existing;
    }
  } else {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
  if (ensureDelegationPromise) {
    try {
      return await ensureDelegationPromise;
    } catch {
      // fallthrough to retry
    }
  }
  ensureDelegationPromise = (async () => {
    const ctx = await ensureDelegationToolkitContext();
    const presetsMap = await ensurePresetMap();
    const choice = presetsMap[presetKey || 'playPlusTableOps']
      || presetsMap.playPlusTableOps
      || presetsMap.playOnly
      || Object.values(presetsMap)[0];
    if (!choice) {
      throw new Error('Delegation presets are unavailable.');
    }
    const delegateAddr = address || ctx.ownerAccount || ctx.account;
    const record = await createDelegation({ address: delegateAddr, preset: choice });
    try {
      localStorage.setItem('aa.delegation.lastPreset', choice.key || '');
    } catch {}
    return record;
  })();
  try {
    const result = await ensureDelegationPromise;
    return result;
  } finally {
    ensureDelegationPromise = null;
  }
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

if (typeof window !== 'undefined') {
  const autoEnsureDelegation = () => {
    ensureDelegationActive({}).catch((err) => {
      console.warn('[aa/delegation] auto-ensure failed', err);
    });
  };
  window.addEventListener('wallet:connected', autoEnsureDelegation);
  window.addEventListener('aa:smartaccount', autoEnsureDelegation);
}
