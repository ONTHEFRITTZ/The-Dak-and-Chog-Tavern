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
const poolFundAmtInput = document.getElementById('pool-fund-amt');
const poolFundBtn = document.getElementById('pool-fund');
const poolToInput = document.getElementById('pool-to');
const poolAmtInput = document.getElementById('pool-amt');
const poolWithdrawBtn = document.getElementById('pool-withdraw');
const poolAuthInput = document.getElementById('pool-auth');
const poolAuthorizeBtn = document.getElementById('pool-authorize');
const poolDeauthorizeBtn = document.getElementById('pool-deauthorize');
const poolAuthListEl = document.getElementById('pool-auth-list');


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
let tavernAddr = null, faroAddr = null, poolAddr = null;
// Whitelist removed
let tavern, faro, pool;
let tavernOwner = null, faroOwner = null;
let ioSocket = null;
let pokerPooledAddr = null; let pokerPooled = null;

function fmtEth(v) {
  try { return window.ethers.utils.formatEther(v); } catch { return '0'; }
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
    tavernAddr = await getAddressFor('tavern', provider);
    faroAddr = await getAddressFor('faro', provider);
    poolAddr = await getAddressFor('pool', provider);
    try { pokerPooledAddr = await getAddressFor('pokerTable', provider); } catch { try { pokerPooledAddr = localStorage.getItem('contract.pokerTable') || ''; } catch { pokerPooledAddr = ''; } }
if (tavAddrEl) tavAddrEl.textContent = tavernAddr || '-';
if (faroAddrEl) faroAddrEl.textContent = faroAddr || '-';
    if (poolAddrEl) poolAddrEl.textContent = poolAddr || '-';
    if (ppAddrEl) ppAddrEl.textContent = pokerPooledAddr || '(set below)';
    if (tavOverrideInput) tavOverrideInput.placeholder = tavernAddr || '';
    if (faroOverrideInput) faroOverrideInput.placeholder = faroAddr || '';
    if (poolOverrideInput) poolOverrideInput.placeholder = poolAddr || '';
    if (ppOverrideInput) ppOverrideInput.placeholder = pokerPooledAddr || '';
    renderTavernBanner({ contractKey: 'tavern', address: tavernAddr, chainId, wallet });
    
      try { const wb = document.getElementById('wallet-banner'); if (wb) wb.remove(); } catch (e) {}
      try { const nb = document.getElementById('nb-disconnect'); if (nb) nb.remove(); } catch (e) {}

    if (tavernAddr && window.TavernABI && signer) {
      tavern = new window.ethers.Contract(tavernAddr, window.TavernABI, signer);
      try {
        tavernOwner = await tavern.owner();
        if (tavOwnerEl) tavOwnerEl.textContent = tavernOwner;
        const bal = await provider.getBalance(tavernAddr);
        if (tavBalEl) tavBalEl.textContent = fmtEth(bal) + ' MON';
        const maxBet = await tavern.maxBet();
        if (tavMaxBetInput) tavMaxBetInput.placeholder = fmtEth(maxBet);
        try { const tp = await tavern.pool(); if (tavPoolEl) tavPoolEl.textContent = tp || '-'; } catch { if (tavPoolEl) tavPoolEl.textContent = '(not pooled)'; }
        if (tavOwnerMatchEl) {
          const match = isTavOwnerNow();
          tavOwnerMatchEl.textContent = match ? 'Yes' : 'No';
          try { tavOwnerMatchEl.style.color = match ? '#006400' : '#8b0000'; } catch (e) {}
    }
    // Bind PokerTablePool if available
    try {
      if (pokerPooledAddr && window.PokerTablePoolABI && signer) {
        pokerPooled = new window.ethers.Contract(pokerPooledAddr, window.PokerTablePoolABI, signer);
      } else { pokerPooled = null; }
    } catch { pokerPooled = null; }
  } catch (e) {}
}
    if (faroAddr && window.FaroABI && signer) {
      faro = new window.ethers.Contract(faroAddr, window.FaroABI, signer);
      try {
        faroOwner = await faro.owner();
        if (faroOwnerEl) faroOwnerEl.textContent = faroOwner;
        const bal = await provider.getBalance(faroAddr);
        if (faroBalEl) faroBalEl.textContent = fmtEth(bal) + ' MON';
        const maxBet = await faro.maxBet();
        if (faroMaxBetInput) faroMaxBetInput.placeholder = fmtEth(maxBet);
        const fee = await faro.feeBps();
        if (faroFeeInput) faroFeeInput.placeholder = String(fee);
        try { const feesAcc = await faro.feesAccrued(); if (faroFeesEl) faroFeesEl.textContent = fmtEth(feesAcc) + ' MON'; } catch (e) {}
        try { const p = await faro.pool(); if (faroPoolEl) faroPoolEl.textContent = p; } catch { if (faroPoolEl) faroPoolEl.textContent = '(n/a)'; }
        if (faroOwnerMatchEl) {
          const match = isFaroOwnerNow();
          faroOwnerMatchEl.textContent = match ? 'Yes' : 'No';
          try { faroOwnerMatchEl.style.color = match ? '#006400' : '#8b0000'; } catch (e) {}
        }
      } catch (e) {}
    }

    if (poolAddr && window.PoolABI && (signer || provider)) {
      const rw = signer || provider;
      pool = new window.ethers.Contract(poolAddr, window.PoolABI, rw);
      try {
        const pOwner = await pool.owner();
        if (poolOwnerEl) poolOwnerEl.textContent = pOwner;
        const pBal = await pool.balance();
        if (poolBalEl) poolBalEl.textContent = fmtEth(pBal) + ' MON';
        try { if (poolAmtInput) poolAmtInput.placeholder = fmtEth(pBal); } catch (e) {}

        // Render authorized games list (Hazard, Shell, DakChog, Faro, Poker)
        try {
          if (poolAuthListEl) {
            const entries = [];
            const chainIdNow = await detectChainId(provider);
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
              if (!addr) { try { addr = localStorage.getItem(`contract.${key}`)||''; } catch {}
              }
              if (!addr) continue;
              let allowed = null;
              try { allowed = await pool.authorizedGames(addr); } catch {}
              const short = (v) => (v && v.length > 10 ? `${v.slice(0,6)}...${v.slice(-4)}` : (v||'-'));
              const color = allowed ? '#006400' : '#8b0000';
              const status = allowed === null ? 'unknown' : (allowed ? 'AUTHORIZED' : 'not authorized');
              entries.push(`<div><strong>${label}</strong>: <span title="${addr}">${short(addr)}</span> — <span style="color:${color}">${status}</span></div>`);
            }
            poolAuthListEl.innerHTML = entries.length ? entries.join('') : '<div>(no known games on this chain)</div>';
          }
        } catch (e) {}
      } catch (e) {}
    }

    const isTavOwner = wallet && tavernOwner && wallet.toLowerCase() === tavernOwner.toLowerCase();
    const isFaroOwner = wallet && faroOwner && wallet.toLowerCase() === faroOwner.toLowerCase();
    
    // Enable/disable owner-only controls
    [tavSetMaxBetBtn, tavSetPoolBtn].forEach(el => { if (el) el.classList.toggle('readonly', !isTavOwner); });
    [faroSetMaxBetBtn, faroSetFeeBtn, faroSetPoolBtn, faroPauseBtn, faroResumeBtn].forEach(el => { if (el) el.classList.toggle('readonly', !isFaroOwner); });
    document.getElementById('owner-note').textContent = (isTavOwner || isFaroOwner) ? 'Owner controls enabled.' : 'Connect the owner wallet. Controls are disabled for non-owners.';

  // Realtime controls rely on Tavern owner
  const rtPauseBtn = document.getElementById('rt-pause');
  const rtResumeBtn = document.getElementById('rt-resume');
  const isOwner = (isTavOwner || isFaroOwner);
  [rtPauseBtn, rtResumeBtn, document.getElementById('rt-restart')].forEach(el => { if (el) el.classList.toggle('readonly', !isOwner); });
  // Always show realtime connection/health, even for non-owners
  ensureIo();
  } catch (e) {}
}

