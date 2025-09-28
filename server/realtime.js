// Realtime server: Faro + Poker (offchain/onchain), fairness, auditing, dev bot (opt-in), private hole cards
// ENV: PORT (default 3000) GAME_TYPES (comma-separated: FARO,POKER; default FARO,POKER) ADMIN_ADDR RT_RAKE_BPS MONAD_BUNDLER_RPC
// Socket.IO path is /socket.io/ (nginx proxies /poker.io/ → /socket.io/ upstream)

const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// [NEW] Onchain dealer integration
const { ethers } = require("ethers");
const { onBeginHand, onSettleHand } = require("./dealeronchain");

/* ----------------------------- HTTP + Socket.IO ---------------------------- */
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Tavern realtime OK');
});
const io = new Server(server, { path: '/socket.io/', cors: { origin: true, methods: ['GET','POST'] } });

/* --------------------------------- Config --------------------------------- */
const HAND_TURN_MS   = 25_000;
const SAVE_INTERVAL_MS = 10_000;
const LOBBY_TICK_MS  = 5_000;
const IDLE_EJECT_MS  = 90_000;
const EMPTY_PRUNE_MS = 60_000;
const POKER_SEATS    = 8;
const FARO_SEATS     = 6;

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

/* ------------------------------- Audit logging ----------------------------- */
function logFileName(){ const d=new Date(), y=d.getUTCFullYear(), m=String(d.getUTCMonth()+1).padStart(2,'0'), day=String(d.getUTCDate()).padStart(2,'0'); return path.join(LOGS_DIR,`audit-${y}${m}${day}.log`); }
function audit(tableId,type,payload){ fs.appendFile(logFileName(), JSON.stringify({ts:new Date().toISOString(),tableId,type,payload})+'\n', ()=>{} ); }

/* ------------------------------ Rate limiting ------------------------------ */
const RLIMIT={ chat:{limit:8,windowMs:5000}, seat:{limit:8,windowMs:5000}, ready:{limit:8,windowMs:5000}, 'poker:act':{limit:20,windowMs:10000} };
const buckets=new Map();
function allow(sid,ev){ const cfg=RLIMIT[ev]; if(!cfg) return true; const now=Date.now(); if(!buckets.has(sid)) buckets.set(sid,{}); const slot=buckets.get(sid); const keep=(slot[ev]||[]).filter(t=>now-t<cfg.windowMs); keep.push(now); slot[ev]=keep; return keep.length<=cfg.limit; }

