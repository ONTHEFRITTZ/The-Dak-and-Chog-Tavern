// Isolated Poker realtime server (standalone)
// - Runs ONLY Poker on its own port (default: 3101)
// - No shared imports or runtime state with Faro

const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3101;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Poker realtime OK');
});

// Note: keep Socket.IO path at '/socket.io' — NGINX proxies /poker.io/ -> /socket.io
const io = new Server(server, {
  path: '/socket.io',
  cors: { origin: true, methods: ['GET','POST'] },
});

// Minimal isolated state (no reuse)
const tables = new Map(); // tableId -> { id, seats: [null|{id,addr,ready,lastActive}], lastActive }

function now() { return Date.now(); }
function getTable(id) {
  if (!tables.has(id)) {
    tables.set(id, { id, seats: Array.from({length:6}, () => null), lastActive: now() });
  }
  return tables.get(id);
}
function seatCount(t) { return t.seats.filter(Boolean).length; }
function tablePublic(t) {
  return {
    id: t.id,
    seats: t.seats.map(s => s && ({ id: s.id, addr: s.addr, ready: !!s.ready, lastActive: Number(s.lastActive||0) })),
  };
}
function emitLobby() {
  const list = Array.from(tables.values()).map(t => ({ id: t.id, seated: seatCount(t), capacity: 6, started: false }));
  io.emit('lobby:list', list.sort((a,b)=> a.id.localeCompare(b.id)));
}
function emitUpdate(t) { io.to(t.id).emit('table:update', tablePublic(t)); }

// Ensure at least one poker table exists
getTable('poker-1');

io.on('connection', (socket) => {
  let currentTableId = null;
  let addrLower = null;

  socket.on('identify', (m) => {
    try { addrLower = String(m?.addr||'').toLowerCase(); } catch {}
    socket.emit('rt:state', { ok: true, game: 'POKER' });
  });

  socket.on('lobby:get', () => { try { emitLobby(); } catch {} });

  socket.on('join_table', (m) => {
    try {
      const req = String(m?.table||m?.tableId||'poker-1');
      const tableId = tables.has(req) ? req : 'poker-1';
      if (currentTableId) socket.leave(currentTableId);
      currentTableId = tableId;
      socket.join(tableId);
      const t = getTable(tableId);
      t.lastActive = now();
      emitUpdate(t);
      io.to(tableId).emit('system', `joined ${tableId}`);
      emitLobby();
    } catch {}
  });

  socket.on('seat', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const idx = Number(m?.index);
      if (idx === -1) {
        const cur = t.seats.findIndex(s => s && s.addr === addrLower);
        if (cur >= 0) t.seats[cur] = null;
      } else if (idx >= 0 && idx < t.seats.length) {
        if (!t.seats[idx]) t.seats[idx] = { id: idx, addr: addrLower, ready: false, lastActive: now(), socketId: socket.id };
      }
      t.lastActive = now();
      emitUpdate(t);
      emitLobby();
    } catch {}
  });

  socket.on('ready', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (s) { s.ready = !!m?.ready; s.lastActive = now(); }
      t.lastActive = now();
      emitUpdate(t);
    } catch {}
  });

  socket.on('health', () => { try { socket.emit('health', { ok: true, now: Date.now(), game: 'POKER' }); } catch {} });

  socket.on('disconnect', () => {
    try {
      for (const [id, t] of tables) {
        let changed = false;
        for (let i = 0; i < t.seats.length; i++) {
          const s = t.seats[i];
          if (!s) continue;
          if ((addrLower && s.addr === addrLower) || s.socketId === socket.id) {
            t.seats[i] = null; changed = true;
          }
        }
        if (changed) { t.lastActive = now(); emitUpdate(t); emitLobby(); }
      }
    } catch {}
  });
});

setInterval(() => { try { emitLobby(); } catch {} }, 15_000);

server.listen(PORT, () => console.log('Poker RT on', PORT));

