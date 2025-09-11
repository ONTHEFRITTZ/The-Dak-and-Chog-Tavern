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
const tables = new Map(); // tableId -> { id, seats: [{id, addr, ready, balance, lastActive}], started, bets: Map(addrLower -> Array<{rank, amount, copper}>), ownerId, lastActive }
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
  // Ensure at least one Faro and one Poker table exist
  if (!Array.from(tables.keys()).some(id => String(id).startsWith('faro-'))) getTable('faro-1');
  if (!Array.from(tables.keys()).some(id => String(id).startsWith('poker-'))) getTable('poker-1');

  const now = nowMs();
  const ids = Array.from(tables.keys()).sort();

  // Prune idle empty Faro tables, keep at least one
  const faroIds = ids.filter(id => String(id).startsWith('faro-'));
  for (const id of faroIds) {
    const t = getTable(id);
    const faroCount = faroIds.length;
    if (seatCount(t) === 0 && (now - (t.lastActive || 0)) > 60_000 && faroCount > 1) {
      tables.delete(id);
    }
  }
  // Prune idle empty Poker tables, keep at least one
  const pokerIds = ids.filter(id => String(id).startsWith('poker-'));
  for (const id of pokerIds) {
    const t = getTable(id);
    const pokerCount = pokerIds.length;
    if (seatCount(t) === 0 && (now - (t.lastActive || 0)) > 60_000 && pokerCount > 1) {
      tables.delete(id);
    }
  }

  // Ensure free seat exists; if all Faro tables are full, create new
  const faroFree = faroIds.some(id => seatCount(getTable(id)) < 6);
  if (!faroFree) getTable(nextTableId());
  // Ensure free seat for Poker; create new poker-N if all full
  const nextPokerTableId = () => {
    const nums = pokerIds.map(id => /^poker-(\d+)$/.exec(id)).filter(Boolean).map(m => Number(m[1]));
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `poker-${next}`;
  };
  const pokerFree = pokerIds.some(id => seatCount(getTable(id)) < 6);
  if (!pokerFree) tables.set(nextPokerTableId(), getTable(nextPokerTableId()));
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
      lastActive: Number(s.lastActive||0),
      // Aggregate bet info for UI
      betTotal: (() => { try { const bs = t.bets.get(String(s.addr||'').toLowerCase()) || []; return bs.reduce((a,b)=>a + Number(b?.amount||0), 0); } catch { return 0; } })(),
      betCount: (() => { try { const bs = t.bets.get(String(s.addr||'').toLowerCase()) || []; return bs.length; } catch { return 0; } })(),
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

