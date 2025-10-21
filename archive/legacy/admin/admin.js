import { detectChainId, getAddressFor, renderTavernBanner } from '../js/config.js';

const statusEl = document.getElementById('status');

// Tavern elements
const tavAddrEl = document.getElementById('tavern-address');
const tavOwnerEl = document.getElementById('tavern-owner');
const tavBalEl = document.getElementById('tavern-balance');
const tavOwnerMatchEl = document.getElementById('tavern-owner-match');
const tavMaxBetInput = document.getElementById('tavern-maxbet');
const tavPoolEl = document.getElementById('tavern-pool');
const tavPoolInput = document.getElementById('tavern-pool-input');
const tavSetPoolBtn = document.getElementById('tavern-set-pool');
const tavSetMaxBetBtn = document.getElementById('tavern-set-maxbet');
const tavOverrideInput = document.getElementById('tavern-override');
const tavSetAddrBtn = document.getElementById('tavern-set-addr');

// Faro elements
const faroAddrEl = document.getElementById('faro-address');
const faroOwnerEl = document.getElementById('faro-owner');
const faroBalEl = document.getElementById('faro-balance');
const faroOwnerMatchEl = document.getElementById('faro-owner-match');
const faroFeesEl = document.getElementById('faro-fees');
const faroMaxBetInput = document.getElementById('faro-maxbet');
const faroSetMaxBetBtn = document.getElementById('faro-set-maxbet');
const faroFeeInput = document.getElementById('faro-fee');
const faroSetFeeBtn = document.getElementById('faro-set-fee');
const faroOverrideInput = document.getElementById('faro-override');
const faroSetAddrBtn = document.getElementById('faro-set-addr');
const faroPoolEl = document.getElementById('faro-pool');
const faroPoolInput = document.getElementById('faro-pool-input');
const faroSetPoolBtn = document.getElementById('faro-set-pool');
const faroPauseBtn = document.getElementById('faro-pause');
const faroResumeBtn = document.getElementById('faro-resume');

// Pool elements
const poolAddrEl = document.getElementById('pool-address');
const poolOwnerEl = document.getElementById('pool-owner');
const poolBalEl = document.getElementById('pool-balance');
const poolOverrideInput = document.getElementById('pool-override');
const poolSetAddrBtn = document.getElementById('pool-set-addr');
const poolToInput = document.getElementById('pool-to');
const poolAmtInput = document.getElementById('pool-amt');
const poolWithdrawBtn = document.getElementById('pool-withdraw');
const poolDepositAmtInput = document.getElementById('pool-deposit-amt');
const poolDepositBtn = document.getElementById('pool-deposit');
const poolRedeemAmtInput = document.getElementById('pool-redeem-amt');
const poolRedeemBtn = document.getElementById('pool-redeem');
const poolAuthInput = document.getElementById('pool-auth');
const poolAuthorizeBtn = document.getElementById('pool-authorize');
const poolDeauthorizeBtn = document.getElementById('pool-deauthorize');
const poolAuthListEl = document.getElementById('pool-auth-list');
const poolNativeEl = document.getElementById('pool-native');
const poolUnderlyingEl = document.getElementById('pool-underlying');
const poolDcmonEl = document.getElementById('pool-dcmon');

const wmonAddrEl = document.getElementById('wmon-address');
const dcmonAddrEl = document.getElementById('dcmon-address');
const dcmonHouseEl = document.getElementById('dcmon-house');
const dcmonPlayerEl = document.getElementById('dcmon-player');
const wmonWalletEl = document.getElementById('wmon-wallet');
const dcmonWalletEl = document.getElementById('dcmon-wallet');
const wmonPoolEl = document.getElementById('wmon-pool');
const dcmonPoolEl = document.getElementById('dcmon-pool');
const wmonWrapAmtInput = document.getElementById('wmon-wrap-amt');
const wmonWrapBtn = document.getElementById('wmon-wrap');
const wmonUnwrapAmtInput = document.getElementById('wmon-unwrap-amt');
const wmonUnwrapBtn = document.getElementById('wmon-unwrap');
const wmonApproveAmtInput = document.getElementById('wmon-approve-amt');
const wmonApproveBtn = document.getElementById('wmon-approve');
const wmonApproveMaxBtn = document.getElementById('wmon-approve-max');
const wmonAllowanceEl = document.getElementById('wmon-allowance');
const wmonApproveDcmonAmtInput = document.getElementById('wmon-approve-dcmon-amt');
const wmonApproveDcmonBtn = document.getElementById('wmon-approve-dcmon');
const wmonApproveDcmonMaxBtn = document.getElementById('wmon-approve-dcmon-max');
const wmonAllowanceDcmonEl = document.getElementById('wmon-allowance-dcmon');
const dcmonDepositAmtInput = document.getElementById('dcmon-deposit-amt');
const dcmonDepositBtn = document.getElementById('dcmon-deposit');
const dcmonRedeemAmtInput = document.getElementById('dcmon-redeem-amt');
const dcmonRedeemBtn = document.getElementById('dcmon-redeem');
const dcmonRewardAmtInput = document.getElementById('dcmon-reward-amt');
const dcmonRecordBtn = document.getElementById('dcmon-record');

// Whitelist removed