/* ------------------------------- Table creates ----------------------------- */
function getTable(id){
  if (tables.has(id)) return tables.get(id);
  const low=String(id||'').toLowerCase();

  if (low.startsWith('poker-nl-')) {
    const t={ id, kind:'POKER', seats:Array.from({length:POKER_SEATS},()=>null), started:false, lastActive:nowMs(), category:'ONCHAIN_NL', limit:'NL', simulated:false, devBotEnabled:false, poker:null };
    tables.set(id,t); return t;
  }
  if (low.startsWith('poker-fl-')) {
    const t={ id, kind:'POKER', seats:Array.from({length:POKER_SEATS},()=>null), started:false, lastActive:nowMs(), category:'ONCHAIN_FL', limit:'FL', stakes:'3/6 MON', simulated:false, devBotEnabled:false, poker:null };
    tables.set(id,t); return t;
  }
  if (low.startsWith('poker-sim-')) {
    const t={ id, kind:'POKER', seats:Array.from({length:POKER_SEATS},()=>null), started:false, lastActive:nowMs(), category:'OFFCHAIN_NL', limit:'NL', simulated:true, devBotEnabled:false, poker:null };
    tables.set(id,t); return t;
  }

  const t={ id, kind:'FARO', seats:Array.from({length:FARO_SEATS},()=>null), started:false, bets:new Map(), ownerId:null, lastActive:nowMs() };
  tables.set(id,t); return t;
}
function nextIdFor(prefix){
  const nums=Array.from(tables.keys()).map(id=>new RegExp('^'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\d+)$').exec(id)).filter(Boolean).map(m=>Number(m[1]));
  return `${prefix}${nums.length?Math.max(...nums)+1:1}`;
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
        id:s.id, addr:s.addr, ready:!!s.ready, balance:Number(s.balance||0), lastActive:Number(s.lastActive||0),
        betTotal:(()=>{try{const bs=t.bets.get(String(s.addr||'').toLowerCase())||[]; return bs.reduce((a,b)=>a+Number(b?.amount||0),0);}catch{return 0;}})(),
        betCount:(()=>{try{const bs=t.bets.get(String(s.addr||'').toLowerCase())||[]; return bs.length;}catch{return 0;}})(),
        x:(publicProfiles.get(s.addr||'')||{}).x||null
      }),
      started:!!t.started, ownerId:t.ownerId, capacity:FARO_SEATS
    };
  }
  return {
    id:t.id,
    seats:t.seats.map(s=> s && ({
      id:s.id, addr:s.addr, ready:!!s.ready, balance:Number(s.balance||0), lastActive:Number(s.lastActive||0),
      x:(publicProfiles.get(s.addr||'')||{}).x||null, chips:Number(s.chips||0)
    })),
    started:!!t.started, devBotEnabled:!!t.devBotEnabled, simulated:!!t.simulated,
    limit:t.limit, stakes:t.stakes||'', capacity:POKER_SEATS
  };
}
function emitUpdate(t){ try{ io.to(t.id).emit('table:update', tablePublic(t)); }catch{} }
function emitLobby(){
  try{
    const list = Array.from(tables.values())
      .filter(t => (t.kind==='FARO'? gameEnabled('FARO') : gameEnabled('POKER')))
      .map(t => {
        const base={ id:t.id, seated:seatCount(t), capacity:(t.kind==='POKER'?POKER_SEATS:FARO_SEATS), started:!!t.started };
        if (t.kind==='POKER'){ base.simulated=!!t.simulated; base.limit=t.limit; if(t.limit==='FL') base.stakes=t.stakes||'3/6 MON'; }
        return base;
      });
    io.emit('lobby:list', list.sort((a,b)=> String(a.id).localeCompare(String(b.id))));
  }catch{}
}
/* ------------------------------ Dev bot policy ----------------------------- */
function humansIn(t){ return t.seats.filter(s=> s && typeof s.addr==='string' && !s.addr.startsWith('bot:')).length; }
function findBotIndex(t){ return t.seats.findIndex(s=> s && typeof s.addr==='string' && s.addr.startsWith('bot:')); }
function seatFirstEmpty(t, addr, socketId='bot'){
  const i=t.seats.findIndex(s=>!s);
  if (i>=0){
    t.seats[i]={ id:i, addr, ready:false, balance:0, lastActive:nowMs(), socketId };
    if (t.category===CAT.OFFCHAIN_NL && !Number.isFinite(t.seats[i].chips)) t.seats[i].chips=100;
    return i;
  }
  return -1;
}
function reconcileDevBot(t){
  if (!isPoker(t) || t.category!==CAT.OFFCHAIN_NL) return;
  const humans = humansIn(t);
  const botIdx = findBotIndex(t);

  if (humans >= 2) {
    if (botIdx >= 0) {
      t.seats[botIdx] = null;
      try { if (t.poker?.botTimer){ clearTimeout(t.poker.botTimer); t.poker.botTimer=null; } } catch {}
    }
    t.devBotEnabled = false;
    return;
  }

  if (humans === 1) {
    if (t.devBotEnabled && botIdx === -1) seatFirstEmpty(t, 'bot:dev', 'bot');
    if (!t.devBotEnabled && botIdx >= 0) {
      t.seats[botIdx] = null;
      try { if (t.poker?.botTimer){ clearTimeout(t.poker.botTimer); t.poker.botTimer=null; } } catch {}
    }
  }

  if (humans === 0 && botIdx >= 0) {
    t.seats[botIdx] = null;
    try { if (t.poker?.botTimer){ clearTimeout(t.poker.botTimer); t.poker.botTimer=null; } } catch {}
  }
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

/* --------------------------- Poker helpers / eval -------------------------- */
// (same as before: deck shuffling, evaluate7, etc... omitted here for brevity but KEEP them in your file)

/* ------------------------------ Hand lifecycle ---------------------------- */
async function startPokerHand(tableId,t){
  try{
    const seated=t.seats.map((s,i)=> s && ({seatId:i,addr:s.addr})).filter(Boolean);
    if (seated.length<2) return;

    // ...existing setup (dealer, blinds, etc)

    t.poker={ stage:'preflop', deck, community, actors, dealerIndex, sbIndex, bbIndex, dealerSeatId, pot, toCall, turnIndex, startedAt:nowMs(), rng:{ commit, seed } };
    audit(tableId,'handStart',{ commit, seated:actors.map(a=>a.addr), dealerSeatId, sbIndex, bbIndex });

    // [NEW] Onchain hook
    if (t.category!==CAT.OFFCHAIN_NL){
      try { await onBeginHand(tableId, t); } catch(e){ console.error("onBeginHand failed",e); }
    }

    emitPokerState(tableId,t); sendAllPrivateHoles(t); scheduleTurnTimer(tableId,t);
  }catch(e){ console.error(e); }
}

async function advancePokerStage(tableId,t){
  try{
    const st=t.poker; if(!st) return;
    // ...existing flop/turn/river progression

    else if (st.stage==='river'){
      // ...determine winners

      io.to(tableId).emit('poker:hand',{ winners, community:board, exposures, pot:st.pot||0, rng:{commit:st.rng?.commit,seed:st.rng?.seed}, table:tablePublic(t) });
      audit(tableId,'showdown',{ winners, board, pot:st.pot, rngReveal:st.rng });

      // [NEW] Onchain settle
      if (t.category!==CAT.OFFCHAIN_NL){
        try { await onSettleHand(tableId,t,winners,board); } catch(e){ console.error("onSettleHand failed",e); }
      }

      try{ A.forEach(a=> clearPrivateHoleForSeat(t,a.seatId)); }catch{}
      clearTurnTimer(t); t.poker=null; try{ t.seats.filter(Boolean).forEach(s=> s.ready=false); }catch{}
      emitUpdate(t); return;
    }

    // move to next stage...
  }catch(e){ console.error(e); }
}
/* ----------------------------- Actions (authoritative) --------------------- */
function bettingRoundComplete(st){ const target=Number(st.toCall||0); return st.actors.filter(a=>!a.folded).every(a=> a.acted && Number(a.contrib||0)===target); }
function applyAction(tableId,t,addrLower,action,isAuto=false){
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
        io.to(tableId).emit('poker:hand',{ winners:[{addr:alive[0].addr}], community:Array.from(st.community||[]), pot:st.pot||0, rng:{commit:st.rng?.commit,seed:st.rng?.seed}, table:tablePublic(t) });
        try{ st.actors.forEach(z=> clearPrivateHoleForSeat(t,z.seatId)); }catch{}
        t.poker=null; try{ t.seats.filter(Boolean).forEach(s=> s.ready=false); }catch{} emitUpdate(t); return;
      }
    } else if (action==='check'){
      const need=Math.max(0, Number(st.toCall||0)-Number(a.contrib||0));
      if (need<=0){ a.acted=true; }
      else {
        let pay=need;
        if (t.category===CAT.OFFCHAIN_NL){ pay=Math.min(need, Math.max(0, Number(a.stack||0))); a.stack=Math.max(0, Number(a.stack||0)-pay); }
        a.contrib=Number(a.contrib||0)+pay; st.pot=Number(st.pot||0)+pay; a.acted=true;
      }
    } else if (action==='call'){
      const need=Math.max(0, Number(st.toCall||0)-Number(a.contrib||0));
      let pay=need;
      if (t.category===CAT.OFFCHAIN_NL){ pay=Math.min(need, Math.max(0, Number(a.stack||0))); a.stack=Math.max(0, Number(a.stack||0)-pay); }
      a.contrib=Number(a.contrib||0)+pay; st.pot=Number(st.pot||0)+pay; a.acted=true;
    } else {
      a.acted=true; // no raises yet
    }

    let next=(st.turnIndex+1)%A.length, loop=0; while(A[next]&&A[next].folded && loop<A.length){ next=(next+1)%A.length; loop++; }
    st.turnIndex=next;

    if (bettingRoundComplete(st)){ audit(tableId,'roundComplete',{stage:st.stage,pot:st.pot}); advancePokerStage(tableId,t); return; }
    emitPokerState(tableId,t); scheduleTurnTimer(tableId,t);
  }catch(e){ console.error(e); }
}

