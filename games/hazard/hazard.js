// games/hazard/hazard.js
// UI wired to MonHazard contract (HazardPlayed event) using ethers v5 UMD
import { getAddressFor, detectChainId, renderTavernBanner, showToast } from '../../js/config.js';
import { attachProvider } from '../../js/contract-utils.js';
import { provider as walletProvider, signer as walletSigner } from '../../js/tavern.js';\nimport { detectBundler, walletSendCalls } from '../../js/bundler.js';

let tavernAddress; // contract used for sends (Hazard router preferred)
let unifiedAddr;   // unified Tavern address (emits HazardPlayed)
let unifiedLower;  // lowercase of unified Tavern address for log filtering
const diceImages = [
  '../../assets/images/dice/standard/dice1.png',
  '../../assets/images/dice/standard/dice2.png',
  '../../assets/images/dice/standard/dice3.png',
  '../../assets/images/dice/standard/dice4.png',
  '../../assets/images/dice/standard/dice5.png',
  '../../assets/images/dice/standard/dice6.png'
];

let provider, signer, contract;
let inFlight = false;          // prevent overlapping plays
let cooldownUntil = 0;         // brief cooldown after resolution
let diceLock = false;          // lock dice to the last game result (until next roll)
let animIv = null;             // dice animation interval while tx pending
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
// Dice init: show a default face via image src
try { if (dice1El && !dice1El.getAttribute('src')) dice1El.src = diceImages[0]; } catch {}
try { if (dice2El && !dice2El.getAttribute('src')) dice2El.src = diceImages[0]; } catch {}
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
function setDiceFaces(d1, d2, opts){
  opts = opts || {};
  if (diceLock && !opts.force) return;
  const imgPathsExist = !!diceImages[0];
  if (imgPathsExist && dice1El && dice2El) {
    dice1El.src = diceImages[d1 - 1];
    dice2El.src = diceImages[d2 - 1];
  }
  try { enforceDiceSize(); } catch {}
}

// Enforce correct dice sizing across all states (DOM restore, bfcache, etc.)
function enforceDiceSize() {
  try {
    const targetPx = 140;
    const ensure = (el) => {
      if (!el) return;
      try {
        // Apply hard inline sizing with !important to defeat any container rules
        el.style.setProperty('width', targetPx + 'px', 'important');
        el.style.setProperty('height', targetPx + 'px', 'important');
        el.style.setProperty('min-width', targetPx + 'px', 'important');
        el.style.setProperty('min-height', targetPx + 'px', 'important');
        el.style.setProperty('max-width', targetPx + 'px', 'important');
        el.style.setProperty('max-height', targetPx + 'px', 'important');
        el.style.setProperty('flex', '0 0 auto', 'important');
        el.style.setProperty('object-fit', 'cover', 'important');
        el.style.removeProperty('transform');
      } catch {}
    };
    ensure(dice1El);
    ensure(dice2El);
    try {
      const row = document.querySelector('.hz-dice-row');
      if (row) {
        row.style.setProperty('display', 'flex', 'important');
        row.style.setProperty('justify-content', 'center', 'important');
        row.style.setProperty('gap', '16px', 'important');
        row.style.removeProperty('transform');
      }
    } catch {}
  } catch {}
}

// Backward-compat alias
const displayDice = (d1,d2)=> setDiceFaces(d1,d2);

// Animate dice continuously until stopped
function startDiceAnim() {
  try { dice1El.classList.add('shake'); dice2El.classList.add('shake'); } catch {}
  // Clear any existing interval
  if (animIv) { try { clearInterval(animIv); } catch {} animIv = null; }
  enforceDiceSize();
  animIv = setInterval(() => {
    const r1 = Math.floor(Math.random() * 6) + 1;
    const r2 = Math.floor(Math.random() * 6) + 1;
    // During animation we must allow updates; ensure lock is not blocking
    setDiceFaces(r1, r2, { force: true });
  }, 120);
}

