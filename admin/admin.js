import { detectChainId, getAddressFor } from '../js/config.js';\nconst ALLOWED_OWNER = '0x8ba35eca0fe68787b275c6ed065675829843adf5';

const statusEl = document.getElementById('status');

// Pool-only UI (Tavern/Faro cards are deprecated/hidden in index.html)
const poolAddrEl = document.getElementById('pool-address');
const poolOwnerEl = document.getElementById('pool-owner');
const poolBalEl = document.getElementById('pool-balance');
const poolAuthListEl = document.getElementById('pool-auth-list');

const poolFundAmtInput = document.getElementById('pool-fund-amt');
const poolFundBtn = document.getElementById('pool-fund');
const poolToInput = document.getElementById('pool-to');
const poolAmtInput = document.getElementById('pool-amt');
const poolWithdrawBtn = document.getElementById('pool-withdraw');
const poolAuthInput = document.getElementById('pool-auth');
const poolAuthorizeBtn = document.getElementById('pool-authorize');
const poolDeauthorizeBtn = document.getElementById('pool-deauthorize');

let provider, signer, wallet;
let poolAddr = null, pool = null, poolOwner = null;

function short(a){ try { return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); } catch { return a||''; } }
function fmtEth(v){ try { return window.ethers.utils.formatEther(v); } catch { return '0'; } }

function setConnected(addr){
  const connectEl = document.getElementById('connect-wallet');
  const disconnectEl = document.getElementById('disconnect-wallet');
  try {
    if (connectEl) connectEl.style.display = addr ? 'none' : '';
    if (disconnectEl) disconnectEl.style.display = addr ? '' : 'none';
    if (statusEl) statusEl.textContent = addr ? ('Connected: ' + short(addr)) : 'Disconnected';
  } catch {}
}

async function ensureWallet(){
  if (!window.ethereum || !window.ethers) throw new Error('MetaMask not detected');
  provider = new window.ethers.providers.Web3Provider(window.ethereum, 'any');
  signer = provider.getSigner();

  // Try silent first, then proactively request to avoid false "disconnected"
  let accounts = [];
  try { accounts = await window.ethereum.request({ method: 'eth_accounts' }); } catch {}
  if (!Array.isArray(accounts) || accounts.length === 0) {
    try { accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }); } catch {}
  }
  if (accounts && accounts[0]) {
    wallet = String(accounts[0]);
    setConnected(wallet);
    return true;
  }
  setConnected(null);
  return false;
}

async function isOwnerWallet(){ try { return ((wallet||'').toLowerCase() === '0x8ba35eca0fe68787b275c6ed065675829843adf5'); } catch { return false; } } } catch {}
    try { const fa = await getAddressFor("faro", provider); if (fa && window.FaroABI) { const c=new window.ethers.Contract(fa, window.FaroABI, provider); pairs.push(await c.owner()); } } catch {}
    try { const ha = await getAddressFor("hazard", provider); if (ha && window.HazardABI) { const c=new window.ethers.Contract(ha, window.HazardABI, provider); if (c.owner) pairs.push(await c.owner()); } } catch {}
    try { const sa = await getAddressFor("shell", provider); if (sa && window.ShellABI) { const c=new window.ethers.Contract(sa, window.ShellABI, provider); if (c.owner) pairs.push(await c.owner()); } } catch {}
    const owners = pairs.filter(Boolean).map(a=>String(a).toLowerCase());
    return owners.includes(me);
  } catch { return false; }
}

async function loadPool(){
  try {
    await detectChainId(provider); // forces detection; UI stays readable regardless of network
    poolAddr = await getAddressFor('pool', provider);
    if (poolAddrEl) poolAddrEl.textContent = poolAddr || '-';
    if (!poolAddr || !window.PoolABI) return;

    pool = new window.ethers.Contract(poolAddr, window.PoolABI, signer);
    try { poolOwner = await pool.owner(); if (poolOwnerEl) poolOwnerEl.textContent = poolOwner; } catch {}
    try { const bal = await pool.balance(); if (poolBalEl) poolBalEl.textContent = fmtEth(bal) + ' MON'; } catch {}
    await renderAuthList();
  } catch (e) {
    console.error('loadPool failed', e);
  }
}

