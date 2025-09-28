// tavern.js (full replacement)

import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';
import './bundler.js';
import { profileLoad } from './profile.js';

// 👇 NEW: wire AA smart account client (you created this file already)
import { initSmartAccount, getSmartAccount } from './aaClient.js';

const ORIGINAL_ETHEREUM = (function () {
  try { return window.ethereum; } catch (err) { return undefined; }
})();

const ORIGINAL_PHANTOM = (function () {
  try { return window.phantom && window.phantom.ethereum; } catch (err) { return undefined; }
})();

function readStoredProviderKey(explicitKey) {
  try {
    const stored = explicitKey != null ? explicitKey : (sessionStorage.getItem('walletProvider') || window.__walletProviderKey || '');
    return String(stored || '').toLowerCase();
  } catch (err) {
    return String(explicitKey || '').toLowerCase();
  }
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
  } catch (err) {}
  if (provider && provider.isPhantom) return 'phantom';
  if (provider && provider.isMetaMask) return 'metamask';
  if (fallback) return fallback;
  return 'injected';
}

function resolveSelectedProvider(preferredKey, injectedOverride) {
  if (injectedOverride && typeof injectedOverride.request === 'function') {
    return injectedOverride;
  }
  const key = readStoredProviderKey(preferredKey);
  if (key === 'phantom') {
    try {
      const phantom = window.phantom && window.phantom.ethereum;
      if (phantom && typeof phantom.request === 'function') return phantom;
    } catch (err) {}
  }

  const candidates = [];
  try {
    if (window.__walletProvider && typeof window.__walletProvider.request === 'function') {
      candidates.push(window.__walletProvider);
    }
  } catch (err) {}
  if (ORIGINAL_ETHEREUM && typeof ORIGINAL_ETHEREUM.request === 'function') {
    candidates.push(ORIGINAL_ETHEREUM);
  }
  try {
    if (window.ethereum && window.ethereum !== ORIGINAL_ETHEREUM && typeof window.ethereum.request === 'function') {
      candidates.push(window.ethereum);
    }
  } catch (err) {}
  if (ORIGINAL_PHANTOM && typeof ORIGINAL_PHANTOM.request === 'function') {
    candidates.push(ORIGINAL_PHANTOM);
  }

  if (key === 'metamask') {
    for (const seed of candidates) {
      const mm = findMetaMaskProvider(seed);
      if (mm) return mm;
    }
  }

  if (!key || key === 'injected') {
    for (const seed of candidates) {
      if (seed && typeof seed.request === 'function') {
        return seed;
      }
    }
  }

  if (key !== 'phantom') {
    for (const seed of candidates) {
      const mm = findMetaMaskProvider(seed);
      if (mm) return mm;
    }
  }

  try {
    const phantom = window.phantom && window.phantom.ethereum;
    if (phantom && typeof phantom.request === 'function') return phantom;
  } catch (err) {}

  return null;
}

function setSelectedProvider(provider, key) {
  if (!provider || typeof provider.request !== 'function') return;
  try { window.__walletProvider = provider; } catch (err) {}
  try { window.__walletProviderKey = key || ''; } catch (err) {}
  let assigned = false;
  try {
    window.ethereum = provider;
    assigned = (window.ethereum === provider);
  } catch (err) {
    assigned = false;
  }
  if (!assigned) {
    try {
      Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true });
    } catch (err) {}
  }
}

try { window.__getSelectedProvider = function (preferredKey) { return resolveSelectedProvider(preferredKey); }; } catch (err) {}
try { window.__setSelectedProvider = setSelectedProvider; } catch (err) {}
try {
  const seededProvider = resolveSelectedProvider();
  if (seededProvider) {
    const seededKey = readStoredProviderKey();
    setSelectedProvider(seededProvider, seededKey);
  }
} catch (err) {}

// Defer loading of config.js with a version tag to avoid stale cache
let cfgLoaded = false;
let getAddressFor, detectChainId, getAddress, renderTavernBanner, CONTRACTS, showToast;
async function ensureConfig() {
  if (cfgLoaded) return;
  try {
    const tag = (window.__BUILD_TAG ? String(window.__BUILD_TAG) : String(Date.now()));
    const mod = await import(`./config.js?v=${encodeURIComponent(tag)}`);
    getAddressFor = mod.getAddressFor;
    detectChainId = mod.detectChainId;
    getAddress = mod.getAddress;
    renderTavernBanner = mod.renderTavernBanner;
    CONTRACTS = mod.CONTRACTS;
    showToast = mod.showToast;
    cfgLoaded = true;
  } catch (e) {
    console.error('Failed to load config.js', e);
    throw e;
  }
}

