import { detectChainId, getAddressFor, renderTavernBanner } from '../js/config.js';

const statusEl = document.getElementById('status');
const connectBtn = document.getElementById('connect-wallet');
const returnBtn = document.getElementById('return');

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
const tavToInput = document.getElementById('tavern-to');
const tavAmtInput = document.getElementById('tavern-amt');
const tavWithdrawBtn = document.getElementById('tavern-withdraw');
const tavFundAmtInput = document.getElementById('tavern-fund-amt');
const tavFundBtn = document.getElementById('tavern-fund');

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
const faroToInput = document.getElementById('faro-to');
const faroAmtInput = document.getElementById('faro-amt');
const faroWithdrawBtn = document.getElementById('faro-withdraw');
const faroFeesAmtInput = document.getElementById('faro-fees-amt');
const faroWithdrawFeesBtn = document.getElementById('faro-withdraw-fees');
const faroFundAmtInput = document.getElementById('faro-fund-amt');
const faroFundBtn = document.getElementById('faro-fund');

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

// Whitelist elements
const wlAddrEl = document.getElementById('wl-address');
const wlOverrideInput = document.getElementById('wl-override');
const wlSetAddrBtn = document.getElementById('wl-set-addr');
const wlOneInput = document.getElementById('wl-one');
const wlAddBtn = document.getElementById('wl-add');
const wlRemoveBtn = document.getElementById('wl-remove');
const wlBulkInput = document.getElementById('wl-bulk');
const wlBulkAddBtn = document.getElementById('wl-bulk-add');
const wlBulkRemoveBtn = document.getElementById('wl-bulk-remove');
const wlMsgEl = document.getElementById('wl-msg');

let provider, signer, wallet;
let tavernAddr = null, faroAddr = null, poolAddr = null;
let whitelistAddr = null;
let tavern, faro, pool;
let tavernOwner = null, faroOwner = null;
let ioSocket = null;

function fmtEth(v) {
  try { return window.ethers.utils.formatEther(v); } catch { return '0'; }
}

function isTavOwnerNow() {
  try { return !!(wallet && tavernOwner && wallet.toLowerCase() === tavernOwner.toLowerCase()); } catch { return false; }
}
function isFaroOwnerNow() {
  try { return !!(wallet && faroOwner && wallet.toLowerCase() === faroOwner.toLowerCase()); } catch { return false; }
}

