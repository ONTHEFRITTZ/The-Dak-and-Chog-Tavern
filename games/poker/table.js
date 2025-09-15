const statusEl = document.getElementById('status');
const seatEls = Array.from(document.querySelectorAll('.seat'));
const connectBtn = document.getElementById('connect-wallet');
const devBotBtn = document.getElementById('toggle-dev-bot');
let devBotOn = false;
let socket; let myAddr = null; let currentTableId = null; let lastTable = null; let myHole = [];
let lastState = null; let exposures = {}; let winnersNow = {};

let actionBar = null; let communityEl = null; let amountInput = null; let infoText = null; let communityStrip = null;

function ensureActionBar(){
  if (actionBar) return actionBar;
  const canvas = document.querySelector('.table-canvas');
  actionBar = document.createElement('div');
  actionBar.style.cssText = 'position:absolute; left:50%; bottom:8px; transform:translateX(-50%); display:none; gap:8px; background:rgba(255,244,233,0.95); border:3px solid #7800cd; border-radius:12px; padding:8px 10px; box-shadow:0 4px 12px rgba(0,0,0,0.2); align-items:center;';
  infoText = document.createElement('div'); infoText.style.color='#2b1e12'; infoText.style.fontSize='12px'; actionBar.appendChild(infoText);
  const btns = document.createElement('div'); btns.style.display='flex'; btns.style.gap='8px'; btns.className='action-btns'; actionBar.appendChild(btns);
  amountInput = document.createElement('input'); amountInput.type='number'; amountInput.min='1'; amountInput.step='1'; amountInput.value='2'; amountInput.style.width='70px'; amountInput.placeholder='amt'; amountInput.title='Bet/Raise amount'; actionBar.appendChild(amountInput);
  canvas.appendChild(actionBar);

  communityEl = document.createElement('div');
  communityEl.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-160%); background:rgba(255,244,233,0.92); border:3px solid #7800cd; border-radius:10px; padding:6px 8px; font-weight:600; color:#2b1e12;';
  communityEl.textContent = ''; communityEl.style.display='none';
  canvas.appendChild(communityEl);

  communityStrip = document.createElement('div');
  communityStrip.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-105%); display:flex; gap:8px;';
  canvas.appendChild(communityStrip);
}

function short(a){ return (a && a.length>10) ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }
function setStatus(t){ if (statusEl) statusEl.textContent = t; }
function cardSrc(code){
  try {
    const r = String(code||'').charAt(0).toUpperCase();
    const s = String(code||'').charAt(1).toLowerCase();
    const rm = { 'A':'ace','K':'king','Q':'queen','J':'jack' };
    const sm = { 's':'spades','h':'hearts','d':'diamonds','c':'clubs' };
    const rank = rm[r] || null; const suit = sm[s] || null;
    if (rank && suit) { return '../../assets/images/chog_cards/chog-' + rank + '-of-' + suit + '.png'; }
  } catch(e){}
  return '../../assets/images/chog_cards/chog-ace-of-spades.png';
}
function cardBackSrc(){ return '../../assets/images/chog_cards/dak-and-chog-cardback.png'; }
function makeCardImg(code, opts){ opts = opts||{}; const hole=!!opts.hole, flip = opts.flip!==false, win = !!opts.win; const img=document.createElement('img'); img.alt=String(code||''); img.src = (code==='BACK')? cardBackSrc() : cardSrc(code); img.className='card' + (hole?' card--hole':'') + (flip?' card--flip':'') + (win?' card--win':''); if (flip) requestAnimationFrame(function(){ img.classList.add('card--show'); }); return img; }

