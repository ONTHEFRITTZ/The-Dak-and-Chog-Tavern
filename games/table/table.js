// Minimal client for multiplayer table
const __isLocalHost = ['localhost','127.0.0.1'].includes(location.hostname);
const WS_URL = null; // using Socket.IO in production

const statusEl = document.getElementById('status');
const rulesOverlay = document.getElementById('rules-overlay');
const rulesAck = document.getElementById('rules-ack');
const openRulesBtn = document.getElementById('open-rules');
let faroAck = false;
const RULES_VERSION = 'v2';
function rulesFresh(key) { try { const t = Number(localStorage.getItem(key) || 0); return Date.now() - t < 86400000; } catch { return false; } }
const logEl = document.getElementById('log');
const tableInput = document.getElementById('table-id');
const joinBtn = document.getElementById('join-table');
const startBtn = document.getElementById('start');
const dealBtn = document.getElementById('deal');
const readyInput = document.getElementById('ready');
const seatsEls = Array.from(document.querySelectorAll('.seat'));
const returnBtn = document.getElementById('return');
const betAmtInput = document.getElementById('bet-amt');
const betCopperInput = document.getElementById('bet-copper');
const rankButtons = Array.from(document.querySelectorAll('.rank-btn'));

let socket; let myAddr = null; let currentTable = null; let mySeatId = null; let myIsOwner = false;

function short(v) { return v && v.length > 10 ? `${v.slice(0,6)}...${v.slice(-4)}` : (v || ''); }
function log(msg) { try { logEl.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + (logEl.textContent || ''); } catch {} }

function renderTable(table) {
  currentTable = table;
  myIsOwner = false; mySeatId = null;
  for (const el of seatsEls) {
    const idx = Number(el.dataset.index);
    const s = table.seats[idx];
    el.classList.toggle('ready', !!s?.ready);
    el.innerHTML = '';
    if (s) {
      const owner = (table.ownerId && s.id === table.ownerId);
      if (owner) { const b = document.createElement('div'); b.className = 'owner-badge'; b.textContent = 'Owner'; el.appendChild(b); }
      const a = document.createElement('div'); a.className = 'addr'; a.textContent = s?.x ? (`${s.x} (${short(s.addr||s.id)})`) : short(s.addr || s.id); el.appendChild(a);
      const bal = document.createElement('div'); bal.className = 'bal'; bal.textContent = `Bal: ${Number(s.balance ?? 0)}`; el.appendChild(bal);
      const me = (s.addr && myAddr && s.addr.toLowerCase() === myAddr.toLowerCase());
      if (me) { mySeatId = s.id; myIsOwner = owner; }
      if (me) {
        const btns = document.createElement('div'); btns.className = 'btns';
        const vacate = document.createElement('button'); vacate.textContent = 'Leave';
        vacate.onclick = () => socket?.emit('seat', { index: -1 });
        btns.appendChild(vacate);
        el.appendChild(btns);
      }
    } else {
      const a = document.createElement('div'); a.className = 'addr'; a.textContent = 'Empty'; el.appendChild(a);
      const btns = document.createElement('div'); btns.className = 'btns';
      const sit = document.createElement('button'); sit.textContent = 'Sit';
      if (!faroAck) { sit.disabled = true; sit.title = 'Acknowledge rules to join'; }
      sit.onclick = () => { if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; } socket?.emit('seat', { index: idx }); };
      btns.appendChild(sit); el.appendChild(btns);
    }
  }
  startBtn.disabled = !(myIsOwner && table.seats.filter(Boolean).length >= 2 && table.seats.filter(Boolean).every(s => s.ready));
  dealBtn.disabled = !myIsOwner || !table.started;
}

function connect() {
  if (!WS_URL) { log('Realtime disabled on this host'); return; }
  socket = io({ path: '/socket.io' });
  socket.on('connect', () => {
    log('Connected to server');
    if (myAddr) socket.emit('identify', { addr: myAddr });
    const id = (tableInput.value || 'lobby').trim();
    socket.emit('join_table', { table: id });
    // Publish public handle from localStorage if available
    try { const x = localStorage.getItem('profile.public.x'); if (x) socket.emit('profile_public', { x }); } catch {}
  });
  socket.on('table:update', (table) => { renderTable(table); });
  socket.on('table:started', (table) => { log('Game started!'); renderTable(table); });
  socket.on('table:coup', (m) => {
    const bank = m.bankRank; const player = m.playerRank;
    log(`Coup: bank=${bank}, player=${player}${m.doublet ? ' (doublet)' : ''}`);
    if (Array.isArray(m.results)) m.results.forEach(r => log(`${short(r.addr)}: ${r.delta >= 0 ? '+' : ''}${r.delta}`));
    renderTable(m.table);
  });
  socket.on('chat', (m) => { log(`${m.from}: ${m.text}`); });
  socket.on('error', (e) => { log(`Error: ${e?.message || 'unknown'}`); });
  socket.on('disconnect', () => { log('Disconnected. Reconnecting in 2s...'); setTimeout(connect, 2000); });
}

// Attach UI handlers
joinBtn.addEventListener('click', () => {
  if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; }
  const id = (tableInput.value || 'lobby').trim();
  socket?.emit('join_table', { table: id });
});

readyInput.addEventListener('change', () => {
  if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; readyInput.checked=false; return; }
  socket?.emit('ready', { ready: !!readyInput.checked });
});

startBtn.addEventListener('click', () => {
  socket?.emit('start');
});

dealBtn.addEventListener('click', () => {
  socket?.emit('deal');
});

rankButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; }
    const rank = btn.dataset.rank;
    const amt = Math.max(1, Number(betAmtInput.value || 0) | 0);
    const copper = !!betCopperInput.checked;
    socket?.emit('place_bet', { rank, amount: amt, copper });
    log(`Bet ${amt} on ${rank}${copper ? ' (copper)' : ''}`);
  });
});

returnBtn?.addEventListener('click', () => { window.location.href = '../../index.html'; });

// Resolve address (if connected previously via Tavern) for display/identity
(async () => {
  try {
    if (window.ethereum) {
      const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      const accounts = await provider.listAccounts();
      if (accounts && accounts.length) myAddr = accounts[0];
    }
  } catch {}
  connect();
})();

// Session-based rules modal for Faro
window.addEventListener('DOMContentLoaded', () => {
  try { faroAck = rulesFresh(`rulesAck.faro.${RULES_VERSION}`); } catch {}
  if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch {} }
  rulesAck?.addEventListener('click', () => {
    faroAck = true;
    try { rulesOverlay.style.display='none'; } catch {}
    try { localStorage.setItem(`rulesAck.faro.${RULES_VERSION}`, String(Date.now())); } catch {}
  });
  openRulesBtn?.addEventListener('click', () => { try { rulesOverlay.style.display='flex'; } catch {} });
});
