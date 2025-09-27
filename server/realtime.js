// Realtime server: Faro + (beta) Poker, profiles, basic chat
// Runs behind Nginx which proxies /socket.io/ to this process.
//
// ENV:
// - PORT                (default 3000)
// - GAME_TYPES          (comma-separated: FARO,POKER; default FARO)
// - ADMIN_ADDR          (comma-separated lowercase wallet addrs)
// - RT_RAKE_BPS         (default 100 = 1%)
//
// Public Socket.IO path (aligns with nginx): /socket.io/

const http = require('http');
const { Server } = require('socket.io');

/* ----------------------------- HTTP + Socket.IO ---------------------------- */

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Tavern realtime OK');
});

const io = new Server(server, {
  path: '/socket.io/', // IMPORTANT: trailing slash to match nginx proxy_pass target
  cors: { origin: true, methods: ['GET', 'POST'] },
});

/* --------------------------------- State ---------------------------------- */

const tables = new Map();            // id -> { id, seats[6], started, bets (Map<addrLower, Bet[]>), ownerId, lastActive, devBotEnabled, simulated, poker? }
const profiles = new Map();          // addrLower -> { cipher }
const publicProfiles = new Map();    // addrLower -> { x }
const stats = new Map();             // addrLower -> { rounds, wagered, won, lost }

let paused = false;
let rakeBps = Number(process.env.RT_RAKE_BPS || 100); // 1% default
let feesAccrued = 0;

const admins = new Set(
  String(process.env.ADMIN_ADDR || '')
    .toLowerCase()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

const enabledGames = new Set(
  String(process.env.GAME_TYPES || 'FARO')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
);

function gameEnabled(name) {
  return enabledGames.has(String(name || '').toUpperCase());
}

function tableGameKind(id) {
  const x = String(id || '').toLowerCase();
  if (x.startsWith('faro-')) return 'FARO';
  if (x.startsWith('poker-')) return 'POKER';
  return 'OTHER';
}

function defaultTableId() {
  if (gameEnabled('FARO')) return 'faro-1';
  if (gameEnabled('POKER')) return 'poker-1';
  return 'faro-1';
}

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
      devBotEnabled: false,
      simulated: false,
      poker: null, // poker-state container if a hand is active
    });
  }
  return tables.get(id);
}

function seatCount(t) {
  return t.seats.filter(Boolean).length;
}

function nextFaroTableId() {
  const ids = Array.from(tables.keys())
    .map(id => /^faro-(\d+)$/.exec(id))
    .filter(Boolean)
    .map(m => Number(m[1]));
  const next = ids.length ? Math.max(...ids) + 1 : 1;
  return `faro-${next}`;
}

function nextPokerTableId() {
  const ids = Array.from(tables.keys())
    .map(id => /^poker-(\d+)$/.exec(id))
    .filter(Boolean)
    .map(m => Number(m[1]));
  const next = ids.length ? Math.max(...ids) + 1 : 1;
  return `poker-${next}`;
}

function ensureLobbyPolicy() {
  // Ensure at least one of each enabled type exists
  if (gameEnabled('FARO')) {
    if (!Array.from(tables.keys()).some(id => String(id).startsWith('faro-'))) getTable('faro-1');
  }
  if (gameEnabled('POKER')) {
    if (!Array.from(tables.keys()).some(id => String(id).startsWith('poker-'))) getTable('poker-1');
  }

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

  // Ensure free seats exist
  if (gameEnabled('FARO')) {
    const faroFree = faroIds.some(id => seatCount(getTable(id)) < 6);
    if (!faroFree) getTable(nextFaroTableId());
  }

  if (gameEnabled('POKER')) {
    const ids2 = Array.from(tables.keys()).filter(id => String(id).startsWith('poker-'));
    const pokerFree = ids2.some(id => seatCount(getTable(id)) < 6);
    if (!pokerFree) getTable(nextPokerTableId());
  }
}

