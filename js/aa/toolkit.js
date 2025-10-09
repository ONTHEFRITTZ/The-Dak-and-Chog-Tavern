// js/aa/toolkit.js
// Thin loader around the MetaMask Delegation Toolkit + viem helpers.

import { MONAD } from './config.js';

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
    const accounts = await requestAccounts(provider);
    const account = accounts[0];

    const [
      viem,
      toolkit
    ] = await Promise.all([
      import('viem'),
      import('@metamask/delegation-toolkit')
    ]);

    const { createPublicClient, createWalletClient, http, custom } = viem;

    const publicClient = createPublicClient({
      chain: MONAD_CHAIN,
      transport: http(MONAD.rpcHttp)
    });

    const walletClient = createWalletClient({
      account: account,
      chain: MONAD_CHAIN,
      transport: custom(provider)
    });

    const environment = toolkit.getDeleGatorEnvironment(MONAD.id);

    return {
      provider,
      accounts,
      account,
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
