// Minimal sample utilities used by game pages
// Updated to resolve addresses from config per detected chain

import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';
import { getAddressFor } from './config.js';

let provider, signer;

export function attachProvider(p) {
  provider = p;
  try { signer = p?.getSigner ? p.getSigner() : undefined; } catch {}
}

// Shared function to fund Shell contract (example)
// Send native funds directly to the unified Tavern contract (payable receive)
export async function fundContract(amountEth) {
  if (!signer) throw new Error('Wallet not connected');
  const tavernAddress = await getAddressFor('tavern', provider);
  return signer.sendTransaction({ to: tavernAddress, value: ethers.utils.parseEther(String(amountEth)) });
}

// Utility to check wallet
export function isWalletConnected() {
  return !!signer;
}
