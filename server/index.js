// Simple WebSocket server managing tables up to 6 players each
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const wss = new WebSocketServer({ port: PORT });

// tables: Map<tableId, { id, createdAt, seats: [ seat ], ownerId, started, state }>
// seat: { id, addr, ready, ws }
const tables = new Map();
const profiles = new Map(); // addr -> { cipher: string }

function send(ws, type, data = {}) {
  try { ws.send(JSON.stringify({ type, ...data })); } catch {}
}

function broadcast(table, type, data = {}) {
  for (const seat of table.seats) {
    if (seat?.ws && seat.ws.readyState === 1) send(seat.ws, type, data);
  }
}

function getPublicTable(table) {
  return {
    id: table.id,
    createdAt: table.createdAt,
    started: !!table.started,
    ownerId: table.ownerId,
    stage: table.stage || null,
    deadline: table.deadline || null,
    round: Number(table.round || 0),
    lockAt: table.lockAt || null,
    seats: table.seats.map((s) => (s ? { id: s.id, addr: s.addr || null, ready: !!s.ready, balance: Number(s.balance || 0), pending: (table.bets.get(s.id) || []).reduce((a,b)=>a+Math.max(0, Number(b?.amount||0)),0), avatar: s.avatar || null } : null)),
  };
}

function ensureTable(tableId) {
  let table = tables.get(tableId);
  if (!table) {
    table = {
      id: tableId,
      createdAt: Date.now(),
      seats: new Array(6).fill(null),
      ownerId: null,
      started: false,
      state: {},
      bets: new Map(),
      shoe: [],
      shoeIdx: 0,
      burned: false,
      stage: null,
      deadline: null,
      stageReady: new Set(),
      timer: null,
      round: 0,
    };
    tables.set(tableId, table);
  }
  return table;
}

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const MIN_BET = 1;
const MAX_BET = 1000;
const BET_LOCK_BEFORE_MS = 5000;
const profiles = new Map(); // addr -> { cipher, updatedAt }
const stats = new Map(); // addr -> { rounds, wagered, won, lost, lastDelta, updatedAt }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function newShoe(){ const d=[]; for(let r=0;r<13;r++){ for(let c=0;c<4;c++){ d.push(r);} } return shuffle(d); }
function draw(table){ if (!table.shoe || table.shoe.length - table.shoeIdx < 1){ table.shoe=newShoe(); table.shoeIdx=0; table.burned=false; } const v=table.shoe[table.shoeIdx++]; return v; }
function aggregateBets(table){ const agg={}; for(let i=0;i<13;i++){ agg[RANKS[i]]=0; } for (const [, list] of table.bets.entries()){ for(const b of list){ agg[RANKS[b.rank]] = (agg[RANKS[b.rank]]||0) + Number(b.amount||0); } } return agg; }
function aggregateBetDetails(table){ const det={}; for(let i=0;i<13;i++){ det[RANKS[i]]=[]; } for (const [sid, list] of table.bets.entries()){ const seat = table.seats.find(s=>s && s.id===sid); const addr = seat?.addr || null; for(const b of list){ det[RANKS[b.rank]].push({ addr, amount:Number(b.amount||0), copper:!!b.copper }); } } return det; }
function seatCount(table){ return table.seats.filter(Boolean).length; }

function clearTimer(table){ if (table.timer) { try { clearTimeout(table.timer); } catch{} table.timer = null; } }
function broadcastStage(table){ broadcast(table, 'table:stage', { stage: table.stage, deadline: table.deadline, table: getPublicTable(table) }); }
function scheduleStage(table, stage, ms=30000){
  clearTimer(table);
  table.stage = stage;
  const duration = stage === 'betting' ? 60000 : ms;
  table.deadline = Date.now() + duration;
  table.lockAt = stage === 'betting' ? (table.deadline - BET_LOCK_BEFORE_MS) : null;
  table.stageReady = new Set();
  if (stage === 'betting') table.round = Number(table.round || 0) + 1;
  broadcastStage(table);
  table.timer = setTimeout(() => onStageDeadline(table), duration + 10);
}

