import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';
// Defer loading of config.js with a version tag to avoid stale cache
let cfgLoaded = false;
let getAddressFor, detectChainId, getAddress, renderTavernBanner, CONTRACTS, showToast, switchToChain, RPC_ENDPOINTS;
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
    switchToChain = mod.switchToChain;
    RPC_ENDPOINTS = mod.RPC_ENDPOINTS;
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

function rememberWalletProvider(key){
  try {
    if (key) {
      sessionStorage.setItem('walletProvider', key);
      window.__preferredWalletKey = key;
    } else {
      sessionStorage.removeItem('walletProvider');
    }
  } catch {}
  try { localStorage.removeItem('walletProvider'); } catch {}
}

function markWalletConnected(flag) {
  try {
    if (flag) {
      sessionStorage.setItem('walletConnected', 'true');
    } else {
      sessionStorage.removeItem('walletConnected');
    }
  } catch {}
  try { localStorage.removeItem('walletConnected'); } catch {}
}

function getPreferredWalletKey(){
  try {
    const sessionChoice = sessionStorage.getItem('walletProvider');
    if (sessionChoice) {
      window.__preferredWalletKey = sessionChoice;
      return sessionChoice;
    }
    const legacy = localStorage.getItem('walletProvider');
    if (legacy) {
      rememberWalletProvider(legacy);
      return legacy;
    }
  } catch {}
  return window.__preferredWalletKey || '';
}

function resolveInjectedEvmProvider(explicit){
  try {
    let key = explicit || getPreferredWalletKey();
    if (key) {
      if (key === 'phantom') {
        const p = window?.phantom?.ethereum;
        if (p) return p;
        return undefined;
      }
      if (key === 'metamask') {
        const meta = window?.ethereum;
        if (meta) return meta;
        return undefined;
      }
    }
    // No stored preference; fall back to whichever provider is present (MetaMask first)
    if (window?.ethereum && !window?.phantom?.ethereum) return window.ethereum;
    if (window?.phantom?.ethereum && !window?.ethereum) return window.phantom.ethereum;
    if (window?.ethereum) return window.ethereum;
    if (window?.phantom?.ethereum) return window.phantom.ethereum;
  } catch {}
  return undefined;
}

