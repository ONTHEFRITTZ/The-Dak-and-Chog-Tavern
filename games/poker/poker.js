const statusEl = document.getElementById('status');
const lobbyEl = document.getElementById('lobby');
const connectBtn = document.getElementById('connect-wallet');
const tableEl = document.getElementById('table');
let socket; let myAddr = null;

function setStatus(t){ try { statusEl.textContent = t; } catch {} }

function renderLobby(list){
  try {
    const items = Array.isArray(list)? list : [];
    lobbyEl.innerHTML = '';
    // Resume last table CTA (if available)
    try {
      const last = localStorage.getItem('poker.lastTable');
      if (last) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px; margin-bottom:10px; border:2px dashed #7800cd; border-radius:10px; background:rgba(255,244,233,0.8);';
        const label = document.createElement('div'); label.textContent = 'Resume last table: ' + last; label.style.fontWeight = '700'; label.style.color = '#2b1e12';
        const open = document.createElement('button'); open.textContent = 'Open'; open.onclick = () => {
          try {
            const u = new URL(window.location.href);
            u.pathname = '/games/poker/table.html';
            u.searchParams.set('table', last);
            window.location.href = u.toString();
          } catch {
            window.location.href = '/games/poker/table.html?table=' + encodeURIComponent(last);
          }
        };
        const clear = document.createElement('button'); clear.textContent = 'Clear'; clear.onclick = () => { try { localStorage.removeItem('poker.lastTable'); localStorage.removeItem('poker.lastVisitAt'); wrap.remove(); } catch(_){} };
        const btns = document.createElement('div'); btns.style.display='flex'; btns.style.gap='8px'; btns.appendChild(open); btns.appendChild(clear);
        wrap.appendChild(label); wrap.appendChild(btns);
        lobbyEl.appendChild(wrap);
      }
    } catch(_) {}
    items.forEach(row => {
      const card = document.createElement('div'); card.className='lobby-item';
      const left = document.createElement('div'); left.textContent = `${row.id} - Players ${row.seated}/${row.capacity}`;
      const btn = document.createElement('button'); btn.textContent = 'Open Table';
      btn.onclick = () => {
        try {
          const u = new URL(window.location.href);
          u.pathname = '/games/poker/table.html';
          u.searchParams.set('table', row.id);
          window.location.href = u.toString();
        } catch {
          window.location.href = `/games/poker/table.html?table=${encodeURIComponent(row.id)}`;
        }
      };
      card.appendChild(left); card.appendChild(btn);
      lobbyEl.appendChild(card);
    });
    if (!items.length) lobbyEl.textContent = 'No poker tables yet.';
  } catch {}
}

function short(a){ try { return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); } catch { return a||''; } }

function renderTable(t){
  try {
    if (!t || t.id !== currentTableId) return;
    tableEl.innerHTML = '';
    const title = document.createElement('div'); title.style.marginBottom='8px'; title.textContent = `Table ${t.id}`; tableEl.appendChild(title);
    const grid = document.createElement('div'); grid.style.cssText='display:grid; grid-template-columns: repeat(3, minmax(120px,1fr)); gap:10px;';
    const seats = Array.isArray(t.seats) ? t.seats : [];
    for (let i=0;i<6;i++){
      const panel = document.createElement('div'); panel.style.cssText='border:1px solid #7800cd; border-radius:8px; padding:8px; background:rgba(255,255,255,0.6);';
      const s = seats[i];
      const label = document.createElement('div'); label.textContent = `Seat ${i}`; panel.appendChild(label);
      const info = document.createElement('div'); info.style.fontSize='12px'; info.style.margin='6px 0';
      if (s) { info.textContent = short(s.addr||s.id); panel.appendChild(info);
        if (myAddr && s.addr && String(s.addr).toLowerCase()===String(myAddr).toLowerCase()){
          const btnLeave = document.createElement('button'); btnLeave.textContent='Leave'; btnLeave.onclick=()=> socket.emit('seat',{ index:-1 }); panel.appendChild(btnLeave);
          const btnReady = document.createElement('button'); btnReady.style.marginLeft='6px'; btnReady.textContent = s.ready? 'Unready':'Ready'; btnReady.onclick=()=> socket.emit('ready',{ ready: !s.ready }); panel.appendChild(btnReady);
        }
      } else {
        info.textContent = 'Empty'; panel.appendChild(info);
        const btnSit = document.createElement('button'); btnSit.textContent='Sit';
        if (!myAddr) { btnSit.disabled=true; btnSit.title='Connect wallet to sit'; }
        btnSit.onclick=()=>{ if (!myAddr) return; socket.emit('seat',{ index:i }); };
        panel.appendChild(btnSit);
      }
      grid.appendChild(panel);
    }
    tableEl.appendChild(grid);
  } catch {}
}

async function connect(){
  try {
    socket = io(window.location.origin, {
      path: '/poker.io/',
      transports: ['polling','websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
      forceNew: true
    });
  } catch (e) {
    setStatus('Socket.IO not available');
    return;
  }
  socket.on('connect', () => { setStatus('Connected'); if (myAddr) { try { socket.emit('identify', { addr: myAddr }); } catch {} } try { socket.emit('lobby:get'); } catch {} });
  socket.on('connect_error', (err) => { setStatus('Lobby unavailable. Retrying...'); try { console.error('connect_error', err && err.message); } catch {} });
  socket.on('reconnect_error', () => { setStatus('Reconnecting...'); });
  socket.on('disconnect', () => setStatus('Disconnected'));
  socket.on('lobby:list', (list) => renderLobby(list));
  // No in-lobby seat rendering; seating happens on table.html
  socket.on('system', (m) => { /* noop */ });
}

connect();

// Wallet connect (isolated): gate seating until wallet connected
connectBtn?.addEventListener('click', async () => {
  try {
    if (!window.ethereum || !window.ethers) { setStatus('No wallet provider found'); return; }
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    const provider = new window.ethers.providers.Web3Provider(window.ethereum, 'any');
    const signer = provider.getSigner();
    const addr = await signer.getAddress();
    myAddr = String(addr||'').toLowerCase();
    setStatus(`Wallet: ${short(myAddr)}`);
    try { if (socket && socket.connected) socket.emit('identify', { addr: myAddr }); } catch {}
    // Re-render table to enable Sit buttons
    try { if (currentTableId) socket.emit('lobby:get'); if (currentTableId) try { socket.emit('join_table', { table: currentTableId }); } catch {} } catch {}
  } catch (e) {
    setStatus('Wallet connect failed');
  }
});
