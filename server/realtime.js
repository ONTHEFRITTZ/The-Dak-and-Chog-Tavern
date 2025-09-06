// Realtime server: Faro table (multiplayer), profiles, basic chat
// Run on EC2 under node (behind Nginx /socket.io proxy)
// Messages (subset):
// - identify { addr }
// - join_table { table }
// - chat { table, msg }
// - seat { index } // -1 to leave
// - ready { ready }
// - start {}
// - place_bet { rank, amount, copper }
// - deal {}
// Emits:
// - table:update { table }
// - table:started { table }
// - table:coup { bankRank, playerRank, doublet, results: [{addr, delta}], table }
// - chat { from, text }
// - error { message }

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Tavern realtime OK');
});
const io = new Server(server, { cors: { origin: '*' } });

// In-memory stores
const tables = new Map(); // tableId -> { seats: [{id, addr, ready, balance}], started, bets: Map(addr -> {rank, amount, copper}) }
const profiles = new Map(); // addrLower -> { cipher }
const publicProfiles = new Map(); // addrLower -> { x }
const stats = new Map(); // addrLower -> { rounds, wagered, won, lost }
let paused = false;
let rakeBps = Number(process.env.RT_RAKE_BPS || 100); // 1% default
let feesAccrued = 0; // unitless, same units as bet amounts in table game
const admins = new Set(String(process.env.ADMIN_ADDR || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean));

function getTable(id) {
  if (!tables.has(id)) {
    tables.set(id, {
      id,
      seats: Array.from({ length: 6 }, (_, i) => null),
      started: false,
      bets: new Map(),
      ownerId: null,
    });
  }
  return tables.get(id);
}

function short(v) { return (v && v.length > 10) ? (v.slice(0,6) + '...' + v.slice(-4)) : (v || ''); }

function tablePublic(t) {
  return {
    id: t.id,
    seats: t.seats.map(s => s && { id: s.id, addr: s.addr, ready: !!s.ready, balance: s.balance, x: (publicProfiles.get(s.addr||'')||{}).x || null }),
    started: !!t.started,
    ownerId: t.ownerId,
  };
}

function emitUpdate(t) { io.to(t.id).emit('table:update', tablePublic(t)); }

function ensureStats(addr) {
  const key = (addr||'').toLowerCase();
  if (!stats.has(key)) stats.set(key, { rounds: 0, wagered: 0, won: 0, lost: 0 });
  return stats.get(key);
}

function rand13() { return Math.floor(Math.random()*13)+1; }

