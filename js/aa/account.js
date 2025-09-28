// /js/aa/account.js
// Helpers to introspect the ZeroDev smart account

import { getSmartAccount } from '../tavern.js';

export async function getAAAddress() {
  const smart = await getSmartAccount();
  if (!smart) return null;
  if (typeof smart.getAddress === 'function') {
    return await smart.getAddress();
  }
  // Some clients expose address directly
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
  // Fallback heuristic: if getAddress exists, assume ready. (ZeroDev often auto-deploys on first tx)
  return !!(await getAAAddress());
}
