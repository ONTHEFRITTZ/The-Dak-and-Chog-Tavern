// shell.js
// Works with existing index.html and ShellABI.js loaded globally
import { getAddressFor, detectChainId, renderTavernBanner, showToast } from '../../js/config.js';

const shellElements = document.querySelectorAll('.shell');
const statusEl = document.getElementById('status');
const playsEl = document.getElementById('plays');
const returnBtn = document.getElementById('return');
const betInput = document.getElementById('bet');
const rulesOverlay = document.getElementById('rules-overlay');
const rulesAck = document.getElementById('rules-ack');
const openRulesBtn = document.getElementById('open-rules');
const RULES_VERSION = 'v2';
function rulesFresh(key) { try { const t = Number(localStorage.getItem(key) || 0); return Date.now() - t < 86400000; } catch { return false; } }
let shellAck = false;

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
    return;
  }
  provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
  signer = provider.getSigner();
  userAddress = await signer.getAddress();
  tavernAddress = await getAddressFor('tavern', provider);
  try {
    const chainId = await detectChainId(provider);
    const unifiedAddress = await getAddressFor('tavern', provider);
    renderTavernBanner({ contractKey: 'tavern', address: unifiedAddress, chainId, wallet: userAddress });
  } catch {}
}

shellElements.forEach((shell) => {
  shell.addEventListener('click', async () => {
    if (!shellAck) { try { rulesOverlay.style.display = 'flex'; } catch {}; return; }
    try {
      await init();

      const guess = parseInt(shell.dataset.guess);
      let betAmount = parseFloat(betInput.value);
      if (isNaN(betAmount) || betAmount < 0.001) betAmount = 0.001;

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
          if (parsed.name === 'ShellPlayed') {
            playedEvent = parsed.args;
            break;
          }
        } catch (e) {
          // Ignore logs that don't match
        }
      }

      if (!playedEvent) {
        statusEl.innerText = 'Transaction mined but Played event not found.';
        try { showToast('Played event not found', 'error'); } catch {}
        return;
      }

      const { guess: guessEvent, won, winningCup } = playedEvent;

      const resultText = won
        ? `You won! Your guess: ${guessEvent}, Winning cup: ${winningCup}`
        : `You lost. Your guess: ${guessEvent}, Winning cup: ${winningCup}`;
      try { showToast(won ? 'You won!' : 'You lost', won ? 'success' : 'info'); } catch {}

      statusEl.innerText = resultText;

      const li = document.createElement('li');
      li.innerText = resultText;
      playsEl.prepend(li);

    } catch (err) {
      console.error(err);
      statusEl.innerText = `Error: ${err.message}`;
      try { showToast(err.message, 'error'); } catch {}
    }
  });
});

returnBtn.addEventListener('click', () => {
  window.location.href = '../../index.html';
});

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
  const shells = Array.from(document.querySelectorAll('.shell'));
  shells.forEach((el, idx) => {
    el.setAttribute('tabindex', el.getAttribute('tabindex') || '0');
    el.addEventListener('keydown', (e) => {
      if (!shellAck) { try { rulesOverlay.style.display = 'flex'; } catch {}; return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); const t = shells[(idx + shells.length - 1) % shells.length]; t && t.focus(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); const t = shells[(idx + 1) % shells.length]; t && t.focus(); }
    });
  });
} catch {}

// Show rules modal at load and block interactions until ack (per load)
window.addEventListener('DOMContentLoaded', () => {
  try { shellAck = rulesFresh(`rulesAck.shell.${RULES_VERSION}`); if (!shellAck) { rulesOverlay.style.display = 'flex'; setShellInteractivity(false); } } catch {}
  rulesAck?.addEventListener('click', () => { shellAck = true; try { rulesOverlay.style.display = 'none'; } catch {}; setShellInteractivity(true); try { localStorage.setItem(`rulesAck.shell.${RULES_VERSION}`, String(Date.now())); } catch {} });
  openRulesBtn?.addEventListener('click', () => { try { rulesOverlay.style.display = 'flex'; } catch {} });
});
