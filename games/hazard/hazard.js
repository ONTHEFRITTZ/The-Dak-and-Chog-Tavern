// games/hazard/hazard.js
// DCMon-enabled Hazard frontend (HazardPlayed event) using ethers v5 UMD
import { getAddressFor, detectChainId, renderTavernBanner, showToast } from '../../js/config.js';
import '../../js/DCMonABI.js';
import { attachProvider } from '../../js/contract-utils.js';

async function ensureAAOps() {
  try {
    const tag = encodeURIComponent(window.__BUILD_TAG || Date.now());
    const mod = await import(/* @vite-ignore */ `../../js/aa/ops.js?v=${tag}`);
    return mod;
  } catch (e) {
    return null;
  }
}

let tavernAddress; // unified contract address
let activeHazardAbi = null;   // ABI used for parsing logs consistently
const diceImages = [
  '../../assets/images/dice/standard/dice1.png',
  '../../assets/images/dice/standard/dice2.png',
  '../../assets/images/dice/standard/dice3.png',
  '../../assets/images/dice/standard/dice4.png',
  '../../assets/images/dice/standard/dice5.png',
  '../../assets/images/dice/standard/dice6.png'
];

let provider, signer, contract;
let dcmonAddress = null;
let dcmonRead = null;
let dcmonToken = null;
const MIN_BET = 0.001;
let inFlight = false;          // prevent overlapping plays
let cooldownUntil = 0;         // brief cooldown after resolution
let diceLock = false;          // lock dice to the last game result (until next roll)
let diceSpinTimer = null;      // continuous spin timer until on-chain result
let selectedMain = 7;
let currentWallet = null;
let hazardEnableTimer = null;
let lastClickAt = 0;          // debounce rapid duplicate clicks
let injectedProvider = null;

function getStoredProviderKey() {
  try { return sessionStorage.getItem('walletProvider') || window.__walletProviderKey || ''; } catch (err) { return ''; }
}

function resolveInjectedProvider() {
  try {
    if (typeof window.__getSelectedProvider === 'function') {
      const resolved = window.__getSelectedProvider();
      if (resolved && typeof resolved.request === 'function') return resolved;
    }
  } catch (err) {}
  try {
    if (window.__walletProvider && typeof window.__walletProvider.request === 'function') return window.__walletProvider;
  } catch (err) {}
  try {
    if (window.ethereum && typeof window.ethereum.request === 'function') return window.ethereum;
  } catch (err) {}
  try {
    if (window.phantom && window.phantom.ethereum && typeof window.phantom.ethereum.request === 'function') return window.phantom.ethereum;
  } catch (err) {}
  return null;
}


// Global guards to prevent duplicate initialization/bindings
try {
  if (typeof window !== 'undefined') {
    window.__hazardInitDone = window.__hazardInitDone || false;
    window.__hazardEvtBound = window.__hazardEvtBound || false;
    window.__hazardTxPending = window.__hazardTxPending || false; // hard mutex for tx send
  }
} catch {}

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

const formatDcmon = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.000';
  const fixed = num.toFixed(3);
  return fixed === '-0.000' ? '0.000' : fixed;
};

const clampBet = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_BET) return MIN_BET;
  return Math.floor(parsed * 1000 + 1e-9) / 1000;
};

