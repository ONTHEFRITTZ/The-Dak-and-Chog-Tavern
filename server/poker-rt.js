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

const ADDR_ROOM_PREFIX = 'addr:';

// Minimal isolated state (no reuse)
// tableId -> {
//   id,
//   seats: [null|{id,addr,ready,lastActive,socketId,chips:number}],
//   lastActive,
//   started?: boolean,
//   poker?: {
//     stage: 'preflop'|'flop'|'turn'|'river',
//     deck: string[],
//     community: string[],
//     actors: Array<{ addr:string, seatId:number, folded:boolean, acted:boolean, contrib:number, cards?:string[] }>,
//     dealerIndex:number, sbIndex:number, bbIndex:number,
//     dealerSeatId:number,
//     pot:number,
//     toCall:number,
//     turnIndex:number,
//     startedAt:number,
//     botTimer?: any,
//   }
// }
const tables = new Map();

function now() { return Date.now(); }
function getTable(id) {
  if (!tables.has(id)) {
    // Default: no bot seated, dev bot disabled
    tables.set(id, { id, seats: Array.from({length:8}, () => null), lastActive: now(), started: false, poker: null, devBotEnabled: false, simMode: false });
  }
  return tables.get(id);
}
function seatCount(t) { return t.seats.filter(Boolean).length; }
function tablePublic(t) {
  return {
    id: t.id,
    seats: t.seats.map(s => s && ({ id: s.id, addr: s.addr, ready: !!s.ready, lastActive: Number(s.lastActive||0), chips: Number(s.chips||0) })),
    started: !!t.started,
    simulated: !!t.simMode,
    devBotEnabled: !!t.devBotEnabled,
  };
}
function emitLobby() {
  const list = Array.from(tables.values()).map(t => ({ id: t.id, seated: seatCount(t), capacity: 8, started: false }));
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
    try { if (addrLower) socket.join(ADDR_ROOM_PREFIX + addrLower); } catch {}
    // If this socket belongs to an already seated player, refresh their seat.socketId
    try {
      if (addrLower) {
        for (const [tid, t] of tables) {
          const i = t.seats.findIndex(s => s && s.addr === addrLower);
          if (i >= 0) { t.seats[i].socketId = socket.id; t.lastActive = now(); emitUpdate(t); }
        }
      }
    } catch {}
    socket.emit('rt:state', { ok: true, game: 'POKER' });
  });

  socket.on('lobby:get', () => { try { emitLobby(); } catch {} });
  // Allow client to request current poker state snapshot
  socket.on('poker:get', () => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      if (t && t.poker) emitPokerState(currentTableId, t);
    } catch {}
  });

  // Allow client to request a fresh snapshot of a table immediately
  socket.on('table:get', (m) => {
    try {
      const req = String(m?.table||m?.tableId||'poker-1');
      const tableId = tables.has(req) ? req : 'poker-1';
      const t = getTable(tableId);
      // Refresh seat.socketId for this table if already seated under this address
      try { if (addrLower) { const i = t.seats.findIndex(s => s && s.addr === addrLower); if (i >= 0) t.seats[i].socketId = socket.id; } } catch {}
      socket.emit('table:update', tablePublic(t));
    } catch {}
  });

  socket.on('join_table', (m) => {
    try {
      const req = String(m?.table||m?.tableId||'poker-1');
      const tableId = tables.has(req) ? req : 'poker-1';
      if (currentTableId) socket.leave(currentTableId);
      currentTableId = tableId;
      socket.join(tableId);
      const t = getTable(tableId);
      // Universal clean state on page load: if no hand is active, never keep a bot seated
      try {
        if (!t.poker) {
          let changed = false;
          for (let i=0;i<t.seats.length;i++){
            const s=t.seats[i]; if (s && typeof s.addr==='string' && s.addr.startsWith('bot:')) { t.seats[i]=null; changed=true; }
          }
          if (t.devBotEnabled) { t.devBotEnabled = false; changed = true; }
          if (t.simMode) { t.simMode = false; changed = true; }
          if (changed) { io.to(tableId).emit('poker:mode', { simulated: false }); }
        }
      } catch {}
      try {
        if (!t.devBotEnabled) {
          for (let i = 0; i < t.seats.length; i++) {
            const s = t.seats[i];
            if (s && typeof s.addr === 'string' && s.addr.startsWith('bot:')) {
              t.seats[i] = null;
            }
          }
        }
      } catch {}
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
        const cur = t.seats.findIndex(s => s && (s.addr === addrLower || s.socketId === socket.id));
        if (cur >= 0) t.seats[cur] = null;
      } else if (idx >= 0 && idx < t.seats.length) {
        // Enforce single seat per address/socket
        try { const cur = t.seats.findIndex(s => s && (s.addr === addrLower || s.socketId === socket.id)); if (cur >= 0) t.seats[cur] = null; } catch {}
        if (!t.seats[idx]) t.seats[idx] = { id: idx, addr: addrLower || null, ready: false, lastActive: now(), socketId: socket.id, chips: 100 };
        if (!t.started) {
          t.started = true;
        }
      }
      // Enforce bot policy: bot only active when exactly one human seated and devBotEnabled
      try {
        const humans = t.seats.filter(s => s && typeof s.addr === 'string' && !s.addr.startsWith('bot:')).length;
        const botIdx = t.seats.findIndex(s => s && typeof s.addr === 'string' && s.addr.startsWith('bot:'));
        if (humans >= 2 && botIdx >= 0) {
          t.seats[botIdx] = null; t.devBotEnabled = false; t.simMode = false;
          io.to(currentTableId).emit('poker:mode', { simulated: false });
          io.to(currentTableId).emit('system', 'A second player joined. Exiting simulated mode.');
        } else if (humans === 1 && t.devBotEnabled && botIdx === -1) {
          const slot = t.seats.findIndex(s => !s);
          if (slot >= 0) {
            t.seats[slot] = { id: slot, addr: 'bot:dev', ready: true, balance: 0, lastActive: now(), socketId: 'bot', chips: 100 };
            t.simMode = true;
            io.to(currentTableId).emit('poker:mode', { simulated: true });
            io.to(currentTableId).emit('system', 'Simulated mode enabled (bot joined).');
          }
        }
      } catch {}
      // If no humans remain, fully reset table state and ensure no bot remains
      try {
        const humansNow = t.seats.filter(s => s && typeof s.addr === 'string' && !s.addr.startsWith('bot:')).length;
        if (humansNow === 0) {
          // Clear any active hand and notify clients to clear board
          if (t.poker) {
            try {
              const board = Array.from(t.poker.community||[]);
              io.to(currentTableId).emit('poker:hand', { winners: [], community: board, exposures: [], pot: t.poker.pot||0, table: tablePublic(t) });
            } catch {}
            t.poker = null;
          }
          // Remove any bot and disable sim/dev flags
          for (let i = 0; i < t.seats.length; i++) {
            const s = t.seats[i]; if (s && typeof s.addr === 'string' && s.addr.startsWith('bot:')) { t.seats[i] = null; }
          }
          t.devBotEnabled = false; t.simMode = false;
          io.to(currentTableId).emit('poker:mode', { simulated: false });
        }
      } catch {}
      t.lastActive = now();
      emitUpdate(t);
      emitLobby();
    } catch {}
  });

  socket.on('ready', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const si = t.seats.findIndex(x => x && (x.addr === addrLower || x.socketId === socket.id));
      if (si >= 0) { t.seats[si].ready = !!m?.ready; t.seats[si].lastActive = now(); }
      // If dev bot is enabled, ensure bot present and marked ready to allow solo starts
      try {
        if (t.devBotEnabled) {
          let botIdx = t.seats.findIndex(u => u && typeof u.addr === 'string' && u.addr.startsWith('bot:'));
          if (botIdx === -1) {
            const slot = t.seats.findIndex(u => !u);
            if (slot >= 0) { t.seats[slot] = { id: slot, addr: 'bot:dev', ready: true, balance: 0, lastActive: now(), socketId: 'bot', chips: 100 }; botIdx = slot; }
          } else {
            try { t.seats[botIdx].ready = true; } catch {}
          }
          // Enable simulated mode flag and notify clients
          t.simMode = true; io.to(currentTableId).emit('poker:mode', { simulated: true });
        }
      } catch {}
      t.lastActive = now();
      emitUpdate(t);
      // If all seated are ready, and at least 2 players, start a hand
      const active = t.seats.filter(Boolean);
      const allReady = active.length && active.every(x => !!x.ready);
      // Robust: if solo vs bot, start immediately once human clicked Ready and bot is present
      try {
        const humans = t.seats.filter(u => u && typeof u.addr === 'string' && !u.addr.startsWith('bot:')).length;
        const botPresent = t.seats.some(u => u && typeof u.addr === 'string' && u.addr.startsWith('bot:'));
        if (!t.poker && botPresent && humans === 1) {
          startPokerHand(currentTableId, t);
          return;
        }
      } catch {}
      if (allReady && active.length >= 2 && !t.poker) {
        startPokerHand(currentTableId, t);
      }
    } catch {}
  });

  socket.on('health', () => { try { socket.emit('health', { ok: true, now: Date.now(), game: 'POKER' }); } catch {} });

  // Toggle a simple dev bot to enable solo testing
  socket.on('poker:devbot', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const enabled = !!m?.enabled;
      // Allow enabling only when exactly one human is seated at this table
      const humans = t.seats.filter(s => s && typeof s.addr === 'string' && !s.addr.startsWith('bot:')).length;
      if (enabled && humans !== 1) {
        // Reject enabling when not solo
        t.devBotEnabled = false;
        io.to(currentTableId).emit('poker:mode', { simulated: false });
        io.to(currentTableId).emit('system', 'Dev Bot can only be enabled when you are alone at the table.');
        emitUpdate(t); emitLobby();
        return;
      }
      t.devBotEnabled = enabled;
      const botIdx = t.seats.findIndex(s => s && typeof s.addr === 'string' && s.addr.startsWith('bot:'));
      if (enabled) {
        if (botIdx === -1) {
          const slot = t.seats.findIndex(s => !s);
          if (slot >= 0) {
            t.seats[slot] = { id: slot, addr: 'bot:dev', ready: true, balance: 0, lastActive: now(), socketId: 'bot', chips: 100 };
          }
        } else {
          try { t.seats[botIdx].ready = true; } catch {}
        }
        t.simMode = true;
        io.to(currentTableId).emit('poker:mode', { simulated: true });
        io.to(currentTableId).emit('system', 'Simulated mode: on-chain betting disabled while bot is active.');
      } else {
        if (botIdx >= 0) t.seats[botIdx] = null;
        try { if (t.poker?.botTimer) { clearTimeout(t.poker.botTimer); t.poker.botTimer = null; } } catch {}
        t.simMode = false;
        io.to(currentTableId).emit('poker:mode', { simulated: false });
        io.to(currentTableId).emit('system', 'Simulated mode disabled.');
      }
      t.lastActive = now();
      emitUpdate(t);
      emitLobby();
    } catch {}
  });

  // Minimal Texas Hold'em flow (fold/check/call only)
  socket.on('poker:act', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const state = t.poker; if (!state) return;
      const turn = state.turnIndex;
      const actor = state.actors?.[turn];
      if (!actor) return;
      // Permission: either address matches, or the seat's socketId matches this socket
      try {
        const seat = t.seats[actor.seatId];
        const allowed = (actor.addr === addrLower) || (seat && seat.socketId === socket.id);
        if (!allowed) return;
      } catch { return; }
      const action = String(m?.action||'').toLowerCase();
      const amount = Math.max(0, Number(m?.amount||0)|0);
      const need = Math.max(0, Number(state.toCall||0) - Number(actor.contrib||0));
      const minRaise = Math.max(state.minRaise||state.bb||2, 1);
      const canAct = !actor.allIn && !actor.folded;
      if (!canAct) return;
      if (action === 'fold') {
        actor.folded = true; actor.acted = true;
        const alive = state.actors.filter(a => !a.folded);
        if (alive.length === 1) { endPokerByShowdown(currentTableId, t, alive.map(a => a.addr)); return; }
      } else if (action === 'check') {
        if (need > 0) return; // cannot check facing a bet
        actor.acted = true;
      } else if (action === 'call') {
        const pay = Math.min(need, actor.stack);
        actor.stack -= pay; actor.contrib = Number(actor.contrib||0) + pay; actor.invested = Number(actor.invested||0) + pay; actor.acted = true;
        if (actor.stack === 0) actor.allIn = true;
      } else if (action === 'bet') {
        if (state.toCall > 0) return; // bet only when no bet
        let betAmt = Math.max(amount, state.bb||2);
        betAmt = Math.min(betAmt, actor.stack);
        if (betAmt <= 0) return;
        actor.stack -= betAmt; actor.contrib = Number(actor.contrib||0) + betAmt; actor.invested = Number(actor.invested||0) + betAmt; actor.acted = true;
        state.toCall = actor.contrib;
        state.lastAgg = betAmt;
        state.minRaise = betAmt; // next raise must be at least this size
        if (actor.stack === 0) actor.allIn = true;
        // reset others acted=false to continue round
        state.actors.forEach((a,i)=>{ if (i!==state.turnIndex && !a.folded && !a.allIn) a.acted = false; });
      } else if (action === 'raise') {
        if (state.toCall <= 0) return; // must be facing a bet
        let raiseBy = Math.max(amount, minRaise);
        let target = Number(state.toCall||0) + raiseBy;
        let needCall = Math.max(0, Number(state.toCall||0) - Number(actor.contrib||0));
        let totalPay = needCall + raiseBy;
        if (totalPay > actor.stack) {
          // all-in raise; set target to actor.contrib + stack
          totalPay = actor.stack; target = Number(actor.contrib||0) + totalPay; raiseBy = Math.max(0, target - Number(state.toCall||0));
        }
        if (totalPay <= needCall) return; // must raise beyond call
        actor.stack -= totalPay; actor.contrib = Number(actor.contrib||0) + totalPay; actor.invested = Number(actor.invested||0) + totalPay; actor.acted = true;
        if (actor.stack === 0) actor.allIn = true;
        state.toCall = target;
        state.lastAgg = raiseBy;
        state.minRaise = Math.max(raiseBy, minRaise);
        state.actors.forEach((a,i)=>{ if (i!==state.turnIndex && !a.folded && !a.allIn) a.acted = false; });
      } else {
        return;
      }
      // advance turn to next active non-folded
      state.turnIndex = nextActiveIndex(state.actors, state.turnIndex);
      if (bettingRoundComplete(state)) { advancePokerStage(currentTableId, t); return; }
      emitPokerState(currentTableId, t);
      maybeTriggerBot(currentTableId, t);
    } catch {}
  });

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
        // If table lost a player, enforce bot policy and clear any dangling hand when no humans remain
        if (changed) {
          try {
            const humans = t.seats.filter(s => s && typeof s.addr === 'string' && !s.addr.startsWith('bot:')).length;
            // Remove bot when 0 humans, and reset simulated flags
            if (humans === 0) {
              if (t.poker) {
                try { io.to(id).emit('poker:hand', { winners: [], community: Array.from(t.poker.community||[]), exposures: [], pot: t.poker.pot||0, table: tablePublic(t) }); } catch {}
                t.poker = null;
              }
              for (let j=0;j<t.seats.length;j++) { const u=t.seats[j]; if (u && typeof u.addr==='string' && u.addr.startsWith('bot:')) t.seats[j]=null; }
              t.devBotEnabled = false; t.simMode = false; io.to(id).emit('poker:mode', { simulated:false });
            }
            // If 2+ humans remain, also ensure bot is removed
            if (humans >= 2) {
              for (let j=0;j<t.seats.length;j++) { const u=t.seats[j]; if (u && typeof u.addr==='string' && u.addr.startsWith('bot:')) t.seats[j]=null; }
              t.devBotEnabled = false; t.simMode = false; io.to(id).emit('poker:mode', { simulated:false });
            }
          } catch {}
          t.lastActive = now();
          emitUpdate(t); emitLobby();
        }
      }
    } catch {}
  });
});

