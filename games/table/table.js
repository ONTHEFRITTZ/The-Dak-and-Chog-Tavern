// Multiplayer Faro client (no ESM imports; defensive bindings)
// Uses window.ethers (loaded by index.html) and Socket.IO (window.io)

// ---------- DOM refs ----------
const statusEl = document.getElementById('status');
const rulesOverlay = document.getElementById('rules-overlay');
const rulesAckBtn = document.getElementById('rules-ack');
const openRulesBtn = document.getElementById('open-rules');
const logEl = document.getElementById('log');
const tablePanel = document.getElementById('table-panel');
const centerReadout = document.getElementById('center-readout');
const seatsEls = Array.from(document.querySelectorAll('.seat'));
const returnBtn = document.getElementById('return');
const betAmtInput = document.getElementById('bet-amt');
const betCopperInput = document.getElementById('bet-copper');
const clearBetsBtn = document.getElementById('clear-bets');
const rankButtons = Array.from(document.querySelectorAll('.rank-btn'));

// Bet modal
const betModal = document.getElementById('bet-modal');
const betRowsEl = document.getElementById('bet-rows');
const betAddBtn = document.getElementById('bet-add');
const betClearBtn = document.getElementById('bet-clear');
const betCancelBtn = document.getElementById('bet-cancel');
const betConfirmBtn = document.getElementById('bet-confirm');

// ---------- State ----------
let socket;
let myAddr = null;
let onchainProvider = null;
let onchainSigner = null;
let faroAddr = null;
let currentTable = null;
let faroAck = false;

// Multi-bet state
let stagedBets = [];     // [{ rank: 1..13, amountEth: number, copper: bool }]
let myPendingBets = [];  // queued for on-chain when Ready

// ---------- Helpers ----------
function short(v){ return v && v.length>10 ? (v.slice(0,6)+'...'+v.slice(-4)) : (v||''); }
function log(msg){ try { logEl.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + (logEl.textContent||''); } catch {} }
function rankLabel(n){ return ({1:'A',11:'J',12:'Q',13:'K'}[n] || String(n)); }
function rankNumber(l){ const m={A:1,J:11,Q:12,K:13}; return m[l] || Number(l); }
function allRanks(){ return [1,2,3,4,5,6,7,8,9,10,11,12,13]; }

// Address resolution: use override only (set via localStorage)
async function resolveFaroAddress(){
  try {
    const v = (localStorage.getItem('contract.faro')||'').trim();
    faroAddr = (v && /^0x[0-9a-fA-F]{40}$/.test(v)) ? v : null;
    if (faroAddr) log(`Using Faro: ${short(faroAddr)}`);
  } catch {}
}

async function ensureIdentity(){
  try {
    if (myAddr && socket) { try { socket.emit('identify', { addr: myAddr }); } catch {} return myAddr; }
    if (window.ethereum) {
      const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      let accounts = await provider.listAccounts();
      if (!accounts || !accounts.length) {
        try { accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }); } catch {}
      }
      if (accounts && accounts.length) {
        myAddr = accounts[0];
        onchainProvider = provider;
        onchainSigner = provider.getSigner();
        try { socket?.emit('identify', { addr: myAddr }); } catch {}
        return myAddr;
      }
    }
  } catch {}
  return null;
}

// ---------- Rules overlay ----------
function bindRules(){
  try { if (rulesOverlay) rulesOverlay.style.display = 'flex'; } catch {}
  const attach = () => {
    try {
      const btn = document.getElementById('rules-ack');
      if (btn && !btn.__ackBound) {
        btn.__ackBound = true;
        btn.addEventListener('click', () => { faroAck = true; try { rulesOverlay.style.display='none'; } catch {} });
      }
      const op = document.getElementById('open-rules');
      if (op && !op.__openBound) {
        op.__openBound = true;
        op.addEventListener('click', () => { try { rulesOverlay.style.display='flex'; } catch {} });
      }
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && rulesOverlay && rulesOverlay.style.display !== 'none') { faroAck = true; rulesOverlay.style.display='none'; }
      }, { once: true });
    } catch {}
  };
  attach(); setTimeout(attach, 0); setTimeout(attach, 300);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { faroAck = false; bindRules(); });
} else { faroAck = false; bindRules(); }