let provider;
let signer;
let userAddress;
// Owner allowlist fallback (in addition to on-chain Pool owner)
const OWNER_WALLET_ALLOWLIST = [ '0x8ba35eca0fe68787b275c6ed065675829843adf5' ];

// DOM Elements
const connectButton = document.getElementById('connect-wallet');
const statusEl = document.getElementById('status');
const topRightControls = document.querySelector('.top-banner .controls');

function hideInlineConnectIfBannerPresent() {
  try {
    const walletBanner = document.getElementById('wallet-banner');
    if (walletBanner && connectButton) connectButton.style.display = 'none';
  } catch (err) {}
}

function ensureAdminLink(show) {
  try {
    // Only show Admin link on Tavern homepage
    try {
      const p = String((location && location.pathname) || '').toLowerCase();
      const isTavern = (p === '/' || p === '/index.html');
      if (!isTavern) show = false;
    } catch (err) {}
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
  } catch (err) {}
}

// Resolve a global ABI name for a given contract key, e.g., 'shell' -> window.ShellABI
function getAbiFromWindow(contractKey) {
  try {
    const cap = contractKey.charAt(0).toUpperCase() + contractKey.slice(1);
    return window[cap + 'ABI'] || window[contractKey + 'ABI'];
  } catch (err) {
    return undefined;
  }
}

// Best-effort loader to fetch ABI script for a given contract key using a conventional path
async function ensureAbiLoaded(contractKey) {
  if (getAbiFromWindow(contractKey)) return true;
  const cap = contractKey.charAt(0).toUpperCase() + contractKey.slice(1);
  const candidates = [
    `games/${contractKey}/${cap}ABI.js`,
    `games/${contractKey}/${contractKey}ABI.js`,
  ];
  for (const src of candidates) {
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('load failed'));
        document.head.appendChild(s);
      });
      if (getAbiFromWindow(contractKey)) return true;
    } catch (err) {
      // try next candidate
    }
  }
  return !!getAbiFromWindow(contractKey);
}

function setConnectButtonAsDisconnect() {
  try {
    const walletBanner = document.getElementById('wallet-banner');
    // If the top-banner wallet UI is present, hide the inline button to avoid duplicates
    if (walletBanner && connectButton) {
      connectButton.style.display = 'none';
      return;
    }
    if (!connectButton) return;
    connectButton.style.display = '';
    connectButton.textContent = 'Disconnect';
    connectButton.onclick = () => {
      try { localStorage.removeItem('walletConnected'); } catch (err) {}
      try { sessionStorage.removeItem('walletConnected'); } catch (err) {}
      try { location.replace('/landing.html'); } catch (err) { location.href='/landing.html'; }
    };
  } catch (err) {}
}

function setConnectButtonAsConnect() {
  try {
    if (!connectButton) return;
    connectButton.style.display = '';
    connectButton.textContent = 'Connect Wallet';
    connectButton.onclick = connectWallet;
  } catch (err) {}
}