setInterval(() => { try { emitLobby(); } catch {} }, 15_000);

server.listen(PORT, () => console.log('Poker RT on', PORT));

// ---------------- Poker helpers and state machine (minimal) -----------------
function makeDeck() {
  const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const suits = ['h','d','c','s'];
  const deck = [];
  for (const r of ranks) for (const s of suits) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}

function emitPokerState(tableId, t) {
  try {
    const state = t.poker; if (!state) return;
    const pubActors = state.actors.map((a, i) => ({ addr: a.addr, seatId: a.seatId, folded: !!a.folded, acted: !!a.acted, contrib: Number(a.contrib||0), stack: Number(a.stack||0), allIn: !!a.allIn, isDealer: (i===state.dealerIndex), isSB: (i===state.sbIndex), isBB: (i===state.bbIndex) }));
    let turnSocketId = null;
    try {
      const cur = state.actors?.[state.turnIndex];
      const seat = cur ? t.seats[cur.seatId] : null;
      turnSocketId = seat ? seat.socketId || null : null;
    } catch {}
    io.to(tableId).emit('poker:state', {
      stage: state.stage,
      pot: Number(state.pot||0),
      toCall: Number(state.toCall||0),
      minRaise: Number(state.minRaise||0),
      community: Array.from(state.community||[]),
      turnIndex: state.turnIndex,
      turnAddr: state.actors?.[state.turnIndex]?.addr || null,
      turnSocketId,
      dealerIndex: state.dealerIndex,
      actors: pubActors,
      table: tablePublic(t),
    });
  } catch {}
}

