// js/aa/delegation.js
// Delegation helpers backed by the MetaMask Delegation Toolkit.

import { MONAD, getPokerTableAddress } from './config.js';
let viemImportPromise;
async function ensureViem() {
  if (!viemImportPromise) {
    try {
      viemImportPromise = import('viem');
    } catch (_) {
      // Fallback to CDN only if local import resolution fails in-browser.
      viemImportPromise = import('https://esm.sh/viem');
    }
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
const SMART_ACCOUNT_OPT_IN_KEY = 'aa.smartAccount.optIn';

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

function extractAddress(value, seen) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;

  const visited = seen || new Set();
  if (visited.has(value)) return null;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = extractAddress(entry, visited);
      if (resolved) return resolved;
    }
    return null;
  }

  const candidateKeys = [
    'address',
    'account',
    'id',
    'value',
    'owner',
    'target',
    'delegate',
    'delegator'
  ];
  for (const key of candidateKeys) {
    const nested = value[key];
    const resolved = extractAddress(nested, visited);
    if (resolved) return resolved;
  }

  try {
    const str = value.toString?.();
    if (typeof str === 'string' && str && str !== '[object Object]') {
      return str;
    }
  } catch {}

  return null;
}

function toHexString(value) {
  if (!value) return '0x';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '0x';
    return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  }
  if (value instanceof Uint8Array || ArrayBuffer.isView(value)) {
    return `0x${Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
    return `0x${value.map((b) => Number(b).toString(16).padStart(2, '0')).join('')}`;
  }
  try {
    const str = value.toString?.();
    if (typeof str === 'string' && str && str !== '[object Object]') {
      return str.startsWith('0x') ? str : `0x${str}`;
    }
  } catch {}
  return '0x';
}

function sanitizeDelegationStruct(struct, { delegatorHex, delegateHex, viemModule }) {
  const { getAddress } = viemModule;
  const isHexLike = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v);

  const coerceAddress = (value) => {
    try {
      const extracted = extractAddress(value) || (typeof value === 'string' ? value : null);
      if (!extracted) return null;
      return getAddress(extracted);
    } catch {
      return null;
    }
  };

  const deepFixAddresses = (node, seen = new Set()) => {
    if (!node || typeof node !== 'object') return node;
    if (seen.has(node)) return node;
    seen.add(node);
    if (Array.isArray(node)) {
      return node.map((entry) => deepFixAddresses(entry, seen));
    }
    const out = { ...node };
    for (const key of Object.keys(out)) {
      const v = out[key];
      if (!v) continue;
      // Common address-bearing keys
      if (['address','account','owner','target','delegate','delegator','from','to','controller','enforcer'].includes(key)) {
        const fixed = coerceAddress(v);
        if (fixed) { out[key] = fixed; continue; }
      }
      // Terms should be hex bytes
      if (key === 'terms' && typeof v !== 'string') {
        out[key] = toHexString(v);
        continue;
      }
      if (typeof v === 'object') {
        out[key] = deepFixAddresses(v, seen);
      }
    }
    return out;
  };
  const ensureAddress = (value, fallback, label) => {
    const extracted = extractAddress(value) || (typeof value === 'string' ? value : null) || fallback;
    if (!extracted) {
      throw new Error(`${label || 'address'} is missing.`);
    }
    try {
      return getAddress(extracted);
    } catch (err) {
      throw new Error(`${label || 'address'} is invalid: ${extracted}`);
    }
  };

  const input = struct && typeof struct === 'object' ? struct : {};
  const base = { ...input };

  const sanitizedDelegate = ensureAddress(base.delegate ?? base.to, delegateHex, 'Delegate address');
  const sanitizedDelegator = ensureAddress(base.delegator ?? base.from, delegatorHex, 'Delegator address');

  base.from = ensureAddress(base.from, sanitizedDelegator, 'Delegation.from');
  base.delegator = sanitizedDelegator;
  base.to = ensureAddress(base.to, sanitizedDelegate, 'Delegation.to');
  base.delegate = sanitizedDelegate;

  if (!Array.isArray(base.caveats)) {
    base.caveats = [];
  } else {
    base.caveats = base.caveats.map((caveat) => {
      if (!caveat || typeof caveat !== 'object') return caveat;
      const normalized = deepFixAddresses(caveat);
      if (normalized.enforcer) {
        const fixed = coerceAddress(normalized.enforcer);
        if (fixed) normalized.enforcer = fixed;
      }
      if (normalized.terms && typeof normalized.terms !== 'string') {
        try { normalized.terms = toHexString(normalized.terms); } catch { normalized.terms = '0x'; }
      }
      return normalized;
    });
  }

  // Final deep pass to coerce any nested address-like fields
  const final = deepFixAddresses(base);
  return final;
}

export function isDelegationSuppressed() {
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
    const extracted = extractAddress(value);
    if (!extracted || typeof extracted !== 'string') return;
    const trimmed = extracted.trim();
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
        const addr = extractAddress(entry)
          || extractAddress(entry?.address)
          || extractAddress(entry?.account)
          || extractAddress(entry?.id);
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
  const internalLc = normalizeAddress(extractAddress(ctx?.internalAccount))
    || normalizeAddress(extractAddress(AA?.smartAccountAddress))
    || null;

  const prefer = [];
  const push = (value, { prioritize = false } = {}) => {
    const extracted = extractAddress(value);
    if (!extracted || typeof extracted !== 'string') return;
    const normalized = normalizeAddress(extracted);
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

  // Resolve controller (EOA) strictly from ownerAccount/account; never fall back to internal
  const controllerLc = normalizeAddress(extractAddress(ctx.ownerAccount))
    || normalizeAddress(extractAddress(ctx.account))
    || normalizeAddress(extractAddress(AA?.controllerAddress))
    || null;
  // Delegate should be the smart account address (when available), otherwise the provided address
  const internalLc = normalizeAddress(extractAddress(AA?.smartAccountAddress))
    || normalizeAddress(extractAddress(ctx.internalAccount))
    || null;
  const delegate = normalizeAddress(extractAddress(address))
    || internalLc
    || null;
  if (!delegate) {
    throw new Error('Unable to determine smart account address to delegate to. Initialize the smart account first.');
  }
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

  let delegator = smartOwnerHint || controllerLc;
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
  const delegationRaw = toolkit.createDelegation({
    from: delegatorHex,
    to: delegateHex,
    environment,
    scope,
    salt: randomSalt()
  });

  const delegation = sanitizeDelegationStruct(delegationRaw, { delegatorHex, delegateHex, viemModule });

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

    // Prefer internal smart-account signer when available; fallback to walletClient (EOA) otherwise.
  let signature;
  const mm = (smartAccountInstance && smartAccountInstance.mmAccount) || smartAccountInstance || null;
  // If delegating to the internal smart account, prefer internal signing via the toolkit.
  let delegateIsInternal = false;
  try {
    const internalHexTry = internalLc ? viemModule.getAddress(internalLc) : null;
    delegateIsInternal = !!(internalHexTry && internalHexTry.toLowerCase() === delegateHex.toLowerCase());
  } catch {}

  // Only attempt internal signing when delegating to the smart account and the mm signer is available.
  if (delegateIsInternal && mm && typeof mm.signDelegation === 'function') {
    try {
      // Preflight validation to surface any lingering object-shaped addresses
      const viem = ctx.viem || (await ensureViem());
      const { isAddress } = viem;
      const offenders = [];
      const asStr = (v) => (typeof v === 'string' ? v : (v && typeof v.toString === 'function' ? v.toString() : v));
      const checkAddr = (label, v) => { const s = asStr(v); if (!s || typeof s !== 'string' || !isAddress?.(s, { strict: false })) offenders.push(`${label}=${String(s)}`); };
      checkAddr('delegator', delegation.delegator);
      checkAddr('delegate', delegation.delegate);
      (Array.isArray(delegation.caveats) ? delegation.caveats : []).forEach((c, i) => checkAddr(`caveat[${i}].enforcer`, c && c.enforcer));
      if (offenders.length) {
        console.warn('[aa/delegation] preflight found non-address fields:', offenders);
      }
    } catch {}
    try {
      signature = await mm.signDelegation({
        delegation,
        chainId: MONAD.id,
        delegationManager: environment.DelegationManager,
        name: 'DelegationManager',
        version: '1',
        allowInsecureUnrestrictedDelegation: !delegation.caveats || delegation.caveats.length === 0
      });
    } catch (err) {
      console.warn('[aa/delegation] mmAccount.signDelegation failed, falling back to walletClient', err);
    }
  }
  if (!signature) {
    if (delegateIsInternal) {
      // External signature path is blocked by MetaMask for internal-account delegations.
      const helper = new Error('MetaMask Smart Account must sign this delegation internally. Enable Smart Accounts and try again.');
      helper.code = 'delegate_internal_requires_mm_signer';
      suppressDelegation('MetaMask rejected external signature for internal-account delegation');
      throw helper;
    }
    if (!walletClient || typeof walletClient.signTypedData !== 'function') {
      throw new Error('MetaMask wallet client unavailable for delegation signing.');
    }
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
  }
  const signedDelegation = { ...delegation, signature };
  const record = {
    preset: choice.key,
    scope,
    delegation: signedDelegation,
    permissionContext: [[signedDelegation]],
    from: signedDelegation.delegator,
    to: signedDelegation.delegate,
    delegate: signedDelegation.delegate,
    controller: signedDelegation.delegator,
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

export { nowSec };

if (typeof window !== 'undefined') {
  const autoEnsureDelegation = () => {
    try {
      if (localStorage.getItem(SMART_ACCOUNT_OPT_IN_KEY) !== 'true') return;
    } catch {}
    if (isDelegationSuppressed()) return;
    ensureDelegationActive({}).catch((err) => {
      console.warn('[aa/delegation] auto-ensure failed', err);
    });
  };
  window.addEventListener('wallet:connected', autoEnsureDelegation);
  window.addEventListener('aa:smartaccount', autoEnsureDelegation);
}



