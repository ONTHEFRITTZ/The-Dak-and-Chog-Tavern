// Minimal Poker client (Beta): seats + state + basic actions
const statusEl = document.getElementById('status');
const centerEl = document.getElementById('center');
const actionsEl = document.getElementById('actions');
const btnFold = document.getElementById('btn-fold');
const btnCheckCall = document.getElementById('btn-check-call');
const seatsEls = Array.from(document.querySelectorAll('.seat'));
const returnBtn = document.getElementById('return');
let socket; let myAddr = null; let mySeatId = null; let currentTableId = null;

returnBtn?.addEventListener('click', () => { window.location.href = '/index.html'; });

function short(v){ return v && v.length>10 ? (v.slice(0,6)+'...'+v.slice(-4)) : (v||''); }

function renderTable(table){
  try {
    for (const el of seatsEls) {
      const idx = Number(el.dataset.index);
      const s = table?.seats?.[idx] || null;
      el.classList.toggle('ready', !!s?.ready);
      el.innerHTML = '';
      if (!s) {
        const a = document.createElement('div'); a.className='addr'; a.textContent='Empty'; el.appendChild(a);
        const btns = document.createElement('div'); btns.className='btns';
        const sit = document.createElement('button'); sit.textContent = 'Sit';
        sit.onclick = () => { try { socket?.emit('seat', { index: idx }); } catch {} };
        btns.appendChild(sit); el.appendChild(btns);
        continue;
      }
      const a = document.createElement('div'); a.className='addr'; a.textContent = short(s.addr||s.id); el.appendChild(a);
      if (s.addr && myAddr && s.addr.toLowerCase()===String(myAddr).toLowerCase()) {
        mySeatId = s.id;
        const btns = document.createElement('div'); btns.className='btns';
        const leave = document.createElement('button'); leave.textContent='Leave'; leave.onclick=()=> socket?.emit('seat',{ index: -1 });
        const ready = document.createElement('button'); ready.textContent = s.ready ? 'Unready' : 'Ready'; ready.onclick=()=> socket?.emit('ready', { ready: !s.ready });
        btns.appendChild(leave); btns.appendChild(ready); el.appendChild(btns);
      }
    }
  } catch {}
}

function renderPokerState(state){
  try {
    if (!state) return;
    const board = Array.isArray(state.community) ? state.community.join(' ') : '';
    const stage = String(state.stage||'').toUpperCase();
    const turn = state.turnAddr ? short(state.turnAddr) : '—';
    centerEl.textContent = `Stage: ${stage} | Pot: ${state.pot||0} | Turn: ${turn} | Board: ${board}`;
    const myTurn = myAddr && state.turnAddr && String(myAddr).toLowerCase() === String(state.turnAddr).toLowerCase();
    if (actionsEl) {
      actionsEl.style.display = myTurn ? 'flex' : 'none';
      if (myTurn) {
        let me = null;
        try { me = (state.actors||[]).find(a => a && a.addr && String(a.addr).toLowerCase()===String(myAddr).toLowerCase()); } catch {}
        const toCall = Number(state.toCall||0);
        const contrib = Number(me?.contrib||0);
        const need = Math.max(0, toCall - contrib);
        btnCheckCall.textContent = need > 0 ? `Call (${need})` : 'Check';
      }
    }
  } catch {}
}

async function ensureIo(){ if (window.io) return; await new Promise((resolve)=>{ const s=document.createElement('script'); s.src='https://cdn.socket.io/4.7.5/socket.io.min.js'; s.onload=resolve; s.onerror=resolve; document.head.appendChild(s); }); }

async function connect(){
  await ensureIo();
  socket = io(window.location.origin, { path: '/socket.io', transports:['websocket','polling'], reconnection:true, reconnectionAttempts:10, reconnectionDelay:800 });
  socket.on('connect', ()=>{
    try { const u=new URL(window.location.href); currentTableId=u.searchParams.get('table')||'poker-1'; } catch { currentTableId='poker-1'; }
    try { socket.emit('join_table', { table: currentTableId }); } catch {}
  });
  socket.on('table:update', (table)=>{ if (table?.id===currentTableId) renderTable(table); });
  socket.on('poker:state', (m)=>{ try { if (m?.table?.id===currentTableId) { renderTable(m.table); renderPokerState(m); } } catch {} });
  socket.on('poker:hand', (m)=>{
    try {
      if (m?.table?.id !== currentTableId) return;
      renderTable(m.table);
      const winners = Array.isArray(m.winners)? m.winners.map(w=> short(w.addr||'')) : [];
      const cards = Array.isArray(m.community)? m.community.join(' ') : '';
      centerEl.textContent = `Board: ${cards}${winners.length? ' — Winners: '+winners.join(', ') : ''}`;
    } catch {}
  });
}

(async()=>{ try { if (window.ethereum){ const provider=new ethers.providers.Web3Provider(window.ethereum,'any'); const acc=await provider.listAccounts(); if(acc&&acc.length) myAddr=acc[0]; } } catch {} await connect(); })();

// Wire action buttons
btnFold?.addEventListener('click', () => { try { socket?.emit('poker:act', { action: 'fold' }); if (actionsEl) actionsEl.style.display='none'; } catch {} });
btnCheckCall?.addEventListener('click', () => { try {
  const label = (btnCheckCall?.textContent||'').toLowerCase();
  const isCall = label.includes('call');
  socket?.emit('poker:act', { action: isCall ? 'call' : 'check' });
  if (actionsEl) actionsEl.style.display='none';
} catch {} });

