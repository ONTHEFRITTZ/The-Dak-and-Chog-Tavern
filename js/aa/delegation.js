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
import { AA, initAA } from '../aaClient.js';
import { getSmartAccount } from '../tavern.js';

const STORAGE_KEY = 'aa:delegation:active';
const DEFAULT_TTL = 2 * 60 * 60; // 2 hours
const DELEGATION_SUPPRESS_KEY = 'aa:delegation:suppress';
const DELEGATION_SUPPRESS_PERSIST_KEY = 'aa:delegation:suppress:persist';

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
let walletAccountsSupported = undefined;

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

function isDelegationSuppressed() {
  try {
    if (sessionStorage.getItem(DELEGATION_SUPPRESS_KEY) === 'true') return true;
  } catch {}
  try {
    if (localStorage.getItem(DELEGATION_SUPPRESS_PERSIST_KEY) === 'true') return true;
  } catch {}
  return false;
}

function suppressDelegation(reason) {
  try { sessionStorage.setItem(DELEGATION_SUPPRESS_KEY, 'true'); } catch {}
  try { localStorage.setItem(DELEGATION_SUPPRESS_PERSIST_KEY, 'true'); } catch {}
  if (reason) console.warn('[aa/delegation] Delegation suppressed:', reason);
  else console.warn('[aa/delegation] Delegation suppressed.');
}

export function clearDelegationSuppression() {
  try { sessionStorage.removeItem(DELEGATION_SUPPRESS_KEY); } catch {}
  try { localStorage.removeItem(DELEGATION_SUPPRESS_PERSIST_KEY); } catch {}
}

async function getWalletAccounts(ctx) {
  if (ctx?.walletAccountsSupported === false) {
    walletAccountsSupported = false;
  }
  if (walletAccountsSupported === false) {
    return Array.isArray(ctx?.walletAccounts) ? ctx.walletAccounts : [];
  }
  if (Array.isArray(ctx?.walletAccounts) && ctx.walletAccounts.length) {
    walletAccountsSupported = true;
    return ctx.walletAccounts;
  }
  walletAccountsSupported = false;
  return [];
}

async function resolveDelegateAddress(ctx, fallback, avoid, smartAccountInstance) {
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
    const walletAccounts = await getWalletAccounts(ctx);
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
  try {
    let smart = smartAccountInstance;
    if (!smart) {
      smart = await getSmartAccount();
    }
    const ctxMaybe = smart?.context || smart?.toolkitContext || null;
    if (ctxMaybe) {
      push(ctxMaybe.ownerAccount, { prioritize: true });
      push(ctxMaybe.account, { prioritize: true });
      push(ctxMaybe.controllerAddress, { prioritize: true });
      push(ctxMaybe.internalAccount, { prioritize: false });
    }
    if (smart?.controllerAddress) {
      push(typeof smart.controllerAddress === 'function' ? await smart.controllerAddress() : smart.controllerAddress, { prioritize: true });
    }
    if (smart?.mmAccount?.ownerAddress) {
      push(smart.mmAccount.ownerAddress, { prioritize: true });
    }
  } catch {}

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
  const { isAddress, isHex, getAddress } = viem;

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

  const targetHex = getAddress ? getAddress(target) : target;

  return {
    type: 'functionCall',
    targets: [targetHex],
    selectors: unique
  };
}

