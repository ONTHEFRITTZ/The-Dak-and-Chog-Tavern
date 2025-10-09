// Dak & Chog coin flip (frontend scaffolding styled like other games)
import { renderTavernBanner, detectChainId, getAddressFor } from '../../js/config.js';
import '../../js/TavernABI.js';
import '../../js/DakChogABI.js';
import '../../js/DCMonABI.js';

const IMG_DAK = '../../assets/images/coin-dak.png';
const IMG_CHOG = '../../assets/images/coin-chog.png';
const MIN_BET = 0.001;

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

if (betInput) {
  betInput.value = formatDcmon(clampBet(betInput.value || MIN_BET));
}

let provider, signer, wallet, coinContract;
let coinTargetAddress = null;
let coinAbi = null;
let dcmonAddress = null;
let dcmonRead = null;
let dcmonToken = null;
let choice = 'dak';
let rulesOK = true; // rules gate removed

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

    dcmonAddress = null;
    dcmonRead = null;
    dcmonToken = null;
    try {
      let tokenAddr = null;
      if (coinContract && typeof coinContract.dcmonToken === 'function') {
        tokenAddr = await coinContract.dcmonToken().catch(() => null);
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
      return;
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
  let bet = clampBet(betInput.value);
  betInput.value = formatDcmon(bet);
  if (!provider || !signer || !wallet) { statusEl.textContent = 'Connect wallet first.'; return; }
  if (!coinContract || !coinTargetAddress) { statusEl.textContent = 'Coin contract not configured.'; return; }
  if (!Number.isFinite(bet) || bet < MIN_BET) {
    statusEl.textContent = `Minimum bet is ${formatDcmon(MIN_BET)} DCMon.`;
    return;
  }

  // Start continuous spin while tx is pending until chain confirms result
  try { coinEl.classList.remove('flip'); coinEl.classList.add('spin'); } catch {}
  statusEl.textContent = 'Checking conditions...';
  try {
    const betOnChog = (choice === 'chog');
    const betWei = ethers.utils.parseEther(formatDcmon(bet));

    // Ensure player balance + allowance
    try {
      const balance = await dcmonRead.balanceOf(wallet);
      if (balance.lt(betWei)) {
        statusEl.textContent = 'Insufficient DCMon balance for this bet.';
        try { coinEl.classList.remove('spin'); } catch {}
        return;
      }
    } catch (balErr) {
      console.error('DCMon balance check failed', balErr);
    }

    try {
      const allowance = await dcmonRead.allowance(wallet, coinTargetAddress).catch(() => ethers.constants.Zero);
      if (allowance.lt(betWei)) {
        statusEl.textContent = 'Approving DCMon for Dak & Chog...';
        try { showToast('Approving DCMon...', 'info'); } catch {}
        const approveTx = await dcmonToken.approve(coinTargetAddress, ethers.constants.MaxUint256);
        await approveTx.wait();
      }
    } catch (approveErr) {
      const msg = approveErr?.error?.message || approveErr?.data?.message || approveErr?.reason || approveErr?.message || 'Approval failed.';
      statusEl.textContent = msg;
      try { coinEl.classList.remove('spin'); } catch {}
      return;
    }

    // Max bet guard (if contract exposes it)
    try {
      const maxBet = await coinContract.maxBet().catch(()=>null);
      if (maxBet && maxBet.toString() !== '0') {
        if (betWei.gt(maxBet)) { statusEl.textContent = 'Bet exceeds maxBet for this game.'; return; }
      }
    } catch {}
    // Bankroll must cover net outflow. Require 2x wager in DCMon coverage.
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
          const dcBal = await pool.poolDcmonBalance().catch(() => ethers.constants.Zero);
          if (dcBal.gte(betWei.mul(2))) ok = true;
          else {
            const underlying = await pool.poolUnderlyingBalance().catch(() => ethers.constants.Zero);
            if (underlying.gte(betWei.mul(2))) ok = true;
          }
        } catch {}
      } else if (targetAddr) {
        try {
          const bankDc = await dcmonRead.balanceOf(targetAddr);
          if (bankDc && bankDc.gte(betWei.mul(2))) ok = true;
        } catch {}
      }
      if (!ok) { statusEl.textContent = 'Bankroll too low for this DCMon bet (needs 2x cover). Try a smaller amount.'; try { coinEl.classList.remove('spin'); } catch {}; return; }
    } catch {}
    // Static call to surface revert reasons
    try { await coinContract.callStatic.playCoin(betOnChog, betWei); }
    catch (pre) {
      const msg = pre?.error?.message || pre?.data?.message || pre?.reason || pre?.message || 'Reverted';
      statusEl.textContent = 'Rejected: ' + msg;
      return;
    }

    statusEl.textContent = 'Submitting transaction...';
    const tx = await coinContract.playCoin(betOnChog, betWei, { gasLimit: 250000 });
    statusEl.textContent = `Tx sent: ${tx.hash.slice(0,10)}... waiting confirmation...`;
    const rc = await tx.wait();
    // Parse CoinPlayed event if present
    let ev;
    try { ev = rc.events?.find(e => e.event === 'CoinPlayed'); } catch {}
    if (ev && ev.args) {
      const resultChog = !!ev.args.resultChog;
      const won = !!ev.args.won;
      // Stop spin and land on final on-chain result
      try { coinEl.classList.remove('spin'); } catch {}
      try { setCoin(resultChog ? 'chog' : 'dak'); } catch {}
      // Optional: one final flip for flair
      try { void coinEl.offsetWidth; coinEl.classList.add('flip'); setTimeout(()=>coinEl.classList.remove('flip'), 900); } catch {}
      statusEl.textContent = won ? `On-chain: ${resultChog ? 'CHOG' : 'DAK'} â€” you won!` : `On-chain: ${resultChog ? 'CHOG' : 'DAK'} â€” you lost.`;
    } else {
      try { coinEl.classList.remove('spin'); } catch {}
      // Fallback: query past logs or just show confirmed
      statusEl.textContent = 'Confirmed. Check wallet or explorer for result.';
    }
  } catch (e) {
    console.error(e);
    const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || 'Transaction failed.';
    statusEl.textContent = msg;
    try { coinEl.classList.remove('spin'); } catch {}
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