function ejectNotReady(table){
  const out = [];
  for (let i=0;i<table.seats.length;i++){
    const s = table.seats[i];
    if (!s) continue;
    if (table.stageReady.has(s.id)) continue;
    const bets = table.bets.get(s.id) || [];
    let total = 0; for (const b of bets) total += Math.max(0, Number(b.amount||0));
    if (total>0){ s.balance = Number(s.balance||0) - total; }
    table.bets.delete(s.id);
    try { send(s.ws, 'eject', { reason: 'Not ready in time', forfeit: total }); } catch{}
    table.seats[i] = null;
    out.push(s);
  }
  if (out.length) broadcast(table, 'table:update', { table: getPublicTable(table), bets: aggregateBets(table) });
  return out;
}

function startShoe(table){
  table.started = true;
  table.state = { startedAt: Date.now(), coups: 0 };
  table.shoe = newShoe(); table.shoeIdx = 0; table.burned = false; table.bets.clear && table.bets.clear();
  broadcast(table, 'table:started', { table: getPublicTable(table) });
}

function dealCoup(table){
  if (!table.burned) { draw(table); table.burned = true; }
  const bank = draw(table);
  const player = draw(table);
  const doublet = bank === player;
  const results = [];
  for (const seat of table.seats) {
    if (!seat) continue;
    const bets = table.bets.get(seat.id) || [];
    let delta = 0;
    let wagered = 0;
    for (const b of bets) {
      wagered += Math.max(0, Number(b.amount||0));
      if (doublet && b.rank === bank) { delta -= Math.floor(b.amount/2); continue; }
      if (b.rank === bank) delta += (b.copper ? b.amount : -b.amount);
      if (b.rank === player) delta += (b.copper ? -b.amount : b.amount);
    }
    if (delta !== 0) { seat.balance = Number(seat.balance||0) + delta; }
    results.push({ seatId: seat.id, addr: seat.addr, delta });
    // Update lifetime stats per address
    if (seat.addr) {
      const key = String(seat.addr).toLowerCase();
      const s = stats.get(key) || { rounds:0, wagered:0, won:0, lost:0, lastDelta:0, updatedAt:0 };
      if (bets.length) s.rounds += 1;
      s.wagered += wagered;
      if (delta > 0) s.won += delta; else if (delta < 0) s.lost += -delta;
      s.lastDelta = delta;
      s.updatedAt = Date.now();
      stats.set(key, s);
    }
  }
  table.bets.clear();
  table.state.coups = (table.state.coups||0) + 1;
  broadcast(table, 'table:coup', { bankRank: RANKS[bank], playerRank: RANKS[player], doublet, results });
  broadcast(table, 'table:update', { table: getPublicTable(table), bets: aggregateBets(table), betsDetail: aggregateBetDetails(table) });
}

function tryAdvance(table){
  const active = table.seats.filter(Boolean);
  if (!active.length) { clearTimer(table); table.stage=null; table.deadline=null; broadcastStage(table); return; }
  const allReady = active.every(s => table.stageReady.has(s.id));
  if (!allReady) return;
  clearTimer(table);
  if (!table.started) {
    startShoe(table);
    scheduleStage(table, 'betting');
  } else if (table.stage === 'betting') {
    dealCoup(table);
    scheduleStage(table, 'betting');
  } else {
    scheduleStage(table, 'betting');
  }
}

function onStageDeadline(table){
  ejectNotReady(table);
  const active = table.seats.filter(Boolean);
  if (!active.length) { clearTimer(table); table.stage=null; table.deadline=null; broadcastStage(table); return; }
  if (!table.started) {
    startShoe(table);
    scheduleStage(table, 'betting');
  } else if (table.stage === 'betting') {
    dealCoup(table);
    scheduleStage(table, 'betting');
  } else {
    scheduleStage(table, 'betting');
  }
}

function removeWs(ws) {
  for (const table of tables.values()) {
    let changed = false;
    for (let i = 0; i < table.seats.length; i++) {
      const s = table.seats[i];
      if (s?.ws === ws) {
        table.seats[i] = null;
        if (table.ownerId === s.id) table.ownerId = null;
        changed = true;
      }
    }
    if (changed) broadcast(table, 'table:update', { table: getPublicTable(table) });
  }
}

