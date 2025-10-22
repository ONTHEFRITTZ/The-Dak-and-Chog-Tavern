// js/aa/toolkit.js
// Minimal v13-compatible context: builds viem clients and exposes walletClient/publicClient
// Does not require or import the MetaMask Delegation Toolkit vendor.

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

async function requestAccounts(provider) {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts || !accounts.length) throw new Error('Wallet connection required');
  return accounts.map(a => a.toLowerCase());
}

async function switchToMonad(provider) {
  try {
    const chainIdHex = '0x' + MONAD.id.toString(16);
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
  } catch (err) {
    if (err?.code === 4902) {
      try {
        await provider.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: '0x' + MONAD.id.toString(16),
          chainName: MONAD.name || 'Monad Testnet',
          rpcUrls: [MONAD.rpcHttp],
          nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
          blockExplorerUrls: MONAD.explorer ? [MONAD.explorer] : undefined
        }] });
      } catch (_) {}
    }
  }
}

export async function ensureDelegationToolkitContext() {
  if (contextPromise) return contextPromise;
  contextPromise = (async () => {
    function pickProvider() {
      try { if (typeof window.__getSelectedProvider === 'function') return window.__getSelectedProvider('metamask'); } catch {}
      try { if (window.ethereum && typeof window.ethereum.request === 'function') return window.ethereum; } catch {}
      try { if (window.phantom?.ethereum?.request) return window.phantom.ethereum; } catch {}
      return null;
    }
    const provider = pickProvider();
    if (!provider) throw new Error('EVM provider not detected');
    await switchToMonad(provider);
    const [ownerAccount] = await requestAccounts(provider);

    const viem = await (async () => {
      try { return await import('viem'); } catch (_) {}
      try { return await import('https://esm.sh/viem@2.31.4'); } catch (_) {}
      throw new Error('Unable to load viem');
    })();
    const { createPublicClient, createWalletClient, http, custom } = viem;

    const publicClient = createPublicClient({ chain: MONAD_CHAIN, transport: http(MONAD.rpcHttp) });
    const walletClient = createWalletClient({ account: ownerAccount, chain: MONAD_CHAIN, transport: custom(provider) });

    const ctx = {
      provider,
      accounts: [ownerAccount],
      account: ownerAccount,
      ownerAccount,
      internalAccount: null,
      walletAccounts: null,
      walletAccountsSupported: false,
      viem,
      toolkit: {}, // no vendor in v13 path
      publicClient,
      walletClient,
      walletChain: MONAD_CHAIN,
      environment: normalizeEnvironment(MONAD_DELEGATION_ENV)
    };
    try { window.__aaToolkitContext = ctx; } catch {}
    return ctx;
  })().catch(err => { contextPromise = null; throw err; });
  return contextPromise;
}

export function resetDelegationToolkitContext() { contextPromise = null; }

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