// Poker (Pooled) elements
const ppAddrEl = document.getElementById('pokerpooled-address');
const ppOverrideInput = document.getElementById('pokerpooled-override');
const ppSetAddrBtn = document.getElementById('pokerpooled-set-addr');
const ppMsgEl = document.getElementById('pokerpooled-msg');

let provider, signer, wallet;
try {
  ['contract.hazard','contract.shell','contract.dakchog'].forEach(k => localStorage.removeItem(k));
} catch (e) {}
let walletEventsRegistered = false;
let topButtonsBound = false;
let tavernAddr = null, faroAddr = null, poolAddr = null, wmonAddr = null, dcmonAddr = null;
// Whitelist removed
let tavern, faro, pool, wmon, dcmon;
let tavernOwner = null, faroOwner = null, poolOwner = null;
let ioSocket = null;
let pokerPooledAddr = null; let pokerPooled = null;

function fmtEth(v) {
  try { return window.ethers.utils.formatEther(v); } catch { return '0'; }
}

function formatAmount(value, symbol) {
  try {
    const formatted = fmtEth(value);
    return symbol ? `${formatted} ${symbol}` : formatted;
  } catch {
    return '-';
  }
}
function parseAmount(input) {
  const rawValue = typeof input === 'string' ? input : String(input?.value ?? '').trim();
  if (!rawValue) return null;
  try { return window.ethers.utils.parseEther(rawValue); } catch { return null; }
}

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message || '';
  }
}
function isTavOwnerNow() {
  try { return !!(wallet && tavernOwner && wallet.toLowerCase() === tavernOwner.toLowerCase()); } catch { return false; }
}
function isFaroOwnerNow() {
  try { return !!(wallet && faroOwner && wallet.toLowerCase() === faroOwner.toLowerCase()); } catch { return false; }
}
function updateWalletButtons() {
  const connected = !!wallet;
  const connectEl = document.getElementById('connect-wallet');
  const disconnectEl = document.getElementById('disconnect-wallet');
  if (connectEl) connectEl.style.display = connected ? 'none' : '';
  if (disconnectEl) disconnectEl.style.display = connected ? '' : 'none';
}

