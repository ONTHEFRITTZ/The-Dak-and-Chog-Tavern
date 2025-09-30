(function () {
  /* ===========================
   * Utilities & globals
   * =========================== */
  const q  = (s, r=document) => r.querySelector(s);
  const qa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const short = (v)=> v && v.length>10 ? (v.slice(0,6)+'…'+v.slice(-4)) : (v||'');
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

  // Read table id from URL (?table=...)
  const qp = new URL(location.href).searchParams;
  const tableId = qp.get('table') || 'poker-nl-1';

  // Mode (onchain vs f2p) – used to keep DevBot hidden on onchain tables
  const htmlMode = (document.documentElement.getAttribute('data-table-mode')||'f2p').toLowerCase();

  // Basic DOM anchors from table.html
  const tableCanvas = q('.table-canvas');
  const centerBanner = q('#poker-center');

  if (!tableCanvas) {
    console.error('[poker/table] .table-canvas missing'); 
    return;
  }

  /* ===========================
   * Socket wiring
   * =========================== */
  let socket;
  let myAddrLower = null;

  async function getSocket() {
    // Prefer socket created by tavern.js if it exists
    const candidates = [
      window.__socket,
      window.socket,
      window.Tavern && window.Tavern.socket
    ].filter(Boolean);
    for (const s of candidates) {
      if (typeof s?.on === 'function' && typeof s?.emit === 'function') return s;
    }
    // Else create a standalone one
    const ioLib = window.io;
    if (!ioLib) {
      throw new Error('Socket.IO (window.io) not found. Make sure the CDN script is loaded before table.js');
    }
    const s = ioLib({ path: '/socket.io/' });
    s.__standalone = true;
    return s;
  }

  function myAddressInit() {
    try {
      const addr = window.Tavern?.wallet?.address;
      if (addr) myAddrLower = String(addr).toLowerCase();
    } catch {}
  }

  /* ===========================
   * Seat layout (absolute positions)
   * =========================== */
  const seats = qa('.seat'); // 8 seats already in DOM
  seats.forEach((el, i) => { el.style.position='absolute'; el.style.transform='translate(-50%, -50%)'; });
  function placeSeats() {
    const r = tableCanvas.getBoundingClientRect();
    const cx = r.width/2;
    const cy = r.height*0.62;           // slightly below center looks nicer on oval felt
    const rx = r.width * 0.41;          // horizontal radius
    const ry = r.height * 0.36;         // vertical radius
    const baseAngle = -Math.PI/2;       // seat 0 at top

    seats.forEach((el, i) => {
      const theta = baseAngle + (i * (2*Math.PI / 8));
      const x = cx + rx * Math.cos(theta);
      const y = cy + ry * Math.sin(theta);
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
    });
  }
  placeSeats();
  window.addEventListener('resize', placeSeats);

  /* ===========================
   * Minimal seat UI
   * =========================== */
  const seatState = Array.from({length:8}, ()=> null); // mirror of table.seats public view
  function renderSeat(idx, data) {
    const el = seats[idx];
    if (!el) return;
    el.innerHTML = ''; // reset

    const wrap = document.createElement('div');
    wrap.style.display='flex';
    wrap.style.flexDirection='column';
    wrap.style.alignItems='center';
    wrap.style.justifyContent='center';
    wrap.style.gap='6px';
    wrap.style.minWidth='120px';

    if (!data) {
      // Empty seat → show Sit button
      const btn = document.createElement('button');
      btn.className = 'btn-sit';
      btn.textContent = 'Sit';
      btn.onclick = () => {
        try { socket.emit('seat', { index: idx }); } catch {}
      };
      wrap.appendChild(btn);
    } else {
      // Occupied
      const label = document.createElement('div');
      label.style.fontWeight='700';
      label.textContent = data.addr ? short(String(data.addr)) : 'Player';
      wrap.appendChild(label);

      // Chips (F2P sim tables expose .chips; onchain may not)
      if (Number.isFinite(data.chips)) {
        const chips = document.createElement('div');
        chips.className='muted';
        chips.textContent = `Chips: ${Math.max(0, Number(data.chips||0))}`;
        wrap.appendChild(chips);
      }

      // Ready marker
      const ready = document.createElement('div');
      ready.className='muted';
      ready.textContent = data.ready ? '✔ Ready' : 'Not ready';
      wrap.appendChild(ready);

      // If it's me, show Stand + Ready toggle
      if (myAddrLower && data.addr && data.addr.toLowerCase() === myAddrLower) {
        const row = document.createElement('div');
        row.style.display='flex';
        row.style.gap='6px';

        const stand = document.createElement('button');
        stand.textContent = 'Stand';
        stand.onclick = () => { try { socket.emit('seat', { index: -1 }); } catch {} };

        const toggleReady = document.createElement('button');
        toggleReady.textContent = data.ready ? 'Unready' : 'Ready';
        toggleReady.onclick = () => {
          try { socket.emit('ready', { ready: !data.ready }); } catch {}
        };

        row.append(stand, toggleReady);
        wrap.appendChild(row);
      }
    }

    el.appendChild(wrap);
  }

  function renderAllSeats(tablePublic) {
    for (let i=0;i<seats.length;i++){
      seatState[i] = (tablePublic?.seats||[])[i] || null;
      renderSeat(i, seatState[i]);
    }
  }

  /* ===========================
   * DevBot visibility policy (F2P only)
   * =========================== */
  function updateDevBotVisibility(tablePublic) {
    const btn = q('#wi-devbot');
    if (!btn) return;
    // Never show on onchain tables or when mode is onchain
    const isSim = !!tablePublic?.simulated;
    if (htmlMode === 'onchain' || !isSim) {
      btn.style.display = 'none';
    } else {
      // F2P table → show (but let your previous policy hide if >1 human etc.)
      btn.style.display = '';
    }
  }

  /* ===========================
   * CHOG deck overlay + animations
   * =========================== */
  // Create layers
  const cardLayer = document.createElement('div'); cardLayer.className='pkr-layer';
  const boardLayer = document.createElement('div'); boardLayer.className='pkr-board';
  tableCanvas.append(cardLayer, boardLayer);

  // Board slots (empty rails)
  const boardHolders = Array.from({length:5}, ()=>{
    const n = document.createElement('div'); n.className='pkr-board-slot'; boardLayer.appendChild(n); return n;
  });

  // Geometry used by cards (local to table canvas)
  let GEO = null;
  function computeGeom() {
    const r = tableCanvas.getBoundingClientRect();
    const cx = r.width/2;
    const cy = r.height*0.46;

    const deck = { x: cx + Math.min(40, r.width*0.03), y: cy + Math.min(16, r.height*0.02) };
    const burn = { x: cx - Math.min(36, r.width*0.03), y: cy - Math.min(24, r.height*0.04) };

    const spacing = Math.min(r.width, 820) / 7.2;
    const startX = cx - spacing*2;
    const by = r.height * 0.30;
    const board = Array.from({length:5}, (_,i)=>({ x: startX + spacing*i, y: by }));

    const seatCenters = seats.map(el=>{
      const b = el.getBoundingClientRect();
      return { x:(b.left-r.left)+b.width/2, y:(b.top-r.top)+b.height/2 };
    });

    GEO = { rect:r, deck, burn, board, seatCenters, cx, cy };
  }
  computeGeom();

  function positionBoardHolders(){
    if (!GEO) computeGeom();
    boardHolders.forEach((h,i)=>{
      const p = GEO.board[i]; if(!p) return;
      h.style.left = p.x + 'px';
      h.style.top  = p.y + 'px';
    });
  }
  positionBoardHolders();

  window.addEventListener('resize', ()=>{
    placeSeats();
    computeGeom();
    positionBoardHolders();
    // reposition any live cards to their logical anchors
    reanchorLiveCards();
  });

  // Mapping codes to CHOG images
  const IMG_BASE = '/assets/images/chog_cards/';
  const RANK = { A:'ace', K:'king', Q:'queen', J:'jack', T:'ten', '9':'nine','8':'eight','7':'seven','6':'six','5':'five','4':'four','3':'three','2':'two' };
  const SUIT = { s:'spades', h:'hearts', d:'diamonds', c:'clubs' };
  function codeToUrl(code){
    if (!code || code.length<2) return IMG_BASE+'dak-and-chog-cardback.png';
    const r = RANK[code[0].toUpperCase()] || 'ace';
    const s = SUIT[code[1].toLowerCase()] || 'spades';
    return `${IMG_BASE}chog-${r}-of-${s}.png`;
  }

  function makeCard(code, faceDown){
    const el = document.createElement('div');
    el.className = 'pkr-card' + (faceDown ? ' face-down' : '');
    el.dataset.code = code || '';
    if (!faceDown) el.style.backgroundImage = `url("${codeToUrl(code)}")`;
    return el;
  }
  function setFaceUp(el, code){
    el.classList.remove('face-down');
    el.dataset.code = code || '';
    el.style.backgroundImage = `url("${codeToUrl(code)}")`;
  }

  function to(el, x,y, t=0){
    if (t>0) el.style.transitionDuration = (t|0)+'ms';
    el.style.left = x+'px'; el.style.top = y+'px';
  }

  function seatCenter(i){ 
    if (!GEO?.seatCenters[i]) computeGeom();
    return GEO.seatCenters[i] || GEO.deck;
  }

  // Keep track of seat cards and board cards
  const seatCards = new Map(); // seatIdx -> [el, el]
  let lastBoardLen = 0;
  let dealt = false;

  function clearSeatCards(){
    for (const arr of seatCards.values()) arr.forEach(n => n.remove());
    seatCards.clear();
  }
  function clearBoardCards(){
    qa('.pkr-card.board', cardLayer).forEach(n => n.remove());
  }

  function reanchorLiveCards(){
    // Move seat cards to seat centers after resize
    for (const [seatIdx, arr] of seatCards.entries()){
      const p = seatCenter(seatIdx);
      arr.forEach((el,k)=>{
        to(el, p.x + (k? (el.offsetWidth*0.55) : -(el.offsetWidth*0.55)), p.y);
      });
    }
    // Reanchor board cards to board slots
    qa('.pkr-card.board', cardLayer).forEach((el, i)=>{
      const idx = Number(el.dataset.boardIndex||i);
      const p = GEO.board[idx]; if (p) to(el, p.x, p.y);
    });
  }

  // Turn highlight on seats
  function markTurn(seatIdx){
    qa('.seat').forEach(n=>n.classList.remove('pkr-turn'));
    if (Number.isInteger(seatIdx) && seatIdx>=0) {
      const s = seats[seatIdx]; if (s) s.classList.add('pkr-turn');
    }
  }
  function clearTurn(){ qa('.seat').forEach(n=>n.classList.remove('pkr-turn')); }

  // Deal animation
  async function animateDeal(st){
    if (dealt) return;
    dealt = true;
    clearSeatCards(); clearBoardCards(); positionBoardHolders();
    lastBoardLen = 0;

    const order = (st.actors||[]).map(a => a.seatId).filter(Number.isInteger);
    for (let round=0; round<2; round++){
      for (const seatIdx of order){
        const p = seatCenter(seatIdx);
        const card = makeCard(null, true);
        card.style.opacity='0';
        cardLayer.appendChild(card);
        to(card, GEO.deck.x, GEO.deck.y);
        await sleep(10);
        card.style.opacity='1';
        to(card, p.x, p.y, 340);
        await sleep(120);

        // offset pair visually
        if (!seatCards.has(seatIdx)) seatCards.set(seatIdx, []);
        const arr = seatCards.get(seatIdx);
        arr.push(card);
        // space the two cards left/right of seat center
        const leftRight = arr.length===1 ? -1 : +1;
        to(card, p.x + leftRight*(card.offsetWidth*0.55), p.y, 80);
      }
      await sleep(120);
    }
  }

  async function animateBurn(){
    const c = makeCard(null,true);
    c.style.opacity='0'; cardLayer.appendChild(c);
    to(c, GEO.deck.x, GEO.deck.y);
    await sleep(10);
    c.style.opacity='1';
    to(c, GEO.burn.x, GEO.burn.y, 200);
    await sleep(220);
    c.style.opacity='0';
    await sleep(100);
    c.remove();
  }

  async function animateFlop(codes){
    for (let i=0;i<3;i++){
      const el = makeCard(codes[i], true);
      el.classList.add('board'); el.dataset.boardIndex=String(i);
      el.style.opacity='0'; cardLayer.appendChild(el);
      to(el, GEO.deck.x, GEO.deck.y);
      await sleep(10);
      el.style.opacity='1';
      const p = GEO.board[i];
      to(el, p.x, p.y, 300);
      await sleep(320);
      el.style.transform += ' scaleX(0.01)';
      await sleep(90);
      setFaceUp(el, codes[i]);
      el.style.transform = el.style.transform.replace(' scaleX(0.01)','');
      await sleep(40);
    }
    lastBoardLen = 3;
  }

  async function animateTurnRiver(code, idx){
    const el = makeCard(code, true);
    el.classList.add('board'); el.dataset.boardIndex=String(idx);
    el.style.opacity='0'; cardLayer.appendChild(el);
    to(el, GEO.deck.x, GEO.deck.y);
    await sleep(10);
    el.style.opacity='1';
    const p = GEO.board[idx];
    to(el, p.x, p.y, 300);
    await sleep(320);
    el.style.transform += ' scaleX(0.01)';
    await sleep(90);
    setFaceUp(el, code);
    el.style.transform = el.style.transform.replace(' scaleX(0.01)','');
    await sleep(40);
    lastBoardLen = idx+1;
  }

  function showMyHole(cards){
    if (!Array.isArray(cards) || cards.length<2) return;
    // find my seat
    let mySeat = -1;
    for (let i=0;i<seatState.length;i++){
      const s = seatState[i];
      if (s?.addr && myAddrLower && s.addr.toLowerCase()===myAddrLower){ mySeat=i; break; }
    }
    if (mySeat<0) return;
    const arr = seatCards.get(mySeat) || [];
    for (let i=0;i<Math.min(2,arr.length);i++){
      setFaceUp(arr[i], cards[i]);
      arr[i].classList.remove('dim');
    }
  }

  /* ===========================
   * Action bar (fold/check/call)
   * =========================== */
  const actionBar = document.createElement('div');
  actionBar.id = 'poker-actions';
  Object.assign(actionBar.style, {
    position:'absolute', left:'50%', bottom:'18px', transform:'translateX(-50%)',
    display:'none', gap:'8px', zIndex:5
  });
  const btnFold = document.createElement('button'); btnFold.textContent='Fold';
  const btnCheck = document.createElement('button'); btnCheck.textContent='Check';
  const btnCall = document.createElement('button'); btnCall.textContent='Call';
  actionBar.append(btnFold, btnCheck, btnCall);
  tableCanvas.appendChild(actionBar);

  btnFold.onclick = ()=> { try{ socket.emit('poker:act', { action:'fold' }); hideActions(); }catch{} };
  btnCheck.onclick = ()=> { try{ socket.emit('poker:act', { action:'check' }); hideActions(); }catch{} };
  btnCall.onclick = ()=> { try{ socket.emit('poker:act', { action:'call' }); hideActions(); }catch{} };

  function showActions(needToCall){
    btnCheck.style.display = (needToCall>0) ? 'none' : '';
    btnCall.style.display  = (needToCall>0) ? '' : 'none';
    actionBar.style.display='';
  }
  function hideActions(){ actionBar.style.display='none'; }

  /* ===========================
   * Socket event handlers
   * =========================== */
  function wireSocketEvents() {
    socket.on('connect', ()=>{
      socket.emit('identify', { addr: myAddrLower||'-' });
      socket.emit('join_table', { table: tableId });
    });

    socket.on('table:update', (t)=>{
      renderAllSeats(t);
      updateDevBotVisibility(t);
    });

    socket.on('table:started', (t)=>{
      centerBanner.style.display='block';
      centerBanner.textContent = 'New hand starting…';
      setTimeout(()=>{ centerBanner.style.display='none'; }, 1200);
    });

    socket.on('poker:state', async (st)=>{
      // Highlight turn
      const turnSeat = st.turnSeatId ?? st.actors?.[st.turnIndex||0]?.seatId ?? -1;
      markTurn(turnSeat);

      // Animate deal + streets
      if (st.stage === 'preflop' && !dealt) { await animateDeal(st); }

      const board = st.community || [];
      if (st.stage==='flop' && board.length>=3 && lastBoardLen<3){
        await animateBurn(); await animateFlop(board.slice(0,3));
      } else if (st.stage==='turn' && board.length>=4 && lastBoardLen<4){
        await animateBurn(); await animateTurnRiver(board[3], 3);
      } else if (st.stage==='river' && board.length>=5 && lastBoardLen<5){
        await animateBurn(); await animateTurnRiver(board[4], 4);
      }

      // Actions for me
      try {
        hideActions();
        if (!myAddrLower || !Array.isArray(st.actors)) return;

        const me = st.actors.find(a => a?.addr && a.addr.toLowerCase()===myAddrLower);
        const isMyTurn = (st.actors?.[st.turnIndex||0]?.addr||'').toLowerCase() === myAddrLower;
        if (me && isMyTurn && !me.folded) {
          const need = Math.max(0, Number(st.toCall||0) - Number(me.contrib||0));
          showActions(need);
        }
      } catch {}
    });

    socket.on('poker:hole', (payload)=>{
      const cards = Array.isArray(payload) ? payload : (payload?.cards||[]);
      showMyHole(cards);
    });

    socket.on('poker:hand', (h)=>{
      clearTurn(); hideActions();

      // Expose any showdown cards
      if (h?.exposures) {
        for (const ex of h.exposures) {
          // find seat index for this addr
          let seatIdx = -1;
          for (let i=0;i<seatState.length;i++){
            const s = seatState[i];
            if (s?.addr && ex.addr && s.addr.toLowerCase()===ex.addr.toLowerCase()) { seatIdx=i; break; }
          }
          if (seatIdx>=0) {
            const arr = seatCards.get(seatIdx) || [];
            for (let i=0;i<Math.min(2,arr.length);i++){
              setFaceUp(arr[i], ex.cards[i]);
            }
          }
        }
      }

      // Center banner: winners
      try {
        const winners = (h?.winners||[]).map(w => short(w.addr)).join(', ');
        if (winners) {
          centerBanner.style.display='block';
          centerBanner.textContent = `Pot ${Number(h.pot||0)} – Winner: ${winners}`;
        }
      } catch {}

      setTimeout(()=>{
        centerBanner.style.display='none';
        dealt=false; lastBoardLen=0;
        clearSeatCards(); clearBoardCards(); positionBoardHolders();
      }, 2500);
    });

    // Rebuy for sim tables (when chips == 0)
    const rebuyBtn = document.createElement('button');
    rebuyBtn.textContent = 'Rebuy 100';
    Object.assign(rebuyBtn.style, {
      position:'absolute', right:'16px', bottom:'16px', zIndex:5, display:'none'
    });
    rebuyBtn.onclick = ()=> { try { socket.emit('sim:rebuy'); } catch {} };
    tableCanvas.appendChild(rebuyBtn);

    // Toggle rebuy visibility on each table update
    socket.on('table:update', (t)=>{
      try {
        if (!t?.simulated) { rebuyBtn.style.display='none'; return; }
        let me = null;
        (t.seats||[]).forEach(s=>{ if (s?.addr && myAddrLower && s.addr.toLowerCase()===myAddrLower) me=s; });
        if (me && Number(me.chips||0)<=0) rebuyBtn.style.display='';
        else rebuyBtn.style.display='none';
      } catch {}
    });
  }

  /* ===========================
   * Boot
   * =========================== */
  (async function boot(){
    myAddressInit();
    socket = await getSocket();
    wireSocketEvents();

    // Hide DevBot immediately if onchain (prevents flicker)
    try {
      const devbot = q('#wi-devbot');
      if (devbot && htmlMode==='onchain') devbot.style.display='none';
    } catch {}

    // If our socket is standalone, join once connected
    if (socket.__standalone) {
      socket.on('connect', ()=>{
        socket.emit('identify', { addr: myAddrLower||'-' });
        socket.emit('join_table', { table: tableId });
      });
    }
  })().catch(console.error);

})();
