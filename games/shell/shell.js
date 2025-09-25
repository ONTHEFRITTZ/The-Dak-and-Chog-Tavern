// shell.js
// Uses Shell pooled contract if provided; falls back to Tavern
import { getAddressFor, detectChainId, renderTavernBanner, showToast } from '../../js/config.js';
import { attachProvider } from '../../js/contract-utils.js';
import { provider as walletProvider, signer as walletSigner } from '../../js/tavern.js';
import { detectBundler, walletSendCalls, extractTxHash, waitForTransactionReceipt } from '../../js/bundler.js';

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
let tavernAddress; // send target (shell or tavern)
let sendAbi;       // ABI chosen per target

async function ensureShellAbi() {
  if (window.ShellABI) return true;
  const candidates = ['/js/ShellABI.js','../../js/ShellABI.js'];
  for (const src of candidates) {
    try {
      await new Promise((resolve)=>{ const s=document.createElement('script'); s.src=src; s.onload=()=>resolve(true); s.onerror=()=>resolve(false); document.head.appendChild(s); });
      if (window.ShellABI) return true;
    } catch {}
  }
  return !!window.ShellABI;
}

async function init() {
  // Prefer the site-selected wallet (MetaMask or Phantom EVM) from tavern.js
  provider = walletProvider || (window.ethereum ? new ethers.providers.Web3Provider(window.ethereum, 'any') : undefined);
  signer = walletSigner || (provider ? provider.getSigner() : undefined);
  if (!provider || !signer) {
    try {
      if (window.tavernConnectWallet) {
        window.tavernConnectWallet();
        await new Promise((resolve) => {
          const once = (ev) => {
            try { window.removeEventListener('wallet:connected', once); } catch {}
            resolve();
          };
          try { window.addEventListener('wallet:connected', once, { once: true }); } catch {}
          setTimeout(resolve, 5000);
        });
      }
    } catch {}
    provider = walletProvider || (window.ethereum ? new ethers.providers.Web3Provider(window.ethereum, 'any') : undefined);
    signer = walletSigner || (provider ? provider.getSigner() : undefined);
    if (!provider || !signer) {
      try { statusEl.innerText = 'Connect wallet on landing page'; } catch {}
      return;
    }
  }
  try { attachProvider(provider); } catch {}
  userAddress = await signer.getAddress();
  // Prefer dedicated Shell contract; fall back to Tavern
  const shellAddr = await getAddressFor('shell', provider);
  const tavAddr   = await getAddressFor('tavern', provider);
  tavernAddress = shellAddr || tavAddr;
  if (shellAddr) { await ensureShellAbi(); sendAbi = window.ShellABI || window.TavernABI; }
  else { sendAbi = window.TavernABI; }
  try {
    const chainId = await detectChainId(provider);
    const bannerKey = shellAddr ? 'shell' : 'tavern';
    renderTavernBanner({ contractKey: bannerKey, address: tavernAddress, chainId, wallet: userAddress });
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

      const contract = new ethers.Contract(tavernAddress, sendAbi, signer);

      const betWei = ethers.utils.parseEther(betAmount.toString());
      statusEl.innerText = 'Playing...';
      try { showToast('Playing...', 'info'); } catch {}

      let receipt = null;
      let txHash = null;
      let playedEvent;
      let usedBundler = false;
      const iface = new ethers.utils.Interface(sendAbi || window.ShellABI || window.TavernABI || []);
      const bundler = await detectBundler((provider && provider.provider) || provider);
      if (bundler && bundler.available) {
        try {
          const data = iface.encodeFunctionData('playShell', [guess]);
          const from = await signer.getAddress();
          const net = await provider.getNetwork().catch(() => ({ chainId: undefined }));
          const result = await walletSendCalls({
            provider: bundler.provider,
            from,
            chainId: net?.chainId,
            calls: [{ to: tavernAddress, data, value: ethers.utils.hexlify(betWei) }]
          });
          txHash = extractTxHash(result);
          usedBundler = true;
          statusEl.innerText = txHash ? 'Waiting for confirmation...' : 'Waiting for result...';
          if (txHash) {
            receipt = await waitForTransactionReceipt(provider, txHash).catch(() => null);
          }
        } catch (bundlerErr) {
          console.warn('Shell bundler send failed; using direct transaction', bundlerErr);
          usedBundler = false;
        }
      }

      if (!usedBundler) {
        const tx = await contract.playShell(guess, { value: betWei, gasLimit: 200000 });
        txHash = tx.hash;
        statusEl.innerText = 'Dice rolling on-chain...';
        receipt = await tx.wait();
        statusEl.innerText = 'Waiting for result...';
      }

      if (!receipt && txHash) {
        receipt = await waitForTransactionReceipt(provider, txHash).catch(() => null);
      }

      if (receipt) {
        try {
          for (const log of (receipt.logs || [])) {
            try {
              const parsed = iface.parseLog(log);
              if (parsed && parsed.name === 'ShellPlayed') {
                playedEvent = parsed.args;
                break;
              }
            } catch {}
          }
        } catch {}
      }

      if (!playedEvent && txHash && contract.filters?.ShellPlayed) {
        try {
          const filter = contract.filters.ShellPlayed(userAddress || null);
          const events = await contract.queryFilter(filter, receipt?.blockNumber, receipt?.blockNumber);
          if (events && events.length) {
            playedEvent = events[events.length - 1].args;
          }
        } catch (queryErr) {
          console.warn('Shell queryFilter fallback failed', queryErr);
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

      if (playsEl) {
        const li = document.createElement('li');
        li.innerText = resultText;
        playsEl.prepend(li);
        while (playsEl.children.length > 10) { playsEl.removeChild(playsEl.lastElementChild); }
      }

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
