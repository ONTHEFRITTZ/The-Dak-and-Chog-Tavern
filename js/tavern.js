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
    try { window.smartAccount = smartAcc; } catch {}
    console.log('✅ Smart Account initialized');
    return smartAcc;
  } catch (e) {
    console.warn('[tavern] AA init skipped/failed', e);
    return null;
  }
}

// --- DOM / state -------------------------------------------------------------
const connectButton = document.getElementById('connect-wallet');
const statusEl = document.getElementById('status');
const topRightControls = document.querySelector('.top-banner .controls');

let provider, signer, userAddress;
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
export async function connectWallet(key, injectedOverride) {
  let providerKey = '';
  try { providerKey = String(key || '').toLowerCase(); } catch {}

  const injected = resolveSelectedProvider(providerKey, injectedOverride);
  if (!injected?.request) { alert('Wallet not detected. Please install a wallet extension.'); return; }

  providerKey = detectProviderKey(injected, providerKey || 'injected');
  setSelectedProvider(injected, providerKey);

  try {
    await injected.request({ method: 'eth_requestAccounts' });
    provider = new ethers.providers.Web3Provider(injected, 'any');
    signer = provider.getSigner();
    userAddress = await signer.getAddress();

    // 🔑 Only initialize AA on on-chain pages
    await maybeInitAA(provider);

    try {
      window.userAddress = userAddress;
      window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: userAddress } }));
    } catch {}

    // lightweight SIW-style signature gate
    try {
      const ts = Date.now();
      const nonce = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 24);
      const msg = 'Dak & Chog Tavern\n\nSign-In: ' + nonce + '\nTime: ' + new Date(ts).toISOString() + '\nAddress: ' + userAddress + '\nWallet: ' + providerKey;
      const sig = await signer.signMessage(msg);
      const rec = ethers.utils.verifyMessage(msg, sig);
      if (!rec || String(rec).toLowerCase() !== String(userAddress).toLowerCase()) throw new Error('Signature verification failed');
      sessionStorage.setItem('walletSigned','true');
      sessionStorage.setItem('walletProvider', providerKey);
      sessionStorage.setItem('walletSig', sig);
      sessionStorage.setItem('walletMsg', msg);
    } catch (e) { throw new Error('Signature required to enter'); }

    await ensureConfig();
    setConnectButtonAsDisconnect();
    hideInlineConnectIfBannerPresent();
    try { statusEl && (statusEl.innerText = ''); } catch {}
    try { showToast && showToast('Wallet connected', 'success'); } catch {}

    try {
      const chainId = await detectChainId(provider);
      const tavernAddress = await getAddressFor('tavern', provider);
      renderTavernBanner && renderTavernBanner({ contractKey: 'tavern', address: tavernAddress, chainId, wallet: userAddress, labelOverride: 'Address' });

      // Admin link logic (optional)
      try {
        const poolAddr = await getAddressFor('pool', provider);
        if (poolAddr && window.PoolABI) {
          const pool = new ethers.Contract(poolAddr, window.PoolABI, signer);
          const owner = await pool.owner();
          const me = String(userAddress || '').toLowerCase();
          ensureAdminLink( String(owner).toLowerCase() === me || ['0x8ba35eca0fe68787b275c6ed065675829843adf5'].includes(me) );
        } else {
          ensureAdminLink(false);
        }
      } catch { ensureAdminLink(false); }
    } catch {}
  } catch (err) {
    try { statusEl && (statusEl.innerText = 'Connection failed: ' + err.message); } catch {}
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

// Expose for other modules/pages
export { signer, provider, userAddress, ethers };
try { window.ethers = ethers; } catch {}
try { window.tavernConnectWallet = connectWallet; } catch {}