/* ------------------------------ Connection wiring -------------------------- */
io.on('connection',(socket)=>{
  let currentTableId=null, addrLower=null, isAdmin=false;

  socket.on('identify',(m)=>{ try{ addrLower=String(m.addr||'').toLowerCase(); isAdmin=admins.has(addrLower);}catch{} socket.emit('rt:state',{paused,rakeBps,feesAccrued}); });

  socket.on('join_table',(m)=>{ try{ const req=String(m.table||m.tableId||''); let wanted=req || (gameEnabled('FARO')?'faro-1':'poker-nl-1'); if (wanted && !tables.has(wanted)) getTable(wanted); const t=getTable(wanted);
    if (currentTableId) socket.leave(currentTableId); currentTableId=wanted; socket.join(wanted);
    if (isPoker(t) && t.poker && addrLower){ const seatIdx=t.seats.findIndex(s=> s && s.addr===addrLower); if (seatIdx>=0){ const actor=t.poker.actors.find(a=> a.seatId===seatIdx); if (actor?.cards){ try{ t.seats[seatIdx].socketId=socket.id; }catch{} sendPrivateHoleToSeat(t,seatIdx,actor.cards); } } }
    reconcileDevBot(t); t.lastActive=nowMs(); emitUpdate(t); io.to(wanted).emit('system', `${short(socket.id)} joined ${wanted}`); ensureLobbyPolicy(); emitLobby(); }catch{} });

  socket.on('lobby:get', ()=>{ try{ ensureLobbyPolicy(); emitLobby(); }catch{} });
  socket.on('chat',(m)=>{ try{ if(!allow(socket.id,'chat')){ socket.emit('error',{message:'rate limit'}); return; } if(!currentTableId) return; io.to(currentTableId).emit('chat',{from:short(socket.id), text:String(m.msg||'').slice(0,400)});}catch{} });

  socket.on('seat',(m)=>{ try{ if(!allow(socket.id,'seat')){ socket.emit('error',{message:'rate limit'}); return; } if(!currentTableId) return; const t=getTable(currentTableId); const before=seatCount(t); const idx=Number(m.index);
    if (idx===-1){ const cur=t.seats.findIndex(s=> s && s.addr===addrLower); if (cur>=0){ try{ clearPrivateHoleForSeat(t,cur); }catch{} const leaving=t.seats[cur]; t.seats[cur]=null; if (t.kind==='FARO'){ try{ t.bets.delete(String(leaving.addr||'').toLowerCase()); }catch{} } audit(currentTableId,'seatLeave',{addr:addrLower,index:cur}); } }
    else if (idx>=0 && idx<t.seats.length){ if (!t.seats[idx]){ t.seats[idx]={ id:idx, addr:addrLower, ready:false, balance:0, lastActive:nowMs(), socketId:socket.id }; if (isPoker(t) && t.category===CAT.OFFCHAIN_NL){ if(!Number.isFinite(t.seats[idx].chips)||t.seats[idx].chips<=0) t.seats[idx].chips=100; } audit(currentTableId,'seat',{addr:addrLower,index:idx}); } }
    if (isPoker(t)) reconcileDevBot(t);
    const after=seatCount(t);
    if(!t.started && before===0 && after>0 && !paused){ t.started=true; if(t.kind==='FARO') t.bets.clear(); if(t.kind==='POKER') t.poker=null; t.lastActive=nowMs(); io.to(currentTableId).emit('table:started', tablePublic(t)); }
    t.lastActive=nowMs(); emitUpdate(t); ensureLobbyPolicy(); emitLobby(); }catch{} });

  socket.on('disconnect',()=>{ try{ for(const [,t] of tables.entries()){ let changed=false; for(let i=0;i<t.seats.length;i++){ const s=t.seats[i]; if(!s) continue; if((addrLower && s.addr===addrLower) || s.socketId===socket.id){ if (t.kind==='FARO'){ try{ t.bets.delete(String(s.addr||'').toLowerCase()); }catch{} } try{ clearPrivateHoleForSeat(t,i); }catch{} t.seats[i]=null; changed=true; } } if (isPoker(t) && changed) reconcileDevBot(t); if (changed){ t.lastActive=nowMs(); emitUpdate(t); } } ensureLobbyPolicy(); emitLobby(); }catch{} });

  socket.on('ready',(m)=>{ try{ if(!allow(socket.id,'ready')){ socket.emit('error',{message:'rate limit'}); return; } if(!currentTableId) return; const t=getTable(currentTableId); const s=t.seats.find(x=> x && x.addr===addrLower); if (s){ s.ready=!!m.ready; s.lastActive=nowMs(); s.socketId=socket.id; } t.lastActive=nowMs(); emitUpdate(t); if (paused) return;
    const active=t.seats.filter(Boolean); const allReady=active.length && active.every(x=>!!x.ready);
    if (t.kind==='FARO'){ if (allReady && t.bets.size>0){ /* faro resolution logic */ } return; }
    if (allReady && active.length>=2 && !t.poker) startPokerHand(currentTableId,t);
  }catch{} });

  socket.on('poker:act',(m)=>{ try{ if(!allow(socket.id,'poker:act')){ socket.emit('error',{message:'rate limit'}); return; } if(!currentTableId) return; const t=getTable(currentTableId); if(!isPoker(t)||!t.poker) return; const st=t.poker; const idx=st.turnIndex; const A=st.actors; if(idx<0||idx>=A.length) return; const a=A[idx]; if(!a) return; if(a.addr!==addrLower) return; const action=String(m?.action||'').toLowerCase(); applyAction(currentTableId,t,addrLower,action,false); }catch{} });

  socket.on('sim:rebuy', ()=>{ try{ if(!currentTableId) return; const t=getTable(currentTableId); if(!isPoker(t) || t.category!==CAT.OFFCHAIN_NL) return; const sIdx=t.seats.findIndex(s=> s && s.addr===addrLower); if(sIdx<0) return; const cur = Number(t.seats[sIdx].chips||0); if (cur > 0) return; t.seats[sIdx].chips = 100; t.lastActive=nowMs(); emitUpdate(t); }catch{} });
});