function short(v) {
  return (v && v.length > 10) ? (v.slice(0, 6) + '...' + v.slice(-4)) : (v || '');
}

function ensureStats(addr) {
  const key = (addr || '').toLowerCase();
  if (!stats.has(key)) stats.set(key, { rounds: 0, wagered: 0, won: 0, lost: 0 });
  return stats.get(key);
}

function tablePublic(t) {
  return {
    id: t.id,
    seats: t.seats.map(s => s && {
      id: s.id,
      addr: s.addr,
      ready: !!s.ready,
      balance: Number(s.balance || 0),
      lastActive: Number(s.lastActive || 0),
      betTotal: (() => {
        try {
          const bs = t.bets.get(String(s.addr || '').toLowerCase()) || [];
          return bs.reduce((a, b) => a + Number(b?.amount || 0), 0);
        } catch { return 0; }
      })(),
      betCount: (() => {
        try {
          const bs = t.bets.get(String(s.addr || '').toLowerCase()) || [];
          return bs.length;
        } catch { return 0; }
      })(),
      x: (publicProfiles.get(s.addr || '') || {}).x || null,
    }),
    started: !!t.started,
    ownerId: t.ownerId,
    devBotEnabled: !!t.devBotEnabled,
    simulated: !!t.simulated,
  };
}

function emitUpdate(t) {
  try { io.to(t.id).emit('table:update', tablePublic(t)); } catch {}
}

function emitLobby() {
  try {
    const list = Array.from(tables.values())
      .filter(t => {
        const kind = tableGameKind(t.id);
        return (kind === 'FARO' && gameEnabled('FARO')) || (kind === 'POKER' && gameEnabled('POKER'));
      })
      .map(t => ({ id: t.id, seated: seatCount(t), capacity: 6, started: !!t.started }));
    io.emit('lobby:list', list.sort((a, b) => a.id.localeCompare(b.id)));
  } catch {}
}

function rand13() { return Math.floor(Math.random() * 13) + 1; }

/* --------------------------- Poker helpers / eval -------------------------- */

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RVAL = Object.fromEntries(RANKS.map((r,i)=>[r, i+2]));

