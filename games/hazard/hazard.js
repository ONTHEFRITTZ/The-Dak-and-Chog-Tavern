// games/hazard/hazard.js
// UI wired to MonHazard contract (HazardPlayed event) using ethers v5 UMD
import { getAddressFor, detectChainId, renderTavernBanner, showToast } from '../../js/config.js';
import { attachProvider } from '../../js/contract-utils.js';

let tavernAddress; // unified contract address
const diceImages = [
  '../../assets/images/dice/standard/dice1.png',
  '../../assets/images/dice/standard/dice2.png',
  '../../assets/images/dice/standard/dice3.png',
  '../../assets/images/dice/standard/dice4.png',
  '../../assets/images/dice/standard/dice5.png',
  '../../assets/images/dice/standard/dice6.png'
];

let provider, signer, contract;
let selectedMain = 7;
let currentWallet = null;
let hazardEnableTimer = null;

// DOM
const statusEl = document.getElementById('hazard-result') || document.getElementById('status');
const rollBtn = document.getElementById('roll-dice');
const dice1El = document.getElementById('dice1');
const dice2El = document.getElementById('dice2');
const betInput = document.getElementById('bet');
const returnBtn = document.getElementById('return');
const rollsList = document.getElementById('rolls');
const mainButtons = document.querySelectorAll('.main-select button');
const rulesOverlay = document.getElementById('rules-overlay');
const rulesAck = document.getElementById('rules-ack');
const openRulesBtn = document.getElementById('open-rules');
let hazardAck = true; // rules gate removed
const RULES_VERSION = 'v2';
// rules ack key no longer used

// Persist and restore basic UI state (bet + main)
try {
  const savedBet = localStorage.getItem('hazard.bet');
  if (savedBet && !isNaN(Number(savedBet))) betInput.value = savedBet;
  const savedMain = localStorage.getItem('hazard.main');
  if (savedMain) selectedMain = Number(savedMain);
} catch {}
if (dice1El && !dice1El.textContent) dice1El.textContent = '?';
if (dice2El && !dice2El.textContent) dice2El.textContent = '?';
betInput.addEventListener('input', () => {
  try { localStorage.setItem('hazard.bet', betInput.value || ''); } catch {}
});

// Utility: split finalSum into a valid dice pair (1..6, sum = finalSum)
function splitSumToDice(sum) {
  const pairs = [];
  for (let d1 = 1; d1 <= 6; d1++) {
    const d2 = sum - d1;
    if (d2 >= 1 && d2 <= 6) pairs.push([d1, d2]);
  }
  if (pairs.length === 0) return [1, 1];
  return pairs[Math.floor(Math.random() * pairs.length)];
}

// Display dice (use images if present, else Unicode dice or numbers)
function displayDice(d1, d2) {
  const imgPathsExist = !!diceImages[0];
  if (dice1El) {
    if (imgPathsExist) {
      dice1El.style.backgroundImage = `url(${diceImages[d1 - 1]})`;
      dice1El.style.backgroundSize = 'cover';
      dice1El.style.backgroundPosition = 'center';
      dice1El.style.backgroundRepeat = 'no-repeat';
      dice1El.textContent = '';
    } else {
      dice1El.style.backgroundImage = '';
      try { dice1El.textContent = String.fromCodePoint(0x2680 + (d1 - 1)); } catch { dice1El.textContent = String(d1); }
    }
  }
  if (dice2El) {
    if (imgPathsExist) {
      dice2El.style.backgroundImage = `url(${diceImages[d2 - 1]})`;
      dice2El.style.backgroundSize = 'cover';
      dice2El.style.backgroundPosition = 'center';
      dice2El.style.backgroundRepeat = 'no-repeat';
      dice2El.textContent = '';
    } else {
      dice2El.style.backgroundImage = '';
      try { dice2El.textContent = String.fromCodePoint(0x2680 + (d2 - 1)); } catch { dice2El.textContent = String(d2); }
    }
  }
}

// Animate dice visually
function animateDice() {
  const el1 = dice1El, el2 = dice2El;
  el1.classList.add('shake');
  el2.classList.add('shake');
  let frames = 10;
  const iv = setInterval(() => {
    const r1 = Math.floor(Math.random() * 6) + 1;
    const r2 = Math.floor(Math.random() * 6) + 1;
    displayDice(r1, r2);
    frames--;
    if (frames <= 0) {
      clearInterval(iv);
      el1.classList.remove('shake');
      el2.classList.remove('shake');
    }
  }, 100);
}