// (MGID registration UI removed per request)

async function connect() {
  if (!window.ethereum) { statusEl.textContent = 'MetaMask not detected'; return; }
  try {
    statusEl.textContent = 'Connecting...';
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await applyWalletFromAccounts(accounts);
    statusEl.textContent = '';
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Connect failed';
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
    if (!silent) statusEl.textContent = 'Disconnected';
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
    statusEl.textContent = 'Disconnected';
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
      statusEl.textContent = 'Disconnected';
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
    statusEl.textContent = 'Disconnected';
    return;
  }
  await applyWalletFromAccounts(accounts);
}

async function handleEthereumDisconnect() {
  await disconnectWallet({ silent: true });
  statusEl.textContent = 'Disconnected';
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
    if (!tavern) { statusEl.textContent = 'Tavern not connected'; return; }
    if (!isTavOwnerNow()) { statusEl.textContent = 'Owner only: Tavern'; return; }
    const target = (tavPoolInput && tavPoolInput.value && tavPoolInput.value.trim()) || (poolOverrideInput && poolOverrideInput.value && poolOverrideInput.value.trim()) || poolAddr;
    if (!target || !target.startsWith('0x') || target.length !== 42) { statusEl.textContent = 'Enter a valid pool address'; return; }
    const tx = await tavern.setPool(target);
    statusEl.textContent = `Setting pool... ${tx.hash.slice(0,10)}...`;
    await tx.wait();
    statusEl.textContent = 'Pool set on Tavern.';
    await refresh();
  } catch (e) {
    console.error(e); statusEl.textContent = e?.data?.message || e?.message || 'Set pool failed.';
  }
});

