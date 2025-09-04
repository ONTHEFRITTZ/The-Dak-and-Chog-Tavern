// Simple WebSocket server managing tables up to 6 players each
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const wss = new WebSocketServer({ port: PORT });

// tables: Map<tableId, { id, createdAt, seats: [ seat ], ownerId, started, state }>
// seat: { id, addr, ready, ws }
const tables = new Map();

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
    seats: table.seats.map((s) => (s ? { id: s.id, addr: s.addr || null, ready: !!s.ready, balance: Number(s.balance || 0) } : null)),
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
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function newShoe(){ const d=[]; for(let r=0;r<13;r++){ for(let c=0;c<4;c++){ d.push(r);} } return shuffle(d); }
function draw(table){ if (!table.shoe || table.shoe.length - table.shoeIdx < 1){ table.shoe=newShoe(); table.shoeIdx=0; table.burned=false; } const v=table.shoe[table.shoeIdx++]; return v; }
function seatCount(table){ return table.seats.filter(Boolean).length; }

function clearTimer(table){ if (table.timer) { try { clearTimeout(table.timer); } catch{} table.timer = null; } }
function broadcastStage(table){ broadcast(table, 'table:stage', { stage: table.stage, deadline: table.deadline, table: getPublicTable(table) }); }
function scheduleStage(table, stage, ms=30000){
  clearTimer(table);
  table.stage = stage;
  const duration = stage === 'betting' ? 60000 : ms;
  table.deadline = Date.now() + duration;
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
  if (out.length) broadcast(table, 'table:update', { table: getPublicTable(table) });
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
    for (const b of bets) {
      if (doublet && b.rank === bank) { delta -= Math.floor(b.amount/2); continue; }
      if (b.rank === bank) delta += (b.copper ? b.amount : -b.amount);
      if (b.rank === player) delta += (b.copper ? -b.amount : b.amount);
    }
    if (delta !== 0) { seat.balance = Number(seat.balance||0) + delta; }
    results.push({ seatId: seat.id, addr: seat.addr, delta });
  }
  table.bets.clear();
  table.state.coups = (table.state.coups||0) + 1;
  broadcast(table, 'table:coup', { bankRank: RANKS[bank], playerRank: RANKS[player], doublet, results });
  broadcast(table, 'table:update', { table: getPublicTable(table) });
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
      send(ws, 'table:update', { table: getPublicTable(table) });
      if (!table.stage) scheduleStage(table, table.started ? 'betting' : 'start');
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
      broadcast(table, 'table:update', { table: getPublicTable(table) });
      if (!table.stage) scheduleStage(table, table.started ? 'betting' : 'start');
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
      const rankSym = String(msg.rank||'').toUpperCase();
      const rank = RANKS.indexOf(rankSym);
      if (rank < 0) return send(ws, 'error', { message: 'Invalid rank' });
      let amount = Math.floor(Number(msg.amount||0));
      if (!(amount>0)) return send(ws, 'error', { message: 'Invalid amount' });
      amount = Math.min(amount, 1000000);
      const copper = !!msg.copper;
      const list = table.bets.get(seat.id) || [];
      list.push({ rank, amount, copper });
      table.bets.set(seat.id, list);
      broadcast(table, 'table:update', { table: getPublicTable(table) });
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
