import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';
import { getAddressFor, detectChainId, getAddress, renderTavernBanner, CONTRACTS, showToast } from './config.js';

let provider;
let signer;
let userAddress;

// DOM Elements
const connectButton = document.getElementById('connect-wallet');
const fundButton = document.getElementById('fund-contract');
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

    connectButton.innerText = 'Wallet Connected';
    statusEl.innerText = `Wallet connected: ${userAddress}`;
    showToast('Wallet connected', 'success');

    // Update banner with resolved network and address
    try {
      const chainId = await detectChainId(provider);
      const shellAddress = await getAddressFor('shell', provider);
      renderTavernBanner({ contractKey: 'shell', address: shellAddress, chainId, wallet: userAddress, labelOverride: 'Address' });
    } catch {}

    enableFundButton();
    sessionStorage.setItem('walletConnected', 'true');
  } catch (err) {
    statusEl.innerText = 'Connection failed: ' + err.message;
  }
}

// Enable fund button and handle funding of all configured game contracts
function enableFundButton() {
  fundButton.style.display = 'inline-block';
  fundButton.addEventListener('click', async () => {
    const amount = prompt('Enter amount to fund each game (MON):');
    if (!amount) return;
    let parsed;
    try { parsed = ethers.utils.parseEther(String(amount)); } catch { statusEl.innerText = 'Enter a valid amount.'; return; }
    if (parsed.lte(0)) { statusEl.innerText = 'Enter a positive amount.'; return; }

    const keys = Object.keys(CONTRACTS || {});
    if (!keys.length) { statusEl.innerText = 'No game contracts configured.'; showToast('No game contracts configured', 'error'); return; }

    statusEl.innerText = `Funding ${keys.length} contract(s)...`;
    showToast(`Funding ${keys.length} contract(s)…`, 'info');

    const results = [];
    for (const key of keys) {
      try {
        const address = await getAddressFor(key, provider);
        if (!address) { results.push(`${key}: no address`); continue; }

        await ensureAbiLoaded(key);
        const abi = getAbiFromWindow(key);
        if (!abi) { results.push(`${key}: missing ABI`); continue; }

        const contract = new ethers.Contract(address, abi, signer);
        statusEl.innerText = `Funding ${key}...`;
        const tx = await contract.fund({ value: parsed });
        await tx.wait();
        results.push(`${key}: funded ${amount} MON`);
        showToast(`${key}: funded ${amount} MON`, 'success');
      } catch (err) {
        console.error(`Fund ${key} error:`, err);
        results.push(`${key}: error - ${err?.message || 'failed'}`);
        showToast(`${key}: ${err?.message || 'funding failed'}`, 'error');
      }
    }

    statusEl.innerText = results.join(' | ');
  });
}

// Auto-connect if previously connected
window.addEventListener('load', async () => {
  try {
    const chainId = await detectChainId(undefined);
    const address = getAddress('shell', chainId);
    renderTavernBanner({ contractKey: 'shell', address, chainId, labelOverride: 'Address' });
  } catch {}
  if (sessionStorage.getItem('walletConnected') === 'true') await connectWallet();
});

connectButton.addEventListener('click', connectWallet);

// Export signer and provider for games
export { signer, provider, userAddress };
