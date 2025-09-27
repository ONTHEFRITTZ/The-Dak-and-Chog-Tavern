// Poker realtime server (on-chain limit, on-chain no-limit, off-chain sim)
// Path (behind Nginx): /socket.io/   (Nginx maps /poker.io/ → /socket.io/ here)
//
// ENV:
// - PORT                (default 3101)
// - ADMIN_ADDR          (comma-separated lowercase addresses)
// - GAME_TYPES          (optional; ignored here — poker-only)
// - TABLE_CAPACITY      (default 8)
// - SPAWN_THRESHOLD     (default 6) // when a table in a category reaches this many, create a new one
// - PRUNE_IDLE_SEC      (default 60) // keep at least one table in category
//
// Bot policy: allowed ONLY in OFFCHAIN tables; auto-seat when exactly 1 human, auto-kick otherwise.

const http = require('http');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3101);
const TABLE_CAPACITY = Math.max(2, Number(process.env.TABLE_CAPACITY || 8));
const SPAWN_THRESHOLD = Math.min(TABLE_CAPACITY, Math.max(2, Number(process.env.SPAWN_THRESHOLD || 6)));
const PRUNE_IDLE_SEC = Math.max(10, Number(process.env.PRUNE_IDLE_SEC || 60));

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Poker realtime OK');
});

const io = new Server(server, {
  path: '/socket.io/',
  cors: { origin: true, methods: ['GET','POST'] },
});

const admins = new Set(String(process.env.ADMIN_ADDR || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean));

/* ----------------------------- Tables & helpers ---------------------------- */

const tables = new Map(); // id -> { id, kind, seats[], started, lastActive, poker, simulated, stakes, emptySince? }
const KINDS = Object.freeze({
  ONCHAIN_LIMIT:  'ONCHAIN_LIMIT',
  ONCHAIN_NL:     'ONCHAIN_NL',
  OFFCHAIN:       'OFFCHAIN',
});

function nowMs(){ return Date.now(); }
function short(v){ return (v && v.length>10) ? (v.slice(0,6)+'...'+v.slice(-4)) : (v||''); }
function seatCount(t){ return (t.seats||[]).filter(Boolean).length; }

function publicRow(t){
  return {
    id: t.id,
    seated: seatCount(t),
    capacity: TABLE_CAPACITY,
    label: t.label || t.id,
  };
}

function makeId(kind, n){
  const prefix = (kind===KINDS.ONCHAIN_LIMIT?'poker-onchain-limit'
                : kind===KINDS.ONCHAIN_NL ? 'poker-onchain-nl'
                : 'poker-offchain');
  return `${prefix}-${n}`;
}

function nextIndexForKind(kind){
  const nums = Array.from(tables.keys())
    .map(id => {
      const m = id.match(/-(\d+)$/);
      return m ? Number(m[1]) : null;
    }).filter(n => n!=null);
  return (nums.length ? Math.max(...nums)+1 : 1);
}

function listByKind(kind){
  return Array.from(tables.values()).filter(t => t.kind === kind).sort((a,b)=>a.id.localeCompare(b.id));
}

function getOrCreate(kind, label){
  const list = listByKind(kind);
  if (list.length) return list[0];
  const id = makeId(kind, 1);
  const t = {
    id, kind,
    label: label || id,
    seats: Array.from({length:TABLE_CAPACITY}, ()=>null),
    started: false,
    lastActive: nowMs(),
    poker: null,
    simulated: (kind === KINDS.OFFCHAIN),
    stakes: (kind===KINDS.ONCHAIN_LIMIT) ? { limit:true, sb:3, bb:6 } : { limit:false },
    emptySince: null,
  };
  tables.set(id, t);
  return t;
}

function createNewTable(kind){
  const n = nextIndexForKind(kind);
  const id = makeId(kind, n);
  const t = {
    id, kind,
    label: id,
    seats: Array.from({length:TABLE_CAPACITY}, ()=>null),
    started: false,
    lastActive: nowMs(),
    poker: null,
    simulated: (kind === KINDS.OFFCHAIN),
    stakes: (kind===KINDS.ONCHAIN_LIMIT) ? { limit:true, sb:3, bb:6 } : { limit:false },
    emptySince: null,
  };
  tables.set(id, t);
  return t;
}

/* --------------------------- Poker state (minimal) -------------------------- */

function makeDeck(){
  const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const suits = ['h','d','c','s'];
  const deck = [];
  for (const r of ranks) for (const s of suits) deck.push(r+s);
  for (let i=deck.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]] = [deck[j],deck[i]];
  }
  return deck;
}

