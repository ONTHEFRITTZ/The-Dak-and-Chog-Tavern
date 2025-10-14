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

    if (walletAccountsSupported !== false) {
      try {
        const walletAccounts = await provider.request({ method: 'wallet_accounts' });
        if (Array.isArray(walletAccounts)) {
          accountsByType = walletAccounts;
          walletAccountsSupported = true;
        }
      } catch (err) {
        if (err?.code === -32601) {
          walletAccountsSupported = false;
        } else {
          console.warn('[aa/toolkit] wallet_accounts request failed', err);
        }
      }
    }

    if ((!accountsByType || !accountsByType.length) && typeof provider._metamask?.getProviderState === 'function') {
      try {
        const state = await provider._metamask.getProviderState();
        if (state?.internalAccounts && typeof state.internalAccounts === 'object') {
          accountsByType = Object.values(state.internalAccounts);
        } else if (state?.accounts && Array.isArray(state.accounts)) {
          accountsByType = state.accounts.map((addr) => ({ address: addr }));
        }
      } catch (stateErr) {
        console.warn('[aa/toolkit] provider state lookup failed', stateErr);
      }
    }

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
        if (addr) {
          const normalized = String(addr).toLowerCase();
          if (!internalAccount) internalAccount = normalized;
          if (!type || type.includes('eoa') || type.includes('external')) {
            ownerAccount = normalized;
            break;
          }
        }
      }
    }

    if (!ownerAccount) ownerAccount = requestedRaw[0] || null;
    if (!internalAccount) internalAccount = requestedRaw[0] || null;

    const account = ownerAccount;
    const accounts = Array.from(new Set([ownerAccount, internalAccount, ...Array.from(requestedSet)].filter(Boolean)));

    const [
      viem,
      toolkit
    ] = await Promise.all([
      import('viem'),
      import('@metamask/delegation-toolkit')
    ]);

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

    return {
      provider,
      accounts,
      account,
      ownerAccount,
      internalAccount,
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
  const ce = env.caveatEnforcers || {};
  Object.keys(ce).forEach((key) => {
    const entry = ce[key];
    if (entry && typeof entry === 'object' && entry.address) {
      if (!entry.type) entry.type = key;
      return;
    }
    if (typeof entry === 'string') {
      ce[key] = { address: entry, type: key };
    }
  });
  env.caveatEnforcers = ce;
  return env;
}
