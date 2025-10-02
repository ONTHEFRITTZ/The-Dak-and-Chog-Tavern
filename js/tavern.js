// /js/tavern.js  — drop-in replacement (no AA import at top level)

import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';
import './bundler.js';
import { profileLoad } from './profile.js';

// --- helpers for provider selection (unchanged behavior) --------------------
const ORIGINAL_ETHEREUM = (() => { try { return window.ethereum; } catch { return undefined; } })();
const ORIGINAL_PHANTOM  = (() => { try { return window.phantom && window.phantom.ethereum; } catch { return undefined; } })();

function readStoredProviderKey(explicitKey) {
  try { return String(explicitKey ?? sessionStorage.getItem('walletProvider') ?? window.__walletProviderKey ?? '').toLowerCase(); }
  catch { return String(explicitKey || '').toLowerCase(); }
}
function findMetaMaskProvider(seed) {
  if (!seed) return null;
  if (seed.isMetaMask) return seed;
  if (Array.isArray(seed.providers)) return seed.providers.find(p => p && p.isMetaMask) || null;
  return null;
}
function detectProviderKey(provider, fallback) {
  try { const ph = window.phantom && window.phantom.ethereum; if (ph && provider === ph) return 'phantom'; } catch {}
  if (provider?.isPhantom) return 'phantom';
  if (provider?.isMetaMask) return 'metamask';
  return fallback || 'injected';
}
function resolveSelectedProvider(preferredKey, injectedOverride) {
  if (injectedOverride?.request) return injectedOverride;
  const key = readStoredProviderKey(preferredKey);
  const candidates = [];
  try { if (window.__walletProvider?.request) candidates.push(window.__walletProvider); } catch {}
  if (ORIGINAL_ETHEREUM?.request) candidates.push(ORIGINAL_ETHEREUM);
  try { if (window.ethereum && window.ethereum !== ORIGINAL_ETHEREUM && window.ethereum.request) candidates.push(window.ethereum); } catch {}
  if (ORIGINAL_PHANTOM?.request) candidates.push(ORIGINAL_PHANTOM);

  if (key === 'phantom') {
    try { const ph = window.phantom && window.phantom.ethereum; if (ph?.request) return ph; } catch {}
  }
  if (key === 'metamask') {
    for (const seed of candidates) { const mm = findMetaMaskProvider(seed); if (mm) return mm; }
  }
  for (const seed of candidates) { if (seed?.request) return seed; }
  for (const seed of candidates) { const mm = findMetaMaskProvider(seed); if (mm) return mm; }
  try { const ph = window.phantom && window.phantom.ethereum; if (ph?.request) return ph; } catch {}
  return null;
}
function setSelectedProvider(provider, key) {
  if (!provider?.request) return;
  try { window.__walletProvider = provider; } catch {}
  try { window.__walletProviderKey = key || ''; } catch {}
  try { window.ethereum = provider; } catch {}
  try { Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true }); } catch {}
}
try { window.__getSelectedProvider = (k) => resolveSelectedProvider(k); } catch {}
try { window.__setSelectedProvider = setSelectedProvider; } catch {}
try { const seeded = resolveSelectedProvider(); if (seeded) setSelectedProvider(seeded, readStoredProviderKey()); } catch {}
// --- MetaMask helpers (robust unlock flow) ---
async function getMetaMaskProvider() {
  try {
    const seed = resolveSelectedProvider('metamask');
    // In case of multi-provider injection
    if (seed?.providers?.length) {
      const mm = seed.providers.find(p => p && p.isMetaMask);
      if (mm) return mm;
    }
    if (seed?.isMetaMask) return seed;
  } catch {}
  // Last chance: window.ethereum?.providers or window.ethereum
  try {
    if (window.ethereum?.providers?.length) {
      const mm = window.ethereum.providers.find(p => p && p.isMetaMask);
      if (mm) return mm;
    }
    if (window.ethereum?.isMetaMask) return window.ethereum;
  } catch {}
  return null;
}

