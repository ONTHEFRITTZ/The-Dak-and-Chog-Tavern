// Realtime server: Faro + Poker (categories, fairness, auditing, spawn/prune, bot rules, private hole cards)
// ENV:
// - PORT (default 3000)
// - GAME_TYPES (comma-separated: FARO,POKER; default FARO,POKER)
// - ADMIN_ADDR (comma-separated lowercase wallet addrs)
// - RT_RAKE_BPS (default 100 = 1%)
// Socket.IO path is /socket.io/ (nginx proxies /poker.io/ → /socket.io/ upstream)

const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ----------------------------- HTTP + Socket.IO ---------------------------- */

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Tavern realtime OK');
});

const io = new Server(server, {
  path: '/socket.io/', // IMPORTANT: trailing slash to match nginx proxy_pass target
  cors: { origin: true, methods: ['GET', 'POST'] },
});

/* --------------------------------- Config --------------------------------- */

const HAND_TURN_MS = 25_000;      // auto-fold/check after this many ms
const SAVE_INTERVAL_MS = 10_000;  // state snapshot cadence
const LOBBY_TICK_MS = 5_000;      // baseline/spawn/prune cadence
const IDLE_EJECT_MS = 90_000;     // remove unready inactive seat after 90s
const EMPTY_PRUNE_MS = 60_000;    // prune an empty table after being empty ≥ 60s
const POKER_SEATS = 8;
const FARO_SEATS = 6;

const DATA_DIR  = path.resolve(process.cwd(), 'data');
const LOGS_DIR  = path.resolve(process.cwd(), 'logs');
const STATE_FN  = path.join(DATA_DIR, 'state.json');

// Make sure dirs exist
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

/* --------------------------------- State ---------------------------------- */

const tables = new Map();            // id -> Table
// Table (Faro): { id, kind:'FARO', seats[6], started, bets:Map<addrLower,Bet[]>, lastActive, ownerId? }
// Table (Poker): {
//   id, kind:'POKER',
//   seats[8], started, lastActive,
//   category:'ONCHAIN_NL'|'ONCHAIN_FL'|'OFFCHAIN_NL',
//   limit:'NL'|'FL', stakes?:'3/6 MON',
//   simulated:boolean, devBotEnabled:boolean,
//   poker: { ... } | null,
//   emptySince?: number
// }
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

// ⚠️ Default now includes POKER so poker lobby always appears unless explicitly disabled
const enabledGames = new Set(
  String(process.env.GAME_TYPES || 'FARO,POKER')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
);

/* --------------------------------- Helpers -------------------------------- */

function gameEnabled(name) { return enabledGames.has(String(name||'').toUpperCase()); }
function nowMs() { return Date.now(); }
function short(v) { return (v && v.length > 10) ? (v.slice(0, 6) + '...' + v.slice(-4)) : (v || ''); }
function seatCount(t) { return t.seats.filter(Boolean).length; }
function ensureStats(addr) {
  const key = (addr || '').toLowerCase();
  if (!stats.has(key)) stats.set(key, { rounds: 0, wagered: 0, won: 0, lost: 0 });
  return stats.get(key);
}

/* ------------------------------- Audit logging ----------------------------- */

function logFileName() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `audit-${y}${m}${day}.log`);
}

function audit(tableId, type, payload) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    tableId, type, payload
  }) + '\n';
  fs.appendFile(logFileName(), line, () => {});
}

/* ------------------------------ Rate limiting ------------------------------ */

const RLIMIT = {
  'chat':      { limit: 8,  windowMs: 5_000 },
  'seat':      { limit: 8,  windowMs: 5_000 },
  'ready':     { limit: 8,  windowMs: 5_000 },
  'poker:act': { limit: 20, windowMs: 10_000 },
};
const buckets = new Map(); // socket.id -> {event -> [timestamps]}

function allow(socketId, event) {
  const cfg = RLIMIT[event];
  if (!cfg) return true;
  const now = Date.now();
  if (!buckets.has(socketId)) buckets.set(socketId, {});
  const slot = buckets.get(socketId);
  if (!slot[event]) slot[event] = [];
  const arr = slot[event].filter(t => now - t < cfg.windowMs);
  arr.push(now);
  slot[event] = arr;
  return arr.length <= cfg.limit;
}

/* ------------------------------- Table creates ----------------------------- */

function getTable(id) {
  if (tables.has(id)) return tables.get(id);

  const low = String(id||'').toLowerCase();
  if (low.startsWith('poker-nl-')) {
    const t = {
      id, kind:'POKER',
      seats: Array.from({ length: POKER_SEATS }, () => null),
      started:false, lastActive: nowMs(),
      category: 'ONCHAIN_NL', limit:'NL', simulated:false,
      devBotEnabled:false, poker:null
    };
    tables.set(id, t);
    return t;
  }
  if (low.startsWith('poker-fl-')) {
    const t = {
      id, kind:'POKER',
      seats: Array.from({ length: POKER_SEATS }, () => null),
      started:false, lastActive: nowMs(),
      category: 'ONCHAIN_FL', limit:'FL', stakes:'3/6 MON', simulated:false,
      devBotEnabled:false, poker:null
    };
    tables.set(id, t);
    return t;
  }
  if (low.startsWith('poker-sim-')) {
    const t = {
      id, kind:'POKER',
      seats: Array.from({ length: POKER_SEATS }, () => null),
      started:false, lastActive: nowMs(),
      category: 'OFFCHAIN_NL', limit:'NL', simulated:true,
      devBotEnabled:false, poker:null
    };
    tables.set(id, t);
    return t;
  }

  // Default Faro table
  const t = {
    id, kind:'FARO',
    seats: Array.from({ length: FARO_SEATS }, () => null),
    started:false, bets:new Map(), ownerId:null, lastActive:nowMs()
  };
  tables.set(id, t);
  return t;
}

