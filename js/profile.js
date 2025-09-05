// Profile module: client-side encryption and WS storage
// Requires: window.ethereum (optional ethers), and runs on pages that want profiles

const __isLocalHost = ['localhost','127.0.0.1'].includes(location.hostname);
const WS_URL = (window.MULTI_WS_URL || (__isLocalHost ? 'ws://localhost:8787' : null));
let ws;

function wsEnsure() {
  if (!WS_URL) throw new Error('WS disabled on this host');
  if (ws && ws.readyState === 1) return Promise.resolve(ws);
  return new Promise((resolve) => {
    ws = new WebSocket(WS_URL);
    ws.addEventListener('open', () => resolve(ws), { once: true });
  });
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
  await wsEnsure();
  const msg = `Dak&Chog Tavern profile v1 @ ${new Date().toISOString()}`;
  const { addr, sig } = await signMessage(msg);
  const cipher = await encryptProfile(profileObj, sig);
  ws.send(JSON.stringify({ type: 'identify', addr }));
  ws.send(JSON.stringify({ type: 'profile_save', cipher }));
}

export async function profileLoad() {
  await wsEnsure();
  const msg = `Dak&Chog Tavern profile v1 @ ${new Date().toISOString()}`;
  const { addr, sig } = await signMessage(msg);
  return new Promise((resolve, reject) => {
    const onMsg = async (evt) => {
      try {
        const m = JSON.parse(evt.data);
        if (m.type === 'profile') {
          ws.removeEventListener('message', onMsg);
          if (!m.cipher) return resolve(null);
          try { resolve(await decryptProfile(m.cipher, sig)); } catch(e) { reject(e); }
        }
      } catch {}
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ type: 'identify', addr }));
    ws.send(JSON.stringify({ type: 'profile_get' }));
  });
}

export async function readStats(addrOpt) {
  await wsEnsure();
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const addr = (addrOpt || accounts[0] || '').toLowerCase();
  return new Promise((resolve) => {
    const onMsg = (evt) => {
      try {
        const m = JSON.parse(evt.data);
        if (m.type === 'stats' && m.addr?.toLowerCase() === addr) {
          ws.removeEventListener('message', onMsg);
          resolve(m);
        }
      } catch {}
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ type: 'stat_read', addr }));
  });
}

