const statusEl = document.getElementById('status');
const seatEls = Array.from(document.querySelectorAll('.seat'));
const connectBtn = document.getElementById('connect-wallet');
const devBotBtn = document.getElementById('toggle-dev-bot');
const disconnectBtn = document.getElementById('wi-disconnect') || document.getElementById('disconnect-wallet');
const walletAddrSpan = document.getElementById('wi-address');
let devBotOn = false;

// Optional card spritesheet support (auto-detect)
const __sprite = { ready:true, url:'/assets/images/cards/cards-sprite.png', iw: 2016, ih: 832, cols:14, rows:4, tw:144, th:208 };
function cardCodeToIndex(code){
  try {
    const r = String(code||'').toUpperCase();
    const rank = r[0];
    const suit = r[1];
    const ranks = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
    const suits = ['S','H','D','C'];
    const ci = ranks.indexOf(rank);
    const ri = suits.indexOf(suit);
    if (ci < 0 || ri < 0) return { c:0, r:0 };
    return { c: ci, r: ri };
  } catch { return { c:0, r:0 }; }
}
function tryLoadCardSprite(){ /* sprite baked in */ }
          break;
        }
      } catch {}
    }
  })();
}
let socket; let myAddr = null; let currentTableId = null; let lastTable = null; let myHole = [];
let lastState = null; let exposures = {}; let winnersNow = {};

// Disable Dev Bot toggle until wallet connects
try { if (devBotBtn) { devBotBtn.disabled = true; devBotBtn.title = 'Connect wallet to use Dev Bot'; devBotBtn.textContent = 'Dev Bot'; } } catch(e){}

let actionBar = null; let communityEl = null; let amountInput = null; let infoText = null; let communityStrip = null; let burnStrip = null;
let centerEl = null; let centerTimer = null; let holdShowdown = false; let lastHandBox = null; let lastHandContent = null;



// Position seats in a ring immediately so layout looks correct before data arrives
function getRingRadii() {
  try {
    const canvas = document.querySelector('.table-canvas');
    const cs = getComputedStyle(canvas || document.documentElement);
    const rx = parseFloat(cs.getPropertyValue('--ring-rx')) || 52;
    const ry = parseFloat(cs.getPropertyValue('--ring-ry')) || 48;
    return { rx, ry };
  } catch { return { rx: 52, ry: 48 }; }
}
function positionSeatsRing(){
  try {
    const n = seatEls.length || 8;
    const rr = getRingRadii();
    const rx = rr.rx, ry = rr.ry, startDeg = -90;
    seatEls.forEach(function(el, i){
      const ang = (startDeg + (360 / n) * i) * Math.PI / 180;
      const left = 50 + rx * Math.cos(ang);
      const top = 50 + ry * Math.sin(ang);
      el.style.left = left.toFixed(2) + '%';
      el.style.top = top.toFixed(2) + '%';
      el.style.transform = 'translate(-50%,-50%)';
    });
  } catch {}
}
positionSeatsRing();

// Build shared UI elements (action bar, community/burn strips) once
function ensureActionBar(){
  try {
    if (actionBar) return actionBar;
    const canvas = document.querySelector('.table-canvas');
    if (!canvas) return null;
    actionBar = document.createElement('div');
    actionBar.style.cssText = [
      'position:absolute','left:50%','bottom:26%','transform:translateX(-50%)','display:none','gap:10px',
      'background: var(--panel-bg-soft)','border:1px solid rgba(255,255,255,0.12)','border-radius:12px',
      'padding:12px 14px','box-shadow:0 24px 60px rgba(0,0,0,0.45)','align-items:center','z-index:6',
      'color:#f4e6d3'
    ].join(';');
    infoText = document.createElement('div'); infoText.style.color='#f4e6d3'; infoText.style.fontSize='12px'; actionBar.appendChild(infoText);
    const btns = document.createElement('div'); btns.style.display='flex'; btns.style.gap='8px'; btns.className='action-btns'; actionBar.appendChild(btns);
    amountInput = document.createElement('input'); amountInput.type='number'; amountInput.min='1'; amountInput.step='1'; amountInput.value='2'; amountInput.style.width='70px'; amountInput.placeholder='amt'; amountInput.title='Bet/Raise amount';
    try {
      amountInput.style.background = 'rgba(0,0,0,0.35)';
      amountInput.style.border = '1px solid rgba(255,255,255,0.16)';
      amountInput.style.color = '#f4e6d3';
      amountInput.style.borderRadius = '10px';
      amountInput.style.padding = '4px 8px';
      amountInput.style.boxShadow = 'inset 0 1px 1px rgba(255,255,255,0.12)';
    } catch {}
    actionBar.appendChild(amountInput);
    canvas.appendChild(actionBar);

    communityStrip = document.createElement('div');
    communityStrip.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-105%); display:flex; gap:8px; z-index:4;';
    canvas.appendChild(communityStrip);

    burnStrip = document.createElement('div');
    burnStrip.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(calc(-50% - 240px), -58%); display:flex; gap:0; pointer-events:none; z-index:2; align-items:center;';
    canvas.appendChild(burnStrip);
    try {
      centerEl = document.getElementById('poker-center') || null;
      if (!centerEl) {
        // Fallback: create the banner if markup is missing
        const div = document.createElement('div');
        div.id = 'poker-center';
        div.className = 'center-banner';
        div.style.display = 'none';
        canvas.appendChild(div);
        centerEl = div;
      }
    } catch(_) { centerEl = null; }
    try { lastHandBox = document.getElementById('last-hand') || null; lastHandContent = document.getElementById('lh-content') || null; } catch(_) { lastHandBox = null; lastHandContent = null; }
    return actionBar;
  } catch(e){ return null; }
}