function stopDiceAnim() {
  if (animIv) { try { clearInterval(animIv); } catch {} animIv = null; }
  try { dice1El.classList.remove('shake'); dice2El.classList.remove('shake'); } catch {}
}

// Outcome explanation matching contract rules
function explainOutcome(main, finalSum, chance, win) {
  main = Number(main);
  finalSum = Number(finalSum);
  chance = Number(chance);

  if (chance === 0) {
    if (finalSum === main) return `Immediate win â€” rolled your main (${main}).`;
    if (finalSum === 2 || finalSum === 3) return `Immediate loss â€” rolled ${finalSum}.`;
    if (finalSum === 11 || finalSum === 12) {
      if (main === 7) return `Immediate loss â€” rolled ${finalSum} and main was 7.`;
      if (main === 5 || main === 9) return `Immediate win â€” rolled ${finalSum} (special for main ${main}).`;
      return `Immediate loss â€” rolled ${finalSum}.`;
    }
    return `Point established at ${finalSum}. Game continues until point or main resolves.`;
  } else {
    if (finalSum === chance) return `Won by hitting the chance/point (${chance}).`;
    if (finalSum === main) return `Lost â€” rolled your main (${main}) before hitting the point (${chance}).`;
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
  // Assert correct dice sizing immediately and on key lifecycle events
  try { enforceDiceSize(); } catch {}
  try { window.addEventListener('resize', enforceDiceSize); } catch {}
  try { document.addEventListener('visibilitychange', () => { if (!document.hidden) enforceDiceSize(); }); } catch {}
  try { window.addEventListener('pageshow', () => { enforceDiceSize(); }); } catch {}
  hazardAck = true;
  try { if (rulesOverlay) rulesOverlay.style.display = 'none'; } catch {}
  try { if (openRulesBtn) openRulesBtn.style.display = 'none'; } catch {}

  // Accept either storage flag, but still try provider init even if missing
  let walletFlag = undefined;
  try {
    const sessionWallet = sessionStorage.getItem('walletConnected');
    if (sessionWallet === 'true') {
      walletFlag = 'true';
    } else if (localStorage.getItem('walletConnected') === 'true') {
      walletFlag = 'true';
      try {
        sessionStorage.setItem('walletConnected', 'true');
        localStorage.removeItem('walletConnected');
      } catch {}
    }
  } catch {}
  // Prefer selected wallet from tavern.js; fallback to injected if needed
  try {
    provider = walletProvider || (window.ethereum ? new ethers.providers.Web3Provider(window.ethereum, 'any') : undefined);
    signer = walletSigner || (provider ? provider.getSigner() : undefined);
    if (!provider || !signer) { throw new Error('No EVM wallet detected'); }
    try { attachProvider(provider); } catch {}
    let walletAddress = null;
    try { walletAddress = await signer.getAddress(); } catch {}
    if (walletAddress) { currentWallet = walletAddress.toLowerCase(); }
    try {
      if (walletAddress && walletFlag !== 'true') {
        sessionStorage.setItem('walletConnected','true');
        try { localStorage.removeItem('walletConnected'); } catch {}
      }
    } catch {}
    // Prefer dedicated Hazard submitter (router) for sends; fall back to Tavern for sends
    tavernAddress = await getAddressFor('hazard', provider) || await getAddressFor('tavern', provider);
    // Unified Tavern address always emits the game events (hoisted vars)
    unifiedAddr = await getAddressFor('tavern', provider);
    unifiedLower = String(unifiedAddr||'').toLowerCase();
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
    const playerLower = String(player||'').toLowerCase();
    const routerLower = String(tavernAddress||'').toLowerCase();
    // Accept events addressed to the user OR to the router (when using a forwarder)
    if (!currentWallet && !routerLower) return;
    const isForMe = (currentWallet && playerLower === currentWallet) || (routerLower && playerLower === routerLower);
    if (!isForMe) return;

    const [d1, d2] = splitSumToDice(Number(finalSum));
    // Force-update dice to the authoritative game result and lock until next roll
    stopDiceAnim();
    setDiceFaces(d1, d2, { force:true });
    diceLock = true;

    const wagerEth = ethers.utils.formatEther(wager);
    const payoutEth = win ? ethers.utils.formatEther(wager.mul(2)) : '0';
    const explanation = explainOutcome(Number(main), Number(finalSum), Number(chance), win);
    const rolledMsg = 'Rolled ' + Number(finalSum) + '. ';
    statusEl.textContent = win
      ? ('You won ' + payoutEth + ' MON! ' + rolledMsg + explanation)
      : ('You lost. ' + rolledMsg + explanation);
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
// Listen from the unified Tavern contract (not the router), so events are always received
try {
  if (unifiedAddr) {
    const eventSource = new ethers.Contract(unifiedAddr, window.TavernABI, provider);
    eventSource.on('HazardPlayed', onHazardPlayed);
    window.addEventListener('beforeunload', () => { try { eventSource.off('HazardPlayed', onHazardPlayed); } catch {} });
  }
} catch {}

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
    const syncWalletState = async () => {
      try {
        if (walletProvider) provider = walletProvider;
        if (walletSigner) {
          signer = walletSigner;
        } else if (provider && provider.getSigner) {
          signer = provider.getSigner();
        }
        const addr = await signer?.getAddress()?.catch(() => null);
        if (addr) {
          currentWallet = String(addr).toLowerCase();
          rollBtn.disabled = false;
          statusEl.textContent = '';
        }
      } catch {}
    };

    try { window.addEventListener('wallet:connected', syncWalletState); } catch {}
    window.addEventListener('storage', async (e) => {
      try {
        if (e.key === 'walletConnected' && e.newValue === 'true') {
          await syncWalletState();
        }
      } catch {}
    });
  } catch {}

  // Roll button handler (guard element)
  rollBtn?.addEventListener('click', async () => {
  // Guard: prevent re-clicks during tx or cooldown
  const now = Date.now();
  if (inFlight || now < cooldownUntil) {
    try { statusEl.textContent = 'Please wait... resolving previous roll.'; } catch {}
    return;
  }
  // Allow animation for the new roll and clear any prior result lock
  diceLock = false;
  inFlight = true;
  if (!hazardAck) { try { rulesOverlay.style.display = 'flex'; } catch {}; return; }
  if (!signer || !contract) {
    alert('Connect wallet on the Tavern first.');
    inFlight = false;
    return;
  }

  if (!currentWallet) {
    try {
      const addr = await signer.getAddress();
      currentWallet = addr ? addr.toLowerCase() : null;
    } catch {
      statusEl.textContent = 'Connect wallet on the Tavern first.';
      inFlight = false;
      return;
    }
  }

  const bet = betInput.value;
  if (!bet || Number(bet) <= 0) {
    statusEl.textContent = 'Enter a valid bet amount.';
    inFlight = false;
    return;
  }
  if (!Number.isInteger(selectedMain) || selectedMain < 5 || selectedMain > 9) {
    statusEl.textContent = 'Choose a main between 5 and 9.';
    inFlight = false;
    return;
  }

  let wager;
  try {
    wager = ethers.utils.parseEther(bet);
  } catch {
    statusEl.textContent = 'Enter a valid bet amount.';
    inFlight = false;
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
      inFlight = false;
      return;
    }
  } catch (err) {
    console.error('Bankroll check error:', err);
  }

  statusEl.textContent = 'Rolling dice... sending transaction...';
  try { showToast('Rolling dice...', 'info'); } catch {}
  rollBtn.disabled = true;

  try { if (typeof animationsEnabled === 'undefined') { animationsEnabled = true; } } catch { var animationsEnabled = true; }
  if (animationsEnabled) startDiceAnim();

  try {
    // Always do a static preflight to surface revert reasons before sending
    try {
      await contract.callStatic.playHazard(selectedMain, { value: wager });
    } catch (pre) {
      const msg = pre?.error?.message || pre?.data?.message || pre?.reason || pre?.message || 'Reverted';
      statusEl.textContent = 'Rejected: ' + msg;
      rollBtn.disabled = false;
      inFlight = false;
      return;
    }

    let gasLimit;
    try {
      const est = await contract.estimateGas.playHazard(selectedMain, { value: wager });
      const min = ethers.BigNumber.from(600000);     // floor for complex paths
      const max = ethers.BigNumber.from(1200000);    // conservative cap
      let padded = est.mul(160).div(100);            // +60% safety
      if (padded.lt(min)) padded = min;
      if (padded.gt(max)) padded = max;
      gasLimit = padded;
    } catch {
      gasLimit = ethers.BigNumber.from(800000);      // robust fallback
    }

    const use = await detectBundler(provider);\n    if (use && use.available) {\n      const iface = new ethers.utils.Interface(window.TavernABI || []);\n      const data = iface.encodeFunctionData('playHazard', [selectedMain]);\n      const from = await signer.getAddress();\n      const chainId = await provider.getNetwork().then(n=>n.chainId).catch(()=>undefined);\n      await walletSendCalls({ provider: use.provider, from, chainId, calls: [{ to: tavernAddress, data, value: ethers.utils.hexlify(wager) }] });\n      statusEl.textContent = 'Waiting for result...';\n    } else {\n      const tx = await contract.playHazard(selectedMain, { value: wager, gasLimit });\n      statusEl.textContent = 'Dice rolling on-chain...';\n      const receipt = await tx.wait();\n      statusEl.textContent = 'Waiting for result...';\n      // parse below\n    }
    statusEl.textContent = 'Waiting for result...';

    // Fallback: parse receipt for HazardPlayed to update UI even if socket event is delayed or missed
    try {
      const iface = new ethers.utils.Interface(window.TavernABI || []);
      const routerLower = String(tavernAddress||'').toLowerCase();
      for (const log of (receipt && receipt.logs) || []){
        if (String(log.address||'').toLowerCase() !== unifiedLower) continue;
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === 'HazardPlayed'){
            const args = parsed.args || {};
            const player = String(args.player||args[0]||'');
            const pl = player.toLowerCase();
            // Only update UI when event is for this wallet or the router (forwarder)
            if (currentWallet && pl !== currentWallet && pl !== routerLower) continue;
            const wagerEv = args.wager||args[1];
            const winEv = !!(args.win||args[2]);
            const mainEv = Number(args.main||args[3]);
            const finalSumEv = Number(args.finalSum||args[4]);
            const chanceEv = Number(args.chance||args[5]);
            const iterationsEv = Number(args.iterations||args[6]);
            // Reuse the same handler used by the live event
            try { await onHazardPlayed(player, wagerEv, winEv, mainEv, finalSumEv, chanceEv, iterationsEv); } catch {}
            break;
          }
        } catch {}
      }
    } catch {}

    if (hazardEnableTimer) { clearTimeout(hazardEnableTimer); }
    hazardEnableTimer = setTimeout(() => { try { rollBtn.disabled = false; } catch {} }, 12000);
    // Set a short cooldown to avoid immediate re-click while network/events settle
    cooldownUntil = Date.now() + 2500;
    inFlight = false;
  } catch (err) {
    console.error('Play error:', err);
    let reason = '';
    if (err?.error?.message) reason = err.error.message;
    else if (err?.data?.message) reason = err.data.message;
    else if (err?.reason) reason = err.reason;
    else reason = err.message || JSON.stringify(err);

    // Friendlier surface for common gas issues
    if (/out of gas|intrinsic gas too low|exceeds block/i.test(reason)) {
      statusEl.textContent = 'Reverted: Out of gas. Please try again; gas limit has been increased.';
    } else {
      statusEl.textContent = 'Reverted: ' + reason;
    }
    stopDiceAnim();
    rollBtn.disabled = false;
    if (hazardEnableTimer) { clearTimeout(hazardEnableTimer); hazardEnableTimer = null; }
    inFlight = false;
  }
});

  returnBtn?.addEventListener('click', () => { window.location.href = '/index.html'; });
});