// ---------------- Poker helpers (beta state machine) -----------------
function makeDeck() {
  const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const suits = ['h','d','c','s'];
  const deck = [];
  for (const r of ranks) for (const s of suits) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function emitPokerState(tableId, t) {
  try {
    const state = t.poker;
    if (!state) return;
    const pubActors = state.actors.map((a, i) => ({
      addr: a.addr,
      seatId: a.seatId,
      folded: !!a.folded,
      acted: !!a.acted,
      contrib: Number(a.contrib||0),
      isDealer: (i === state.dealerIndex),
      isSB: (i === state.sbIndex),
      isBB: (i === state.bbIndex),
    }));
    io.to(tableId).emit('poker:state', {
      stage: state.stage,
      pot: Number(state.pot||0),
      toCall: Number(state.toCall||0),
      community: Array.from(state.community||[]),
      turnIndex: state.turnIndex,
      turnAddr: state.actors?.[state.turnIndex]?.addr || null,
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
  while (spins < actors.length) {
    if (!actors[i]?.folded) return i;
    i = (i + 1) % actors.length;
    spins++;
  }
  return -1;
}

function anyUnfolded(actors) { return actors.some(a => !a.folded); }

function bettingRoundComplete(state) {
  const target = Number(state.toCall||0);
  return state.actors.filter(a => !a.folded).every(a => a.acted && Number(a.contrib||0) === target);
}

function startPokerHand(tableId, t) {
  try {
    const seated = t.seats.map((s, i) => s && ({ seatId: i, addr: s.addr })).filter(Boolean);
    if (seated.length < 2) return;
    const prev = t.poker?.dealerSeatId;
    let dealerSeatId;
    if (typeof prev === 'number') {
      const idx = seated.findIndex(x => x.seatId === prev);
      dealerSeatId = seated[(idx >= 0 ? (idx + 1) % seated.length : 0)].seatId;
    } else {
      dealerSeatId = seated[0].seatId;
    }
    // Build actors in seating order starting at dealer (inclusive)
    const startIdx = seated.findIndex(x => x.seatId === dealerSeatId);
    const ordered = seated.slice(startIdx).concat(seated.slice(0, startIdx));
    const actors = ordered.map(p => ({ addr: p.addr, seatId: p.seatId, folded: false, acted: false, contrib: 0 }));
    const deck = makeDeck();
    const community = [];
    const pot = 0;
    const SB = 1; // minimal blinds
    const BB = 2;
    // Positions relative to dealer: SB = +1, BB = +2
    const dealerIndex = 0;
    const sbIndex = (dealerIndex + 1) % actors.length;
    const bbIndex = (dealerIndex + 2) % actors.length;
    // Post blinds
    actors[sbIndex].contrib = SB;
    actors[bbIndex].contrib = BB;
    let toCall = BB;
    let newPot = pot + SB + BB;
    // Deal hole cards (not sent to clients in this beta)
    actors.forEach(a => { a.cards = [deck.pop(), deck.pop()]; });
    // Preflop action starts at UTG = left of BB
    let turnIndex = (bbIndex + 1) % actors.length;
    // Heads-up: SB acts first preflop
    if (actors.length === 2) { turnIndex = sbIndex; }

    t.poker = {
      stage: 'preflop',
      deck, community,
      actors,
      dealerIndex, sbIndex, bbIndex,
      dealerSeatId,
      pot: newPot,
      toCall,
      turnIndex,
      startedAt: nowMs(),
    };
    emitPokerState(tableId, t);
  } catch {}
}

function advancePokerStage(tableId, t) {
  try {
    const state = t.poker; if (!state) return;
    const actors = state.actors;
    // Reset betting attributes
    actors.forEach(a => { a.acted = false; a.contrib = 0; });
    state.toCall = 0;
    if (state.stage === 'preflop') {
      // Flop
      state.community.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
      state.stage = 'flop';
    } else if (state.stage === 'flop') {
      // Turn
      state.community.push(state.deck.pop());
      state.stage = 'turn';
    } else if (state.stage === 'turn') {
      // River
      state.community.push(state.deck.pop());
      state.stage = 'river';
    } else if (state.stage === 'river') {
      // Showdown: pick random winner among not-folded
      const alive = actors.filter(a => !a.folded);
      let winners = [];
      if (alive.length > 0) {
        const win = alive[Math.floor(Math.random()*alive.length)];
        winners = [{ addr: win.addr }];
      }
      const payload = { winners, community: Array.from(state.community||[]), pot: state.pot||0, table: tablePublic(t) };
      io.to(tableId).emit('poker:hand', payload);
      // Cleanup and reset readiness for next hand
      t.poker = null;
      try { t.seats.filter(Boolean).forEach(s => { s.ready = false; }); } catch {}
      emitUpdate(t);
      return;
    }
    // Determine first to act postflop: left of dealer
    let idx = (state.dealerIndex + 1) % actors.length;
    // Find next not folded
    let spins = 0;
    while (actors[idx]?.folded && spins < actors.length) { idx = (idx + 1) % actors.length; spins++; }
    state.turnIndex = idx;
    emitPokerState(tableId, t);
  } catch {}
}

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
        if (curIdx >= 0) {
          const leaving = t.seats[curIdx];
          t.seats[curIdx] = null;
          try { t.bets.delete(String(leaving.addr||'').toLowerCase()); } catch {}
        }
      } else if (idx >= 0 && idx < t.seats.length) {
        if (!t.seats[idx]) {
          t.seats[idx] = { id: idx, addr: addrLower, ready: false, balance: 0, lastActive: nowMs(), socketId: socket.id };
        }
      }
      // Auto-start shoe when first player sits
      const after = seatCount(t);
      if (!t.started && before === 0 && after > 0 && !paused) {
        t.started = true;
        t.bets.clear();
        t.lastActive = nowMs();
        io.to(currentTableId).emit('table:started', tablePublic(t));
        // Initialize poker state container
        if (String(currentTableId).startsWith('poker-')) t.poker = null;
      }
      t.lastActive = nowMs();
      emitUpdate(t);
      ensureLobbyPolicy();
      emitLobby();
    } catch {}
  });

  // On disconnect, vacate any seats held by this socket or address (prevents sticky seating on reload)
  socket.on('disconnect', () => {
    try {
      for (const [id, t] of tables.entries()) {
        let changed = false;
        for (let i = 0; i < t.seats.length; i++) {
          const s = t.seats[i];
          if (!s) continue;
          if ((addrLower && s.addr === addrLower) || s.socketId === socket.id) {
            const key = String(s.addr||'').toLowerCase();
            t.seats[i] = null;
            try { t.bets.delete(key); } catch {}
            changed = true;
          }
        }
        if (changed) { t.lastActive = nowMs(); emitUpdate(t); emitLobby(); }
      }
    } catch {}
  });

  socket.on('ready', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (s) { s.ready = !!m.ready; s.lastActive = nowMs(); }
      t.lastActive = nowMs();
      emitUpdate(t);
      const active = t.seats.filter(Boolean);
      const allReady = active.length && active.every(x => !!x.ready);
      if (paused) return;
      const isFaro = String(currentTableId).startsWith('faro-');
      const isPoker = String(currentTableId).startsWith('poker-');
      if (isFaro) {
        if (allReady && t.bets.size > 0) {
          const bankRank = rand13();
          const playerRank = rand13();
          const doublet = (bankRank === playerRank);
          const results = [];
          active.forEach(seat => {
            const list = t.bets.get(String(seat.addr||'').toLowerCase()) || [];
            if (!list.length) return;
            let seatDelta = 0;
            let totalStake = 0;
            list.forEach(bet => {
              const fee = Math.floor((Number(bet.amount||0) * Number(rakeBps)) / 10000);
              const stake = Math.max(0, Number(bet.amount||0) - fee);
              totalStake += stake; feesAccrued += fee;
              if (doublet) return; // push in simplified model
              const matchedBank = (bet.rank === bankRank);
              const matchedPlayer = (bet.rank === playerRank);
              if (bet.copper) { if (matchedBank) seatDelta += stake; else if (matchedPlayer) seatDelta -= stake; }
              else { if (matchedPlayer) seatDelta += stake; else if (matchedBank) seatDelta -= stake; }
            });
            seat.balance = Number(seat.balance||0) + seatDelta;
            const st = ensureStats(seat.addr);
            st.rounds += 1; st.wagered += totalStake; if (seatDelta>0) st.won += seatDelta; if (seatDelta<0) st.lost += (-seatDelta);
            results.push({ addr: seat.addr, delta: seatDelta });
          });
          t.bets.clear();
          active.forEach(seat => { seat.ready = false; });
          io.to(currentTableId).emit('table:coup', { bankRank, playerRank, doublet, results, table: tablePublic(t) });
          emitUpdate(t);
        }
      } else if (isPoker) {
        if (allReady && active.length >= 2 && !t.poker) {
          startPokerHand(currentTableId, t);
        }
      }
    } catch {}
  });

  // Poker actions (beta): fold/check only; advance stages until river then random winner
  socket.on('poker:act', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      if (!String(currentTableId).startsWith('poker-')) return;
      if (!t.poker) return;
      const state = t.poker;
      const actorIdx = state.turnIndex;
      const actors = state.actors;
      if (actorIdx < 0 || actorIdx >= actors.length) return;
      const actor = actors[actorIdx];
      if (!actor) return;
      if (actor.addr !== addrLower) return; // not your turn
      const action = String(m?.action||'').toLowerCase();
      if (action === 'fold') {
        actor.folded = true;
        actor.acted = true;
        // If only one remains, end hand immediately
        const alive = actors.filter(a => !a.folded);
        if (alive.length === 1) {
          const payload = { winners: [{ addr: alive[0].addr }], community: Array.from(state.community||[]), pot: state.pot||0, table: tablePublic(t) };
          io.to(currentTableId).emit('poker:hand', payload);
          t.poker = null;
          try { t.seats.filter(Boolean).forEach(s => { s.ready = false; }); } catch {}
          emitUpdate(t);
          return;
        }
      } else if (action === 'check') {
        const need = Number(state.toCall||0) - Number(actor.contrib||0);
        if (need <= 0) {
          actor.acted = true;
        } else {
          // treat as call in this minimal flow
          actor.acted = true;
          actor.contrib = Number(state.toCall||0);
          state.pot = Number(state.pot||0) + Math.max(0, need);
        }
      } else if (action === 'call') {
        const need = Math.max(0, Number(state.toCall||0) - Number(actor.contrib||0));
        actor.contrib = Number(state.toCall||0);
        state.pot = Number(state.pot||0) + need;
        actor.acted = true;
      } else {
        // unsupported actions (bet/raise) ignored in beta
        actor.acted = true;
      }
      // Advance turn to next active (not folded)
      let next = (state.turnIndex + 1) % actors.length;
      let loop = 0;
      while (actors[next] && actors[next].folded && loop < actors.length) { next = (next + 1) % actors.length; loop++; }
      state.turnIndex = next;
      // If betting round complete, advance stage
      if (bettingRoundComplete(state)) {
        advancePokerStage(currentTableId, t);
        return;
      }
      // Broadcast updated turn
      emitPokerState(currentTableId, t);
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
      const key = String(addrLower||'');
      const list = t.bets.get(key) || [];
      list.push({ rank, amount, copper });
      t.bets.set(key, list);
      s.lastActive = nowMs();
      t.lastActive = nowMs();
      emitUpdate(t);
    } catch {}
  });

  // Allow a player to clear their pending bets before readying
  socket.on('clear_bets', () => {
    try {
      if (paused) return;
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (!s) return;
      if (s.ready) { socket.emit('error', { message: 'Already ready' }); return; }
      try { t.bets.delete(String(addrLower||'')); } catch {}
      s.lastActive = nowMs();
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
        const list = t.bets.get(String(seat.addr||'').toLowerCase()) || [];
        if (!list.length) return;
        let delta = 0; let totalStake = 0;
        list.forEach(bet => {
          const fee = Math.floor((Number(bet.amount||0) * Number(rakeBps)) / 10000);
          const stake = Math.max(0, Number(bet.amount||0) - fee);
          totalStake += stake; feesAccrued += fee;
          if (doublet) return;
          const matchedBank = (bet.rank === bankRank);
          const matchedPlayer = (bet.rank === playerRank);
          if (bet.copper) { if (matchedBank) delta += stake; else if (matchedPlayer) delta -= stake; }
          else { if (matchedPlayer) delta += stake; else if (matchedBank) delta -= stake; }
        });
        seat.balance = Number(seat.balance||0) + delta;
        const st = ensureStats(seat.addr);
        st.rounds += 1; st.wagered += totalStake; if (delta>0) st.won += delta; if (delta<0) st.lost += (-delta);
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

// Auto-eject inactive seats during an active shoe (90s) if not ready
setInterval(() => {
  try {
    const now = nowMs();
    for (const [id, t] of tables.entries()) {
      if (!t.started) continue;
      let changed = false;
      for (let i = 0; i < t.seats.length; i++) {
        const s = t.seats[i];
        if (!s) continue;
        const last = Number(s.lastActive || 0);
        if (!s.ready && last && (now - last) > 90_000) {
          const key = String(s.addr||'').toLowerCase();
          t.seats[i] = null;
          try { t.bets.delete(key); } catch {}
          changed = true;
        }
      }
      if (changed) { t.lastActive = nowMs(); emitUpdate(t); emitLobby(); }
    }
  } catch {}
}, 5_000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('RT server on', PORT));