function nextActiveIndex(actors, from) {
  if (!actors.length) return -1;
  let i = (from + 1) % actors.length;
  let spins = 0;
  while (spins < actors.length) { if (!actors[i]?.folded) return i; i = (i + 1) % actors.length; spins++; }
  return -1;
}

function bettingRoundComplete(state) {
  const target = Number(state.toCall||0);
  return state.actors.filter(a => !a.folded && !a.allIn).every(a => a.acted && Number(a.contrib||0) === target);
}

function startPokerHand(tableId, t) {
  try {
    const seated = t.seats.map((s,i)=> s && ({ seatId:i, addr:s.addr })).filter(Boolean);
    if (seated.length < 2) return;
    const prev = t.poker?.dealerSeatId;
    let dealerSeatId;
    if (typeof prev === 'number') { const idx = seated.findIndex(x => x.seatId === prev); dealerSeatId = seated[(idx >= 0 ? (idx + 1) % seated.length : 0)].seatId; }
    else { dealerSeatId = seated[0].seatId; }
    const startIdx = seated.findIndex(x => x.seatId === dealerSeatId);
    const ordered = seated.slice(startIdx).concat(seated.slice(0, startIdx));
    const actors = ordered.map(p => ({ addr:p.addr, seatId:p.seatId, folded:false, acted:false, contrib:0, stack:0, allIn:false, invested:0 }));
    const deck = makeDeck();
    const community = [];
    const SB = 1, BB = 2;
    const dealerIndex = 0;
    const sbIndex = (dealerIndex + 1) % actors.length;
    const bbIndex = (dealerIndex + 2) % actors.length;
    // Initialize stacks from seats and post blinds from stacks
    actors.forEach(a => { const seat=t.seats[a.seatId]; a.stack = Math.max(0, Number(seat?.chips||0)); a.contrib=0; a.acted=false; a.folded=false; a.allIn=false; });
    const postSB = Math.min(SB, actors[sbIndex].stack); actors[sbIndex].stack -= postSB; actors[sbIndex].contrib = postSB; actors[sbIndex].invested += postSB; if (actors[sbIndex].stack===0) actors[sbIndex].allIn = true;
    const postBB = Math.min(BB, actors[bbIndex].stack); actors[bbIndex].stack -= postBB; actors[bbIndex].contrib = postBB; actors[bbIndex].invested += postBB; if (actors[bbIndex].stack===0) actors[bbIndex].allIn = true;
    let toCall = Math.max(actors[sbIndex].contrib, actors[bbIndex].contrib);
    let pot = postSB + postBB;
    actors.forEach(a => { a.cards = [deck.pop(), deck.pop()]; });
    let turnIndex = (bbIndex + 1) % actors.length; if (actors.length === 2) turnIndex = sbIndex;
    t.poker = { stage:'preflop', deck, community, actors, dealerIndex, sbIndex, bbIndex, dealerSeatId, pot, toCall, sb:SB, bb:BB, minRaise:BB, lastAgg:BB, turnIndex, startedAt: now() };
    emitPokerState(tableId, t);
    // Send private hole cards to each player address room
    try {
      actors.forEach(a => {
        const room = ADDR_ROOM_PREFIX + String(a.addr||'');
        io.to(room).emit('poker:cards', { tableId, hole: Array.from(a.cards||[]) });
      });
    } catch {}
    maybeTriggerBot(tableId, t);
    // Solo play should progress via normal betting (no auto-simulation)
  } catch {}
}

