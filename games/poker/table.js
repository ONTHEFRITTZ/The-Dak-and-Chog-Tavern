const statusEl = document.getElementById('status');
const centerEl = document.getElementById('center');
const seatEls = Array.from(document.querySelectorAll('.seat'));
const connectBtn = document.getElementById('connect-wallet');
let socket; let myAddr = null; let currentTableId = null;

function short(a){ try { return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); } catch { return a||''; } }
function setStatus(t){ try { statusEl.textContent = t; } catch {} }

function renderTable(t){
  try {
    if (!t || t.id !== currentTableId) return;
    seatEls.forEach(el => {
      const idx = Number(el.dataset.index);
      const s = Array.isArray(t.seats) ? t.seats[idx] : null;
      el.innerHTML = '';
      const label = document.createElement('div'); label.className='addr'; label.textContent = `Seat ${idx}`; el.appendChild(label);
      const info = document.createElement('div'); info.className='addr';
      if (s) {
        info.textContent = short(s.addr||s.id); el.appendChild(info);
        if (myAddr && s.addr && String(s.addr).toLowerCase()===String(myAddr).toLowerCase()){
          const btns = document.createElement('div'); btns.className='btns';
          const leave = document.createElement('button'); leave.textContent='Leave'; leave.onclick=()=> socket.emit('seat',{ index:-1 });
          const ready = document.createElement('button'); ready.textContent = s.ready? 'Unready':'Ready'; ready.onclick=()=> socket.emit('ready',{ ready: !s.ready });
          btns.appendChild(leave); btns.appendChild(ready); el.appendChild(btns);
        }
      } else {
        info.textContent = 'Empty'; el.appendChild(info);
        const btns = document.createElement('div'); btns.className='btns';
        const sit = document.createElement('button'); sit.textContent='Sit'; if (!myAddr) { sit.disabled=true; sit.title='Connect wallet to sit'; }
        sit.onclick = () => { if (!myAddr) return; socket.emit('seat',{ index: idx }); };
        btns.appendChild(sit); el.appendChild(btns);
      }
    });
  } catch {}
}

function parseTableId(){ try { const u=new URL(window.location.href); return u.searchParams.get('table') || 'poker-1'; } catch { return 'poker-1'; } }

async function connect(){
  currentTableId = parseTableId();
  try {
    socket = io(window.location.origin, { path: '/poker.io/', transports:['polling','websocket'], upgrade:true, reconnection:true, reconnectionAttempts:10, reconnectionDelay:800, forceNew:true });
  } catch (e) { setStatus('Socket.IO not available'); return; }

  socket.on('connect', () => {
    setStatus('Connected');
    if (myAddr) { try { socket.emit('identify', { addr: myAddr }); } catch {} }
    try { socket.emit('join_table', { table: currentTableId }); } catch {}
  });
  socket.on('connect_error', () => setStatus('Lobby unavailable. Retrying...'));
  socket.on('reconnect_error', () => setStatus('Reconnecting...'));
  socket.on('disconnect', () => setStatus('Disconnected'));
  socket.on('table:update', (t) => { renderTable(t); });
  socket.on('system', (m) => { try { centerEl.textContent = String(m); } catch {} });
}

connect();

connectBtn?.addEventListener('click', async () => {
  try {
    if (!window.ethereum || !window.ethers) { setStatus('No wallet provider'); return; }
    await window.ethereum.request({ method:'eth_requestAccounts' });
    const provider = new window.ethers.providers.Web3Provider(window.ethereum,'any');
    const signer = provider.getSigner();
    const addr = await signer.getAddress();
    myAddr = String(addr||'').toLowerCase();
    setStatus(`Wallet: ${short(myAddr)}`);
    try { if (socket && socket.connected) { socket.emit('identify', { addr: myAddr }); socket.emit('join_table', { table: currentTableId }); } } catch {}
  } catch (e) { setStatus('Wallet connect failed'); }
});