// Build a compact Last Hand receipt in the bottom-right panel
function renderLastHandPanel(payload){
  try {
    if (!lastHandBox || !lastHandContent) return;
    const winners = Array.isArray(payload && payload.winners) ? payload.winners : [];
    const exposuresArr = Array.isArray(payload && payload.exposures) ? payload.exposures : [];
    const comm = Array.isArray(payload && payload.community) ? payload.community : [];
    let html = '';
    if (comm.length) html += '<div><b>Community:</b> ' + comm.join(' ') + '</div>';
    if (exposuresArr.length){
      html += '<div style="margin-top:6px;"><b>Players:</b></div>';
      exposuresArr.forEach(function(e){ const a = String((e&&e.addr)||''); const cards = Array.isArray(e&&e.cards)? e.cards:[]; html += '<div>' + (a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||'')) + ': ' + cards.join(' ') + '</div>'; });
    }
    if (winners.length){
      html += '<div style="margin-top:6px;"><b>Winners:</b></div>';
      winners.forEach(function(w){ const a=String((w&&w.addr)||''); const amt=Number((w&&w.amount)||0); html += '<div>' + (a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||'')) + ' +' + amt + '</div>'; });
    }
    lastHandContent.innerHTML = html || '<div>No data</div>';
    lastHandBox.style.display = html ? '' : 'none';
  } catch {}
}

function short(a){ return (a && a.length>10) ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }
function setStatus(t){ if (statusEl) statusEl.textContent = t; }
function assetTag(){ try { return String(window.__ASSET_TAG||''); } catch(e){ return ''; } }
function cardSrc(code){
  try {
    const raw = String(code||'').trim();
    // Accept formats: 'As', 'TH', '10d', '2c', case-insensitive
    const m = raw.match(/^([2-9]|10|[TJQKA])([shdc])$/i);
    if (m) {
      const r = m[1].toUpperCase();
      const s = m[2].toLowerCase();
      const rankMap = {
        'A':'ace','K':'king','Q':'queen','J':'jack','T':'ten',
        '10':'ten','9':'nine','8':'eight','7':'seven','6':'six',
        '5':'five','4':'four','3':'three','2':'two'
      };
      const suitMap = { 's':'spades','h':'hearts','d':'diamonds','c':'clubs' };
      const rank = rankMap[r] || rankMap[String(r)];
      const suit = suitMap[s];
      if (rank && suit) {
        const v = assetTag(); const q = v ? ('?v=' + encodeURIComponent(v)) : '';
        return '../../assets/images/chog_cards/chog-' + rank + '-of-' + suit + '.png' + q;
      }
    }
  } catch(e){}
  const v = assetTag(); const q = v ? ('?v=' + encodeURIComponent(v)) : '';
  return '../../assets/images/chog_cards/chog-ace-of-spades.png' + q;
}
function cardBackSrc(){ const v = assetTag(); const q = v ? ('?v=' + encodeURIComponent(v)) : ''; return '../../assets/images/chog_cards/dak-and-chog-cardback.png' + q; }

// Helpers for winner announcements and Last Hand debug
function codeToRankSuit(code){
  try {
    const m = String(code||'').trim().match(/^([2-9]|10|[TJQKA])([shdc])$/i);
    if (!m) return null;
    const r = m[1].toUpperCase(); const s = m[2].toLowerCase();
    const rmap = { 'A':14,'K':13,'Q':12,'J':11,'T':10,'10':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2 };
    const smap = { 's':'s','h':'h','d':'d','c':'c' };
    return { r: rmap[r], s: smap[s], raw: r+(s) };
  } catch { return null; }
}
function bestHandName(cards7){
  if (!Array.isArray(cards7) || cards7.length < 5) return 'Unknown';
  const cs = cards7.map(codeToRankSuit).filter(Boolean);
  if (cs.length < 5) return 'Unknown';
  const bySuit = { s:[], h:[], d:[], c:[] };
  const counts = {}; cs.forEach(c=>{ bySuit[c.s].push(c.r); counts[c.r]=(counts[c.r]||0)+1; });
  const uniqRanks = Array.from(new Set(cs.map(c=>c.r))).sort((a,b)=>b-a);
  function hasStraight(ranks){
    const u = Array.from(new Set(ranks)).sort((a,b)=>b-a);
    const wheel = [5,4,3,2,14];
    const hasWheel = wheel.every(v=>u.includes(v));
    if (hasWheel) return true;
    let run=1; for (let i=1;i<u.length;i++){ if (u[i]===u[i-1]-1) { run++; if (run>=5) return true; } else { run=1; } }
    return false;
  }
  for (const k of Object.keys(bySuit)){
    if (bySuit[k].length>=5){ if (hasStraight(bySuit[k])) return 'Straight Flush'; }
  }
  if (Object.values(counts).some(v=>v===4)) return 'Four of a Kind';
  const trips = Object.values(counts).filter(v=>v===3).length;
  const pairs = Object.values(counts).filter(v=>v===2).length;
  if (trips>=1 && (pairs>=1 || trips>=2)) return 'Full House';
  if (Object.values(bySuit).some(arr=>arr.length>=5)) return 'Flush';
  if (hasStraight(uniqRanks)) return 'Straight';
  if (trips>=1) return 'Three of a Kind';
  if (pairs>=2) return 'Two Pair';
  if (pairs>=1) return 'One Pair';
  return 'High Card';
}
function shortAddr(a){ return (a && a.length>10) ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }

