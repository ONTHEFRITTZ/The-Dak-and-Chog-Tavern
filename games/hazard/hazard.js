// games/hazard/hazard.js
// UI wired to MonHazard contract (HazardPlayed event) using ethers v5 UMD
import { getAddressFor, detectChainId, renderTavernBanner, showToast } from '../../js/config.js';

let hazardAddress; // resolved per network
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

// DOM
const statusEl = document.getElementById('status');
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
let hazardAck = false;
const RULES_VERSION = 'v2';

function rulesFresh(key) {
  try { const t = Number(localStorage.getItem(key) || 0); return Date.now() - t < 86400000; } catch { return false; }
}

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
      dice1El.style.backgroundSize = '80% 80%';
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
      dice2El.style.backgroundSize = '80% 80%';
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
window.addEventListener('DOMContentLoaded', async () => {
  // 24h rules acknowledgment
  hazardAck = rulesFresh(`rulesAck.hazard.${RULES_VERSION}`);
  if (!hazardAck) { try { rulesOverlay.style.display = 'flex'; setHazardInteractivity(false); } catch {} }
  rulesAck?.addEventListener('click', () => { hazardAck = true; try { rulesOverlay.style.display = 'none'; } catch {}; setHazardInteractivity(true); try { localStorage.setItem(`rulesAck.hazard.${RULES_VERSION}`, String(Date.now())); } catch {} });
  openRulesBtn?.addEventListener('click', () => { try { rulesOverlay.style.display = 'flex'; } catch {} });

  const walletFlag = sessionStorage.getItem('walletConnected');
  if (!window.ethereum || walletFlag !== 'true') {
    statusEl.innerText = 'Connect wallet on the Tavern first.';
    rollBtn.disabled = true;
    return;
  }

  try {
    provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    signer = provider.getSigner();
    const walletAddress = await signer.getAddress();
    hazardAddress = await getAddressFor('hazard', provider);
    contract = new ethers.Contract(hazardAddress, window.HazardABI, signer);
    try {
      const chainId = await detectChainId(provider);
      renderTavernBanner({ contractKey: 'hazard', address: hazardAddress, chainId, wallet: walletAddress });
    } catch {}
  } catch (err) {
    console.error('Init error:', err);
    statusEl.innerText = 'Error initializing contract: ' + err.message;
    rollBtn.disabled = true;
    return;
  }

  // Event listener (HazardPlayed)
  const onHazardPlayed = async (player, wager, win, main, finalSum, chance, iterations) => {
    try {
      const user = (await signer.getAddress()).toLowerCase();
      if (player.toLowerCase() !== user) return;

      const [d1, d2] = splitSumToDice(Number(finalSum));
      displayDice(d1, d2);

      const payout = win ? ethers.utils.formatEther(wager.mul(2)) : '0';
      const explanation = explainOutcome(Number(main), Number(finalSum), Number(chance), win);

      statusEl.innerText = win ? `You won ${payout} MON! ${explanation}` : `You lost. ${explanation}`;
      try { showToast(win ? `You won ${payout} MON` : 'You lost', win ? 'success' : 'info'); } catch {}

      const li = document.createElement('li');
      li.innerText = `${new Date().toLocaleTimeString()} - Bet: ${ethers.utils.formatEther(wager)} MON - ${win ? 'Won' : 'Lost'} (Main:${main}, FinalSum:${finalSum}, Iter:${iterations})`;
      rollsList.prepend(li);

      rollBtn.disabled = false;
    } catch (err) {
      console.error('Event handler error:', err);
    }
  };
  contract.on('HazardPlayed', onHazardPlayed);
  window.addEventListener('beforeunload', () => { try { contract.off('HazardPlayed', onHazardPlayed); } catch {} });

  // Roll button handler
  rollBtn.addEventListener('click', async () => {
    if (!hazardAck) { try { rulesOverlay.style.display = 'flex'; } catch {}; return; }
    if (!signer || !contract) {
      alert('Connect wallet on the Tavern first.');
      return;
    }

    const bet = betInput.value;
    if (!bet || Number(bet) <= 0) {
      statusEl.innerText = 'Enter a valid bet amount.';
      return;
    }
    if (!Number.isInteger(selectedMain) || selectedMain < 5 || selectedMain > 9) {
      statusEl.innerText = 'Choose a main between 5 and 9.';
      return;
    }

    try {
      const bankroll = await provider.getBalance(hazardAddress);
      const needed = ethers.utils.parseEther(bet).mul(2);
      if (bankroll.lt(needed)) {
        statusEl.innerText = 'Bankroll too low for this bet. Try a smaller amount.';
        return;
      }
    } catch (err) {
      console.error('Bankroll check error:', err);
    }

    statusEl.innerText = 'Rolling dice... sending transaction...';
    try { showToast('Rolling dice…', 'info'); } catch {}
    rollBtn.disabled = true;

    try { if (typeof animationsEnabled === 'undefined') { animationsEnabled = true; } } catch { var animationsEnabled = true; }
    if (animationsEnabled) animateDice();

    try {
      const tx = await contract.play(selectedMain, { value: ethers.utils.parseEther(bet) });
      await tx.wait();
      // event listener will handle UI update
    } catch (err) {
      console.error('Play error:', err);
      let reason = '';
      if (err?.error?.message) reason = err.error.message;
      else if (err?.data?.message) reason = err.data.message;
      else if (err?.reason) reason = err.reason;
      else reason = err.message || JSON.stringify(err);

      statusEl.innerText = 'Reverted: ' + reason;
      rollBtn.disabled = false;
    }
  });

  returnBtn.addEventListener('click', () => {
    window.location.href = '../../index.html';
  });
});
