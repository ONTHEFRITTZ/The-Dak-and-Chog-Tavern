// /js/aa/delegation.js
// Lightweight client-side session management for "delegations"
// This complements on-chain (EIP-7702 or allowlist) checks you add later.

const KEY = 'aa:delegation:session';

export function createDelegationSession({ scope = 'play', ttlSeconds = 3600, meta = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const sess = {
    id: cryptoRandomId(),
    scope,
    issuedAt: now,
    expiresAt: now + Math.max(60, ttlSeconds),
    meta: meta || {},
  };
  try { sessionStorage.setItem(KEY, JSON.stringify(sess)); } catch {}
  return sess;
}

export function getActiveDelegationSession() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const sess = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    if (sess && sess.expiresAt && now < Number(sess.expiresAt)) return sess;
  } catch {}
  return null;
}

export function revokeDelegationSession() {
  try { sessionStorage.removeItem(KEY); } catch {}
}

export function refreshDelegationSession(ttlSeconds = 3600) {
  const sess = getActiveDelegationSession();
  if (!sess) return null;
  const now = Math.floor(Date.now() / 1000);
  sess.expiresAt = now + Math.max(60, ttlSeconds);
  try { sessionStorage.setItem(KEY, JSON.stringify(sess)); } catch {}
  return sess;
}

function cryptoRandomId() {
  try {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return [...b].map(n => n.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
}