function advancePokerStage(tableId, t) {
  try {
    const state = t.poker; if (!state) return;
    const actors = state.actors;
    // Add current contribs to pot, reset round
    try { const add = actors.reduce((s,a)=> s + Number(a.contrib||0), 0); state.pot = Number(state.pot||0) + add; } catch {}
    actors.forEach(a => { a.acted = false; a.contrib = 0; });
    state.toCall = 0; state.lastAgg = 0; state.minRaise = state.bb||2;
    if (state.stage === 'preflop') { state.community.push(state.deck.pop(), state.deck.pop(), state.deck.pop()); state.stage = 'flop'; }
    else if (state.stage === 'flop') { state.community.push(state.deck.pop()); state.stage = 'turn'; }
    else if (state.stage === 'turn') { state.community.push(state.deck.pop()); state.stage = 'river'; }
    else if (state.stage === 'river') {
    // Final add of contribs then showdown with side pots
      try { const add2 = actors.reduce((s,a)=> s + Number(a.contrib||0), 0); state.pot = Number(state.pot||0) + add2; } catch {}
      endPokerWithSidePots(tableId, t);
      return;
    }
    let idx = (state.dealerIndex + 1) % actors.length; // left of dealer
    let spins = 0; while (actors[idx]?.folded && spins < actors.length) { idx = (idx + 1) % actors.length; spins++; }
    state.turnIndex = idx;
    emitPokerState(tableId, t);
    maybeTriggerBot(tableId, t);
    // Solo play should progress via normal betting (no auto-simulation)
  } catch {}
}