// ---------- Bet modal ----------
function openBetModal(initialRank){
  try{
    const r = Number(initialRank);
    if (!stagedBets.length) {
      stagedBets = [{ rank: r, amountEth: Number(betAmtInput?.value||0.01)||0.01, copper: !!betCopperInput?.checked }];
    } else if (!stagedBets.some(b => b.rank === r)) {
      stagedBets.push({ rank: r, amountEth: Number(betAmtInput?.value||0.01)||0.01, copper: !!betCopperInput?.checked });
    }
    renderBetRows();
    if (betModal) betModal.style.display = 'flex';
  }catch(e){}
}

function renderBetRows(){
  try{
    if (!betRowsEl) return;
    betRowsEl.innerHTML = '';
    const used = new Set(stagedBets.map(b=>b.rank));
    stagedBets.forEach((b, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;';

      const sel = document.createElement('select'); sel.style.cssText='padding:4px;';
      allRanks().forEach(n => {
        const opt = document.createElement('option'); opt.value=String(n); opt.textContent=rankLabel(n);
        if (n===b.rank) opt.selected=true; else if (used.has(n)) opt.disabled=true; sel.appendChild(opt);
      });
      sel.onchange = () => {
        const nr = Number(sel.value);
        if (stagedBets.some((x,i)=> i!==idx && x.rank===nr)) { sel.value = String(b.rank); return; }
        used.delete(b.rank); b.rank = nr; used.add(nr); renderBetRows();
      };

      const amt = document.createElement('input'); amt.type='number'; amt.min='0.001'; amt.step='0.001'; amt.value=String(b.amountEth);
      amt.style.cssText='width:110px; text-align:center;';
      amt.oninput = () => { const v = Number(amt.value||0); b.amountEth = v>0 ? v : b.amountEth; };

      const lab = document.createElement('label'); lab.style.cssText='font-size:13px; display:flex; align-items:center; gap:4px;';
      const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=!!b.copper; cb.onchange=()=>{ b.copper = !!cb.checked; };
      lab.appendChild(cb); lab.appendChild(document.createTextNode('Copper'));

      const del = document.createElement('button'); del.textContent='Remove'; del.className='btn danger'; del.style.cssText='padding:4px 8px; border-radius:6px;';
      del.onclick = () => { stagedBets.splice(idx,1); renderBetRows(); };

      row.appendChild(sel);
      row.appendChild(document.createTextNode('Amount (MON):'));
      row.appendChild(amt);
      row.appendChild(lab);
      if (stagedBets.length>1) row.appendChild(del);
      betRowsEl.appendChild(row);
    });
    if (betConfirmBtn) betConfirmBtn.textContent = stagedBets.length>1 ? 'Confirm bets' : 'Confirm bet';
  }catch(e){}
}

betAddBtn?.addEventListener('click', () => {
  try {
    const used = new Set(stagedBets.map(b=>b.rank));
    const next = allRanks().find(n => !used.has(n));
    if (next) { stagedBets.push({ rank: next, amountEth: Number(betAmtInput?.value||0.01)||0.01, copper: false }); renderBetRows(); }
  } catch{}
});
betClearBtn?.addEventListener('click', () => { try { stagedBets = []; myPendingBets = []; socket?.emit('clear_bets'); if (betModal) betModal.style.display='none'; } catch{} });
betCancelBtn?.addEventListener('click', () => { try { stagedBets = []; if (betModal) betModal.style.display='none'; } catch{} });
betConfirmBtn?.addEventListener('click', async () => {
  try {
    const seen = new Set();
    for (const b of stagedBets) { if (!b || !(b.rank>=1&&b.rank<=13) || !(Number(b.amountEth)>0) || seen.has(b.rank)) { log('Invalid bet selection'); return; } seen.add(b.rank); }
    try { await ensureIdentity(); } catch {}
    socket?.emit('clear_bets');
    stagedBets.forEach(b => {
      const chips = Math.max(1, Math.floor(Number(b.amountEth)*100));
      socket?.emit('place_bet', { rank: b.rank, amount: chips, copper: !!b.copper });
    });
    myPendingBets = stagedBets.map(b => ({ rank: b.rank, amountEth: Number(b.amountEth), copper: !!b.copper }));
    stagedBets = [];
    if (betModal) betModal.style.display='none';
  } catch{}
});

// Replace rank click with modal
rankButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const rnum = rankNumber(btn.dataset.rank);
    if (!(rnum>=1 && rnum<=13)) return;
    if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; }
    openBetModal(rnum);
  });
});

