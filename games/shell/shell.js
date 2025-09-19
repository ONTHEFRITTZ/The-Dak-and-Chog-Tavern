// shell.js
// Uses the unified Tavern contract ABI (window.TavernABI)
import { getAddressFor, detectChainId, renderTavernBanner, showToast } from '../../js/config.js';
import { attachProvider } from '../../js/contract-utils.js';

function getShells() { try { return Array.from(document.querySelectorAll('.shell')); } catch { return []; } }
const statusEl = document.getElementById('shell-result') || document.getElementById('status');
const playsEl = document.getElementById('plays');
const returnBtn = document.getElementById('return');
const betInput = document.getElementById('bet');
const rulesOverlay = document.getElementById('rules-overlay');
const rulesAck = document.getElementById('rules-ack');
const openRulesBtn = document.getElementById('open-rules');
const RULES_VERSION = 'v2';
// Show rules every load (no 24h gating); sync with global fallback
let shellAck = !!window.__shellAck;

function setShellInteractivity(enabled) {
  try {
    betInput.disabled = !enabled;
  } catch {}
}

let provider;
let signer;
let userAddress;
let tavernAddress;

async function init() {
  if (!window.ethereum) {
    alert('MetaMask not detected.');
    return false;
  }
  // Ensure ethers is loaded (fallback if needed)
  try { if (!window.ethers) { await new Promise((res)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js'; s.onload=res; s.onerror=res; document.head.appendChild(s); }); } } catch {}
  provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
  signer = provider.getSigner();
  try { attachProvider(provider); } catch {}
  try {
    userAddress = await signer.getAddress();
  } catch {
    try { await window.ethereum.request({ method:'eth_requestAccounts' }); userAddress = await signer.getAddress(); } catch { return false; }
  }
  tavernAddress = await getAddressFor('tavern', provider);
  try {
    const chainId = await detectChainId(provider);
    const unifiedAddress = await getAddressFor('tavern', provider);
    renderTavernBanner({ contractKey: 'tavern', address: unifiedAddress, chainId, wallet: userAddress });
  } catch {}
  return true;
}

// Ensure Tavern ABI is present before building Contract
async function ensureAbi() {
  if (window.TavernABI) return true;
  const candidates = ['/js/TavernABI.js','../../js/TavernABI.js'];
  for (const src of candidates) {
    try {
      await new Promise((resolve) => { const s=document.createElement('script'); s.src=src; s.onload=()=>resolve(true); s.onerror=()=>resolve(false); document.head.appendChild(s); });
      if (window.TavernABI) return true;
    } catch {}
  }
  return !!window.TavernABI;
}

function bindShellClicks() {
  const shells = getShells();
  shells.forEach((shell) => {
    // Avoid double-binding
    if (shell.__boundClick) return; shell.__boundClick = true;
    shell.addEventListener('click', async () => {
      if (!shellAck) { try { if (rulesOverlay) rulesOverlay.style.display = 'flex'; } catch {}; return; }
      try {
        const ok = await init();
        if (!ok) { statusEl.innerText = 'Connect wallet to play.'; return; }

        const guessDisplay = parseInt(shell.dataset.guess); // 1,2,3 for UI
        const guess = Math.max(0, (guessDisplay|0) - 1);    // 0,1,2 for contract
        let betAmount = parseFloat(betInput.value);
        if (isNaN(betAmount) || betAmount < 0.001) betAmount = 0.001;

        // Ensure ABI available (fallback load if needed)
        await ensureAbi();
        if (!window.TavernABI) { statusEl.innerText = 'Game ABI not loaded. Please retry.'; return; }
        const contract = new ethers.Contract(tavernAddress, window.TavernABI, signer);

        statusEl.innerText = 'Playing...';
        try { showToast('Playing…', 'info'); } catch {}

        const tx = await contract.playShell(guess, {
          value: ethers.utils.parseEther(betAmount.toString()),
          gasLimit: 200000, // manual gas limit
        });

        const receipt = await tx.wait();

        // Parse the Played event from the receipt
        const iface = new ethers.utils.Interface(window.TavernABI);
        let playedEvent;
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed.name === 'ShellPlayed') { playedEvent = parsed.args; break; }
          } catch (e) { /* ignore */ }
        }

        if (!playedEvent) {
          statusEl.innerText = 'Transaction mined but Played event not found.';
          try { showToast('Played event not found', 'error'); } catch {}
          return;
        }

        const { guess: guessEvent, won, winningCup } = playedEvent;
        const displayGuess = Number(guessEvent) + 1;
        const displayWin = Number(winningCup) + 1;
        const resultText = won
          ? `You won! Your guess: ${displayGuess}, Winning cup: ${displayWin}`
          : `You lost. Your guess: ${displayGuess}, Winning cup: ${displayWin}`;
        try { showToast(won ? 'You won!' : 'You lost', won ? 'success' : 'info'); } catch {}

        statusEl.innerText = resultText;
        const li = document.createElement('li');
        li.innerText = resultText; playsEl.prepend(li);
      } catch (err) {
        console.error(err);
        statusEl.innerText = `Error: ${err.message}`;
        try { showToast(err.message, 'error'); } catch {}
      }
    });
  });
}

returnBtn.addEventListener('click', () => { window.location.href = '/index.html'; });

// Persist bet value
try {
  const savedBet = localStorage.getItem('shell.bet');
  if (savedBet && !isNaN(parseFloat(savedBet))) betInput.value = savedBet;
} catch {}
betInput.addEventListener('input', () => {
  try { localStorage.setItem('shell.bet', betInput.value || ''); } catch {}
});

// Keyboard navigation and accessibility for shells
try {
  const shells = getShells();
  shells.forEach((el, idx) => {
    el.setAttribute('tabindex', el.getAttribute('tabindex') || '0');
    el.addEventListener('keydown', (e) => {
      if (!shellAck) { return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); const t = shells[(idx + shells.length - 1) % shells.length]; t && t.focus(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); const t = shells[(idx + 1) % shells.length]; t && t.focus(); }
    });
  });
} catch {}

// Show rules modal at load and block interactions until ack (per load)
const onReady = (fn) => { if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', fn, { once: true }); } else { fn(); } };
onReady(() => {
  bindShellClicks();
  // Always require rules acknowledgement per load
  shellAck = !!window.__shellAck;
  try { if (!shellAck && rulesOverlay) { rulesOverlay.style.display = 'flex'; } } catch {}
  setShellInteractivity(false);

  function acknowledgeAndClose() {
    shellAck = true;
    try { rulesOverlay.style.display = 'none'; } catch {}
    setShellInteractivity(true);
  }

  rulesAck?.addEventListener('click', () => { acknowledgeAndClose(); try { window.__shellAck = true; } catch{} });
  // Allow user to reopen rules explicitly via button
  openRulesBtn?.addEventListener('click', () => { try { rulesOverlay.style.display = 'flex'; } catch {} });
  // Dismiss when clicking outside the modal (on scrim only) or with Escape
  try {
    rulesOverlay.addEventListener('click', (e) => { if (e.target === rulesOverlay) acknowledgeAndClose(); });
    window.addEventListener('keydown', (e) => {
      if (rulesOverlay && rulesOverlay.style.display !== 'none' && e.key === 'Escape') acknowledgeAndClose();
    });
  } catch {}
  // Listen for global fallback ack event (in case inline script handled it)
  try { window.addEventListener('shell:ack', () => { shellAck = true; setShellInteractivity(true); }); } catch{}
});
