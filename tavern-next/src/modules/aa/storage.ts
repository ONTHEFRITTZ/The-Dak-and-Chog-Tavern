'use client';

const SMART_ACCOUNT_KEY_PREFIX = "aa:toolkit:account:";

function storageKey(chainId: number | string | null | undefined) {
  const id = chainId != null ? String(Number(chainId)) : "default";
  return `${SMART_ACCOUNT_KEY_PREFIX}${id}`;
}

export function loadSmartAccountAddress(chainId: number | string | null | undefined) {
  try {
    const value = localStorage.getItem(storageKey(chainId));
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function storeSmartAccountAddress(chainId: number | string | null | undefined, address?: string | null) {
  if (!address) return;
  try {
    localStorage.setItem(storageKey(chainId), address);
  } catch {
    // ignore storage issues (private mode, etc.)
  }
}

export function clearSmartAccountAddress(chainId: number | string | null | undefined) {
  try {
    localStorage.removeItem(storageKey(chainId));
  } catch {
    // ignore
  }
}