// Fallback guard: if solo vs bot and stage did not advance from preflop within 1.6s, force progress
function ensureSoloProgressFallback(tableId, t) {
  try {
    const state = t.poker; if (!state) return;
    const seats = t.seats || [];
    const humans = seats.filter(s => s && typeof s.addr === 'string' && !String(s.addr).startsWith('bot:')).length;
    const botPresent = seats.some(s => s && typeof s.addr === 'string' && String(s.addr).startsWith('bot:'));
    if (!(botPresent && humans === 1)) return;
    setTimeout(() => { try { const st = t.poker; if (st && st.stage === 'preflop') advancePokerStage(tableId, t); } catch {} }, 1600);
  } catch {}
}

// Utility: detect 1 human + at least 1 bot
function isSoloVsBot(t) {
  try {
    const seats = t.seats || [];
    const humans = seats.filter(s => s && typeof s.addr === 'string' && !String(s.addr).startsWith('bot:')).length;
    const botPresent = seats.some(s => s && typeof s.addr === 'string' && String(s.addr).startsWith('bot:'));
    return botPresent && humans === 1;
  } catch { return false; }
}

// Simulate check/call flow for solo vs bot so betting rounds complete naturally
function simResolveBetting(tableId, t) {
  try {
    const state = t.poker; if (!state) return;
    if (!isSoloVsBot(t)) return;
    if (bettingRoundComplete(state)) { advancePokerStage(tableId, t); return; }
    const turn = state.turnIndex;
    const actor = state.actors?.[turn]; if (!actor) return;
    const need = Math.max(0, Number(state.toCall||0) - Number(actor.contrib||0));
    const isBot = typeof actor.addr === 'string' && actor.addr.startsWith('bot:');
    // Default behavior: if facing no bet, check; otherwise call up to need (or all-in)
    const act = () => {
      if (need === 0) {
        actor.acted = true;
      } else {
        const pay = Math.min(need, actor.stack);
        actor.stack -= pay; actor.contrib = Number(actor.contrib||0) + pay; actor.invested = Number(actor.invested||0) + pay; actor.acted = true;
        if (actor.stack === 0) actor.allIn = true;
      }
      state.turnIndex = nextActiveIndex(state.actors, state.turnIndex);
      emitPokerState(tableId, t);
      if (bettingRoundComplete(state)) { advancePokerStage(tableId, t); return; }
      setTimeout(() => { try { simResolveBetting(tableId, t); } catch {} }, 350);
    };
    // Small delay for UX, a touch longer for bot to look natural
    setTimeout(act, isBot ? 420 : 320);
  } catch {}
}

// Force-complete the current betting round in solo vs bot by simulating calls/checks for all actors
function forceCompleteRound(tableId, t, delayMs) {
  try {
    const state = t.poker; if (!state) return;
    setTimeout(() => {
      try {
        const st = t.poker; if (!st) return;
        if (!isSoloVsBot(t)) return;
        if (bettingRoundComplete(st)) return;
        const target = Number(st.toCall||0);
        st.actors.forEach((a) => {
          if (a.folded || a.allIn) return;
          const need = Math.max(0, target - Number(a.contrib||0));
          if (need > 0) {
            const pay = Math.min(need, a.stack);
            a.stack -= pay; a.contrib = Number(a.contrib||0) + pay; a.invested = Number(a.invested||0) + pay; if (a.stack===0) a.allIn = true;
          }
          a.acted = true;
        });
        emitPokerState(tableId, t);
        if (bettingRoundComplete(st)) advancePokerStage(tableId, t);
      } catch {}
    }, Math.max(0, Number(delayMs)||0));
  } catch {}
}

