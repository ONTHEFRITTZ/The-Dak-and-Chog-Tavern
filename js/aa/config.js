// Lightweight AA config that piggybacks your existing config.js and targets your EXISTING HoldemPoker.
// No contract changes required.

import {
  MONAD_BUNDLER_RPC as ROOT_MONAD_BUNDLER_RPC,
  ZD_PAYMASTER_RPC as ROOT_ZD_PAYMASTER_RPC,
  CONTRACTS as ROOT_CONTRACTS,
  getAddressFor as rootGetAddressFor,
} from '../config.js';

export const MONAD = {
  id: 10143,
  name: 'Monad Testnet',
  rpcHttp: (window?.RPC_ENDPOINTS && window.RPC_ENDPOINTS[10143]) || 'https://monad-testnet.drpc.org',
  explorer: (window?.EXPLORERS && window.EXPLORERS[10143]) || 'https://testnet.monadexplorer.com',
};

export const AA_FEATURES = {
  enable7702: true,         // EIP-7702 upgrade path (MetaMask Smart Accounts)
  enableDelegations: true,  // MetaMask Delegation Toolkit
  enableSponsorship: true,  // Paymaster/bundler for gasless UX
};

// ---- Resolve the HoldemPoker target from your existing config.js ----
export async function getPokerTableAddress(provider) {
  try {
    // prefer chain-aware lookup
    if (window?.getAddressFor) {
      const addr = await window.getAddressFor('pokerTable', provider);
      if (addr) return addr;
    }
  } catch {}
  try {
    if (typeof rootGetAddressFor === 'function') {
      const addr = await rootGetAddressFor('pokerTable', provider);
      if (addr) return addr;
    }
  } catch {}
  try { return window?.CONTRACTS?.pokerTable || null; } catch {}
  try { return ROOT_CONTRACTS?.pokerTable || null; } catch {}
  return null;
}

// (optional) future: expose registry address here if you add on-chain guardrails later.
export const PERMISSIONS_REGISTRY = null; // not used in this path

export const MONAD_BUNDLER_RPC = ROOT_MONAD_BUNDLER_RPC;
export const ZD_PAYMASTER_RPC = ROOT_ZD_PAYMASTER_RPC;