async function resolveDelegatorAddress(ctx, smartAccountInstance) {
  const internalLc = normalizeAddress(ctx?.internalAccount)
    || normalizeAddress(AA?.smartAccountAddress)
    || null;

  const prefer = [];
  const push = (value, { prioritize = false } = {}) => {
    if (!value || typeof value !== 'string') return;
    const normalized = normalizeAddress(value);
    if (!normalized) return;
    if (prefer.includes(normalized)) return;
    if (prioritize) {
      prefer.unshift(normalized);
    } else {
      prefer.push(normalized);
    }
  };

  push(ctx?.ownerAccount, { prioritize: true });
  push(ctx?.account, { prioritize: true });
  try { push(ctx?.provider?.selectedAddress, { prioritize: true }); } catch {}
  try { push(ctx?.provider?.selectedWalletAddress, { prioritize: true }); } catch {}
  (ctx?.accounts || []).forEach((value) => push(value, { prioritize: false }));

  try { push(AA?.controllerAddress, { prioritize: true }); } catch {}
  try { push(AA?.address, { prioritize: false }); } catch {}

  try { push(localStorage.getItem('aa.controllerAddress'), { prioritize: true }); } catch {}
  try { push(sessionStorage.getItem('walletAddress'), { prioritize: true }); } catch {}
  try { push(localStorage.getItem('walletAddress'), { prioritize: true }); } catch {}

  try {
    let smart = smartAccountInstance;
    if (!smart) {
      smart = await getSmartAccount();
    }
    if (smart) {
      push(smart.controllerAddress, { prioritize: true });
      push(smart.controller, { prioritize: true });
      push(smart.ownerAddress, { prioritize: true });
      const ctxMaybe = smart.context || smart.toolkitContext || null;
      if (ctxMaybe) {
        push(ctxMaybe.ownerAccount, { prioritize: true });
        push(ctxMaybe.account, { prioritize: true });
      }
    }
  } catch {}

  for (const candidate of prefer) {
    if (candidate && candidate !== internalLc) {
      return candidate;
    }
  }

  return prefer[0] || null;
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
  if (!ctx?.walletClient || typeof ctx.walletClient.signTypedData !== 'function') {
    throw new Error('MetaMask wallet client unavailable for delegation signing.');
  }
  const presetsMap = await ensurePresetMap();

  let smartAccountInstance = null;
  try {
    smartAccountInstance = await getSmartAccount();
  } catch {}
  if (!smartAccountInstance || typeof smartAccountInstance !== 'object') {
    smartAccountInstance = null;
  }
  if (!smartAccountInstance || (!smartAccountInstance.signDelegation && !(smartAccountInstance.mmAccount && smartAccountInstance.mmAccount.signDelegation))) {
    try {
      const smartFromInit = await initAA({});
      if (smartFromInit) smartAccountInstance = smartFromInit;
    } catch (err) {
      console.warn('[aa/delegation] initAA for delegation context failed', err);
    }
  }

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

  const delegatorResolved = await resolveDelegatorAddress(ctx, smartAccountInstance);
  const delegate = await resolveDelegateAddress(ctx, address || ctx.ownerAccount || ctx.account, delegatorResolved, smartAccountInstance);
  if (!delegate) {
    throw new Error('Wallet address is required to create a delegation');
  }
  const internalLc = normalizeAddress(ctx.internalAccount)
    || normalizeAddress(AA?.smartAccountAddress)
    || null;
  const controllerLc = normalizeAddress(ctx.ownerAccount)
    || normalizeAddress(AA?.controllerAddress)
    || null;
  const smartAccountActive = internalLc && controllerLc && internalLc !== controllerLc;
  const smartOwnerHint = (() => {
    const smart = smartAccountInstance;
    const mm = smart?.mmAccount || smart;
    return normalizeAddress(
      mm?.ownerAddress
      || mm?.controllerAddress
      || mm?.controller
      || smart?.controllerAddress
      || smart?.controller
    );
  })();

  let delegator = delegatorResolved || smartOwnerHint || controllerLc || delegate;
  if (smartAccountActive && delegator === internalLc) {
    if (smartOwnerHint && smartOwnerHint !== internalLc) {
      delegator = smartOwnerHint;
    } else if (controllerLc && controllerLc !== internalLc) {
      delegator = controllerLc;
    } else {
      throw new Error('MetaMask did not expose the base account controller. Temporarily disable Smart Accounts, approve the delegation, then re-enable them.');
    }
  }
  if (!delegator) {
    throw new Error('MetaMask controller address unavailable. Please reconnect your wallet and try again.');
  }
  const viemModule = ctx.viem || (await ensureViem());
  const normalizeHex = (value, label) => {
    if (!value) {
      throw new Error(`${label || 'address'} is missing.`);
    }
    try {
      return viemModule.getAddress(value);
    } catch (err) {
      throw new Error(`${label || 'address'} is invalid: ${value}`);
    }
  };
  const delegatorHex = normalizeHex(delegator, 'Delegator address');
  const delegateHex = normalizeHex(delegate, 'Delegate address');
  let scope;
  try {
    scope = await buildFunctionCallScope(ctx, delegationTarget, choice.selectors || []);
  } catch (err) {
    console.warn('[aa/delegation] scope creation failed', err);
    throw err;
  }

  const { toolkit, environment, walletClient } = ctx;
  const delegation = toolkit.createDelegation({
    from: delegatorHex,
    to: delegateHex,
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
      message: toStruct({ ...delegation, delegator: delegatorHex, signature: '0x' })
    };
  }

  if (!walletClient || typeof walletClient.signTypedData !== 'function') {
    throw new Error('MetaMask wallet client unavailable for delegation signing.');
  }

  let signature;
  try {
    signature = await walletClient.signTypedData({
      account: delegatorHex,
      ...typedData
    });
  } catch (err) {
    const msg = String(err?.message || err?.data?.message || '').toLowerCase();
    if (msg.includes('external signature requests') && msg.includes('internal accounts')) {
      suppressDelegation('MetaMask rejected delegation for smart account');
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
    clearDelegationSuppression();
  }
  if (isDelegationSuppressed()) return null;
  if (ensureDelegationPromise) {
    try {
      return await ensureDelegationPromise;
    } catch {
      // fallthrough to retry
    }
  }
  ensureDelegationPromise = (async () => {
    const ctx = await ensureDelegationToolkitContext();
    if (!ctx?.walletClient || typeof ctx.walletClient.signTypedData !== 'function') {
      return null;
    }
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

export { nowSec, isDelegationSuppressed };

if (typeof window !== 'undefined') {
  const autoEnsureDelegation = () => {
    ensureDelegationActive({}).catch((err) => {
      console.warn('[aa/delegation] auto-ensure failed', err);
    });
  };
  window.addEventListener('wallet:connected', autoEnsureDelegation);
  window.addEventListener('aa:smartaccount', autoEnsureDelegation);
}
