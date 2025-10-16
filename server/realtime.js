// Realtime server: Faro + Poker (offchain/onchain), fairness, auditing, private hole cards
// ENV: PORT (default 3000) GAME_TYPES (comma-separated: FARO,POKER; default FARO,POKER) ADMIN_ADDR RT_RAKE_BPS MONAD_BUNDLER_RPC
// Socket.IO path is /socket.io/ (nginx proxies /poker.io/ â†’ /socket.io/ upstream)

const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// Onchain dealer integration (safe no-ops if file exports stubs)
const { onBeginHand, onSettleHand, dealerSignerConfigured } = require('./dealeronchain');

/* ----------------------------- HTTP + Socket.IO ---------------------------- */
// --------------------- Simple HTTP rate limiting for indexer ---------------------
const HTTP_RL_WINDOW_MS = Number(process.env.INDEXER_RL_WINDOW_MS || 60_000);
const HTTP_RL_LIMIT = Number(process.env.INDEXER_RL_LIMIT || 60);
const httpBuckets = new Map(); // ip -> [timestamps]
function getClientIp(req) {
  try {
    const xf = req.headers['x-forwarded-for'];
    if (xf) {
      const ip = String(xf).split(',')[0].trim();
      if (ip) return ip;
    }
  } catch {}
  try { return req.socket.remoteAddress || ''; } catch { return ''; }
}
function httpAllow(ip) {
  const now = Date.now();
  let arr = httpBuckets.get(ip) || [];
  arr = arr.filter((t) => (now - t) < HTTP_RL_WINDOW_MS);
  arr.push(now);
  httpBuckets.set(ip, arr);
  return arr.length <= HTTP_RL_LIMIT;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://local');
    const p = u.pathname || '/';
    if (p === '/events' || p === '/api/events' || p === '/api/v1/events') {
      // Rate limit per client IP
      const ip = getClientIp(req);
      if (!httpAllow(ip)) {
        res.statusCode = 429;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Retry-After', String(Math.ceil(HTTP_RL_WINDOW_MS / 1000)));
        res.end(JSON.stringify({ error: 'rate_limited', windowMs: HTTP_RL_WINDOW_MS, limit: HTTP_RL_LIMIT }));
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      const addr = String(u.searchParams.get('address') || u.searchParams.get('contract') || '').toLowerCase();
      const limit = Math.min(100, Math.max(1, Number(u.searchParams.get('limit') || 10)));
      if (!addr || !/^0x[0-9a-f]{40}$/.test(addr)) {
        res.statusCode = 400; res.end(JSON.stringify({ error: 'address missing/invalid' })); return;
      }
      const RPC = process.env.MONAD_BUNDLER_RPC || process.env.MONAD_RPC_URL || process.env.RPC_URL || '';
      if (!RPC) { res.statusCode = 500; res.end(JSON.stringify({ error: 'RPC not configured (MONAD_BUNDLER_RPC or MONAD_RPC_URL)' })); return; }
      const provider = new ethers.JsonRpcProvider(RPC);
      // Minimal ABI: we only need events to decode
      const ABI_EVENTS = [
        'event SeatTaken(address indexed player, uint8 indexed seat, uint256 amount)',
        'event SeatLeft(address indexed player, uint8 indexed seat, uint256 returnedAmount)',
        'event Joined(address indexed player, uint8 indexed seat)',
        'event LeftDuringHand(address indexed player, uint8 indexed seat)',
        'event HandStarted(uint256 indexed handId, uint8 dealer, uint8 sb, uint8 bb)',
        'event Contributed(uint256 indexed handId, uint8 indexed seat, uint256 amount)',
        'event HandSettled(uint256 indexed handId, address[] winners, uint256[] payouts, uint256 rake)'
      ];
      const iface = new ethers.Interface(ABI_EVENTS);
      const latest = await provider.getBlockNumber();
      const fromBlock = Math.max(0, latest - 20_000);
      const logs = await provider.getLogs({ address: addr, fromBlock, toBlock: latest }).catch(() => []);
      const tail = logs.slice(-Math.max(1, limit)).reverse();
      const out = [];
      for (const lg of tail) {
        let decoded = null;
        try { decoded = iface.parseLog(lg); } catch {}
        let ts = null;
        try { const blk = await provider.getBlock(lg.blockNumber); ts = blk?.timestamp || null; } catch {}
        out.push({
          event: decoded?.name || 'event',
          args: decoded?.args ? Object.fromEntries(decoded.fragment.inputs.map((inp, i) => [inp.name || String(i), decoded.args[i]])) : {},
          blockNumber: lg.blockNumber,
          blockTimestamp: ts,
          txHash: lg.transactionHash
        });
      }
      res.statusCode = 200; res.end(JSON.stringify(out)); return;
    }
  } catch (err) {
    try { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: String(err?.message||err) })); return; } catch {}
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Tavern realtime OK');
});
const io = new Server(server, { path: '/socket.io/', cors: { origin: true, methods: ['GET','POST'] } });

/* --------------------------------- Config --------------------------------- */
const HAND_TURN_MS     = 25_000;
const SAVE_INTERVAL_MS = 10_000;
const LOBBY_TICK_MS    = 5_000;
const IDLE_EJECT_MS    = 90_000;
const EMPTY_PRUNE_MS   = 60_000;
const POKER_SEATS      = 8;
const FARO_SEATS       = 6;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOGS_DIR = path.resolve(process.cwd(), 'logs');
const STATE_FN = path.join(DATA_DIR, 'state.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

/* --------------------------------- State ---------------------------------- */
const tables = new Map();
const profiles = new Map();
const publicProfiles = new Map();
const stats = new Map();

let paused = false;
let rakeBps = Number(process.env.RT_RAKE_BPS || 100); // 1%
let feesAccrued = 0;

const admins = new Set(String(process.env.ADMIN_ADDR||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean));
const enabledGames = new Set(String(process.env.GAME_TYPES||'FARO,POKER').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean));