// Winner-split sanity per site rule: split ONLY if all winners have identical hole card ranks
function holeRanksKey(cards2){
  try {
    const a = Array.isArray(cards2) ? cards2 : [];
    if (a.length !== 2) return null;
    const r = a.map(c => (codeToRankSuit(c)||{}).r).filter(Boolean).sort((x,y)=>x-y);
    if (r.length !== 2) return null;
    return r.join('-');
  } catch { return null; }
}
function makeCardImg(code, opts){
  opts = opts||{};
  const hole=!!opts.hole, flip = opts.flip!==false, win = !!opts.win;
  const el = document.createElement('div');
  el.setAttribute('role','img');
  el.className='card' + (hole?' card--hole':'') + (flip?' card--flip':'') + (win?' card--win':'');
  el.style.backgroundImage = 'url(' + __sprite.url + ')';
  el.style.backgroundRepeat='no-repeat';
  el.style.backgroundSize = __sprite.iw + 'px ' + __sprite.ih + 'px';
  const r = String(code||'').toUpperCase();
  let col = 13; let row = 0; // BACK default
  if (r !== 'BACK') {
    const ranks = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
    const suits = ['S','H','D','C'];
    const c = ranks.indexOf(r[0]);
    const s = suits.indexOf(r[1]);
    if (c>=0 && s>=0) { col = c; row = s; }
  }
  const x = Math.round(col * __sprite.tw);
  const y = Math.round(row * __sprite.th);
  el.style.backgroundPosition = (-x) + 'px ' + (-y) + 'px';
  if (flip) requestAnimationFrame(function(){ el.classList.add('card--show'); });
  return el;
}
}\n        // Image object to warm the cache regardless of head parsing timing
        const im = new Image();
        try { im.decoding = 'async'; } catch {}
        im.src = href;
      } catch {}
    }
  } catch {}
}

function renderTable(t){
  if (!t || t.id !== currentTableId) return;
  lastTable = t;
  try {
    const humans = Array.isArray(t.seats) ? t.seats.filter(s => s && s.addr && !String(s.addr).startsWith('bot:')).length : 0;
    const imSeated = Array.isArray(t.seats) && myAddr && t.seats.some(s => s && s.addr && String(s.addr).toLowerCase()===String(myAddr).toLowerCase());
    if (devBotBtn) devBotBtn.style.display = (imSeated && humans === 1) ? '' : 'none';
  } catch {}
  // Ensure even seat spacing around table edge
  try {
    const n = seatEls.length || 8;
    const rr = getRingRadii();
    const rx = rr.rx; // horizontal radius in % (from center)
    const ry = rr.ry; // vertical radius in % (from center)
    const startDeg = -90; // start at top center
    seatEls.forEach(function(el, i){
      const ang = (startDeg + (360 / n) * i) * Math.PI / 180;
      const left = 50 + rx * Math.cos(ang);
      const top = 50 + ry * Math.sin(ang);
      el.style.left = left.toFixed(2) + '%';
      el.style.top = top.toFixed(2) + '%';
      el.style.transform = 'translate(-50%,-50%)';
    });
  } catch(e){}
  seatEls.forEach(function(el){
    const idx = Number(el.dataset.index);
    const s = Array.isArray(t.seats) ? t.seats[idx] : null;
    el.innerHTML = '';
    const label = document.createElement('div'); label.className='addr'; label.textContent = 'Seat ' + idx; el.appendChild(label);
    const info = document.createElement('div'); info.className='addr';
    if (s) {
      info.textContent = short(s.addr||s.id) + (typeof s.chips==='number' ? ' ï¿½ ' + s.chips + 'c' : ''); el.appendChild(info);
      const addrLower = String(s.addr||'').toLowerCase();
      if (myAddr && addrLower===String(myAddr).toLowerCase()){
        const btns = document.createElement('div'); btns.className='btns';
        const leave = document.createElement('button'); leave.textContent='Leave'; leave.onclick=function(){ socket.emit('seat',{ index:-1 }); };
          const ready = document.createElement('button'); ready.textContent = s.ready? 'Unready':'Ready'; ready.onclick=function(){
            try { holdShowdown = false; } catch(_){ }
            try { if (centerEl) centerEl.style.display = 'none'; } catch(_){ }
            try { if (communityStrip) { communityStrip.classList.remove('showdown'); communityStrip.innerHTML=''; } } catch(_){ }
            try { if (actionBar) actionBar.style.display = 'none'; } catch(_){ }
            socket.emit('ready',{ ready: !s.ready });
          };
        btns.appendChild(leave); btns.appendChild(ready); el.appendChild(btns);
        if (Array.isArray(myHole) && myHole.length===2) {
          const row=document.createElement('div');
          row.style.cssText='display:flex; gap:6px; margin-top:10px;';
          try {
            const me = String(myAddr||'').toLowerCase();
            const winInfo = winnersNow && winnersNow[me];
            const usedHole = (winInfo && Array.isArray(winInfo.usedHole)) ? winInfo.usedHole : null;
            const isWin = !!winInfo;
            myHole.forEach(function(code, i){
              const win = isWin && (!usedHole || usedHole.indexOf(i) >= 0);
              row.appendChild(makeCardImg(code,{hole:true,flip:true,win}));
            });
          } catch(_) {
            myHole.forEach(function(code){ row.appendChild(makeCardImg(code,{hole:true,flip:true})); });
          }
          el.appendChild(row);
        }
      } else {
        try {
          const actors = Array.isArray(lastState && lastState.actors) ? lastState.actors : [];
          const actor = actors.find(function(a){ return a && a.addr && String(a.addr).toLowerCase()===addrLower; });
          if (actor) {
            const row=document.createElement('div'); row.style.cssText='display:flex; gap:6px; margin-top:10px;';
            const exp = exposures[addrLower];
            if (Array.isArray(exp) && exp.length===2) {
              const winInfo = winnersNow && winnersNow[addrLower];
              const isWin = !!winInfo;
              const usedHole = (winInfo && Array.isArray(winInfo.usedHole)) ? winInfo.usedHole : null;
              exp.forEach(function(code, i){ const img = makeCardImg(code,{hole:true,flip:true,win: isWin && (!usedHole || usedHole.indexOf(i)>=0)}); row.appendChild(img); });
              el.appendChild(row);
              if (isWin) { const badge=document.createElement('div'); badge.className='win-badge'; const amt=Number((winInfo && winInfo.amount) || 0); badge.textContent = 'Winner ' + (amt>0?'+':'') + String(amt); el.appendChild(badge); }
            }
            else if (!actor.folded) { for (var k=0;k<2;k++){ row.appendChild(makeCardImg('BACK',{hole:true,flip:true})); } el.appendChild(row); }
          }
        } catch(e){}
      }
    } else {
      info.textContent = 'Empty'; el.appendChild(info);
      const btns = document.createElement('div'); btns.className='btns';
      const sit = document.createElement('button'); sit.textContent='Sit'; if (!myAddr) { sit.disabled=true; sit.title='Connect wallet to sit'; }
      sit.onclick = function(){ if (!myAddr) return; socket.emit('seat',{ index: idx }); };
      btns.appendChild(sit); el.appendChild(btns);
    }
  });
}