function emitTableUpdate(t){ io.to(t.id).emit('table:update', { id:t.id, seats:t.seats.map(s=>s&&{id:s.id,addr:s.addr,ready:!!s.ready}), started:!!t.started, simulated:!!t.simulated }); }

function startHand(t){
  // minimal preflop w/ blinds; (no raises implemented in this server cut)
  const actors = t.seats.map((s,i)=> s && ({ addr:s.addr, seatId:i, folded:false, acted:false, contrib:0 })).filter(Boolean);
  if (actors.length < 2) return;

  const deck = makeDeck();
  const SB = 1, BB = 2;
  const dealerIndex = 0;
  const sbIndex = (dealerIndex + 1) % actors.length;
  const bbIndex = (dealerIndex + 2) % actors.length;

  actors[sbIndex].contrib = SB;
  actors[bbIndex].contrib = BB;

  const toCall = BB;
  const pot = SB + BB;

  actors.forEach(a => { a.cards = [deck.pop(), deck.pop()]; });

  let turnIndex = (bbIndex + 1) % actors.length;
  if (actors.length === 2) turnIndex = sbIndex;

  t.poker = {
    stage: 'preflop',
    deck,
    community: [],
    actors,
    dealerIndex, sbIndex, bbIndex,
    toCall,
    pot,
    turnIndex,
    startedAt: nowMs(),
  };

  // send hole cards privately
  actors.forEach(a => {
    try {
      const seat = t.seats[a.seatId];
      if (seat?.socketId){
        io.to(seat.socketId).emit('poker:hole', { cards: Array.from(a.cards||[]), seatId: a.seatId, tableId: t.id });
      }
    } catch {}
  });

  // broadcast public state
  io.to(t.id).emit('poker:state', {
    stage: 'preflop',
    pot, toCall,
    community: [],
    turnIndex,
    dealerIndex,
    actors: actors.map((a,i)=>({ addr:a.addr, seatId:a.seatId, folded:!!a.folded, acted:!!a.acted, contrib:Number(a.contrib||0), isDealer:(i===dealerIndex), isSB:(i===sbIndex), isBB:(i===bbIndex) })),
    table: { id:t.id, seats:t.seats.map(s=>s&&{id:s.id,addr:s.addr,ready:!!s.ready}), simulated: !!t.simulated }
  });
}

/* ------------------------- Category policy enforcement ---------------------- */

function ensureCategory(kind){
  // 1) Ensure at least one table exists
  let list = listByKind(kind);
  if (list.length === 0) createNewTable(kind);

  // 2) Spawn new if any table reaches SPAWN_THRESHOLD seated
  list = listByKind(kind);
  const needSpawn = list.some(t => seatCount(t) >= SPAWN_THRESHOLD);
  if (needSpawn) createNewTable(kind);

  // 3) Prune: if two or more tables are empty, start aging and prune one after PRUNE_IDLE_SEC
  list = listByKind(kind);
  const empties = list.filter(t => seatCount(t) === 0);
  const nonEmpties = list.filter(t => seatCount(t) > 0);

  const now = nowMs();
  empties.forEach(t => { if (!t.emptySince) t.emptySince = now; });

  if (empties.length >= 2) {
    // pick the oldest empty that aged long enough, but never prune to below 1 table
    const pruneable = empties
      .filter(t => (now - (t.emptySince||now)) >= PRUNE_IDLE_SEC*1000)
      .sort((a,b)=> (a.emptySince||0) - (b.emptySince||0));
    if (pruneable.length && list.length > 1) {
      const victim = pruneable[0];
      tables.delete(victim.id);
    }
  }

  // Reset emptySince for tables that aren't empty anymore
  nonEmpties.forEach(t => { t.emptySince = null; });
}

function enforceAllCategories(){
  ensureCategory(KINDS.ONCHAIN_LIMIT);
  ensureCategory(KINDS.ONCHAIN_NL);
  ensureCategory(KINDS.OFFCHAIN);
  emitLobbyFull();
}

/* ------------------------------ Bot management ----------------------------- */

function humansAt(t){
  return t.seats.filter(s=> s && typeof s.addr==='string' && !s.addr.startsWith('bot:')).length;
}
function botIndex(t){
  return t.seats.findIndex(s=> s && typeof s.addr==='string' && s.addr.startsWith('bot:'));
}

function enforceBot(t){
  if (t.kind !== KINDS.OFFCHAIN){
    // never allow bot outside offchain
    const bi = botIndex(t);
    if (bi >= 0) t.seats[bi] = null;
    return;
  }
  const h = humansAt(t);
  const bi = botIndex(t);

  if (h <= 0){
    if (bi >= 0) t.seats[bi] = null;
    return;
  }

  if (h === 1){
    // ensure one bot seated
    if (bi === -1){
      const slot = t.seats.findIndex(s=>!s);
      if (slot >= 0){
        t.seats[slot] = { id: slot, addr: 'bot:auto', ready: false, balance: 0, lastActive: nowMs(), socketId: 'bot' };
      }
    }
  } else {
    // 2+ humans => remove bot
    if (bi >= 0) t.seats[bi] = null;
  }
}