/* --------------------------------- Helpers -------------------------------- */
function gameEnabled(n){ return enabledGames.has(String(n||'').toUpperCase()); }
function nowMs(){ return Date.now(); }
function short(v){ return v && v.length>10 ? (v.slice(0,6)+'...'+v.slice(-4)) : (v||''); }
function seatCount(t){ return t.seats.filter(Boolean).length; }
function ensureStats(addr){ const k=(addr||'').toLowerCase(); if(!stats.has(k)) stats.set(k,{rounds:0,wagered:0,won:0,lost:0}); return stats.get(k); }
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

/* ------------------------------- Audit logging ----------------------------- */
function logFileName(){ const d=new Date(), y=d.getUTCFullYear(), m=String(d.getUTCMonth()+1).padStart(2,'0'), day=String(d.getUTCDate()).padStart(2,'0'); return path.join(LOGS_DIR,`audit-${y}${m}${day}.log`); }
function audit(tableId,type,payload){ fs.appendFile(logFileName(), JSON.stringify({ts:new Date().toISOString(),tableId,type,payload})+'\n', ()=>{} ); }

/* ------------------------------ Rate limiting ------------------------------ */
const RLIMIT={ chat:{limit:8,windowMs:5000}, seat:{limit:8,windowMs:5000}, 'poker:act':{limit:20,windowMs:10000} };
const buckets=new Map();
function allow(sid,ev){ const cfg=RLIMIT[ev]; if(!cfg) return true; const now=Date.now(); if(!buckets.has(sid)) buckets.set(sid,{}); const slot=buckets.get(sid); const keep=(slot[ev]||[]).filter(t=>now-t<cfg.windowMs); keep.push(now); slot[ev]=keep; return keep.length<=cfg.limit; }