// Outcome explanation matching contract rules
function explainOutcome(main, finalSum, chance, win) {
  main = Number(main);
  finalSum = Number(finalSum);
  chance = Number(chance);

  if (chance === 0) {
    if (finalSum === main) return `Immediate win — rolled your main (${main}).`;
    if (finalSum === 2 || finalSum === 3) return `Immediate loss — rolled ${finalSum}.`;
    if (finalSum === 11 || finalSum === 12) {
      if (main === 7) return `Immediate loss — rolled ${finalSum} and main was 7.`;
      if (main === 5 || main === 9) return `Immediate win — rolled ${finalSum} (special for main ${main}).`;
      return `Immediate loss — rolled ${finalSum}.`;
    }
    return `Point established at ${finalSum}. Game continues until point or main resolves.`;
  } else {
    if (finalSum === chance) return `Won by hitting the chance/point (${chance}).`;
    if (finalSum === main) return `Lost — rolled your main (${main}) before hitting the point (${chance}).`;
    return `Resolved with roll ${finalSum}.`;
  }
}

// Hook main selection buttons
function setHazardInteractivity(enabled) {
  try {
    rollBtn.disabled = !enabled;
    betInput.disabled = !enabled;
    mainButtons.forEach(b => b.disabled = !enabled);
  } catch {}
}

// Ensure only one main is highlighted at startup
try { mainButtons.forEach(b => b.classList.remove('active')); } catch {}
mainButtons.forEach(btn => {
  const m = Number(btn.dataset.main);
  if (m === selectedMain) btn.classList.add('active');
  btn.addEventListener('click', () => {
    mainButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMain = m;
    try { localStorage.setItem('hazard.main', String(selectedMain)); } catch {}
  });
});