// Connect Wallet
export async function connectWallet(key, injectedOverride) {
  let providerKey = '';
  try { providerKey = String(key || '').toLowerCase(); } catch (err) {}

  let injected = null;
  try {
    injected = resolveSelectedProvider(providerKey, injectedOverride);
  } catch (err) {
    injected = null;
  }

  if (!injected || typeof injected.request !== 'function') {
    alert('Wallet not detected. Please install the selected wallet.');
    return;
  }

  providerKey = detectProviderKey(injected, providerKey || 'injected');
  setSelectedProvider(injected, providerKey);

  try {
    await injected.request({ method: 'eth_requestAccounts' });
    provider = new ethers.providers.Web3Provider(injected, 'any');
    signer = provider.getSigner();
    userAddress = await signer.getAddress();

    // 👇 NEW: initialize the AA smart account client right after signer is ready
    try {
      const smartAcc = await initSmartAccount(provider);
      // expose for convenience
      window.smartAccount = smartAcc;
      console.log('✅ Smart Account initialized', smartAcc);
    } catch (aaErr) {
      console.error('AA init failed', aaErr);
    }

    try { window.userAddress = userAddress; window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: userAddress } })); } catch (err) {}
    try {
      const ts = Date.now();
      const nonce = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 24);
      const msg = 'Dak & Chog Tavern\n\nSign-In: ' + nonce + '\nTime: ' + new Date(ts).toISOString() + '\nAddress: ' + userAddress + '\nWallet: ' + providerKey;
      const sig = await signer.signMessage(msg);
      const rec = ethers.utils.verifyMessage(msg, sig);
      if (!rec || String(rec).toLowerCase() !== String(userAddress).toLowerCase()) throw new Error('Signature verification failed');
      try {
        sessionStorage.setItem('walletSigned','true');
        sessionStorage.setItem('walletProvider', providerKey);
        sessionStorage.setItem('walletSig', sig);
        sessionStorage.setItem('walletMsg', msg);
      } catch (err) {}
    } catch (e) {
      throw new Error('Signature required to enter');
    }
    await ensureConfig();

    setConnectButtonAsDisconnect();
    hideInlineConnectIfBannerPresent();
    try { statusEl.innerText = ''; } catch (err) {}
    showToast('Wallet connected', 'success');

    try {
      const chainId = await detectChainId(provider);
      const tavernAddress = await getAddressFor('tavern', provider);
      renderTavernBanner({ contractKey: 'tavern', address: tavernAddress, chainId, wallet: userAddress, labelOverride: 'Address' });
      try {
        const poolAddr = await getAddressFor('pool', provider);
        if (poolAddr && window.PoolABI) {
          const pool = new ethers.Contract(poolAddr, window.PoolABI, signer);
          const owner = await pool.owner();
          const me = String(userAddress || '').toLowerCase();
          const isPoolOwner = owner && String(owner).toLowerCase() === me;
          const isAllowlisted = OWNER_WALLET_ALLOWLIST.includes(me);
          ensureAdminLink(!!(isPoolOwner || isAllowlisted));
        } else {
          ensureAdminLink(false);
        }
      } catch (err) {
        ensureAdminLink(false);
      }
    } catch (err) {}

    try {
      if (!window.io) {
        await new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
          s.onload = resolve;
          s.onerror = resolve;
          document.head.appendChild(s);
        });
      }
      if (window.io) {
        if (!window.__presenceSocket) {
          window.__presenceSocket = window.io(window.location.origin, { path: '/socket.io' });
          window.__presenceSocket.on('connect', () => {
            try { window.__presenceSocket.emit('identify', { addr: userAddress }); } catch (err) {}
            try { window.__presenceSocket.emit('user:location', { path: location.pathname }); } catch (err) {}
          });
        } else {
          try { window.__presenceSocket.emit('identify', { addr: userAddress }); } catch (err) {}
          try { window.__presenceSocket.emit('user:location', { path: location.pathname }); } catch (err) {}
        }
      }
    } catch (err) {}
  } catch (err) {
    statusEl.innerText = 'Connection failed: ' + err.message;
  }
}

// Silent connect (no user prompt): use existing authorization if present
async function silentConnect() {
  // Auto-connect disabled: require explicit user action
  return false;
}

// Auto-connect if previously connected (silent when possible)
async function bootConnect() {
  await ensureConfig();
  try {
    const chainId = await detectChainId(undefined);
    const address = getAddress('tavern', chainId);
    renderTavernBanner({ contractKey: 'tavern', address, chainId, labelOverride: 'Address' });
  } catch (err) {}
  // Auto-connect disabled: do nothing until user clicks connect from landing
  ensureAdminLink(false);
}

// Render network banner on load without connecting wallets
try {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bootConnect();
  } else {
    window.addEventListener('load', () => { bootConnect().catch(()=>{}); });
  }
} catch (err) {}

if (connectButton) connectButton.addEventListener('click', connectWallet);

// Export signer and provider for games
export { signer, provider, userAddress };
// Re-export ethers so consumers can avoid loading the UMD build (CSP-safe)
export { ethers };
// Also expose on window for non-module consumers
try { window.ethers = ethers; } catch (err) {}
// Expose connect for landing so the click handler can trigger wallet prompt immediately
try { window.tavernConnectWallet = connectWallet; } catch (err) {}

// 👇 NEW: export the AA getter so games/pages can use it
export { getSmartAccount };
