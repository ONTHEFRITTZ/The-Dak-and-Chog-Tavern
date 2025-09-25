// Dak & Chog coin flip (frontend scaffolding styled like other games)
import { renderTavernBanner, detectChainId, getAddressFor } from '../../js/config.js';
import '../../js/TavernABI.js';
import '../../js/DakChogABI.js';

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

let provider, signer, wallet, coinContract;
let coinTargetAddress = null;
let coinAbi = null;
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

async function ensureWallet() {
  if (!window.ethereum) return;
  try {
    const ethers = window.ethers;
    provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    signer = provider.getSigner();
    wallet = await signer.getAddress();
  try {
    const chainId = await detectChainId(provider);
    const dedicatedAddr = await getAddressFor('dakchog', provider);
    const tavernAddr = await getAddressFor('tavern', provider);
    coinTargetAddress = dedicatedAddr || tavernAddr || null;
    coinAbi = (dedicatedAddr && window.DakChogABI) ? window.DakChogABI : window.TavernABI;
    const bannerKey = dedicatedAddr ? 'dakchog' : 'tavern';
    renderTavernBanner({ contractKey: bannerKey, address: coinTargetAddress, chainId, wallet });
    if (coinTargetAddress && coinAbi) {
      coinContract = new ethers.Contract(coinTargetAddress, coinAbi, signer);
    } else {
      coinContract = undefined;
    }
  } catch {}

    // Self-heal: If signer is DakChog owner, update pool; if signer is Pool owner, unpause + authorize DakChog.
    try {
      const configuredPool = await getAddressFor('pool', provider).catch(() => null);
      const c = coinContract;
      if (c) {
        let currentPool = await (c.pool ? c.pool().catch(() => ethers.constants.AddressZero) : Promise.resolve(ethers.constants.AddressZero));
        const signerAddr = (await signer.getAddress()).toLowerCase();
        if (configuredPool && currentPool && String(currentPool).toLowerCase() !== String(configuredPool).toLowerCase()) {
          try { const owner = (await c.owner()).toLowerCase(); if (owner === signerAddr && c.setPool) { await (await c.setPool(configuredPool)).wait(); currentPool = configuredPool; try { showToast('DakChog pool updated','success'); } catch {} } } catch {}
        }
        if (currentPool && currentPool !== ethers.constants.AddressZero && window.PoolABI) {
          try {
            const pool = new ethers.Contract(currentPool, window.PoolABI, signer);
            const poolOwner = (await pool.owner()).toLowerCase();
            if (poolOwner === signerAddr) {
              try { if (await pool.paused()) { await (await pool.pause(false)).wait(); } } catch {}
              try { const authorized = await pool.authorizedGames(coinTargetAddress).catch(() => false); if (!authorized) { await (await pool.setAuthorized(coinTargetAddress, true)).wait(); try { showToast('Authorized DakChog in Pool','success'); } catch {} } } catch {}
            }
          } catch {}
        }
      }
    } catch {}
  } catch {}
}

flipBtn.addEventListener('click', async () => {
  if (!rulesOK) { try { rulesOverlay.style.display = 'flex'; } catch {}; return; }
  const ethers = window.ethers;
  const bet = Number(betInput.value || 0);
  if (!provider || !signer || !wallet) { statusEl.textContent = 'Connect wallet first.'; return; }
  if (!coinContract || !coinTargetAddress) { statusEl.textContent = 'Coin contract not configured.'; return; }
  if (!(bet > 0)) { statusEl.textContent = 'Enter a valid bet amount.'; return; }

  // Animate coin while tx is pending
  try { coinEl.classList.remove('flip'); void coinEl.offsetWidth; coinEl.classList.add('flip'); } catch {}
  statusEl.textContent = 'Checking conditions...';
  try {
    const betOnChog = (choice === 'chog');
    const betWei = ethers.utils.parseEther(String(bet));

    // Max bet guard (if contract exposes it)
    try {
      const maxBet = await coinContract.maxBet().catch(()=>null);
      if (maxBet && maxBet.toString() !== '0') {
        if (betWei.gt(maxBet)) { statusEl.textContent = 'Bet exceeds maxBet for this game.'; return; }
      }
    } catch {}
    // Bankroll must cover net outflow. If a pool is configured, require 2x wager there; else require at least the wager at the Tavern.
    try {
      let ok = false;
      const targetAddr = coinTargetAddress || await getAddressFor('tavern', provider);
      const viewAbi = coinAbi || window.DakChogABI || window.TavernABI;
      let poolAddr;
      if (targetAddr && viewAbi) {
        try {
          const viewContract = new ethers.Contract(targetAddr, viewAbi, provider);
          if (viewContract.pool) { poolAddr = await viewContract.pool(); }
        } catch {}
      }
      if (poolAddr && poolAddr !== ethers.constants.AddressZero && window.PoolABI) {
        try {
          const pool = new ethers.Contract(poolAddr, window.PoolABI, provider);
          const bal = await pool.balance();
          if (bal.gte(betWei.mul(2))) ok = true;
        } catch {}
      } else if (targetAddr) {
        try {
          const bank = await provider.getBalance(targetAddr);
          if (bank && bank.gte(betWei)) ok = true;
        } catch {}
      }
      if (!ok) { statusEl.textContent = 'Bankroll too low for this bet. Try a smaller amount.'; return; }
    } catch {}
    // Static call to surface revert reasons
    try { await coinContract.callStatic.playCoin(betOnChog, { value: betWei }); }
    catch (pre) {
      const msg = pre?.error?.message || pre?.data?.message || pre?.reason || pre?.message || 'Reverted';
      statusEl.textContent = 'Rejected: ' + msg;
      return;
    }

    statusEl.textContent = 'Submitting transaction...';
    const tx = await coinContract.playCoin(betOnChog, { value: betWei, gasLimit: 120000 });
    statusEl.textContent = `Tx sent: ${tx.hash.slice(0,10)}... waiting confirmation...`;
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
