// Profile module: client-side encryption and realtime storage
// Now prefers Socket.IO at /socket.io, with fallback to raw WebSocket in local dev

const __isLocalHost = ['localhost','127.0.0.1'].includes(location.hostname);
// Use raw WebSocket only if explicitly provided via window.MULTI_WS_URL
// Otherwise rely on Socket.IO (works behind Nginx /socket.io)
const WS_URL = (window.MULTI_WS_URL || null);

let rt = { type: null, conn: null }; // { type: 'io'|'ws', conn }

async function ensureIoLoaded() {
  if (window.io) return true;
  return new Promise((resolve, reject) => {
    try {
      const s = document.createElement('script');
      s.src = '/socket.io/socket.io.js';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    } catch { resolve(false); }
  });
}

async function rtEnsure() {
  // Local fallback: explicit WS URL only in dev
  if (WS_URL) {
    if (rt.type === 'ws' && rt.conn && rt.conn.readyState === 1) return rt.conn;
    await new Promise((resolve) => {
      const ws = new WebSocket(WS_URL);
      ws.addEventListener('open', () => { rt = { type: 'ws', conn: ws }; resolve(); }, { once: true });
    });
    return rt.conn;
  }
  // Prefer Socket.IO on production
  const ok = await ensureIoLoaded();
  if (!ok || !window.io) throw new Error('Realtime disabled');
  if (rt.type === 'io' && rt.conn && rt.conn.connected) return rt.conn;
  rt.conn = window.io({ path: '/socket.io' });
  await new Promise((resolve) => { rt.conn.once('connect', resolve); });
  rt.type = 'io';
  return rt.conn;
}

export async function signMessage(message) {
  if (!window.ethereum) throw new Error('No wallet');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const addr = accounts[0];
  const sig = await window.ethereum.request({ method: 'personal_sign', params: [message, addr] });
  return { addr, sig };
}

async function sha256(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(d);
}

async function importKeyFromSignature(sigHex) {
  // Use SHA-256(signature) as key material for AES-GCM
  const hex = sigHex.replace(/^0x/, '');
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  const keyBytes = await sha256(bytes);
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function b64encode(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64decode(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

export async function encryptProfile(obj, sigHex) {
  const key = await importKeyFromSignature(sigHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj||{}));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return `${b64encode(iv)}.${b64encode(ct)}`;
}

export async function decryptProfile(cipher, sigHex) {
  const key = await importKeyFromSignature(sigHex);
  const [ivB64, ctB64] = String(cipher||'').split('.');
  if (!ivB64 || !ctB64) throw new Error('Bad cipher');
  const iv = b64decode(ivB64);
  const ct = b64decode(ctB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

export async function profileSave(profileObj) {
  await rtEnsure();
  const msg = `Dak&Chog Tavern profile v1 @ ${new Date().toISOString()}`;
  const { addr, sig } = await signMessage(msg);
  const cipher = await encryptProfile(profileObj, sig);
  if (rt.type === 'ws') {
    rt.conn.send(JSON.stringify({ type: 'identify', addr }));
    rt.conn.send(JSON.stringify({ type: 'profile_save', cipher }));
  } else {
    rt.conn.emit('identify', { addr });
    rt.conn.emit('profile_save', { cipher });
  }
}

export async function profileLoad() {
  await rtEnsure();
  const msg = `Dak&Chog Tavern profile v1 @ ${new Date().toISOString()}`;
  const { addr, sig } = await signMessage(msg);
  return new Promise((resolve, reject) => {
    const handle = async (raw) => {
      try {
        const data = (rt.type === 'ws') ? raw.data : raw; // ws event vs io payload
        const m = typeof data === 'string' ? JSON.parse(data) : data;
        if (m && m.type === 'profile') {
          cleanup();
          if (!m.cipher) return resolve(null);
          try { resolve(await decryptProfile(m.cipher, sig)); } catch(e) { reject(e); }
        }
      } catch {}
    };
    const cleanup = () => {
      try {
        if (rt.type === 'ws') rt.conn.removeEventListener('message', handle);
        else rt.conn.off('message', handle);
      } catch {}
    };
    try {
      if (rt.type === 'ws') rt.conn.addEventListener('message', handle);
      else rt.conn.on('message', handle);
    } catch {}
    if (rt.type === 'ws') {
      rt.conn.send(JSON.stringify({ type: 'identify', addr }));
      rt.conn.send(JSON.stringify({ type: 'profile_get' }));
    } else {
      rt.conn.emit('identify', { addr });
      rt.conn.emit('profile_get');
    }
  });
}

export async function readStats(addrOpt) {
  await rtEnsure();
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const addr = (addrOpt || accounts[0] || '').toLowerCase();
  return new Promise((resolve) => {
    const handle = (raw) => {
      try {
        const data = (rt.type === 'ws') ? raw.data : raw;
        const m = typeof data === 'string' ? JSON.parse(data) : data;
        if (m && m.type === 'stats' && String(m.addr||'').toLowerCase() === addr) {
          cleanup();
          resolve(m);
        }
      } catch {}
    };
    const cleanup = () => {
      try {
        if (rt.type === 'ws') rt.conn.removeEventListener('message', handle);
        else rt.conn.off('message', handle);
      } catch {}
    };
    try {
      if (rt.type === 'ws') rt.conn.addEventListener('message', handle);
      else rt.conn.on('message', handle);
    } catch {}
    if (rt.type === 'ws') {
      rt.conn.send(JSON.stringify({ type: 'stat_read', addr }));
    } else {
      rt.conn.emit('stat_read', { addr });
    }
  });
}