io.on('connection', (socket) => {
  let currentTableId = null;
  let addrLower = null;
  let isAdmin = false;

  socket.on('identify', (m) => {
    try { addrLower = String(m.addr||'').toLowerCase(); isAdmin = admins.has(addrLower); } catch {}
    socket.emit('rt:state', { paused, rakeBps, feesAccrued });
  });

  socket.on('join_table', (m) => {
    try {
      const tableId = String(m.table||m.tableId||'lobby');
      if (currentTableId) socket.leave(currentTableId);
      currentTableId = tableId;
      socket.join(tableId);
      const t = getTable(tableId);
      // Assign owner if empty
      if (t.ownerId == null) {
        t.ownerId = 0;
      }
      emitUpdate(t);
      io.to(tableId).emit('system', `${short(socket.id)} joined ${tableId}`);
    } catch {}
  });

  socket.on('chat', (m) => {
    try {
      if (!currentTableId) return;
      io.to(currentTableId).emit('chat', { from: short(socket.id), text: String(m.msg||'').slice(0, 400) });
    } catch {}
  });

  socket.on('seat', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const idx = Number(m.index);
      if (idx === -1) {
        // leave seat
        const curIdx = t.seats.findIndex(s => s && s.addr === addrLower);
        if (curIdx >= 0) t.seats[curIdx] = null;
      } else if (idx >= 0 && idx < t.seats.length) {
        if (!t.seats[idx]) {
          t.seats[idx] = { id: idx, addr: addrLower, ready: false, balance: 0 };
          if (t.ownerId == null) t.ownerId = idx;
        }
      }
      emitUpdate(t);
    } catch {}
  });

  socket.on('ready', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (s) s.ready = !!m.ready;
      emitUpdate(t);
    } catch {}
  });

  socket.on('start', () => {
    try {
      if (paused) { socket.emit('error', { message: 'paused' }); return; }
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      t.started = true;
      t.bets.clear();
      io.to(currentTableId).emit('table:started', tablePublic(t));
      emitUpdate(t);
    } catch {}
  });

  socket.on('place_bet', (m) => {
    try {
      if (paused) { socket.emit('error', { message: 'paused' }); return; }
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const rank = Number(m.rank);
      const amount = Math.max(1, Number(m.amount||0)|0);
      const copper = !!m.copper; // copper = "brass" (bet against)
      if (!(rank>=1 && rank<=13)) return;
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (!s) return;
      t.bets.set(addrLower, { rank, amount, copper });
      emitUpdate(t);
    } catch {}
  });

  socket.on('deal', () => {
    try {
      if (paused) { socket.emit('error', { message: 'paused' }); return; }
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      if (!t.started) return;
      const bankRank = rand13();
      const playerRank = rand13();
      const doublet = (bankRank === playerRank);
      const results = [];
      t.seats.forEach(seat => {
        if (!seat) return;
        const bet = t.bets.get(seat.addr);
        if (!bet) return;
        let delta = 0;
        // apply rake on every bet
        const fee = Math.floor((Number(bet.amount||0) * Number(rakeBps)) / 10000);
        const stake = Math.max(0, Number(bet.amount||0) - fee);
        feesAccrued += fee;
        // copper (brass) means bet against the rank
        const target = bet.rank;
        if (doublet) {
          delta = 0; // push in simplified model (fee still taken)
        } else {
          const matchedBank = (target === bankRank);
          const matchedPlayer = (target === playerRank);
          if (bet.copper) {
            // against the rank: opposite outcome of standard, using stake
            if (matchedBank) delta = +stake; // bank hit -> against wins
            else if (matchedPlayer) delta = -stake; else delta = 0;
          } else {
            if (matchedPlayer) delta = +stake;
            else if (matchedBank) delta = -stake; else delta = 0;
          }
        }
        seat.balance = Number(seat.balance||0) + delta;
        const st = ensureStats(seat.addr);
        st.rounds += 1; st.wagered += stake; if (delta>0) st.won += delta; if (delta<0) st.lost += (-delta);
        results.push({ addr: seat.addr, delta });
      });
      t.bets.clear();
      io.to(currentTableId).emit('table:coup', { bankRank, playerRank, doublet, results, table: tablePublic(t) });
      emitUpdate(t);
    } catch {}
  });

  // Profiles & stats (encrypted payloads handled client-side)
  socket.on('profile_save', (m) => {
    try { if (!addrLower) return; const cipher = String(m.cipher||''); profiles.set(addrLower, { cipher }); } catch {}
  });
  socket.on('profile_get', () => {
    try { const p = profiles.get(addrLower||''); socket.emit('message', JSON.stringify({ type: 'profile', cipher: p?.cipher||'' })); } catch {}
  });
  socket.on('profile_public', (m) => {
    try {
      if (!addrLower) return;
      const x = String(m?.x || '').slice(0, 48);
      publicProfiles.set(addrLower, { x });
      if (currentTableId) emitUpdate(getTable(currentTableId));
    } catch {}
  });
  socket.on('stat_read', (m) => {
    try { const a = String(m.addr||'').toLowerCase(); const st = stats.get(a)||{ rounds:0,wagered:0,won:0,lost:0 }; socket.emit('message', JSON.stringify({ type: 'stats', addr: a, ...st })); } catch {}
  });

  // Admin pause/resume
  socket.on('admin:pause', (m) => {
    try {
      if (!isAdmin) { socket.emit('error', { message: 'not admin' }); return; }
      paused = !!m?.paused;
      io.emit('rt:paused', { paused, rakeBps, feesAccrued });
    } catch {}
  });

  socket.on('admin:setRake', (m) => {
    try {
      if (!isAdmin) { socket.emit('error', { message: 'not admin' }); return; }
      const bps = Math.max(0, Math.min(1000, Number(m?.bps||0)));
      rakeBps = bps;
      io.emit('rt:state', { paused, rakeBps, feesAccrued });
    } catch {}
  });

  socket.on('admin:resetFees', () => {
    try {
      if (!isAdmin) { socket.emit('error', { message: 'not admin' }); return; }
      feesAccrued = 0;
      io.emit('rt:state', { paused, rakeBps, feesAccrued });
    } catch {}
  });

  // Admin: restart/shutdown backend (pm2 will typically restart on exit)
  socket.on('admin:restart', () => {
    try {
      if (!isAdmin) { socket.emit('error', { message: 'not admin' }); return; }
      socket.emit('system', 'restarting backend');
      setTimeout(() => { try { process.exit(0); } catch {} }, 100);
    } catch {}
  });
  socket.on('admin:shutdown', () => {
    try {
      if (!isAdmin) { socket.emit('error', { message: 'not admin' }); return; }
      socket.emit('system', 'shutting down backend');
      setTimeout(() => { try { process.exit(0); } catch {} }, 100);
    } catch {}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('RT server on', PORT));