async function refresh() {
  try {
    const chainId = await detectChainId(provider);
    tavernAddr = await getAddressFor('tavern', provider);
    faroAddr = await getAddressFor('faro', provider);
    poolAddr = await getAddressFor('pool', provider);
    whitelistAddr = await getAddressFor('whitelist', provider);
    tavAddrEl.textContent = tavernAddr || '-';
    faroAddrEl.textContent = faroAddr || '-';
    if (poolAddrEl) poolAddrEl.textContent = poolAddr || '-';
    if (wlAddrEl) wlAddrEl.textContent = whitelistAddr || '(not set)';
    if (tavOverrideInput) tavOverrideInput.placeholder = tavernAddr || '';
    if (faroOverrideInput) faroOverrideInput.placeholder = faroAddr || '';
    if (poolOverrideInput) poolOverrideInput.placeholder = poolAddr || '';
    if (wlOverrideInput) wlOverrideInput.placeholder = whitelistAddr || '';
    renderTavernBanner({ contractKey: 'tavern', address: tavernAddr, chainId, wallet });

    if (tavernAddr && window.TavernABI && signer) {
      tavern = new window.ethers.Contract(tavernAddr, window.TavernABI, signer);
      try {
        tavernOwner = await tavern.owner();
        tavOwnerEl.textContent = tavernOwner;
        const bal = await provider.getBalance(tavernAddr);
        tavBalEl.textContent = fmtEth(bal) + ' MON';
        const maxBet = await tavern.maxBet();
        tavMaxBetInput.placeholder = fmtEth(maxBet);
        try { const tp = await tavern.pool(); if (tavPoolEl) tavPoolEl.textContent = tp || '-'; } catch { if (tavPoolEl) tavPoolEl.textContent = '(not pooled)'; }
        try { tavAmtInput.placeholder = fmtEth(bal); } catch {}
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
        faroOwnerEl.textContent = faroOwner;
        const bal = await provider.getBalance(faroAddr);
        faroBalEl.textContent = fmtEth(bal) + ' MON';
        const maxBet = await faro.maxBet();
        faroMaxBetInput.placeholder = fmtEth(maxBet);
        const fee = await faro.feeBps();
        faroFeeInput.placeholder = String(fee);
        try { const feesAcc = await faro.feesAccrued(); if (faroFeesEl) faroFeesEl.textContent = fmtEth(feesAcc) + ' MON'; } catch {}
        try { faroAmtInput.placeholder = fmtEth(bal); } catch {}
        try { const feesAcc = await faro.feesAccrued(); faroFeesAmtInput.placeholder = fmtEth(feesAcc); } catch {}
        if (faroOwnerMatchEl) {
          const match = isFaroOwnerNow();
          faroOwnerMatchEl.textContent = match ? 'Yes' : 'No';
          try { faroOwnerMatchEl.style.color = match ? '#006400' : '#8b0000'; } catch {}
        }
      } catch {}
    }

    if (poolAddr && window.PoolABI && signer) {
      pool = new window.ethers.Contract(poolAddr, window.PoolABI, signer);
      try {
        const pOwner = await pool.owner();
        if (poolOwnerEl) poolOwnerEl.textContent = pOwner;
        const pBal = await pool.balance();
        if (poolBalEl) poolBalEl.textContent = fmtEth(pBal) + ' MON';
        try { if (poolAmtInput) poolAmtInput.placeholder = fmtEth(pBal); } catch {}
      } catch {}
    }

    const isTavOwner = wallet && tavernOwner && wallet.toLowerCase() === tavernOwner.toLowerCase();
    const isFaroOwner = wallet && faroOwner && wallet.toLowerCase() === faroOwner.toLowerCase();
    
    // Enable/disable owner-only controls
    [tavSetMaxBetBtn, tavWithdrawBtn, tavFundBtn].forEach(el => { if (el) el.classList.toggle('readonly', !isTavOwner); });
    [faroSetMaxBetBtn, faroSetFeeBtn, faroWithdrawBtn, faroWithdrawFeesBtn, faroFundBtn].forEach(el => { if (el) el.classList.toggle('readonly', !isFaroOwner); });
    document.getElementById('owner-note').textContent = (isTavOwner || isFaroOwner) ? 'Owner controls enabled.' : 'Connect the owner wallet. Controls are disabled for non-owners.';

    // Realtime controls rely on Tavern owner
    const rtPauseBtn = document.getElementById('rt-pause');
    const rtResumeBtn = document.getElementById('rt-resume');
    const isOwner = (isTavOwner || isFaroOwner);
    [rtPauseBtn, rtResumeBtn, document.getElementById('rt-restart')].forEach(el => { if (el) el.classList.toggle('readonly', !isOwner); });
    // Always show realtime connection/health, even for non-owners
    ensureIo();
  } catch {}
}

async function connect() {
  if (!window.ethereum) { statusEl.textContent = 'MetaMask not detected'; return; }
  try {
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    provider = new window.ethers.providers.Web3Provider(window.ethereum, 'any');
    signer = provider.getSigner();
    wallet = await signer.getAddress();
    statusEl.textContent = 'Connected: ' + wallet;
    try { if (tavToInput && !tavToInput.value) tavToInput.value = wallet; } catch {}
    try { if (faroToInput && !faroToInput.value) faroToInput.value = wallet; } catch {}
    try { if (poolToInput && !poolToInput.value) poolToInput.value = wallet; } catch {}
    await refresh();
  } catch (e) {
    statusEl.textContent = 'Connect failed';
  }
}

connectBtn?.addEventListener('click', connect);
returnBtn?.addEventListener('click', () => { window.location.href = '/index.html'; });

