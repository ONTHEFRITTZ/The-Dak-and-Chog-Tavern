const statusEl = document.getElementById('status');
const centerEl = document.getElementById('center');
const seatEls = Array.from(document.querySelectorAll('.seat'));
const connectBtn = document.getElementById('connect-wallet');
const devBotBtn = document.getElementById('toggle-dev-bot');
let devBotOn = false;
let socket; let myAddr = null; let currentTableId = null; let lastTable = null; let myHole = [];
let lastState = null; // latest poker:state
let exposures = {};
let winnersNow = {};  // addrLower -> amount for current showdown

// Build a simple action bar anchored to the table canvas
let actionBar = null; let communityEl = null; let amountInput = null; let infoText = null; let communityStrip = null;
function ensureActionBar(){
  try {
    if (actionBar) return actionBar;
    const canvas = document.querySelector('.table-canvas');
    actionBar = document.createElement('div');
    actionBar.style.cssText = 'position:absolute; left:50%; bottom:8px; transform:translateX(-50%); display:flex; gap:8px; background:rgba(255,244,233,0.95); border:3px solid #7800cd; border-radius:12px; padding:8px 10px; box-shadow:0 4px 12px rgba(0,0,0,0.2); align-items:center;';
    const lab = document.createElement('div'); lab.textContent = 'Your Action:'; lab.style.fontWeight='600'; lab.style.color='#2b1e12'; actionBar.appendChild(lab);
    infoText = document.createElement('div'); infoText.style.color='#2b1e12'; infoText.style.fontSize='12px'; actionBar.appendChild(infoText);
    const btns = document.createElement('div'); btns.style.display='flex'; btns.style.gap='8px'; btns.className='action-btns'; actionBar.appendChild(btns);
    amountInput = document.createElement('input'); amountInput.type='number'; amountInput.min='1'; amountInput.step='1'; amountInput.value='2'; amountInput.style.width='70px'; amountInput.placeholder='amt'; amountInput.title='Bet/Raise amount'; actionBar.appendChild(amountInput);
    canvas.appendChild(actionBar);
    // community cards banner above center
    communityEl = document.createElement('div');
    communityEl.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-160%); background:rgba(255,244,233,0.92); border:3px solid #7800cd; border-radius:10px; padding:6px 8px; font-weight:600; color:#2b1e12;';
    communityEl.textContent = '';
    canvas.appendChild(communityEl);
    // strip for board card images
    communityStrip = document.createElement('div');
    communityStrip.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-105%); display:flex; gap:8px;';
    canvas.appendChild(communityStrip);
  } catch {}
}


function short(a){ try { return a && a.length>10 • (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); } catch { return a||''; } }
function setStatus(t){ try { statusEl.textContent = t; } catch {} }
function cardSrc(code){
  try {
    const r = String(code||'').charAt(0).toUpperCase();
    const s = String(code||'').charAt(1).toLowerCase();
    const rankMap = { 'A':'ace', 'K':'king', 'Q':'queen', 'J':'jack' };
    const suitMap = { 's':'spades', 'h':'hearts', 'd':'diamonds', 'c':'clubs' };
    const rank = rankMap[r] || null;
    const suit = suitMap[s] || null;
    if (rank && suit) { return `../../assets/images/chog_cards/chog-${rank}-of-${suit}.png`; }
  } catch {}
  // placeholder for missing cards
  return `../../assets/images/chog_cards/chog-ace-of-spades.png`;
}

function cardBackSrc(){
  return `../../assets/images/chog_cards/dak-and-chog-cardback.png`;
}

function makeCardImg(code, { hole=false, flip=true, win=false } = {}){
  const img = document.createElement('img');
  img.alt = String(code||'');
  img.src = code === 'BACK' • cardBackSrc() : cardSrc(code);
  img.className = 'card' + (hole • ' card--hole' : '') + (flip • ' card--flip' : '') + (win • ' card--win' : '');
  if (flip) requestAnimationFrame(() => { img.classList.add('card--show'); });
  return img;
}


