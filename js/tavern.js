import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';

import './bundler.js';

function resolveInjectedProvider(key) {
  try {
    const pref = String(key || '').toLowerCase();
    if (pref === 'phantom') {
      return (window.phantom && window.phantom.ethereum) || null;
    }
    if (pref === 'metamask') {
      const eth = window.ethereum;
      if (eth) {
        if (Array.isArray(eth.providers)) {
          const mm = eth.providers.find((p) => p && p.isMetaMask);
          if (mm) return mm;
        }
        if (eth.isMetaMask) return eth;
        return eth;
      }
      return null;
    }
    if (window.__walletProvider) return window.__walletProvider;
    if (window.ethereum) return window.ethereum;
    return (window.phantom && window.phantom.ethereum) || null;
  } catch {
    return window.__walletProvider || window.ethereum || (window.phantom && window.phantom.ethereum) || null;
  }
}
function setGlobalProvider(injected, key) {
  if (!injected) return;
  try { window.__walletProvider = injected; } catch {}
  try { window.__walletProviderKey = key || ''; } catch {}
  try {
    let assigned = false;
    try { window.ethereum = injected; if (window.ethereum === injected) assigned = true; } catch { assigned = false; }
    if (!assigned) {
      try {
        Object.defineProperty(window, 'ethereum', { value: injected, configurable: true, writable: true });
        assigned = (window.ethereum === injected);
      } catch {}
    }
  } catch {}
}
function primeProviderFromSession() {
  try {
    const key = sessionStorage.getItem('walletProvider') || window.__walletProviderKey || '';
    const injected = resolveInjectedProvider(key);
    if (injected) setGlobalProvider(injected, key);
    return injected;
  } catch {
    return null;
  }
}
try { window.__getSelectedProvider = () => {
  const key = sessionStorage.getItem('walletProvider') || window.__walletProviderKey || '';
  const injected = resolveInjectedProvider(key);
  if (injected) setGlobalProvider(injected, key);
  return injected;
}; } catch {}
try { window.__setSelectedProvider = setGlobalProvider; } catch {}
primeProviderFromSession();



function resolveInjectedProvider(key) {
  try {
    const pref = String(key || '').toLowerCase();
    if (pref === 'phantom') {
      return (window.phantom && window.phantom.ethereum) || null;
    }
    if (pref === 'metamask') {
      const eth = window.ethereum;
      if (eth) {
        if (Array.isArray(eth.providers)) {
          const mm = eth.providers.find((p) => p && p.isMetaMask);
          if (mm) return mm;
        }
        if (eth.isMetaMask) return eth;
        return eth;
      }
      return null;
    }
    if (window.__walletProvider) return window.__walletProvider;
    if (window.ethereum) return window.ethereum;
    return (window.phantom && window.phantom.ethereum) || null;
  } catch {
    return window.__walletProvider || window.ethereum || (window.phantom && window.phantom.ethereum) || null;
  }
}
function setGlobalProvider(injected, key) {
  if (!injected) return;
  try { window.__walletProvider = injected; } catch {}
  try { window.__walletProviderKey = key || ''; } catch {}
  try {
    let assigned = false;
    try { window.ethereum = injected; if (window.ethereum === injected) assigned = true; } catch { assigned = false; }
    if (!assigned) {
      try {
        Object.defineProperty(window, 'ethereum', { value: injected, configurable: true, writable: true });
        assigned = (window.ethereum === injected);
      } catch {}
    }
  } catch {}
}
function primeProviderFromSession() {
  try {
    const key = sessionStorage.getItem('walletProvider') || window.__walletProviderKey || '';
    const injected = resolveInjectedProvider(key);
    if (injected) setGlobalProvider(injected, key);
    return injected;
  } catch {
    return null;
  }
}
try { window.__getSelectedProvider = () => {
  const key = sessionStorage.getItem('walletProvider') || window.__walletProviderKey || '';
  const injected = resolveInjectedProvider(key);
  if (injected) setGlobalProvider(injected, key);
  return injected;
}; } catch {}
try { window.__setSelectedProvider = setGlobalProvider; } catch {}
primeProviderFromSession();


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
import { profileLoad } from './profile.js';

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
  } catch {}
}

