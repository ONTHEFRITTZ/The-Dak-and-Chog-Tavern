// Dak & Chog coin flip (frontend scaffolding styled like other games)
import { renderTavernBanner, detectChainId, getAddressFor } from '../../js/config.js';
import '../../js/TavernABI.js';

const RULES_VERSION = 'v2';
const statusEl = document.getElementById('dc-status');
const coinEl = document.getElementById('coin');
const betInput = document.getElementById('bet');
const flipBtn = document.getElementById('flip');
const chooseDak = document.getElementById('choose-dak');
const chooseChog = document.getElementById('choose-chog');
const rulesOverlay = document.getElementById('rules-overlay');
const rulesAck = document.getElementById('rules-ack');
const openRulesBtn = document.getElementById('open-rules');
const returnBtn = document.getElementById('return');

// Normalize any mojibake in status messages (e.g., bad ellipses/dashes)
try {
  function sanitizeStatus() {
    try {
      const t = statusEl?.textContent || '';
      if (!t) return;
      let u = t.replace(/�\?�/g, '…')
               .replace(/�\?"/g, ' — ');
      if (u !== t) statusEl.textContent = u;
    } catch {}
  }
  const mo = new MutationObserver(sanitizeStatus);
  if (statusEl) mo.observe(statusEl, { childList: true, characterData: true, subtree: true });
} catch {}

let provider, signer, wallet, tavern;
let unifiedAddr = null;  // unified Tavern address (emits CoinPlayed)
let unifiedLower = null; // lowercase for log filtering
let sendAddr = null; // resolved contract used for sends (DakChogRouter preferred)
let choice = 'dak';
let rulesOK = true; // rules gate removed

const IMG_DAK = '../../assets/images/coin-dak.png';
const IMG_CHOG = '../../assets/images/coin-chog.png';

// Continuous coin flip animation while awaiting on-chain result
let coinAnimNext = null; // timer for next cycle (full duration)
let coinAnimMid1 = null; // timer for first mid-cycle face swap (25%)
let coinAnimMid2 = null; // timer for second mid-cycle face swap (75%)
let coinAnimSide = 'dak';
const COIN_ANIM_MS = 800; // match CSS keyframes duration (.coin.flip { animation: flip 0.8s ease })
function performCoinFlipCycle() {
  // Retrigger CSS flip for this cycle (do not swap face yet)
  try { coinEl.classList.remove('flip'); void coinEl.offsetWidth; coinEl.classList.add('flip'); } catch {}
  // Swap at 90deg (25%) and 270deg (75%) when the coin is edge-on
  try { if (coinAnimMid1) { clearTimeout(coinAnimMid1); } } catch {}
  try { if (coinAnimMid2) { clearTimeout(coinAnimMid2); } } catch {}
  coinAnimMid1 = setTimeout(() => { coinAnimSide = (coinAnimSide === 'dak') ? 'chog' : 'dak'; setCoin(coinAnimSide); }, Math.floor(COIN_ANIM_MS * 0.25));
  coinAnimMid2 = setTimeout(() => { coinAnimSide = (coinAnimSide === 'dak') ? 'chog' : 'dak'; setCoin(coinAnimSide); }, Math.floor(COIN_ANIM_MS * 0.75));
  // Schedule next cycle after full duration
  try { if (coinAnimNext) { clearTimeout(coinAnimNext); } } catch {}
  coinAnimNext = setTimeout(performCoinFlipCycle, COIN_ANIM_MS + 20);
}
function startCoinAnim() {
  try { if (coinAnimNext) { clearTimeout(coinAnimNext); coinAnimNext = null; } } catch {}
  try { if (coinAnimMid1) { clearTimeout(coinAnimMid1); coinAnimMid1 = null; } } catch {}
  try { if (coinAnimMid2) { clearTimeout(coinAnimMid2); coinAnimMid2 = null; } } catch {}
  performCoinFlipCycle();
}
function stopCoinAnim(finalSide) {
  if (coinAnimNext) { try { clearTimeout(coinAnimNext); } catch {} coinAnimNext = null; }
  if (coinAnimMid1) { try { clearTimeout(coinAnimMid1); } catch {} coinAnimMid1 = null; }
  if (coinAnimMid2) { try { clearTimeout(coinAnimMid2); } catch {} coinAnimMid2 = null; }
  try { coinEl.classList.remove('flip'); } catch {}
  if (finalSide === 'dak' || finalSide === 'chog') setCoin(finalSide);
}

function rulesFresh(key) { try { const t = Number(localStorage.getItem(key) || 0); return Date.now() - t < 86400000; } catch { return false; } }

function setChoice(side) {
  choice = side === 'chog' ? 'chog' : 'dak';
  try {
    chooseDak.classList.toggle('active', choice === 'dak');
    chooseChog.classList.toggle('active', choice === 'chog');
  } catch {}
}

function setCoin(side) {
  const img = side === 'chog' ? IMG_CHOG : IMG_DAK;
  coinEl.style.backgroundImage = `url(${img})`;
}

async function resolveDakChogContract() {
  // Prefer per-game router; fall back to unified Tavern. Ensure we target a CONTRACT (has bytecode).
  const ethers = window.ethers;
  try {
    const router = await getAddressFor('dakchog', provider);
    const unified = await getAddressFor('tavern', provider);
    let target = router || unified || null;
    // If router provided, verify it is a contract; otherwise fall back to unified
    if (router) {
      try { const code = await provider.getCode(router); if (!code || code === '0x') target = unified || null; } catch { target = unified || null; }
    }
    // Verify final target is a contract
    if (target) {
      const code = await provider.getCode(target).catch(()=> '0x');
      if (!code || code === '0x') { return { addr: null, label: null }; }
      return { addr: target, label: (target?.toLowerCase() === router?.toLowerCase()) ? 'DakChog' : 'Tavern' };
    }
  } catch {}
  return { addr: null, label: null };
}

async function ensureWallet() {
  if (!window.ethereum) return;
  try {
    const ethers = window.ethers;
    provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    signer = provider.getSigner();
    wallet = await signer.getAddress();
    try {
      const chainId = await detectChainId(provider);
      const resolved = await resolveDakChogContract();
      sendAddr = resolved.addr;
      // Resolve unified Tavern for event/log filtering
      unifiedAddr = await getAddressFor('tavern', provider);
      unifiedLower = String(unifiedAddr||'').toLowerCase();
      const labelOverride = resolved.label || 'Tavern';
      renderTavernBanner({ contractKey: 'tavern', address: sendAddr || unifiedAddr || '', chainId, wallet, labelOverride });
      if (sendAddr && window.TavernABI) {
        tavern = new ethers.Contract(sendAddr, window.TavernABI, signer);
      } else {
        tavern = null;
      }
    } catch {}
  } catch {}
}

flipBtn.addEventListener('click', async () => {
  if (!rulesOK) { try { rulesOverlay.style.display = 'flex'; } catch {}; return; }
  const ethers = window.ethers;
  const bet = Number(betInput.value || 0);
  if (!provider || !signer || !wallet) { statusEl.textContent = 'Connect wallet first.'; return; }
  if (!tavern || !window.TavernABI) { statusEl.textContent = 'Tavern/DakChog contract not configured for this network.'; return; }
  if (!(bet > 0)) { statusEl.textContent = 'Enter a valid bet amount.'; return; }

  // Animate coin continuously while tx is pending
  startCoinAnim();
  statusEl.textContent = 'Checking conditions…';
  try {
    const betOnChog = (choice === 'chog');
    const betWei = ethers.utils.parseEther(String(bet));

    // Max bet guard (if contract exposes it)
    try {
      const maxBet = await tavern.maxBet().catch(()=>null);
      if (maxBet && maxBet.toString() !== '0') {
        if (betWei.gt(maxBet)) { statusEl.textContent = 'Bet exceeds maxBet for the Tavern.'; return; }
      }
    } catch {}
    // Bankroll must cover net outflow. If a pool is configured, require 2x wager there; else require at least the wager at the Tavern.
    try {
      let ok = false;
      const addr = await getAddressFor('tavern', provider);
      const tav = new ethers.Contract(addr, window.TavernABI, provider);
      let poolAddr = undefined; try { poolAddr = await tav.pool(); } catch {}
      if (poolAddr && poolAddr !== ethers.constants.AddressZero && window.PoolABI) {
        try { const pool = new ethers.Contract(poolAddr, window.PoolABI, provider); const bal = await pool.balance(); if (bal.gte(betWei.mul(2))) ok = true; } catch {}
      } else {
        const bank = await provider.getBalance(addr); if (bank && bank.gte(betWei)) ok = true;
      }
      if (!ok) { statusEl.textContent = 'Bankroll too low for this bet. Try a smaller amount.'; return; }
    } catch {}

    // Static call to surface revert reasons; ensure target is a contract
    try {
      const code = await provider.getCode(sendAddr).catch(()=> '0x');
      if (!code || code === '0x') { statusEl.textContent = 'Configured address is not a contract.'; return; }
      await tavern.callStatic.playCoin(betOnChog, { value: betWei });
    }
    catch (pre) {
      const msg = pre?.error?.message || pre?.data?.message || pre?.reason || pre?.message || 'Reverted';
      statusEl.textContent = 'Rejected: ' + msg;
      // Stop animation on preflight failure
      try { stopCoinAnim(); } catch {}
      return;
    }

    statusEl.textContent = 'Submitting transaction…';
    const tx = await tavern.playCoin(betOnChog, { value: betWei, gasLimit: 120000 });
    statusEl.textContent = `Tx sent: ${tx.hash.slice(0,10)}… waiting confirmation…`;
    const rc = await tx.wait();
    // Parse CoinPlayed event if present (direct decode)
    let resultChog = null, won = null;
    try {
      const ev = rc.events?.find(e => e.event === 'CoinPlayed');
      if (ev && ev.args) { resultChog = !!ev.args.resultChog; won = !!ev.args.won; }
    } catch {}
    // Fallback: parse receipt logs from unified Tavern address
    if (resultChog === null) {
      try {
        const iface = new ethers.utils.Interface(window.TavernABI || []);
        const routerLower = String(sendAddr||'').toLowerCase();
        for (const log of (rc && rc.logs) || []){
          if (unifiedLower && String(log.address||'').toLowerCase() !== unifiedLower) continue;
          try {
            const parsed = iface.parseLog(log);
            if (parsed && parsed.name === 'CoinPlayed'){
              const args = parsed.args || {};
              const player = String(args.player||args[0]||'').toLowerCase();
              const isMine = (wallet && player === wallet.toLowerCase()) || (routerLower && player === routerLower);
              if (!isMine) continue;
              won = !!(args.won||args[2]);
              resultChog = !!(args.resultChog||args[3]);
              break;
            }
          } catch {}
        }
      } catch {}
    }
    if (resultChog !== null) {
      // Stop animation and update the coin immediately with the authoritative result
      stopCoinAnim(resultChog ? 'chog' : 'dak');
      statusEl.textContent = won ? `On-chain: ${resultChog ? 'CHOG' : 'DAK'} — you won!` : `On-chain: ${resultChog ? 'CHOG' : 'DAK'} — you lost.`;
    } else {
      statusEl.textContent = 'Confirmed. Awaiting result event…';
    }
  } catch (e) {
    console.error(e);
    const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || 'Transaction failed.';
    statusEl.textContent = msg;
    try { stopCoinAnim(); } catch {}
  }
});

chooseDak.addEventListener('click', () => setChoice('dak'));
chooseChog.addEventListener('click', () => setChoice('chog'));
returnBtn?.addEventListener('click', () => { window.location.href = '/index.html'; });

const onReady = (fn) => { if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', fn, { once: true }); } else { fn(); } };
onReady(async () => {
  setCoin('dak');
  setChoice('dak');
  // Remove rules gating entirely
  try { if (rulesOverlay) rulesOverlay.style.display = 'none'; } catch {}
  try { if (openRulesBtn) openRulesBtn.style.display = 'none'; } catch {}
  await ensureWallet();
});
