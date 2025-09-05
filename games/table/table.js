// Minimal client for multiplayer table
const __isLocalHost = ['localhost','127.0.0.1'].includes(location.hostname);
const WS_URL = (window.MULTI_WS_URL || (__isLocalHost ? 'ws://localhost:8787' : null));

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

let ws; let myAddr = null; let currentTable = null; let mySeatId = null; let myIsOwner = false;

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
      const a = document.createElement('div'); a.className = 'addr'; a.textContent = short(s.addr || s.id); el.appendChild(a);
      const bal = document.createElement('div'); bal.className = 'bal'; bal.textContent = `Bal: ${Number(s.balance ?? 0)}`; el.appendChild(bal);
      const me = (s.addr && myAddr && s.addr.toLowerCase() === myAddr.toLowerCase());
      if (me) { mySeatId = s.id; myIsOwner = owner; }
      if (me) {
        const btns = document.createElement('div'); btns.className = 'btns';
        const vacate = document.createElement('button'); vacate.textContent = 'Leave';
        vacate.onclick = () => ws?.send(JSON.stringify({ type: 'seat', index: -1 }));
        btns.appendChild(vacate);
        el.appendChild(btns);
      }
    } else {
      const a = document.createElement('div'); a.className = 'addr'; a.textContent = 'Empty'; el.appendChild(a);
      const btns = document.createElement('div'); btns.className = 'btns';
      const sit = document.createElement('button'); sit.textContent = 'Sit';
      if (!faroAck) { sit.disabled = true; sit.title = 'Acknowledge rules to join'; }
      sit.onclick = () => { if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; } ws?.send(JSON.stringify({ type: 'seat', index: idx })); };
      btns.appendChild(sit); el.appendChild(btns);
    }
  }
  startBtn.disabled = !(myIsOwner && table.seats.filter(Boolean).length >= 2 && table.seats.filter(Boolean).every(s => s.ready));
  dealBtn.disabled = !myIsOwner || !table.started;
}

function connect() {
  if (!WS_URL) { log('Realtime disabled on this host'); return; }
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    log('Connected to server');
    if (myAddr) ws.send(JSON.stringify({ type: 'identify', addr: myAddr }));
    const id = (tableInput.value || 'lobby').trim();
    ws.send(JSON.stringify({ type: 'join_table', tableId: id }));
  };
  ws.onmessage = (evt) => {
    let msg; try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.type === 'hello') return; // ignore handshake detail in UI
    if (msg.type === 'table:update') { renderTable(msg.table); }
    if (msg.type === 'table:coup') {
      const bank = msg.bankRank;
      const player = msg.playerRank;
      log(`Coup: bank=${bank}, player=${player}${msg.doublet ? ' (doublet)' : ''}`);
      if (Array.isArray(msg.results)) {
        msg.results.forEach(r => log(`${short(r.addr)}: ${r.delta >= 0 ? '+' : ''}${r.delta}`));
      }
    }
    if (msg.type === 'table:started') { log('Game started!'); renderTable(msg.table); }
    if (msg.type === 'chat') { log(`${msg.from}: ${msg.text}`); }
    if (msg.type === 'error') { log(`Error: ${msg.message || 'unknown'}`); }
  };
  ws.onclose = () => { log('Disconnected. Reconnecting in 2s...'); setTimeout(connect, 2000); };
}

// Attach UI handlers
joinBtn.addEventListener('click', () => {
  if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; }
  if (!ws || ws.readyState !== 1) return;
  const id = (tableInput.value || 'lobby').trim();
  ws.send(JSON.stringify({ type: 'join_table', tableId: id }));
});

readyInput.addEventListener('change', () => {
  if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; readyInput.checked=false; return; }
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'ready', ready: !!readyInput.checked }));
});

startBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'start' }));
});

dealBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'deal' }));
});

rankButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; }
    if (!ws || ws.readyState !== 1) return;
    const rank = btn.dataset.rank;
    const amt = Math.max(1, Number(betAmtInput.value || 0) | 0);
    const copper = !!betCopperInput.checked;
    ws.send(JSON.stringify({ type: 'place_bet', rank, amount: amt, copper }));
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