/* ------------------------------- Table creates ----------------------------- */
function getTable(id){
  if (tables.has(id)) return tables.get(id);
  const low=String(id||'').toLowerCase();

  if (low.startsWith('poker-nl-')) {
    const t={ id, kind:'POKER', seats:Array.from({length:POKER_SEATS},()=>null), started:false, lastActive:nowMs(), category:'ONCHAIN_NL', limit:'NL', simulated:false, poker:null };
    tables.set(id,t); return t;
  }
  if (low.startsWith('poker-fl-')) {
    const t={ id, kind:'POKER', seats:Array.from({length:POKER_SEATS},()=>null), started:false, lastActive:nowMs(), category:'ONCHAIN_FL', limit:'FL', stakes:'3/6 DCMon', simulated:false, poker:null };
    tables.set(id,t); return t;
  }
  if (low.startsWith('poker-sim-')) {
    const t={ id, kind:'POKER', seats:Array.from({length:POKER_SEATS},()=>null), started:false, lastActive:nowMs(), category:'OFFCHAIN_NL', limit:'NL', simulated:true, poker:null };
    tables.set(id,t); return t;
  }

  const t={ id, kind:'FARO', seats:Array.from({length:FARO_SEATS},()=>null), started:false, bets:new Map(), ownerId:null, lastActive:nowMs() };
  tables.set(id,t); return t;
}
function nextIdFor(prefix){
  const nums=Array.from(tables.keys()).map(id=>new RegExp('^'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\d+)$').exec(id)).filter(Boolean).map(m=>Number(m[1]));
  return `${prefix}${nums.length?Math.max(...nums)+1:1}`;
}


function dealerSignerOnline() {
  try {
    return typeof dealerSignerConfigured === 'function' ? !!dealerSignerConfigured() : false;
  } catch (err) {
    return false;
  }
}

const POKER_LOBBY_META = Object.freeze({
  ONCHAIN_NL: {
    tableMode: 'onchain',
    typeLabel: 'On-Chain NL',
    typeKey: 'onchain-nl',
    tooltip: 'DCMon No-Limit table settled by HoldemPoker.',
    currency: 'DCMon',
    decimals: 18,
    blinds: { sb: '0.001', bb: '0.002' },
    minBuy: { amount: '1', unit: 'DCMon', wei: '1000000000000000000' },
    maxBuy: { amount: '200', unit: 'DCMon', wei: '200000000000000000000' },
    stackRequirement: 'Bring >= 1 DCMon; 50-100 BB recommended.',
    preflight: { needsWallet: true, needsDcmon: true, needsSponsor: false }
  },
  ONCHAIN_FL: {
    tableMode: 'onchain',
    typeLabel: 'On-Chain Limit',
    typeKey: 'onchain-fl',
    tooltip: 'DCMon Fixed-Limit table with on-chain dealer settlement.',
    currency: 'DCMon',
    decimals: 18,
    blinds: { sb: '3', bb: '6' },
    minBuy: { amount: '6', unit: 'DCMon', wei: '6000000000000000000' },
    maxBuy: { amount: '200', unit: 'DCMon', wei: '200000000000000000000' },
    stackRequirement: 'Buy at least 6 DCMon (1 big bet).',
    preflight: { needsWallet: true, needsDcmon: true, needsSponsor: false }
  },
  OFFCHAIN_NL: {
    tableMode: 'f2p',
    typeLabel: 'Free to Play',
    typeKey: 'simulated',
    tooltip: 'Simulated chips only; no DCMon required.',
    currency: 'Chips',
    decimals: 0,
    blinds: { sb: '1', bb: '2' },
    minBuy: { amount: '0', unit: 'Chips', wei: '0' },
    maxBuy: { amount: '0', unit: 'Chips', wei: '0' },
    stackRequirement: 'Practice mode; guest seats allowed.',
    preflight: { needsWallet: false, needsDcmon: false, needsSponsor: false }
  }
});

function cloneLobbyMeta(meta) {
  if (!meta) return null;
  return JSON.parse(JSON.stringify(meta));
}

function lobbyMetaForTable(t) {
  if (!isPoker(t)) return null;
  const preset = POKER_LOBBY_META[t.category] || null;
  return preset ? cloneLobbyMeta(preset) : null;
}

/* ----------------------------- Poker categories ---------------------------- */
const CAT=Object.freeze({ ONCHAIN_NL:'ONCHAIN_NL', ONCHAIN_FL:'ONCHAIN_FL', OFFCHAIN_NL:'OFFCHAIN_NL' });
function idPrefixFor(cat){ if(cat===CAT.ONCHAIN_NL)return'poker-nl-'; if(cat===CAT.ONCHAIN_FL)return'poker-fl-'; return'poker-sim-'; }
function isPoker(t){ return t?.kind==='POKER'; }
function pokerTablesBy(cat){ return Array.from(tables.values()).filter(t=>isPoker(t)&&t.category===cat); }
function ensurePokerTable(cat){ const ex=pokerTablesBy(cat); if(ex.length===0){ const id=nextIdFor(idPrefixFor(cat)); return getTable(id);} return ex[0]; }

/* ------------------------------- Public views ------------------------------ */
function tablePublic(t){
  if (t.kind==='FARO'){
    return {
      id:t.id,
      seats:t.seats.map(s=> s && {
        id:s.id, addr:s.addr, balance:Number(s.balance||0), lastActive:Number(s.lastActive||0),
        betTotal:(()=>{try{const bs=t.bets.get(String(s.addr||'').toLowerCase())||[]; return bs.reduce((a,b)=>a+Number(b?.amount||0),0);}catch{return 0;}})(),
        betCount:(()=>{try{const bs=t.bets.get(String(s.addr||'').toLowerCase())||[]; return bs.length;}catch{return 0;}})(),
        x:(publicProfiles.get(s.addr||'')||{}).x||null
      }),
      started:!!t.started, ownerId:t.ownerId, capacity:FARO_SEATS
    };
  }
  return {
    id:t.id,
    seats:t.seats.map(s=> {
      if (!s) return null;
      if (!isValidAddr(s.addr)) return null;
      return {
        id:s.id,
        addr:s.addr,
        balance:Number(s.balance||0),
        lastActive:Number(s.lastActive||0),
        x:(publicProfiles.get(s.addr||'')||{}).x||null,
        chips:Number(s.chips||0)
      };
    }),
    started:!!t.started, simulated:!!t.simulated,
    limit:t.limit, stakes:t.stakes||'', capacity:POKER_SEATS
  };
}
function emitUpdate(t){ try{ io.to(t.id).emit('table:update', tablePublic(t)); }catch{} }
function emitLobby(){
  try{
    const list = Array.from(tables.values())
      .filter(t => (t.kind==='FARO' ? gameEnabled('FARO') : gameEnabled('POKER')))
      .map(t => {
        const base = {
          id: t.id,
          seated: seatCount(t),
          capacity: (t.kind==='POKER' ? POKER_SEATS : FARO_SEATS),
          started: !!t.started
        };
        if (t.kind === 'POKER') {
          base.simulated = !!t.simulated;
          base.limit = t.limit;
          base.category = t.category || null;
          if (t.limit === 'FL') {
            const stakes = t.stakes || '3/6 DCMon';
            base.stakes = stakes.replace(/mon/i, 'DCMon');
          }
          const meta = lobbyMetaForTable(t);
          if (meta) base.meta = meta;
          base.tableMode = base.meta?.tableMode || (t.simulated ? 'f2p' : 'onchain');
          base.dealerSigner = base.tableMode === 'onchain' ? dealerSignerOnline() : false;
        } else {
          base.tableMode = 'f2p';
        }
        return base;
      });
    io.emit('lobby:list', list.sort((a,b)=> String(a.id).localeCompare(String(b.id))));
  }catch{}
}
/* ------------------------------ Start policy ------------------------------- */
function maybeStartHand(tableId, t){
  try{
    if (paused) return;
    if (!isPoker(t)) return;
    const active = t.seats.filter(Boolean);
    if (active.length >= 2 && !t.poker){
      startPokerHand(tableId, t);
    }
  }catch(e){ console.error('maybeStartHand', e); }
}


/* ------------------------ Poker spawn / prune policy ----------------------- */
function ensureCategoryBaselines(){ if(!gameEnabled('POKER')) return; ensurePokerTable(CAT.ONCHAIN_NL); ensurePokerTable(CAT.ONCHAIN_FL); ensurePokerTable(CAT.OFFCHAIN_NL); }
function spawnIfCrowded(cat){ const list=pokerTablesBy(cat); if(list.length===0){ ensurePokerTable(cat); return; } const crowded=list.some(t=> seatCount(t)>=6); if(!crowded) return; const hasEmpty=list.some(t=> seatCount(t)===0); if(!hasEmpty){ const id=nextIdFor(idPrefixFor(cat)); getTable(id); } }
function pruneEmpties(cat){
  const list=pokerTablesBy(cat); if(list.length===0) return;
  const now=nowMs(); list.forEach(t=>{ const sc=seatCount(t); if(sc===0) { if(!t.emptySince) t.emptySince=now; } else { t.emptySince=null; } });
  const empties=list.filter(t=> seatCount(t)===0).sort((a,b)=>(a.emptySince||0)-(b.emptySince||0));
  if (empties.length<2) return;
  const nonEmpty=list.filter(t=> seatCount(t)>0);
  const busy=nonEmpty.some(t=> seatCount(t)>=6);
  const minKeep = busy?2:1;
  const candidate = empties.find(t => (now - (t.emptySince||now)) >= EMPTY_PRUNE_MS);
  if (!candidate) return;
  if (list.length - 1 >= minKeep) { tables.delete(candidate.id); audit(candidate.id,'prune',{category:candidate.category}); }
}
function ensureLobbyPolicy(){
  if (gameEnabled('FARO')){
    if (!Array.from(tables.keys()).some(id=> String(id).startsWith('faro-'))) getTable('faro-1');
    const faro=Array.from(tables.values()).filter(t=> t.kind==='FARO');
    const now=nowMs(); const empties=faro.filter(t=> seatCount(t)===0);
    if (empties.length>=2){ const c=empties[0]; if(!c.emptySince) c.emptySince=now; if((now-(c.emptySince||now))>EMPTY_PRUNE_MS && faro.length>1){ tables.delete(c.id); audit(c.id,'prune',{kind:'FARO'}); } }
  }
  if (gameEnabled('POKER')){
    ensureCategoryBaselines();
    spawnIfCrowded(CAT.ONCHAIN_NL); spawnIfCrowded(CAT.ONCHAIN_FL); spawnIfCrowded(CAT.OFFCHAIN_NL);
    pruneEmpties(CAT.ONCHAIN_NL); pruneEmpties(CAT.ONCHAIN_FL); pruneEmpties(CAT.OFFCHAIN_NL);
  }
}

/* --------------------------- Deck / names / rng ---------------------------- */
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['c','d','h','s']; // clubs, diamonds, hearts, spades
function chogNamePng(code){
  // e.g., 'Ah' â†’ 'chog-ace-of-hearts.png'
  const r=code[0], s=code[1];
  const rn = ({A:'ace',K:'king',Q:'queen',J:'jack',T:'ten','9':'nine','8':'eight','7':'seven','6':'six','5':'five','4':'four','3':'three','2':'two'})[r];
  const sn = ({h:'hearts',d:'diamonds',c:'clubs',s:'spades'})[s];
  return `chog-${rn}-of-${sn}.png`;
}
function buildDeck(){ const d=[]; for(const r of RANKS){ for(const s of SUITS){ d.push(r+s); } } return d; }
// tiny deterministic PRNG (mulberry32)
function mulberry32(seed){
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleDeterministic(arr, seedBytes){
  const seed = seedBytes.readUInt32LE(0);
  const rnd = mulberry32(seed);
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(rnd()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}

/* ----------------------------- Evaluator (7c) ------------------------------ */
// Returns an array: [category, ...kickers] where higher lexicographically is better.
// category: 8=StraightFlush 7=Quads 6=FullHouse 5=Flush 4=Straight 3=Trips 2=TwoPair 1=Pair 0=High
function eval7(cardsCodes){
  // cardsCodes length 7, each 'Ah', 'Td' etc
  const valMap = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14 };
  const byRank = new Map(); const bySuit = new Map(); const uniqRanks = new Set();
  for(const c of cardsCodes){
    const r=c[0], s=c[1]; const v=valMap[r];
    byRank.set(r,(byRank.get(r)||0)+1);
    if(!bySuit.has(s)) bySuit.set(s,[]);
    bySuit.get(s).push(v);
    uniqRanks.add(v);
  }
  const ranksDesc = Array.from(uniqRanks).sort((a,b)=>b-a);
  function bestStraight(vals){ // return high card of best straight, incl. wheel
    const set = new Set(vals);
    if (set.has(14)) set.add(1); // wheel
    let best = 0;
    for(let hi=14; hi>=5; hi--){
      const need=[hi,hi-1,hi-2,hi-3,hi-4];
      if (need.every(x=>set.has(x))) { best = Math.max(best, hi===5?5:hi); break; }
    }
    return best; // 0 if none
  }
  // Straight flush?
  for(const [s, vals] of bySuit){
    if (vals.length>=5){
      const hi = bestStraight(vals);
      if (hi) return [8, hi];
    }
  }
  // Quads / Trips / Pairs
  const groups = Array.from(byRank.entries()).map(([r,c])=>({r, c, v:valMap[r]}));
  groups.sort((a,b)=> (b.c - a.c) || (b.v - a.v)); // by count desc then rank desc
  const counts = groups.map(g=>g.c);
  // Quads
  if (counts[0]===4){
    const quadV = groups[0].v;
    const kickers = ranksDesc.filter(v=>v!==quadV).slice(0,1);
    return [7, quadV, ...kickers];
    }
  // Full house
  const trips = groups.filter(g=>g.c===3).map(g=>g.v).sort((a,b)=>b-a);
  const pairs = groups.filter(g=>g.c===2).map(g=>g.v).sort((a,b)=>b-a);
  if (trips.length>=1 && (pairs.length>=1 || trips.length>=2)){
    const three = trips[0];
    const two = (pairs.length>=1) ? pairs[0] : trips[1];
    return [6, three, two];
  }
  // Flush
  for (const [s, vals] of bySuit){
    if (vals.length>=5){
      const top5 = vals.sort((a,b)=>b-a).slice(0,5);
      return [5, ...top5];
    }
  }
  // Straight
  const straightHi = bestStraight(ranksDesc);
  if (straightHi) return [4, straightHi];
  // Trips
  if (trips.length>=1){
    const three = trips[0];
    const kick = ranksDesc.filter(v=>v!==three).slice(0,2);
    return [3, three, ...kick];
  }
  // Two pair
  if (pairs.length>=2){
    const p1=pairs[0], p2=pairs[1];
    const kick=ranksDesc.filter(v=>v!==p1&&v!==p2)[0]||0;
    return [2, p1, p2, kick];
  }
  // One pair
  if (pairs.length===1){
    const p=pairs[0];
    const kicks=ranksDesc.filter(v=>v!==p).slice(0,3);
    return [1, p, ...kicks];
  }
  // High card
  return [0, ...ranksDesc.slice(0,5)];
}
function cmpRank(a,b){
  for (let i=0;i<Math.max(a.length,b.length);i++){
    const av=a[i]||-1, bv=b[i]||-1;
    if (av!==bv) return av-bv;
  }
  return 0;
}

/* ------------------------ Private hole cards helpers ----------------------- */
function sendPrivateHoleToSeat(t, seatIndex, cardsCodes){
  try{
    const s = t.seats[seatIndex]; if (!s || !s.socketId) return;
    const payload = {
      seatId: seatIndex,
      addr: s.addr,
      cards: Array.isArray(cardsCodes) ? cardsCodes.map(code => String(code)) : []
    };
    io.to(s.socketId).emit('poker:private', payload);
  }catch{}
}
function clearPrivateHoleForSeat(t, seatIndex){
  try{
    const s = t.seats[seatIndex]; if (!s || !s.socketId) return;
    io.to(s.socketId).emit('poker:private', { seatId: seatIndex, addr: s.addr, cards: [] });
  }catch{}
}
function sendAllPrivateHoles(t){
  try{
    const st=t.poker; if(!st) return;
    for (const a of st.actors){
      if (a && Array.isArray(a.cards) && a.cards.length===2){
        sendPrivateHoleToSeat(t, a.seatId, a.cards);
      }
    }
  }catch{}
}

/* -------------------------- Poker emit / timers ---------------------------- */
function emitPokerState(tableId, t){
  try{
    const st=t.poker; if (!st) return;
    const all = Array.isArray(st.actors)? st.actors : [];
    const humans = all.filter(a => isValidAddr(String(a?.addr||'')));
    const turnSeatId = (all[st.turnIndex]?.seatId);
    const humanTurnIdx = humans.findIndex(a => a.seatId === turnSeatId);
    const m = {
      stage: st.stage,
      community: Array.from(st.community||[]).map(code => String(code)),
      pot: Number(st.pot||0),
      toCall: Number(st.toCall||0),
      turnIndex: humanTurnIdx,
      dealerSeatId: st.dealerSeatId,
      actors: humans.map(a => ({
        seatId: a.seatId,
        addr: a.addr,
        contrib: Number(a.contrib||0),
        folded: !!a.folded,
        acted: !!a.acted,
        stack: Number.isFinite(a.stack) ? Number(a.stack) : undefined
      })),
      rng: { commit: st.rng?.commit }
    };
    io.to(tableId).emit('poker:state', m);
  }catch(e){ console.error('emitPokerState', e); }
}
function clearTurnTimer(t){ try{ if(t?.poker?.turnTimer){ clearTimeout(t.poker.turnTimer); t.poker.turnTimer=null; } }catch{} }
function scheduleTurnTimer(tableId,t){
  try{
    clearTurnTimer(t);
    const st=t.poker; if(!st) return;
    const A=st.actors, i=st.turnIndex; if(i<0||i>=A.length) return;
    const actor=A[i]; if(!actor || actor.folded || actor.allIn) return;

    const wait = HAND_TURN_MS;
    st.turnTimer = setTimeout(()=>{
      try{
        // Auto-action
        const need = Math.max(0, Number(st.toCall||0)-Number(actor.contrib||0));
        let act = 'check';
        if (need>0){ act = 'fold'; }
        applyAction(tableId,t,actor.addr,act,true,null);
      }catch(e){ console.error('timer auto-act', e); }
    }, wait);
  }catch{}
}

/* ------------------------------ Hand lifecycle ---------------------------- */
function nextAliveIndexFrom(A, start){
  let i = start, loop=0;
  while (loop < A.length){
    if (A[i] && !A[i].folded && !A[i].allIn) return i;
    i = (i+1) % A.length; loop++;
  }
  return -1;
}
function firstToActIndex(st){
  // Preflop: first alive left of BB. Postflop: first alive left of dealer.
  const A=st.actors;
  if (st.stage==='preflop'){
    return nextAliveIndexFrom(A, (st.bbIndex+1)%A.length);
  }
  return nextAliveIndexFrom(A, (st.dealerIndex+1)%A.length);
}

function isValidAddr(a){ return typeof a==='string' && /^0x[0-9a-fA-F]{40}$/.test(a); }
async function startPokerHand(tableId,t){
  try{
    // Humans only: valid EVM addresses
    const seated=t.seats
      .map((s,i)=> s && ({seatId:i,addr:String(s.addr||'').toLowerCase(), socketId:s.socketId||null}))
      .filter(x=> x && isValidAddr(x.addr));
    if (seated.length<2) return;

    // Determine dealer seat rotation
    let dealerSeatId = t.poker?.dealerSeatId;
    if (typeof dealerSeatId!=='number' || t.seats[dealerSeatId]==null){
      // pick the lowest occupied as new dealer
      dealerSeatId = seated.map(x=>x.seatId).sort((a,b)=>a-b)[0];
    } else {
      // advance to next occupied
      let cur = dealerSeatId, loop=0;
      do { cur=(cur+1)%t.seats.length; loop++; } while(!t.seats[cur] && loop<t.seats.length);
      dealerSeatId = cur;
    }
    const order = []; // actors ordered from dealer seat around clockwise
    for(let k=0;k<t.seats.length;k++){
      const si = (dealerSeatId + k) % t.seats.length;
      const s = t.seats[si];
      if (s && isValidAddr(String(s.addr||''))) {
        order.push({ seatId: si, addr: String(s.addr||'').toLowerCase(), socketId: s.socketId||null });
      }
    }

    // Prepare deck + fairness
    const seedBytes = crypto.randomBytes(32);
    const commit = crypto.createHash('sha256').update(seedBytes).digest('hex');
    const deck = buildDeck();
    shuffleDeterministic(deck, seedBytes);

    // Deal holes (round-robin 2 each)
    const actors = order.map(x=>({ seatId:x.seatId, addr:String(x.addr||'').toLowerCase(), socketId:x.socketId||null, cards:[], folded:false, contrib:0, acted:false, stack:0, allIn:false }));
    for(let r=0;r<2;r++){
      for (const a of actors){ a.cards.push(deck.pop()); }
    }

    // Stacks / chips (F2P only)
    if (t.category===CAT.OFFCHAIN_NL){
      actors.forEach(a=>{
        const s=t.seats[a.seatId];
        a.stack = Math.max(0, Number(s?.chips||0));
      });
    }

    // Blinds (small=1, big=2 in F2P chips)
    const dealerIndex = 0; // in 'actors' array
    const sbIndex = (dealerIndex+1) % actors.length;
    const bbIndex = (dealerIndex+2) % actors.length;
    let pot = 0, toCall = 0;

    function postBlind(i, amt){
      const a=actors[i];
      let pay=amt;
      if (t.category===CAT.OFFCHAIN_NL){
        pay=Math.min(amt, Math.max(0, Number(a.stack||0)));
        a.stack=Math.max(0, Number(a.stack||0)-pay);
        if (a.stack<=0 && pay>0) a.allIn=true;
      }
      a.contrib = (a.contrib||0) + pay;
      pot += pay;
      toCall = Math.max(toCall, a.contrib);
    }
    postBlind(sbIndex, 1);
    postBlind(bbIndex, 2);

    const community = [];
    const st = {
      stage:'preflop', deck, community, actors,
      dealerIndex, sbIndex, bbIndex, dealerSeatId,
      pot, toCall, turnIndex: firstToActIndex({stage:'preflop', actors, bbIndex, dealerIndex}),
      startedAt: nowMs(),
      rng:{ commit, seed: seedBytes.toString('hex') },
      turnTimer:null
    };
    t.poker = st;

    audit(tableId,'handStart',{ commit, seated:actors.map(a=>a.addr), dealerSeatId, sbIndex, bbIndex });

    // Onchain hook (fire and forget)
    if (t.category!==CAT.OFFCHAIN_NL){
      try { Promise.resolve(onBeginHand(tableId, t)).catch(e => console.error('onBeginHand failed', e)); } catch(e){ console.error('onBeginHand failed', e); }
    }

    emitPokerState(tableId,t);
    sendAllPrivateHoles(t);
    scheduleTurnTimer(tableId,t);
  }catch(e){ console.error('startPokerHand', e); }
}

function roundResetForNextStage(st){
  st.actors.forEach(a=>{ a.acted = !!a.allIn; a.contrib=0; });
  st.toCall = 0;
  st.turnIndex = firstToActIndex(st);
  return st.turnIndex;
}

function maybeAutoAdvance(tableId, t){
  try{
    const st=t?.poker; if(!st) return;
    if (st.turnIndex < 0){
      setTimeout(()=>{
        if (t.poker === st) advancePokerStage(tableId,t);
      }, 250);
    }
  }catch{}
}

async function advancePokerStage(tableId,t){
  try{
    const st=t.poker; if(!st) return;

    // Burn + deal community by stage
    if (st.stage==='preflop'){
      st.deck.pop(); // burn
      st.community.push(st.deck.pop(), st.deck.pop(), st.deck.pop()); // flop 3
      st.stage='flop';
      roundResetForNextStage(st);
      audit(tableId,'flop',{board:st.community.map(chogNamePng)});
      emitPokerState(tableId,t);
      scheduleTurnTimer(tableId,t);
      maybeAutoAdvance(tableId,t);
      return;
    }
    if (st.stage==='flop'){
      st.deck.pop(); // burn
      st.community.push(st.deck.pop()); // turn
      st.stage='turn';
      roundResetForNextStage(st);
      audit(tableId,'turn',{board:st.community.map(chogNamePng)});
      emitPokerState(tableId,t);
      scheduleTurnTimer(tableId,t);
      maybeAutoAdvance(tableId,t);
      return;
    }
    if (st.stage==='turn'){
      st.deck.pop(); // burn
      st.community.push(st.deck.pop()); // river
      st.stage='river';
      roundResetForNextStage(st);
      audit(tableId,'river',{board:st.community.map(chogNamePng)});
      emitPokerState(tableId,t);
      scheduleTurnTimer(tableId,t);
      maybeAutoAdvance(tableId,t);
      return;
    }
    if (st.stage==='river'){
      // Showdown
      const board = Array.from(st.community);
      const alive = st.actors.filter(a=>!a.folded);
      let bestScore = null, winners = [];

      for (const a of alive){
        const seven = [...a.cards, ...board];
        const score = eval7(seven);
        if (!bestScore || cmpRank(score, bestScore)>0){
          bestScore = score; winners = [a];
        } else if (cmpRank(score, bestScore)===0){
          winners.push(a);
        }
      }

      // Split pot across winners (equal split, remainder to first)
      const total = Number(st.pot||0) + st.actors.reduce((s,a)=>s+Number(a.contrib||0),0);
      let split = winners.length ? Math.floor(total / winners.length) : total;
      let remainder = winners.length ? (total % winners.length) : 0;

      if (t.category===CAT.OFFCHAIN_NL){
        winners.forEach((a,idx)=>{
          const add = split + (idx===0?remainder:0);
          const s = t.seats[a.seatId]; if(!s) return;
          s.chips = Number(s.chips||0) + add;
        });
      }

      const winnerPayouts = winners.map((a,idx)=>({
        addr: a.addr,
        seatId: a.seatId,
        amount: split + (idx===0?remainder:0)
      }));
      const exposures = alive.map(a=>({ addr:a.addr, seatId:a.seatId, cards: Array.from(a.cards) }));
      io.to(tableId).emit('poker:hand',{
        winners: winnerPayouts,
        community: board.map(code => String(code)),
        exposures,
        pot: total,
        rng:{commit:st.rng?.commit,seed:st.rng?.seed},
        table:tablePublic(t)
      });
      audit(tableId,'showdown',{ winners:winners.map(w=>w.addr), board:board.map(chogNamePng), pot:total, rngReveal:st.rng });

      // Onchain settle
      if (t.category!==CAT.OFFCHAIN_NL){
        try { Promise.resolve(onSettleHand(tableId,t,winnerPayouts,board)).catch(e => console.error('onSettleHand failed',e)); } catch(e){ console.error('onSettleHand failed',e); }
      }

      try{ st.actors.forEach(z=> clearPrivateHoleForSeat(t,z.seatId)); }catch{}
      clearTurnTimer(t); t.poker=null;
      emitUpdate(t);
      return;
    }
  }catch(e){ console.error('advancePokerStage', e); }
}

/* ----------------------------- Betting / actions --------------------------- */
function bettingRoundComplete(st){
  const target = Number(st.toCall||0);
  return st.actors
    .filter(a=>!a.folded && !a.allIn)
    .every(a=> a.acted && Number(a.contrib||0)===target);
}
function parseAmount(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}
function applyAction(tableId,t,addrLower,action,isAuto=false,amountRaw=null){
  try{
    if (!t?.poker) return;
    const st=t.poker; const i=st.turnIndex; const A=st.actors; if(i<0||i>=A.length) return;
    const a=A[i]; if(!a || a.addr!==addrLower) return;

    audit(tableId,'action',{addr:addrLower,action,auto:!!isAuto,stage:st.stage,toCall:st.toCall,contrib:a.contrib});

    if (action==='fold'){
      a.folded=true; a.acted=true;
      const alive=A.filter(x=>!x.folded);
      try{ clearPrivateHoleForSeat(t, a.seatId); }catch{}
      if (alive.length===1){
        // award pot to last alive
        const last=alive[0];
        const total = Number(st.pot||0) + st.actors.reduce((s,z)=>s+Number(z.contrib||0),0);
        if (t.category===CAT.OFFCHAIN_NL){
          const s=t.seats[last.seatId]; if (s) s.chips = Number(s.chips||0) + total;
        }
        const community = Array.from(st.community||[]).map(code => String(code));
        const winner = { addr:last.addr, seatId:last.seatId, amount: total };
        io.to(tableId).emit('poker:hand',{
          winners:[winner],
          community,
          exposures:[{addr:last.addr, seatId:last.seatId, cards:Array.from(last.cards)}],
          pot:total,
          rng:{commit:st.rng?.commit,seed:st.rng?.seed},
          table:tablePublic(t)
        });
        if (t.category!==CAT.OFFCHAIN_NL){
          try { Promise.resolve(onSettleHand(tableId,t,[winner],community)).catch(e => console.error('onSettleHand failed',e)); } catch(e){ console.error('onSettleHand failed',e); }
        }
        try{ st.actors.forEach(z=> clearPrivateHoleForSeat(t,z.seatId)); }catch{}
        t.poker=null;
        emitUpdate(t); return;
      }
    } else if (action==='check'){
      const need=Math.max(0, Number(st.toCall||0)-Number(a.contrib||0));
      if (need<=0){ a.acted=true; } else { return; } // illegal check â†’ ignore
    } else if (action==='call'){
      const need=Math.max(0, Number(st.toCall||0)-Number(a.contrib||0));
      let pay=need;
      if (t.category===CAT.OFFCHAIN_NL){
        pay=Math.min(need, Math.max(0, Number(a.stack||0)));
        a.stack=Math.max(0, Number(a.stack||0)-pay);
        if (a.stack<=0 && pay>0) a.allIn=true;
      }
      a.contrib=Number(a.contrib||0)+pay; st.pot=Number(st.pot||0)+pay; a.acted=true;
      st.toCall = Math.max(Number(st.toCall||0), Number(a.contrib||0));
    } else if (action==='bet' || action==='raise') {
      const parsed = parseAmount(amountRaw);
      if (parsed===null) return;
      const currentMax = Number(st.toCall||0);
      const already = Number(a.contrib||0);
      let target;
      if (action==='bet' && currentMax<=0){
        target = parsed;
      } else {
        // treat as raise-to amount
        target = parsed;
        if (target <= currentMax) target = currentMax + Math.max(parsed, 1);
      }
      if (!Number.isFinite(target) || target <= already) return;
      let add = target - already;
      if (t.category===CAT.OFFCHAIN_NL){
        const available = Math.max(0, Number(a.stack||0));
        if (available <= 0){ a.allIn=true; add=0; }
        if (add > available){ add = available; target = already + add; a.allIn=true; }
        a.stack = Math.max(0, available - add);
      }
      if (add <= 0){
        if (currentMax <= already){
          a.acted = true;
        }
      } else {
        a.contrib = already + add;
        st.pot = Number(st.pot||0) + add;
        st.toCall = Math.max(Number(st.toCall||0), Number(a.contrib||0));
        a.acted = true;
        if (t.category===CAT.OFFCHAIN_NL && a.stack<=0) a.allIn=true;
        // everyone else must respond unless folded or all-in
        st.actors.forEach((other, idx)=>{
          if (idx!==i && other){
            other.acted = !!other.allIn;
          }
        });
      }
    } else {
      // Unknown action
      a.acted=true;
    }

    // advance turn
    let next=(st.turnIndex+1)%A.length, loop=0;
    while(A[next] && (A[next].folded || A[next].allIn) && loop<A.length){ next=(next+1)%A.length; loop++; }
    if (loop>=A.length || (A[next] && (A[next].folded || A[next].allIn))){
      st.turnIndex = -1;
    } else {
      st.turnIndex=next;
    }

    if (bettingRoundComplete(st)){
      audit(tableId,'roundComplete',{stage:st.stage,pot:st.pot});
      advancePokerStage(tableId,t); return;
    }
    emitPokerState(tableId,t);
    scheduleTurnTimer(tableId,t);
    maybeAutoAdvance(tableId,t);
  }catch(e){ console.error('applyAction', e); }
}

/* ------------------------------ Connection wiring -------------------------- */
io.on('connection',(socket)=>{
  let currentTableId=null, addrLower=null, isAdmin=false;

  socket.on('identify',(m)=>{ try{ addrLower=String(m.addr||'').toLowerCase(); isAdmin=admins.has(addrLower);}catch{} socket.emit('rt:state',{paused,rakeBps,feesAccrued}); });

  socket.on('join_table',(m)=>{ try{
    const req=String(m.table||m.tableId||'');
    let wanted=req || (gameEnabled('FARO')?'faro-1':'poker-nl-1');
    if (wanted && !tables.has(wanted)) getTable(wanted);
    const t=getTable(wanted);

    // Purge any legacy bot seats if present
    if (isPoker(t) && t.category===CAT.OFFCHAIN_NL) {
      for (let i=0;i<t.seats.length;i++){ const s=t.seats[i]; if (s && typeof s.addr==='string' && s.addr.startsWith('bot:')) t.seats[i]=null; }
    }

    if (currentTableId) socket.leave(currentTableId);
    currentTableId=wanted; socket.join(wanted);

    if (isPoker(t) && t.poker && addrLower){
      const seatIdx=t.seats.findIndex(s=> s && s.addr===addrLower);
      if (seatIdx>=0){
        const actor=t.poker.actors.find(a=> a.seatId===seatIdx);
        if (actor?.cards){ try{ t.seats[seatIdx].socketId=socket.id; }catch{} sendPrivateHoleToSeat(t,seatIdx,actor.cards); }
      }
    }
    // remember socketId if seated
    if (isPoker(t) && addrLower){
      const si = t.seats.findIndex(s=> s && s.addr===addrLower);
      if (si>=0){ t.seats[si].socketId = socket.id; }
    }

    t.lastActive=nowMs();
    emitUpdate(t);
    io.to(wanted).emit('system', `${short(socket.id)} joined ${wanted}`);
    ensureLobbyPolicy();
    emitLobby();
  }catch{} });

  socket.on('lobby:get', ()=>{ try{ ensureLobbyPolicy(); emitLobby(); }catch{} });

  socket.on('chat',(m)=>{ try{
    if(!allow(socket.id,'chat')){ socket.emit('error',{message:'rate limit'}); return; }
    if(!currentTableId) return;
    io.to(currentTableId).emit('chat',{from:short(socket.id), text:String(m.msg||'').slice(0,400)});
  }catch{} });

  socket.on('seat',(m)=>{ try{
    if(!allow(socket.id,'seat')){ socket.emit('error',{message:'rate limit'}); return; }
    if(!currentTableId) return;
    const t=getTable(currentTableId);
    const before=seatCount(t);
    const idx=Number(m.index);

    if (idx===-1){
      const cur=t.seats.findIndex(s=> s && s.addr===addrLower);
      if (cur>=0){
        try{ clearPrivateHoleForSeat(t,cur); }catch{}
        const leaving=t.seats[cur];
        t.seats[cur]=null;
        if (t.kind==='FARO'){ try{ t.bets.delete(String(leaving.addr||'').toLowerCase()); }catch{} }
        audit(currentTableId,'seatLeave',{addr:addrLower,index:cur});
      }
    } else if (idx>=0 && idx<t.seats.length){
      if (!t.seats[idx]){
        if (!addrLower) { socket.emit('error', { message: 'identify first' }); return; }
        t.seats[idx]={ id:idx, addr:addrLower, balance:0, lastActive:nowMs(), socketId:socket.id };
        if (isPoker(t) && t.category===CAT.OFFCHAIN_NL){
          if(!Number.isFinite(t.seats[idx].chips)||t.seats[idx].chips<=0) t.seats[idx].chips=100;
          t.Enabled = false;
          t.UserToggled = false;
          const bi=findBotIndex(t); if (bi>=0) t.seats[bi]=null;
        }
        audit(currentTableId,'seat',{addr:addrLower,index:idx});
      }
    }
    const after=seatCount(t);
    if(!t.started && before===0 && after>0 && !paused){
      t.started=true;
      if(t.kind==='FARO') t.bets.clear();
      if(t.kind==='POKER') t.poker=null;
      t.lastActive=nowMs();
      io.to(currentTableId).emit('table:started', tablePublic(t));
    }
    t.lastActive=nowMs(); emitUpdate(t); maybeStartHand(currentTableId, t); ensureLobbyPolicy(); emitLobby();
  }catch{} });

  socket.on('disconnect',()=>{ try{
    for(const [,t] of tables.entries()){
      let changed=false;
      for(let i=0;i<t.seats.length;i++){
        const s=t.seats[i]; if(!s) continue;
        if((addrLower && s.addr===addrLower) || s.socketId===socket.id){
          if (t.kind==='FARO'){ try{ t.bets.delete(String(s.addr||'').toLowerCase()); }catch{} }
          try{ clearPrivateHoleForSeat(t,i); }catch{}
          t.seats[i]=null; changed=true;
        }
      }
      if (changed){ t.lastActive=nowMs(); emitUpdate(t); }
    }
    ensureLobbyPolicy(); emitLobby();
  }catch{} });


  socket.on('poker:act',(m)=>{ try{
    if(!allow(socket.id,'poker:act')){ socket.emit('error',{message:'rate limit'}); return; }
    if(!currentTableId) return;
    const t=getTable(currentTableId);
    if(!isPoker(t)||!t.poker) return;
    const st=t.poker; const idx=st.turnIndex; const A=st.actors;
    if(idx<0||idx>=A.length) return; const a=A[idx]; if(!a) return;
    if(a.addr!==addrLower) return;
    const action=String(m?.action||'').toLowerCase();
    applyAction(currentTableId,t,addrLower,action,false,m?.amount);
  }catch{} });

  // F2P only rebuy
  socket.on('sim:rebuy', ()=>{ try{
    if(!currentTableId) return; const t=getTable(currentTableId);
    if(!isPoker(t) || t.category!==CAT.OFFCHAIN_NL) return;
    const sIdx=t.seats.findIndex(s=> s && s.addr===addrLower); if(sIdx<0) return;
    const cur = Number(t.seats[sIdx].chips||0); if (cur > 0) return;
    t.seats[sIdx].chips = 100; t.lastActive=nowMs(); emitUpdate(t);
  }catch{} });


});

/* ------------------------- Background maintenance -------------------------- */
setInterval(()=>{ try{ ensureLobbyPolicy(); emitLobby(); }catch{} }, LOBBY_TICK_MS);
setInterval(()=>{ try{
  const now=nowMs();
  for (const [,t] of tables.entries()){
    let changed=false;
    for (let i=0;i<t.seats.length;i++){
      const s=t.seats[i]; if(!s) continue;
      const last=Number(s.lastActive||0);
      if (last && (now-last)>IDLE_EJECT_MS){
        if (t.kind==='FARO'){ try{ t.bets.delete(String(s.addr||'').toLowerCase()); }catch{} }
        try{ clearPrivateHoleForSeat(t,i); }catch{}
        t.seats[i]=null; changed=true;
      }
    }
    // humans-only: no additional reconciliation
    if (changed){ t.lastActive=nowMs(); emitUpdate(t); }
  }
}catch{} }, 7_000);

function saveState(){ try{
  const out=[];
  for (const t of tables.values()){
    out.push({ id:t.id, kind:t.kind, seats:t.seats.map(s=> s && { id:s.id, addr:s.addr, balance:s.balance||0, lastActive:s.lastActive||0, chips:Number(s.chips||0) }), started:!!t.started, lastActive:t.lastActive||0, category:t.category||null, limit:t.limit||null, stakes:t.stakes||null, simulated:!!t.simulated, Enabled:!!t.Enabled, emptySince:t.emptySince||null });
  }
  fs.writeFile(STATE_FN, JSON.stringify({savedAt:Date.now(),tables:out},null,2), ()=>{});
}catch{} }
setInterval(saveState, SAVE_INTERVAL_MS);

/* ------------------------------ Server listen ------------------------------ */
// Default to 3100 for unified backend; allow override via PORT env
const PORT = Number(process.env.PORT || 3100);
server.listen(PORT, ()=>{ console.log('RT server on',PORT,'| enabled games:', Array.from(enabledGames).join(',')); });