async function refresh() {
  try {
    const chainId = await detectChainId(provider);

    const overrideAddr = (key, current) => {
      try {
        const stored = localStorage.getItem(`contract.${key}`);
        return stored && /^0x[0-9a-fA-F]{40}$/.test(stored) ? stored : current;
      } catch {
        return current;
      }
    };

    tavernAddr = await getAddressFor('tavern', provider);
    faroAddr = await getAddressFor('faro', provider);
    poolAddr = await getAddressFor('pool', provider);
    wmonAddr = await getAddressFor('wmon', provider);
    dcmonAddr = await getAddressFor('dcmon', provider);
    try { pokerPooledAddr = await getAddressFor('pokerTable', provider); } catch { pokerPooledAddr = ''; }

    tavernAddr = overrideAddr('tavern', tavernAddr);
    faroAddr = overrideAddr('faro', faroAddr);
    poolAddr = overrideAddr('pool', poolAddr);
    wmonAddr = overrideAddr('wmon', wmonAddr);
    dcmonAddr = overrideAddr('dcmon', dcmonAddr);
    pokerPooledAddr = overrideAddr('pokerTable', pokerPooledAddr);

    if (tavAddrEl) tavAddrEl.textContent = tavernAddr || '-';
    if (faroAddrEl) faroAddrEl.textContent = faroAddr || '-';
    if (poolAddrEl) poolAddrEl.textContent = poolAddr || '-';
    if (wmonAddrEl) wmonAddrEl.textContent = wmonAddr || '-';
    if (dcmonAddrEl) dcmonAddrEl.textContent = dcmonAddr || '-';
    if (ppAddrEl) ppAddrEl.textContent = pokerPooledAddr || '(set below)';

    if (tavOverrideInput) tavOverrideInput.placeholder = tavernAddr || '';
    if (faroOverrideInput) faroOverrideInput.placeholder = faroAddr || '';
    if (poolOverrideInput) poolOverrideInput.placeholder = poolAddr || '';
    if (ppOverrideInput) ppOverrideInput.placeholder = pokerPooledAddr || '';

    renderTavernBanner({ contractKey: 'tavern', address: tavernAddr, chainId, wallet });
    try { const wb = document.getElementById('wallet-banner'); if (wb) wb.remove(); } catch {}
    try { const nb = document.getElementById('nb-disconnect'); if (nb) nb.remove(); } catch {}

    if (tavernAddr && window.TavernABI && signer) {
      tavern = new window.ethers.Contract(tavernAddr, window.TavernABI, signer);
      try {
        tavernOwner = await tavern.owner();
        if (tavOwnerEl) tavOwnerEl.textContent = tavernOwner;
        const bal = await provider.getBalance(tavernAddr);
        if (tavBalEl) tavBalEl.textContent = formatAmount(bal, 'MON');
        const maxBet = await tavern.maxBet();
        if (tavMaxBetInput) tavMaxBetInput.placeholder = fmtEth(maxBet);
        try {
          const tp = await tavern.pool();
          if (tavPoolEl) tavPoolEl.textContent = tp || '-';
        } catch {
          if (tavPoolEl) tavPoolEl.textContent = '(not pooled)';
        }
        if (tavOwnerMatchEl) {
          const match = isTavOwnerNow();
          tavOwnerMatchEl.textContent = match ? 'Yes' : 'No';
          try { tavOwnerMatchEl.style.color = match ? '#006400' : '#8b0000'; } catch {}
        }
      } catch {}
    }

    if (faroAddr && window.FaroABI && signer) {
      faro = new window.ethers.Contract(faroAddr, window.FaroABI, signer);
      try {
        faroOwner = await faro.owner();
        if (faroOwnerEl) faroOwnerEl.textContent = faroOwner;
        const bal = await provider.getBalance(faroAddr);
        if (faroBalEl) faroBalEl.textContent = formatAmount(bal, 'MON');
        const maxBet = await faro.maxBet();
        if (faroMaxBetInput) faroMaxBetInput.placeholder = fmtEth(maxBet);
        const fee = await faro.feeBps();
        if (faroFeeInput) faroFeeInput.placeholder = String(fee);
        try {
          const feesAcc = await faro.feesAccrued();
          if (faroFeesEl) faroFeesEl.textContent = formatAmount(feesAcc, 'MON');
        } catch {}
        try { const p = await faro.pool(); if (faroPoolEl) faroPoolEl.textContent = p || '(n/a)'; }
        catch { if (faroPoolEl) faroPoolEl.textContent = '(n/a)'; }
        if (faroOwnerMatchEl) {
          const match = isFaroOwnerNow();
          faroOwnerMatchEl.textContent = match ? 'Yes' : 'No';
          try { faroOwnerMatchEl.style.color = match ? '#006400' : '#8b0000'; } catch {}
        }
      } catch {}
    }

    try {
      if (pokerPooledAddr && window.PokerTablePoolABI && signer) {
        pokerPooled = new window.ethers.Contract(pokerPooledAddr, window.PokerTablePoolABI, signer);
      } else { pokerPooled = null; }
    } catch { pokerPooled = null; }

    wmon = (wmonAddr && window.WMON_ABI && (signer || provider))
      ? new window.ethers.Contract(wmonAddr, window.WMON_ABI, signer || provider)
      : null;
    dcmon = (dcmonAddr && window.DCMonABI && (signer || provider))
      ? new window.ethers.Contract(dcmonAddr, window.DCMonABI, signer || provider)
      : null;

    if (dcmonHouseEl) dcmonHouseEl.textContent = '-';
    if (dcmonPlayerEl) dcmonPlayerEl.textContent = '-';
    if (dcmon && dcmon.houseTreasury) {
      try { const house = await dcmon.houseTreasury(); if (dcmonHouseEl) dcmonHouseEl.textContent = house; } catch {}
      try { const player = await dcmon.playerRewardPool(); if (dcmonPlayerEl) dcmonPlayerEl.textContent = player; } catch {}
    }

    if (poolAddr && window.PoolABI && (signer || provider)) {
      const rw = signer || provider;
      pool = new window.ethers.Contract(poolAddr, window.PoolABI, rw);
      try {
        poolOwner = await pool.owner();
        if (poolOwnerEl) poolOwnerEl.textContent = poolOwner;
        const nativeBal = await provider.getBalance(poolAddr);
        if (poolNativeEl) poolNativeEl.textContent = formatAmount(nativeBal, 'MON');
        try {
          const underlying = await pool.poolUnderlyingBalance();
          if (poolUnderlyingEl) poolUnderlyingEl.textContent = formatAmount(underlying, 'WMON');
          if (wmonPoolEl) wmonPoolEl.textContent = formatAmount(underlying, 'WMON');
          if (poolAmtInput) poolAmtInput.placeholder = fmtEth(underlying);
          if (poolDepositAmtInput) poolDepositAmtInput.placeholder = fmtEth(underlying);
        } catch {
          if (poolUnderlyingEl) poolUnderlyingEl.textContent = '-';
          if (wmonPoolEl) wmonPoolEl.textContent = '-';
        }
        try {
          const dcBal = await pool.poolDcmonBalance();
          if (poolDcmonEl) poolDcmonEl.textContent = formatAmount(dcBal, 'DCMon');
          if (dcmonPoolEl) dcmonPoolEl.textContent = formatAmount(dcBal, 'DCMon');
          if (poolRedeemAmtInput) poolRedeemAmtInput.placeholder = fmtEth(dcBal);
        } catch {
          if (poolDcmonEl) poolDcmonEl.textContent = '-';
          if (dcmonPoolEl) dcmonPoolEl.textContent = '-';
        }

        if (poolAuthListEl) {
          try {
            const entries = [];
            const labels = [
              ['hazard','Hazard'],
              ['shell','Shell'],
              ['dakchog','DakChog'],
              ['faro','Faro'],
              ['pokerTable','Poker'],
            ];
            for (const [key,label] of labels) {
              let addr = '';
              try { addr = await getAddressFor(key, provider); } catch {}
              addr = overrideAddr(key, addr);
              if (!addr) continue;
              let allowed = null;
              try { allowed = await pool.authorizedGames(addr); } catch {}
              const short = (v) => (v && v.length > 10 ? `${v.slice(0,6)}...${v.slice(-4)}` : (v || '-'));
              const color = allowed ? '#006400' : '#8b0000';
              const status = allowed === null ? 'unknown' : (allowed ? 'AUTHORIZED' : 'not authorized');
                            entries.push(`<div><strong>${label}</strong>: <span title="${addr}">${short(addr)}</span> \u2192 <span style="color:${color}">${status}</span></div>`);
            }
            poolAuthListEl.innerHTML = entries.length ? entries.join('') : '<div>(no known games on this chain)</div>';
          } catch {
            poolAuthListEl.innerHTML = '<div>(unable to load)</div>';
          }
        }
      } catch {
        poolOwner = null;
      }
    } else {
      pool = null;
      poolOwner = null;
      if (poolNativeEl) poolNativeEl.textContent = '-';
      if (poolUnderlyingEl) poolUnderlyingEl.textContent = '-';
      if (poolDcmonEl) poolDcmonEl.textContent = '-';
    }

    if (wmonWalletEl) wmonWalletEl.textContent = '-';
    if (dcmonWalletEl) dcmonWalletEl.textContent = '-';
    if (wmonAllowanceEl) wmonAllowanceEl.textContent = '-';
    if (wmonAllowanceDcmonEl) wmonAllowanceDcmonEl.textContent = '-';

    if (wallet && wmon) {
      try {
        const walletWmon = await wmon.balanceOf(wallet);
        if (wmonWalletEl) wmonWalletEl.textContent = formatAmount(walletWmon, 'WMON');
      } catch {}
      try {
        if (poolAddr) {
          const allowance = await wmon.allowance(wallet, poolAddr);
          if (wmonAllowanceEl) wmonAllowanceEl.textContent = formatAmount(allowance, 'WMON');
        }
      } catch {}
      try {
        if (dcmonAddr) {
          const allowanceDc = await wmon.allowance(wallet, dcmonAddr);
          if (wmonAllowanceDcmonEl) wmonAllowanceDcmonEl.textContent = formatAmount(allowanceDc, 'WMON');
        }
      } catch {}
    }

    if (wallet && dcmon) {
      try {
        const walletDc = await dcmon.balanceOf(wallet);
        if (dcmonWalletEl) dcmonWalletEl.textContent = formatAmount(walletDc, 'DCMon');
      } catch {}
    }

    const isTavOwner = wallet && tavernOwner && wallet.toLowerCase() === tavernOwner.toLowerCase();
    const isFaroOwner = wallet && faroOwner && wallet.toLowerCase() === faroOwner.toLowerCase();
    const isPoolOwner = wallet && poolOwner && wallet.toLowerCase() === poolOwner.toLowerCase();

    [tavSetMaxBetBtn, tavSetPoolBtn].forEach(el => { if (el) el.classList.toggle('readonly', !isTavOwner); });
    [faroSetMaxBetBtn, faroSetFeeBtn, faroSetPoolBtn, faroPauseBtn, faroResumeBtn].forEach(el => { if (el) el.classList.toggle('readonly', !isFaroOwner); });
    [poolSetAddrBtn, poolWithdrawBtn, poolAuthorizeBtn, poolDeauthorizeBtn, poolDepositBtn, poolRedeemBtn,
      wmonWrapBtn, wmonUnwrapBtn, wmonApproveBtn, wmonApproveMaxBtn, wmonApproveDcmonBtn, wmonApproveDcmonMaxBtn,
      dcmonDepositBtn, dcmonRedeemBtn, dcmonRecordBtn].forEach(el => { if (el) el?.classList.toggle('readonly', !isPoolOwner); });

    const ownerSections = [];
    if (isTavOwner) ownerSections.push('Tavern');
    if (isFaroOwner) ownerSections.push('Faro');
    if (isPoolOwner) ownerSections.push('Pool');
    const noteEl = document.getElementById('owner-note');
    if (noteEl) {
            noteEl.textContent = ownerSections.length ? ('Owner controls enabled for ' + ownerSections.join(', ') + '.') : 'Connect the owner wallet. Controls are disabled for non-owners.';
    }

    const rtPauseBtn = document.getElementById('rt-pause');
    const rtResumeBtn = document.getElementById('rt-resume');
    const isOwner = isTavOwner || isFaroOwner || isPoolOwner;
    [rtPauseBtn, rtResumeBtn, document.getElementById('rt-restart')].forEach(el => { if (el) el?.classList.toggle('readonly', !isOwner); });

    ensureIo();
  } catch {}
}