function makeDeck() {
  const suits = ['h','d','c','s'];
  const deck = [];
  for (const r of RANKS) for (const s of suits) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function parseCard(c) { const r = c && c[0], s = c && c[1]; return { r, s, v: RVAL[r] || 0, s2: s }; }
function byvDesc(a,b){ return b.v - a.v; }

function uniqueByRankDesc(cards) {
  const seen = new Set(); const out = [];
  for (const c of cards.sort(byvDesc)) {
    if (!seen.has(c.v)) { out.push(c); seen.add(c.v); }
  }
  return out;
}

function straightHigh(cards) {
  const u = uniqueByRankDesc(cards);
  const vs = u.map(c => c.v);
  if (vs.includes(14)) vs.push(1);
  let best = 0, run = 1;
  for (let i = 1; i < vs.length; i++) {
    if (vs[i] === vs[i - 1] - 1) { run++; best = Math.max(best, vs[i - 1]); }
    else if (vs[i] !== vs[i - 1]) run = 1;
    if (run >= 5) best = Math.max(best, vs[i - 1]);
  }
  if (best === 0 && vs.includes(5) && vs.includes(1)) return 5; // wheel
  return best;
}

function evaluate7(cards) {
  const cs = cards.map(parseCard).sort(byvDesc);
  const bySuit = cs.reduce((m, c) => { (m[c.s2] = m[c.s2] || []).push(c); return m; }, {});
  const counts = cs.reduce((m, c) => { m[c.v] = (m[c.v] || 0) + 1; return m; }, {});
  const groups = Object.entries(counts).map(([v, c]) => ({ v: Number(v), c })).sort((a,b)=> b.c - a.c || b.v - a.v);

  // Flush / Straight Flush (incl. Royal)
  let flushSuit = null;
  for (const s of Object.keys(bySuit)) { if (bySuit[s].length >= 5) { flushSuit = s; break; } }
  if (flushSuit) {
    const fcs = bySuit[flushSuit].slice();
    const hi = straightHigh(fcs);
    if (hi > 0) return { cls: 8, tiebreak: [hi] }; // straight flush
  }

  // Four of a kind
  if (groups[0]?.c === 4) {
    const kicker = cs.find(c => c.v !== groups[0].v)?.v || 0;
    return { cls: 7, tiebreak: [groups[0].v, kicker] };
  }

  // Full house
  if (groups[0]?.c === 3) {
    const second = groups.find(g => g.c >= 2 && g.v !== groups[0].v);
    if (second) return { cls: 6, tiebreak: [groups[0].v, second.v] };
  }

  // Flush
  if (flushSuit) {
    const top5 = bySuit[flushSuit].slice(0,5).map(c => c.v);
    return { cls: 5, tiebreak: top5 };
  }

  // Straight
  const sh = straightHigh(cs);
  if (sh > 0) return { cls: 4, tiebreak: [sh] };

  // Trips
  if (groups[0]?.c === 3) {
    const kickers = cs.filter(c => c.v !== groups[0].v).slice(0,2).map(c => c.v);
    return { cls: 3, tiebreak: [groups[0].v, ...kickers] };
  }

  // Two pair
  if (groups[0]?.c === 2 && groups[1]?.c === 2) {
    const kicker = cs.find(c => c.v !== groups[0].v && c.v !== groups[1].v)?.v || 0;
    const hi = Math.max(groups[0].v, groups[1].v), lo = Math.min(groups[0].v, groups[1].v);
    return { cls: 2, tiebreak: [hi, lo, kicker] };
  }

  // One pair
  if (groups[0]?.c === 2) {
    const kickers = cs.filter(c => c.v !== groups[0].v).slice(0,3).map(c => c.v);
    return { cls: 1, tiebreak: [groups[0].v, ...kickers] };
  }

  // High card
  return { cls: 0, tiebreak: cs.slice(0,5).map(c => c.v) };
}

function cmpRank(a, b) {
  if (a.cls !== b.cls) return a.cls - b.cls;
  const n = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < n; i++) {
    const av = a.tiebreak[i] || 0, bv = b.tiebreak[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function evaluate7Hand(hole2, board5) {
  try {
    const all = (hole2 || []).slice(0, 2).concat((board5 || []).slice(0, 5));
    return evaluate7(all);
  } catch { return null; }
}

function bestFiveUsed(hole, board) {
  try {
    const all = Array.from(hole || []).concat(Array.from(board || [])); // length <= 7
    const idxs = all.map((_, i) => i);

    let best = null;
    let bestPick = null;

    function* comb5(arr, start = 0, k = 5, p = []) {
      if (k === 0) { yield p; return; }
      for (let i = start; i <= arr.length - k; i++) {
        yield* comb5(arr, i + 1, k - 1, p.concat([arr[i]]));
      }
    }

    for (const pick of comb5(idxs)) {
      const cards = pick.map(i => all[i]);
      const r = evaluate7(cards);
      if (!best || cmpRank(r, best) > 0) {
        best = r;
        bestPick = pick;
      }
    }

    const usedHole = [];
    const usedCommunity = [];
    (bestPick || []).forEach(i => {
      if (i < 2) usedHole.push(i);
      else usedCommunity.push(i - 2);
    });

    return { usedHole, usedCommunity };
  } catch {
    return { usedHole: [], usedCommunity: [] };
  }
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
      contrib: Number(a.contrib || 0),
      isDealer: (i === state.dealerIndex),
      isSB: (i === state.sbIndex),
      isBB: (i === state.bbIndex),
    }));
    io.to(tableId).emit('poker:state', {
      stage: state.stage,
      pot: Number(state.pot || 0),
      toCall: Number(state.toCall || 0),
      community: Array.from(state.community || []),
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

function bettingRoundComplete(state) {
  const target = Number(state.toCall || 0);
  return state.actors
    .filter(a => !a.folded)
    .every(a => a.acted && Number(a.contrib || 0) === target);
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
    const SB = 1;
    const BB = 2;

    const dealerIndex = 0;
    const sbIndex = (dealerIndex + 1) % actors.length;
    const bbIndex = (dealerIndex + 2) % actors.length;

    // blinds
    actors[sbIndex].contrib = SB;
    actors[bbIndex].contrib = BB;
    let toCall = BB;
    let newPot = pot + SB + BB;

    // hole cards
    actors.forEach(a => { a.cards = [deck.pop(), deck.pop()]; });

    // preflop actor (UTG) — heads-up special case
    let turnIndex = (bbIndex + 1) % actors.length;
    if (actors.length === 2) turnIndex = sbIndex;

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
    maybeTriggerBot(tableId, t);
  } catch {}
}

function advancePokerStage(tableId, t) {
  try {
    const state = t.poker; if (!state) return;
    const actors = state.actors;

    // reset betting
    actors.forEach(a => { a.acted = false; a.contrib = 0; });
    state.toCall = 0;

    if (state.stage === 'preflop') {
      state.community.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
      state.stage = 'flop';
    } else if (state.stage === 'flop') {
      state.community.push(state.deck.pop());
      state.stage = 'turn';
    } else if (state.stage === 'turn') {
      state.community.push(state.deck.pop());
      state.stage = 'river';
    } else if (state.stage === 'river') {
      // showdown
      const board = Array.from(state.community || []);
      const alive = actors.map((a, i) => ({ i, a })).filter(x => !x.a.folded);
      let winners = [];

      if (alive.length > 0) {
        const evals = alive.map(x => ({
          idx: x.i,
          addr: x.a.addr,
          hole: Array.from(x.a.cards || []),
          ev: evaluate7Hand((x.a.cards || []), board),
        })).filter(e => e.ev);

        if (evals.length) {
          let best = evals[0].ev; let bestIdxs = [evals[0].idx];
          for (let i = 1; i < evals.length; i++) {
            const cmp = cmpRank(evals[i].ev, best);
            if (cmp > 0) { best = evals[i].ev; bestIdxs = [evals[i].idx]; }
            else if (cmp === 0) { bestIdxs.push(evals[i].idx); }
          }
          const each = Math.floor(Number(state.pot || 0) / bestIdxs.length);
          winners = bestIdxs.map(i => {
            const a = actors[i];
            const used = bestFiveUsed(Array.from(a.cards || []), board);
            try { a.stack = Number(a.stack || 0) + each; } catch {}
            return { addr: a.addr, amount: each, usedHole: used.usedHole, usedCommunity: used.usedCommunity };
          });
          try {
            actors.forEach(a => {
              const seat = t.seats[a.seatId];
              if (seat && typeof a.stack === 'number') seat.chips = Number(a.stack || 0);
            });
          } catch {}
        }
      }

      const exposures = actors.filter(a => !a.folded).map(a => ({ addr: a.addr, cards: Array.from(a.cards || []) }));
      const payload = { winners, community: board, exposures, pot: state.pot || 0, table: tablePublic(t) };
      io.to(tableId).emit('poker:hand', payload);

      t.poker = null;
      try { t.seats.filter(Boolean).forEach(s => { s.ready = false; }); } catch {}
      emitUpdate(t);
      return;
    }

    // first to act postflop: left of dealer, not folded
    let idx = (state.dealerIndex + 1) % actors.length;
    let spins = 0;
    while (actors[idx]?.folded && spins < actors.length) { idx = (idx + 1) % actors.length; spins++; }
    state.turnIndex = idx;

    emitPokerState(tableId, t);
    maybeTriggerBot(tableId, t);
  } catch {}
}

/* ------------------------------ Socket wiring ----------------------------- */

io.on('connection', (socket) => {
  let currentTableId = null;
  let addrLower = null;
  let isAdmin = false;

  socket.on('identify', (m) => {
    try { addrLower = String(m.addr || '').toLowerCase(); isAdmin = admins.has(addrLower); } catch {}
    socket.emit('rt:state', { paused, rakeBps, feesAccrued });
  });

  socket.on('join_table', (m) => {
    try {
      const reqId = String(m.table || m.tableId || '');
      let wanted = reqId || defaultTableId();
      const kind = tableGameKind(wanted);
      if ((kind === 'FARO' && !gameEnabled('FARO')) || (kind === 'POKER' && !gameEnabled('POKER'))) {
        wanted = defaultTableId();
      }
      const tableId = (tables.has(wanted) ? wanted : defaultTableId());

      if (currentTableId) socket.leave(currentTableId);
      currentTableId = tableId;
      socket.join(tableId);

      const t = getTable(tableId);

      // Poker: on join, clear dev bot if no hand
      try {
        if (String(tableId).startsWith('poker-') && !t.poker) {
          let changed = false;
          for (let i = 0; i < t.seats.length; i++) {
            const s = t.seats[i];
            if (s && typeof s.addr === 'string' && s.addr.startsWith('bot:')) { t.seats[i] = null; changed = true; }
          }
          if (t.devBotEnabled) { t.devBotEnabled = false; changed = true; }
          if (t.simulated) { t.simulated = false; changed = true; }
          if (changed) emitUpdate(t);
        }
      } catch {}

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
      io.to(currentTableId).emit('chat', { from: short(socket.id), text: String(m.msg || '').slice(0, 400) });
    } catch {}
  });

  socket.on('seat', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const before = seatCount(t);
      const idx = Number(m.index);

      if (idx === -1) {
        const curIdx = t.seats.findIndex(s => s && s.addr === addrLower);
        if (curIdx >= 0) {
          const leaving = t.seats[curIdx];
          t.seats[curIdx] = null;
          try { t.bets.delete(String(leaving.addr || '').toLowerCase()); } catch {}
        }
      } else if (idx >= 0 && idx < t.seats.length) {
        if (!t.seats[idx]) {
          t.seats[idx] = { id: idx, addr: addrLower, ready: false, balance: 0, lastActive: nowMs(), socketId: socket.id };
        }
      }

      // If 2+ humans, turn off dev bot/simulated and remove bot seat
      try {
        const humans = t.seats.filter(s => s && typeof s.addr === 'string' && !s.addr.startsWith('bot:'));
        if (humans.length >= 2 && t.devBotEnabled) {
          t.devBotEnabled = false;
          t.simulated = false;
          const botIdx = t.seats.findIndex(s => s && typeof s.addr === 'string' && s.addr.startsWith('bot:'));
          if (botIdx >= 0) t.seats[botIdx] = null;
          try { if (t.poker?.botTimer) { clearTimeout(t.poker.botTimer); t.poker.botTimer = null; } } catch {}
        }
      } catch {}

      // Auto-start shoe when first player sits (and not paused)
      const after = seatCount(t);
      if (!t.started && before === 0 && after > 0 && !paused) {
        t.started = true;
        t.bets.clear();
        t.lastActive = nowMs();
        io.to(currentTableId).emit('table:started', tablePublic(t));
        if (String(currentTableId).startsWith('poker-')) t.poker = null;
      }

      t.lastActive = nowMs();
      emitUpdate(t);
      ensureLobbyPolicy();
      emitLobby();
    } catch {}
  });

  socket.on('disconnect', () => {
    try {
      for (const [id, t] of tables.entries()) {
        let changed = false;
        for (let i = 0; i < t.seats.length; i++) {
          const s = t.seats[i];
          if (!s) continue;
          if ((addrLower && s.addr === addrLower) || s.socketId === socket.id) {
            const key = String(s.addr || '').toLowerCase();
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

      // If dev bot is seated in poker, mark it ready when a human is ready
      if (isPoker && t.devBotEnabled) {
        try {
          const botIdx = t.seats.findIndex(x => x && typeof x.addr === 'string' && x.addr.startsWith('bot:'));
          if (botIdx >= 0) t.seats[botIdx].ready = true;
        } catch {}
      }

      if (isFaro) {
        if (allReady && t.bets.size > 0) {
          const bankRank = rand13();
          const playerRank = rand13();
          const doublet = (bankRank === playerRank);
          const results = [];

          active.forEach(seat => {
            const list = t.bets.get(String(seat.addr || '').toLowerCase()) || [];
            if (!list.length) return;
            let seatDelta = 0;
            let totalStake = 0;
            list.forEach(bet => {
              const fee = Math.floor((Number(bet.amount || 0) * Number(rakeBps)) / 10000);
              const stake = Math.max(0, Number(bet.amount || 0) - fee);
              totalStake += stake; feesAccrued += fee;
              if (doublet) return; // push
              const matchedBank = (bet.rank === bankRank);
              const matchedPlayer = (bet.rank === playerRank);
              if (bet.copper) { if (matchedBank) seatDelta += stake; else if (matchedPlayer) seatDelta -= stake; }
              else { if (matchedPlayer) seatDelta += stake; else if (matchedBank) seatDelta -= stake; }
            });
            seat.balance = Number(seat.balance || 0) + seatDelta;
            const st = ensureStats(seat.addr);
            st.rounds += 1; st.wagered += totalStake; if (seatDelta > 0) st.won += seatDelta; if (seatDelta < 0) st.lost += (-seatDelta);
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

      const action = String(m?.action || '').toLowerCase();

      if (action === 'fold') {
        actor.folded = true;
        actor.acted = true;
        const alive = actors.filter(a => !a.folded);
        if (alive.length === 1) {
          const payload = { winners: [{ addr: alive[0].addr }], community: Array.from(state.community || []), pot: state.pot || 0, table: tablePublic(t) };
          io.to(currentTableId).emit('poker:hand', payload);
          t.poker = null;
          try { t.seats.filter(Boolean).forEach(s => { s.ready = false; }); } catch {}
          emitUpdate(t);
          return;
        }
      } else if (action === 'check') {
        const need = Number(state.toCall || 0) - Number(actor.contrib || 0);
        if (need <= 0) {
          actor.acted = true;
        } else {
          actor.acted = true;
          actor.contrib = Number(state.toCall || 0);
          state.pot = Number(state.pot || 0) + Math.max(0, need);
        }
      } else if (action === 'call') {
        const need = Math.max(0, Number(state.toCall || 0) - Number(actor.contrib || 0));
        actor.contrib = Number(state.toCall || 0);
        state.pot = Number(state.pot || 0) + need;
        actor.acted = true;
      } else {
        // ignore bet/raise in beta
        actor.acted = true;
      }

      // next active
      let next = (state.turnIndex + 1) % actors.length;
      let loop = 0;
      while (actors[next] && actors[next].folded && loop < actors.length) { next = (next + 1) % actors.length; loop++; }
      state.turnIndex = next;

      if (bettingRoundComplete(state)) {
        advancePokerStage(currentTableId, t);
        maybeTriggerBot(currentTableId, t);
        return;
      }

      emitPokerState(currentTableId, t);
      maybeTriggerBot(currentTableId, t);
    } catch {}
  });

  // Toggle dev bot (poker)
  socket.on('poker:devbot', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const enabled = !!m?.enabled;
      t.devBotEnabled = enabled;
      t.simulated = !!enabled;

      const botIdx = t.seats.findIndex(s => s && typeof s.addr === 'string' && s.addr.startsWith('bot:'));
      if (enabled) {
        if (botIdx === -1) {
          const slot = t.seats.findIndex(s => !s);
          if (slot >= 0) t.seats[slot] = { id: slot, addr: 'bot:dev', ready: false, balance: 0, lastActive: nowMs(), socketId: 'bot' };
        } else {
          try { t.seats[botIdx].ready = false; } catch {}
        }
      } else {
        if (botIdx >= 0) t.seats[botIdx] = null;
        try { if (t.poker?.botTimer) { clearTimeout(t.poker.botTimer); t.poker.botTimer = null; } } catch {}
      }

      t.lastActive = nowMs();
      emitUpdate(t);
      ensureLobbyPolicy();
      emitLobby();
    } catch {}
  });

  // Toggle simulated mode (poker)
  socket.on('poker:mode', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      t.simulated = !!(m && m.simulated);
      t.lastActive = nowMs();
      emitUpdate(t);
      io.to(currentTableId).emit('poker:mode', { simulated: !!t.simulated, table: tablePublic(t) });
      ensureLobbyPolicy();
      emitLobby();
    } catch {}
  });

  // Manual start ignored — automatic by ready state
  socket.on('start', () => { /* no-op by design */ });

  // FARO: place bet
  socket.on('place_bet', (m) => {
    try {
      if (paused) { socket.emit('error', { message: 'paused' }); return; }
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const rank = Number(m.rank);
      const amount = Math.max(1, Number(m.amount || 0) | 0);
      const copper = !!m.copper; // bet against (bank)
      if (!(rank >= 1 && rank <= 13)) return;
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (!s) return;
      if (s.ready) { socket.emit('error', { message: 'Already ready' }); return; }
      const key = String(addrLower || '');
      const list = t.bets.get(key) || [];
      list.push({ rank, amount, copper });
      t.bets.set(key, list);
      s.lastActive = nowMs();
      t.lastActive = nowMs();
      emitUpdate(t);
    } catch {}
  });

  socket.on('clear_bets', () => {
    try {
      if (paused) return;
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (!s) return;
      if (s.ready) { socket.emit('error', { message: 'Already ready' }); return; }
      try { t.bets.delete(String(addrLower || '')); } catch {}
      s.lastActive = nowMs();
      t.lastActive = nowMs();
      emitUpdate(t);
    } catch {}
  });

  // FARO: manual deal (dev)
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
        const list = t.bets.get(String(seat.addr || '').toLowerCase()) || [];
        if (!list.length) return;

        let delta = 0, totalStake = 0;
        list.forEach(bet => {
          const fee = Math.floor((Number(bet.amount || 0) * Number(rakeBps)) / 10000);
          const stake = Math.max(0, Number(bet.amount || 0) - fee);
          totalStake += stake; feesAccrued += fee;
          if (doublet) return;
          const matchedBank = (bet.rank === bankRank);
          const matchedPlayer = (bet.rank === playerRank);
          if (bet.copper) { if (matchedBank) delta += stake; else if (matchedPlayer) delta -= stake; }
          else { if (matchedPlayer) delta += stake; else if (matchedBank) delta -= stake; }
        });

        seat.balance = Number(seat.balance || 0) + delta;
        const st = ensureStats(seat.addr);
        st.rounds += 1; st.wagered += totalStake; if (delta > 0) st.won += delta; if (delta < 0) st.lost += (-delta);
        results.push({ addr: seat.addr, delta });
      });

      t.bets.clear();
      io.to(currentTableId).emit('table:coup', { bankRank, playerRank, doublet, results, table: tablePublic(t) });
      emitUpdate(t);
    } catch {}
  });

  // Profiles & stats
  socket.on('profile_save', (m) => { try { if (!addrLower) return; const cipher = String(m.cipher || ''); profiles.set(addrLower, { cipher }); } catch {} });
  socket.on('profile_get',  () => { try { const p = profiles.get(addrLower || ''); socket.emit('message', JSON.stringify({ type: 'profile', cipher: p?.cipher || '' })); } catch {} });
  socket.on('profile_public', (m) => {
    try {
      if (!addrLower) return;
      const x = String(m?.x || '').slice(0, 48);
      publicProfiles.set(addrLower, { x });
      if (currentTableId) emitUpdate(getTable(currentTableId));
    } catch {}
  });
  socket.on('stat_read', (m) => {
    try {
      const a = String(m.addr || '').toLowerCase();
      const st = stats.get(a) || { rounds: 0, wagered: 0, won: 0, lost: 0 };
      socket.emit('message', JSON.stringify({ type: 'stats', addr: a, ...st }));
    } catch {}
  });

  // Admin
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
      const bps = Math.max(0, Math.min(1000, Number(m?.bps || 0)));
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

  socket.on('health', () => {
    try { socket.emit('health', { ok: true, now: Date.now(), paused, rakeBps, feesAccrued }); } catch {}
  });

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

