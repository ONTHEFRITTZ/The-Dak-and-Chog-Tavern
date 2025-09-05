import { detectChainId, getAddressFor, renderTavernBanner } from '../js/config.js';

const statusEl = document.getElementById('status');
const connectBtn = document.getElementById('connect-wallet');
const returnBtn = document.getElementById('return');

// Tavern elements
const tavAddrEl = document.getElementById('tavern-address');
const tavOwnerEl = document.getElementById('tavern-owner');
const tavBalEl = document.getElementById('tavern-balance');
const tavMaxBetInput = document.getElementById('tavern-maxbet');
const tavSetMaxBetBtn = document.getElementById('tavern-set-maxbet');
const tavToInput = document.getElementById('tavern-to');
const tavAmtInput = document.getElementById('tavern-amt');
const tavWithdrawBtn = document.getElementById('tavern-withdraw');
const tavFundAmtInput = document.getElementById('tavern-fund-amt');
const tavFundBtn = document.getElementById('tavern-fund');

// Faro elements
const faroAddrEl = document.getElementById('faro-address');
const faroOwnerEl = document.getElementById('faro-owner');
const faroBalEl = document.getElementById('faro-balance');
const faroMaxBetInput = document.getElementById('faro-maxbet');
const faroSetMaxBetBtn = document.getElementById('faro-set-maxbet');
const faroFeeInput = document.getElementById('faro-fee');
const faroSetFeeBtn = document.getElementById('faro-set-fee');
const faroToInput = document.getElementById('faro-to');
const faroAmtInput = document.getElementById('faro-amt');
const faroWithdrawBtn = document.getElementById('faro-withdraw');
const faroFeesAmtInput = document.getElementById('faro-fees-amt');
const faroWithdrawFeesBtn = document.getElementById('faro-withdraw-fees');
const faroFundAmtInput = document.getElementById('faro-fund-amt');
const faroFundBtn = document.getElementById('faro-fund');

let provider, signer, wallet;
let tavernAddr = null, faroAddr = null;
let tavern, faro;
let tavernOwner = null, faroOwner = null;
let ioSocket = null;

function fmtEth(v) {
  try { return window.ethers.utils.formatEther(v); } catch { return '0'; }
}