function ensureAdminLink(show) {
  try {
    // Only show Admin link on Tavern homepage
    try {
      const p = String((location && location.pathname) || '').toLowerCase();
      const isTavern = (p === '/' || p === '/index.html');
      if (!isTavern) show = false;
    } catch {}
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

// Resolve a global ABI name for a given contract key, e.g., 'shell' -> window.ShellABI
function getAbiFromWindow(contractKey) {
  try {
    const cap = contractKey.charAt(0).toUpperCase() + contractKey.slice(1);
    return window[cap + 'ABI'] || window[contractKey + 'ABI'];
  } catch {
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
    } catch {
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
      try { localStorage.removeItem('walletConnected'); } catch {}
      try { sessionStorage.removeItem('walletConnected'); } catch {}
      try { location.replace('/landing.html'); } catch { location.href='/landing.html'; }
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

// Connect Wallet
export async function connectWallet(key, injectedOverride) {
  // Prefer explicit provider override (from EIP-6963) then MetaMask
  let injected = null;
  try {
    if (injectedOverride && typeof injectedOverride.request === 'function') {
      injected = injectedOverride;
    } else {
      const eth = window.ethereum;
      if (eth && eth.isMetaMask) injected = eth;
      else if (eth && Array.isArray(eth.providers)) injected = eth.providers.find(p=>p&&p.isMetaMask) || eth;
      else injected = eth || null;
    }
  } catch {}
  if (!injected) {\n    const resolved = resolveInjectedProvider(key);\n    if (resolved) injected = resolved;\n  }\n  if (!injected) {\n    let sessionKey = '';\n    try { sessionKey = sessionStorage.getItem('walletProvider') || window.__walletProviderKey || ''; } catch {}\n    const fromSession = resolveInjectedProvider(sessionKey);\n    if (fromSession) injected = fromSession;\n  }\n  if (injected) {\n    if (!key) {\n      try {\n        if (injected === (window.phantom && window.phantom.ethereum)) key = 'phantom';\n        else if (injected.isMetaMask) key = 'metamask';\n      } catch {}\n    }\n    setGlobalProvider(injected, key);\n  }\n  if (!injected || typeof injected.request !== 'function') return alert('Wallet not detected. Please install the selected wallet.');

  try {
    await injected.request({ method: 'eth_requestAccounts' });
    provider = new ethers.providers.Web3Provider(injected, 'any');
    signer = provider.getSigner();
    userAddress = await signer.getAddress();
    try { window.userAddress = userAddress; window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: userAddress } })); } catch {}
    // Force a fresh sign-in signature on landing
    try {
      const ts = Date.now();
      const nonce = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 24);
      const msg = `Dak & Chog Tavern\n\nSign-In: ${nonce}\nTime: ${new Date(ts).toISOString()}\nAddress: ${userAddress}\nWallet: ${key||'injected'}`;
      const sig = await signer.signMessage(msg);
      const rec = ethers.utils.verifyMessage(msg, sig);
      if (!rec || String(rec).toLowerCase() !== String(userAddress).toLowerCase()) throw new Error('Signature verification failed');
      try {
        sessionStorage.setItem('walletSigned','true');
        sessionStorage.setItem('walletProvider', String(key||'injected'));
        sessionStorage.setItem('walletSig', sig);
        sessionStorage.setItem('walletMsg', msg);
      } catch {}
    } catch (e) {
      throw new Error('Signature required to enter');
    }
    await ensureConfig();

    // Update top banner controls
    setConnectButtonAsDisconnect();
    hideInlineConnectIfBannerPresent();
    try { statusEl.innerText = ''; } catch {}
    showToast('Wallet connected', 'success');

    // Update banner with resolved network and unified contract address
    try {
      const chainId = await detectChainId(provider);
      const tavernAddress = await getAddressFor('tavern', provider);
      renderTavernBanner({ contractKey: 'tavern', address: tavernAddress, chainId, wallet: userAddress, labelOverride: 'Address' });
      // Owner-only admin link: show if wallet is Pool owner on current chain, or allowlisted
      try {
        const poolAddr = await getAddressFor('pool', provider);
        if (poolAddr && window.PoolABI) {
          const pool = new ethers.Contract(poolAddr, window.PoolABI, signer);
          const owner = await pool.owner();
          const me = String(userAddress||'').toLowerCase();
          const isPoolOwner = owner && String(owner).toLowerCase() === me;
          const isAllowlisted = OWNER_WALLET_ALLOWLIST.includes(me);
          ensureAdminLink(!!(isPoolOwner || isAllowlisted));
        } else {
          ensureAdminLink(false);
        }
      } catch {
        ensureAdminLink(false);
      }
    } catch {}
    // Announce presence to realtime server (best-effort)
    try {
      if (!window.io) {
        await new Promise((resolve)=>{ const s=document.createElement('script'); s.src='https://cdn.socket.io/4.7.5/socket.io.min.js'; s.onload=resolve; s.onerror=resolve; document.head.appendChild(s); });
      }
      if (window.io) {
        if (!window.__presenceSocket) {
          window.__presenceSocket = window.io(window.location.origin, { path: '/socket.io' });
          window.__presenceSocket.on('connect', ()=>{
            try { window.__presenceSocket.emit('identify', { addr: userAddress }); } catch {}
            try { window.__presenceSocket.emit('user:location', { path: location.pathname }); } catch {}
          });
        } else {
          try { window.__presenceSocket.emit('identify', { addr: userAddress }); } catch {}
          try { window.__presenceSocket.emit('user:location', { path: location.pathname }); } catch {}
        }
      }
    } catch {}
    // Do not auto-load profile here to avoid signature prompts on non-game pages
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
  } catch {}
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
} catch {}

if (connectButton) connectButton.addEventListener('click', connectWallet);

// Export signer and provider for games
export { signer, provider, userAddress };
// Re-export ethers so consumers can avoid loading the UMD build (CSP-safe)
export { ethers };
// Also expose on window for non-module consumers
try { window.ethers = ethers; } catch {}
// Expose connect for landing so the click handler can trigger wallet prompt immediately
try { window.tavernConnectWallet = connectWallet; } catch {}
