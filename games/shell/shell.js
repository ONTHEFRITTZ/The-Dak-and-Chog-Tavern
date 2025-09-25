// shell.js
// Uses the unified Tavern contract ABI (window.TavernABI)
import { getAddressFor, detectChainId, renderTavernBanner, showToast } from '../../js/config.js';
import { attachProvider } from '../../js/contract-utils.js';

const shellElements = document.querySelectorAll('.shell');
const statusEl = document.getElementById('shell-result') || document.getElementById('status');
const playsEl = document.getElementById('plays');
const returnBtn = document.getElementById('return');
const betInput = document.getElementById('bet');
const rulesOverlay = document.getElementById('rules-overlay');
const rulesAck = document.getElementById('rules-ack');
const openRulesBtn = document.getElementById('open-rules');
let shellAck = true; // rules gate removed

function setShellInteractivity(enabled) {
  try {
    betInput.disabled = !enabled;
  } catch {}
}

let provider;
let signer;
let userAddress;
let tavernAddress;
let activeShellAbi = null;

async function init() {
  if (!window.ethereum) {
    alert('MetaMask not detected.');
    return;
  }
  provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
  signer = provider.getSigner();
  try { attachProvider(provider); } catch {}
  userAddress = await signer.getAddress();
  // Clear any stale local overrides so we use canonical addresses
  try { localStorage.removeItem('contract.shell'); localStorage.removeItem('contract.tavern'); } catch {}
  const shellAddr = await getAddressFor('shell', provider);
  const tavernFallback = await getAddressFor('tavern', provider);
  tavernAddress = shellAddr || tavernFallback;
  activeShellAbi = (shellAddr && window.ShellABI) ? window.ShellABI : window.TavernABI;
  try {
    const chainId = await detectChainId(provider);
    const bannerKey = shellAddr ? 'shell' : 'tavern';
    renderTavernBanner({ contractKey: bannerKey, address: tavernAddress, chainId, wallet: userAddress });
  } catch {}

  // Self-heal: If signer is Shell owner, update pool; if signer is Pool owner, unpause + authorize Shell.
  try {
    const configuredPool = await getAddressFor('pool', provider).catch(() => null);
    const abi = activeShellAbi || window.ShellABI || window.TavernABI;
    const c = new ethers.Contract(tavernAddress, abi, signer);
    let currentPool = await (c.pool ? c.pool().catch(() => ethers.constants.AddressZero) : Promise.resolve(ethers.constants.AddressZero));
    const signerAddr = (await signer.getAddress()).toLowerCase();
    if (configuredPool && currentPool && String(currentPool).toLowerCase() !== String(configuredPool).toLowerCase()) {
      try {
        const owner = (await c.owner()).toLowerCase();
        if (owner === signerAddr && c.setPool) {
          await (await c.setPool(configuredPool)).wait();
          currentPool = configuredPool;
          try { showToast('Shell pool updated', 'success'); } catch {}
        }
      } catch {}
    }
    if (currentPool && currentPool !== ethers.constants.AddressZero && window.PoolABI) {
      try {
        const pool = new ethers.Contract(currentPool, window.PoolABI, signer);
        const poolOwner = (await pool.owner()).toLowerCase();
        if (poolOwner === signerAddr) {
          try { if (await pool.paused()) { await (await pool.pause(false)).wait(); } } catch {}
          try {
            const authorized = await pool.authorizedGames(tavernAddress).catch(() => false);
            if (!authorized) { await (await pool.setAuthorized(tavernAddress, true)).wait(); try { showToast('Authorized Shell in Pool', 'success'); } catch {} }
          } catch {}
        }
      } catch {}
    }
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

      const abi = activeShellAbi || window.ShellABI || window.TavernABI;
      const contract = new ethers.Contract(tavernAddress, abi, signer);

      statusEl.innerText = 'Playing...';
      try { showToast('Playing...', 'info'); } catch {}

      // Prepare wager once
      const betWei = ethers.utils.parseEther(betAmount.toString());

      // Bankroll coverage: prefer Pool.balance() from contract.pool(),
      // fallback to configured pool in config.js, else the contract's own balance.
      try {
        let ok = false;
        let coverageVerified = false;
        let poolAddr;
        try { poolAddr = await contract.pool(); } catch {}
        if (!poolAddr || poolAddr === ethers.constants.AddressZero) {
          try { poolAddr = await getAddressFor('pool', provider); } catch {}
        }
        if (poolAddr && poolAddr !== ethers.constants.AddressZero && window.PoolABI) {
          try {
            const code = await provider.getCode(poolAddr).catch(()=> '0x');
            if (code && code !== '0x') {
              const pool = new ethers.Contract(poolAddr, window.PoolABI, provider);
              const bal = await pool.balance();
              coverageVerified = true;
              if (bal.gte(betWei.mul(2))) ok = true;
            }
          } catch {}
        }
        if (!coverageVerified) {
          try {
            const bank = await provider.getBalance(tavernAddress);
            coverageVerified = true;
            if (bank && bank.gte(betWei.mul(2))) ok = true;
          } catch {}
        }
        if (coverageVerified && !ok) { statusEl.innerText = 'Bankroll too low for this bet (needs 2x cover). Try a smaller amount.'; return; }
      } catch {}

      // Preflight static call to surface revert reasons (authorization, paused, maxBet, etc.)
      try {
        await contract.callStatic.playShell(guess, { value: betWei });
      } catch (pre) {
        const msg = pre?.error?.message || pre?.data?.message || pre?.reason || pre?.message || 'Reverted';
        statusEl.innerText = 'Rejected: ' + msg;
        return;
      }

      const tx = await contract.playShell(guess, {
        value: betWei,
        gasLimit: 200000, // manual gas limit
      });

      const receipt = await tx.wait();

      // Parse the Played event from the receipt
      const iface = new ethers.utils.Interface(activeShellAbi || window.ShellABI || window.TavernABI);
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

// Be defensive: the button may be absent on some embeds
try { returnBtn?.addEventListener('click', () => { window.location.href = '/index.html'; }); } catch {}

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
const onReady = (fn) => { if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', fn, { once: true }); } else { fn(); } };
onReady(() => {
  shellAck = true;
  try { if (rulesOverlay) rulesOverlay.style.display = 'none'; } catch {}
  // Disable Rules button if present
  try { if (openRulesBtn) openRulesBtn.style.display = 'none'; } catch {}
});