// Ensure wallet is on Monad Testnet (chainId 10143)
async function ensureMonadNetwork(curProvider){
  try {
    const chainId = await detectChainId(curProvider);
    if (Number(chainId) === 10143) return true;
    // Attempt switch on the selected injected provider only; if chain unknown (4902), add it first
    const hex = '0x' + Number(10143).toString(16);
    const injected = (curProvider && curProvider.provider) || (window?.__walletProvider) || (window?.phantom?.ethereum) || window?.ethereum;
    if (!injected || typeof injected.request !== 'function') return false;
    try {
      await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
      return true;
    } catch (e) {
      const code = e && (e.code ?? e?.data?.originalError?.code);
      if (code === 4902 || /unrecognized|not added/i.test(String(e.message||''))) {
        try {
          let rpc = (RPC_ENDPOINTS && RPC_ENDPOINTS[10143]) || '';
          if (rpc.startsWith('wss://')) rpc = 'https://' + rpc.slice(6);
          if (rpc.startsWith('ws://')) rpc = 'http://' + rpc.slice(5);
          if (!rpc) rpc = 'https://monad-testnet.drpc.org';
          const params = [{
            chainId: hex,
            chainName: 'Monad Testnet',
            nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
            rpcUrls: [rpc],
            blockExplorerUrls: ['https://testnet.monadexplorer.com']
          }];
          await injected.request({ method: 'wallet_addEthereumChain', params });
          await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
          return true;
        } catch {}
      }
    }
  } catch {}
  return false;
}

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
      markWalletConnected(false);
      rememberWalletProvider('');
      try { window.__walletProvider = undefined; } catch {}
      provider = undefined;
      signer = undefined;
      userAddress = undefined;
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
export async function connectWallet(explicitProviderKey) {
  await ensureConfig();
  const injected = resolveInjectedEvmProvider(explicitProviderKey);
  if (!injected) return alert('No EVM wallet detected (MetaMask or Phantom).');

  try {
    await injected.request({ method: 'eth_requestAccounts' });
    provider = new ethers.providers.Web3Provider(injected, 'any');
    signer = provider.getSigner();
    userAddress = await signer.getAddress();
    try { window.__walletProvider = injected; } catch {}
    try {
      const key = (injected === (window?.phantom?.ethereum)) ? 'phantom' : 'metamask';
      rememberWalletProvider(key);
    } catch {}
    // Require a signature to confirm login. If user cancels, treat as not connected.
    // Try multiple method/param orders for compatibility across wallets (MetaMask vs Phantom).
    async function forceLoginSignature() {
      const msg = `Dak & Chog Tavern login @ ${new Date().toISOString()}`;
      const hex = '0x' + Array.from(new TextEncoder().encode(msg)).map(b=>b.toString(16).padStart(2,'0')).join('');
      const attempts = [
        { method: 'personal_sign', params: [msg, userAddress] },
        { method: 'personal_sign', params: [userAddress, msg] },
        { method: 'eth_personalSign', params: [hex, userAddress] },
        { method: 'eth_personalSign', params: [userAddress, hex] },
      ];
      let lastErr;
      for (const a of attempts) {
        try { await injected.request(a); return true; } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('Signature rejected');
    }
    try { await forceLoginSignature(); try { sessionStorage.setItem('walletSigned','true'); } catch {} } catch (e) {
      try { sessionStorage.removeItem('walletSigned'); } catch {}
      // Clear any partial state and abort
      rememberWalletProvider('');
      try { window.__walletProvider = undefined; } catch {}
      provider = undefined; signer = undefined; userAddress = undefined;
      throw e;
    }
    // Ensure Monad Testnet is selected AFTER signature so MetaMask doesn't stall the initial login UX
    try { const ok = await ensureMonadNetwork(provider); if (!ok) { try { showToast && showToast('Please switch to Monad Testnet', 'error'); } catch {} } } catch {}
    try { window.userAddress = userAddress; window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: userAddress } })); } catch {}

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
      // Owner-only admin link (visible only if signer is contract owner)
      try {
        if (tavernAddress && window.TavernABI) {
          const c = new ethers.Contract(tavernAddress, window.TavernABI, signer);
          const owner = await c.owner();
          ensureAdminLink(owner && owner.toLowerCase() === userAddress.toLowerCase());
        } else {
          ensureAdminLink(false);
        }
      } catch {
        ensureAdminLink(false);
      }
    } catch {}

    try {
      const key = explicitProviderKey || (injected === (window?.phantom?.ethereum) ? 'phantom' : 'metamask');
      rememberWalletProvider(key);
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
  await ensureConfig();
  const injected = resolveInjectedEvmProvider();
  if (!injected) return false;
  try {
    provider = new ethers.providers.Web3Provider(injected, 'any');
    // Prefer direct EIP-1193 call for broader wallet compatibility (e.g., Phantom EVM)
    let accounts = [];
    try { accounts = await injected.request({ method: 'eth_accounts' }); } catch {}
    if (!accounts || !accounts.length) {
      // Fallback to ethers provider method if needed
      try { accounts = await provider.listAccounts(); } catch {}
    }
    if (!accounts || !accounts.length) return false;
    signer = provider.getSigner();
    userAddress = accounts[0];
    try { window.__walletProvider = injected; } catch {}
    try { await ensureMonadNetwork(provider); } catch {}
    try { window.userAddress = userAddress; window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: userAddress } })); } catch {}
    setConnectButtonAsDisconnect();
    hideInlineConnectIfBannerPresent();
    try { statusEl.innerText = ''; } catch {}
    try {
      const onLanding = (function(){ try { const p=String(location.pathname||'').toLowerCase(); return p.includes('/landing') || p.endsWith('landing.html'); } catch { return false; } })();
      if (!onLanding) {
        const chainId = await detectChainId(provider);
        const tavernAddress = await getAddressFor('tavern', provider);
        renderTavernBanner({ contractKey: 'tavern', address: tavernAddress, chainId, wallet: userAddress, labelOverride: 'Address' });
        try {
          if (tavernAddress && window.TavernABI) {
            const c = new ethers.Contract(tavernAddress, window.TavernABI, signer);
            const owner = await c.owner();
            ensureAdminLink(owner && owner.toLowerCase() === userAddress.toLowerCase());
          } else {
            ensureAdminLink(false);
          }
        } catch { ensureAdminLink(false); }
      } else {
        try { const nb = document.getElementById('network-banner'); if (nb) nb.remove(); } catch {}
      }
    } catch {}
    markWalletConnected(true);
    // Announce presence (best-effort)
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
    // Avoid auto-loading profile on silent connect
    return true;
  } catch {
    return false;
  }
}