// Whitelist handlers (owner only)
wlSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = (wlOverrideInput?.value||'').trim();
    if (!v || v.length !== 42 || !v.startsWith('0x')) { wlMsgEl.textContent = 'Enter a valid address'; return; }
    try { localStorage.setItem('contract.whitelist', v); } catch {}
    whitelistAddr = v; if (wlAddrEl) wlAddrEl.textContent = v;
    wlMsgEl.textContent = 'Whitelist address set (local override).';
  } catch { wlMsgEl.textContent = 'Failed to set override.'; }
});

function parseBulk(addrs){
  return String(addrs||'')
    .split(/[,\n\r\t ]+/)
    .map(s=>s.trim()).filter(s=>/^0x[0-9a-fA-F]{40}$/.test(s));
}

async function wlContract(){
  if (!whitelistAddr || !window.WhitelistABI || !signer) throw new Error('Whitelist address/ABI missing or wallet not connected');
  return new window.ethers.Contract(whitelistAddr, window.WhitelistABI, signer);
}

wlAddBtn?.addEventListener('click', async () => {
  try { const c = await wlContract(); const a=(wlOneInput?.value||'').trim(); if(!/^0x[0-9a-fA-F]{40}$/.test(a)){ wlMsgEl.textContent='Bad address'; return; }
    const tx = await c.add(a); wlMsgEl.textContent = `Adding... ${tx.hash.slice(0,10)}...`; await tx.wait(); wlMsgEl.textContent='Added.'; } catch(e){ wlMsgEl.textContent = e?.data?.message||e?.message||'Failed'; }
});
wlRemoveBtn?.addEventListener('click', async () => {
  try { const c = await wlContract(); const a=(wlOneInput?.value||'').trim(); if(!/^0x[0-9a-fA-F]{40}$/.test(a)){ wlMsgEl.textContent='Bad address'; return; }
    const tx = await c.remove(a); wlMsgEl.textContent = `Removing... ${tx.hash.slice(0,10)}...`; await tx.wait(); wlMsgEl.textContent='Removed.'; } catch(e){ wlMsgEl.textContent = e?.data?.message||e?.message||'Failed'; }
});
wlBulkAddBtn?.addEventListener('click', async () => {
  try { const c = await wlContract(); const list=parseBulk(wlBulkInput?.value); if(!list.length){ wlMsgEl.textContent='No valid addresses'; return; }
    const tx = await c.addMany(list); wlMsgEl.textContent = `Bulk add... ${tx.hash.slice(0,10)}...`; await tx.wait(); wlMsgEl.textContent='Bulk added.'; } catch(e){ wlMsgEl.textContent=e?.data?.message||e?.message||'Failed'; }
});
wlBulkRemoveBtn?.addEventListener('click', async () => {
  try { const c = await wlContract(); const list=parseBulk(wlBulkInput?.value); if(!list.length){ wlMsgEl.textContent='No valid addresses'; return; }
    const tx = await c.removeMany(list); wlMsgEl.textContent = `Bulk remove... ${tx.hash.slice(0,10)}...`; await tx.wait(); wlMsgEl.textContent='Bulk removed.'; } catch(e){ wlMsgEl.textContent=e?.data?.message||e?.message||'Failed'; }
});
// Site Health: build.json, deploy marker, whoami
async function refreshHealth() {
  try {
    const buildEl = document.getElementById('health-build');
    const markerEl = document.getElementById('health-marker');
    const whoEl = document.getElementById('health-whoami');
    const tag = Date.now();
    // Build metadata
    try {
      const r = await fetch('/assets/build.json?now=' + tag, { cache: 'no-store' });
      if (r.ok) { const b = await r.json(); buildEl.textContent = `commit=${String(b.commit||'').slice(0,12)} builtAt=${b.builtAt||''}`; }
      else { buildEl.textContent = 'unavailable'; }
    } catch { try { document.getElementById('health-build').textContent = 'unavailable'; } catch {} }
    // Deploy marker
    try {
      const r = await fetch('/assets/deploy_check.txt?now=' + tag, { cache: 'no-store' });
      markerEl.textContent = r.ok ? (await r.text()).trim() : 'unavailable';
    } catch { try { document.getElementById('health-marker').textContent = 'unavailable'; } catch {} }
    // WhoAmI
    try {
      const r = await fetch('/__whoami.txt?now=' + tag, { cache: 'no-store' });
      whoEl.textContent = r.ok ? (await r.text()).trim() : 'unavailable';
    } catch { try { document.getElementById('health-whoami').textContent = 'unavailable'; } catch {} }
  } catch {}
}
document.getElementById('health-refresh')?.addEventListener('click', refreshHealth);
window.addEventListener('DOMContentLoaded', () => { try { refreshHealth(); } catch {} });