async function connect() {
  if (!window.ethereum) { setStatus('MetaMask not detected'); return; }
  try {
    setStatus('Connecting...');
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await applyWalletFromAccounts(accounts);
    setStatus('');
  } catch (e) {
    console.error(e);
    setStatus('Connect failed');
    wallet = null;
    signer = null;
    provider = undefined;
    updateWalletButtons();
  }
}

async function disconnectWallet({ silent } = {}) {
  try {
    wallet = null;
    signer = null;
    provider = undefined;
    if (!silent) setStatus('Disconnected');
    updateWalletButtons();
    await refresh();
  } catch (e) {
    if (!silent) console.error(e);
    updateWalletButtons();
  }
}

async function applyWalletFromAccounts(accounts, { refreshAfter = true } = {}) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    await disconnectWallet({ silent: true });
    setStatus('Disconnected');
    return;
  }
  try {
    provider = new window.ethers.providers.Web3Provider(window.ethereum, 'any');
    signer = provider.getSigner();
    wallet = accounts[0];    try { if (poolToInput && !poolToInput.value) poolToInput.value = wallet; } catch (e) {}
    updateWalletButtons();
    if (refreshAfter) await refresh();
  } catch (err) {
    console.error(err);
    wallet = null;
    signer = null;
    provider = undefined;
    updateWalletButtons();
    throw err;
  }
}

