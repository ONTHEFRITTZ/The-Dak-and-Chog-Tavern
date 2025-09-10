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
const io = new Server(server, {
  path: '/socket.io',
  cors: { origin: true, methods: ['GET','POST'] },
});

// In-memory stores
const tables = new Map(); // tableId -> { id, seats: [{id, addr, ready, balance}], started, bets: Map(addrLower -> {rank, amount, copper}), ownerId, lastActive }
const profiles = new Map(); // addrLower -> { cipher }
const publicProfiles = new Map(); // addrLower -> { x }
const stats = new Map(); // addrLower -> { rounds, wagered, won, lost }
let paused = false;
let rakeBps = Number(process.env.RT_RAKE_BPS || 100); // 1% default
let feesAccrued = 0; // unitless, same units as bet amounts in table game
const admins = new Set(String(process.env.ADMIN_ADDR || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean));

function nowMs() { return Date.now(); }

function getTable(id) {
  if (!tables.has(id)) {
    tables.set(id, {
      id,
      seats: Array.from({ length: 6 }, () => null),
      started: false,
      bets: new Map(),
      ownerId: null,
      lastActive: nowMs(),
    });
  }
  return tables.get(id);
}

function seatCount(t) { return t.seats.filter(Boolean).length; }

function nextTableId() {
  const ids = Array.from(tables.keys())
    .map(id => /^faro-(\d+)$/.exec(id))
    .filter(Boolean)
    .map(m => Number(m[1]));
  const next = ids.length ? Math.max(...ids) + 1 : 1;
  return `faro-${next}`;
}

function ensureLobbyPolicy() {
  // Ensure at least one table exists
  if (tables.size === 0) getTable('faro-1');

  // Close idle empty tables (no seats) after 60s, but always keep at least one table
  const now = nowMs();
  const ids = Array.from(tables.keys()).sort();
  const keepIds = new Set(ids);
  for (const id of ids) {
    const t = getTable(id);
    if (seatCount(t) === 0 && (now - (t.lastActive || 0)) > 60_000 && tables.size > 1) {
      tables.delete(id);
      keepIds.delete(id);
    }
  }

  // Ensure there is at least one table available with a free seat. If all are full, create a new one.
  const anyFree = Array.from(tables.values()).some(t => seatCount(t) < 6);
  if (!anyFree) getTable(nextTableId());
}

function short(v) { return (v && v.length > 10) ? (v.slice(0,6) + '...' + v.slice(-4)) : (v || ''); }

function tablePublic(t) {
  return {
    id: t.id,
    seats: t.seats.map(s => s && {
      id: s.id,
      addr: s.addr,
      ready: !!s.ready,
      balance: s.balance,
      bet: (s.addr ? (t.bets.get(String(s.addr||'').toLowerCase()) || null) : null),
      x: (publicProfiles.get(s.addr||'')||{}).x || null
    }),
    started: !!t.started,
    ownerId: t.ownerId,
  };
}

function emitUpdate(t) { io.to(t.id).emit('table:update', tablePublic(t)); }