// Set pool on Tavern (owner only)
tavSetPoolBtn?.addEventListener('click', async () => {
  try {
    if (!tavern) return;
    const target = (tavPoolInput && tavPoolInput.value && tavPoolInput.value.trim()) || (poolOverrideInput && poolOverrideInput.value && poolOverrideInput.value.trim()) || poolAddr;
    if (!target || !target.startsWith('0x') || target.length !== 42) { alert('Enter a valid pool address'); return; }
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
      } catch {}
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
      } catch {}
    }
    ioSocket.on('connect', async () => {
      setConn('connected');
      try { ioSocket.emit('identify', { addr: wallet }); } catch {}
      // Kick off periodic health pings
      try { if (healthTimer) clearInterval(healthTimer); } catch {}
      setHealth(false);
      healthTimer = setInterval(() => { try { ioSocket.emit('health'); setHealth(false); } catch {} }, 15000);
    });
    ioSocket.on('reconnect_attempt', () => setConn('reconnecting'));
    ioSocket.on('reconnect', () => setConn('connected'));
    ioSocket.on('disconnect', () => setConn('disconnected'));
    ioSocket.on('connect_error', () => setConn('error'));
    ioSocket.on('health', (m) => { try { lastHealthAt = Date.now(); setHealth(true); } catch {} });
    function updState(m){
      try {
        document.getElementById('rt-status').textContent = m?.paused ? 'paused' : 'running';
        if (typeof m?.rakeBps === 'number') document.getElementById('rt-rake').textContent = String(m.rakeBps);
        if (typeof m?.feesAccrued === 'number') document.getElementById('rt-fees').textContent = String(m.feesAccrued);
      } catch{}
    }
    ioSocket.on('rt:state', updState);
    ioSocket.on('rt:paused', updState);
  } catch {}
}

document.getElementById('rt-pause')?.addEventListener('click', ()=>{ try { if (ioSocket) ioSocket.emit('admin:pause', { paused: true }); } catch {} });
document.getElementById('rt-resume')?.addEventListener('click', ()=>{ try { if (ioSocket) ioSocket.emit('admin:pause', { paused: false }); } catch {} });
document.getElementById('rt-rake-set')?.addEventListener('click', ()=>{ try { const bps = parseInt(String(document.getElementById('rt-rake-input').value||'').trim(),10); if (ioSocket && bps>=0 && bps<=1000) ioSocket.emit('admin:setRake', { bps }); } catch {} });
document.getElementById('rt-fees-reset')?.addEventListener('click', ()=>{ try { if (ioSocket) ioSocket.emit('admin:resetFees'); } catch {} });
document.getElementById('rt-restart')?.addEventListener('click', ()=>{
  try {
    if (!ioSocket) return;
    const ok = window.confirm('Restart backend now? Players may briefly disconnect.');
    if (ok) ioSocket.emit('admin:restart');
  } catch {}
});