// Persist and restore basic UI state (bet + main)
try {
  const savedBet = localStorage.getItem('hazard.bet');
  if (savedBet && !isNaN(Number(savedBet))) betInput.value = formatDcmon(clampBet(savedBet));
  const savedMain = localStorage.getItem('hazard.main');
  if (savedMain) selectedMain = Number(savedMain);
  betInput.value = formatDcmon(clampBet(betInput.value || MIN_BET));
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
  if (diceLock && !opts.force) return;
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
  if (diceSpinTimer) return;
  diceSpinTimer = setInterval(() => {
    const r1 = Math.floor(Math.random() * 6) + 1;
    const r2 = Math.floor(Math.random() * 6) + 1;
    setDiceFaces(r1, r2);
  }, 100);
}
function stopDiceSpin() {
  if (diceSpinTimer) { clearInterval(diceSpinTimer); diceSpinTimer = null; }
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
  // Prevent duplicate init (e.g., bfcache restore or accidental double import)
  try { if (window.__hazardInitDone) return; window.__hazardInitDone = true; } catch {}
  hazardAck = true;
  try { if (rulesOverlay) rulesOverlay.style.display = 'none'; } catch {}
  try { if (openRulesBtn) openRulesBtn.style.display = 'none'; } catch {}
  try { ensureDiceSize(); setDiceFaces(1,1,{ force:true }); } catch {}

  // Accept either storage flag, but still try provider init even if missing
  let walletFlag = undefined;
  try { walletFlag = localStorage.getItem('walletConnected') || sessionStorage.getItem('walletConnected'); } catch {}
  injectedProvider = resolveInjectedProvider();
  if (!injectedProvider) {
    statusEl.textContent = 'Wallet provider not detected. Connect on the Tavern first.';
    rollBtn.disabled = true;
    return;
  }
  try {
    if (typeof window.__setSelectedProvider === 'function') {
      window.__setSelectedProvider(injectedProvider, getStoredProviderKey());
    }
  } catch (err) {}
  try {
    provider = new ethers.providers.Web3Provider(injectedProvider, 'any');
    signer = provider.getSigner();
    try { attachProvider(provider); } catch {}
    let walletAddress = null;
    try { walletAddress = await signer.getAddress(); } catch {}
    if (walletAddress) { currentWallet = walletAddress.toLowerCase(); }
    try { if (walletAddress && walletFlag !== 'true') localStorage.setItem('walletConnected','true'); } catch {}
    const hazardAddr = await getAddressFor('hazard', provider);
    const tavernFallback = await getAddressFor('tavern', provider);
    tavernAddress = hazardAddr || tavernFallback;
    const hazardAbi = (hazardAddr && window.HazardABI) ? window.HazardABI : window.TavernABI;
    activeHazardAbi = hazardAbi;
    contract = new ethers.Contract(tavernAddress, hazardAbi, signer);
    // Resolve DCMon token
    dcmonAddress = null;
    dcmonRead = null;
    dcmonToken = null;
    try {
      let tokenAddr = null;
      if (contract && typeof contract.dcmonToken === 'function') {
        tokenAddr = await contract.dcmonToken().catch(() => null);
      }
      if (!tokenAddr || tokenAddr === ethers.constants.AddressZero) {
        tokenAddr = await getAddressFor('dcmon', provider).catch(() => null);
      }
      if (!tokenAddr || tokenAddr === ethers.constants.AddressZero) {
        tokenAddr = window?.DCMON_ADDRESS || null;
      }
      if (tokenAddr && /^0x[0-9a-fA-F]{40}$/.test(tokenAddr) && window.DCMonABI) {
        dcmonAddress = tokenAddr;
        dcmonRead = new ethers.Contract(dcmonAddress, window.DCMonABI, provider);
        dcmonToken = new ethers.Contract(dcmonAddress, window.DCMonABI, signer);
      }
    } catch {}
    if (!dcmonAddress || !dcmonToken) {
      statusEl.textContent = 'DCMon token not configured. Contact admin.';
      rollBtn.disabled = true;
      return;
    }
try {
const chainId = await detectChainId(provider);
const bannerKey = hazardAddr ? 'hazard' : 'tavern';
renderTavernBanner({ contractKey: bannerKey, address: tavernAddress, chainId, wallet: walletAddress || undefined });
} catch {}

    // Verify Pool wiring (authorized + not paused) when available
    try {
      let poolAddr = ethers.constants.AddressZero;
      try { poolAddr = await contract.pool(); } catch {}
      if (poolAddr && poolAddr !== ethers.constants.AddressZero && window.PoolABI) {
        const pool = new ethers.Contract(poolAddr, window.PoolABI, provider);
        try {
          const authorized = await pool.authorizedGames(tavernAddress);
          if (!authorized) {
            statusEl.textContent = 'Hazard not authorized in Pool. Contact admin.';
            rollBtn.disabled = true;
          }
        } catch {}
        try {
          const paused = await pool.paused();
          if (paused) { statusEl.textContent = 'Pool is paused. Try again later.'; rollBtn.disabled = true; }
        } catch {}
      }
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
    // Force-update dice to the authoritative game result and lock until next roll
    setDiceFaces(d1, d2, { force:true });
    try { stopDiceSpin(); } catch {}
    diceLock = true;

    const wagerDc = formatDcmon(ethers.utils.formatEther(wager));
    const payoutDc = win ? formatDcmon(ethers.utils.formatEther(wager.mul(2))) : formatDcmon(0);
    const explanation = explainOutcome(Number(main), Number(finalSum), Number(chance), win);
    const rolledMsg = 'Rolled ' + Number(finalSum) + '. ';
    statusEl.textContent = (win
      ? ('You won ' + payoutDc + ' DCMon! ')
      : ('You lost. ')) + rolledMsg + explanation;
    try { showToast(win ? 'You won ' + payoutDc + ' DCMon' : 'You lost', win ? 'success' : 'info'); } catch {}

    if (rollsList) {
      const li = document.createElement('li');
      li.textContent = new Date().toLocaleTimeString() + ' - Bet: ' + wagerDc + ' DCMon - ' + (win ? 'Won' : 'Lost') + ' (Main:' + main + ', Final:' + finalSum + ', Iter:' + iterations + ')';
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
  // Bind event listener only once per page lifecycle
  if (!window.__hazardEvtBound) {
    contract.on('HazardPlayed', onHazardPlayed);
    window.__hazardEvtBound = true;
    window.addEventListener('beforeunload', () => { try { contract.off('HazardPlayed', onHazardPlayed); } catch {} });
  }

  // If the user connects their wallet after load, enable play without reloading
  try {
    if (injectedProvider?.on) {
      injectedProvider.on('accountsChanged', async (accs) => {
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

  // Roll button handler (bind once)
  if (rollBtn && !rollBtn.__hazardBound) {
    rollBtn.__hazardBound = true;
    rollBtn.addEventListener('click', async () => {
  // Guard: prevent re-clicks during tx or cooldown
  const now = Date.now();
  if (inFlight || now < cooldownUntil || (now - lastClickAt) < 500 || (typeof window!=='undefined' && window.__hazardTxPending)) {
    try { statusEl.textContent = 'Please wait... resolving previous roll.'; } catch {}
    return;
  }
  inFlight = true;
  lastClickAt = now;
  try { rollBtn.disabled = true; } catch {}
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

  const betValue = clampBet(betInput.value);
  betInput.value = formatDcmon(betValue);
  if (!Number.isFinite(betValue) || betValue < MIN_BET) {
    statusEl.textContent = `Minimum bet is ${formatDcmon(MIN_BET)} DCMon.`;
    try { rollBtn.disabled = false; } catch {}
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
    wager = ethers.utils.parseEther(formatDcmon(betValue));
  } catch {
    statusEl.textContent = 'Enter a valid bet amount.';
    inFlight = false;
    return;
  }

  // Ensure player balance + allowance
  try {
    const balance = await dcmonRead.balanceOf(currentWallet);
    if (balance.lt(wager)) {
      statusEl.textContent = 'Insufficient DCMon balance for this bet.';
      rollBtn.disabled = false;
      inFlight = false;
      return;
    }
  } catch (balErr) {
    console.error('DCMon balance check failed', balErr);
  }

  try {
    const allowance = await dcmonRead.allowance(currentWallet, tavernAddress).catch(() => ethers.constants.Zero);
    if (allowance.lt(wager)) {
      statusEl.textContent = 'Approving DCMon for Hazard...';
      try { showToast('Approving DCMon...', 'info'); } catch {}
      // Try AA path first (gasless)
      let approvedViaAA = false;
      try {
        const ops = await ensureAAOps();
        if (ops && typeof ops.encodeFromSignature === 'function' && typeof ops.sendTxViaAA === 'function') {
          const data = ops.encodeFromSignature('approve(address,uint256)', [tavernAddress, ethers.constants.MaxUint256]);
          const txHash = await ops.sendTxViaAA({ to: dcmonAddress, data });
          if (txHash) {
            try { if (provider?.waitForTransaction) await provider.waitForTransaction(txHash); } catch {}
            approvedViaAA = true;
          }
        }
      } catch {}
      if (!approvedViaAA) {
        const approveTx = await dcmonToken.approve(tavernAddress, ethers.constants.MaxUint256);
        await approveTx.wait();
      }
    }
  } catch (approveErr) {
    const msg = approveErr?.error?.message || approveErr?.data?.message || approveErr?.reason || approveErr?.message || 'Approval failed';
    statusEl.textContent = msg;
    rollBtn.disabled = false;
    inFlight = false;
    return;
  }

  // Bankroll coverage (need 2x)
  try {
    const poolAddr = await contract.pool().catch(() => ethers.constants.AddressZero);
    let ok = false;
    if (poolAddr && poolAddr !== ethers.constants.AddressZero && window.PoolABI) {
      try {
        const pool = new ethers.Contract(poolAddr, window.PoolABI, provider);
        const dcBal = await pool.poolDcmonBalance().catch(() => ethers.constants.Zero);
        if (dcBal.gte(wager.mul(2))) ok = true;
        else {
          const underlying = await pool.poolUnderlyingBalance().catch(() => ethers.constants.Zero);
          if (underlying.gte(wager.mul(2))) ok = true;
        }
      } catch (poolErr) {
        console.error('Pool balance check failed', poolErr);
      }
    }
    if (!ok) {
      try {
        const contractBal = await dcmonRead.balanceOf(tavernAddress);
        if (contractBal.gte(wager.mul(2))) ok = true;
      } catch (balErr) {
        console.error('Contract DCMon balance check failed', balErr);
      }
    }
    if (!ok) {
      statusEl.textContent = 'Bankroll too low for this DCMon bet (needs 2x cover). Try a smaller amount.';
      rollBtn.disabled = false;
      inFlight = false;
      return;
    }
  } catch (err) {
    console.error('Bankroll check error:', err);
  }

  statusEl.textContent = 'Rolling dice... sending transaction...';
  try { showToast('Rolling dice...', 'info'); } catch {}
  // Already disabled above
  // Start continuous spin and unlock faces for this round
  try { diceLock = false; } catch {}
  startDiceSpin();

  try {
    try { if (typeof window !== 'undefined') window.__hazardTxPending = true; } catch {}
    // Always do a static preflight to surface revert reasons before sending
    let gasLimitBN;
    try {
      const est = await contract.estimateGas.playHazard(selectedMain, wager);
      const min = ethers.BigNumber.from(600000);     // floor for complex paths
      const max = ethers.BigNumber.from(1200000);    // conservative cap
      let padded = est.mul(160).div(100);            // +60% safety
      if (padded.lt(min)) padded = min;
      if (padded.gt(max)) padded = max;
      gasLimitBN = padded;
    } catch {
      gasLimitBN = ethers.BigNumber.from(800000);      // robust fallback
    }

    const overrides = { gasLimit: gasLimitBN.toHexString() };

    try {
      await contract.callStatic.playHazard(selectedMain, wager, overrides);
    } catch (pre) {
      const msg = pre?.error?.message || pre?.data?.message || pre?.reason || pre?.message || 'Reverted';
      // Some providers dislike hex-string overrides; fall back to bare static call without overrides once
      if (/cannot override "_hex","_isBigNumber"/i.test(msg)) {
        try {
          await contract.callStatic.playHazard(selectedMain, wager);
        } catch (fallbackPre) {
          const fallbackMsg = fallbackPre?.error?.message || fallbackPre?.data?.message || fallbackPre?.reason || fallbackPre?.message || 'Reverted';
          statusEl.textContent = 'Rejected: ' + fallbackMsg;
          rollBtn.disabled = false;
          inFlight = false;
          try { if (typeof window !== 'undefined') window.__hazardTxPending = false; } catch {}
          return;
        }
      } else {
        statusEl.textContent = 'Rejected: ' + msg;
        rollBtn.disabled = false;
        inFlight = false;
        try { if (typeof window !== 'undefined') window.__hazardTxPending = false; } catch {}
        return;
      }
    }

    // Try AA path first (gasless)
    let receipt = null;
    let sentViaAA = false;
    try {
      const ops = await ensureAAOps();
      if (ops && typeof ops.encodeFromSignature === 'function' && typeof ops.sendTxViaAA === 'function') {
        const data = ops.encodeFromSignature('playHazard(uint8,uint256)', [selectedMain, wager]);
        const txHash = await ops.sendTxViaAA({ to: tavernAddress, data });
        if (txHash) {
          sentViaAA = true;
          statusEl.textContent = 'Dice rolling on-chain...';
          try { if (provider?.waitForTransaction) receipt = await provider.waitForTransaction(txHash); } catch {}
        }
      }
    } catch {}
    if (!sentViaAA) {
      const tx = await contract.playHazard(selectedMain, wager, overrides);
      statusEl.textContent = 'Dice rolling on-chain...';
      receipt = await tx.wait();
    }
    statusEl.textContent = 'Waiting for result...';

    // Fallback: parse receipt for HazardPlayed to update UI even if socket event is delayed or missed
    let updatedViaReceipt = false;
    try {
      const iface = new ethers.utils.Interface(activeHazardAbi || window.HazardABI || window.TavernABI || []);
      const tavernLower = String(tavernAddress||'').toLowerCase();
      for (const log of (receipt && receipt.logs) || []){
        if (String(log.address||'').toLowerCase() !== tavernLower) continue;
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === 'HazardPlayed'){
            const args = parsed.args || {};
            const player = String(args.player||args[0]||'');
            // Only update UI for this wallet
            if (currentWallet && player.toLowerCase() !== currentWallet) continue;
            const wagerEv = args.wager||args[1];
            const winEv = !!(args.win||args[2]);
            const mainEv = Number(args.main||args[3]);
            const finalSumEv = Number(args.finalSum||args[4]);
            const chanceEv = Number(args.chance||args[5]);
            const iterationsEv = Number(args.iterations||args[6]);
            // Stop spin and apply final faces + UI via event handler
            try { stopDiceSpin(); } catch {}
            try { await onHazardPlayed(player, wagerEv, winEv, mainEv, finalSumEv, chanceEv, iterationsEv); } catch {}
            updatedViaReceipt = true;
            break;
          }
        } catch {}
      }
    } catch {}

    if (!updatedViaReceipt) {
      // No event found in the receipt (or filtered out). Provide a clear, non-hanging status.
      statusEl.textContent = 'Confirmed on-chain, awaiting event… (refresh if it doesn\'t appear)';
    }

    // Enable immediately after confirmed result; brief cooldown only
    try { stopDiceSpin(); } catch {}
    try { rollBtn.disabled = false; } catch {}
    cooldownUntil = Date.now() + 1200;
    inFlight = false;
    try { if (typeof window !== 'undefined') window.__hazardTxPending = false; } catch {}
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
    try { stopDiceSpin(); } catch {}
    rollBtn.disabled = false;
    inFlight = false;
    try { if (typeof window !== 'undefined') window.__hazardTxPending = false; } catch {}
  }
    });
  }

  returnBtn?.addEventListener('click', () => { window.location.href = '/index.html'; });
});