function endPokerByShowdown(tableId, t, winnerAddrs) {
  try {
    const state = t.poker; if (!state) return;
    const winners = Array.isArray(winnerAddrs)&&winnerAddrs.length ? winnerAddrs : [];
    const each = winners.length ? Math.floor(Number(state.pot||0)/winners.length) : 0;
    winners.forEach(addr => {
      const i = state.actors.findIndex(a => a.addr === addr);
      if (i>=0) state.actors[i].stack = Number(state.actors[i].stack||0) + each;
    });
    // write back stacks to seats
    state.actors.forEach(a => { const seat = t.seats[a.seatId]; if (seat) seat.chips = Number(a.stack||0); });
    // compute used cards for winners for client highlight
    const board = Array.from(state.community||[]);
    const winnerList = winners.map(addr => {
      const i = state.actors.findIndex(a => a.addr === addr);
      const hole = i>=0 ? Array.from(state.actors[i].cards||[]) : [];
      const bf = bestFiveRank(hole, board);
      return { addr, amount: each, usedHole: bf.usedHole, usedCommunity: bf.usedCommunity, rank: bf.rank, handName: handNameFromRank(bf.rank), rankName: handNameFromRank(bf.rank) };
    });
    io.to(tableId).emit('poker:hand', { winners: winnerList, community: board, pot: state.pot||0, table: tablePublic(t) });
    // Clear any sim timers
    try { const timers = t.poker && t.poker.simTimers; if (Array.isArray(timers)) timers.forEach(id=>{ try{ clearTimeout(id); }catch{} }); } catch {}
    t.poker = null;
    try { t.seats.filter(Boolean).forEach(s => { s.ready = false; }); } catch {}
    emitUpdate(t);
  } catch {}
}

function endPokerWithSidePots(tableId, t) {
  try {
    const state = t.poker; if (!state) return;
    const actors = state.actors;
    // Build levels from total invested (including folded) > 0
    const levels = Array.from(new Set(actors.map(a => Number(a.invested||0)).filter(v=>v>0))).sort((a,b)=>a-b);
    const board = Array.from(state.community||[]);
    const payouts = new Array(actors.length).fill(0);
    let prev = 0;
    for (const L of levels) {
      const seg = L - prev; if (seg <= 0) { prev = L; continue; }
      // Amount in this segment from each player is min(max(invested-prev,0), seg)
      const contributors = actors.map((a,i)=>({i, amt: Math.max(0, Math.min(seg, Number(a.invested||0) - prev)) })).filter(x=>x.amt>0);
      if (!contributors.length) { prev = L; continue; }
      const potAmt = contributors.reduce((s,x)=> s + x.amt, 0);
      // Eligible winners: not folded and invested > prev
      const elig = actors.map((a,i)=>({i, a})).filter(x => !x.a.folded && Number(x.a.invested||0) > prev);
      if (!elig.length) { prev = L; continue; }
      const holeArr = elig.map(x => x.a.cards);
      const idxArr = elig.map(x => x.i);
      const winIdxs = determineWinners(holeArr, idxArr, board);
      const share = winIdxs.length ? Math.floor(potAmt / winIdxs.length) : 0;
      for (const wi of winIdxs) payouts[wi] += share;
      prev = L;
    }
    // Credit payouts into stacks and write back to seats
    for (let i=0;i<actors.length;i++) { actors[i].stack = Number(actors[i].stack||0) + Number(payouts[i]||0); }
    state.actors.forEach(a => { const seat = t.seats[a.seatId]; if (seat) seat.chips = Number(a.stack||0); });
    const winnerList = payouts.map((amt,i)=> ({ i, amt }))
      .filter(x=>x.amt>0)
      .map(x=> {
        const hole = Array.from(actors[x.i].cards||[]);
        const bf = bestFiveRank(hole, board);
        return { addr: actors[x.i].addr, amount: x.amt, usedHole: bf.usedHole, usedCommunity: bf.usedCommunity, rank: bf.rank, handName: handNameFromRank(bf.rank), rankName: handNameFromRank(bf.rank) };
      });
    // Reveal surviving players' hole cards at showdown for transparency
    const exposures = actors.filter(a => !a.folded).map(a => ({ addr: a.addr, cards: Array.from(a.cards||[]) }));
    io.to(tableId).emit('poker:hand', { winners: winnerList, community: board, exposures, pot: state.pot||0, table: tablePublic(t) });
    // Clear any sim timers
    try { const timers = t.poker && t.poker.simTimers; if (Array.isArray(timers)) timers.forEach(id=>{ try{ clearTimeout(id); }catch{} }); } catch {}
    t.poker = null;
    try { t.seats.filter(Boolean).forEach(s => { s.ready = false; }); } catch {}
    emitUpdate(t);
  } catch {}
}

// Auto-advance community in simulated solo mode (one human + dev bot)
function scheduleSimProgress(tableId, t) {
  try {
    const state = t.poker; if (!state) return;
    const seats = t.seats || [];
    const humans = seats.filter(s => s && typeof s.addr === 'string' && !String(s.addr).startsWith('bot:')).length;
    const botPresent = seats.some(s => s && typeof s.addr === 'string' && String(s.addr).startsWith('bot:'));
    if (!(botPresent && humans === 1)) return;
    // Avoid stacking timers
    if (!state.simTimers) state.simTimers = [];
    // If betting round could block, just force next stage after a short delay
    const delay = 900;
    // Only schedule if not already at river (final)
    if (['preflop','flop','turn'].includes(state.stage)) {
      const id = setTimeout(() => { try { advancePokerStage(tableId, t); } catch {} }, delay);
      state.simTimers.push(id);
    }
  } catch {}
}