/* --------------------------------- Lobby ----------------------------------- */

function emitLobbyFull(){
  const pack = {
    onchain: {
      limit:  listByKind(KINDS.ONCHAIN_LIMIT).map(publicRow),
      nolimit: listByKind(KINDS.ONCHAIN_NL).map(publicRow),
    },
    offchain: listByKind(KINDS.OFFCHAIN).map(publicRow),
  };
  io.emit('lobby:full', pack);
}

/* --------------------------------- Sockets --------------------------------- */

io.on('connection', (socket) => {
  let currentTableId = null;
  let addrLower = null;

  socket.on('identify', (m) => {
    try { addrLower = String(m.addr||'').toLowerCase(); } catch {}
  });

  socket.on('lobby:get_full', () => {
    try { enforceAllCategories(); } catch {}
  });

  socket.on('join_table', (m) => {
    try {
      const req = String(m.table||m.tableId||'').trim();
      let t = req && tables.get(req);
      if (!t){
        // default: prefer onchain limit
        t = getOrCreate(KINDS.ONCHAIN_LIMIT);
      }
      if (currentTableId) socket.leave(currentTableId);
      currentTableId = t.id;
      socket.join(t.id);
      t.lastActive = nowMs();
      emitTableUpdate(t);
      // after any join, refresh lobby
      emitLobbyFull();
    } catch {}
  });

  socket.on('seat', (m) => {
    try {
      if (!currentTableId) return;
      const t = tables.get(currentTableId); if (!t) return;
      const idx = Number(m.index);
      const before = seatCount(t);

      if (idx === -1){
        const curIdx = t.seats.findIndex(s => s && s.addr === addrLower);
        if (curIdx >= 0) { t.seats[curIdx] = null; }
      } else if (idx >= 0 && idx < TABLE_CAPACITY){
        if (!t.seats[idx]) {
          t.seats[idx] = { id: idx, addr: addrLower, ready: false, balance: 0, lastActive: nowMs(), socketId: socket.id };
        }
      }

      // bot rules + category housekeeping
      enforceBot(t);
      t.lastActive = nowMs();

      const after = seatCount(t);
      if (!t.started && before===0 && after>0) t.started = true;

      emitTableUpdate(t);
      enforceAllCategories();
    } catch {}
  });

  socket.on('ready', (m) => {
    try {
      if (!currentTableId) return;
      const t = tables.get(currentTableId); if (!t) return;
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (s) { s.ready = !!m.ready; s.lastActive = nowMs(); }

      // if single human + bot in OFFCHAIN, mirror bot's ready to the human's to avoid double-toggle
      if (t.kind === KINDS.OFFCHAIN){
        const hCount = humansAt(t);
        const bi = botIndex(t);
        if (hCount === 1 && bi >= 0){
          t.seats[bi].ready = !!m.ready;
        }
      }

      t.lastActive = nowMs();
      emitTableUpdate(t);

      const active = t.seats.filter(Boolean);
      const allReady = active.length && active.every(x => !!x.ready);

      if (allReady && active.length >= 2 && !t.poker){
        startHand(t);
      }
    } catch {}
  });

  socket.on('disconnect', () => {
    try {
      if (!addrLower) return;
      for (const [, t] of tables.entries()){
        let changed = false;
        for (let i=0;i<t.seats.length;i++){
          const s = t.seats[i];
          if (s && (s.addr === addrLower || s.socketId === socket.id)){
            t.seats[i] = null;
            changed = true;
          }
        }
        if (changed){
          enforceBot(t);
          t.lastActive = nowMs();
          emitTableUpdate(t);
        }
      }
      enforceAllCategories();
    } catch {}
  });

  // Admin minimal
  socket.on('admin:shutdown', () => {
    try { if (!admins.has(addrLower)) return; setTimeout(()=>process.exit(0), 100); } catch {}
  });
});

/* ------------------------------ Background jobs ---------------------------- */

setInterval(() => {
  try { enforceAllCategories(); } catch {}
}, 10_000);

/* --------------------------------- Listen ---------------------------------- */

server.listen(PORT, () => {
  console.log('Poker RT server on', PORT, '| cap:', TABLE_CAPACITY, '| spawn>=', SPAWN_THRESHOLD, '| prune>=', PRUNE_IDLE_SEC,'s');
});
