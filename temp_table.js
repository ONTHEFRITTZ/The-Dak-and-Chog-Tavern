// Minimal client for multiplayer table
const WS_URL = (window.MULTI_WS_URL || 'ws://localhost:8787');

const\ statusEl\ =\ document\.getElementById\('status'\);
const logEl = document.getElementById('log');
const tableInput = document.getElementById('table-id');
const joinBtn = document.getElementById('join-table');
const startBtn = document.getElementById('start');
const dealBtn = document.getElementById('deal');
const readyInput = document.getElementById('ready');
const seatsEls = Array.from(document.querySelectorAll('.seat'));
const returnBtn = document.getElementById('return');
const avatarUpload = document.getElementById('avatar-upload');
const tweetWinBtn = document.getElementById('tweet-win');
const betAmtInput = document.getElementById('bet-amt');
const betCopperInput = document.getElementById('bet-copper');
const rankButtons = Array.from(document.querySelectorAll('.rank-btn'));
let stageInfo = { stage: null, deadline: null };
let myAllowedRound = 0;

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
      if (s.avatar) { const img = document.createElement('img'); img.className='avatar'; img.src = s.avatar; img.alt=''; el.appendChild(img); }
      const a = document.createElement('div'); a.className = 'addr'; a.textContent = short(s.addr || s.id); el.appendChild(a);
      const bal = document.createElement('div'); bal.className = 'bal'; bal.textContent = `Bal: ${Number(s.balance ?? 0)}${s.pending ? ' | Pend: '+s.pending : ''}`; el.appendChild(bal);
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
      const sit = document.createElement('button'); sit.textContent = 'Sit'; if (!faroAck) { sit.disabled = true; sit.title = 'Acknowledge rules to join'; } const canSit = !(table.started && Number(table.round||0) < Number(myAllowedRound||0));
      if (canSit) {
        sit.onclick = () => ws?.send(JSON.stringify({ type: 'seat', index: idx }));
      } else {
        sit.disabled = true; sit.title = 'Wait until next round to join';
      }
      btns.appendChild(sit); el.appendChild(btns);
    }
  }
  startBtn.disabled = !(myIsOwner && table.seats.filter(Boolean).length >= 2 && table.seats.filter(Boolean).every(s => s.ready));
  dealBtn.disabled = !myIsOwner || !table.started;
}

function connect() {
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
    if (msg.type === 'table:update') { renderTable(msg.table); renderBets(msg.bets || {}); }
    if (msg.type === 'you') { myAllowedRound = Number(msg.allowedRound||0); }
    if (msg.type === 'table:stage') {
      stageInfo.stage = msg.stage; stageInfo.deadline = msg.deadline; stageInfo.lockAt = msg?.table?.lockAt || msg.lockAt || null;
      try { readyInput.checked = false; } catch {}
      updateStageStatus();
    }
    if (msg.type === 'table:coup') {
      const bank = msg.bankRank;
      const player = msg.playerRank;
      log(`Coup: bank=${bank}, player=${player}${msg.doublet ? ' (doublet)' : ''}`);
      if (Array.isArray(msg.results)) {
        let myDelta = 0;
        msg.results.forEach(r => { log(`${short(r.addr)}: ${r.delta >= 0 ? '+' : ''}${r.delta}`); if (myAddr && r.addr && r.addr.toLowerCase() === myAddr.toLowerCase()) myDelta = Number(r.delta||0); });
        if (myDelta > 0 && tweetWinBtn) {
          tweetWinBtn.style.display = '';
          const text = encodeURIComponent(`I just won ${myDelta} at Faro in The Dak & Chog Tavern!`);
          const url = 'https://twitter.com/intent/tweet?text=' + text;
          tweetWinBtn.onclick = () => window.open(url, '_blank');
          setTimeout(()=>{ try { tweetWinBtn.style.display = 'none'; } catch{} }, 15000);
        }
      }
    }
    if (msg.type === 'table:started') { log('Game started!'); renderTable(msg.table); }
    if (msg.type === 'chat') { log(`${msg.from}: ${msg.text}`); }
    if (msg.type === 'error') { log(`Error: ${msg.message || 'unknown'}`); }
    if (msg.type === 'eject') { window.location.href='../../index.html'; }
  };
  ws.onclose = () => { log('Disconnected. Reconnecting in 2s...'); setTimeout(connect, 2000); };
}

