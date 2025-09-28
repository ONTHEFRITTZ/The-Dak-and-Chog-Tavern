// tavern.js (drop-in) — wallet UX + optional AA (only on on-chain pages)

import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';
import './bundler.js';
import { profileLoad } from './profile.js';

// ⬇️ REMOVE static aaClient import; we will lazy-load it when needed
// import { initSmartAccount, getSmartAccount } from './aaClient.js';

const ORIGINAL_ETHEREUM = (function () {
  try { return window.ethereum; } catch { return undefined; }
})();
const ORIGINAL_PHANTOM = (function () {
  try { return window.phantom && window.phantom.ethereum; } catch { return undefined; }
})();

// -------- helpers to decide “on-chain vs f2p” (same logic as table.html) -----
function isOnChainPage() {
  try {
    const mode = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
    if (mode === 'onchain') return true;
    const u = new URL(location.href);
    const tableId = String(u.searchParams.get('table') || '');
    return /^poker-(nl|fl)-/i.test(tableId);
  } catch { return false; }
}

// -------------------- provider selection (unchanged) -------------------------
function readStoredProviderKey(explicitKey) {
  try {
    const stored = explicitKey != null ? explicitKey : (sessionStorage.getItem('walletProvider') || window.__walletProviderKey || '');
    return String(stored || '').toLowerCase();
  } catch { return String(explicitKey || '').toLowerCase(); }
}
function findMetaMaskProvider(seed) {
  if (!seed) return null;
  if (seed.isMetaMask) return seed;
  if (Array.isArray(seed.providers)) {
    const mm = seed.providers.find((p) => p && p.isMetaMask);
    if (mm) return mm;
  }
  return null;
}
function detectProviderKey(provider, fallback) {
  try {
    const phantom = window.phantom && window.phantom.ethereum;
    if (phantom && provider === phantom) return 'phantom';
  } catch {}
  if (provider && provider.isPhantom) return 'phantom';
  if (provider && provider.isMetaMask) return 'metamask';
  return fallback || 'injected';
}
function resolveSelectedProvider(preferredKey, injectedOverride) {
  if (injectedOverride && typeof injectedOverride.request === 'function') return injectedOverride;
  const key = readStoredProviderKey(preferredKey);

  const candidates = [];
  try { if (window.__walletProvider?.request) candidates.push(window.__walletProvider); } catch {}
  if (ORIGINAL_ETHEREUM?.request) candidates.push(ORIGINAL_ETHEREUM);
  try { if (window.ethereum && window.ethereum !== ORIGINAL_ETHEREUM && window.ethereum.request) candidates.push(window.ethereum); } catch {}
  if (ORIGINAL_PHANTOM?.request) candidates.push(ORIGINAL_PHANTOM);

  if (key === 'phantom') {
    try {
      const phantom = window.phantom && window.phantom.ethereum;
      if (phantom?.request) return phantom;
    } catch {}
  }
  if (key === 'metamask') {
    for (const seed of candidates) { const mm = findMetaMaskProvider(seed); if (mm) return mm; }
  }
  for (const seed of candidates) { if (seed?.request) return seed; }
  for (const seed of candidates) { const mm = findMetaMaskProvider(seed); if (mm) return mm; }
  try {
    const phantom = window.phantom && window.phantom.ethereum;
    if (phantom?.request) return phantom;
  } catch {}
  return null;
}
function setSelectedProvider(provider, key) {
  if (!provider?.request) return;
  try { window.__walletProvider = provider; } catch {}
  try { window.__walletProviderKey = key || ''; } catch {}
  try { window.ethereum = provider; } catch {}
  try { Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true }); } catch {}
}
try { window.__getSelectedProvider = (preferredKey) => resolveSelectedProvider(preferredKey); } catch {}
try { window.__setSelectedProvider = setSelectedProvider; } catch {}
try {
  const seeded = resolveSelectedProvider();
  if (seeded) setSelectedProvider(seeded, readStoredProviderKey());
} catch {}

// ------------------------ config + small UI helpers --------------------------
let cfgLoaded = false;
let getAddressFor, detectChainId, getAddress, renderTavernBanner, CONTRACTS, showToast;
async function ensureConfig() {
  if (cfgLoaded) return;
  const tag = (window.__BUILD_TAG ? String(window.__BUILD_TAG) : String(Date.now()));
  const mod = await import(`./config.js?v=${encodeURIComponent(tag)}`);
  getAddressFor = mod.getAddressFor;
  detectChainId = mod.detectChainId;
  getAddress = mod.getAddress;
  renderTavernBanner = mod.renderTavernBanner;
  CONTRACTS = mod.CONTRACTS;
  showToast = mod.showToast;
  cfgLoaded = true;
}

let provider, signer, userAddress;

const connectButton = document.getElementById('connect-wallet');
const statusEl = document.getElementById('status');
const topRightControls = document.querySelector('.top-banner .controls');