function ensureIo() {
  try {
    if (ioSocket) return;
    ioSocket = io({ path: '/socket.io' });
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
            const addr = u.addrMask || (u.addrHash ? u.addrHash.slice(0,10)+'â€¦' : '-');
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
    if (!tavern) { statusEl.textContent = 'Tavern not connected'; return; }
    if (!isTavOwnerNow()) { statusEl.textContent = 'Owner only: Tavern'; return; }
    const val = String(tavMaxBetInput.value||'').trim();
    if (!val) return;
    if (!isTavOwnerNow()) { statusEl.textContent = 'Owner only: Tavern'; return; }
    const tx = await tavern.setMaxBet(window.ethers.utils.parseEther(val));
    statusEl.textContent = 'Tavern setMaxBet tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

// Actions - Faro
faroSetMaxBetBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { statusEl.textContent = 'Faro not connected'; return; }
    if (!isFaroOwnerNow()) { statusEl.textContent = 'Owner only: Faro'; return; }
    const val = String(faroMaxBetInput.value||'').trim();
    if (!val) { statusEl.textContent = 'Enter max bet'; return; }
    const tx = await faro.setMaxBet(window.ethers.utils.parseEther(val));
    statusEl.textContent = 'Faro setMaxBet tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

faroSetFeeBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { statusEl.textContent = 'Faro not connected'; return; }
    if (!isFaroOwnerNow()) { statusEl.textContent = 'Owner only: Faro'; return; }
    const bps = parseInt(String(faroFeeInput.value||'').trim(), 10);
    if (!(bps >= 0 && bps <= 1000)) { statusEl.textContent = 'feeBps 0..1000'; return; }
    const tx = await faro.setFeeBps(bps);
    statusEl.textContent = 'Faro setFeeBps tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

// Faro: setPool (owner only)
faroSetPoolBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { statusEl.textContent = 'Faro not connected'; return; }
    if (!isFaroOwnerNow()) { statusEl.textContent = 'Owner only: Faro'; return; }
    const v = String(faroPoolInput?.value||'').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) { statusEl.textContent = 'Enter a valid pool address'; return; }
    const tx = await faro.setPool(v);
    statusEl.textContent = 'Faro setPool tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

// Faro: pause/resume (owner only)
faroPauseBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { statusEl.textContent = 'Faro not connected'; return; }
    if (!isFaroOwnerNow()) { statusEl.textContent = 'Owner only: Faro'; return; }
    const tx = await faro.pause(true);
    statusEl.textContent = 'Faro pause tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});
faroResumeBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { statusEl.textContent = 'Faro not connected'; return; }
    if (!isFaroOwnerNow()) { statusEl.textContent = 'Owner only: Faro'; return; }
    const tx = await faro.pause(false);
    statusEl.textContent = 'Faro resume tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

window.addEventListener('load', async () => {
  // Ensure Live Users section stays at the absolute bottom of the admin content
  try {
    const grid = document.querySelector('.tavern .grid');
    const presenceCard = document.getElementById('presence-card');
    if (grid && presenceCard && presenceCard.parentElement !== grid) {
      grid.appendChild(presenceCard);
    }
    // Stretch full width within the column grid
    try { if (presenceCard) presenceCard.style.alignSelf = 'stretch'; } catch {}
  } catch (e) {}
  await refresh();
});

// Address override handlers (persist to localStorage and refresh)
tavSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = String(tavOverrideInput.value||'').trim();
    if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) { statusEl.textContent = 'Enter a valid address'; return; }
    try { localStorage.setItem('contract.tavern', v); } catch (e) {}
    await refresh();
  } catch (e) {}
});
faroSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = String(faroOverrideInput.value||'').trim();
    if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) { statusEl.textContent = 'Enter a valid address'; return; }
    try { localStorage.setItem('contract.faro', v); } catch (e) {}
    await refresh();
  } catch (e) {}
});

