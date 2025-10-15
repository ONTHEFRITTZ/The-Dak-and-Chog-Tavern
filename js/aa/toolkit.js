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
    const provider = (typeof window.__getSelectedProvider === 'function'
      ? window.__getSelectedProvider()
      : window.ethereum) || null;

    if (!provider || typeof provider.request !== 'function') {
      throw new Error('MetaMask provider not detected');
    }

    await switchToMonad(provider);
    const requestedRaw = await requestAccounts(provider);
    const requestedSet = new Set(requestedRaw.filter(Boolean));
    let ownerAccount = requestedRaw[0] || null;
    let internalAccount = requestedRaw[0] || null;

    let accountsByType = null;
    // Try MetaMask multi-account enumeration to distinguish owner (EOA) vs internal (smart)
    try {
      const listed = await provider.request({ method: 'wallet_accounts' });
      if (Array.isArray(listed) && listed.length) {
        accountsByType = listed;
        walletAccountsSupported = true;
      } else if (walletAccountsSupported === undefined) {
        walletAccountsSupported = false;
      }
    } catch {
      if (walletAccountsSupported === undefined) walletAccountsSupported = false;
    }

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

    if (Array.isArray(accountsByType)) {
      for (const entry of accountsByType) {
        const addr = entry?.address || entry?.account || entry?.id || entry?.address?.address;
        const type = String(entry?.type || entry?.accountType || entry?.accountTypeMetadata?.name || '').toLowerCase();
        if (!addr) continue;
        const normalized = String(addr).toLowerCase();
        if (type.includes('eoa') || type.includes('external')) {
          ownerAccount = normalized;
        } else if (type.includes('smart') || type.includes('internal')) {
          if (!internalAccount) internalAccount = normalized;
        } else {
          if (!ownerAccount) ownerAccount = normalized;
        }
      }
    }

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

    const toolkit = await (async () => {
      try { return await import('@metamask/delegation-toolkit'); } catch (_) {}
      try { return await import('https://esm.sh/@metamask/delegation-toolkit@0.13.0'); } catch (_) {}
      try { return await import('https://cdn.jsdelivr.net/npm/@metamask/delegation-toolkit@0.13.0/+esm'); } catch (_) {}
      throw new Error('Unable to load MetaMask Delegation Toolkit (both local and CDN failed).');
    })();

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

    return {
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
      environment
    };
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