function hideInlineConnectIfBannerPresent() {
  try { const wb = document.getElementById('wallet-banner'); if (wb && connectButton) connectButton.style.display = 'none'; } catch {}
}
function ensureAdminLink(show) {
  try {
    const p = String((location && location.pathname) || '').toLowerCase();
    const isTavern = (p === '/' || p === '/index.html');
    if (!isTavern) show = false;
    let link = document.getElementById('admin-link');
    if (!link) {
      link = document.createElement('a');
      link.id = 'admin-link';
      link.href = '/admin/';
      link.textContent = 'Admin';
      link.style.cssText = 'margin-left:8px; text-decoration:none; font-weight:600; display:none;';
      (topRightControls || document.body).appendChild(link);
    }
    link.style.display = show ? 'inline-block' : 'none';
  } catch {}
}
function setConnectButtonAsDisconnect() {
  try {
    const walletBanner = document.getElementById('wallet-banner');
    if (walletBanner && connectButton) { connectButton.style.display = 'none'; return; }
    if (!connectButton) return;
    connectButton.style.display = '';
    connectButton.textContent = 'Disconnect';
    connectButton.onclick = () => {
      try { localStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletConnected'); } catch {}
      try { location.replace('/landing.html'); } catch { location.href = '/landing.html'; }
    };
  } catch {}
}
function setConnectButtonAsConnect() {
  try {
    if (!connectButton) return;
    connectButton.style.display = '';
    connectButton.textContent = 'Connect Wallet';
    connectButton.onclick = connectWallet;
  } catch {}
}

// ------------------------------- Connect flow --------------------------------
export async function connectWallet(key, injectedOverride) {
  let providerKey = String(key || '').toLowerCase();
  const injected = resolveSelectedProvider(providerKey, injectedOverride);
  if (!injected?.request) { alert('Wallet not detected. Please install the selected wallet.'); return; }

  providerKey = detectProviderKey(injected, providerKey || 'injected');
  setSelectedProvider(injected, providerKey);

  try {
    await injected.request({ method: 'eth_requestAccounts' });
    provider = new ethers.providers.Web3Provider(injected, 'any');
    signer = provider.getSigner();
    userAddress = await signer.getAddress();

    // ✅ Only initialize AA on *on-chain* pages, and load aaClient lazily
    if (isOnChainPage()) {
      try {
        const aa = await import('./aaClient.js');           // lazy load
        const smartAcc = await aa.initSmartAccount(provider);
        window.smartAccount = smartAcc;
        console.log('✅ Smart Account initialized', smartAcc);
      } catch (aaErr) {
        console.warn('AA init skipped / failed:', aaErr?.message || aaErr);
      }
    }

    try {
      window.userAddress = userAddress;
      window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: userAddress } }));
    } catch {}

    // Simple signed “session”
    try {
      const ts = Date.now();
      const nonce = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 24);
      const msg = 'Dak & Chog Tavern\n\nSign-In: ' + nonce + '\nTime: ' + new Date(ts).toISOString() + '\nAddress: ' + userAddress + '\nWallet: ' + providerKey;
      const sig = await signer.signMessage(msg);
      const rec = ethers.utils.verifyMessage(msg, sig);
      if (!rec || String(rec).toLowerCase() !== String(userAddress).toLowerCase()) throw new Error('Signature verification failed');
      try {
        sessionStorage.setItem('walletSigned', 'true');
        sessionStorage.setItem('walletProvider', providerKey);
        sessionStorage.setItem('walletSig', sig);
        sessionStorage.setItem('walletMsg', msg);
      } catch {}
    } catch (e) {
      throw new Error('Signature required to enter');
    }

    await ensureConfig();
    setConnectButtonAsDisconnect();
    hideInlineConnectIfBannerPresent();
    try { statusEl && (statusEl.innerText = ''); } catch {}
    showToast && showToast('Wallet connected', 'success');

    try {
      const chainId = await detectChainId(provider);
      const tavernAddress = await getAddressFor('tavern', provider);
      renderTavernBanner({ contractKey: 'tavern', address: tavernAddress, chainId, wallet: userAddress, labelOverride: 'Address' });
      ensureAdminLink(false);
    } catch {}

    // presence socket (best-effort)
    try {
      if (!window.io) {
        await new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
          s.onload = resolve; s.onerror = resolve;
          document.head.appendChild(s);
        });
      }
      if (window.io) {
        if (!window.__presenceSocket) {
          window.__presenceSocket = window.io(window.location.origin, { path: '/socket.io' });
          window.__presenceSocket.on('connect', () => {
            try { window.__presenceSocket.emit('identify', { addr: userAddress }); } catch {}
            try { window.__presenceSocket.emit('user:location', { path: location.pathname }); } catch {}
          });
        } else {
          try { window.__presenceSocket.emit('identify', { addr: userAddress }); } catch {}
          try { window.__presenceSocket.emit('user:location', { path: location.pathname }); } catch {}
        }
      }
    } catch {}
  } catch (err) {
    statusEl && (statusEl.innerText = 'Connection failed: ' + err.message);
  }
}

// Render network banner without connecting
async function bootConnect() {
  await ensureConfig().catch(()=>{});
  try {
    const chainId = await detectChainId(undefined);
    const address = getAddress('tavern', chainId);
    renderTavernBanner({ contractKey: 'tavern', address, chainId, labelOverride: 'Address' });
  } catch {}
  ensureAdminLink(false);
}
try {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bootConnect();
  } else {
    window.addEventListener('load', () => { bootConnect().catch(()=>{}); });
  }
} catch {}

if (connectButton) connectButton.addEventListener('click', connectWallet);

// Expose for non-module callers
export { signer, provider, userAddress };
export { ethers };
try { window.ethers = ethers; } catch {}
try { window.tavernConnectWallet = connectWallet; } catch {}