wss.on('connection', (ws) => {
  ws.id = nanoid();
  ws.addr = null;
  ws.tableId = null;
  ws.allowedRound = 0;
  send(ws, 'hello', { id: ws.id });

  ws.on('message', (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    const t = String(msg?.type || '');

    if (t === 'identify') {
      ws.addr = String(msg.addr || '').slice(0, 80);
      return send(ws, 'ok', { type: 'identify' });
    }

    if (t === 'join_table') {
      const tableId = String(msg.tableId || 'lobby');
      const table = ensureTable(tableId);
      ws.tableId = table.id;
      ws.allowedRound = table.started ? Number(table.round || 0) + 1 : Number(table.round || 0);
      send(ws, 'you', { allowedRound: ws.allowedRound, round: Number(table.round||0), started: !!table.started });
      send(ws, 'table:update', { table: getPublicTable(table), bets: aggregateBets(table), betsDetail: aggregateBetDetails(table) });
      if (!table.stage) scheduleStage(table, 'betting');
      return;
    }

    if (t === 'seat') {
      const idx = Math.max(0, Math.min(5, Number(msg.index)));
      if (!ws.tableId) return;
      const table = ensureTable(ws.tableId);
      // Enforce spectate-until-next-round when game already started
      if (table.started && Number(table.round || 0) < Number(ws.allowedRound || 0)) {
        return send(ws, 'error', { message: 'Wait until next round to join' });
      }
      // Reject if spot taken
      if (table.seats[idx] && table.seats[idx].ws !== ws) return send(ws, 'error', { message: 'Seat taken' });
      // Remove from other seats first
      for (let i = 0; i < table.seats.length; i++) if (table.seats[i]?.ws === ws) table.seats[i] = null;
      const seat = table.seats[idx] || { id: nanoid(), addr: ws.addr, ready: false, balance: 100, ws };
      seat.ws = ws; seat.addr = ws.addr; seat.ready = !!seat.ready; seat.balance = Number(seat.balance || 100);
      table.seats[idx] = seat;
      if (!table.ownerId) table.ownerId = seat.id;
      broadcast(table, 'table:update', { table: getPublicTable(table), bets: aggregateBets(table), betsDetail: aggregateBetDetails(table) });
      if (!table.stage) scheduleStage(table, 'betting');
      return;
    }

    if (t === 'ready') {
      if (!ws.tableId) return;
      const table = ensureTable(ws.tableId);
      const seat = table.seats.find((s)=>s?.ws===ws);
      if (!seat) return;
      if (!table.stage) scheduleStage(table, table.started ? 'betting' : 'start');
      if (msg.ready) table.stageReady.add(seat.id); else table.stageReady.delete(seat.id);
      broadcast(table, 'table:stage', { stage: table.stage, deadline: table.deadline, table: getPublicTable(table) });
      tryAdvance(table);
      return;
    }

    if (t === 'start') {
      if (!ws.tableId) return;
      const table = ensureTable(ws.tableId);
      const actor = table.seats.find((s) => s?.ws === ws);
      if (!actor || actor.id !== table.ownerId) return send(ws, 'error', { message: 'Only owner can start' });
      if (!table.seats.filter(Boolean).length) return;
      if (!table.seats.filter(Boolean).every((s) => s.ready)) return send(ws, 'error', { message: 'All players must ready' });
      table.started = true;
      table.state = { startedAt: Date.now(), coups: 0 };
      table.shoe = newShoe();
      table.shoeIdx = 0;
      table.burned = false;
      table.bets.clear && table.bets.clear();
      broadcast(table, 'table:started', { table: getPublicTable(table) });
      return;
    }

    if (t === 'place_bet') {
      if (!ws.tableId) return;
      const table = ensureTable(ws.tableId);
      const seat = table.seats.find((s)=>s?.ws===ws);
      if (!seat) return send(ws, 'error', { message: 'Sit first' });
      if ((table.stage||'') !== 'betting') return send(ws, 'error', { message: 'Not in betting stage' });
      if (table.lockAt && Date.now() >= table.lockAt) return send(ws, 'error', { message: 'Betting locked' });
      const rankSym = String(msg.rank||'').toUpperCase();
      const rank = RANKS.indexOf(rankSym);
      if (rank < 0) return send(ws, 'error', { message: 'Invalid rank' });
      let amount = Math.floor(Number(msg.amount||0));
      if (!(amount>=MIN_BET)) return send(ws, 'error', { message: `Min bet is ${MIN_BET}` });
      if (amount > MAX_BET) return send(ws, 'error', { message: `Max bet is ${MAX_BET}` });
      const pending = (table.bets.get(seat.id) || []).reduce((a,b)=>a+Number(b.amount||0),0);
      if (amount + pending > Number(seat.balance||0)) return send(ws, 'error', { message: 'Insufficient balance' });
      const copper = !!msg.copper;
      const list = table.bets.get(seat.id) || [];
      list.push({ rank, amount, copper });
      table.bets.set(seat.id, list);
      broadcast(table, 'table:update', { table: getPublicTable(table), bets: aggregateBets(table), betsDetail: aggregateBetDetails(table) });
      return;
    }

    if (t === 'deal') {
      if (!ws.tableId) return;
      const table = ensureTable(ws.tableId);
      const actor = table.seats.find((s)=>s?.ws===ws);
      if (!actor || actor.id !== table.ownerId) return send(ws, 'error', { message: 'Only owner can deal' });
      if (!table.started) return send(ws, 'error', { message: 'Start the shoe first' });
      dealCoup(table);
      scheduleStage(table, 'betting');
      return;
    }

    if (t === 'stat_read') {
      const addr = String(msg.addr || ws.addr || '').toLowerCase();
      if (!addr) return send(ws, 'error', { message: 'No address' });
      const s = stats.get(addr) || { rounds:0, wagered:0, won:0, lost:0, lastDelta:0, updatedAt:null };
      return send(ws, 'stats', { addr, ...s });
    }

    if (t === 'profile_save') {
      try {
        const addr = String(ws.addr||'').toLowerCase();
        if (!addr) return send(ws, 'error', { message: 'Need wallet identity' });
        const cipher = String(msg.cipher||'').slice(0, 500000); // cap ~500KB
        if (!cipher) return send(ws, 'error', { message: 'Missing cipher' });
        profiles.set(addr, { cipher, updatedAt: Date.now() });
        return send(ws, 'ok', { type: 'profile_save' });
      } catch (e) { return send(ws, 'error', { message: 'Save failed' }); }
    }

    if (t === 'profile_get') {
      try {
        const addr = String(ws.addr||'').toLowerCase();
        if (!addr) return send(ws, 'error', { message: 'Need wallet identity' });
        const p = profiles.get(addr) || null;
        return send(ws, 'profile', { cipher: p?.cipher || null, updatedAt: p?.updatedAt || null });
      } catch (e) { return send(ws, 'error', { message: 'Load failed' }); }
    }
    if (t === 'set_avatar') {
      if (!ws.tableId) return;
      const table = ensureTable(ws.tableId);
      const seat = table.seats.find((s)=>s?.ws===ws);
      if (!seat) return send(ws, 'error', { message: 'Sit first to set avatar' });
      try {
        const url = (msg.url && String(msg.url).slice(0, 512)) || null;
        const data = (msg.data && String(msg.data).slice(0, 200000)) || null;
        if (data && data.startsWith('data:image/')) {
          seat.avatar = data;
        } else if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          seat.avatar = url;
        } else if (!url && !data) {
          seat.avatar = null;
        }
      } catch {}
      broadcast(table, 'table:update', { table: getPublicTable(table) });
      return;
    }

    if (t === 'chat') {
      if (!ws.tableId) return;
      const table = ensureTable(ws.tableId);
      const text = String(msg.text || '').slice(0, 240);
      broadcast(table, 'chat', { from: ws.addr || ws.id, text });
      return;
    }
  });

  ws.on('close', () => removeWs(ws));
  ws.on('error', () => removeWs(ws));
});

console.log(`[multiplayer] WebSocket server listening on :${PORT}`);