// Simple dev bot: auto-acts on its turns
function maybeTriggerBot(tableId, t) {
  try {
    const state = t.poker; if (!state) return;
    const idx = state.actors.findIndex(a => typeof a?.addr === 'string' && a.addr.startsWith('bot:'));
    if (idx === -1) return;
    if (state.turnIndex !== idx) return;
    if (state.actors[idx].folded) return;
    if (state.botTimer) return;
    state.botTimer = setTimeout(() => {
      try {
        state.botTimer = null;
        const actor = state.actors[idx];
        const need = Math.max(0, Number(state.toCall||0) - Number(actor.contrib||0));
        let r = Math.random();
        if (need === 0 && r < 0.15 && actor.stack > (state.bb||2)*2) {
          // bet
          const size = Math.min(actor.stack, (state.bb||2) * (2 + Math.floor(Math.random()*3)));
          actor.stack -= size; actor.contrib += size; actor.acted = true;
          state.toCall = actor.contrib; state.lastAgg = size; state.minRaise = Math.max(size, state.bb||2);
          state.actors.forEach((a,i)=>{ if (i!==idx && !a.folded && !a.allIn) a.acted = false; });
        } else if (need > 0 && r < 0.15 && actor.stack > need + (state.minRaise||2)) {
          // raise
          const raiseBy = Math.min(actor.stack - need, Math.max(state.minRaise||2, (state.bb||2)*2));
          const total = need + raiseBy;
          actor.stack -= total; actor.contrib += total; actor.acted = true;
          state.toCall = actor.contrib; state.lastAgg = raiseBy; state.minRaise = Math.max(raiseBy, state.bb||2);
          state.actors.forEach((a,i)=>{ if (i!==idx && !a.folded && !a.allIn) a.acted = false; });
        } else {
          // check/call/fold default
          if (need === 0) { actor.acted = true; }
          else { const pay = Math.min(need, actor.stack); actor.stack -= pay; actor.contrib += pay; actor.acted = true; if (actor.stack===0) actor.allIn = true; }
        }
        state.turnIndex = nextActiveIndex(state.actors, state.turnIndex);
        if (bettingRoundComplete(state)) { advancePokerStage(tableId, t); return; }
        emitPokerState(tableId, t);
        maybeTriggerBot(tableId, t);
      } catch {}
    }, 700 + Math.floor(Math.random()*900));
  } catch {}
}

// ---- 7-card evaluator
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RVAL = Object.fromEntries(RANKS.map((r,i)=>[r, i+2]));
const RANK_ALIAS = { '10': 'T' };
const SUIT_MAP = { c:'c', C:'c', '\\u2663':'c', d:'d', D:'d', '\\u2666':'d', h:'h', H:'h', '\\u2665':'h', s:'s', S:'s', '\\u2660':'s' };
function parseCard(code){
  try {
    const raw = String(code || '').trim();
    if (!raw) return { r:'', s:'', v:0 };
    const rawSuit = raw.slice(-1);
    const rawRank = raw.slice(0, -1) || raw;
    const suit = SUIT_MAP[rawSuit] || rawSuit.toLowerCase();
    const normalizedRank = (RANK_ALIAS[rawRank.toUpperCase()] || rawRank.toUpperCase());
    const value = RVAL[normalizedRank] || 0;
    return { r: normalizedRank, s: suit, v: value };
  } catch {
    return { r:'', s:'', v:0 };
  }
}
function byvDesc(a,b){ return b.v-a.v; }
function uniqueByRankDesc(cards){ const seen=new Set(); const out=[]; for(const c of cards.sort(byvDesc)){ if(!seen.has(c.v)){ out.push(c); seen.add(c.v);} } return out; }
function straightHigh(cards){
  try {
    const u = uniqueByRankDesc(cards);
    const base = u.map(c=>c.v);
    const seq = base.slice();
    // Ace-low wheel support: treat Ace as 1 in an additional slot
    if (seq.includes(14)) seq.push(1);
    let run = 1;
    let high = 0; // high card of best straight found
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] === seq[i-1] - 1) {
        run++;
        if (run >= 5) {
          // Straight of length >=5 ending at index i; high card is at i-4
          const candHigh = seq[i-4];
          if (candHigh > high) high = candHigh;
        }
      } else if (seq[i] !== seq[i-1]) {
        run = 1;
      }
      // if equal, duplicates were already removed by uniqueByRankDesc
    }
    return high;
  } catch { return 0; }
}
function evaluate7(cards){ const cs = cards.map(parseCard).sort(byvDesc); const bySuit = cs.reduce((m,c)=>{ (m[c.s]=m[c.s]||[]).push(c); return m; },{}); const counts = cs.reduce((m,c)=>{ m[c.v]=(m[c.v]||0)+1; return m; },{}); const groups = Object.entries(counts).map(([v,c])=>({v:Number(v), c})).sort((a,b)=> b.c-a.c || b.v-a.v); let flushSuit=null; for (const s of Object.keys(bySuit)){ if (bySuit[s].length>=5) { flushSuit=s; break; } } if (flushSuit){ const fcs = bySuit[flushSuit].slice(); const hi = straightHigh(fcs); if (hi>0){ return { cls:8, tiebreak:[hi] }; } } if (groups[0]?.c===4){ const kicker = cs.find(c=>c.v!==groups[0].v)?.v||0; return { cls:7, tiebreak:[groups[0].v, kicker] }; } if (groups[0]?.c===3){ const second = groups.find(g=>g.c>=2 && g.v!==groups[0].v); if (second){ return { cls:6, tiebreak:[groups[0].v, second.v] }; } } if (flushSuit){ const top5 = bySuit[flushSuit].slice(0,5).map(c=>c.v); return { cls:5, tiebreak: top5 } } const sh = straightHigh(cs); if (sh>0){ return { cls:4, tiebreak:[sh] }; } if (groups[0]?.c===3){ const kickers = cs.filter(c=>c.v!==groups[0].v).slice(0,2).map(c=>c.v); return { cls:3, tiebreak:[groups[0].v, ...kickers] }; } if (groups[0]?.c===2 && groups[1]?.c===2){ const kicker = cs.find(c=>c.v!==groups[0].v && c.v!==groups[1].v)?.v||0; const hi=Math.max(groups[0].v,groups[1].v), lo=Math.min(groups[0].v,groups[1].v); return { cls:2, tiebreak:[hi, lo, kicker] }; } if (groups[0]?.c===2){ const kickers = cs.filter(c=>c.v!==groups[0].v).slice(0,3).map(c=>c.v); return { cls:1, tiebreak:[groups[0].v, ...kickers] }; } return { cls:0, tiebreak: cs.slice(0,5).map(c=>c.v) }; }
function cmpRank(a,b){ if (!a || !b) return (!a && !b) ? 0 : (a ? 1 : -1); if (a.cls!==b.cls) return a.cls-b.cls; const na=Array.isArray(a.tiebreak)?a.tiebreak.length:0; const nb=Array.isArray(b.tiebreak)?b.tiebreak.length:0; const n=Math.max(na, nb); for (let i=0; i<n; i++){ const av = Number((a.tiebreak||[])[i]) || 0; const bv = Number((b.tiebreak||[])[i]) || 0; if (av !== bv) return av - bv; } return 0; }\r\nfunction rankScore(rank){ try { const cls = Number(rank?.cls) || 0; const tb = Array.isArray(rank?.tiebreak) ? rank.tiebreak : []; const ordered = [cls, Number(tb[0])||0, Number(tb[1])||0, Number(tb[2])||0, Number(tb[3])||0, Number(tb[4])||0]; return ordered.reduce((acc,val)=> acc*100 + val, 0); } catch { return 0; } }
// Compute best 5-card hand from 7 and return rank + used indices
function bestFiveRank(hole, board){
  try {
    const all = Array.from(hole||[]).concat(Array.from(board||[]));
    const idxs = all.map((_,i)=>i);
    let best=null; let bestPick=null;
    function* comb5(arr, start=0, k=5, prefix=[]) {
      if (k===0) { yield prefix; return; }
      for (let i=start; i<=arr.length-k; i++) { yield* comb5(arr, i+1, k-1, prefix.concat([arr[i]])); }
    }
    for (const pick of comb5(idxs)){
      const cards = pick.map(i=> all[i]);
      const rank = evaluate7(cards);
      if (!best || cmpRank(rank, best) > 0){ best = rank; bestPick = pick; }
    }
    const usedHole = []; const usedCommunity = [];
    (bestPick||[]).forEach(i=>{ if (i<2) usedHole.push(i); else usedCommunity.push(i-2); });
    return { rank: best || { cls:0, tiebreak:[0,0,0,0,0] }, usedHole, usedCommunity };
  } catch { return { rank:{ cls:0, tiebreak:[0,0,0,0,0] }, usedHole:[], usedCommunity:[] }; }
}

