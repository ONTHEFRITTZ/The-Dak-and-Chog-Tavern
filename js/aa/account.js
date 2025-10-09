// /js/aa/account.js
// Helper utilities for smart account discovery + network alignment

import { MONAD } from '../config.js';
import { initAA, AA } from '../aaClient.js';
import { getSmartAccount, provider as tavernProvider } from '../tavern.js';

function getInjectedProvider() {
  try {
    if (typeof window.__getSelectedProvider === 'function') {
      const pinned = window.__getSelectedProvider();
      if (pinned && typeof pinned.request === 'function') return pinned;
    }
  } catch {}
  try { if (window.__walletProvider && typeof window.__walletProvider.request === 'function') return window.__walletProvider; } catch {}
  try { if (window.ethereum && typeof window.ethereum.request === 'function') return window.ethereum; } catch {}
  try { if (window.phantom && window.phantom.ethereum && typeof window.phantom.ethereum.request === 'function') return window.phantom.ethereum; } catch {}
  if (tavernProvider && typeof tavernProvider.provider?.request === 'function') {
    return tavernProvider.provider;
  }
  return null;
}

function toChainHex(id) {
  return '0x' + Number(id || 0).toString(16);
}

export async function ensureMonadSelected({ requestSwitch = false } = {}) {
  const injected = getInjectedProvider();
  if (!injected) return false;
  let chainId = 0;
  try {
    const raw = await injected.request({ method: 'eth_chainId' });
    chainId = parseInt(raw, 16);
  } catch {}
  if (chainId === MONAD.id) return true;
  if (!requestSwitch) return false;

  const chainHex = toChainHex(MONAD.id);
  try {
    await injected.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainHex }]
    });
    return true;
  } catch (err) {
    if (err && err.code === 4902) {
      try {
        await injected.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chainHex,
            chainName: MONAD.name || 'Monad Testnet',
            rpcUrls: [MONAD.rpcHttp],
            nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
            blockExplorerUrls: MONAD.explorer ? [MONAD.explorer] : []
          }]
        });
        return true;
      } catch (addErr) {
        console.warn('[aa/account] add chain failed', addErr);
      }
    } else {
      console.warn('[aa/account] switch chain failed', err);
    }
  }
  return false;
}

export async function getAccounts() {
  const injected = getInjectedProvider();
  if (!injected) return [];
  const normalize = (arr) => (Array.isArray(arr) ? arr.map((a) => String(a || '').toLowerCase()) : []);
  try {
    const accounts = await injected.request({ method: 'eth_accounts' });
    if (accounts && accounts.length) return normalize(accounts);
  } catch {}
  try {
    const accounts = await injected.request({ method: 'eth_requestAccounts' });
    if (accounts && accounts.length) return normalize(accounts);
  } catch {}
  return [];
}

export async function upgradeToSmartAccount() {
  try {
    await ensureMonadSelected({ requestSwitch: true });
  } catch {}
  try {
    const smart = await initAA({});
    return (smart?.type === 'delegation-toolkit') || AA.smartAccountType === 'delegation-toolkit';
  } catch (err) {
    console.warn('[aa/account] upgradeToSmartAccount failed', err);
    return false;
  }
}

export async function isSmartAccount(address) {
  const base = String(address || '').toLowerCase();
  try {
    await initAA({});
  } catch {}
  if (AA.smartAccountType === 'delegation-toolkit') return true;

  const smart = await getSmartAccount();
  if (!smart) return false;
  try {
    if (typeof smart.getAddress === 'function') {
      const resolved = String(await smart.getAddress() || '').toLowerCase();
      if (resolved && resolved !== base) return true;
    }
  } catch {}
  try {
    const exposed = String(smart.address || '').toLowerCase();
    if (exposed && exposed !== base) return true;
  } catch {}
  return false;
}

export async function getAAAddress() {
  const smart = await getSmartAccount();
  if (!smart) return null;
  if (typeof smart.getAddress === 'function') {
    return await smart.getAddress();
  }
  return smart.address || null;
}

export async function isAADeployed() {
  const smart = await getSmartAccount();
  if (!smart) return false;
  try {
    if (typeof smart.isAccountDeployed === 'function') {
      return await smart.isAccountDeployed();
    }
  } catch {}
  const addr = await getAAAddress();
  return !!addr;
}