async function restoreWalletIfAvailable() {
  if (!window.ethereum?.request) { updateWalletButtons(); return; }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (Array.isArray(accounts) && accounts.length) {
      await applyWalletFromAccounts(accounts);
    } else {
      wallet = null;
      signer = null;
      provider = undefined;
      setStatus('Disconnected');
      updateWalletButtons();
    }
  } catch (err) {
    console.warn('Restore wallet failed', err);
    updateWalletButtons();
  }
}

async function handleAccountsChanged(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    await disconnectWallet({ silent: true });
    setStatus('Disconnected');
    return;
  }
  await applyWalletFromAccounts(accounts);
}

async function handleEthereumDisconnect() {
  await disconnectWallet({ silent: true });
  setStatus('Disconnected');
}

function bindTopButtons() {
  if (topButtonsBound) return;
  const connectEl = document.getElementById('connect-wallet');
  const disconnectEl = document.getElementById('disconnect-wallet');
  const returnEl = document.getElementById('return');

  connectEl?.addEventListener('click', async (evt) => { evt.preventDefault(); await connect(); });
  disconnectEl?.addEventListener('click', async (evt) => { evt.preventDefault(); await disconnectWallet(); });
  returnEl?.addEventListener('click', (evt) => { evt.preventDefault(); window.location.href = '/index.html'; });
  topButtonsBound = true;
}

function registerWalletEvents() {
  if (!window.ethereum?.on || walletEventsRegistered) return;
  window.ethereum.on('accountsChanged', handleAccountsChanged);
  window.ethereum.on('disconnect', handleEthereumDisconnect);
  walletEventsRegistered = true;
}

function initWalletUi() {
  bindTopButtons();
  registerWalletEvents();
  updateWalletButtons();
  restoreWalletIfAvailable();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWalletUi, { once: true });
} else {
  initWalletUi();
}
// Whitelist removed
// Site Health: build.json, deploy marker, whoami
async function refreshHealth() {
  try {
    const buildEl = document.getElementById('health-build');
    const markerEl = document.getElementById('health-marker');
    const whoEl = document.getElementById('health-whoami');
    const tag = Date.now();

    const fetchPlain = async (url) => {
      try {
        const resp = await fetch(`${url}?now=${tag}`, { cache: 'no-store' });
        if (!resp.ok) return 'unavailable';
        const text = (await resp.text()).trim();
        const type = (resp.headers.get('content-type') || '').toLowerCase();
        if (type.includes('text/html') || text.startsWith('<')) return 'unavailable';
        return text;
      } catch {
        return 'unavailable';
      }
    };

    try {
      const r = await fetch(`/assets/build.json?now=${tag}`, { cache: 'no-store' });
      if (r.ok) {
        const b = await r.json();
        if (buildEl) buildEl.textContent = `commit=${String(b.commit || '').slice(0,12)} builtAt=${b.builtAt || ''}`;
      } else if (buildEl) {
        buildEl.textContent = 'unavailable';
      }
    } catch {
      try { if (buildEl) buildEl.textContent = 'unavailable'; } catch (e) {}
    }

    if (markerEl) markerEl.textContent = await fetchPlain('/assets/deploy_check.txt');
    if (whoEl) whoEl.textContent = await fetchPlain('/__whoami.txt');
  } catch (e) {}
}
document.getElementById('health-refresh')?.addEventListener('click', refreshHealth);
window.addEventListener('DOMContentLoaded', () => { try { refreshHealth(); } catch (e) {} });

// Set pool on Tavern (owner only)
tavSetPoolBtn?.addEventListener('click', async () => {
  try {
    if (!tavern) { setStatus('Tavern not connected'); return; }
    if (!isTavOwnerNow()) { setStatus('Owner only: Tavern'); return; }
    const target = (tavPoolInput && tavPoolInput.value && tavPoolInput.value.trim()) || (poolOverrideInput && poolOverrideInput.value && poolOverrideInput.value.trim()) || poolAddr;
    if (!target || !target.startsWith('0x') || target.length !== 42) { setStatus('Enter a valid pool address'); return; }
    const tx = await tavern.setPool(target);
    setStatus(`Setting pool... ${tx.hash.slice(0,10)}...`);
    await tx.wait();
    setStatus('Pool set on Tavern.');
    await refresh();
  } catch (e) {
    console.error(e); setStatus(e?.data?.message || e?.message || 'Set pool failed.');
  }
});

