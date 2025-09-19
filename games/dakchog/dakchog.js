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
let sendAddr = null; // resolved contract used for sends (DakChogRouter preferred)
let choice = 'dak';
let rulesOK = true; // rules gate removed

const IMG_DAK = '../../assets/images/coin-dak.png';
const IMG_CHOG = '../../assets/images/coin-chog.png';

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
      const labelOverride = resolved.label || 'Tavern';
      renderTavernBanner({ contractKey: 'tavern', address: sendAddr || '', chainId, wallet, labelOverride });
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

  // Animate coin while tx is pending
  try { coinEl.classList.remove('flip'); void coinEl.offsetWidth; coinEl.classList.add('flip'); } catch {}
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
      return;
    }

    statusEl.textContent = 'Submitting transaction…';
    const tx = await tavern.playCoin(betOnChog, { value: betWei, gasLimit: 120000 });
    statusEl.textContent = `Tx sent: ${tx.hash.slice(0,10)}… waiting confirmation…`;
    const rc = await tx.wait();
    // Parse CoinPlayed event if present
    let ev;
    try { ev = rc.events?.find(e => e.event === 'CoinPlayed'); } catch {}
    if (ev && ev.args) {
      const resultChog = !!ev.args.resultChog;
      const won = !!ev.args.won;
      setTimeout(() => { setCoin(resultChog ? 'chog' : 'dak'); }, 380);
      statusEl.textContent = won ? `On-chain: ${resultChog ? 'CHOG' : 'DAK'} – you won!` : `On-chain: ${resultChog ? 'CHOG' : 'DAK'} – you lost.`;
    } else {
      // Fallback: query past logs or just show confirmed
      statusEl.textContent = 'Confirmed. Check wallet or explorer for result.';
    }
  } catch (e) {
    console.error(e);
    const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || 'Transaction failed.';
    statusEl.textContent = msg;
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