// Auto-connect if previously connected (silent when possible)
async function bootConnect() {
  await ensureConfig();
  // Do not render network/contract banner or auto-connect on the landing page
  try {
    const path = String(location.pathname || '').toLowerCase();
    const isLanding = path.includes('/landing') || path.endsWith('landing.html');
    if (isLanding) {
      try { setConnectButtonAsConnect(); } catch {}
      return;
    }
  } catch {}
  // Defer banner rendering until after silentConnect so the correct provider/network is used
  let autoConnected = false;
  autoConnected = await silentConnect();
  // No storage-based reconnect; rely solely on provider authorization
  if (!autoConnected) {
    ensureAdminLink(false);
    try {
      const path = String(location.pathname||'');
      const isTavern = path === '/' || /\/index\.html$/.test(path);
      if (isTavern) {
        await connectWallet();
      } else {
        setConnectButtonAsConnect();
      }
    } catch {}
  } else {
    // Already connected: render banner and listen for chain changes
    try {
      const chainId = await detectChainId(provider);
      const tavernAddress = await getAddressFor('tavern', provider);
      renderTavernBanner({ contractKey: 'tavern', address: tavernAddress, chainId, wallet: userAddress, labelOverride: 'Address' });
      hideInlineConnectIfBannerPresent();
      try {
        const base = provider && provider.provider;
        if (base && base.on) {
          base.on('chainChanged', async () => {
            try {
              const cid = await detectChainId(provider);
              const addr = await getAddressFor('tavern', provider);
              renderTavernBanner({ contractKey: 'tavern', address: addr, chainId: cid, wallet: userAddress, labelOverride: 'Address' });
            } catch {}
          });
          base.on('accountsChanged', (accs=[]) => {
            try {
              if (!accs || !accs.length) {
                rememberWalletProvider('');
                try { window.__walletProvider = undefined; } catch {}
                provider = undefined; signer = undefined; userAddress = undefined;
                try { sessionStorage.removeItem('walletSigned'); } catch {}
                location.replace('/landing.html');
              }
            } catch {}
          });
          try { base.on('disconnect', () => { try { sessionStorage.removeItem('walletSigned'); } catch {} try { location.replace('/landing.html'); } catch {} }); } catch {}
        }
      } catch {}
    } catch {}
  }
}

// Run immediately if the module loads after window load (BFCache or async loader),
// and also register normal load hook.
try {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bootConnect();
  }
} catch {}
window.addEventListener('load', () => { bootConnect().catch(()=>{}); });

// When returning to a page via back/forward cache, silently re-check wallet
// so the banner reflects the connected state without requiring a click.
try {
  window.addEventListener('pageshow', async () => {
    try { await silentConnect(); } catch {}
  });
} catch {}

if (connectButton) connectButton.addEventListener('click', connectWallet);

// Export signer and provider for games
export { signer, provider, userAddress };
// Re-export ethers so consumers can avoid loading the UMD build (CSP-safe)
export { ethers };
// Also expose on window for non-module consumers
try { window.ethers = ethers; } catch {}


