// js/aa/toolkit.v15.js
// v15-only loader around the MetaMask Delegation Toolkit + viem helpers.

import { MONAD } from './config.js';
import { MONAD_DELEGATION_ENV, MONAD_DELEGATION_VERSION } from './delegation-config.js';

const MONAD_CHAIN = {
  id: MONAD.id,
  name: MONAD.name || 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [MONAD.rpcHttp] },
    public: { http: [MONAD.rpcHttp] }
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: MONAD.explorer || 'https://testnet.monadexplorer.com' }
  }
};

let contextPromise = null;
let walletAccountsSupported = undefined;

async function requestAccounts(provider) {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts || !accounts.length) {
    throw new Error('Wallet connection required');
  }
  return accounts.map(a => a.toLowerCase());
}

async function switchToMonad(provider) {
  try {
    const chainIdHex = '0x' + MONAD.id.toString(16);
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }]
    });
  } catch (err) {
    if (err?.code === 4902) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x' + MONAD.id.toString(16),
            chainName: MONAD.name || 'Monad Testnet',
            rpcUrls: [MONAD.rpcHttp],
            nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
            blockExplorerUrls: MONAD.explorer ? [MONAD.explorer] : undefined
          }]
        });
      } catch (_) {}
    }
  }
}

async function loadToolkitV15() {
  try {
    if (window.__mmdt && typeof window.__mmdt.toMetaMaskSmartAccount === 'function') {
      const tk = window.__mmdt;
      if (tk.Implementation && (tk.Implementation.Hybrid || tk.Implementation.EIP7702Stateless || tk.Implementation.MultiSig)) {
        return tk;
      }
    }
  } catch {}

  const tryImportViaBlob = async (spec) => {
    try {
      const u = new URL(spec, location.origin);
      if (u.origin !== location.origin) return null;
      const res = await fetch(u.toString(), { credentials: 'same-origin' });
      if (!res.ok) return null;
      let code = await res.text();
      try {
        // Normalize jsDelivr-style ESM sub-imports to esm.sh (more reliable)
        code = code
          // Double-quoted imports
          .replace(/"\/npm\/(.*?)\/\+esm"/g, '"https://esm.sh/$1"')
          // Single-quoted imports
          .replace(/'\/npm\/(.*?)\/\+esm'/g, '\'https://esm.sh/$1\'');
      } catch {}
      const vendorUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      // Wrap the vendor as a module that attaches exports to window.__mmdt as well
      const wrapperCode = `import * as M from "${vendorUrl}"; try { window.__mmdt = M; } catch {} export default M;`;
      const wrapperUrl = URL.createObjectURL(new Blob([wrapperCode], { type: 'text/javascript' }));
      try {
        const mod = await import(wrapperUrl);
        URL.revokeObjectURL(wrapperUrl);
        URL.revokeObjectURL(vendorUrl);
        let tk = (mod && mod.default && !mod.toMetaMaskSmartAccount && !mod.toSmartAccount) ? mod.default : mod;
        // Shim: older builds expose toSmartAccount; normalize to toMetaMaskSmartAccount
        try { if (tk && !tk.toMetaMaskSmartAccount && typeof tk.toSmartAccount === 'function') tk.toMetaMaskSmartAccount = tk.toSmartAccount; } catch {}
        // Shim: provide minimal Implementation map if absent
        try { if (tk && !tk.Implementation) tk.Implementation = { Hybrid: 'Hybrid', EIP7702Stateless: 'Stateless7702', MultiSig: 'MultiSig' }; } catch {}
        if (tk && typeof tk.toMetaMaskSmartAccount === 'function') {
          return tk;
        }
      } catch {}
    } catch {}
    return null;
  };

  const vendors = [
    '/js/vendor/metamask-delegation-toolkit-latest.mjs',
    '../vendor/metamask-delegation-toolkit-latest.mjs'
  ];
  for (const spec of vendors) {
    const tk = await tryImportViaBlob(spec);
    if (tk) return tk;
  }
  throw new Error('MetaMask Delegation Toolkit v0.15.x vendor file not found or unreadable. Ensure /js/vendor/metamask-delegation-toolkit-latest.mjs exists.');
}