/* ------------------------- Background maintenance -------------------------- */

// Enforce lobby policy
setInterval(() => { try { ensureLobbyPolicy(); emitLobby(); } catch {} }, 15_000);

// Auto-eject inactive unready seats during a running shoe (90s)
setInterval(() => {
  try {
    const now = nowMs();
    for (const [, t] of tables.entries()) {
      if (!t.started) continue;
      let changed = false;
      for (let i = 0; i < t.seats.length; i++) {
        const s = t.seats[i];
        if (!s) continue;
        const last = Number(s.lastActive || 0);
        if (!s.ready && last && (now - last) > 90_000) {
          const key = String(s.addr || '').toLowerCase();
          t.seats[i] = null;
          try { t.bets.delete(key); } catch {}
          changed = true;
        }
      }
      if (changed) { t.lastActive = nowMs(); emitUpdate(t); emitLobby(); }
    }
  } catch {}
}, 5_000);

/* ------------------------------ Server listen ------------------------------ */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  try {
    console.log('RT server on', PORT, '| enabled games:', Array.from(enabledGames).join(','));
  } catch {
    console.log('RT server on', PORT);
  }
});

/* ----------------------- Dev helper: simple poker bot ---------------------- */

function maybeTriggerBot(tableId, t) {
  try {
    if (!t?.devBotEnabled) return;
    const state = t.poker; if (!state) return;

    const idx = state.actors.findIndex(a => typeof a?.addr === 'string' && a.addr.startsWith('bot:'));
    if (idx === -1) return;
    if (state.turnIndex !== idx) return;
    if (state.actors[idx].folded) return;
    if (state.botTimer) return; // debounce

    state.botTimer = setTimeout(() => {
      try {
        state.botTimer = null;
        const actor = state.actors[idx];
        const need = Math.max(0, Number(state.toCall || 0) - Number(actor.contrib || 0));
        let action = 'check';
        if (need > 0) action = (Math.random() < 0.8) ? 'call' : 'fold';

        if (action === 'fold') {
          actor.folded = true; actor.acted = true;
          const alive = state.actors.filter(a => !a.folded);
          if (alive.length === 1) {
            io.to(tableId).emit('poker:hand', { winners: [{ addr: alive[0].addr }], community: Array.from(state.community || []), pot: state.pot || 0, table: tablePublic(t) });
            t.poker = null;
            try { t.seats.filter(Boolean).forEach(s => { s.ready = false; }); } catch {}
            emitUpdate(t);
            return;
          }
        } else if (action === 'check') {
          if (need <= 0) {
            actor.acted = true;
          } else {
            actor.acted = true; actor.contrib = Number(state.toCall || 0);
            state.pot = Number(state.pot || 0) + need;
          }
        } else if (action === 'call') {
          actor.contrib = Number(state.toCall || 0);
          state.pot = Number(state.pot || 0) + need;
          actor.acted = true;
        }

        state.turnIndex = nextActiveIndex(state.actors, state.turnIndex);
        if (bettingRoundComplete(state)) { advancePokerStage(tableId, t); maybeTriggerBot(tableId, t); return; }
        emitPokerState(tableId, t);
        maybeTriggerBot(tableId, t);
      } catch {}
    }, 700 + Math.floor(Math.random() * 900));
  } catch {}
}