// Actions — Tavern
tavSetMaxBetBtn?.addEventListener('click', async () => {
  try {
    if (!tavern) return;
    const val = String(tavMaxBetInput.value||'').trim();
    if (!val) return;
    if (!isTavOwnerNow()) { statusEl.textContent = 'Owner only: Tavern'; return; }
    const tx = await tavern.setMaxBet(window.ethers.utils.parseEther(val));
    statusEl.textContent = 'Tavern setMaxBet tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

tavWithdrawBtn?.addEventListener('click', async () => {
  try {
    if (!tavern) { statusEl.textContent = 'Tavern not connected'; return; }
    if (!isTavOwnerNow()) { statusEl.textContent = 'Owner only: Tavern'; return; }
    const to = String(tavToInput.value||'').trim();
    const amt = String(tavAmtInput.value||'').trim();
    if (!to) { statusEl.textContent = 'Enter withdraw address'; return; }
    if (!amt) { statusEl.textContent = 'Enter amount'; return; }
    const tx = await tavern.withdraw(to, window.ethers.utils.parseEther(amt));
    statusEl.textContent = 'Tavern withdraw tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

tavFundBtn?.addEventListener('click', async () => {
  try {
    if (!signer || !tavernAddr) { statusEl.textContent = 'Tavern not connected'; return; }
    const amt = String(tavFundAmtInput.value||'').trim();
    if (!amt) { statusEl.textContent = 'Enter fund amount'; return; }
    const tx = await signer.sendTransaction({ to: tavernAddr, value: window.ethers.utils.parseEther(amt) });
    statusEl.textContent = 'Tavern fund tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

// Actions — Faro
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

faroWithdrawBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { statusEl.textContent = 'Faro not connected'; return; }
    if (!isFaroOwnerNow()) { statusEl.textContent = 'Owner only: Faro'; return; }
    const to = String(faroToInput.value||'').trim();
    const amt = String(faroAmtInput.value||'').trim();
    if (!to) { statusEl.textContent = 'Enter withdraw address'; return; }
    if (!amt) { statusEl.textContent = 'Enter amount'; return; }
    const tx = await faro.withdraw(to, window.ethers.utils.parseEther(amt));
    statusEl.textContent = 'Faro withdraw tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

faroWithdrawFeesBtn?.addEventListener('click', async () => {
  try {
    if (!faro) { statusEl.textContent = 'Faro not connected'; return; }
    if (!isFaroOwnerNow()) { statusEl.textContent = 'Owner only: Faro'; return; }
    const to = String(faroToInput.value||'').trim();
    const amt = String(faroFeesAmtInput.value||'').trim();
    if (!to) { statusEl.textContent = 'Enter withdraw address'; return; }
    if (!amt) { statusEl.textContent = 'Enter amount'; return; }
    const tx = await faro.withdrawFees(to, window.ethers.utils.parseEther(amt));
    statusEl.textContent = 'Faro withdrawFees tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

faroFundBtn?.addEventListener('click', async () => {
  try {
    if (!signer || !faroAddr) { statusEl.textContent = 'Faro not connected'; return; }
    const amt = String(faroFundAmtInput.value||'').trim();
    if (!amt) { statusEl.textContent = 'Enter fund amount'; return; }
    const tx = await signer.sendTransaction({ to: faroAddr, value: window.ethers.utils.parseEther(amt) });
    statusEl.textContent = 'Faro fund tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

window.addEventListener('load', async () => { await refresh(); });

// Address override handlers (persist to localStorage and refresh)
tavSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = String(tavOverrideInput.value||'').trim();
    if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) { statusEl.textContent = 'Enter a valid address'; return; }
    try { localStorage.setItem('contract.tavern', v); } catch {}
    await refresh();
  } catch {}
});
faroSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = String(faroOverrideInput.value||'').trim();
    if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) { statusEl.textContent = 'Enter a valid address'; return; }
    try { localStorage.setItem('contract.faro', v); } catch {}
    await refresh();
  } catch {}
});

// Pool address override
poolSetAddrBtn?.addEventListener('click', async () => {
  try {
    const v = String(poolOverrideInput.value||'').trim();
    if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) { statusEl.textContent = 'Enter a valid address'; return; }
    try { localStorage.setItem('contract.pool', v); } catch {}
    await refresh();
  } catch {}
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