// Pool address override
poolSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = String(poolOverrideInput.value||'').trim();
    if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) { statusEl.textContent = 'Enter a valid address'; return; }
    try { localStorage.setItem('contract.pool', v); } catch (e) {}
    await refresh();
  } catch (e) {}
});

// Pool actions
poolFundBtn?.addEventListener('click', async () => {
  try {
    if (!signer || !poolAddr) { statusEl.textContent = 'Pool not connected'; return; }
    const amt = String(poolFundAmtInput.value||'').trim();
    if (!amt) { statusEl.textContent = 'Enter fund amount'; return; }
    const tx = await signer.sendTransaction({ to: poolAddr, value: window.ethers.utils.parseEther(amt) });
    statusEl.textContent = 'Pool fund tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

poolWithdrawBtn?.addEventListener('click', async () => {
  try {
    if (!pool) { statusEl.textContent = 'Pool not connected'; return; }
    const to = String(poolToInput.value||'').trim();
    const amt = String(poolAmtInput.value||'').trim();
    if (!to) { statusEl.textContent = 'Enter withdraw address'; return; }
    if (!amt) { statusEl.textContent = 'Enter amount'; return; }
    const tx = await pool.withdraw(to, window.ethers.utils.parseEther(amt));
    statusEl.textContent = 'Pool withdraw tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

poolAuthorizeBtn?.addEventListener('click', async () => {
  try {
    if (!pool) { statusEl.textContent = 'Pool not connected'; return; }
    const addr = String(poolAuthInput.value||'').trim();
    if (!addr) { statusEl.textContent = 'Enter game address'; return; }
    const tx = await pool.setAuthorized(addr, true);
    statusEl.textContent = 'Pool authorize tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

poolDeauthorizeBtn?.addEventListener('click', async () => {
  try {
    if (!pool) { statusEl.textContent = 'Pool not connected'; return; }
    const addr = String(poolAuthInput.value||'').trim();
    if (!addr) { statusEl.textContent = 'Enter game address'; return; }
    const tx = await pool.setAuthorized(addr, false);
    statusEl.textContent = 'Pool deauthorize tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
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
