// Faro Lobby page: connects to realtime server and renders tables list
const lobbyList = document.getElementById('lobby');
const bannerStatus = document.getElementById('status');
const returnBtn = document.getElementById('return');
returnBtn?.addEventListener('click', () => { window.location.href = '/index.html'; });

function renderLobby(list) {
  try {
    lobbyList.innerHTML = '';
    const onlyFaro = Array.isArray(list) ? list.filter(r => String(r.id||'').startsWith('faro-')) : [];
    const sorted = onlyFaro.slice().sort((a,b)=>{
      const aFull = Number(a.seated||0) >= Number(a.capacity||6);
      const bFull = Number(b.seated||0) >= Number(b.capacity||6);
      if (aFull !== bFull) return aFull ? 1 : -1;
      return String(a.id||'').localeCompare(String(b.id||''));
    });
    sorted.forEach(row => {
      const seated = Number(row.seated||0);
      const cap = Number(row.capacity||6);
      const card = document.createElement('div'); card.className='lobby-item';
      const left = document.createElement('div'); left.textContent = `${row.id} - Players ${seated}/${cap}`;
      const btn = document.createElement('button'); btn.textContent = 'Open Table';
      btn.onclick = () => { window.location.href = `/games/faro/index.html?table=${encodeURIComponent(row.id)}`; };
      card.appendChild(left); card.appendChild(btn);
      lobbyList.appendChild(card);
    });
    if (!sorted.length) lobbyList.innerHTML = '<div style="opacity:.7; font-size:13px;">No tables yet. Please wait…</div>';
  } catch {}
}

async function ensureIo(){
  if (window.io) return;
  await new Promise((resolve)=>{
    const s=document.createElement('script');
    s.src='https://cdn.socket.io/4.7.5/socket.io.min.js';
    s.onload=resolve; s.onerror=resolve; document.head.appendChild(s);
  });
}

async function connect() {
  await ensureIo();
  const socket = io(window.location.origin, { path: '/socket.io', transports: ['websocket','polling'], reconnection:true, reconnectionAttempts:10, reconnectionDelay:800 });
  const status = (msg)=>{
    try { lobbyList.innerHTML = `<div style="opacity:.7; font-size:13px;">${msg}</div>`; } catch {}
    try { if (bannerStatus) bannerStatus.textContent = msg; } catch {}
  };
  socket.on('connect', ()=>{ status('Loading tables…'); try { socket.emit('user:location', { path: location.pathname }); } catch {} try { socket.emit('lobby:get'); } catch {} });
  socket.on('connect_error', ()=> status('Lobby unavailable. Retrying…'));
  socket.on('reconnect_error', ()=> status('Reconnecting to lobby…'));
  socket.on('reconnect_failed', ()=> status('Unable to reach lobby. Please retry.'));
  socket.on('lobby:list', (list)=> renderLobby(Array.isArray(list)?list:[]));
}

connect();