async function isMetaMaskUnlocked(mm) {
  try {
    // This is a commonly used MetaMask helper; returns Promise<boolean>
    if (mm && mm._metamask && typeof mm._metamask.isUnlocked === 'function') {
      return !!(await mm._metamask.isUnlocked());
    }
  } catch {}
  // Fallback heuristic: if we can get accounts without error
  try {
    const accs = await mm.request({ method: 'eth_accounts' });
    return Array.isArray(accs) && accs.length > 0;
  } catch {}
  return false;
}

// Clear "connecting..." label if we error out
function setStatus(msg) {
  try {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.innerText = msg || '';
  } catch {}
}

// --- config lazy-loader (same as before) ------------------------------------
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

// --- AA loader: ONLY on on-chain tables -------------------------------------
function isOnchainPage() {
  const m = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
  // also treat poker-nl-*/poker-fl-* as on-chain if needed (optional):
  try {
    const id = new URL(location.href).searchParams.get('table') || '';
    if (/^poker-(nl|fl)-/i.test(id)) return true;
  } catch {}
  return m === 'onchain';
}
async function maybeInitAA(provider) {
  if (!isOnchainPage()) return null;
  try {
    const { initSmartAccount } = await import('./aaClient.js'); // <-- lazy import
    const smartAcc = await initSmartAccount(provider);
    smartAccount = smartAcc;
    try { window.smartAccount = smartAcc; } catch {}
    console.log('✅ Smart Account initialized');
    return smartAcc;
  } catch (e) {
    console.warn('[tavern] AA init skipped/failed', e);
    smartAccount = null;
    return null;
  }
}

// --- DOM / state -------------------------------------------------------------
const connectButton = document.getElementById('connect-wallet');
const statusEl = document.getElementById('status');
const topRightControls = document.querySelector('.top-banner .controls');

let provider, signer, userAddress, smartAccount;
const OWNER_WALLET_ALLOWLIST = [ '0x8ba35eca0fe68787b275c6ed065675829843adf5' ];

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
  const walletBanner = document.getElementById('wallet-banner');
  if (walletBanner && connectButton) { connectButton.style.display = 'none'; return; }
  if (!connectButton) return;
  connectButton.style.display = '';
  connectButton.textContent = 'Disconnect';
  connectButton.onclick = () => {
    try { localStorage.removeItem('walletConnected'); } catch {}
    try { sessionStorage.removeItem('walletConnected'); } catch {}
    try { location.replace('/landing.html'); } catch { location.href = '/landing.html'; }
  };
}
function setConnectButtonAsConnect() {
  if (!connectButton) return;
  connectButton.style.display = '';
  connectButton.textContent = 'Connect Wallet';
  connectButton.onclick = connectWallet;
}