function renderTable(t){
  if (!t || t.id !== currentTableId) return;
  lastTable = t;
  seatEls.forEach(function(el){
    const idx = Number(el.dataset.index);
    const s = Array.isArray(t.seats) ? t.seats[idx] : null;
    el.innerHTML = '';
    const label = document.createElement('div'); label.className='addr'; label.textContent = 'Seat ' + idx; el.appendChild(label);
    const info = document.createElement('div'); info.className='addr';
    if (s) {
      info.textContent = short(s.addr||s.id) + (typeof s.chips==='number' ? ' • ' + s.chips + 'c' : ''); el.appendChild(info);
      const addrLower = String(s.addr||'').toLowerCase();
      if (myAddr && addrLower===String(myAddr).toLowerCase()){
        const btns = document.createElement('div'); btns.className='btns';
        const leave = document.createElement('button'); leave.textContent='Leave'; leave.onclick=function(){ socket.emit('seat',{ index:-1 }); };
        const ready = document.createElement('button'); ready.textContent = s.ready? 'Unready':'Ready'; ready.onclick=function(){ socket.emit('ready',{ ready: !s.ready }); };
        btns.appendChild(leave); btns.appendChild(ready); el.appendChild(btns);
        if (Array.isArray(myHole) && myHole.length===2) { const row=document.createElement('div'); row.style.cssText='display:flex; gap:6px; margin-top:4px;'; myHole.forEach(function(code){ row.appendChild(makeCardImg(code,{hole:true,flip:true})); }); el.appendChild(row); }
      } else {
        try {
          const actors = Array.isArray(lastState && lastState.actors) ? lastState.actors : [];
          const actor = actors.find(function(a){ return a && a.addr && String(a.addr).toLowerCase()===addrLower; });
          if (actor) {
            const row=document.createElement('div'); row.style.cssText='display:flex; gap:6px; margin-top:4px;';
            const exp = exposures[addrLower];
            if (Array.isArray(exp) && exp.length===2) { const isWin = winnersNow && winnersNow[addrLower] != null; exp.forEach(function(code){ row.appendChild(makeCardImg(code,{hole:true,flip:true,win:isWin})); }); el.appendChild(row); if (isWin) { const badge=document.createElement('div'); badge.className='win-badge'; const amt=winnersNow[addrLower]; badge.textContent = 'Winner ' + (amt>0?'+':'') + String(amt); el.appendChild(badge); } }
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
  try { socket = io(window.location.origin, { path: '/poker.io/', transports:['polling','websocket'], upgrade:true, reconnection:true, reconnectionAttempts:10, reconnectionDelay:800, forceNew:true }); }
  catch (e) { setStatus('Socket.IO not available'); return; }

  socket.on('connect', function(){ setStatus('Connected'); if (myAddr) { try { socket.emit('identify', { addr: myAddr }); } catch(e){} } try { socket.emit('join_table', { table: currentTableId }); } catch(e){} });
  socket.on('connect_error', function(){ setStatus('Lobby unavailable. Retrying...'); });
  socket.on('reconnect_error', function(){ setStatus('Reconnecting...'); });
  socket.on('disconnect', function(){ setStatus('Disconnected'); });
  socket.on('table:update', function(t){ try { if (typeof t?.simulated === 'boolean' && devBotBtn) { devBotOn = !!t.simulated; devBotBtn.classList.toggle('active', devBotOn); devBotBtn.textContent = devBotOn ? 'Dev Bot: ON' : 'Dev Bot'; } } catch(e){} renderTable(t); });
  socket.on('system', function(){ /* no banner */ });
  socket.on('poker:cards', function(m){ try { const tid = String((m && m.tableId) || ''); if (tid && tid !== currentTableId) return; const hole = Array.isArray(m && m.hole) ? m.hole : []; if (hole.length === 2) { myHole = hole; if (lastTable) renderTable(lastTable); } } catch(e){} });
  socket.on('poker:mode', function(m){ try { const sim = !!(m && m.simulated); if (devBotBtn) { devBotOn = sim; devBotBtn.classList.toggle('active', devBotOn); devBotBtn.textContent = devBotOn ? 'Dev Bot: ON' : 'Dev Bot'; } if (sim) { alert('Simulated mode enabled: on-chain betting is disabled while the dev bot is active.'); } } catch(e){} });
  socket.on('poker:state', function(st){ try {
    lastState = st; try { if (String((st && st.stage) || '') === 'preflop') { exposures = {}; winnersNow = {}; } } catch(e){}
    ensureActionBar();
    const cards = Array.isArray(st && st.community) ? st.community : [];
    if (communityEl) communityEl && (communityEl.style.display='none');
    if (communityStrip) { communityStrip.innerHTML = ''; cards.forEach(function(code){ communityStrip.appendChild(makeCardImg(code, { flip:true })); }); }
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
    const mine = myAddr && st.turnAddr && String(st.turnAddr).toLowerCase() === String(myAddr).toLowerCase();
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
        if (infoText) infoText.textContent = 'To call: ' + need + ' • MinRaise: ' + minRaise + ' • Stack: ' + Number(me && me.stack || 0);
      }
    }
  } catch(e){}
  });

  socket.on('poker:hand', function(m){ try {
    if (communityStrip) { communityStrip.innerHTML=''; (Array.isArray(m && m.community)? m.community:[]).forEach(function(code){ communityStrip.appendChild(makeCardImg(code, { flip:true })); }); }
    try { const arr = Array.isArray(m && m.exposures) ? m.exposures : []; exposures = {}; arr.forEach(function(e){ const a = String((e && e.addr) || '').toLowerCase(); const cards = Array.isArray(e && e.cards) ? e.cards : []; if (a && cards.length===2) exposures[a] = cards; }); } catch(e){}
    try { winnersNow = {}; (Array.isArray(m && m.winners)? m.winners:[]).forEach(function(w){ const a=String((w && w.addr) || '').toLowerCase(); const amt = Number((w && w.amount) || 0); if (a) winnersNow[a] = amt; }); } catch(e){}
    if (lastTable) renderTable(lastTable);
    myHole = [];
  } catch(e){} });

  if (devBotBtn) devBotBtn.addEventListener('click', function(){ try { devBotOn = !devBotOn; devBotBtn.classList.toggle('active', devBotOn); devBotBtn.textContent = devBotOn ? 'Dev Bot: ON' : 'Dev Bot'; socket.emit('poker:devbot', { enabled: devBotOn }); } catch(e){} });
}

connect();

if (connectBtn) connectBtn.addEventListener('click', async function(){
  try {
    if (!window.ethereum || !window.ethers) { setStatus('No wallet provider'); return; }
    await window.ethereum.request({ method:'eth_requestAccounts' });
    const provider = new window.ethers.providers.Web3Provider(window.ethereum,'any');
    const signer = provider.getSigner();
    const addr = await signer.getAddress();
    myAddr = String(addr||'').toLowerCase();
    setStatus('Wallet: ' + short(myAddr));
    try { if (socket && socket.connected) { socket.emit('identify', { addr: myAddr }); socket.emit('join_table', { table: currentTableId }); } } catch(e){}
  } catch (e) { setStatus('Wallet connect failed'); }
});