function renderTable(t){
  try {
    if (!t || t.id !== currentTableId) return;
    lastTable = t;
    seatEls.forEach(el => {
      const idx = Number(el.dataset.index);
      const s = Array.isArray(t.seats) • t.seats[idx] : null;
      el.innerHTML = '';
      const label = document.createElement('div'); label.className='addr'; label.textContent = `Seat ${idx}`; el.appendChild(label);
      const info = document.createElement('div'); info.className='addr';
      if (s) {
        info.textContent = `${short(s.addr||s.id)}${typeof s.chips==='number' • ' â€¢ '+s.chips+'c' : ''}`; el.appendChild(info);
        if (myAddr && s.addr && String(s.addr).toLowerCase()===String(myAddr).toLowerCase()){
          const btns = document.createElement('div'); btns.className='btns';
          const leave = document.createElement('button'); leave.textContent='Leave'; leave.onclick=()=> socket.emit('seat',{ index:-1 });
          const ready = document.createElement('button'); ready.textContent = s.ready? 'Unready':'Ready'; ready.onclick=()=> socket.emit('ready',{ ready: !s.ready });
          btns.appendChild(leave); btns.appendChild(ready); el.appendChild(btns);
          // show my hole cards if known
          try {
            if (Array.isArray(myHole) && myHole.length===2) {
              const row = document.createElement('div'); row.style.cssText='display:flex; gap:6px; margin-top:4px;';
              myHole.forEach(code => { const img=document.createElement('img'); img.alt=code; img.src=cardSrc(code); img.style.cssText='width:46px; height:auto; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.25);'; row.appendChild(img); });
              el.appendChild(row);
            }
          } catch {}
        } else {
          // other players: card backs during hand, or exposures at showdown
          try {
            const addrLower = String(s.addr||'').toLowerCase();
            const actor = (Array.isArray(lastState?.actors)? lastState.actors : []).find(a => a && a.addr && String(a.addr).toLowerCase()===addrLower);
            if (actor) {
              const row = document.createElement('div'); row.style.cssText='display:flex; gap:6px; margin-top:4px;';
              const exp = exposures[addrLower];
              if (Array.isArray(exp) && exp.length===2) {
                exp.forEach(code => { const img=document.createElement('img'); img.alt=code; img.src=cardSrc(code); img.style.cssText='width:46px; height:auto; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.25);'; row.appendChild(img); });
                el.appendChild(row);
                try { const isWin = winnersNow && winnersNow[addrLower] != null; if (isWin) { const badge=document.createElement('div'); badge.className='win-badge'; const amt=winnersNow[addrLower]; badge.textContent = Winner ; el.appendChild(badge); } } catch {}
              } else if (!actor.folded) {
                for (let k=0;k<2;k++){ const img=document.createElement('img'); img.alt='card-back'; img.src=cardBackSrc(); img.style.cssText='width:46px; height:auto; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.25)'; row.appendChild(img); }
                el.appendChild(row);
              }
            }
          } catch {}
        }
      } else {
        info.textContent = 'Empty'; el.appendChild(info);
        const btns = document.createElement('div'); btns.className='btns';
        const sit = document.createElement('button'); sit.textContent='Sit'; if (!myAddr) { sit.disabled=true; sit.title='Connect wallet to sit'; }
        sit.onclick = () => { if (!myAddr) return; socket.emit('seat',{ index: idx }); };
        btns.appendChild(sit); el.appendChild(btns);
      }
    });
  } catch {}
}

function parseTableId(){ try { const u=new URL(window.location.href); return u.searchParams.get('table') || 'poker-1'; } catch { return 'poker-1'; } }