function ensureIo() {
  try {
    if (ioSocket) return;
    ioSocket = io({ path: '/socket.io/' });
    const connEl = document.getElementById('rt-conn');
    const healthEl = document.getElementById('rt-health');
    let lastHealthAt = 0;
    let healthTimer = null;
    function setConn(state){
      try {
        if (!connEl) return;
        const map = {
          connected:  { text: 'connected',   color: '#006400' },
          reconnecting: { text: 'reconnecting', color: '#b26a00' },
          disconnected: { text: 'disconnected', color: '#8b0000' },
          error: { text: 'error', color: '#8b0000' }
        };
        const m = map[state] || map.disconnected;
        connEl.textContent = m.text;
        connEl.style.color = m.color;
      } catch (e) {}
    }
    function setHealth(ok){
      try {
        if (!healthEl) return;
        const now = Date.now();
        const ago = lastHealthAt ? Math.max(0, Math.round((now - lastHealthAt)/1000)) : null;
        if (ok && lastHealthAt) {
          healthEl.textContent = ago <= 1 ? 'ok (just now)' : `ok (${ago}s ago)`;
          healthEl.style.color = '#006400';
        } else if (!lastHealthAt) {
          healthEl.textContent = 'checking...';
          healthEl.style.color = '#b26a00';
        } else {
          healthEl.textContent = `no reply (${ago}s)`;
          healthEl.style.color = '#8b0000';
        }
      } catch (e) {}
    }
    ioSocket.on('connect', async () => {
      setConn('connected');
      try { ioSocket.emit('identify', { addr: wallet }); } catch (e) {}
      // Kick off periodic health pings
      try { if (healthTimer) clearInterval(healthTimer); } catch (e) {}
      setHealth(false);
      healthTimer = setInterval(() => { try { ioSocket.emit('health'); setHealth(false); } catch (e) {} }, 15000);
    });
    ioSocket.on('reconnect_attempt', () => setConn('reconnecting'));
    ioSocket.on('reconnect', () => setConn('connected'));
    ioSocket.on('disconnect', () => setConn('disconnected'));
    ioSocket.on('connect_error', () => setConn('error'));
    ioSocket.on('health', (m) => { try { lastHealthAt = Date.now(); setHealth(true); } catch (e) {} });
    function updState(m){
      try {
        document.getElementById('rt-status').textContent = m?.paused ? 'paused' : 'running';
        if (typeof m?.rakeBps === 'number') document.getElementById('rt-rake').textContent = String(m.rakeBps);
        if (typeof m?.feesAccrued === 'number') document.getElementById('rt-fees').textContent = String(m.feesAccrued);
      } catch (e) {}
    }
    ioSocket.on('rt:state', updState);
    ioSocket.on('rt:paused', updState);

    // Presence polling (admin-only)
    const guestUniqueEl = document.getElementById('guest-unique');
    const guestOnlineEl = document.getElementById('guest-online');
    const presenceListEl = document.getElementById('presence-list');
    function renderPresence(m){
      try {
        if (!m) return;
        if (typeof m.uniqueWallets === 'number' && guestUniqueEl) guestUniqueEl.textContent = String(m.uniqueWallets);
        if (Array.isArray(m.online) && guestOnlineEl) guestOnlineEl.textContent = String(m.online.length);
        if (presenceListEl && Array.isArray(m.online)) {
          const rows = m.online.map(u => {
            const addr = u.addrMask || (u.addrHash ? u.addrHash.slice(0,10) + 'â€¦' : '-');
            const loc = u.tableId ? `${u.tableId}${(typeof u.seatId==='number')?(' #'+u.seatId):''}` : (u.path || '-');
            const ago = Math.max(0, Math.round((Date.now() - Number(u.last||0))/1000));
            return `${addr}  @ ${loc}  (${ago}s ago)`;
          });
          presenceListEl.textContent = rows.length ? rows.join('\n') : 'No users online';
        }
      } catch (e) {}
    }
    ioSocket.on('admin:presence', (m)=>renderPresence(m));
    setInterval(() => { try { ioSocket.emit('admin:presence:get'); } catch (e) {} }, 5000);
  } catch (e) {}
}

document.getElementById('rt-pause')?.addEventListener('click', ()=>{ try { if (ioSocket) ioSocket.emit('admin:pause', { paused: true }); } catch (e) {} });
document.getElementById('rt-resume')?.addEventListener('click', ()=>{ try { if (ioSocket) ioSocket.emit('admin:pause', { paused: false }); } catch (e) {} });
document.getElementById('rt-rake-set')?.addEventListener('click', ()=>{ try { const bps = parseInt(String(document.getElementById('rt-rake-input').value||'').trim(),10); if (ioSocket && bps>=0 && bps<=1000) ioSocket.emit('admin:setRake', { bps }); } catch (e) {} });
document.getElementById('rt-fees-reset')?.addEventListener('click', ()=>{ try { if (ioSocket) ioSocket.emit('admin:resetFees'); } catch (e) {} });
document.getElementById('rt-restart')?.addEventListener('click', ()=>{
  try {
    if (!ioSocket) return;
    const ok = window.confirm('Restart backend now? Players may briefly disconnect.');
    if (ok) ioSocket.emit('admin:restart');
  } catch (e) {}
});

