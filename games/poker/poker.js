const statusEl = document.getElementById('status');
const lobbyEl = document.getElementById('lobby');
let socket;

function setStatus(t){ try { statusEl.textContent = t; } catch {} }

function renderLobby(list){
  try {
    const items = Array.isArray(list)? list : [];
    lobbyEl.innerHTML = '';
    items.forEach(row => {
      const card = document.createElement('div'); card.className='lobby-item';
      const left = document.createElement('div'); left.textContent = `${row.id} — Players ${row.seated}/${row.capacity}`;
      const btn = document.createElement('button'); btn.textContent = 'Join';
      btn.onclick = () => { try { socket.emit('join_table', { table: row.id }); } catch {} };
      card.appendChild(left); card.appendChild(btn);
      lobbyEl.appendChild(card);
    });
    if (!items.length) lobbyEl.textContent = 'No poker tables yet.';
  } catch {}
}

async function connect(){
  try {
    // Use isolated path proxied by NGINX to 3101
    socket = io(window.location.origin, { path: '/poker.io', transports: ['websocket','polling'], reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 800 });
  } catch (e) {
    setStatus('Socket.IO not available');
    return;
  }
  socket.on('connect', () => { setStatus('Connected'); try { socket.emit('lobby:get'); } catch {} });
  socket.on('connect_error', () => { setStatus('Lobby unavailable. Retrying…'); });
  socket.on('reconnect_error', () => { setStatus('Reconnecting…'); });
  socket.on('disconnect', () => setStatus('Disconnected'));
  socket.on('lobby:list', (list) => renderLobby(list));
  socket.on('system', (m) => { /* noop */ });
}

connect();