function emitLobby() {
  const list = Array.from(tables.values()).map(t => ({ id: t.id, seated: seatCount(t), capacity: 6, started: !!t.started }));
  io.emit('lobby:list', list.sort((a,b)=> a.id.localeCompare(b.id)));
}

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
      const reqId = String(m.table||m.tableId||'faro-1');
      const tableId = (tables.has(reqId) ? reqId : 'faro-1');
      if (currentTableId) socket.leave(currentTableId);
      currentTableId = tableId;
      socket.join(tableId);
      const t = getTable(tableId);
      t.lastActive = nowMs();
      emitUpdate(t);
      io.to(tableId).emit('system', `${short(socket.id)} joined ${tableId}`);
      ensureLobbyPolicy();
      emitLobby();
    } catch {}
  });

  socket.on('lobby:get', () => { try { ensureLobbyPolicy(); emitLobby(); } catch {} });

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
      const before = seatCount(t);
      const idx = Number(m.index);
      if (idx === -1) {
        // leave seat
        const curIdx = t.seats.findIndex(s => s && s.addr === addrLower);
        if (curIdx >= 0) t.seats[curIdx] = null;
      } else if (idx >= 0 && idx < t.seats.length) {
        if (!t.seats[idx]) {
          t.seats[idx] = { id: idx, addr: addrLower, ready: false, balance: 0 };
        }
      }
      // Auto-start shoe when first player sits
      const after = seatCount(t);
      if (!t.started && before === 0 && after > 0 && !paused) {
        t.started = true;
        t.bets.clear();
        t.lastActive = nowMs();
        io.to(currentTableId).emit('table:started', tablePublic(t));
      }
      t.lastActive = nowMs();
      emitUpdate(t);
      ensureLobbyPolicy();
      emitLobby();
    } catch {}
  });

  socket.on('ready', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (s) s.ready = !!m.ready;
      t.lastActive = nowMs();
      emitUpdate(t);
      const active = t.seats.filter(Boolean);
      const allReady = active.length && active.every(x => !!x.ready);
      if (allReady && t.bets.size > 0 && !paused) {
        const bankRank = rand13();
        const playerRank = rand13();
        const doublet = (bankRank === playerRank);
        const results = [];
        active.forEach(seat => {
          const bet = t.bets.get(String(seat.addr||'').toLowerCase());
          if (!bet) return;
          let delta = 0;
          const fee = Math.floor((Number(bet.amount||0) * Number(rakeBps)) / 10000);
          const stake = Math.max(0, Number(bet.amount||0) - fee);
          feesAccrued += fee;
          const target = bet.rank;
          if (doublet) {
            delta = 0;
          } else {
            const matchedBank = (target === bankRank);
            const matchedPlayer = (target === playerRank);
            if (bet.copper) {
              if (matchedBank) delta = +stake; else if (matchedPlayer) delta = -stake; else delta = 0;
            } else {
              if (matchedPlayer) delta = +stake; else if (matchedBank) delta = -stake; else delta = 0;
            }
          }
          seat.balance = Number(seat.balance||0) + delta;
          const st = ensureStats(seat.addr);
          st.rounds += 1; st.wagered += stake; if (delta>0) st.won += delta; if (delta<0) st.lost += (-delta);
          results.push({ addr: seat.addr, delta });
        });
        t.bets.clear();
        active.forEach(seat => { seat.ready = false; });
        io.to(currentTableId).emit('table:coup', { bankRank, playerRank, doublet, results, table: tablePublic(t) });
        emitUpdate(t);
      }
    } catch {}
  });

  // Starting/stopping the shoe is automatic; ignore manual start requests
  socket.on('start', () => { /* no-op by design */ });

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
      if (s.ready) { socket.emit('error', { message: 'Already ready' }); return; }
      t.bets.set(String(addrLower||''), { rank, amount, copper });
      t.lastActive = nowMs();
      emitUpdate(t);
    } catch {}
  });

  socket.on('deal', () => {
    try {
      if (paused) { socket.emit('error', { message: 'paused' }); return; }
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      t.lastActive = nowMs();
      const bankRank = rand13();
      const playerRank = rand13();
      const doublet = (bankRank === playerRank);
      const results = [];
      t.seats.forEach(seat => {
        if (!seat) return;
        const bet = t.bets.get(String(seat.addr||'').toLowerCase());
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

  // Lightweight health probe (any client)
  socket.on('health', () => {
    try {
      socket.emit('health', { ok: true, now: Date.now(), paused, rakeBps, feesAccrued });
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

// Periodically enforce lobby policy (cleanup idle tables, ensure availability)
setInterval(() => {
  try { ensureLobbyPolicy(); emitLobby(); } catch {}
}, 15_000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('RT server on', PORT));