// Actions - Tavern
tavSetMaxBetBtn?.addEventListener('click', async () => {
  try {
    if (!tavern) { setStatus('Tavern not connected'); return; }
    if (!isTavOwnerNow()) { setStatus('Owner only: Tavern'); return; }
    const val = String(tavMaxBetInput.value||'').trim();
    if (!val) return;
    if (!isTavOwnerNow()) { setStatus('Owner only: Tavern'); return; }
    const tx = await tavern.setMaxBet(window.ethers.utils.parseEther(val));
    setStatus('Tavern setMaxBet tx sent');
    await tx.wait();
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

// Actions - Faro
faroSetMaxBetBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { setStatus('Faro not connected'); return; }
    if (!isFaroOwnerNow()) { setStatus('Owner only: Faro'); return; }
    const val = String(faroMaxBetInput.value||'').trim();
    if (!val) { setStatus('Enter max bet'); return; }
    const tx = await faro.setMaxBet(window.ethers.utils.parseEther(val));
    setStatus('Faro setMaxBet tx sent');
    await tx.wait();
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

faroSetFeeBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { setStatus('Faro not connected'); return; }
    if (!isFaroOwnerNow()) { setStatus('Owner only: Faro'); return; }
    const bps = parseInt(String(faroFeeInput.value||'').trim(), 10);
    if (!(bps >= 0 && bps <= 1000)) { setStatus('feeBps 0..1000'); return; }
    const tx = await faro.setFeeBps(bps);
    setStatus('Faro setFeeBps tx sent');
    await tx.wait();
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

// Faro: setPool (owner only)
faroSetPoolBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { setStatus('Faro not connected'); return; }
    if (!isFaroOwnerNow()) { setStatus('Owner only: Faro'); return; }
    const v = String(faroPoolInput?.value||'').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) { setStatus('Enter a valid pool address'); return; }
    const tx = await faro.setPool(v);
    setStatus('Faro setPool tx sent');
    await tx.wait();
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

// Faro: pause/resume (owner only)
faroPauseBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { setStatus('Faro not connected'); return; }
    if (!isFaroOwnerNow()) { setStatus('Owner only: Faro'); return; }
    const tx = await faro.pause(true);
    setStatus('Faro pause tx sent');
    await tx.wait();
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});
faroResumeBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { setStatus('Faro not connected'); return; }
    if (!isFaroOwnerNow()) { setStatus('Owner only: Faro'); return; }
    const tx = await faro.pause(false);
    setStatus('Faro resume tx sent');
    await tx.wait();
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

window.addEventListener('load', async () => { try { await refresh(); } catch (e) {} });

// Address override handlers (persist to localStorage and refresh)
tavSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = String(tavOverrideInput.value||'').trim();
    if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) { setStatus('Enter a valid address'); return; }
    try { localStorage.setItem('contract.tavern', v); } catch (e) {}
    await refresh();
  } catch (e) {}
});
faroSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = String(faroOverrideInput.value||'').trim();
    if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) { setStatus('Enter a valid address'); return; }
    try { localStorage.setItem('contract.faro', v); } catch (e) {}
    await refresh();
  } catch (e) {}
});

// Pool address override
poolSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = String(poolOverrideInput.value||'').trim();
    if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) { setStatus('Enter a valid address'); return; }
    try { localStorage.setItem('contract.pool', v); } catch (e) {}
    await refresh();
  } catch (e) {}
});