function parseTableId(){ try { const u=new URL(window.location.href); return u.searchParams.get('table') || 'poker-1'; } catch(e) { return 'poker-1'; } }

async function connect(){
  currentTableId = parseTableId();
  try { socket = io(window.location.origin, { path: '/poker.io/', transports:['polling','websocket'], upgrade:true, reconnection:true, reconnectionAttempts:10, reconnectionDelay:800, forceNew:true }); try { window.socket = socket; } catch(e){} }
  catch (e) { setStatus('Socket.IO not available'); return; }

  socket.on('connect', function(){
    try { window.socket = socket; } catch(e){}
    try {
      if (myAddr) {
        setStatus('' + short(myAddr)); try { if (walletAddrSpan) walletAddrSpan.textContent = short(myAddr); } catch{}
        try { socket.emit('identify', { addr: myAddr }); } catch(e){}
        try { socket.emit('join_table', { table: currentTableId }); try { socket.emit('table:get', { table: currentTableId }); } catch(e){} try { socket.emit('lobby:get'); } catch(e){} setTimeout(function(){ try { socket.emit('join_table', { table: currentTableId }); try { socket.emit('table:get', { table: currentTableId }); } catch(e){} } catch(e){} }, 80); } catch(e){}
      } else {
        setStatus('Connect wallet to join table');
      }
    } catch(e){}
  });

  // Optional debug: attach listeners when URL includes ?pdebug=1
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get('pdebug') === '1') {
      window.__poker = window.__poker || { states: [], tables: [], cards: [] };
      socket.off('poker:state'); socket.off('table:update'); socket.off('poker:cards');
      socket.on('poker:state', function(st){ try { window.__poker.states.push(st); } catch(e){} console.log('[poker:state]', st); });
      socket.on('table:update', function(t){ try { window.__poker.tables.push(t); } catch(e){} console.log('[table:update]', t); });
      socket.on('poker:cards', function(m){ try { window.__poker.cards.push(m); } catch(e){} console.log('[poker:cards]', m); });
      console.log('[pdebug] listeners attached');
    }
  } catch(e){}
  socket.on('connect_error', function(){ setStatus('Lobby unavailable. Retrying...'); });
  socket.on('reconnect_error', function(){ setStatus('Reconnecting...'); });
  socket.on('disconnect', function(){ setStatus('Disconnected'); });
  socket.on('table:update', function(t){ try {
    if (devBotBtn) {
      const enabled = !!(t && t.simulated);
      devBotOn = enabled;
      devBotBtn.classList.toggle('active', devBotOn);
      devBotBtn.textContent = devBotOn ? 'Dev Bot: ON' : 'Dev Bot';
    }
  } catch(e){} renderTable(t); });
  socket.on('system', function(){ /* no banner */ });
  socket.on('rt:state', function(){
    try {
      // Only join after we know our wallet (prevents stale socketId on seats)
      if (currentTableId && myAddr) {
        socket.emit('join_table', { table: currentTableId });
        try { socket.emit('table:get', { table: currentTableId }); } catch(e){}
        try { socket.emit('poker:get'); } catch(e){}
      }
    } catch(e){}
  });
  // After joining, request current poker state as well
  try { socket.emit('poker:get'); } catch(e){}
  socket.on('poker:cards', function(m){ try { const tid = String((m && m.tableId) || ''); if (tid && tid !== currentTableId) return; const hole = Array.isArray(m && m.hole) ? m.hole : []; if (hole.length === 2) { myHole = hole; if (lastTable) renderTable(lastTable); } } catch(e){} });
  socket.on('poker:mode', function(m){ try { const sim = !!(m && m.simulated); if (devBotBtn) { devBotOn = sim; devBotBtn.classList.toggle('active', devBotOn); devBotBtn.textContent = devBotOn ? 'Dev Bot: ON' : 'Dev Bot'; } } catch(e){} });
  socket.on('poker:state', function(st){ try {
    lastState = st; try { if (String((st && st.stage) || '') === 'preflop') { exposures = {}; winnersNow = {}; } } catch(e){}
    ensureActionBar();
    const stage = String((st && st.stage) || '');
    // If a new hand is starting, always clear any showdown hold and visuals
    if (stage === 'preflop') {
      try {
        holdShowdown = false;
        const tid = (function(){ try { const u=new URL(window.location.href); return u.searchParams.get('table')||'poker-1'; } catch { return 'poker-1'; } })();
        localStorage.removeItem('poker.hold.'+tid);
        localStorage.removeItem('poker.lastHand.'+tid);
      } catch {}
      try { if (centerEl) centerEl.style.display = 'none'; } catch(_){ }
      try { if (communityStrip) { communityStrip.classList.remove('showdown'); communityStrip.innerHTML=''; } } catch(_){ }
    }

    // Restore persisted showdown (after refresh) when applicable
    try {
      if (!holdShowdown) {
        const tid = (function(){ try { const u=new URL(window.location.href); return u.searchParams.get('table')||'poker-1'; } catch { return 'poker-1'; } })();
        const holdKey = 'poker.hold.' + tid;
        const lastKey = 'poker.lastHand.' + tid;
        if (localStorage.getItem(holdKey) === '1') {
          const raw = localStorage.getItem(lastKey);
          if (raw) {
            const last = JSON.parse(raw);
            holdShowdown = true;
            try { if (actionBar) actionBar.style.display = 'none'; } catch {}
            // Restore board
            if (communityStrip) {
              communityStrip.innerHTML = '';
              const comm = Array.isArray(last && last.community) ? last.community : [];
              comm.forEach(function(code){ communityStrip.appendChild(makeCardImg(code, { flip:true })); });
              if (comm.length) communityStrip.classList.add('showdown');
            }
            // Restore banner
            if (centerEl) {
              const winners = Array.isArray(last && last.winners) ? last.winners : [];
              const comm = Array.isArray(last && last.community) ? last.community : [];
              const expArr = Array.isArray(last && last.exposures) ? last.exposures : [];
              if (winners.length) {
                const lines = winners.map(function(w){
                  const a = (w && w.addr) ? String(w.addr) : '';
                  const amt = Number((w && w.amount) || 0);
                  const sh = short(a);
                  let name = '';
                  try {
                    const exp = expArr.find(x=>String(x.addr||'').toLowerCase()===a.toLowerCase());
                    const seven = (Array.isArray(exp&&exp.cards)?exp.cards:[]).concat(comm);
                    if (typeof bestHandName === 'function') name = bestHandName(seven);
                  } catch {}
                  return (amt>0?('+'.concat(String(amt))):String(amt)) + ' â€” ' + sh + (name?(' â€” ' + name):'');
                });
                centerEl.innerHTML = 'Winner' + (winners.length>1?'s':'') + ':<br>' + lines.join('<br>');
                centerEl.style.display = '';
                try { centerEl.style.top = '62%'; } catch {}
              }
            }
          }
        }
      }
    } catch {}
    const cards = Array.isArray(st && st.community) ? st.community : [];
    if (communityEl) communityEl && (communityEl.style.display='none');
    if (communityStrip) {
      if (holdShowdown) {
        // Keep current showdown visuals; do not clear the board
        try { communityStrip.classList.add('showdown'); } catch(_){}
      } else {
        communityStrip.innerHTML = '';
        communityStrip.classList.remove('showdown');
        cards.forEach(function(code){ communityStrip.appendChild(makeCardImg(code, { flip:true })); });
      }
    }
    // Burn cards: show back-faced pile (no overlap) to indicate burns that occurred
    try {
      const stage = String(st && st.stage || '');
      const burnCount = stage === 'flop' ? 1 : stage === 'turn' ? 2 : stage === 'river' ? 3 : 0;
      if (burnStrip) {
        burnStrip.innerHTML = '';
        for (let i = 0; i < burnCount; i++) {
          const img = makeCardImg('BACK', { flip:false });
          img.style.width = '50px';
          img.style.filter = 'brightness(0.95)';
          // Overlap: each subsequent burn shifts further down-left
          if (i > 0) img.style.marginLeft = '-36px';
          img.style.transform = 'translate(' + (-4*i) + 'px, ' + (6*i) + 'px) rotate(' + (-8 + 5*i) + 'deg)';
          burnStrip.appendChild(img);
        }
      }
    } catch(e){}
    try {
      seatEls.forEach(function(el){ const tag = el.querySelector('.role'); if (tag) tag.remove(); });
      if (Array.isArray(st && st.actors) && typeof st.dealerIndex === 'number'){
        const dSeat = st.actors[st.dealerIndex] && st.actors[st.dealerIndex].seatId;
        if (typeof dSeat === 'number'){
          const el = seatEls.find(function(e){ return Number(e.dataset.index) === Number(dSeat); });
          if (el){ const r=document.createElement('div'); r.className='role'; r.style.cssText='position:absolute; top:2px; right:2px; background:#7800cd; color:#fff; font-size:10px; padding:2px 4px; border-radius:6px;'; r.textContent='D'; el.appendChild(r); }
        }
        const sbSeat = (st.actors[st.sbIndex||-1] || {}).seatId;
        if (typeof sbSeat === 'number'){ const el = seatEls.find(function(e){ return Number(e.dataset.index) === Number(sbSeat); }); if (el){ const r=document.createElement('div'); r.className='role'; r.style.cssText='position:absolute; top:2px; left:2px; background:#2a9d8f; color:#fff; font-size:10px; padding:2px 4px; border-radius:6px;'; r.textContent='SB'; el.appendChild(r); } }
        const bbSeat = (st.actors[st.bbIndex||-1] || {}).seatId;
        if (typeof bbSeat === 'number'){ const el = seatEls.find(function(e){ return Number(e.dataset.index) === Number(bbSeat); }); if (el){ const r=document.createElement('div'); r.className='role'; r.style.cssText='position:absolute; bottom:2px; right:2px; background:#e76f51; color:#fff; font-size:10px; padding:2px 4px; border-radius:6px;'; r.textContent='BB'; el.appendChild(r); } }
      }
    } catch(e){}
    // Robust: it is my turn if any of the following are true:
    // 1) Server provided turnSocketId and it matches this socket.id
    // 2) Server provided turnAddr and it matches my wallet address
    // 3) Fallback: the current actor's seatId matches the seat whose addr/socketId matches me
    let mine = false;
    try {
      if (st && st.turnSocketId && socket && socket.id && st.turnSocketId === socket.id) mine = true;
      else if (myAddr && st && st.turnAddr && String(st.turnAddr).toLowerCase() === String(myAddr).toLowerCase()) mine = true;
      else {
        const actor = Array.isArray(st && st.actors) ? st.actors[Number(st.turnIndex)||0] : null;
        const mySeatIdx = lastTable && Array.isArray(lastTable.seats) ? lastTable.seats.findIndex(function(s){
          const a = s && s.addr && String(s.addr).toLowerCase();
          return (myAddr && a === String(myAddr).toLowerCase()) || (socket && s && s.socketId === socket.id);
        }) : -1;
        if (actor && typeof actor.seatId === 'number' && mySeatIdx >= 0) mine = (Number(actor.seatId) === Number(mySeatIdx));
      }
    } catch(e){}
    const btnWrap = actionBar && actionBar.querySelector('.action-btns');
    if (btnWrap) {
      btnWrap.innerHTML = '';
      if (actionBar) actionBar.style.display = mine ? 'flex' : 'none';
      if (!mine && infoText) infoText.textContent = '';
      if (mine) {
        const me = (Array.isArray(st.actors)? st.actors : []).find(function(a){ return a && a.addr && String(a.addr).toLowerCase()===String(myAddr).toLowerCase(); });
        const need = Math.max(0, Number(st.toCall||0) - Number(me && me.contrib || 0));
        const minRaise = Number(st.minRaise||0);
        const mk = function(label, handler){ const b=document.createElement('button'); b.textContent=label; b.onclick=handler; return b; };
        btnWrap.appendChild(mk('Fold', function(){ socket.emit('poker:act', { action:'fold' }); }));
        if (need <= 0) {
          btnWrap.appendChild(mk('Check', function(){ socket.emit('poker:act', { action:'check' }); }));
          btnWrap.appendChild(mk('Bet', function(){ const v = Math.max(1, Number(amountInput && amountInput.value || 0) | 0); socket.emit('poker:act', { action:'bet', amount: v }); }));
        } else {
          btnWrap.appendChild(mk('Call '+need, function(){ socket.emit('poker:act', { action:'call' }); }));
          btnWrap.appendChild(mk('Raise +'+minRaise+'+', function(){ const v = Math.max(minRaise, Number(amountInput && amountInput.value || 0) | 0); socket.emit('poker:act', { action:'raise', amount: v }); }));
        }
        if (infoText) infoText.textContent = 'To call: ' + need + ' ï¿½ MinRaise: ' + minRaise + ' ï¿½ Stack: ' + Number(me && me.stack || 0);
      }
    }
  } catch(e){}
  });

  socket.on('poker:hand', function(m){ try {
    // Showdown event from server
    var winnersRaw = Array.isArray(m && m.winners) ? m.winners : [];
    // Capture used community indices to highlight winning board cards
    usedBoard = [];
    try { winnersRaw.forEach(function(w){ var uc = Array.isArray(w && w.usedCommunity) ? w.usedCommunity : []; uc.forEach(function(i){ if (usedBoard.indexOf(i)===-1) usedBoard.push(i); }); }); } catch(_){ usedBoard = []; }
    if (communityStrip) {
      communityStrip.innerHTML='';
      var comm = Array.isArray(m && m.community)? m.community:[];
      comm.forEach(function(code, idx){ var img = makeCardImg(code, { flip:true }); if (usedBoard.indexOf(idx)>=0) img.classList.add('card--win'); communityStrip.appendChild(img); });
      // Nudge community up at showdown to spotlight board while keeping all visible
      if (comm.length) {
        communityStrip.classList.add('showdown');
        try { Array.from(communityStrip.querySelectorAll('img.card')).forEach(function(img){ img.style.transform = 'translateY(-6px)'; }); } catch(_){ }
      }
    }
    // Build exposures map and enforce site split rule
    let expArr = [];
    try { const arr = Array.isArray(m && m.exposures) ? m.exposures : []; exposures = {}; expArr = arr; arr.forEach(function(e){ const a = String((e && e.addr) || '').toLowerCase(); const cards = Array.isArray(e && e.cards) ? e.cards : []; if (a && cards.length===2) exposures[a] = cards; }); } catch(e){}
    let filteredWinners = winnersRaw;
    try {
      if (winnersRaw.length > 1) {
        const keys = winnersRaw.map(function(w){ const a=String((w && w.addr)||'').toLowerCase(); const exp = expArr.find(x=>String(x.addr||'').toLowerCase()===a); return holeRanksKey(exp && exp.cards); }).filter(Boolean);
        if (keys.length === winnersRaw.length) {
          const allSame = keys.every(k => k === keys[0]);
          if (!allSame) {
            // Keep the top-amount winner from server payload for display/badges
            let top = winnersRaw[0];
            for (let i=1;i<winnersRaw.length;i++){ if (Number(winnersRaw[i].amount||0) > Number(top.amount||0)) top = winnersRaw[i]; }
            filteredWinners = [ top ];
          }
        }
      }
    } catch(_){ filteredWinners = winnersRaw; }
    try { winnersNow = {}; filteredWinners.forEach(function(w){ const a=String((w && w.addr) || '').toLowerCase(); const amt = Number((w && w.amount) || 0); const usedHole = Array.isArray(w && w.usedHole) ? w.usedHole : null; if (a) winnersNow[a] = { amount: amt, usedHole: usedHole }; }); } catch(e){}
    if (lastTable) renderTable(lastTable);
    // Freeze visuals until player clicks Ready
    try { holdShowdown = true; } catch(_){ }
    // Hide action controls during showdown and persist last hand
    try { if (actionBar) actionBar.style.display = 'none'; } catch(_){ }
    try {
      const tid = (function(){ try { const u=new URL(window.location.href); return u.searchParams.get('table')||'poker-1'; } catch { return 'poker-1'; } })();
      localStorage.setItem('poker.hold.'+tid,'1');
      const toSave = { community: (Array.isArray(m && m.community)? m.community:[]), exposures: (Array.isArray(m && m.exposures)? m.exposures:[]), winners: (Array.isArray(m && m.winners)? m.winners:[]), ts: Date.now() };
      localStorage.setItem('poker.lastHand.'+tid, JSON.stringify(toSave));
    } catch {}
    // Center announce winners (with hand name) and render Last Hand panel
    try {
      if (!centerEl) { try { centerEl = document.getElementById('poker-center'); } catch(_) { centerEl = null; } }
      if (centerEl) {
        const winners = filteredWinners;
        if (winners.length) {
          const comm = Array.isArray(m && m.community) ? m.community : [];
          const expArr = Array.isArray(m && m.exposures) ? m.exposures : [];
          const lines = winners.map(function(w){
            const a = (w && w.addr) ? String(w.addr) : '';
            const amt = Number((w && w.amount) || 0);
            const sh = shortAddr(a);
            const exp = expArr.find(x=>String(x.addr||'').toLowerCase()===a.toLowerCase());
            const seven = (Array.isArray(exp&&exp.cards)?exp.cards:[]).concat(comm);
            const name = bestHandName(seven);
            return (amt>0?('+'.concat(String(amt))):String(amt)) + ' â€” ' + sh + ' â€” ' + name;
          });
          centerEl.innerHTML = 'Winner' + (winners.length>1?'s':'') + ':<br>' + lines.join('<br>');
          centerEl.style.display = '';
        } else { centerEl.style.display = 'none'; }
      }
    } catch(_){ }
    try { renderLastHandPanel(m); } catch(_){ }
    if (burnStrip) burnStrip.innerHTML = '';
  } catch(e){} });

  if (devBotBtn) devBotBtn.addEventListener('click', function(){
    try {
      const next = !devBotOn;
      if (next) { alert('Simulated mode enabled: on-chain betting is disabled while the dev bot is active.'); }
      devBotOn = next;
      devBotBtn.classList.toggle('active', devBotOn);
      devBotBtn.textContent = devBotOn ? 'Dev Bot: ON' : 'Dev Bot';
      socket.emit('poker:devbot', { enabled: devBotOn });
    } catch(e){}
  });
}

