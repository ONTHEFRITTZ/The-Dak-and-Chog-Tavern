// shell.js
// Uses the unified Tavern contract ABI (window.TavernABI)
import { getAddressFor, detectChainId, renderTavernBanner, showToast } from '../../js/config.js';
import { attachProvider } from '../../js/contract-utils.js';
import { provider as walletProvider, signer as walletSigner } from '../../js/tavern.js';

const shellElements = document.querySelectorAll('.shell');
const statusEl = document.getElementById('shell-result') || document.getElementById('status');
const playsEl = document.getElementById('plays');
const returnBtn = document.getElementById('return');
const betInput = document.getElementById('bet');
// Rules ACK removed across site

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
  // Prefer the site-selected wallet (MetaMask or Phantom EVM) from tavern.js
  provider = walletProvider || (window.ethereum ? new ethers.providers.Web3Provider(window.ethereum, 'any') : undefined);
  signer = walletSigner || (provider ? provider.getSigner() : undefined);
  if (!provider || !signer) { alert('No EVM wallet detected. Connect on the landing page.'); return; }
  try { attachProvider(provider); } catch {}
  userAddress = await signer.getAddress();
  // Prefer dedicated Shell submitter contract; fall back to Tavern
  tavernAddress = await getAddressFor('shell', provider) || await getAddressFor('tavern', provider);
  try {
    const chainId = await detectChainId(provider);
    const unifiedAddress = await getAddressFor('tavern', provider);
    renderTavernBanner({ contractKey: 'tavern', address: unifiedAddress, chainId, wallet: userAddress });
  } catch {}
}

shellElements.forEach((shell) => {
  shell.addEventListener('click', async () => {
    // rules gate removed
    try {
      await init();

      const guessDisplay = parseInt(shell.dataset.guess); // 1,2,3 for UI
      const guess = Math.max(0, (guessDisplay|0) - 1);    // 0,1,2 for contract
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

      const displayGuess = Number(guessEvent) + 1;
      const displayWin = Number(winningCup) + 1;
      const resultText = won
        ? `You won! Your guess: ${displayGuess}, Winning cup: ${displayWin}`
        : `You lost. Your guess: ${displayGuess}, Winning cup: ${displayWin}`;
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
  const shells = Array.from(document.querySelectorAll('.shell'));
  shells.forEach((el, idx) => {
    el.setAttribute('tabindex', el.getAttribute('tabindex') || '0');
    el.addEventListener('keydown', (e) => {
      // rules gate removed
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); const t = shells[(idx + shells.length - 1) % shells.length]; t && t.focus(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); const t = shells[(idx + 1) % shells.length]; t && t.focus(); }
    });
  });
} catch {}

// Show rules modal at load and block interactions until ack (per load)
// No rules overlay or gating