// --- connect flow ------------------------------------------------------------
export async function connectWallet(key = 'metamask', injectedOverride) {
  // Always prefer the MetaMask provider for this button
  const mm = injectedOverride || await getMetaMaskProvider();

  if (!mm) {
    alert('MetaMask not detected. Please install MetaMask and try again.');
    return;
  }

  // Mark selection so the rest of your code picks it up
  setSelectedProvider(mm, 'metamask');

  // This whole function runs in a user-gesture (button click) context,
  // so MM should be allowed to open its unlock UI.
  try {
    // If locked, request accounts will open unlock UI
    let unlocked = await isMetaMaskUnlocked(mm);
    if (!unlocked) {
      try {
        await mm.request({ method: 'eth_requestAccounts' });
      } catch (err) {
        // -32002 = request already pending; instruct the user
        if (err && (err.code === -32002)) {
          showToast('MetaMask request is already pending — open the extension to continue.', 'info', 4000);
          setStatus('');
          return;
        }
        // 4001 = user rejected the request
        if (err && (err.code === 4001)) {
          showToast('MetaMask unlock canceled.', 'error');
          setStatus('');
          return;
        }
        // Other errors: surface and bail
        console.warn('eth_requestAccounts failed', err);
        showToast('MetaMask error: ' + (err?.message || 'request failed'), 'error');
        setStatus('');
        return;
      }
      // After the prompt, verify again
      unlocked = await isMetaMaskUnlocked(mm);
      if (!unlocked) {
        showToast('Please unlock MetaMask to continue.', 'info');
        setStatus('');
        return;
      }
    } else {
      // Even if unlocked, you still want to ensure account access is granted
      // (some browsers/extensions need this to surface the account list)
      try { await mm.request({ method: 'eth_requestAccounts' }); } catch {}
    }

    // By here we should be unlocked + authorized → proceed to ethers
    const _ethers = window.ethers || (await import('https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js')).ethers;
    provider = new _ethers.providers.Web3Provider(mm, 'any');
    signer = provider.getSigner();
    userAddress = await signer.getAddress();

    // 👇 (same as your existing flow)
    try {
      const ts = Date.now();
      const nonce = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 24);
      const msg = 'Dak & Chog Tavern\n\nSign-In: ' + nonce + '\nTime: ' + new Date(ts).toISOString() + '\nAddress: ' + userAddress + '\nWallet: metamask';
      const sig = await signer.signMessage(msg);
      const rec = _ethers.utils.verifyMessage(msg, sig);
      if (!rec || String(rec).toLowerCase() !== String(userAddress).toLowerCase()) throw new Error('Signature verification failed');
      try {
        sessionStorage.setItem('walletSigned','true');
        sessionStorage.setItem('walletProvider', 'metamask');
        sessionStorage.setItem('walletSig', sig);
        sessionStorage.setItem('walletMsg', msg);
      } catch {}
    } catch (e) {
      showToast('Signature required to enter', 'error');
      setStatus('');
      return;
    }

    // Load config + render banners/UI
    try {
      await (await import(`./config.js?v=${encodeURIComponent(window.__BUILD_TAG || Date.now())}`));
    } catch {}

    try {
      // Fire your existing connected event so table.js picks it up
      window.userAddress = userAddress;
      window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: userAddress } }));
    } catch {}

    if (isOnchainPage()) {
      try { await maybeInitAA(mm); } catch (aaErr) { console.warn('AA init failed', aaErr); }
    } else {
      smartAccount = null;
      try { delete window.smartAccount; } catch {}
    }

    // Persist & update UI
    try {
      localStorage.setItem('walletConnected','true');
      sessionStorage.setItem('walletConnected','true');
      localStorage.setItem('walletAddress', userAddress.toLowerCase());
      sessionStorage.setItem('walletAddress', userAddress.toLowerCase());
    } catch {}

    // Wire the Disconnect button as before
    (function setDisconnectUI(){
      try {
        const btn = document.getElementById('wi-disconnect') || document.getElementById('nb-disconnect');
        if (btn) {
          btn.style.display = '';
          btn.onclick = () => {
            try { localStorage.removeItem('walletConnected'); } catch {}
            try { sessionStorage.removeItem('walletConnected'); } catch {}
            try { location.replace('/landing.html'); } catch { location.href = '/landing.html'; }
          };
        }
      } catch {}
    })();

    showToast('Wallet connected', 'success');
    setStatus('');

  } catch (outerErr) {
    console.warn('connectWallet failed', outerErr);
    showToast(outerErr?.message || 'Connection failed', 'error');
    setStatus('');
  }
}

// --- boot: render banner, no wallet prompts ---------------------------------
async function bootConnect() {
  await ensureConfig().catch(()=>{});
  try {
    const chainId = await detectChainId(undefined);
    const address = getAddress('tavern', chainId);
    renderTavernBanner && renderTavernBanner({ contractKey: 'tavern', address, chainId, labelOverride: 'Address' });
  } catch {}
  ensureAdminLink(false);
}

try {
  if (document.readyState === 'complete' || document.readyState === 'interactive') bootConnect();
  else window.addEventListener('load', () => { bootConnect().catch(()=>{}); });
} catch {}

if (document.getElementById('connect-wallet')) {
  document.getElementById('connect-wallet').addEventListener('click', connectWallet);
}

export function getSmartAccount() {
  return smartAccount || null;
}

// Expose for other modules/pages
export { signer, provider, userAddress, smartAccount, ethers };
try { window.ethers = ethers; } catch {}
try { window.tavernConnectWallet = connectWallet; } catch {}