function nextIdFor(prefix) {
  const nums = Array.from(tables.keys())
    .map(id => new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(\\d+)$').exec(id))
    .filter(Boolean)
    .map(m => Number(m[1]));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefix}${next}`;
}

/* ----------------------------- Poker categories ---------------------------- */

const CAT = Object.freeze({
  ONCHAIN_NL: 'ONCHAIN_NL',
  ONCHAIN_FL: 'ONCHAIN_FL',
  OFFCHAIN_NL:'OFFCHAIN_NL',
});

function idPrefixFor(cat) {
  if (cat === CAT.ONCHAIN_NL) return 'poker-nl-';
  if (cat === CAT.ONCHAIN_FL) return 'poker-fl-';
  return 'poker-sim-';
}
function isPoker(t){ return t?.kind === 'POKER'; }
function pokerTablesBy(cat){ return Array.from(tables.values()).filter(t => isPoker(t) && t.category === cat); }
function ensurePokerTable(cat) {
  const existing = pokerTablesBy(cat);
  if (existing.length === 0) {
    const id = nextIdFor(idPrefixFor(cat));
    return getTable(id);
  }
  return existing[0];
}

/* ------------------------------- Public views ------------------------------ */

function tablePublic(t) {
  if (t.kind === 'FARO') {
    return {
      id: t.id,
      seats: t.seats.map(s => s && {
        id: s.id, addr: s.addr, ready: !!s.ready,
        balance: Number(s.balance || 0), lastActive: Number(s.lastActive || 0),
        betTotal: (() => { try { const bs = t.bets.get(String(s.addr||'').toLowerCase()) || []; return bs.reduce((a,b)=>a+Number(b?.amount||0),0);} catch { return 0; } })(),
        betCount: (() => { try { const bs = t.bets.get(String(s.addr||'').toLowerCase()) || []; return bs.length; } catch { return 0; } })(),
        x: (publicProfiles.get(s.addr || '') || {}).x || null,
      }),
      started: !!t.started,
      ownerId: t.ownerId,
      capacity: FARO_SEATS,
    };
  }

  // POKER
  return {
    id: t.id,
    seats: t.seats.map(s => s && ({
      id: s.id, addr: s.addr, ready: !!s.ready,
      balance: Number(s.balance || 0), lastActive: Number(s.lastActive || 0),
      x: (publicProfiles.get(s.addr || '') || {}).x || null,
    })),
    started: !!t.started,
    devBotEnabled: !!t.devBotEnabled,
    simulated: !!t.simulated,
    limit: t.limit,        // 'NL' | 'FL'
    stakes: t.stakes || '',// '3/6 MON' for FL
    capacity: POKER_SEATS,
  };
}

function emitUpdate(t) { try { io.to(t.id).emit('table:update', tablePublic(t)); } catch {} }

function emitLobby() {
  try {
    const list = Array.from(tables.values())
      .filter(t => (t.kind === 'FARO' ? gameEnabled('FARO') : gameEnabled('POKER')))
      .map(t => {
        const base = { id: t.id, seated: seatCount(t), capacity: (t.kind==='POKER'?POKER_SEATS:FARO_SEATS), started: !!t.started };
        if (t.kind === 'POKER') {
          base.simulated = !!t.simulated;
          base.limit = t.limit;
          if (t.limit === 'FL') base.stakes = t.stakes || '3/6 MON';
        }
        return base;
      });

    io.emit('lobby:list', list.sort((a,b)=> String(a.id).localeCompare(String(b.id))));
  } catch {}
}

/* ------------------------------ Poker bot rules ---------------------------- */

function humansIn(t) {
  return t.seats.filter(s => s && typeof s.addr === 'string' && !s.addr.startsWith('bot:')).length;
}
function findBotIndex(t) {
  return t.seats.findIndex(s => s && typeof s.addr === 'string' && s.addr.startsWith('bot:'));
}
function seatFirstEmpty(t, addr, socketId='bot') {
  const slot = t.seats.findIndex(s => !s);
  if (slot >= 0) {
    t.seats[slot] = { id: slot, addr, ready: false, balance: 0, lastActive: nowMs(), socketId };
    return slot;
  }
  return -1;
}
// Only on OFFCHAIN_NL tables: seat bot if exactly 1 human; boot if ≥2 or 0 humans
function reconcileBotPolicy(t) {
  if (!isPoker(t)) return;
  if (t.category !== CAT.OFFCHAIN_NL) return;

  const humans = humansIn(t);
  const botIdx = findBotIndex(t);

  if (humans === 1 && botIdx === -1) {
    seatFirstEmpty(t, 'bot:dev', 'bot');
    t.devBotEnabled = true;
  } else if ((humans >= 2 || humans === 0) && botIdx >= 0) {
    t.seats[botIdx] = null;
    try { if (t.poker?.botTimer) { clearTimeout(t.poker.botTimer); t.poker.botTimer = null; } } catch {}
    t.devBotEnabled = false;
  }
}

/* ------------------------ Poker spawn / prune policy ----------------------- */

function ensureCategoryBaselines() {
  if (!gameEnabled('POKER')) return;
  ensurePokerTable(CAT.ONCHAIN_NL);
  ensurePokerTable(CAT.ONCHAIN_FL);
  ensurePokerTable(CAT.OFFCHAIN_NL);
}

// Spawn: if any table in category reaches 6/8, ensure there is an extra empty table
function spawnIfCrowded(cat) {
  const list = pokerTablesBy(cat);
  if (list.length === 0) { ensurePokerTable(cat); return; }
  const crowded = list.some(t => seatCount(t) >= 6);
  if (!crowded) return;

  const hasEmpty = list.some(t => seatCount(t) === 0);
  if (!hasEmpty) {
    const id = nextIdFor(idPrefixFor(cat));
    getTable(id);
  }
}

// Prune: if ≥2 empty tables in a category for ≥60s, prune one, but keep ≥1 (or keep 2 if any non-empty has ≥6)
function pruneEmpties(cat) {
  const list = pokerTablesBy(cat);
  if (list.length === 0) return;

  const now = nowMs();
  list.forEach(t => {
    const sc = seatCount(t);
    if (sc === 0) { if (!t.emptySince) t.emptySince = now; }
    else { t.emptySince = null; }
  });

  const empties = list.filter(t => seatCount(t) === 0).sort((a,b)=>(a.emptySince||0)-(b.emptySince||0));
  if (empties.length < 2) return;

  const nonEmpty = list.filter(t => seatCount(t) > 0);
  const busy = nonEmpty.some(t => seatCount(t) >= 6);
  const minKeep = busy ? 2 : 1;

  if ((list.length - 1) < minKeep) return;

  const candidate = empties.find(t => (now - (t.emptySince||now)) >= EMPTY_PRUNE_MS);
  if (!candidate) return;

  const wouldRemain = list.length - 1;
  if (wouldRemain >= minKeep) {
    tables.delete(candidate.id);
    audit(candidate.id, 'prune', { category: candidate.category });
  }
}

function ensureLobbyPolicy() {
  // Faro minimums
  if (gameEnabled('FARO')) {
    if (!Array.from(tables.keys()).some(id => String(id).startsWith('faro-'))) getTable('faro-1');
    const faro = Array.from(tables.values()).filter(t => t.kind==='FARO');
    const now = nowMs();
    const empties = faro.filter(t => seatCount(t)===0);
    if (empties.length >= 2) {
      const c = empties[0];
      if (!c.emptySince) c.emptySince = now;
      if ((now - c.emptySince) > EMPTY_PRUNE_MS && faro.length > 1) {
        tables.delete(c.id);
        audit(c.id, 'prune', { kind: 'FARO' });
      }
    }
  }

  // Poker category baselines
  if (gameEnabled('POKER')) {
    ensureCategoryBaselines();
    spawnIfCrowded(CAT.ONCHAIN_NL);
    spawnIfCrowded(CAT.ONCHAIN_FL);
    spawnIfCrowded(CAT.OFFCHAIN_NL);

    pruneEmpties(CAT.ONCHAIN_NL);
    pruneEmpties(CAT.ONCHAIN_FL);
    pruneEmpties(CAT.OFFCHAIN_NL);
  }
}

/* --------------------------- Faro-only small bits -------------------------- */
function rand13() { return Math.floor(Math.random() * 13) + 1; }

/* --------------------------- Poker helpers / eval -------------------------- */
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RVAL = Object.fromEntries(RANKS.map((r,i)=>[r, i+2]));

// Deterministic shuffle using SHA256(seed + ":" + counter)
function makeSeededDeck(seedHex, tableId) {
  const suits = ['h','d','c','s'];
  const deck = [];
  for (const r of RANKS) for (const s of suits) deck.push(r + s);

  let ctr = 0;
  function nextUint32() {
    const h = crypto.createHash('sha256').update(`${seedHex}:${tableId}:${ctr++}`).digest();
    return h.readUInt32BE(0);
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const rnd = nextUint32();
    const j = rnd % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function parseCard(c){ const r=c && c[0], s=c && c[1]; return { r, s, v:RVAL[r]||0, s2:s }; }
function byvDesc(a,b){ return b.v-a.v; }
function uniqueByRankDesc(cards){ const seen=new Set(); const out=[]; for(const c of cards.sort(byvDesc)){ if(!seen.has(c.v)){ out.push(c); seen.add(c.v);} } return out; }
function straightHigh(cards){ const u = uniqueByRankDesc(cards); const vs = u.map(c=>c.v); if (vs.includes(14)) vs.push(1); let best=0, run=1; for (let i=1;i<vs.length;i++){ if (vs[i]===vs[i-1]-1) { run++; best = Math.max(best, vs[i-1]); } else if (vs[i]!==vs[i-1]) run=1; if (run>=5) best = Math.max(best, vs[i-1]); } if (best===0 && vs.includes(5) && vs.includes(1)) return 5; return best; }
function evaluate7(cards){ const cs = cards.map(parseCard).sort(byvDesc); const bySuit = cs.reduce((m,c)=>{ (m[c.s2]=m[c.s2]||[]).push(c); return m; },{}); const counts = cs.reduce((m,c)=>{ m[c.v]=(m[c.v]||0)+1; return m; },{}); const groups = Object.entries(counts).map(([v,c])=>({v:Number(v), c})).sort((a,b)=> b.c-a.c || b.v-a.v); let flushSuit=null; for (const s of Object.keys(bySuit)){ if (bySuit[s].length>=5) { flushSuit=s; break; } } if (flushSuit){ const fcs = bySuit[flushSuit].slice(); const hi = straightHigh(fcs); if (hi>0){ return { cls:8, tiebreak:[hi] }; } } if (groups[0]?.c===4){ const kicker = cs.find(c=>c.v!==groups[0].v)?.v||0; return { cls:7, tiebreak:[groups[0].v, kicker] }; } if (groups[0]?.c===3){ const second = groups.find(g=>g.c>=2 && g.v!==groups[0].v); if (second){ return { cls:6, tiebreak:[groups[0].v, second.v] }; } } if (flushSuit){ const top5 = bySuit[flushSuit].slice(0,5).map(c=>c.v); return { cls:5, tiebreak: top5 }; } const sh = straightHigh(cs); if (sh>0){ return { cls:4, tiebreak:[sh] }; } if (groups[0]?.c===3){ const kickers = cs.filter(c=>c.v!==groups[0].v).slice(0,2).map(c=>c.v); return { cls:3, tiebreak:[groups[0].v, ...kickers] }; } if (groups[0]?.c===2 && groups[1]?.c===2){ const kicker = cs.find(c=>c.v!==groups[0].v && c.v!==groups[1].v)?.v||0; const hi=Math.max(groups[0].v,groups[1].v), lo=Math.min(groups[0].v,groups[1].v); return { cls:2, tiebreak:[hi, lo, kicker] }; } if (groups[0]?.c===2){ const kickers = cs.filter(c=>c.v!==groups[0].v).slice(0,3).map(c=>c.v); return { cls:1, tiebreak:[groups[0].v, ...kickers] }; } return { cls:0, tiebreak: cs.slice(0,5).map(c=>c.v) }; }
function cmpRank(a,b){ if (a.cls!==b.cls) return a.cls-b.cls; const n=Math.max(a.tiebreak.length,b.tiebreak.length); for(let i=0;i<n;i++){ const av=a.tiebreak[i]||0, bv=b.tiebreak[i]||0; if (av!==bv) return av-bv; } return 0; }
function evaluate7Hand(hole2, board5){ try { const all = (hole2||[]).slice(0,2).concat((board5||[]).slice(0,5)); return evaluate7(all); } catch { return null; } }
function bestFiveUsed(hole, board){
  try {
    const all = Array.from(hole||[]).concat(Array.from(board||[])); // length <= 7
    const idxs = all.map((_,i)=>i);
    let best=null; let bestPick=null;
    function* comb5(arr, start=0, k=5, p=[]){
      if (k===0){ yield p; return; }
      for (let i=start; i<=arr.length-k; i++){ yield* comb5(arr, i+1, k-1, p.concat([arr[i]])); }
    }
    for (const pick of comb5(idxs)){
      const cards = pick.map(i=> all[i]);
      const r = evaluate7(cards);
      if (!best || cmpRank(r,best) > 0){
        best = r; bestPick = pick;
      }
    }
    const usedHole = []; const usedCommunity = [];
    (bestPick||[]).forEach(i=>{ if (i<2) usedHole.push(i); else usedCommunity.push(i-2); });
    return { usedHole, usedCommunity };
  } catch {
    return { usedHole: [], usedCommunity: [] };
  }
}

function emitPokerState(tableId, t) {
  try {
    const state = t.poker; if (!state) return;
    const pubActors = state.actors.map((a,i)=>({
      addr:a.addr, seatId:a.seatId, folded:!!a.folded, acted:!!a.acted,
      contrib:Number(a.contrib||0), isDealer:(i===state.dealerIndex), isSB:(i===state.sbIndex), isBB:(i===state.bbIndex),
    }));
    io.to(tableId).emit('poker:state', {
      stage:state.stage, pot:Number(state.pot||0), toCall:Number(state.toCall||0),
      community:Array.from(state.community||[]), turnIndex:state.turnIndex,
      turnAddr: state.actors?.[state.turnIndex]?.addr || null, dealerIndex:state.dealerIndex,
      actors:pubActors, table: tablePublic(t),
      rngCommit: state.rng?.commit || null
    });
  } catch {}
}

/* ------------------------- Turn timer + actions core ----------------------- */

function clearTurnTimer(t) {
  try { if (t?.poker?.turnTimer) { clearTimeout(t.poker.turnTimer); t.poker.turnTimer = null; } } catch {}
}

function scheduleTurnTimer(tableId, t) {
  clearTurnTimer(t);
  if (!t?.poker) return;
  t.poker.turnTimer = setTimeout(() => {
    try {
      const state = t.poker; if (!state) return;
      const actor = state.actors[state.turnIndex]; if (!actor) return;
      const need = Math.max(0, Number(state.toCall || 0) - Number(actor.contrib || 0));
      const action = (need > 0) ? 'fold' : 'check';
      applyAction(tableId, t, actor.addr, action, true);
    } catch {}
  }, HAND_TURN_MS);
}

function applyAction(tableId, t, addrLower, action, isAuto=false) {
  try {
    if (!t?.poker) return;
    const state  = t.poker;
    const idx    = state.turnIndex;
    const actors = state.actors;
    if (idx < 0 || idx >= actors.length) return;
    const actor  = actors[idx];
    if (!actor || actor.addr !== addrLower) return;

    audit(tableId, 'action', { addr: addrLower, action, auto: !!isAuto, stage: state.stage, toCall: state.toCall, contrib: actor.contrib });

    if (action === 'fold') {
      actor.folded = true;
      actor.acted  = true;
      const alive = actors.filter(a => !a.folded);
      if (alive.length === 1) {
        io.to(tableId).emit('poker:hand', {
          winners: [{ addr: alive[0].addr }],
          community: Array.from(state.community||[]),
          pot: state.pot || 0,
          rng: { commit: state.rng?.commit, seed: state.rng?.seed },
          table: tablePublic(t)
        });
        // clear private hole for everyone
        try { state.actors.forEach(a => clearPrivateHoleForSeat(t, a.seatId)); } catch {}
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
      actor.acted = true; // ignore raise/bet in beta
    }

    // next active
    let next = (state.turnIndex + 1) % actors.length, loop = 0;
    while (actors[next] && actors[next].folded && loop < actors.length) { next = (next + 1) % actors.length; loop++; }
    state.turnIndex = next;

    if (bettingRoundComplete(state)) {
      audit(tableId, 'roundComplete', { stage: state.stage, pot: state.pot });
      advancePokerStage(tableId, t);
      maybeTriggerBot(tableId, t);
      return;
    }

    emitPokerState(tableId, t);
    scheduleTurnTimer(tableId, t);
    maybeTriggerBot(tableId, t);
  } catch {}
}

/* ------------------------- Private hole card helpers ----------------------- */

function sendPrivateHoleToSeat(t, seatId, cards) {
  try {
    const s = t.seats[seatId];
    if (!s || !s.socketId || s.socketId === 'bot') return;
    io.to(s.socketId).emit('poker:hole', { tableId: t.id, seatId, cards: Array.from(cards||[]) });
  } catch {}
}
function clearPrivateHoleForSeat(t, seatId) {
  try {
    const s = t.seats[seatId];
    if (!s || !s.socketId || s.socketId === 'bot') return;
    io.to(s.socketId).emit('poker:hole_clear', { tableId: t.id, seatId });
  } catch {}
}
function sendAllPrivateHoles(t) {
  try {
    const st = t.poker; if (!st) return;
    st.actors.forEach(a => sendPrivateHoleToSeat(t, a.seatId, a.cards));
  } catch {}
}

/* ------------------------------- Hand lifecycle ---------------------------- */

function startPokerHand(tableId, t) {
  try {
    const seated = t.seats.map((s,i)=> s && ({ seatId:i, addr:s.addr })).filter(Boolean);
    if (seated.length < 2) return;

    const prev = t.poker?.dealerSeatId;
    let dealerSeatId;
    if (typeof prev === 'number') {
      const idx = seated.findIndex(x => x.seatId === prev);
      dealerSeatId = seated[(idx >= 0 ? (idx + 1) % seated.length : 0)].seatId;
    } else {
      dealerSeatId = seated[0].seatId;
    }
    const startIdx = seated.findIndex(x => x.seatId === dealerSeatId);
    const ordered = seated.slice(startIdx).concat(seated.slice(0, startIdx));
    const actors = ordered.map(p => ({ addr:p.addr, seatId:p.seatId, folded:false, acted:false, contrib:0 }));

    // fairness: commit→reveal
    const seed = crypto.randomBytes(32).toString('hex');
    const commit = crypto.createHash('sha256').update(seed).digest('hex');
    const deck = makeSeededDeck(seed, tableId);

    const community = [];
    const pot = 0;
    const SB = 1, BB = 2;

    const dealerIndex = 0;
    const sbIndex = (dealerIndex + 1) % actors.length;
    const bbIndex = (dealerIndex + 2) % actors.length;

    actors[sbIndex].contrib = SB;
    actors[bbIndex].contrib = BB;
    let toCall = BB;
    let newPot = pot + SB + BB;

    actors.forEach(a => { a.cards = [deck.pop(), deck.pop()]; });

    let turnIndex = (bbIndex + 1) % actors.length;
    if (actors.length === 2) turnIndex = sbIndex;

    t.poker = {
      stage:'preflop', deck, community, actors,
      dealerIndex, sbIndex, bbIndex, dealerSeatId,
      pot:newPot, toCall, turnIndex, startedAt:nowMs(),
      rng: { commit, seed }
    };

    audit(tableId, 'handStart', { commit, seated: actors.map(a=>a.addr), dealerSeatId, sbIndex, bbIndex });

    emitPokerState(tableId, t);
    sendAllPrivateHoles(t);
    scheduleTurnTimer(tableId, t);
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
      const board = Array.from(state.community||[]);
      const alive = actors.map((a,i)=>({i,a})).filter(x=>!x.a.folded);
      let winners = [];
      if (alive.length > 0) {
        const evals = alive.map(x => ({ idx:x.i, addr:x.a.addr, hole:Array.from(x.a.cards||[]), ev:evaluate7Hand((x.a.cards||[]), board) })).filter(e=>e.ev);
        if (evals.length) {
          let best = evals[0].ev; let bestIdxs=[evals[0].idx];
          for (let i=1;i<evals.length;i++){
            const cmp = cmpRank(evals[i].ev, best);
            if (cmp>0) { best=evals[i].ev; bestIdxs=[evals[i].idx]; } else if (cmp===0) { bestIdxs.push(evals[i].idx); }
          }
          const each = Math.floor(Number(state.pot||0) / bestIdxs.length);
          winners = bestIdxs.map(i => {
            const a=actors[i]; const used=bestFiveUsed(Array.from(a.cards||[]), board);
            try { a.stack = Number(a.stack||0) + each; } catch {}
            return { addr:a.addr, amount:each, usedHole:used.usedHole, usedCommunity:used.usedCommunity };
          });
          try { actors.forEach(a => { const seat=t.seats[a.seatId]; if (seat && typeof a.stack==='number') seat.chips = Number(a.stack||0); }); } catch {}
        }
      }

      const exposures = actors.filter(a=>!a.folded).map(a => ({ addr:a.addr, cards:Array.from(a.cards||[]) }));
      io.to(tableId).emit('poker:hand', {
        winners, community:board, exposures, pot:state.pot||0,
        rng: { commit: state.rng?.commit, seed: state.rng?.seed },
        table: tablePublic(t)
      });

      audit(tableId, 'showdown', { winners, board, pot: state.pot, rngReveal: state.rng });

      // clear hole cards from clients
      try { state.actors.forEach(a => clearPrivateHoleForSeat(t, a.seatId)); } catch {}

      clearTurnTimer(t);
      t.poker = null;
      try { t.seats.filter(Boolean).forEach(s => { s.ready = false; }); } catch {}
      emitUpdate(t);
      return;
    }

    // first to act postflop: left of dealer, not folded
    let idx = (state.dealerIndex + 1) % actors.length, spins = 0;
    while (actors[idx]?.folded && spins < actors.length) { idx = (idx + 1) % actors.length; spins++; }
    state.turnIndex = idx;

    audit(tableId, 'stage', { stage: state.stage, community: Array.from(state.community||[]) });

    emitPokerState(tableId, t);
    scheduleTurnTimer(tableId, t);
    maybeTriggerBot(tableId, t);
  } catch {}
}

/* ------------------------------ Socket wiring ----------------------------- */

// Bootstrap: immediately create baselines and emit once on boot (so UI doesn't sit at "loading...")
setTimeout(() => { try { ensureLobbyPolicy(); emitLobby(); } catch (e) { console.error(e); } }, 200);

io.on('connection', (socket) => {
  let currentTableId = null;
  let addrLower = null;
  let isAdmin = false;

  // Ensure this client sees a lobby immediately
  try { ensureLobbyPolicy(); emitLobby(); } catch (e) { console.error(e); }

  socket.on('identify', (m) => {
    try { addrLower = String(m.addr || '').toLowerCase(); isAdmin = admins.has(addrLower); } catch {}
    socket.emit('rt:state', { paused, rakeBps, feesAccrued });
  });

  socket.on('join_table', (m) => {
    try {
      const reqId = String(m.table || m.tableId || '');
      let wanted = reqId || (gameEnabled('FARO') ? 'faro-1' : 'poker-nl-1');

      if (wanted && !tables.has(wanted)) getTable(wanted);
      const t = getTable(wanted);

      if (currentTableId) socket.leave(currentTableId);
      currentTableId = wanted;
      socket.join(wanted);

      // if player has a seat in an active hand, re-send their private cards on join
      if (isPoker(t) && t.poker && addrLower) {
        const seatIdx = t.seats.findIndex(s => s && s.addr === addrLower);
        if (seatIdx >= 0) {
          const actor = t.poker.actors.find(a => a.seatId === seatIdx);
          if (actor && actor.cards) {
            try { t.seats[seatIdx].socketId = socket.id; } catch {}
            sendPrivateHoleToSeat(t, seatIdx, actor.cards);
          }
        }
        reconcileBotPolicy(t);
      }

      t.lastActive = nowMs();
      emitUpdate(t);
      io.to(wanted).emit('system', `${short(socket.id)} joined ${wanted}`);
      ensureLobbyPolicy();
      emitLobby();
    } catch {}
  });

  socket.on('lobby:get', () => { try { ensureLobbyPolicy(); emitLobby(); } catch {} });

  socket.on('chat', (m) => {
    try {
      if (!allow(socket.id, 'chat')) { socket.emit('error', { message:'rate limit' }); return; }
      if (!currentTableId) return;
      io.to(currentTableId).emit('chat', { from: short(socket.id), text: String(m.msg || '').slice(0, 400) });
    } catch {}
  });

  socket.on('seat', (m) => {
    try {
      if (!allow(socket.id, 'seat')) { socket.emit('error', { message:'rate limit' }); return; }
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const before = seatCount(t);
      const idx = Number(m.index);

      if (idx === -1) {
        const curIdx = t.seats.findIndex(s => s && s.addr === addrLower);
        if (curIdx >= 0) {
          try { clearPrivateHoleForSeat(t, curIdx); } catch {}
          const leaving = t.seats[curIdx];
          t.seats[curIdx] = null;
          if (t.kind==='FARO') { try { t.bets.delete(String(leaving.addr || '').toLowerCase()); } catch {} }
          audit(currentTableId, 'seatLeave', { addr: addrLower, index: curIdx });
        }
      } else if (idx >= 0 && idx < t.seats.length) {
        if (!t.seats[idx]) {
          t.seats[idx] = { id: idx, addr: addrLower, ready: false, balance: 0, lastActive: nowMs(), socketId: socket.id };
          audit(currentTableId, 'seat', { addr: addrLower, index: idx });
        }
      }

      if (isPoker(t)) {
        reconcileBotPolicy(t);
      }

      const after = seatCount(t);
      if (!t.started && before === 0 && after > 0 && !paused) {
        t.started = true;
        if (t.kind==='FARO') t.bets.clear();
        if (t.kind==='POKER') t.poker = null;
        t.lastActive = nowMs();
        io.to(currentTableId).emit('table:started', tablePublic(t));
      }

      t.lastActive = nowMs();
      emitUpdate(t);
      ensureLobbyPolicy();
      emitLobby();
    } catch {}
  });

  socket.on('disconnect', () => {
    try {
      for (const [, t] of tables.entries()) {
        let changed = false;
        for (let i = 0; i < t.seats.length; i++) {
          const s = t.seats[i];
          if (!s) continue;
          if ((addrLower && s.addr === addrLower) || s.socketId === socket.id) {
            if (t.kind==='FARO') { try { t.bets.delete(String(s.addr || '').toLowerCase()); } catch {} }
            try { clearPrivateHoleForSeat(t, i); } catch {}
            t.seats[i] = null;
            changed = true;
          }
        }
        if (isPoker(t) && changed) reconcileBotPolicy(t);
        if (changed) { t.lastActive = nowMs(); emitUpdate(t); }
      }
      ensureLobbyPolicy();
      emitLobby();
    } catch {}
  });

  socket.on('ready', (m) => {
    try {
      if (!allow(socket.id, 'ready')) { socket.emit('error', { message:'rate limit' }); return; }
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (s) { s.ready = !!m.ready; s.lastActive = nowMs(); s.socketId = socket.id; }
      t.lastActive = nowMs();
      emitUpdate(t);

      if (paused) return;
      const active = t.seats.filter(Boolean);
      const allReady = active.length && active.every(x => !!x.ready);

      if (t.kind === 'FARO') {
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
        return;
      }

      // POKER:
      if (t.category === CAT.OFFCHAIN_NL && t.devBotEnabled) {
        try {
          const botIdx = findBotIndex(t);
          if (botIdx >= 0) t.seats[botIdx].ready = true;
        } catch {}
      }
      if (allReady && active.length >= 2 && !t.poker) startPokerHand(currentTableId, t);
    } catch {}
  });

  // POKER actions (authoritative)
  socket.on('poker:act', (m) => {
    try {
      if (!allow(socket.id, 'poker:act')) { socket.emit('error', { message:'rate limit' }); return; }
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      if (!isPoker(t) || !t.poker) return;

      const state = t.poker;
      const actorIdx = state.turnIndex;
      const actors = state.actors;

      if (actorIdx < 0 || actorIdx >= actors.length) return;
      const actor = actors[actorIdx];
      if (!actor) return;
      if (actor.addr !== addrLower) return; // not your turn

      const action = String(m?.action || '').toLowerCase();
      applyAction(currentTableId, t, addrLower, action, false);
    } catch {}
  });

  // Toggle dev bot: only effective on OFFCHAIN_NL
  socket.on('poker:devbot', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      if (!isPoker(t)) return;
      if (t.category !== CAT.OFFCHAIN_NL) return;

    const enabled = !!m?.enabled;
      t.devBotEnabled = enabled;
      if (!enabled) {
        const botIdx = findBotIndex(t);
        if (botIdx >= 0) t.seats[botIdx] = null;
        try { if (t.poker?.botTimer) { clearTimeout(t.poker.botTimer); t.poker.botTimer = null; } } catch {}
      } else {
        if (findBotIndex(t) === -1) seatFirstEmpty(t, 'bot:dev', 'bot');
      }
      t.lastActive = nowMs();
      reconcileBotPolicy(t);
      emitUpdate(t); ensureLobbyPolicy(); emitLobby();
    } catch {}
  });

  // Simulated flag echo (OFFCHAIN only)
  socket.on('poker:mode', (m) => {
    try {
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      if (!isPoker(t)) return;
      if (t.category === CAT.OFFCHAIN_NL) t.simulated = !!(m && m.simulated);
      io.to(currentTableId).emit('poker:mode', { simulated: !!t.simulated, table: tablePublic(t) });
      t.lastActive = nowMs();
      emitUpdate(t); ensureLobbyPolicy(); emitLobby();
    } catch {}
  });

  // Faro-only
  socket.on('place_bet', (m) => {
    try {
      if (paused) { socket.emit('error', { message: 'paused' }); return; }
      if (!currentTableId) return;
      const t = getTable(currentTableId);
      if (t.kind !== 'FARO') return;
      const rank = Number(m.rank);
      const amount = Math.max(1, Number(m.amount || 0) | 0);
      const copper = !!m.copper;
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
      if (t.kind !== 'FARO') return;
      const s = t.seats.find(x => x && x.addr === addrLower);
      if (!s) return;
      if (s.ready) { socket.emit('error', { message: 'Already ready' }); return; }
      try { t.bets.delete(String(addrLower || '')); } catch {}
      s.lastActive = nowMs();
      t.lastActive = nowMs();
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
    try { const a = String(m.addr || '').toLowerCase(); const st = stats.get(a) || { rounds:0,wagered:0,won:0,lost:0 }; socket.emit('message', JSON.stringify({ type:'stats', addr:a, ...st })); } catch {}
  });

  // Admin
  socket.on('admin:pause', (m) => { try { if (!isAdmin) { socket.emit('error', { message:'not admin' }); return; } paused = !!m?.paused; io.emit('rt:paused', { paused, rakeBps, feesAccrued }); } catch {} });
  socket.on('admin:setRake', (m) => { try { if (!isAdmin) { socket.emit('error', { message:'not admin' }); return; } const bps = Math.max(0, Math.min(1000, Number(m?.bps || 0))); rakeBps = bps; io.emit('rt:state', { paused, rakeBps, feesAccrued }); } catch {} });
  socket.on('admin:resetFees', () => { try { if (!isAdmin) { socket.emit('error', { message:'not admin' }); return; } feesAccrued = 0; io.emit('rt:state', { paused, rakeBps, feesAccrued }); } catch {} });
  socket.on('health', () => { try { socket.emit('health', { ok:true, now:Date.now(), paused, rakeBps, feesAccrued }); } catch {} });
  socket.on('admin:restart', () => { try { if (!isAdmin) { socket.emit('error', { message:'not admin' }); return; } socket.emit('system', 'restarting backend'); setTimeout(() => { try { process.exit(0); } catch {} }, 100); } catch {} });
  socket.on('admin:shutdown', () => { try { if (!isAdmin) { socket.emit('error', { message:'not admin' }); return; } socket.emit('system', 'shutting down backend'); setTimeout(() => { try { process.exit(0); } catch {} }, 100); } catch {} });
});

/* ------------------------- Background maintenance -------------------------- */

// Enforce baselines, spawn/prune, lobby refresh
setInterval(() => { try { ensureLobbyPolicy(); emitLobby(); } catch {} }, LOBBY_TICK_MS);

// Auto-eject inactive unready seats + reconcile bot + emit updates
setInterval(() => {
  try {
    const now = nowMs();
    for (const [, t] of tables.entries()) {
      let changed = false;
      for (let i = 0; i < t.seats.length; i++) {
        const s = t.seats[i];
        if (!s) continue;
        const last = Number(s.lastActive || 0);
        if (!s.ready && last && (now - last) > IDLE_EJECT_MS) {
          if (t.kind==='FARO') { try { t.bets.delete(String(s.addr||'').toLowerCase()); } catch {} }
          try { clearPrivateHoleForSeat(t, i); } catch {}
          t.seats[i] = null;
          changed = true;
        }
      }
      if (isPoker(t) && changed) reconcileBotPolicy(t);
      if (changed) { t.lastActive = nowMs(); emitUpdate(t); }
    }
  } catch {}
}, 7_000);

// Persist a crash-safe snapshot (we clear active hands on restore for safety)
function saveState() {
  try {
    const out = [];
    for (const t of tables.values()) {
      out.push({
        id: t.id,
        kind: t.kind,
        seats: t.seats.map(s => s && { id: s.id, addr: s.addr, ready: !!s.ready, balance: s.balance||0, lastActive: s.lastActive||0 }),
        started: !!t.started,
        lastActive: t.lastActive||0,
        category: t.category||null, limit: t.limit||null, stakes: t.stakes||null,
        simulated: !!t.simulated, devBotEnabled: !!t.devBotEnabled,
        emptySince: t.emptySince || null,
      });
    }
    fs.writeFile(STATE_FN, JSON.stringify({ savedAt: Date.now(), tables: out }, null, 2), () => {});
  } catch {}
}
setInterval(saveState, SAVE_INTERVAL_MS);

// Restore snapshot (clear hands)
(function restoreState() {
  try {
    if (!fs.existsSync(STATE_FN)) return;
    const raw = JSON.parse(fs.readFileSync(STATE_FN, 'utf8'));
    const arr = raw?.tables || [];
    arr.forEach(o => {
      const t = getTable(o.id);
      t.kind = o.kind;
      t.seats = Array.isArray(o.seats) ? o.seats.map(s => s && { ...s }) : (t.kind==='POKER' ? Array.from({ length: POKER_SEATS }, () => null) : Array.from({ length: FARO_SEATS }, () => null));
      t.started = !!o.started;
      t.lastActive = o.lastActive || Date.now();
      t.category = o.category || t.category;
      t.limit    = o.limit || t.limit;
      t.stakes   = o.stakes || t.stakes;
      t.simulated = !!o.simulated;
      t.devBotEnabled = !!o.devBotEnabled;
      t.emptySince = o.emptySince || null;
      // Ensure no dangling hand
      t.poker = null;
      if (isPoker(t)) reconcileBotPolicy(t);
    });
    emitLobby();
  } catch {}
})();

/* ------------------------------ Server listen ------------------------------ */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  try {
    console.log('RT server on', PORT, '| enabled games:', Array.from(enabledGames).join(','));
  } catch {
    console.log('RT server on', PORT);
  }
  // Emit once after listen to wake up any early clients
  setTimeout(() => { try { ensureLobbyPolicy(); emitLobby(); } catch (e) { console.error(e); } }, 150);
});

/* ----------------------- Dev helper: simple poker bot ---------------------- */

function nextActiveIndex(actors, from) {
  if (!actors.length) return -1;
  let i = (from + 1) % actors.length, spins = 0;
  while (spins < actors.length) { if (!actors[i]?.folded) return i; i = (i + 1) % actors.length; spins++; }
  return -1;
}
function bettingRoundComplete(state) {
  const target = Number(state.toCall||0);
  return state.actors.filter(a => !a.folded).every(a => a.acted && Number(a.contrib||0) === target);
}

function maybeTriggerBot(tableId, t) {
  try {
    if (!t?.devBotEnabled) return;
    if (t.category !== CAT.OFFCHAIN_NL) return; // never act on on-chain tables
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
        applyAction(tableId, t, actor.addr, action, true);
      } catch {}
    }, 700 + Math.floor(Math.random() * 900));
  } catch {}
}