async function renderAuthList(){
  if (!pool || !poolAuthListEl) return;
  const labels = [
    ['Hazard','hazard'],
    ['Shell','shell'],
    ['DakChog','dakchog'],
    ['Faro','faro'],
    ['Poker','pokerTable'],
  ];
  const rows = [];
  for (const [label,key] of labels){
    try {
      const addr = await getAddressFor(key, provider);
      if (!addr) continue;
      let ok=false; try { ok = await pool.authorizedGames(addr); } catch {}
      rows.push({ label, addr, ok });
    } catch {}
  }
  if (!rows.length) { poolAuthListEl.textContent = 'No known games found for this chain.'; return; }

  poolAuthListEl.innerHTML = rows.map(e => {
    const badge = e.ok ? '[OK]' : '[--]';
    return `<div style="display:flex; align-items:center; gap:8px; margin:2px 0;">
      <span style="min-width:46px; color:${e.ok?'#00a000':'#a00000'}; font-weight:700;">${badge}</span>
      <span style="min-width:80px; display:inline-block;">${e.label}</span>
      <span>${short(e.addr)}</span>
      <button class="btn" data-act="toggle-auth" data-addr="${e.addr}" data-ok="${e.ok}" style="margin-left:auto;">${e.ok?'Deauthorize':'Authorize'}</button>
    </div>`;
  }).join('');

  Array.from(poolAuthListEl.querySelectorAll('button[data-act="toggle-auth"]')).forEach(btn => {
    btn.onclick = async () => {
      try {
        const addr = btn.getAttribute('data-addr');
        const okNow = btn.getAttribute('data-ok') === 'true';
        const isOwner = wallet && poolOwner && wallet.toLowerCase() === String(poolOwner).toLowerCase();
        if (!isOwner) { statusEl.textContent = 'Pool owner only'; return; }
        const tx = await pool.setAuthorized(addr, !okNow);
        statusEl.textContent = (!okNow?'Authorize':'Deauthorize') + ' tx sent';
        await tx.wait();
        await loadPool();
      } catch (e) { statusEl.textContent = e?.data?.message || e?.message || 'Failed'; }
    };
  });
}

function bindControls(){
  const c = document.getElementById('connect-wallet');
  const d = document.getElementById('disconnect-wallet');
  const r = document.getElementById('return');
  if (c) c.addEventListener('click', async (e)=>{ e.preventDefault(); await ensureWallet(); await loadPool(); });
  if (d) d.addEventListener('click', async (e)=>{ e.preventDefault(); wallet=null; signer=null; provider=null; setConnected(null); });
  if (r) r.addEventListener('click', (e)=>{ e.preventDefault(); window.location.href='/index.html'; });

  poolFundBtn?.addEventListener('click', async ()=>{
    try{ if(!poolAddr) return; const amt=String(poolFundAmtInput?.value||'').trim(); if(!amt) return;
      const tx = await signer.sendTransaction({ to: poolAddr, value: window.ethers.utils.parseEther(amt) });
      statusEl.textContent='Pool fund tx sent'; await tx.wait(); await loadPool();
    }catch(e){ statusEl.textContent = e?.data?.message||e?.message||'Failed'; }
  });
  poolWithdrawBtn?.addEventListener('click', async ()=>{
    try{ if(!pool) return; const to=String(poolToInput?.value||'').trim(); const amt=String(poolAmtInput?.value||'').trim();
      if(!to||!amt) return; const tx = await pool.withdraw(to, window.ethers.utils.parseEther(amt));
      statusEl.textContent='Pool withdraw tx sent'; await tx.wait(); await loadPool();
    }catch(e){ statusEl.textContent = e?.data?.message||e?.message||'Failed'; }
  });
  poolAuthorizeBtn?.addEventListener('click', async ()=>{
    try{ if(!pool) return; const addr=String(poolAuthInput?.value||'').trim(); if(!addr) return;
      const tx = await pool.setAuthorized(addr, true); statusEl.textContent='Authorize tx sent'; await tx.wait(); await loadPool();
    }catch(e){ statusEl.textContent = e?.data?.message||e?.message||'Failed'; }
  });
  poolDeauthorizeBtn?.addEventListener('click', async ()=>{
    try{ if(!pool) return; const addr=String(poolAuthInput?.value||'').trim(); if(!addr) return;
      const tx = await pool.setAuthorized(addr, false); statusEl.textContent='Deauthorize tx sent'; await tx.wait(); await loadPool();
    }catch(e){ statusEl.textContent = e?.data?.message||e?.message||'Failed'; }
  });
}

function registerWalletEvents(){
  try{
    if (!window.ethereum?.on) return;
    window.ethereum.on('accountsChanged', async (acc)=>{ try{ if(acc && acc[0]){ wallet=String(acc[0]); setConnected(wallet); await loadPool(); } else { wallet=null; setConnected(null); } }catch{} });
    window.ethereum.on('chainChanged', async ()=>{ try{ await ensureWallet(); await loadPool(); }catch{} });
    window.ethereum.on('disconnect', ()=>{ wallet=null; setConnected(null); });
  }catch{}
}

async function boot(){
  bindControls(); registerWalletEvents();
  try { await ensureWallet(); } catch {}
  try { const ok = await isOwnerWallet(); if (!ok) { statusEl.textContent = "Restricted: owner only"; setTimeout(()=>{ try{ location.replace("/index.html"); }catch{} }, 300); return; } } catch {}
  try { await loadPool(); } catch {}
  try { Array.from(document.querySelectorAll('.btn')).forEach(el => el.classList.remove('readonly')); } catch {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
