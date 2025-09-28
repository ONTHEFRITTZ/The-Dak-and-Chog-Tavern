// /js/aa/toolkit.js
// Small common utilities for AA UX

import { ethers } from '../tavern.js';

export function toWeiMON(v) {
  return ethers.utils.parseEther(String(v ?? '0')).toString();
}
export function fromWeiMON(v) {
  try { return ethers.utils.formatEther(v); } catch { return String(v); }
}
export function shortAddr(a, n = 4) {
  if (!a || a.length < 10) return a || '';
  return `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
}

export async function waitForTx(provider, hash, { confirmations = 1, timeoutMs = 90_000 } = {}) {
  const done = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout waiting for tx')), timeoutMs);
    provider.waitForTransaction(hash, confirmations)
      .then(r => { clearTimeout(t); resolve(r); })
      .catch(e => { clearTimeout(t); reject(e); });
  });
  return done;
}