// Pool actions
poolWithdrawBtn?.addEventListener('click', async () => {
  try {
    if (!pool || !signer) { setStatus('Pool not connected'); return; }
    const to = String(poolToInput.value || '').trim();
    const amt = parseAmount(poolAmtInput);
    if (!to) { setStatus('Enter withdraw address'); return; }
    if (!amt || amt.isZero()) { setStatus('Enter withdraw amount'); return; }
    const tx = await pool.connect(signer).withdrawUnderlying(to, amt);
    setStatus('Pool withdraw tx sent');
    await tx.wait();
    if (poolAmtInput) { poolAmtInput.value = ''; }
    setStatus('Pool withdraw confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

poolAuthorizeBtn?.addEventListener('click', async () => {
  try {
    if (!pool || !signer) { setStatus('Pool not connected'); return; }
    const addr = String(poolAuthInput.value || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setStatus('Enter a valid address'); return; }
    const tx = await pool.connect(signer).setAuthorized(addr, true);
    setStatus('Pool authorize tx sent');
    await tx.wait();
    if (poolAuthInput) { poolAuthInput.value = ''; }
    setStatus('Pool authorize confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

poolDeauthorizeBtn?.addEventListener('click', async () => {
  try {
    if (!pool || !signer) { setStatus('Pool not connected'); return; }
    const addr = String(poolAuthInput.value || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setStatus('Enter a valid address'); return; }
    const tx = await pool.connect(signer).setAuthorized(addr, false);
    setStatus('Pool deauthorize tx sent');
    await tx.wait();
    if (poolAuthInput) { poolAuthInput.value = ''; }
    setStatus('Pool deauthorize confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

poolDepositBtn?.addEventListener('click', async () => {
  try {
    if (!pool || !signer) { setStatus('Pool not connected'); return; }
    const value = parseAmount(poolDepositAmtInput);
    if (!value || value.isZero()) { setStatus('Enter deposit amount'); return; }
    const tx = await pool.connect(signer).depositUnderlying(value);
    setStatus('Pool deposit tx sent');
    await tx.wait();
    if (poolDepositAmtInput) { poolDepositAmtInput.value = ''; }
    setStatus('Pool deposit confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

poolRedeemBtn?.addEventListener('click', async () => {
  try {
    if (!pool || !signer) { setStatus('Pool not connected'); return; }
    const value = parseAmount(poolRedeemAmtInput);
    if (!value || value.isZero()) { setStatus('Enter redeem amount'); return; }
    const tx = await pool.connect(signer).redeemDcmon(value);
    setStatus('Pool redeem tx sent');
    await tx.wait();
    if (poolRedeemAmtInput) { poolRedeemAmtInput.value = ''; }
    setStatus('Pool redeem confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

wmonWrapBtn?.addEventListener('click', async () => {
  try {
    if (!wmon || !signer) { setStatus('WMON contract not connected'); return; }
    const value = parseAmount(wmonWrapAmtInput);
    if (!value || value.isZero()) { setStatus('Enter wrap amount'); return; }
    const tx = await wmon.connect(signer).deposit({ value });
    setStatus('Wrap tx sent');
    await tx.wait();
    if (wmonWrapAmtInput) { wmonWrapAmtInput.value = ''; }
    setStatus('Wrap complete');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

wmonUnwrapBtn?.addEventListener('click', async () => {
  try {
    if (!wmon || !signer) { setStatus('WMON contract not connected'); return; }
    const value = parseAmount(wmonUnwrapAmtInput);
    if (!value || value.isZero()) { setStatus('Enter unwrap amount'); return; }
    const tx = await wmon.connect(signer).withdraw(value);
    setStatus('Unwrap tx sent');
    await tx.wait();
    if (wmonUnwrapAmtInput) { wmonUnwrapAmtInput.value = ''; }
    setStatus('Unwrap complete');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

wmonApproveBtn?.addEventListener('click', async () => {
  try {
    if (!wmon || !signer || !poolAddr) { setStatus('Pool address unknown'); return; }
    const value = parseAmount(wmonApproveAmtInput);
    if (!value || value.isZero()) { setStatus('Enter approve amount'); return; }
    const tx = await wmon.connect(signer).approve(poolAddr, value);
    setStatus('WMON pool approve tx sent');
    await tx.wait();
    if (wmonApproveAmtInput) { wmonApproveAmtInput.value = ''; }
    setStatus('WMON pool approve confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

wmonApproveMaxBtn?.addEventListener('click', async () => {
  try {
    if (!wmon || !signer || !poolAddr) { setStatus('Pool address unknown'); return; }
    const tx = await wmon.connect(signer).approve(poolAddr, window.ethers.constants.MaxUint256);
    setStatus('WMON pool max approval tx sent');
    await tx.wait();
    setStatus('WMON pool max approval confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

wmonApproveDcmonBtn?.addEventListener('click', async () => {
  try {
    if (!wmon || !signer || !dcmonAddr) { setStatus('DCMon address unknown'); return; }
    const value = parseAmount(wmonApproveDcmonAmtInput);
    if (!value || value.isZero()) { setStatus('Enter approve amount'); return; }
    const tx = await wmon.connect(signer).approve(dcmonAddr, value);
    setStatus('WMON → DCMon approve tx sent');
    await tx.wait();
    if (wmonApproveDcmonAmtInput) { wmonApproveDcmonAmtInput.value = ''; }
    setStatus('WMON → DCMon approve confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

wmonApproveDcmonMaxBtn?.addEventListener('click', async () => {
  try {
    if (!wmon || !signer || !dcmonAddr) { setStatus('DCMon address unknown'); return; }
    const tx = await wmon.connect(signer).approve(dcmonAddr, window.ethers.constants.MaxUint256);
    setStatus('WMON → DCMon max approval tx sent');
    await tx.wait();
    setStatus('WMON → DCMon max approval confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

dcmonDepositBtn?.addEventListener('click', async () => {
  try {
    if (!dcmon || !signer || !wallet) { setStatus('DCMon contract not connected'); return; }
    const value = parseAmount(dcmonDepositAmtInput);
    if (!value || value.isZero()) { setStatus('Enter deposit amount'); return; }
    const tx = await dcmon.connect(signer).deposit(value, wallet);
    setStatus('DCMon deposit tx sent');
    await tx.wait();
    if (dcmonDepositAmtInput) { dcmonDepositAmtInput.value = ''; }
    setStatus('DCMon deposit confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

dcmonRedeemBtn?.addEventListener('click', async () => {
  try {
    if (!dcmon || !signer || !wallet) { setStatus('DCMon contract not connected'); return; }
    const value = parseAmount(dcmonRedeemAmtInput);
    if (!value || value.isZero()) { setStatus('Enter redeem amount'); return; }
    const tx = await dcmon.connect(signer).redeem(value, wallet);
    setStatus('DCMon redeem tx sent');
    await tx.wait();
    if (dcmonRedeemAmtInput) { dcmonRedeemAmtInput.value = ''; }
    setStatus('DCMon redeem confirmed');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});

dcmonRecordBtn?.addEventListener('click', async () => {
  try {
    if (!dcmon || !signer) { setStatus('DCMon contract not connected'); return; }
    const value = parseAmount(dcmonRewardAmtInput);
    if (!value || value.isZero()) { setStatus('Enter reward amount'); return; }
    const tx = await dcmon.connect(signer).recordRewards(value);
    setStatus('Record rewards tx sent');
    await tx.wait();
    if (dcmonRewardAmtInput) { dcmonRewardAmtInput.value = ''; }
    setStatus('Rewards recorded');
    await refresh();
  } catch (e) { setStatus(e?.data?.message || e?.message || 'Failed'); }
});
// Poker (pooled) address override
ppSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = String(ppOverrideInput?.value||'').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) { if (ppMsgEl) ppMsgEl.textContent='Enter a valid address'; return; }
    try { localStorage.setItem('contract.pokerTable', v); } catch (e) {}
    if (ppAddrEl) ppAddrEl.textContent = v; if (ppMsgEl) ppMsgEl.textContent='Poker table address set.';
    await refresh();
  } catch (e) { if (ppMsgEl) ppMsgEl.textContent = e?.data?.message||e?.message||'Failed'; }
});

// Per-game submitter UI removed: pool approval covers all games