// ---------- Rendering ----------
function renderTable(table){
  currentTable = table;
  try { tablePanel.style.display = (table?.started ? 'block' : 'none'); } catch {}
  try { centerReadout.textContent = ''; } catch {}
  for (const el of seatsEls) {
    const idx = Number(el.dataset.index);
    const s = table?.seats?.[idx] || null;
    el.classList.toggle('ready', !!s?.ready);
    el.innerHTML = '';
    if (!s) continue;
    const a = document.createElement('div'); a.className = 'addr'; a.textContent = short(s.addr||s.id); el.appendChild(a);
    const bal = document.createElement('div'); bal.className = 'bal'; bal.textContent = `Bal: ${Number(s.balance||0)}`; el.appendChild(bal);
    try { const total = Number(s.betTotal||0); if (total>0) { const chip=document.createElement('div'); chip.className='chip'; chip.textContent=String(total); el.appendChild(chip); } } catch{}
    // my seat controls
    try {
      const me = (s.addr && myAddr && s.addr.toLowerCase() === myAddr.toLowerCase());
      if (me) {
        const btns = document.createElement('div'); btns.className='btns';
        const vacate = document.createElement('button'); vacate.textContent='Leave'; vacate.onclick=()=> socket?.emit('seat',{ index:-1 });
        const readyBtn = document.createElement('button'); readyBtn.textContent = s.ready ? 'Unready' : 'Ready';
        readyBtn.onclick = async () => {
          try {
            const willReady = !s.ready;
            if (willReady && Array.isArray(myPendingBets) && myPendingBets.length) {
              for (const b of myPendingBets) {
                try { await placeOnchainBet(b.rank, b.amountEth, !!b.copper); } catch(e){ log('Tx failed: ' + (e?.data?.message || e?.message || 'unknown')); }
              }
              myPendingBets = [];
            }
          } catch{}
          socket?.emit('ready', { ready: !s.ready });
        };
        btns.appendChild(vacate); btns.appendChild(readyBtn); el.appendChild(btns);
      }
    } catch{}
    // countdown badge placeholder
    try { let cd = el.querySelector('.countdown'); if (!cd){ cd=document.createElement('div'); cd.className='countdown'; cd.style.cssText='position:absolute; top:-10px; left:-10px; background:#8b0000; color:#fff; font-size:12px; padding:2px 6px; border-radius:999px; display:none;'; el.appendChild(cd);} } catch{}
  }
}

const INACTIVITY_MS = 90_000; const SHOW_WINDOW_MS = 30_000;
function updateCountdowns(){
  try {
    if (!currentTable || !currentTable.started) return;
    const seats = Array.isArray(currentTable.seats) ? currentTable.seats : [];
    seatsEls.forEach((el) => {
      try { const idx = Number(el.dataset.index); const s = seats[idx]; const cd = el.querySelector('.countdown'); if (!s||!cd) { if (cd) cd.style.display='none'; return; } if (s.ready){ cd.style.display='none'; return; } const last=Number(s.lastActive||0); if(!last){ cd.style.display='none'; return; } const rem = INACTIVITY_MS - (Date.now()-last); if (rem<=0) { cd.style.display='none'; return;} if (rem<=SHOW_WINDOW_MS) { cd.textContent = `${Math.ceil(rem/1000)}s`; cd.style.display='inline-block'; } else { cd.style.display='none'; } } catch{}
    });
  } catch{}
}
setInterval(updateCountdowns, 1000);

// ---------- Socket connection ----------
async function ensureIo(){ if (window.io) return true; await new Promise((resolve)=>{ const s=document.createElement('script'); s.src='https://cdn.socket.io/4.7.5/socket.io.min.js'; s.onload=resolve; s.onerror=resolve; document.head.appendChild(s); }); return true; }