// Initialize provider/signers and attach handlers
const onReady = (fn) => { if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', fn, { once: true }); } else { fn(); } };
onReady(async () => {
  hazardAck = true;
  try { if (rulesOverlay) rulesOverlay.style.display = 'none'; } catch {}
  try { if (openRulesBtn) openRulesBtn.style.display = 'none'; } catch {}

  // Accept either storage flag, but still try provider init even if missing
  let walletFlag = undefined;
  try { walletFlag = localStorage.getItem('walletConnected') || sessionStorage.getItem('walletConnected'); } catch {}
  if (!window.ethereum) {
    statusEl.textContent = 'MetaMask not detected.';
    rollBtn.disabled = true;
    return;
  }

  try {
    provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    signer = provider.getSigner();
    try { attachProvider(provider); } catch {}
    let walletAddress = null;
    try { walletAddress = await signer.getAddress(); } catch {}
    if (walletAddress) { currentWallet = walletAddress.toLowerCase(); }
    try { if (walletAddress && walletFlag !== 'true') localStorage.setItem('walletConnected','true'); } catch {}
    tavernAddress = await getAddressFor('tavern', provider);
    contract = new ethers.Contract(tavernAddress, window.TavernABI, signer);
    try {
      const chainId = await detectChainId(provider);
      const tavernAddress = await getAddressFor('tavern', provider);
      renderTavernBanner({ contractKey: 'tavern', address: tavernAddress, chainId, wallet: walletAddress || undefined });
    } catch {}
    // If no authorized account and flag not set, keep UI disabled until user connects
    if (!walletAddress && walletFlag !== 'true') {
      statusEl.textContent = 'Connect wallet on the Tavern first.';
      rollBtn.disabled = true;
      // do not return; allow the rest of setup (events, handlers)
    }
  } catch (err) {
    console.error('Init error:', err);
    statusEl.textContent = 'Error initializing contract: ' + err.message;
    rollBtn.disabled = true;
    return;
  }

  // Event listener (HazardPlayed)
  const onHazardPlayed = async (player, wager, win, main, finalSum, chance, iterations) => {
  try {
    if (!currentWallet || player.toLowerCase() !== currentWallet) return;

    const [d1, d2] = splitSumToDice(Number(finalSum));
    displayDice(d1, d2);

    const wagerEth = ethers.utils.formatEther(wager);
    const payoutEth = win ? ethers.utils.formatEther(wager.mul(2)) : '0';
    const explanation = explainOutcome(Number(main), Number(finalSum), Number(chance), win);

    statusEl.textContent = win ? 'You won ' + payoutEth + ' MON! ' + explanation : 'You lost. ' + explanation;
    try { showToast(win ? 'You won ' + payoutEth + ' MON' : 'You lost', win ? 'success' : 'info'); } catch {}

    if (rollsList) {
      const li = document.createElement('li');
      li.textContent = new Date().toLocaleTimeString() + ' - Bet: ' + wagerEth + ' MON - ' + (win ? 'Won' : 'Lost') + ' (Main:' + main + ', Final:' + finalSum + ', Iter:' + iterations + ')';
      rollsList.prepend(li);
      while (rollsList.children.length > 10) { rollsList.removeChild(rollsList.lastElementChild); }
    }

    if (hazardEnableTimer) { clearTimeout(hazardEnableTimer); hazardEnableTimer = null; }
    rollBtn.disabled = false;
  } catch (err) {
    console.error('Event handler error:', err);
    try { rollBtn.disabled = false; } catch {}
  }
};
contract.on('HazardPlayed', onHazardPlayed);
window.addEventListener('beforeunload', () => { try { contract.off('HazardPlayed', onHazardPlayed); } catch {} });

  // If the user connects their wallet after load, enable play without reloading
  try {
    if (window.ethereum?.on) {
      window.ethereum.on('accountsChanged', async (accs) => {
  try {
    if (accs && accs.length) {
      signer = provider.getSigner();
      currentWallet = (accs[0] || '').toLowerCase();
      statusEl.textContent = '';
      rollBtn.disabled = false;
      try {
        const chainId = await detectChainId(provider);
        renderTavernBanner({ contractKey: 'tavern', address: tavernAddress, chainId, wallet: accs[0] });
      } catch {}
    } else {
      currentWallet = null;
      rollBtn.disabled = true;
      statusEl.textContent = 'Connect wallet on the Tavern first.';
    }
  } catch (err) {
    console.error('accountsChanged handler failed', err);
  }
});
    }
    // Also react to storage flag being set by tavern.js connect flow
    window.addEventListener('storage', async (e) => {
      try {
        if (e.key === 'walletConnected' && e.newValue === 'true') {
        const w = await signer.getAddress().catch(() => null);
        if (w) {
          currentWallet = w.toLowerCase();
          rollBtn.disabled = false;
          statusEl.textContent = '';
        }
      }
      } catch {}
    });
  } catch {}

  // Roll button handler
  rollBtn.addEventListener('click', async () => {
  if (!hazardAck) { try { rulesOverlay.style.display = 'flex'; } catch {}; return; }
  if (!signer || !contract) {
    alert('Connect wallet on the Tavern first.');
    return;
  }

  if (!currentWallet) {
    try {
      const addr = await signer.getAddress();
      currentWallet = addr ? addr.toLowerCase() : null;
    } catch {
      statusEl.textContent = 'Connect wallet on the Tavern first.';
      return;
    }
  }

  const bet = betInput.value;
  if (!bet || Number(bet) <= 0) {
    statusEl.textContent = 'Enter a valid bet amount.';
    return;
  }
  if (!Number.isInteger(selectedMain) || selectedMain < 5 || selectedMain > 9) {
    statusEl.textContent = 'Choose a main between 5 and 9.';
    return;
  }

  let wager;
  try {
    wager = ethers.utils.parseEther(bet);
  } catch {
    statusEl.textContent = 'Enter a valid bet amount.';
    return;
  }

  let hasPool = false;
  try {
    const poolAddr = await contract.pool();
    hasPool = !!(poolAddr && poolAddr !== ethers.constants.AddressZero);
    let ok = false;
    if (hasPool) {
      try {
        const pool = new ethers.Contract(poolAddr, window.PoolABI, provider);
        const bal = await pool.balance();
        if (bal.gte(wager.mul(2))) ok = true;
      } catch (poolErr) {
        console.error('Pool balance check failed', poolErr);
      }
    } else {
      const bank = await provider.getBalance(tavernAddress);
      if (bank.gte(wager.mul(2))) ok = true;
    }
    if (!ok) {
      statusEl.textContent = 'Bankroll too low for this bet (needs 2x cover). Try a smaller amount.';
      return;
    }
  } catch (err) {
    console.error('Bankroll check error:', err);
  }

  statusEl.textContent = 'Rolling dice... sending transaction...';
  try { showToast('Rolling dice...', 'info'); } catch {}
  rollBtn.disabled = true;

  try { if (typeof animationsEnabled === 'undefined') { animationsEnabled = true; } } catch { var animationsEnabled = true; }
  if (animationsEnabled) animateDice();

  try {
    // Always do a static preflight to surface revert reasons before sending
    try {
      await contract.callStatic.playHazard(selectedMain, { value: wager });
    } catch (pre) {
      const msg = pre?.error?.message || pre?.data?.message || pre?.reason || pre?.message || 'Reverted';
      statusEl.textContent = 'Rejected: ' + msg;
      rollBtn.disabled = false;
      return;
    }

    let gasLimit;
    try {
      const est = await contract.estimateGas.playHazard(selectedMain, { value: wager });
      gasLimit = est.mul(120).div(100);
    } catch {
      gasLimit = ethers.utils.hexlify(300000);
    }

    const tx = await contract.playHazard(selectedMain, { value: wager, gasLimit });
    statusEl.textContent = 'Dice rolling on-chain...';
    await tx.wait();
    statusEl.textContent = 'Waiting for result...';
    if (hazardEnableTimer) { clearTimeout(hazardEnableTimer); }
    hazardEnableTimer = setTimeout(() => { try { rollBtn.disabled = false; } catch {} }, 12000);
  } catch (err) {
    console.error('Play error:', err);
    let reason = '';
    if (err?.error?.message) reason = err.error.message;
    else if (err?.data?.message) reason = err.data.message;
    else if (err?.reason) reason = err.reason;
    else reason = err.message || JSON.stringify(err);

    statusEl.textContent = 'Reverted: ' + reason;
    rollBtn.disabled = false;
    if (hazardEnableTimer) { clearTimeout(hazardEnableTimer); hazardEnableTimer = null; }
  }
});

  returnBtn.addEventListener('click', () => { window.location.href = '/index.html'; });
});