/* ------------------------- Background maintenance -------------------------- */
setInterval(()=>{ try{ ensureLobbyPolicy(); emitLobby(); }catch{} }, LOBBY_TICK_MS);
setInterval(()=>{ try{ const now=nowMs(); for (const [,t] of tables.entries()){ let changed=false; for (let i=0;i<t.seats.length;i++){ const s=t.seats[i]; if(!s) continue; const last=Number(s.lastActive||0); if (!s.ready && last && (now-last)>IDLE_EJECT_MS){ if (t.kind==='FARO'){ try{ t.bets.delete(String(s.addr||'').toLowerCase()); }catch{} } try{ clearPrivateHoleForSeat(t,i); }catch{} t.seats[i]=null; changed=true; } } if (isPoker(t) && changed) reconcileDevBot(t); if (changed){ t.lastActive=nowMs(); emitUpdate(t); } } }catch{} }, 7_000);

function saveState(){ try{ const out=[]; for (const t of tables.values()){ out.push({ id:t.id, kind:t.kind, seats:t.seats.map(s=> s && { id:s.id, addr:s.addr, ready:!!s.ready, balance:s.balance||0, lastActive:s.lastActive||0, chips:Number(s.chips||0) }), started:!!t.started, lastActive:t.lastActive||0, category:t.category||null, limit:t.limit||null, stakes:t.stakes||null, simulated:!!t.simulated, devBotEnabled:!!t.devBotEnabled, emptySince:t.emptySince||null }); } fs.writeFile(STATE_FN, JSON.stringify({savedAt:Date.now(),tables:out},null,2), ()=>{}); }catch{} }
setInterval(saveState, SAVE_INTERVAL_MS);

/* ------------------------------ Server listen ------------------------------ */
const PORT=process.env.PORT||3000;
server.listen(PORT, ()=>{ console.log('RT server on',PORT,'| enabled games:', Array.from(enabledGames).join(',')); });
