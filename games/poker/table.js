/* Dak & Chog — Poker Table (seat layout + CHOG cards + animations)
   Drop this in: /games/poker/table.js
*/
(function () {
  /* ---------- helpers ---------- */
  const q  = (s, r=document) => r.querySelector(s);
  const qa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
  const short = (v)=> v && v.length>10 ? (v.slice(0,6)+'…'+v.slice(-4)) : (v||'');

  const params  = new URL(location.href).searchParams;
  const tableId = params.get('table') || 'poker-nl-1';
  const htmlMode = (document.documentElement.getAttribute('data-table-mode')||'f2p').toLowerCase();

  const tableCanvas  = q('.table-canvas');
  const centerBanner = q('#poker-center');
  const devbotBtn    = q('#wi-devbot');

  if (!tableCanvas) { console.error('[poker/table] .table-canvas missing'); return; }

  // Ensure container is a positioning context
  const cs = getComputedStyle(tableCanvas);
  if (cs.position === 'static') tableCanvas.style.position = 'relative';

  /* ---------- style (cards/board/turn) ---------- */
  (function injectCSS(){
    const style = document.createElement('style');
    style.textContent = `
      .seat{ position:absolute; transform:translate(-50%,-50%); z-index:2; }
      .seat .muted{ opacity:.85; font-size:12px; }
      .seat .btn-sit{ padding:6px 10px; border-radius:10px; }
      .seat.pkr-turn::after{
        content:""; position:absolute; left:50%; top:50%;
        width:84px; height:84px; transform:translate(-50%,-50%);
        border:2px solid rgba(255,255,255,0.5); border-radius:50%; pointer-events:none;
        box-shadow:0 0 16px rgba(255,255,255,0.45);
      }
      .pkr-layer{ position:absolute; inset:0; z-index:3; pointer-events:none; }
      .pkr-card{
        position:absolute; width:88px; height:126px; border-radius:8px;
        background-size:cover; background-position:center; box-shadow:0 10px 25px rgba(0,0,0,0.45);
        transition: left .28s ease, top .28s ease, transform .18s ease, opacity .18s ease;
        transform: translate(-50%, -50%);
      }
      .pkr-card.face-down{
        background-image: url("/assets/images/chog_cards/dak-and-chog-cardback.png");
      }
      #poker-actions{ position:absolute; left:50%; bottom:18px; transform:translateX(-50%); display:none; z-index:4; }
      #poker-actions button{ margin:0 6px; padding:8px 12px; border-radius:10px; font-weight:700; }
    `;
    document.head.appendChild(style);
  })();

  /* ---------- seat layout (fixed percentages) ---------- */
  // Eight-seat oval mapped as % positions (tuned for poker-table.png)
  const SEAT_PCT = [
    { x:50, y:15 }, // 0 top
    { x:77, y:22 }, // 1 top-right
    { x:89, y:44 }, // 2 right
    { x:77, y:68 }, // 3 bottom-right
    { x:50, y:80 }, // 4 bottom
    { x:23, y:68 }, // 5 bottom-left
    { x:11, y:44 }, // 6 left
    { x:23, y:22 }, // 7 top-left
  ];
  const seats = qa('.seat');
  function placeSeats() {
    const rect = tableCanvas.getBoundingClientRect();
    seats.forEach((el, i) => {
      const p = SEAT_PCT[i] || SEAT_PCT[0];
      el.style.left = (rect.width * (p.x/100)) + 'px';
      el.style.top  = (rect.height * (p.y/100)) + 'px';
    });
  }
  placeSeats();

  // react to true size changes too (when images/css settle)
  const ro = new ResizeObserver(()=>{ placeSeats(); recomputeGeom(); reanchorLiveCards(); });
  ro.observe(tableCanvas);
  window.addEventListener('resize', ()=>{ placeSeats(); recomputeGeom(); reanchorLiveCards(); });

  /* ---------- wallet / my address ---------- */
  let myAddrLower = null;
  (function initAddr(){
    try {
      const addr = window.Tavern?.wallet?.address || q('#wi-address')?.textContent || '';
      if (addr && addr.includes('0x')) myAddrLower = addr.trim().toLowerCase();
    } catch {}
  })();

  /* ---------- socket ---------- */
  let socket = null;
  async function getSocket() {
    const reuse = [window.__socket, window.socket, window.Tavern?.socket].find(Boolean);
    if (reuse && typeof reuse.on==='function') return reuse;
    if (!window.io) throw new Error('Socket.IO not available; ensure the CDN script is loaded before table.js');
    const s = window.io({ path:'/socket.io/' }); s.__standalone = true; return s;
  }

  /* ---------- public table → UI ---------- */
  const seatState = Array.from({length:8}, ()=> null);
  function renderSeat(idx, data){
    const root = seats[idx]; if (!root) return;
    root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.display='flex'; wrap.style.flexDirection='column';
    wrap.style.alignItems='center'; wrap.style.gap='6px'; wrap.style.minWidth='120px';

    if (!data){
      const btn = document.createElement('button');
      btn.className='btn-sit'; btn.textContent='Sit';
      btn.onclick = ()=> { try{ socket.emit('seat',{index:idx}); }catch{} };
      wrap.appendChild(btn);
    } else {
      const name = document.createElement('div');
      name.style.fontWeight='700';
      name.textContent = data.addr ? short(data.addr) : 'Player';
      wrap.appendChild(name);

      if (Number.isFinite(data.chips)){
        const c = document.createElement('div'); c.className='muted';
        c.textContent = `Chips: ${Math.max(0, Number(data.chips||0))}`;
        wrap.appendChild(c);
      }

      const r = document.createElement('div'); r.className='muted';
      r.textContent = data.ready ? '✔ Ready' : 'Not ready';
      wrap.appendChild(r);

      if (myAddrLower && data.addr && data.addr.toLowerCase()===myAddrLower){
        const row = document.createElement('div'); row.style.display='flex'; row.style.gap='6px';
        const stand = document.createElement('button'); stand.textContent='Stand';
        stand.onclick = ()=>{ try{ socket.emit('seat',{index:-1}); }catch{} };
        const toggle = document.createElement('button'); toggle.textContent = data.ready?'Unready':'Ready';
        toggle.onclick = ()=>{ try{ socket.emit('ready',{ready:!data.ready}); }catch{} };
        row.append(stand, toggle); wrap.appendChild(row);
      }
    }
    root.appendChild(wrap);
  }
  function renderAllSeats(pub){
    for (let i=0;i<seats.length;i++){
      seatState[i] = (pub?.seats||[])[i] || null;
      renderSeat(i, seatState[i]);
    }
  }

  /* ---------- DevBot visibility (never on onchain) ---------- */
  function updateDevBotVisibility(pub){
    if (!devbotBtn) return;
    const isSim = !!pub?.simulated;
    if (htmlMode==='onchain' || !isSim) devbotBtn.style.display='none';
    else devbotBtn.style.display='';
  }
  // Hide immediately to prevent flicker
  if (devbotBtn && htmlMode==='onchain') devbotBtn.style.display='none';

  /* ---------- geometry for animations ---------- */
  const IMG_BASE = '/assets/images/chog_cards/';
  const RANK = { A:'ace', K:'king', Q:'queen', J:'jack', T:'ten','9':'nine','8':'eight','7':'seven','6':'six','5':'five','4':'four','3':'three','2':'two' };
  const SUIT = { s:'spades', h:'hearts', d:'diamonds', c:'clubs' };
  const codeToUrl = (code)=> (!code||code.length<2) ? (IMG_BASE+'dak-and-chog-cardback.png')
    : `${IMG_BASE}chog-${RANK[code[0].toUpperCase()]||'ace'}-of-${SUIT[code[1].toLowerCase()]||'spades'}.png`;

  const cardLayer = document.createElement('div'); cardLayer.className='pkr-layer';
  tableCanvas.appendChild(cardLayer);

  // Board positions are computed, but there are NO visible “slots”.
  let GEO = { rect:null, deck:null, burn:null, board:[], seats:[] };
  function recomputeGeom(){
    const r = tableCanvas.getBoundingClientRect();
    const cx = r.width/2, cy=r.height/2;

    // deck & burn points near center
    const deck = { x: cx + Math.min(40, r.width*0.03), y: cy + Math.min(10, r.height*0.02) };
    const burn = { x: cx - Math.min(44, r.width*0.035), y: cy - Math.min(22, r.height*0.035) };

    // board centered along upper third
    const topPct = 38; // %
    const spacingPct = 8.7; // % of width between cards
    const startX = 50 - (spacingPct*2); // 5 cards → offset two left of center
    const board = Array.from({length:5}, (_,i)=>({
      x: r.width * ((startX + i*spacingPct)/100),
      y: r.height * (topPct/100)
    }));

    // seat centers from our fixed % map (same as layout)
    const seatsPx = SEAT_PCT.map(p => ({ x: r.width*(p.x/100), y: r.height*(p.y/100) }));

    GEO = { rect:r, deck, burn, board, seats:seatsPx };
  }
  recomputeGeom();

  const seatCards = new Map(); // seatIdx -> [el, el]
  let lastBoardCount = 0;
  let dealt = false;

  function makeCard(code, faceDown){
    const el = document.createElement('div');
    el.className = 'pkr-card' + (faceDown?' face-down':'');
    el.style.opacity='1';
    if (!faceDown) el.style.backgroundImage = `url("${codeToUrl(code)}")`;
    el.dataset.code = code||'';
    cardLayer.appendChild(el);
    return el;
  }
  function setFaceUp(el, code){
    el.classList.remove('face-down');
    el.dataset.code = code||'';
    el.style.backgroundImage = `url("${codeToUrl(code)}")`;
  }
  function moveTo(el, x, y, ms=280){
    el.style.transitionDuration = (ms|0)+'ms';
    el.style.left = x+'px'; el.style.top = y+'px';
  }
  function seatPt(i){ return GEO.seats[i] || GEO.deck; }

  function clearSeatCards(){ for (const arr of seatCards.values()) arr.forEach(n=>n.remove()); seatCards.clear(); }
  function clearBoardCards(){ qa('.pkr-card.board', cardLayer).forEach(n=>n.remove()); }

  function reanchorLiveCards(){
    // seat cards
    for (const [i, arr] of seatCards.entries()){
      const p = seatPt(i);
      arr.forEach((el,k)=>{
        // offset pair left/right
        const off = (k===0 ? -1 : 1) * (el.offsetWidth * 0.55);
        moveTo(el, p.x + off, p.y, 0);
      });
    }
    // board cards
    qa('.pkr-card.board', cardLayer).forEach((el)=>{
      const idx = Number(el.dataset.boardIndex||0);
      const p = GEO.board[idx]; if (p) moveTo(el, p.x, p.y, 0);
    });
  }

  function markTurn(seatIdx){
    qa('.seat').forEach(n=>n.classList.remove('pkr-turn'));
    if (Number.isInteger(seatIdx) && seatIdx>=0) seats[seatIdx]?.classList.add('pkr-turn');
  }
  function clearTurn(){ qa('.seat').forEach(n=>n.classList.remove('pkr-turn')); }

  /* ---------- animations ---------- */
  async function animateDeal(st){
    if (dealt) return;
    dealt = true; lastBoardCount=0;
    clearSeatCards(); clearBoardCards(); reanchorLiveCards();

    const order = (st.actors||[]).map(a=>a.seatId).filter(Number.isInteger);
    for (let round=0; round<2; round++){
      for (const seatIdx of order){
        const p = seatPt(seatIdx);
        const card = makeCard(null, true);
        moveTo(card, GEO.deck.x, GEO.deck.y, 0);
        await sleep(10);
        moveTo(card, p.x, p.y, 300);
        if (!seatCards.has(seatIdx)) seatCards.set(seatIdx, []);
        const arr = seatCards.get(seatIdx); arr.push(card);
        await sleep(90);
        // fan pair at target
        const off = (arr.length===1 ? -1 : +1) * (card.offsetWidth*0.55);
        moveTo(card, p.x + off, p.y, 80);
        await sleep(60);
      }
      await sleep(80);
    }
  }

  async function animateBurn(){
    const b = makeCard(null, true);
    moveTo(b, GEO.deck.x, GEO.deck.y, 0);
    await sleep(10);
    moveTo(b, GEO.burn.x, GEO.burn.y, 180);
    await sleep(200);
    b.style.opacity='0';
    await sleep(80);
    b.remove();
  }

  async function animateFlop(codes){
    for (let i=0;i<3;i++){
      const el = makeCard(codes[i], true); el.classList.add('board'); el.dataset.boardIndex=String(i);
      moveTo(el, GEO.deck.x, GEO.deck.y, 0);
      await sleep(10);
      const p = GEO.board[i]; moveTo(el, p.x, p.y, 260);
      await sleep(280);
      el.style.transform = 'translate(-50%,-50%) scaleX(0.02)';
      await sleep(70);
      setFaceUp(el, codes[i]);
      el.style.transform = 'translate(-50%,-50%)';
      await sleep(30);
    }
    lastBoardCount = 3;
  }

  async function animateTurnRiver(code, idx){
    const el = makeCard(code, true); el.classList.add('board'); el.dataset.boardIndex=String(idx);
    moveTo(el, GEO.deck.x, GEO.deck.y, 0);
    await sleep(10);
    const p = GEO.board[idx]; moveTo(el, p.x, p.y, 260);
    await sleep(280);
    el.style.transform = 'translate(-50%,-50%) scaleX(0.02)';
    await sleep(70);
    setFaceUp(el, code);
    el.style.transform = 'translate(-50%,-50%)';
    await sleep(30);
    lastBoardCount = idx+1;
  }

  function showMyHole(cards){
    if (!Array.isArray(cards) || cards.length<2) return;
    let mySeat=-1;
    for (let i=0;i<seatState.length;i++){
      const s=seatState[i];
      if (s?.addr && myAddrLower && s.addr.toLowerCase()===myAddrLower){ mySeat=i; break; }
    }
    if (mySeat<0) return;
    const arr = seatCards.get(mySeat)||[];
    for (let i=0;i<Math.min(2,arr.length);i++) setFaceUp(arr[i], cards[i]);
  }

  /* ---------- action bar ---------- */
  const actionBar = document.createElement('div');
  actionBar.id = 'poker-actions';
  const bf=document.createElement('button'); bf.textContent='Fold';
  const bc=document.createElement('button'); bc.textContent='Check';
  const bcall=document.createElement('button'); bcall.textContent='Call';
  [bf,bc,bcall].forEach(b=>actionBar.appendChild(b));
  tableCanvas.appendChild(actionBar);
  const hideActions=()=> actionBar.style.display='none';
  const showActions=(need)=>{ bc.style.display = need>0?'none':''; bcall.style.display = need>0?'':'none'; actionBar.style.display=''; };
  bf.onclick = ()=>{ try{ socket.emit('poker:act',{action:'fold'}); }catch{} hideActions(); };
  bc.onclick = ()=>{ try{ socket.emit('poker:act',{action:'check'});}catch{} hideActions(); };
  bcall.onclick=()=>{ try{ socket.emit('poker:act',{action:'call'}); }catch{} hideActions(); };

  /* ---------- socket events ---------- */
  function wireSocket(){
    socket.on('connect', ()=>{
      socket.emit('identify', { addr: myAddrLower||'-' });
      socket.emit('join_table', { table: tableId });
    });

    socket.on('table:update', (t)=>{
      renderAllSeats(t);
      updateDevBotVisibility(t);
    });

    socket.on('table:started', ()=>{
      centerBanner.style.display='block';
      centerBanner.textContent='New hand starting…';
      setTimeout(()=>{ centerBanner.style.display='none'; }, 1000);
    });

    socket.on('poker:state', async (st)=>{
      // turn ring
      const turnSeat = (st.actors?.[st.turnIndex||0]?.seatId);
      markTurn(Number.isInteger(turnSeat)?turnSeat:-1);

      // deal/street animations
      if (st.stage==='preflop' && !dealt) await animateDeal(st);
      const board = st.community||[];
      if (st.stage==='flop' && board.length>=3 && lastBoardCount<3){
        await animateBurn(); await animateFlop(board.slice(0,3));
      } else if (st.stage==='turn' && board.length>=4 && lastBoardCount<4){
        await animateBurn(); await animateTurnRiver(board[3], 3);
      } else if (st.stage==='river' && board.length>=5 && lastBoardCount<5){
        await animateBurn(); await animateTurnRiver(board[4], 4);
      }

      // my action?
      try{
        hideActions();
        if (!myAddrLower || !Array.isArray(st.actors)) return;
        const me = st.actors.find(a=> a?.addr && a.addr.toLowerCase()===myAddrLower);
        const isMine = (st.actors?.[st.turnIndex||0]?.addr||'').toLowerCase()===myAddrLower;
        if (me && isMine && !me.folded){
          const need = Math.max(0, Number(st.toCall||0) - Number(me.contrib||0));
          showActions(need);
        }
      }catch{}
    });

    socket.on('poker:hole', (payload)=>{
      const cards = Array.isArray(payload)?payload:(payload?.cards||[]);
      showMyHole(cards);
    });

    socket.on('poker:hand', (h)=>{
      clearTurn(); hideActions();

      // expose at showdown if provided
      if (h?.exposures){
        for (const ex of h.exposures){
          let seatIdx=-1;
          for (let i=0;i<seatState.length;i++){
            const s=seatState[i];
            if (s?.addr && ex.addr && s.addr.toLowerCase()===ex.addr.toLowerCase()){ seatIdx=i; break; }
          }
          if (seatIdx>=0){
            const arr = seatCards.get(seatIdx)||[];
            for (let i=0;i<Math.min(2,arr.length);i++) setFaceUp(arr[i], ex.cards[i]);
          }
        }
      }

      // banner
      try{
        const winners = (h?.winners||[]).map(w=>short(w.addr)).join(', ');
        if (winners){
          centerBanner.style.display='block';
          centerBanner.textContent = `Pot ${Number(h.pot||0)} — Winner: ${winners}`;
        }
      }catch{}
      setTimeout(()=>{
        centerBanner.style.display='none';
        dealt=false; lastBoardCount=0; clearSeatCards(); clearBoardCards(); reanchorLiveCards();
      }, 2500);
    });

    // F2P rebuy helper
    const rebuyBtn = document.createElement('button');
    rebuyBtn.textContent='Rebuy 100';
    Object.assign(rebuyBtn.style,{ position:'absolute', right:'16px', bottom:'16px', zIndex:4, display:'none' });
    rebuyBtn.onclick = ()=> { try{ socket.emit('sim:rebuy'); }catch{} };
    tableCanvas.appendChild(rebuyBtn);

    socket.on('table:update', (t)=>{
      try{
        if (!t?.simulated){ rebuyBtn.style.display='none'; return; }
        const me = (t.seats||[]).find(s=> s?.addr && myAddrLower && s.addr.toLowerCase()===myAddrLower);
        rebuyBtn.style.display = (me && Number(me.chips||0)<=0) ? '' : 'none';
      }catch{}
    });
  }

  /* ---------- boot ---------- */
  (async function boot(){
    try{
      socket = await getSocket();
      wireSocket();
      // If we created a new socket, join after connect
      if (socket.__standalone){
        socket.on('connect', ()=>{
          socket.emit('identify', { addr: myAddrLower||'-' });
          socket.emit('join_table', { table: tableId });
        });
      }
    }catch(e){ console.error(e); }
  })();

})();
