// js/aa/delegation.js
// Delegation helpers backed by the MetaMask Delegation Toolkit.

import { MONAD, getPokerTableAddress } from './config.js';
let viemImportPromise;
async function ensureViem() {
  if (!viemImportPromise) {
    try {
      viemImportPromise = import('viem');
    } catch (_) {
      // Fallback to pinned CDN version to avoid mixed viem builds.
      viemImportPromise = import('https://esm.sh/viem@2.38.2');
    }
  }
  return viemImportPromise;
}

import { ensureDelegationToolkitContext, resetDelegationToolkitContext } from './toolkit.v15.js';
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

  // Delegation Toolkit v15 expects `targets` to be an array
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
  let ctx = await ensureDelegationToolkitContext();
  try {
    AA.toolkitContext = ctx;
    if (!AA.controllerAddress && ctx?.ownerAccount) {
      AA.controllerAddress = normalizeAddress(ctx.ownerAccount);
    }
  } catch {}
  // Ensure we have an EOA (controller) — if not, prompt the wallet now (user gesture context)
  if (!ctx?.ownerAccount) {
    try {
      await ctx?.provider?.request?.({ method: 'eth_requestAccounts' });
      resetDelegationToolkitContext();
      ctx = await ensureDelegationToolkitContext();
      AA.toolkitContext = ctx;
    } catch {}
  }
  if (!ctx?.ownerAccount) {
    throw new Error('Connect MetaMask before enabling Smart Accounts.');
  }
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
  let delegatorHex = normalizeHex(delegator, 'Delegator address');
  let delegateHex = normalizeHex(delegate, 'Delegate address');
  let scope;
  try {
    scope = await buildFunctionCallScope(ctx, delegationTarget, choice.selectors || []);
  } catch (err) {
    console.warn('[aa/delegation] scope creation failed', err);
    throw err;
  }

  const { toolkit, environment, walletClient, publicClient, walletChain } = ctx;
  // If we have a MetaMask smart account instance, prefer its resolved addresses explicitly
  try {
    const mmTmp = (smartAccountInstance && smartAccountInstance.mmAccount) || smartAccountInstance || null;
    if (mmTmp) {
      const mmOwner = mmTmp.ownerAddress || mmTmp.controllerAddress || mmTmp.controller || null;
      const mmAddr = typeof mmTmp.getAddress === 'function' ? await mmTmp.getAddress() : (mmTmp.address || null);
      if (mmOwner) delegatorHex = normalizeHex(mmOwner, 'Delegator address');
      if (mmAddr) delegateHex = normalizeHex(mmAddr, 'Delegate address');
    }
  } catch {}
  if (delegateHex.toLowerCase() === delegatorHex.toLowerCase()) {
    throw new Error('Resolved delegate equals controller EOA. Enable Smart Accounts first so delegation targets the smart account, not the EOA.');
  }

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

  // Prepare typedData only for diagnostics; we no longer attempt external signTypedData for delegations.
  let typedData;
  try {
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
  } catch {}

    // Prefer internal smart-account signer when available; fallback to walletClient (EOA) otherwise.
  let signature;
  let mm = (smartAccountInstance && smartAccountInstance.mmAccount) || smartAccountInstance || null;
  // Prefer existing mm account. Otherwise, build strictly with v0.15+ signature (no v13 fallback)
  try {
    const { toolkit, walletClient, publicClient, walletChain } = ctx;
    let { toMetaMaskSmartAccount, Implementation } = toolkit || {};
    try { if (!toMetaMaskSmartAccount && toolkit && toolkit.default) toMetaMaskSmartAccount = toolkit.default.toMetaMaskSmartAccount; } catch {}
    try { if (!Implementation && toolkit && toolkit.default) Implementation = toolkit.default.Implementation; } catch {}
    const impl = (Implementation?.Hybrid || Implementation?.EIP7702Stateless || Implementation?.MultiSig || undefined);
    const hasInternalSigner = !!(mm && typeof mm.signDelegation === 'function');
    if (!hasInternalSigner && typeof toMetaMaskSmartAccount === 'function' && walletClient?.transport && delegatorHex) {
      const chainObj = walletClient?.chain || walletChain || publicClient?.chain || {
        id: MONAD.id,
        name: MONAD.name || 'Monad Testnet',
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }
      };
      // Provide simple deploy params for the Hybrid implementation to avoid counterfactual errors
      const deployParams = [delegatorHex, [], [], []];
      const rebuilt = await toMetaMaskSmartAccount({
        owner: delegatorHex,
        chain: chainObj,
        implementation: impl,
        transport: walletClient.transport,
        // Include deploy params/salt for counterfactual derivation
        deployParams,
        deploySalt: '0x0',
        // Provide signer/client for libs that still access them
        signer: { walletClient },
        client: publicClient
      });
      if (rebuilt) mm = rebuilt;
    }
  } catch (e) {
    console.warn('[aa/delegation] toMetaMaskSmartAccount v15 build failed', e);
  }
  // Require internal signing via the toolkit when delegating to the smart account.
  let delegateIsInternal = false;
  if (mm) {
    try {
      const mmAddr = (typeof mm.getAddress === 'function') ? await mm.getAddress() : (mm.address || null);
      if (mmAddr) {
        const mmHex = viemModule.getAddress(mmAddr);
        delegateIsInternal = mmHex.toLowerCase() === delegateHex.toLowerCase();
      }
    } catch {}
  }

  // Only attempt signing when delegating to the smart account and the mm signer is available.
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
      let sigResult = await mm.signDelegation({
        delegation,
        chainId: MONAD.id,
        delegationManager: environment.DelegationManager,
        name: 'DelegationManager',
        version: '1',
        allowInsecureUnrestrictedDelegation: !delegation.caveats || delegation.caveats.length === 0
      });
      // Normalize possible return shapes
      if (typeof sigResult === 'string') signature = sigResult;
      else if (sigResult && typeof sigResult === 'object') {
        signature = sigResult.signature || sigResult.sig || sigResult.data?.signature || null;
      }
    } catch (err) {
      console.warn('[aa/delegation] mmAccount.signDelegation failed (scoped). Retrying with unrestricted delegation.', err);
      try {
        // Retry with an unrestricted delegation using v15 helper when available
        const createOpen = typeof toolkit.createOpenDelegation === 'function' ? toolkit.createOpenDelegation : null;
        const rawLoose = createOpen
          ? createOpen({ from: delegatorHex, to: delegateHex, environment, salt: randomSalt() })
          : toolkit.createDelegation({ from: delegatorHex, to: delegateHex, environment, scope: { type: 'open' }, salt: randomSalt() });
        const loose = sanitizeDelegationStruct(rawLoose, { delegatorHex, delegateHex, viemModule });
        let sigResult2 = await mm.signDelegation({
          delegation: loose,
          chainId: MONAD.id,
          delegationManager: environment.DelegationManager,
          name: 'DelegationManager',
          version: '1',
          allowInsecureUnrestrictedDelegation: true
        });
        if (typeof sigResult2 === 'string') signature = sigResult2;
        else if (sigResult2 && typeof sigResult2 === 'object') {
          signature = sigResult2.signature || sigResult2.sig || sigResult2.data?.signature || null;
        }
        if (signature) {
          // Overwrite delegation used for record with the one that was actually signed
          Object.assign(delegation, loose);
        }
      } catch (err2) {
        console.warn('[aa/delegation] mmAccount.signDelegation failed (unrestricted)', err2);
        try {
          // Final fallback: construct minimal zero-authority unrestricted delegation directly
          const zero32 = '0x' + '00'.repeat(32);
          const minimal = {
            delegate: delegateHex,
            delegator: delegatorHex,
            authority: zero32,
            caveats: [],
            salt: 0n
          };
          let sigResult3 = await mm.signDelegation({
            delegation: minimal,
            chainId: MONAD.id,
            delegationManager: environment.DelegationManager,
            name: 'DelegationManager',
            version: '1',
            allowInsecureUnrestrictedDelegation: true
          });
          if (typeof sigResult3 === 'string') signature = sigResult3;
          else if (sigResult3 && typeof sigResult3 === 'object') {
            signature = sigResult3.signature || sigResult3.sig || sigResult3.data?.signature || null;
          }
          if (signature) {
            Object.assign(delegation, minimal);
          }
        } catch (err3) {
          console.warn('[aa/delegation] mmAccount.signDelegation failed (minimal)', err3);
        }
      }
    }
  }
  if (!signature) {
    console.warn('[aa/delegation] internal signer available but returned no signature', {
      delegateIsInternal,
      controllerLc,
      internalLc,
      mmHasSign: !!(mm && typeof mm.signDelegation === 'function')
    });
    const helper = new Error('MetaMask Smart Account must sign this delegation internally. Enable Smart Accounts and try again.');
    helper.code = 'delegate_mm_signer_required';
    suppressDelegation('Internal signer unavailable or declined for delegation');
    throw helper;
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

// Landing-page helper: issue an unrestricted open delegation without requiring a poker table address.
export async function issueOpenDelegationForLanding() {
  const ctx = await ensureDelegationToolkitContext();
  const { toolkit, environment, walletClient, publicClient, walletChain } = ctx || {};
  if (!toolkit || !ctx?.ownerAccount) {
    throw new Error('MetaMask connection required before enabling Smart Account.');
  }

  const viemModule = ctx.viem || (await ensureViem());
  const normalizeHex = (v) => viemModule.getAddress(v);
  let delegatorHex = normalizeHex(ctx.ownerAccount);

  // Resolve smart account address (delegate)
  let delegateHex = null;
  try {
    if (AA?.smartAccountAddress) delegateHex = normalizeHex(AA.smartAccountAddress);
  } catch {}
  if (!delegateHex) {
    // Build a minimal mm account using v15 signature only
    let { toMetaMaskSmartAccount, Implementation } = toolkit || {};
    try { if (!toMetaMaskSmartAccount && toolkit && toolkit.default) toMetaMaskSmartAccount = toolkit.default.toMetaMaskSmartAccount; } catch {}
    try { if (!Implementation && toolkit && toolkit.default) Implementation = toolkit.default.Implementation; } catch {}
    const impl = (Implementation?.Hybrid || Implementation?.EIP7702Stateless || Implementation?.MultiSig || undefined);
    const chainObj = walletClient?.chain || walletChain || publicClient?.chain || { id: MONAD.id, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 } };
    const deployParams = [delegatorHex, [], [], []];
    const mmTmp = await toMetaMaskSmartAccount({ owner: delegatorHex, chain: chainObj, implementation: impl, transport: walletClient.transport, deployParams, deploySalt: '0x0', signer: { walletClient }, client: publicClient });
    const addr = await mmTmp.getAddress?.();
    if (addr) {
      delegateHex = normalizeHex(addr);
      try { localStorage.setItem('aa.smartAccountAddress', delegateHex); } catch {}
      try { AA.smartAccountAddress = delegateHex; } catch {}
      try { window.dispatchEvent(new CustomEvent('aa:smartaccount', { detail: { address: delegateHex, type: 'delegation-toolkit' } })); } catch {}
    }
  }
  if (!delegateHex) throw new Error('Unable to resolve smart account address.');

  // Create open delegation
  const createOpen = typeof toolkit.createOpenDelegation === 'function' ? toolkit.createOpenDelegation : null;
  const raw = createOpen
    ? createOpen({ from: delegatorHex, to: delegateHex, environment, salt: randomSalt() })
    : toolkit.createDelegation({ from: delegatorHex, to: delegateHex, environment, scope: { type: 'open' }, salt: randomSalt() });

  const delegation = sanitizeDelegationStruct(raw, { delegatorHex, delegateHex, viemModule });

  // Build mm signer again to sign the delegation
  let { toMetaMaskSmartAccount, Implementation } = toolkit || {};
  try { if (!toMetaMaskSmartAccount && toolkit && toolkit.default) toMetaMaskSmartAccount = toolkit.default.toMetaMaskSmartAccount; } catch {}
  try { if (!Implementation && toolkit && toolkit.default) Implementation = toolkit.default.Implementation; } catch {}
  const impl2 = (Implementation?.Hybrid || Implementation?.EIP7702Stateless || Implementation?.MultiSig || undefined);
  const chainObj2 = walletClient?.chain || walletChain || publicClient?.chain || { id: MONAD.id, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 } };
  const deployParams2 = [delegatorHex, [], [], []];
  const mm = await toMetaMaskSmartAccount({ owner: delegatorHex, chain: chainObj2, implementation: impl2, transport: walletClient.transport, deployParams: deployParams2, deploySalt: '0x0', signer: { walletClient }, client: publicClient });

  let signature = null;
  let sigResult = await mm.signDelegation({ delegation, chainId: MONAD.id, delegationManager: environment.DelegationManager, name: 'DelegationManager', version: '1', allowInsecureUnrestrictedDelegation: true });
  if (typeof sigResult === 'string') signature = sigResult;
  else if (sigResult && typeof sigResult === 'object') signature = sigResult.signature || sigResult.sig || sigResult.data?.signature || null;
  if (!signature) throw new Error('Delegation signature was not produced.');

  const signedDelegation = { ...delegation, signature };
  const record = { preset: 'open', scope: { type: 'open' }, delegation: signedDelegation, permissionContext: [[signedDelegation]], from: signedDelegation.delegator, to: signedDelegation.delegate, delegate: signedDelegation.delegate, controller: signedDelegation.delegator, createdAt: nowSec(), end: nowSec() + DEFAULT_TTL, chainId: MONAD.id };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch {}
  try { localStorage.setItem('aa.smartAccount.optIn', 'true'); } catch {}
  try { AA.smartAccountAddress = delegateHex; } catch {}
  try { window.dispatchEvent(new CustomEvent('aa:smartaccount', { detail: { address: delegateHex, type: 'delegation-toolkit' } })); } catch {}
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
    if (!ctx?.toolkit) {
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
    // Delegate must be the smart account address; resolve robustly
    let delegateAddr = address;
    if (!delegateAddr) {
      try { delegateAddr = AA?.smartAccountAddress || null; } catch {}
    }
    if (!delegateAddr) {
      try {
        const smart = await getSmartAccount();
        if (smart) {
          delegateAddr = (typeof smart.getAddress === 'function') ? await smart.getAddress() : (smart.address || null);
        }
      } catch {}
    }
    if (!delegateAddr) {
      // As a last resort, attempt initAA then re-check
      try {
        const smartFromInit = await initAA({});
        if (smartFromInit) {
          delegateAddr = (typeof smartFromInit.getAddress === 'function') ? await smartFromInit.getAddress() : (smartFromInit.address || null);
        }
      } catch {}
    }
    if (!delegateAddr) {
      throw new Error('Smart Account address unavailable. Enable Smart Accounts before creating a delegation.');
    }
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



