// Poker Table UI (8-max) — proper Texas Hold’em flow with sprite cards, burns (face-down),
// action buttons, and no auto-simulation. Works with your existing realtime.js events.

(function(){
  /* -------------------------- Config (sprite + layout) -------------------------- */
  const SPRITE_URL  = '/assets/images/cards/cards-sprite.png';
  const SPRITE_COLS = 13;     // 13 ranks across
  const SPRITE_ROWS = 5;      // 4 suits + 1 row for card back
  const SUIT_ROW = { h:0, d:1, c:2, s:3 };     // hearts, diamonds, clubs, spades
  const RANKS   = ['2','3','4','5','6','7','8','9','T','J','Q','K','A']; // left→right
  const BACK_POS = { row: 4, col: 0 };         // back tile on last row, first col

  // Seat ring spacing (bigger ellipse → more room)
  const RADIUS_X = 0.42;      // 42% of canvas width
  const RADIUS_Y = 0.38;      // 38% of canvas height

  /* ------------------------------- DOM refs ------------------------------------ */
  const canvas     = document.querySelector('.table-canvas');
  const seatEls    = Array.from(document.querySelectorAll('.seat'));
  const centerEl   = document.getElementById('poker-center');

  // We create these containers if not present:
  function ensureOverlayEl(id, className, parent){
    let el = document.getElementById(id);
    if (!el){
      el = document.createElement('div');
      el.id = id;
      if (className) el.className = className;
      (parent||canvas).appendChild(el);
    }
    return el;
  }
  const boardEl    = ensureOverlayEl('board-cards', 'board', canvas);
  const burnsEl    = ensureOverlayEl('burn-pile', 'burn-pile', canvas);

  // Action bar under my seat (created on demand)
  let actionBarEl = null;

  /* ------------------------------- State --------------------------------------- */
  function qp(k){ try{ return new URL(window.location.href).searchParams.get(k) }catch{ return null } }
  const tableId = qp('table');
  let socket;

  let myAddr   = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').toLowerCase();
  let mySeat   = -1;

  let state       = null;   // last 'poker:state'
  let myHole      = [];     // ['As','Kd'] when dealt
  let oppHasHole  = new Set(); // seatIds of opponents in-hand (we show backs)

  /* ------------------------------- Helpers ------------------------------------- */
  function short(a){ return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }
  function lc(s){ return (s||'').toLowerCase(); }

  // Compute CSS for a specific card tile
  function cardStylesFromCode(code){
    if (!code || typeof code !== 'string' || code.length < 2){
      return cardBackStyles();
    }
    const r = code[0].toUpperCase();
    const s = code[1].toLowerCase();
    const col = Math.max(0, RANKS.indexOf(r));     // 0..12
    const row = (s in SUIT_ROW) ? SUIT_ROW[s] : 0; // 0..3
    return {
      backgroundImage: `url("${SPRITE_URL}")`,
      backgroundSize: `${SPRITE_COLS*100}% ${SPRITE_ROWS*100}%`,
      backgroundPosition: `${(col/(SPRITE_COLS-1))*100}% ${(row/(SPRITE_ROWS-1))*100}%`
    };
  }
  function cardBackStyles(){
    return {
      backgroundImage: `url("${SPRITE_URL}")`,
      backgroundSize: `${SPRITE_COLS*100}% ${SPRITE_ROWS*100}%`,
      backgroundPosition: `${(BACK_POS.col/(SPRITE_COLS-1))*100}% ${(BACK_POS.row/(SPRITE_ROWS-1))*100}%`
    };
  }

  function makeCardEl(code, hole=false, faceUp=true){
    const el = document.createElement('div');
    el.className = 'card' + (hole ? ' card--hole' : '');
    const styles = faceUp ? cardStylesFromCode(code) : cardBackStyles();
    el.style.backgroundImage = styles.backgroundImage;
    el.style.backgroundSize = styles.backgroundSize;
    el.style.backgroundPosition = styles.backgroundPosition;
    return el;
  }

  function burnsForStage(stage){
    // Visual only: standard Hold’em burns (not revealing identity)
    if (stage === 'flop')  return 1;
    if (stage === 'turn')  return 2;
    if (stage === 'river') return 3;
    return 0;
  }

  /* ---------- Seat ring layout (8 spots, even spacing, no overlap) ---------- */
  function layoutSeats() {
    const wrap = document.querySelector('.table-canvas');
    if (!wrap || !seatEls.length) return;

    const W = wrap.clientWidth;
    const H = wrap.clientHeight;

    // Use actual seat dimensions; fall back to CSS values if not rendered yet
    const probe = seatEls[0];
    const seatW = (probe && probe.offsetWidth)  ? probe.offsetWidth  : 110;
    const seatH = (probe && probe.offsetHeight) ? probe.offsetHeight : 130;

    // Gap pushes seats away from table center (increase if you want wider spacing)
    const gap = 50; // px

    // Radii ensure each seat’s bounding box stays inside the table-canvas without colliding
    // Half the container minus half the seat minus our desired gap
    const rx = Math.max(0, (W * 0.5) - (seatW * 0.5) - gap);
    const ry = Math.max(0, (H * 0.5) - (seatH * 0.5) - gap);

    // Evenly spaced seats around an ellipse, starting at 270° (top center) clockwise
    const N = seatEls.length; // 8 seats in your DOM
    const startDeg = 270;

    for (let i = 0; i < N; i++) {
      const ang = (startDeg + (i * 360 / N)) * Math.PI / 180;
      const x = (W * 0.5) + rx * Math.cos(ang);
      const y = (H * 0.5) + ry * Math.sin(ang);

      const el = seatEls[i];
      // Place by top-left coordinates so the seat's center hits (x, y)
      el.style.left = Math.round(x - seatW / 2) + 'px';
      el.style.top  = Math.round(y - seatH / 2) + 'px';
    }
  }

  /* ------------------------------ Rendering ------------------------------------ */
  function showCenter(msg, ms=1200){
    if (!centerEl) return;
    centerEl.textContent = msg;
    centerEl.style.display = 'block';
    if (ms>0){ setTimeout(()=>{ centerEl.style.display='none'; }, ms); }
  }

  function clearBoard(){
    boardEl.innerHTML = '';
    burnsEl.innerHTML = '';
  }

  function renderBoard(){
    if (!state){ clearBoard(); return; }
    const cards = Array.isArray(state.community) ? state.community.slice(0,5) : [];
    boardEl.innerHTML = '';

    // Flop/turn/river laid out left→right
    cards.forEach((code, i) => {
      const c = makeCardEl(code, false, true);
      c.dataset.slot = String(i);
      boardEl.appendChild(c);
    });

    // Burn pile on left side, face-down backs only
    const nBurns = burnsForStage(state.stage||'');
    burnsEl.innerHTML = '';
    for (let i=0; i<nBurns; i++){
      const back = makeCardEl(null, false, false);
      back.classList.add('card--burn');
      burnsEl.appendChild(back);
    }
  }

  function drawSeatCards(seatId){
    const el = seatEls[seatId];
    if (!el) return;

    let row = el.querySelector('.cards');
    if (!row){
      row = document.createElement('div');
      row.className = 'cards';
      el.insertBefore(row, el.firstChild.nextSibling); // under name
    }
    row.innerHTML = '';

    // My seat → show real hole if dealt
    if (seatId === mySeat && myHole && myHole.length){
      row.appendChild(makeCardEl(myHole[0], true, true));
      row.appendChild(makeCardEl(myHole[1], true, true));
      return;
    }

    // Opponents in-hand → show backs; folded/empty → nothing
    if (oppHasHole.has(seatId)){
      row.appendChild(makeCardEl(null, true, false));
      row.appendChild(makeCardEl(null, true, false));
    }
  }

  function renderTableModel(t){
    if (!t || t.id !== tableId) return;

    // seats + buttons
    mySeat = -1;
    const seats = Array.isArray(t.seats) ? t.seats : [];

    seatEls.forEach((el, i)=>{
      const s = seats[i];
      el.innerHTML = '';

      // name / addr
      const head = document.createElement('div');
      head.className = 'addr';
      head.textContent = s ? short(s.addr||('Seat '+i)) : 'Empty';
      el.appendChild(head);

      // cards row (created on demand in drawSeatCards)
      const cardsRow = document.createElement('div');
      cardsRow.className = 'cards';
      el.appendChild(cardsRow);

      // buttons
      const btns = document.createElement('div');
      btns.className = 'btns';

      if (s){
        // me
        if (myAddr && s.addr && lc(s.addr)===lc(myAddr)){
          mySeat = i;

          const bLeave = document.createElement('button');
          bLeave.textContent = 'Leave';
          bLeave.onclick = ()=> socket?.emit('seat',{ index:-1 });
          btns.appendChild(bLeave);

          const bReady = document.createElement('button');
          bReady.textContent = s.ready ? 'Unready' : 'Ready';
          bReady.style.marginLeft='6px';
          bReady.onclick = ()=> socket?.emit('ready', { ready: !s.ready });
          btns.appendChild(bReady);
        }
      } else {
        // empty seat
        const bSit = document.createElement('button');
        bSit.textContent = 'Sit';
        if (!myAddr){ bSit.disabled = true; bSit.title = 'Connect wallet'; }
        bSit.onclick = ()=> { if (!myAddr) return; socket?.emit('seat', { index:i }); };
        btns.appendChild(bSit);
      }

      el.appendChild(btns);
    });

    // After rebuilding, lay out and re-draw any known cards
    layoutSeats();
    renderBoard();
    refreshSeatCardBacksFromState(); // opp backs
    if (mySeat >= 0) drawSeatCards(mySeat);
  }

  function refreshSeatCardBacksFromState(){
    oppHasHole.clear();
    if (!state || !Array.isArray(state.actors)) return;

    state.actors.forEach(a => {
      if (!a) return;
      if (a.seatId === mySeat) return;
      if (a.folded) return;
      oppHasHole.add(a.seatId);
    });

    // Update all seats based on that set
    seatEls.forEach((_, i) => drawSeatCards(i));
  }

  function updateActionBar(){
    if (mySeat < 0 || !state || !Array.isArray(state.actors)) {
      if (actionBarEl){ actionBarEl.remove(); actionBarEl = null; }
      return;
    }
    const idx = state.turnIndex|0;
    const actor = state.actors[idx];
    if (!actor || actor.seatId !== mySeat || actor.folded){
      if (actionBarEl){ actionBarEl.remove(); actionBarEl = null; }
      return;
    }

    const need = Math.max(0, Number(state.toCall||0) - Number(actor.contrib||0));
    const under = seatEls[mySeat];

    if (!actionBarEl){
      actionBarEl = document.createElement('div');
      actionBarEl.className = 'action-bar';
      canvas.appendChild(actionBarEl);
    }
    // position under my seat panel
    const r = under.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    actionBarEl.style.left = (r.left - c.left + r.width/2) + 'px';
    actionBarEl.style.top  = (r.top  - c.top  + r.height + 10) + 'px';

    actionBarEl.innerHTML = '';
    const bFold = document.createElement('button');
    bFold.textContent = 'Fold';
    bFold.onclick = ()=> socket?.emit('poker:act', { action:'fold' });

    const bCheckCall = document.createElement('button');
    bCheckCall.textContent = (need > 0) ? `Call ${need}` : 'Check';
    bCheckCall.onclick = ()=> socket?.emit('poker:act', { action: (need>0?'call':'check') });

    actionBarEl.appendChild(bFold);
    actionBarEl.appendChild(bCheckCall);
  }

  /* ------------------------------ Socket wiring ------------------------------- */
  function initSocket(){
    try{
      socket = io(window.location.origin, {
        path:'/poker.io/',
        transports:['websocket','polling'],
        upgrade:true,
        reconnection:true,
        reconnectionAttempts:10,
        reconnectionDelay:800,
        forceNew:true
      });
    }catch(e){ showCenter('Socket unavailable', 1800); return; }

    socket.on('connect', ()=>{
      try{
        if (myAddr) socket.emit('identify', { addr: myAddr });
        socket.emit('join_table', { table: tableId });
        socket.emit('lobby:get');
      }catch{}
    });
    socket.on('disconnect', ()=> {
      showCenter('Disconnected', 1000);
      if (actionBarEl){ actionBarEl.remove(); actionBarEl = null; }
    });

    // Model/table updates
    socket.on('table:update', (t)=> renderTableModel(t));
    socket.on('table:state',  (t)=> renderTableModel(t)); // back-compat

    // Hand state (public)
    socket.on('poker:state', (m)=>{
      state = m || null;
      renderBoard();
      refreshSeatCardBacksFromState();
      updateActionBar();

      if (typeof m?.pot !== 'undefined'){
        showCenter(`Stage: ${m.stage||'-'} • Pot: ${m.pot}`, 700);
      }

      // If my seat folded (server-side), clear my local hole
      if (state && Array.isArray(state.actors)){
        const me = state.actors.find(a => a && a.seatId === mySeat);
        if (me && me.folded){
          myHole = [];
          drawSeatCards(mySeat);
        }
      }
    });

    // My private hole cards
    socket.on('poker:hole', (payload)=>{
      const arr = Array.isArray(payload?.cards) ? payload.cards.slice(0,2) : [];
      myHole = arr;
      if (mySeat >= 0) drawSeatCards(mySeat);
    });

    // Clear my private hole on server request
    socket.on('poker:hole_clear', ()=>{
      myHole = [];
      if (mySeat >= 0) drawSeatCards(mySeat);
    });

    // Showdown / winners
    socket.on('poker:hand', (h)=>{
      try{
        const winners = Array.isArray(h?.winners) ? h.winners : [];
        if (winners.length){
          const names = winners.map(w=> short(w.addr)).join(', ');
          showCenter(`Hand complete — Winner: ${names}`, 1800);

          // Optional: highlight best 5 for winners if we can map them
          const usedCommunity = winners[0]?.usedCommunity || []; // [0..4]
          // highlight board cards
          Array.from(boardEl.children).forEach((el, i)=>{
            if (usedCommunity.includes(i)) el.classList.add('card--win');
          });
          // If I’m a winner and usedHole is provided, highlight my used holes
          if (mySeat >= 0 && winners.some(w => lc(w.addr)===lc(myAddr))){
            const myW = winners.find(w => lc(w.addr)===lc(myAddr));
            const row = seatEls[mySeat].querySelector('.cards');
            if (row && Array.isArray(myW?.usedHole)){
              Array.from(row.children).forEach((el, i)=>{
                if (myW.usedHole.includes(i)) el.classList.add('card--win');
              });
            }
          }
        } else {
          showCenter('Hand complete', 1200);
        }
      }catch{}

      // Clear center highlights after a bit; server will send next state
      setTimeout(()=> {
        Array.from(boardEl.children).forEach(el=> el.classList.remove('card--win'));
        if (actionBarEl){ actionBarEl.remove(); actionBarEl = null; }
      }, 1800);
    });

    // Explicit table reset
    socket.on('table:reset', ()=>{
      myHole = [];
      clearBoard();
      seatEls.forEach((_, i)=> drawSeatCards(i));
      if (actionBarEl){ actionBarEl.remove(); actionBarEl = null; }
      showCenter('Table reset', 800);
    });
  }

  /* ---------------------- Wallet sync from navbar/tavern ----------------------- */
  function setKnownAddress(addr){
    myAddr = lc(addr||'');
    // save so page reloads keep it
    try{
      if (myAddr){
        localStorage.setItem('walletConnected','true');
        sessionStorage.setItem('walletConnected','true');
        localStorage.setItem('walletAddress', myAddr);
        sessionStorage.setItem('walletAddress', myAddr);
      }
    }catch{}
    if (socket?.connected && myAddr){
      try{ socket.emit('identify', { addr: myAddr }); }catch{}
    }
  }
  window.addEventListener('wallet:connected', (e)=>{
    const a = e?.detail?.address || e?.detail?.addr;
    if (a) setKnownAddress(a);
  });

  /* ------------------------------- Bootstrap ----------------------------------- */
  // Reflow seats on viewport changes (safe no-op if already correct)
  window.addEventListener('resize', () => requestAnimationFrame(layoutSeats));

  // Preload sprite to avoid first-deal flash
  try{ (new Image()).src = SPRITE_URL; }catch(e){}
  initSocket();
  if (myAddr) setKnownAddress(myAddr);
})();