// Attach UI handlers
joinBtn.addEventListener('click', () => { if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; } if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; }
  if (!ws || ws.readyState !== 1) return;
  const id = (tableInput.value || 'lobby').trim();
  ws.send(JSON.stringify({ type: 'join_table', tableId: id }));
});

readyInput.addEventListener('change', () => {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'ready', ready: !!readyInput.checked }));
});

startbtn.addEventListener('click', () => { if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; } if (!ws || ws.readyState !== 1) return; const rank = btn.dataset.rank; const amt = Math.max(1, Number(betAmtInput.value || 0) | 0); const copper = !!betCopperInput.checked; ws.send(JSON.stringify({ type: 'place_bet', rank, amount: amt, copper })); log(Bet  on ); });

dealbtn.addEventListener('click', () => { if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; } if (!ws || ws.readyState !== 1) return; const rank = btn.dataset.rank; const amt = Math.max(1, Number(betAmtInput.value || 0) | 0); const copper = !!betCopperInput.checked; ws.send(JSON.stringify({ type: 'place_bet', rank, amount: amt, copper })); log(Bet  on ); });

rankButtons.forEach(btn => {
  btn.addEventListener('click', () => { if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; } if (!ws || ws.readyState !== 1) return; const rank = btn.dataset.rank; const amt = Math.max(1, Number(betAmtInput.value || 0) | 0); const copper = !!betCopperInput.checked; ws.send(JSON.stringify({ type: 'place_bet', rank, amount: amt, copper })); log(Bet  on ); });
});

function renderBets(agg){
  try {
    rankButtons.forEach(btn => {
      btn.style.position = 'relative';
      let chip = btn.querySelector('.chip');
      const total = Number(agg?.[btn.dataset.rank] || 0);
      if (total > 0) {
        if (!chip) { chip = document.createElement('span'); chip.className = 'chip'; btn.appendChild(chip); }
        chip.textContent = total;
      } else if (chip) { chip.remove(); }
    });
  } catch {}
}

function updateStageStatus(){
  try {
    if (!stageInfo.stage) { statusEl.textContent = ""; return; }
    const left = Math.max(0, Math.floor(((stageInfo.deadline||0) - Date.now())/1000));
    const label = stageInfo.stage === "betting" ? "Place bets" : "Get ready";
    statusEl.textContent = `${label} - ${left}s`;
    // Lock buttons when past lockAt
    const lock = stageInfo.stage === 'betting' && stageInfo.lockAt && Date.now() >= Number(stageInfo.lockAt);
    rankButtons.forEach(btn => { btn.disabled = !!lock; });
  } catch {}
}setInterval(updateStageStatus, 500);

returnBtn?.addEventListener('click', () => { window.location.href = '../../index.html'; });

// Avatar upload
avatarUpload?.addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const reader = new FileReader();
    reader.onload = () => { try { ws?.send(JSON.stringify({ type: 'set_avatar', data: String(reader.result||'') })); } catch {} };
    reader.readAsDataURL(f);
  } catch {}
});


  if (!h) return;
  const url = `https://unavatar.io/twitter/${encodeURIComponent(h)}`;
  try { ws?.send(JSON.stringify({ type: 'set_avatar', url })); } catch {}
});

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


// Avatar upload
avatarUpload?.addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const reader = new FileReader();
    reader.onload = () => { try { ws?.send(JSON.stringify({ type: 'set_avatar', data: String(reader.result||'') })); } catch {} };
    reader.readAsDataURL(f);
  } catch {}
});


  if (!h) return;
   } catch {}
});

window.addEventListener('DOMContentLoaded', () => { try { rulesOverlay.style.display='flex'; faroAck=false; } catch{}; rulesAck?.addEventListener('click', () => { faroAck=true; try { rulesOverlay.style.display='none'; } catch{}; }); });

readyInput.addEventListener('change', () => { if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; readyInput.checked=false; return; } if (!ws || ws.readyState !== 1) return; ws.send(JSON.stringify({ type: 'ready', ready: !!readyInput.checked })); });
window.addEventListener('DOMContentLoaded', () => { try { rulesOverlay.style.display='flex'; faroAck=false; } catch{}; rulesAck?.addEventListener('click', () => { faroAck=true; try { rulesOverlay.style.display='none'; } catch{}; }); });
// Allow Escape to dismiss the rules overlay (does not count as acknowledgment)
try {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const ov = document.getElementById('rules-overlay');
      if (ov) ov.style.display = 'none';
    }
  });
} catch {}