async function connect(){
  await ensureIo();
  socket = io(window.location.origin, { path:'/socket.io', transports:['websocket','polling'], reconnection:true, reconnectionAttempts:10, reconnectionDelay:800 });
  socket.on('connect', () => {
    log('Connected to server');
    if (myAddr) socket.emit('identify', { addr: myAddr }); else { try { ensureIdentity(); } catch {} }
    let tableId=null; try { const u=new URL(window.location.href); tableId=u.searchParams.get('table'); } catch{}
    if (!tableId) tableId='faro-1';
    try { socket.emit('join_table', { table: tableId }); } catch{}
    try { const x = localStorage.getItem('profile.public.x'); if (x) socket.emit('profile_public', { x }); } catch{}
  });
  socket.on('table:update', (table)=>{ renderTable(table); try { const active = (table.seats||[]).filter(Boolean); const allReady = active.length && active.every(s=>!!s.ready); if (!allReady) { const me = active.find(s=> s.addr && myAddr && s.addr.toLowerCase()===myAddr.toLowerCase()); const myBetPlaced = !!(me && Number(me.betTotal||0)>0); centerReadout.textContent = me && !me.ready ? (myBetPlaced ? 'Click Ready to lock your bet' : 'Place your bet') : 'Waiting for players to Ready...'; } else { centerReadout.textContent = 'All players ready'; } } catch{} });
  socket.on('table:started', (table)=>{ log('Game started!'); try { tablePanel.style.display='block'; centerReadout.textContent='Place your bet'; } catch{} renderTable(table); });
  socket.on('table:coup', (m)=>{ const bank = Number(m.bankRank); const player = Number(m.playerRank); const name = (r)=>({1:'A',11:'J',12:'Q',13:'K'}[r]||String(r)); log(`Coup: bank=${bank}(${name(bank)}), player=${player}(${name(player)})${m.doublet?' (doublet)':''}`); const winners = Array.isArray(m.results)?m.results.filter(r=>Number(r.delta||0)>0).map(r=>short(String(r.addr||''))):[]; try { const label = `Bank ${name(bank)} vs Player ${name(player)}${m.doublet?' (doublet)':''}`; const who = winners.length?` Winners: ${winners.join(', ')}`:''; centerReadout.textContent = label + who; } catch{} renderTable(m.table); });
  socket.on('disconnect', ()=>{ log('Disconnected. Reconnecting in 2s...'); setTimeout(connect, 2000); });
}

// ---------- Misc UI ----------
clearBetsBtn?.addEventListener('click', () => { try { socket?.emit('clear_bets'); } catch{} });
returnBtn?.addEventListener('click', () => { window.location.href='/index.html'; });

// Resolve wallet/contract and connect
(async()=>{
  try { if (window.ethereum) { const provider = new ethers.providers.Web3Provider(window.ethereum, 'any'); const acc = await provider.listAccounts(); if (acc && acc.length) { myAddr = acc[0]; onchainProvider = provider; onchainSigner = provider.getSigner(); } } } catch {}
  await resolveFaroAddress();
  await connect();
})();

// ---------- On-chain bet helper ----------
async function placeOnchainBet(rankNum, ethAmount, copper){
  try {
    if (!onchainSigner) { log('Connect wallet first'); return; }
    if (!faroAddr) { log('Faro address missing. Set it via localStorage.setItem(\'contract.faro\',\'0x...\') then reload.'); return; }
    // Ensure ABI present
    if (!window.FaroV3ABI && !window.FaroABI) {
      const candidates = ['/js/FaroV3ABI.js','/js/FaroABI.js','../../js/FaroV3ABI.js','../../js/FaroABI.js'];
      for (const src of candidates) { await new Promise((resolve)=>{ const s=document.createElement('script'); s.src=src; s.onload=resolve; s.onerror=resolve; document.head.appendChild(s); }); if (window.FaroV3ABI || window.FaroABI) break; }
    }
    const abi = window.FaroV3ABI || window.FaroABI; if (!abi) { log('Faro ABI not loaded'); return; }
    const ethersRef = window.ethers; const c = new ethersRef.Contract(faroAddr, abi, onchainSigner);
    const tx = window.FaroV3ABI ? await c.playFaro(rankNum, !!copper, { value: ethersRef.utils.parseEther(String(ethAmount)) }) : await c.playFaro(rankNum, { value: ethersRef.utils.parseEther(String(ethAmount)) });
    log(`Tx sent: ${tx.hash.slice(0,10)}… waiting…`);
    const rc = await tx.wait();
    try { const ev = rc.events?.find(e => e.event === 'FaroPlayed'); if (ev && ev.args) { const win=!!ev.args.win; const push=!!ev.args.push; const bank=Number(ev.args.bankRank); const player=Number(ev.args.playerRank); log(push?`Push. bank=${bank}, player=${player}`:(win?`You won! bank=${bank}, player=${player}`:`You lost. bank=${bank}, player=${player}`)); } else { log('Confirmed on-chain.'); } } catch{}
  } catch(e){ log(e?.data?.message || e?.message || 'Transaction failed'); }
}

