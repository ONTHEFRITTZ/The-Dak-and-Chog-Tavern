import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';
import { getAddressFor, detectChainId, getAddress, renderTavernBanner, CONTRACTS, showToast } from './config.js';
import { profileLoad } from './profile.js';

let provider;
let signer;
let userAddress;

// DOM Elements
const connectButton = document.getElementById('connect-wallet');
const statusEl = document.getElementById('status');

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

// Connect Wallet
export async function connectWallet() {
  if (!window.ethereum) return alert('MetaMask not detected.');

  try {
    await ethereum.request({ method: 'eth_requestAccounts' });
    provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    signer = provider.getSigner();
    userAddress = await signer.getAddress();

    // Hide connect button once connected
    try { connectButton.style.display = 'none'; } catch {}
    // Clear redundant banner status; wallet shows on right side
    try { statusEl.innerText = ''; } catch {}
    showToast('Wallet connected', 'success');

    // Update banner with resolved network and unified contract address
    try {
      const chainId = await detectChainId(provider);
      const tavernAddress = await getAddressFor('tavern', provider);
      renderTavernBanner({ contractKey: 'tavern', address: tavernAddress, chainId, wallet: userAddress, labelOverride: 'Address' });
    } catch {}

    sessionStorage.setItem('walletConnected', 'true');
    // Re-establish profile connections and apply settings where possible
    try { await profileLoad(); } catch {}
  } catch (err) {
    statusEl.innerText = 'Connection failed: ' + err.message;
  }
}

// Auto-connect if previously connected
window.addEventListener('load', async () => {
  try {
    const chainId = await detectChainId(undefined);
    const address = getAddress('tavern', chainId);
    renderTavernBanner({ contractKey: 'tavern', address, chainId, labelOverride: 'Address' });
  } catch {}
  if (sessionStorage.getItem('walletConnected') === 'true') await connectWallet();
});

connectButton.addEventListener('click', connectWallet);

// Export signer and provider for games
export { signer, provider, userAddress };