async function connect(){
  currentTableId = parseTableId();
  try {
    socket = io(window.location.origin, { path: '/poker.io/', transports:['polling','websocket'], upgrade:true, reconnection:true, reconnectionAttempts:10, reconnectionDelay:800, forceNew:true });
  } catch (e) { setStatus('Socket.IO not available'); return; }

  socket.on('connect', () => {
    setStatus('Connected');
    if (myAddr) { try { socket.emit('identify', { addr: myAddr }); } catch {} }
    try { socket.emit('join_table', { table: currentTableId }); } catch {}
  });
  socket.on('connect_error', () => setStatus('Lobby unavailable. Retrying...'));
  socket.on('reconnect_error', () => setStatus('Reconnecting...'));
  socket.on('disconnect', () => setStatus('Disconnected'));
  socket.on('table:update', (t) => { renderTable(t); });
  socket.on('system', (m) => { try { centerEl.textContent = String(m); } catch {} });
  // Receive my private hole cards
  socket.on('poker:cards', (m) => {
    try { const tid = String(m?.tableId||''); if (tid && tid !== currentTableId) return; const hole = Array.isArray(m?.hole)? m.hole : []; if (hole.length === 2) { myHole = hole; if (lastTable) renderTable(lastTable); } } catch {}
  });
  socket.on('poker:mode', (m) => { try { const sim = !!m?.simulated; if (sim) { alert('Simulated mode enabled: on-chain betting is disabled while the dev bot is active.'); } } catch {} });
  // Poker state updates
  // Poker state updates
  socket.on('poker:state', (st) => {
    try {
      lastState = st; try { if (String(st?.stage||'') === 'preflop') { exposures = {}; } } catch {}
      ensureActionBar();
      // Update center banner with stage and pot
      if (centerEl) centerEl.textContent = `Stage: ${String(st.stage).toUpperCase()} • Pot: ${Number(st.pot||0)}`;
      // Render community
      const cards = Array.isArray(st.community) • st.community : [];
      if (communityEl) communityEl.textContent = cards.length • 'Board' : '';
      if (communityStrip) {
        communityStrip.innerHTML = '';
        cards.forEach(code => {
          const img = document.createElement('img');
          img.alt = code; img.src = cardSrc(code);
          img.style.cssText = 'width:58px; height:auto; border-radius:8px; box-shadow:0 3px 8px rgba(0,0,0,0.25)';
          communityStrip.appendChild(img);
        });
      }
      // Dealer/SB/BB markers
      try {
        seatEls.forEach(el => { const tag = el.querySelector('.role'); if (tag) tag.remove(); });
        if (Array.isArray(st.actors) && typeof st.dealerIndex === 'number'){
          const dSeat = st.actors[st.dealerIndex]?.seatId;
          if (typeof dSeat === 'number'){
            const el = seatEls.find(e => Number(e.dataset.index) === Number(dSeat));
            if (el){ const r=document.createElement('div'); r.className='role'; r.style.cssText='position:absolute; top:2px; right:2px; background:#7800cd; color:#fff; font-size:10px; padding:2px 4px; border-radius:6px;'; r.textContent='D'; el.appendChild(r); }
          }
          const sbSeat = st.actors[st.sbIndex||-1]?.seatId;
          if (typeof sbSeat === 'number'){
            const el = seatEls.find(e => Number(e.dataset.index) === Number(sbSeat));
            if (el){ const r=document.createElement('div'); r.className='role'; r.style.cssText='position:absolute; top:2px; left:2px; background:#2a9d8f; color:#fff; font-size:10px; padding:2px 4px; border-radius:6px;'; r.textContent='SB'; el.appendChild(r); }
          }
          const bbSeat = st.actors[st.bbIndex||-1]?.seatId;
          if (typeof bbSeat === 'number'){
            const el = seatEls.find(e => Number(e.dataset.index) === Number(bbSeat));
            if (el){ const r=document.createElement('div'); r.className='role'; r.style.cssText='position:absolute; bottom:2px; right:2px; background:#e76f51; color:#fff; font-size:10px; padding:2px 4px; border-radius:6px;'; r.textContent='BB'; el.appendChild(r); }
          }
        }
      } catch {}

      // If it's your turn, show actions; else hide
      const mine = myAddr && st.turnAddr && String(st.turnAddr).toLowerCase() === String(myAddr).toLowerCase();
      const btnWrap = actionBar?.querySelector('.action-btns');
      if (btnWrap) {
        btnWrap.innerHTML = '';
        if (mine) {
          const me = (Array.isArray(st.actors)? st.actors : []).find(a => a && a.addr && String(a.addr).toLowerCase()===String(myAddr).toLowerCase());
          const need = Math.max(0, Number(st.toCall||0) - Number(me?.contrib||0));
          const minRaise = Number(st.minRaise||0);
          const mk = (label, handler) => { const b=document.createElement('button'); b.textContent=label; b.onclick=handler; return b; };
          btnWrap.appendChild(mk('Fold', () => socket.emit('poker:act', { action:'fold' })));
          if (need <= 0) {
            btnWrap.appendChild(mk('Check', () => socket.emit('poker:act', { action:'check' })));
            btnWrap.appendChild(mk('Bet', () => {
              const v = Math.max(1, Number(amountInput?.value||0)|0);
              socket.emit('poker:act', { action:'bet', amount: v });
            }));
          } else {
            btnWrap.appendChild(mk(`Call ${need}`, () => socket.emit('poker:act', { action:'call' })));
            btnWrap.appendChild(mk(`Raise +${minRaise}+`, () => {
              const v = Math.max(minRaise, Number(amountInput?.value||0)|0);
              socket.emit('poker:act', { action:'raise', amount: v });
            }));
          }
          if (infoText) infoText.textContent = `To call: ${need} • MinRaise: ${minRaise} • Stack: ${Number(me?.stack||0)}`;
        }
      }
    } catch {}
  });
      }
    } catch {}
  });
  // Hand complete
  socket.on('poker:hand', (m) => {
    try {
      const winners = Array.isArray(m?.winners)? m.winners : [];
      const txt = winners.length • `Winners: ${winners.map(w=>short(w.addr||''))}. Pot ${Number(m.pot||0)}` : `Hand complete. Pot ${Number(m.pot||0)}`;
      if (centerEl) centerEl.textContent = txt;
      if (communityEl) communityEl.textContent = Array.isArray(m?.community)&&m.community.length • 'Board' : '';
      if (communityStrip) { communityStrip.innerHTML=''; (Array.isArray(m?.community)? m.community:[]).forEach(code => { communityStrip.appendChild(makeCardImg(code, { flip:true })); }); }
      // winners and exposures
      try { const arr = Array.isArray(m?.exposures) ? m.exposures : []; exposures = {}; arr.forEach(e => { const a = String(e?.addr||'').toLowerCase(); const cards = Array.isArray(e?.cards) ? e.cards : []; if (a && cards.length===2) exposures[a] = cards; }); } catch {}
      try { winnersNow = {}; (Array.isArray(m?.winners)? m.winners:[]).forEach(w => { const a=String(w?.addr||'').toLowerCase(); const amt = Number(w?.amount||0); if (a) winnersNow[a] = amt; }); } catch {}
      if (lastTable) renderTable(lastTable);
      myHole = [];
      if (actionBar) { const btnWrap = actionBar.querySelector('.action-btns'); if (btnWrap) btnWrap.innerHTML=''; }
    } catch {}
  });

  // Dev bot toggle
  devBotBtn?.addEventListener('click', () => {
    try { devBotOn = !devBotOn; devBotBtn.classList.toggle('active', devBotOn); devBotBtn.textContent = devBotOn • 'Dev Bot: ON' : 'Dev Bot'; socket.emit('poker:devbot', { enabled: devBotOn }); } catch {}
  });
}

connect();

connectBtn?.addEventListener('click', async () => {
  try {
    if (!window.ethereum || !window.ethers) { setStatus('No wallet provider'); return; }
    await window.ethereum.request({ method:'eth_requestAccounts' });
    const provider = new window.ethers.providers.Web3Provider(window.ethereum,'any');
    const signer = provider.getSigner();
    const addr = await signer.getAddress();
    myAddr = String(addr||'').toLowerCase();
    setStatus(`Wallet: ${short(myAddr)}`);
    try { if (socket && socket.connected) { socket.emit('identify', { addr: myAddr }); socket.emit('join_table', { table: currentTableId }); } } catch {}
  } catch (e) { setStatus('Wallet connect failed'); }
});