export async function ensureDelegationToolkitContext() {
  if (contextPromise) return contextPromise;

  contextPromise = (async () => {
    function pickMetaMaskProvider() {
      try {
        const winEth = window.ethereum;
        if (winEth && Array.isArray(winEth.providers)) {
          const mm = winEth.providers.find(p => p && p.isMetaMask && typeof p.request === 'function');
          if (mm) return mm;
        }
        if (winEth && winEth.isMetaMask && typeof winEth.request === 'function') return winEth;
      } catch {}
      return null;
    }
    const provider = (typeof window.__getSelectedProvider === 'function'
      ? window.__getSelectedProvider('metamask')
      : null) || pickMetaMaskProvider() || window.ethereum || null;

    if (!provider || typeof provider.request !== 'function') {
      throw new Error('MetaMask provider not detected');
    }

    await switchToMonad(provider);
    const requestedRaw = await requestAccounts(provider);
    const requestedSet = new Set(requestedRaw.filter(Boolean));
    let ownerAccount = requestedRaw[0] || null;
    let internalAccount = null;

    walletAccountsSupported = false;

    if ((!ownerAccount || !internalAccount)) {
      try {
        await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
        const extra = await provider.request({ method: 'eth_accounts' });
        if (Array.isArray(extra)) {
          extra.forEach((addr) => {
            const normalized = String(addr || '').toLowerCase();
            if (normalized) requestedSet.add(normalized);
          });
        }
      } catch (_) {}
    }

    if (!ownerAccount) ownerAccount = requestedRaw[0] || null;
    if (!internalAccount) internalAccount = null;

    const account = ownerAccount;
    const accounts = Array.from(new Set([ownerAccount, internalAccount, ...Array.from(requestedSet)].filter(Boolean)));

    const viem = await (async () => {
      try { return await import('viem'); } catch (_) {}
      try { return await import('https://esm.sh/viem@2.38.2'); } catch (_) {}
      throw new Error('Unable to load viem (both local and CDN failed).');
    })();

    const toolkit = await loadToolkitV15();

    const { createPublicClient, createWalletClient, http, custom } = viem;

    try {
      const overrideDeployedEnvironment = toolkit?.overrideDeployedEnvironment;
      if (typeof overrideDeployedEnvironment === 'function') {
        overrideDeployedEnvironment(
          MONAD.id,
          toolkit?.PREFERRED_VERSION || MONAD_DELEGATION_VERSION,
          MONAD_DELEGATION_ENV
        );
      }
    } catch (err) {
      console.warn('Delegation toolkit override failed', err);
    }

    const publicClient = createPublicClient({
      chain: MONAD_CHAIN,
      transport: http(MONAD.rpcHttp)
    });

    const walletClient = createWalletClient({
      account: account,
      chain: MONAD_CHAIN,
      transport: custom(provider)
    });

    const walletChain = walletClient?.chain || MONAD_CHAIN;
    if (walletClient && !walletClient.chain) {
      try {
        Object.defineProperty(walletClient, 'chain', {
          configurable: true,
          enumerable: true,
          value: walletChain,
          writable: false
        });
      } catch (_) {}
    }

    const environment = normalizeEnvironment(MONAD_DELEGATION_ENV);

    try {
      if (ownerAccount) {
        localStorage.setItem('aa.controllerAddress', ownerAccount);
      }
    } catch {}

    const walletAccountsList = null;

    const ctx = {
      provider,
      accounts,
      account,
      ownerAccount,
      internalAccount,
      walletAccounts: walletAccountsList,
      walletAccountsSupported,
      viem,
      toolkit,
      publicClient,
      walletClient,
      walletChain,
      environment
    };

    try { window.__mmdt = toolkit; } catch {}
    try { window.__aaToolkitContext = ctx; } catch {}
    return ctx;
  })().catch(err => {
    contextPromise = null;
    throw err;
  });

  return contextPromise;
}

export function resetDelegationToolkitContext() {
  contextPromise = null;
}
function normalizeEnvironment(source) {
  const env = JSON.parse(JSON.stringify(source || {}));
  try {
    if (env && env.caveatEnforcers && typeof env.caveatEnforcers === 'object') {
      Object.keys(env.caveatEnforcers).forEach((k) => {
        const v = env.caveatEnforcers[k];
        env.caveatEnforcers[k] = (v && typeof v === 'object' && typeof v.address === 'string') ? v.address : v;
      });
    }
  } catch {}
  return env;
}