function handNameFromRank(rank){
  try {
    const cls = Number(rank && rank.cls);
    const hi = (rank && Array.isArray(rank.tiebreak) && rank.tiebreak[0]) || 0;
    if (cls === 8) return (hi===14) ? 'Royal Flush' : 'Straight Flush';
    if (cls === 7) return 'Four of a Kind';
    if (cls === 6) return 'Full House';
    if (cls === 5) return 'Flush';
    if (cls === 4) return 'Straight';
    if (cls === 3) return 'Three of a Kind';
    if (cls === 2) return 'Two Pair';
    if (cls === 1) return 'One Pair';
    return 'High Card';
  } catch { return 'Winner'; }
}

function determineWinners(holeCardsArr, actorIdxs, board){\n  const winners = [];\n  let bestRank = null;\n  let bestScore = null;\n  for (let i = 0; i < holeCardsArr.length; i++){\n    const hole = holeCardsArr[i];\n    const evald = bestFiveRank(hole, board).rank;\n    const score = rankScore(evald);\n    if (bestScore === null || score > bestScore){\n      bestScore = score;\n      bestRank = evald;\n      winners.length = 0;\n      winners.push(actorIdxs[i]);\n    } else if (score === bestScore){\n      const cmp = cmpRank(evald, bestRank);\n      if (cmp > 0){\n        bestScore = score;\n        bestRank = evald;\n        winners.length = 0;\n        winners.push(actorIdxs[i]);\n      } else if (cmp === 0){\n        winners.push(actorIdxs[i]);\n      }\n    }\n  }\n  return winners;\n}

// Determine the best 5-card selection (indices) for a Hold'em hand
function bestFiveUsed(hole, board){
  try {
    const all = Array.from(hole||[]).concat(Array.from(board||[])); // [h0,h1,b0..b4]
    const idxs = all.map((_,i)=>i);
    let best=null; let bestPick=null;
    function* comb5(arr, start=0, k=5, prefix=[]) {
      if (k===0) { yield prefix; return; }
      for (let i=start; i<=arr.length-k; i++) { yield* comb5(arr, i+1, k-1, prefix.concat([arr[i]])); }
    }
    for (const pick of comb5(idxs)){
      const cards = pick.map(i=> all[i]);
      const rank = evaluate7(cards);
      if (!best || cmpRank(rank, best) > 0){ best = rank; bestPick = pick; }
    }
    const usedHole = []; const usedCommunity = [];
    (bestPick||[]).forEach(i=>{ if (i<2) usedHole.push(i); else usedCommunity.push(i-2); });
    return { usedHole, usedCommunity };
  } catch { return { usedHole: [], usedCommunity: [] }; }
}






