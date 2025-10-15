// js/aa/toolkit.js
// Thin loader around the MetaMask Delegation Toolkit + viem helpers.

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
    // If the chain isn't added yet, fall back silently; MetaMask will prompt the user.
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
    // Do NOT assume internal smart account equals the EOA; leave null until built via toolkit
    let internalAccount = null;

    let accountsByType = null;
    // Avoid wallet_accounts on providers that don't implement it to prevent RPC error noise
    walletAccountsSupported = false;

    if (walletAccountsSupported !== false && Array.isArray(accountsByType) && accountsByType.length) {
      walletAccountsSupported = true;
    } else if (walletAccountsSupported === undefined) {
      walletAccountsSupported = false;
    }

    // Skip provider._metamask introspection when wallet_accounts is unsupported to avoid RPC noise.

    if ((!accountsByType || !accountsByType.length) && ownerAccount === internalAccount) {
      try {
        await provider.request({
          method: 'wallet_requestPermissions',
          params: [{ eth_accounts: {} }]
        });
        const extra = await provider.request({ method: 'eth_accounts' });
        if (Array.isArray(extra)) {
          extra.forEach((addr) => {
            const normalized = String(addr || '').toLowerCase();
            if (normalized) requestedSet.add(normalized);
          });
        }
      } catch (permErr) {
        console.warn('[aa/toolkit] permission prompt declined', permErr);
      }
    }

    // If a future provider returns wallet_accounts, we can classify here.

    if (!ownerAccount) ownerAccount = requestedRaw[0] || null;
    if (!internalAccount) internalAccount = requestedRaw[0] || null;

    const account = ownerAccount;
    const accounts = Array.from(new Set([ownerAccount, internalAccount, ...Array.from(requestedSet)].filter(Boolean)));

    // Load viem + MetaMask Delegation Toolkit with CDN fallbacks for browser environments
    const viem = await (async () => {
      try { return await import('viem'); } catch (_) {}
      try { return await import('https://esm.sh/viem@2.38.2'); } catch (_) {}
      // Last resort (should not happen): throw to surface clear error
      throw new Error('Unable to load viem (both local and CDN failed).');
    })();

    async function loadToolkitV15() {
      // If a global is already present (injected elsewhere), use it
      try {
        if (window.__mmdt && typeof window.__mmdt.toMetaMaskSmartAccount === 'function') {
          const tk = window.__mmdt;
          if (tk.Implementation && (tk.Implementation.Hybrid || tk.Implementation.EIP7702Stateless || tk.Implementation.MultiSig)) {
            return tk;
          }
        }
      } catch {}

      // Helper: attempt an import() and normalize default export
      const tryImport = async (spec) => {
        try {
          const mod = await import(spec);
          const tk = (mod && mod.default && !mod.toMetaMaskSmartAccount) ? mod.default : mod;
          if (tk && typeof tk.toMetaMaskSmartAccount === 'function' && tk.Implementation && (tk.Implementation.Hybrid || tk.Implementation.EIP7702Stateless || tk.Implementation.MultiSig)) {
            return tk;
          }
        } catch {}
        return null;
      };

      // Helper: fetch same-origin file and import via blob to bypass wrong MIME
      const tryImportViaBlob = async (spec) => {
        try {
          const u = new URL(spec, location.origin);
          if (u.origin !== location.origin) return null; // only for same-origin
          const res = await fetch(u.toString(), { credentials: 'same-origin' });
          if (!res.ok) return null;
          const code = await res.text();
          const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
          try {
            const mod = await import(blobUrl);
            URL.revokeObjectURL(blobUrl);
            const tk = (mod && mod.default && !mod.toMetaMaskSmartAccount) ? mod.default : mod;
            if (tk && typeof tk.toMetaMaskSmartAccount === 'function' && tk.Implementation && (tk.Implementation.Hybrid || tk.Implementation.EIP7702Stateless || tk.Implementation.MultiSig)) {
              return tk;
            }
          } catch {}
        } catch {}
        return null;
      };

      const candidates = [
        // Prefer same-origin vendored build first (absolute URL to avoid base path issues)
        '/js/vendor/metamask-delegation-toolkit-v15.mjs',
        '/js/vendor/metamask-delegation-toolkit-latest.mjs',
        // Relative fallbacks (when served under /js/aa/ path)
        '../vendor/metamask-delegation-toolkit-v15.mjs',
        '../vendor/metamask-delegation-toolkit-latest.mjs',
        // Pin v15 from CDNs
        'https://esm.sh/@metamask/delegation-toolkit@0.15.3',
        'https://esm.sh/@metamask/delegation-toolkit@0.15.2',
        'https://esm.sh/@metamask/delegation-toolkit@0.15.0',
        'https://unpkg.com/@metamask/delegation-toolkit@0.15.3/dist/index.js?module',
        'https://unpkg.com/@metamask/delegation-toolkit@0.15.0/dist/index.js?module',
        'https://cdn.jsdelivr.net/npm/@metamask/delegation-toolkit@0.15.3/+esm',
        'https://cdn.jsdelivr.net/npm/@metamask/delegation-toolkit@0.15.0/+esm',
        // Local package if available (rare in browser)
        '@metamask/delegation-toolkit'
      ];
      for (const spec of candidates) {
        // Try direct import
        const tk1 = await tryImport(spec);
        if (tk1) return tk1;
        // Try blob-import for same-origin vendor files (handles wrong MIME)
        const tk2 = await tryImportViaBlob(spec);
        if (tk2) return tk2;
      }
      throw new Error('MetaMask Delegation Toolkit v0.15.x unavailable (all sources failed).');
    }

    let toolkit = await loadToolkitV15();

    // Normalize module shape: some CDN builds expose exports under `default`
    // already normalized above

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
      } catch (_) {
        // Ignore inability to define the property; we fall back to returning walletChain separately.
      }
    }

    const environment = normalizeEnvironment(MONAD_DELEGATION_ENV);

    try {
      if (ownerAccount) {
        localStorage.setItem('aa.controllerAddress', ownerAccount);
      }
      if (internalAccount) {
        localStorage.setItem('aa.smartAccountAddress', internalAccount);
      }
    } catch {}

    const walletAccountsList = Array.isArray(accountsByType) ? accountsByType : null;

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


