// =================== Poker Lobby (grouped sections) ===================

const statusEl   = document.getElementById('status');
const addrPill   = document.getElementById('wb-addr');
const btnConnect = document.getElementById('connect-wallet');

const listLimit  = document.getElementById('list-onchain-limit');
const listNL     = document.getElementById('list-onchain-nl');
const listOff    = document.getElementById('list-offchain');

const noteLimit  = document.getElementById('oclim-note');
const noteNL     = document.getElementById('ocnl-note');
const noteOff    = document.getElementById('off-note');

let socket = null;
let myAddr = null;

// ---- utils
function lc(x){ return String(x||'').toLowerCase(); }
function short(a){ return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }
function setStatus(t){ if (statusEl) statusEl.textContent = t; }

function setWallet(addr){
  myAddr = addr ? lc(addr) : null;
  if (addrPill) addrPill.textContent = myAddr ? short(myAddr) : '—';
  try { localStorage.setItem('walletConnected', myAddr ? 'true' : 'false'); } catch {}
  try { sessionStorage.setItem('walletConnected', myAddr ? 'true' : 'false'); } catch {}
  try { localStorage.setItem('walletAddress', myAddr||''); } catch {}
  try { sessionStorage.setItem('walletAddress', myAddr||''); } catch {}
  if (myAddr && socket?.connected) {
    try { socket.emit('identify', { addr: myAddr }); } catch {}
  }
}

// ---- wallet integration (listen to global events from tavern.js)
window.addEventListener('wallet:connected', (e) => {
  const addr = e?.detail?.address || e?.detail?.addr || '';
  setWallet(addr);
});

btnConnect?.addEventListener('click', async () => {
  try {
    const injected = window.phantom?.ethereum || window.ethereum || window.__walletProvider;
    if (!injected || !window.ethers){ setStatus('No wallet provider found'); return; }
    await injected.request?.({ method: 'eth_requestAccounts' });
    const [addr] = await injected.request?.({ method: 'eth_accounts' }) || [];
    setWallet(addr || '');
  } catch (e) {
    console.warn('wallet connect failed', e);
    setStatus('Wallet connect failed');
  }
});

// ---- socket
function initSocket(){
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
    console.error('Socket init error', e);
    return;
  }

  socket.on('connect', () => {
    setStatus('Connected');
    if (myAddr) { try { socket.emit('identify', { addr: myAddr }); } catch {} }
    try { socket.emit('lobby:get_full'); } catch {}
  });

  socket.on('connect_error', (err) => { setStatus('Lobby unavailable. Retrying...'); console.warn('connect_error', err?.message || err); });
  socket.on('reconnect_error', () => { setStatus('Reconnecting...'); });
  socket.on('disconnect', () => setStatus('Disconnected'));

  // New grouped payload
  socket.on('lobby:full', (payload) => {
    try { renderLobbyGrouped(payload); } catch (e) { console.error('render lobby full', e); }
  });

  // Fallback (older servers). Will just show in Off-chain box as generic list.
  socket.on('lobby:list', (list) => {
    renderSimpleList(listOff, list || []);
    if (noteOff) noteOff.textContent = list?.length ? '' : 'No tables yet.';
    if (noteLimit) noteLimit.textContent = '—';
    if (noteNL)    noteNL.textContent    = '—';
  });
}

function sectionHeaderNote(el, tables){
  if (!el) return;
  const sumSeats = (tables||[]).reduce((a,b)=>a+Number(b.seated||0), 0);
  const count = (tables||[]).length;
  el.textContent = count ? `${count} table${count>1?'s':''} • ${sumSeats} seated` : 'No tables yet.';
}

function openTable(id){
  try {
    const u = new URL(window.location.href);
    u.pathname = '/games/poker/table.html';
    u.searchParams.set('table', id);
    window.location.href = u.toString();
  } catch {
    window.location.href = `/games/poker/table.html?table=${encodeURIComponent(id)}`;
  }
}

function tableCard(row){
  const div = document.createElement('div');
  div.className = 'lobby-item';
  const left = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = row.title || row.id;
  const meta = document.createElement('div');
  meta.className = 'muted';
  meta.textContent = `Players ${row.seated}/${row.capacity}${row.stakes?` • ${row.stakes}`:''}`;
  left.appendChild(name);
  left.appendChild(meta);

  const btn = document.createElement('button');
  btn.textContent = 'Open Table';
  btn.onclick = () => openTable(row.id);

  div.appendChild(left);
  div.appendChild(btn);
  return div;
}

function renderSimpleList(container, list){
  if (!container) return;
  container.innerHTML = '';
  (list||[]).forEach(row => {
    const card = tableCard({
      id: row.id,
      seated: Number(row.seated||0),
      capacity: Number(row.capacity||8),
      title: row.id,
      stakes: ''
    });
    container.appendChild(card);
  });
}

function renderLobbyGrouped(payload){
  // shape: { onchain: { limit: [..], nolimit: [..] }, offchain: [..] }
  const ocLim = payload?.onchain?.limit || [];
  const ocNL  = payload?.onchain?.nolimit || [];
  const off   = payload?.offchain || [];

  // limit
  if (listLimit){
    listLimit.innerHTML = '';
    ocLim.forEach(t => {
      const card = tableCard({
        id: t.id,
        seated: Number(t.seated||0),
        capacity: Number(t.capacity||8),
        title: t.label || t.id,
        stakes: '3/6 MON Limit'
      });
      listLimit.appendChild(card);
    });
  }
  if (noteLimit) sectionHeaderNote(noteLimit, ocLim);

  // no-limit
  if (listNL){
    listNL.innerHTML = '';
    ocNL.forEach(t => {
      const card = tableCard({
        id: t.id,
        seated: Number(t.seated||0),
        capacity: Number(t.capacity||8),
        title: t.label || t.id,
        stakes: 'No-Limit'
      });
      listNL.appendChild(card);
    });
  }
  if (noteNL) sectionHeaderNote(noteNL, ocNL);

  // off-chain
  if (listOff){
    listOff.innerHTML = '';
    off.forEach(t => {
      const card = tableCard({
        id: t.id,
        seated: Number(t.seated||0),
        capacity: Number(t.capacity||8),
        title: t.label || t.id,
        stakes: 'Simulated'
      });
      listOff.appendChild(card);
    });
  }
  if (noteOff) sectionHeaderNote(noteOff, off);
}

// Bootstrap
(function boot(){
  // pick up saved wallet early
  const saved = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').trim();
  if (saved) setWallet(saved);
  initSocket();
})();