// Attempt to connect wallet automatically; prompt only if none authorized
async function ensureWallet(promptIfNeeded) {
  try {
    const injected = (function(){ try { const pref=(sessionStorage.getItem('walletProvider')||'').toLowerCase(); if(pref==='phantom') return (window.phantom&&window.phantom.ethereum)||window.__walletProvider; if(pref==='metamask') return window.ethereum||window.__walletProvider; return window.__walletProvider||window.ethereum||(window.phantom&&window.phantom.ethereum)||null; } catch { return window.__walletProvider||window.ethereum||(window.phantom&&window.phantom.ethereum)||null; } })();
    if (!injected || !window.ethers) { setStatus('No wallet provider'); return; }
    const accounts = await injected.request({ method:'eth_accounts' });
    let addr = (Array.isArray(accounts) && accounts[0]) ? accounts[0] : null;
    if (!addr && promptIfNeeded) {
      try {
        const req = await injected.request({ method:'eth_requestAccounts' });
        addr = (Array.isArray(req) && req[0]) ? req[0] : null;
      } catch(_) {}
    }
    if (addr) {
      const provider = new window.ethers.providers.Web3Provider(injected,'any');
      const signer = provider.getSigner();
      const got = await signer.getAddress();
      myAddr = String(got||addr||'').toLowerCase();
      setStatus('' + short(myAddr)); try { if (walletAddrSpan) walletAddrSpan.textContent = short(myAddr); } catch{}
      try { if (connectBtn) connectBtn.style.display = 'none'; } catch(e){}
      try { if (disconnectBtn) { disconnectBtn.style.display=''; disconnectBtn.onclick = () => { try{ localStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletConnected'); }catch(_){} try{ location.replace('/landing.html'); }catch(_){} }; } } catch(_){}
      if (devBotBtn) { devBotBtn.disabled = false; devBotBtn.title = 'Add/remove a test bot to play solo'; }
      if (socket && socket.connected) {
        try { socket.emit('identify', { addr: myAddr }); } catch(e){}
        try { socket.emit('join_table', { table: currentTableId }); try { socket.emit('table:get', { table: currentTableId }); } catch(e){} try { socket.emit('lobby:get'); } catch(e){} setTimeout(function(){ try { socket.emit('join_table', { table: currentTableId }); try { socket.emit('table:get', { table: currentTableId }); } catch(e){} } catch(e){} }, 80); } catch(e){}
      }
    } else {
      setStatus('Connect wallet to join table');
    }
  } catch(e) { setStatus('Wallet connect failed'); }
}

connect();
try { tryLoadCardSprite(); } catch {}
// If Tavern already connected, pick it up without re-prompting
try {
  if (window.userAddress && String(window.userAddress)) {
    myAddr = String(window.userAddress).toLowerCase();
    try { if (walletAddrSpan) walletAddrSpan.textContent = short(myAddr); } catch{}
    try { if (disconnectBtn) { disconnectBtn.style.display=''; disconnectBtn.onclick = () => { try{ localStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletConnected'); }catch(_){} try{ location.replace('/landing.html'); }catch(_){} }; } } catch(_){}
  }
} catch {}
ensureWallet(false);
// React when Tavern announces wallet connection
try {
  window.addEventListener('wallet:connected', function(ev){
    try {
      const addr = String((ev && ev.detail && ev.detail.address) || '').toLowerCase();
      if (addr) {
        myAddr = addr; setStatus('');
        try { if (walletAddrSpan) walletAddrSpan.textContent = short(myAddr); } catch{}
        try { if (connectBtn) connectBtn.style.display = 'none'; } catch {}
        try { if (disconnectBtn) { disconnectBtn.style.display=''; disconnectBtn.onclick = () => { try{ localStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletConnected'); }catch(_){} try{ location.replace('/landing.html'); }catch(_){} }; } } catch(_){}
        if (devBotBtn) { devBotBtn.disabled = false; devBotBtn.title = 'Add/remove a test bot to play solo'; }
        if (socket && socket.connected) {
        try { socket.emit('identify', { addr: myAddr }); } catch(e){}
        try { socket.emit('join_table', { table: currentTableId }); } catch(e){}
        try { socket.emit('table:get', { table: currentTableId }); } catch(e){}
        try { socket.emit('poker:get'); } catch(e){}
        try { socket.emit('lobby:get'); } catch(e){}
        }
      }
    } catch {}
  });
} catch {}

if (connectBtn) connectBtn.addEventListener('click', function(){ ensureWallet(true); });

// Best-effort inline wallet UI sync in case events race
try {
  let tries = 0;
  const t = setInterval(async () => {
    try {
      if (myAddr) { clearInterval(t); return; }
      if (window.userAddress && String(window.userAddress)) {
        myAddr = String(window.userAddress).toLowerCase();
        try { if (walletAddrSpan) walletAddrSpan.textContent = short(myAddr); } catch{}
        try { if (disconnectBtn) { disconnectBtn.style.display=''; disconnectBtn.onclick = () => { try{ localStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletConnected'); }catch(_){} try{ location.replace('/landing.html'); }catch(_){} }; } } catch(_){}
        clearInterval(t); return;
      }
      // One more passive check via eth_accounts without prompting
      const injected = (function(){ try { const pref=(sessionStorage.getItem('walletProvider')||'').toLowerCase(); if(pref==='phantom') return (window.phantom&&window.phantom.ethereum)||window.__walletProvider; if(pref==='metamask') return window.ethereum||window.__walletProvider; return window.__walletProvider||window.ethereum||(window.phantom&&window.phantom.ethereum)||null; } catch { return window.__walletProvider||window.ethereum||(window.phantom&&window.phantom.ethereum)||null; } })();
      if (injected && window.ethers) {
        const accounts = await injected.request({ method:'eth_accounts' });
        const a = (Array.isArray(accounts) && accounts[0]) ? accounts[0] : null;
        if (a) {
          myAddr = String(a).toLowerCase();
          try { if (walletAddrSpan) walletAddrSpan.textContent = short(myAddr); } catch{}
          try { if (disconnectBtn) { disconnectBtn.style.display=''; disconnectBtn.onclick = () => { try{ localStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletConnected'); }catch(_){} try{ location.replace('/landing.html'); }catch(_){} }; } } catch(_){}
          clearInterval(t); return;
        }
      }
    } catch {}
    if (++tries > 10) { try { clearInterval(t); } catch{} }
  }, 800);
} catch {}



