async function refresh() {
  try {
    const chainId = await detectChainId(provider);
    tavernAddr = await getAddressFor('tavern', provider);
    faroAddr = await getAddressFor('faro', provider);
    tavAddrEl.textContent = tavernAddr || '-';
    faroAddrEl.textContent = faroAddr || '-';
    renderTavernBanner({ contractKey: 'tavern', address: tavernAddr, chainId, wallet });

    if (tavernAddr && window.TavernABI && signer) {
      tavern = new window.ethers.Contract(tavernAddr, window.TavernABI, signer);
      try {
        tavernOwner = await tavern.owner();
        tavOwnerEl.textContent = tavernOwner;
        const bal = await provider.getBalance(tavernAddr);
        tavBalEl.textContent = fmtEth(bal) + ' ETH';
        const maxBet = await tavern.maxBet();
        tavMaxBetInput.placeholder = fmtEth(maxBet);
      } catch {}
    }
    if (faroAddr && window.FaroABI && signer) {
      faro = new window.ethers.Contract(faroAddr, window.FaroABI, signer);
      try {
        faroOwner = await faro.owner();
        faroOwnerEl.textContent = faroOwner;
        const bal = await provider.getBalance(faroAddr);
        faroBalEl.textContent = fmtEth(bal) + ' ETH';
        const maxBet = await faro.maxBet();
        faroMaxBetInput.placeholder = fmtEth(maxBet);
        const fee = await faro.feeBps();
        faroFeeInput.placeholder = String(fee);
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
    [rtPauseBtn, rtResumeBtn].forEach(el => { if (el) el.classList.toggle('readonly', !isOwner); });
    if (isOwner) ensureIo();
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
    await refresh();
  } catch (e) {
    statusEl.textContent = 'Connect failed';
  }
}

connectBtn?.addEventListener('click', connect);
returnBtn?.addEventListener('click', () => { window.location.href = '/index.html'; });

function ensureIo() {
  try {
    if (ioSocket) return;
    ioSocket = io({ path: '/socket.io' });
    ioSocket.on('connect', async () => {
      try { ioSocket.emit('identify', { addr: wallet }); } catch {}
    });
    ioSocket.on('rt:state', (m)=>{ try { document.getElementById('rt-status').textContent = m?.paused ? 'paused' : 'running'; } catch{} });
    ioSocket.on('rt:paused', (m)=>{ try { document.getElementById('rt-status').textContent = m?.paused ? 'paused' : 'running'; } catch{} });
  } catch {}
}

document.getElementById('rt-pause')?.addEventListener('click', ()=>{ try { if (ioSocket) ioSocket.emit('admin:pause', { paused: true }); } catch {} });
document.getElementById('rt-resume')?.addEventListener('click', ()=>{ try { if (ioSocket) ioSocket.emit('admin:pause', { paused: false }); } catch {} });

// Actions — Tavern
tavSetMaxBetBtn?.addEventListener('click', async () => {
  try {
    if (!tavern) return;
    const val = String(tavMaxBetInput.value||'').trim();
    if (!val) return;
    const tx = await tavern.setMaxBet(window.ethers.utils.parseEther(val));
    statusEl.textContent = 'Tavern setMaxBet tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

tavWithdrawBtn?.addEventListener('click', async () => {
  try {
    if (!tavern) return;
    const to = String(tavToInput.value||'').trim();
    const amt = String(tavAmtInput.value||'').trim();
    if (!to || !amt) return;
    const tx = await tavern.withdraw(to, window.ethers.utils.parseEther(amt));
    statusEl.textContent = 'Tavern withdraw tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

tavFundBtn?.addEventListener('click', async () => {
  try {
    if (!signer || !tavernAddr) return;
    const amt = String(tavFundAmtInput.value||'').trim();
    if (!amt) return;
    const tx = await signer.sendTransaction({ to: tavernAddr, value: window.ethers.utils.parseEther(amt) });
    statusEl.textContent = 'Tavern fund tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

// Actions — Faro
faroSetMaxBetBtn?.addEventListener('click', async () => {
  try {
    if (!faro) return;
    const val = String(faroMaxBetInput.value||'').trim();
    if (!val) return;
    const tx = await faro.setMaxBet(window.ethers.utils.parseEther(val));
    statusEl.textContent = 'Faro setMaxBet tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

faroSetFeeBtn?.addEventListener('click', async () => {
  try {
    if (!faro) return;
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
    if (!faro) return;
    const to = String(faroToInput.value||'').trim();
    const amt = String(faroAmtInput.value||'').trim();
    if (!to || !amt) return;
    const tx = await faro.withdraw(to, window.ethers.utils.parseEther(amt));
    statusEl.textContent = 'Faro withdraw tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

faroWithdrawFeesBtn?.addEventListener('click', async () => {
  try {
    if (!faro) return;
    const to = String(faroToInput.value||'').trim();
    const amt = String(faroFeesAmtInput.value||'').trim();
    if (!to || !amt) return;
    const tx = await faro.withdrawFees(to, window.ethers.utils.parseEther(amt));
    statusEl.textContent = 'Faro withdrawFees tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

faroFundBtn?.addEventListener('click', async () => {
  try {
    if (!signer || !faroAddr) return;
    const amt = String(faroFundAmtInput.value||'').trim();
    if (!amt) return;
    const tx = await signer.sendTransaction({ to: faroAddr, value: window.ethers.utils.parseEther(amt) });
    statusEl.textContent = 'Faro fund tx sent';
    await tx.wait();
    await refresh();
  } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
});

window.addEventListener('load', async () => { await refresh(); });
