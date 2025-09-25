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
let hazardAck = false;
const RULES_VERSION = 'v2';

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

// Ensure dice boxes are visible and sized even if external CSS fails to load
function ensureDiceSize() {
  try {
    const w = '140px';
    [dice1El, dice2El].forEach((el) => {
      if (!el) return;
      el.style.width = w; el.style.height = w;
      el.style.minWidth = w; el.style.minHeight = w;
      el.style.maxWidth = w; el.style.maxHeight = w;
      el.style.display = 'inline-block';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundRepeat = 'no-repeat';
    });
  } catch {}
}

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
function setDiceFaces(d1, d2, opts){
  opts = opts || {};
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

// Backward-compat alias
const displayDice = (d1,d2)=> setDiceFaces(d1,d2);

// Animate dice visually
function startDiceSpin() {
  try { dice1El.classList.add('shake'); dice2El.classList.add('shake'); } catch {}
  setDiceFaces(Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1);
}
function stopDiceSpin() {
  try { dice1El.classList.remove('shake'); dice2El.classList.remove('shake'); } catch {}
}

// Outcome explanation matching contract rules
function explainOutcome(main, finalSum, chance, win) {
  main = Number(main);
  finalSum = Number(finalSum);
  chance = Number(chance);

  if (chance === 0) {
    if (finalSum === main) return `Come-out: WIN — rolled your main (${main}).`;
    if (finalSum === 2 || finalSum === 3) return `Come-out: LOSS — rolled ${finalSum}.`;
    if (finalSum === 11 || finalSum === 12) {
      if (main === 7) return `Come-out: LOSS — rolled ${finalSum} and main was 7.`;
      if (main === 5 || main === 9) return `Come-out: WIN — rolled ${finalSum} (special for main ${main}).`;
      return `Come-out: LOSS — rolled ${finalSum}.`;
    }
    return `Come-out: point established at ${finalSum}. Keep rolling: hit point ${finalSum} before main ${main} to WIN.`;
  } else {
    if (finalSum === chance) return `Point phase (point=${chance}): WIN — hit the point.`;
    if (finalSum === main) return `Point phase (point=${chance}): LOSS — rolled your main (${main}) before the point.`;
    return `Point phase (point=${chance}): rolling... (${finalSum}).`;
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
  hazardAck = false;
  try { ensureDiceSize(); setDiceFaces(1,1); } catch {}

  if (!window.ethereum) {
    statusEl.textContent = 'MetaMask not detected.';
    rollBtn.disabled = true;
    return;
  }

  try {
    provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    signer = provider.getSigner();
    try { attachProvider(provider); } catch {}
  } catch (e) {
    statusEl.textContent = 'Wallet not available.';
    return;
  }

  // resolve addresses per chain
  const chainId = await detectChainId(provider);
  tavernAddress = await getAddressFor('tavern', provider);

  // render banner
  try { renderTavernBanner({ contractKey: 'tavern', address: tavernAddress, chainId, wallet: await signer.getAddress() }); } catch {}

  // wire play handler
  rollBtn.addEventListener('click', async () => {
    try {
      setHazardInteractivity(false);
      startDiceSpin();
      statusEl.textContent = 'Rolling...';
      const betEth = Number(betInput.value||'0');
      const main = Number(selectedMain||7);
      const tx = await signer.sendTransaction({ to: tavernAddress, value: ethers.utils.parseEther(String(betEth)) });
      await tx.wait();
      // Dummy parse: pick random plausible outcome; real dapp should parse logs
      const finalSum = Math.floor(Math.random() * 11) + 2;
      const [d1, d2] = splitSumToDice(finalSum);
      stopDiceSpin(); setDiceFaces(d1, d2);
      const msg = explainOutcome(main, finalSum, 0, false);
      statusEl.textContent = msg;
      const li = document.createElement('li'); li.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; rollsList.prepend(li);
      setHazardInteractivity(true);
    } catch (e) {
      stopDiceSpin();
      statusEl.textContent = e?.data?.message || e?.message || 'Roll failed';
      setHazardInteractivity(true);
    }
  });
});

