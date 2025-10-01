/* Dak & Chog — Poker Table (ellipse-anchored seats, CHOG cards, burn+flop/turn/river animations) */
(function () {
  /* ---------- helpers ---------- */
  const q  = (s, r=document) => r.querySelector(s);
  const qa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
  const short = (v)=> v && v.length>10 ? (v.slice(0,6)+'…'+v.slice(-4)) : (v||'');

  const params   = new URL(location.href).searchParams;
  const tableId  = params.get('table') || 'poker-nl-1';
  const htmlMode = (document.documentElement.getAttribute('data-table-mode')||'f2p').toLowerCase();

  const canvas = q('.table-canvas');
  const surface = q('.table-surface') || canvas;
  const centerBanner = q('#poker-center');
  const devbotBtn = q('#wi-devbot');

  if (!canvas) { console.error('[poker/table] .table-canvas missing'); return; }
  if (getComputedStyle(canvas).position === 'static') canvas.style.position = 'relative';

  /* ---------- minimal CSS for seats/cards ---------- */
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
      .pkr-card.face-down{ background-image:url("/assets/images/chog_cards/dak-and-chog-cardback.png"); }
      #poker-actions{ position:absolute; left:50%; bottom:18px; transform:translateX(-50%); display:none; z-index:4; }
      #poker-actions button{ margin:0 6px; padding:8px 12px; border-radius:10px; font-weight:700; }
    `;
    document.head.appendChild(style);
  })();

  /* ---------- card layer + state maps (declare early!) ---------- */
  const layer = document.createElement('div'); layer.className='pkr-layer'; canvas.appendChild(layer);
  const seatCards = new Map(); // seatIdx -> [el, el]
  let lastBoardCount = 0;
  let dealt = false;

  /* ---------- geometry (ellipse around the felt) ---------- */
  const seats = qa('.seat');
  let GEO = { cRect:null, sRect:null, deck:null, burn:null, board:[], seats:[] };

  function recomputeGeom(){
    const cRect = canvas.getBoundingClientRect();
    const sRect = surface.getBoundingClientRect();
    if (sRect.width < 50 || sRect.height < 50) { setTimeout(recomputeGeom, 60); return; }

    const offX = sRect.left - cRect.left;
    const offY = sRect.top  - cRect.top;
    const cx   = offX + sRect.width/2;
    const cy   = offY + sRect.height/2;

    // Ellipse radii tuned to your felt
    const rx = sRect.width  * 0.40;
    const ry = sRect.height * 0.36;

    // 8 seats, 45° apart, starting at top center (90°), clockwise
    const ANG = [90, 45, 0, -45, -90, -135, 180, 135].map(a => a * Math.PI/180);
    const seatsPx = ANG.map(a => ({ x: cx + rx*Math.cos(a), y: cy - ry*Math.sin(a) }));

    // card origins
    const deck = { x: cx + Math.min(40, sRect.width*0.03), y: cy + Math.min(10, sRect.height*0.02) };
    const burn = { x: cx - Math.min(44, sRect.width*0.035), y: cy - Math.min(22, sRect.height*0.035) };

    // Five community card anchor points (we DO NOT render placeholders)
    const spacing = Math.min(96, sRect.width*0.09);
    const startX  = cx - spacing*2;
    const board   = Array.from({length:5}, (_,i)=>({ x: startX + i*spacing, y: cy - Math.min(12, sRect.height*0.02) }));

    GEO = { cRect, sRect, deck, burn, board, seats:seatsPx };
    placeSeats();
    reanchorLiveCards();
  }

  function placeSeats(){
    if (!GEO?.seats?.length) return;
    seats.forEach((el, i) => {
      const p = GEO.seats[i] || GEO.seats[0];
      el.style.left = p.x + 'px';
      el.style.top  = p.y + 'px';
    });
  }

  function reanchorLiveCards(){
    if (!GEO?.seats?.length) return;
    for (const [i, arr] of seatCards.entries()){
      const p = GEO.seats[i] || GEO.deck || {x:0,y:0};
      arr.forEach((el,k)=>{
        const off = (k===0 ? -1 : 1) * (el.offsetWidth * 0.55);
        el.style.left = (p.x + off) + 'px';
        el.style.top  = (p.y) + 'px';
      });
    }
    qa('.pkr-card.board', layer).forEach((el)=>{
      const idx = Number(el.dataset.boardIndex||0);
      const p = GEO.board[idx]; if (p){ el.style.left = p.x+'px'; el.style.top = p.y+'px'; }
    });
  }

  recomputeGeom();
  const ro1 = new ResizeObserver(recomputeGeom);
  const ro2 = new ResizeObserver(recomputeGeom);
  ro1.observe(canvas);
  ro2.observe(surface);
  window.addEventListener('resize', recomputeGeom);

  /* ---------- wallet/my address ---------- */
  let myAddrLower = null;
  try {
    const a = window.Tavern?.wallet?.address || (q('#wi-address')?.textContent||'');
    if (a && a.includes('0x')) myAddrLower = a.trim().toLowerCase();
  } catch {}

  /* ---------- socket ---------- */
  let socket=null;
  function getSocket(){
    const reuse = [window.__socket, window.socket, window.Tavern?.socket].find(Boolean);
    if (reuse && typeof reuse.on==='function') return reuse;
    if (!window.io) throw new Error('Socket.IO missing');
    const s = window.io({ path:'/socket.io/' }); s.__standalone = true; return s;
  }

  /* ---------- render seats ---------- */
  const seatState = Array.from({length:8}, ()=> null);
  function renderSeat(idx, data){
    const root = seats[idx]; if (!root) return;
    root.innerHTML = '';
    const wrap = document.createElement('div');
    Object.assign(wrap.style,{ display:'flex', flexDirection:'column', alignItems:'center', gap:'6px', minWidth:'120px' });

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

  /* ---------- DevBot never on onchain ---------- */
  if (devbotBtn && htmlMode==='onchain') devbotBtn.style.display='none';
  function updateDevBotVisibility(pub){
    if (!devbotBtn) return;
    const isSim = !!pub?.simulated;
    devbotBtn.style.display = (htmlMode==='onchain' || !isSim) ? 'none' : '';
  }

  /* ---------- cards & animations ---------- */
  const IMG_BASE = '/assets/images/chog_cards/';
  const RANK = { A:'ace', K:'king', Q:'queen', J:'jack', T:'ten','9':'nine','8':'eight','7':'seven','6':'six','5':'five','4':'four','3':'three','2':'two' };
  const SUIT = { s:'spades', h:'hearts', d:'diamonds', c:'clubs' };
  const codeToUrl = (code)=> (!code||code.length<2) ? (IMG_BASE+'dak-and-chog-cardback.png')
    : `${IMG_BASE}chog-${RANK[code[0].toUpperCase()]||'ace'}-of-${SUIT[code[1].toLowerCase()]||'spades'}.png`;

  function makeCard(code, faceDown){
    const el = document.createElement('div');
    el.className = 'pkr-card' + (faceDown?' face-down':'');
    if (!faceDown && code) el.style.backgroundImage = `url("${codeToUrl(code)}")`;
    el.dataset.code = code||'';
    layer.appendChild(el);
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
  const seatPt = (i)=> (GEO.seats[i] || GEO.deck || {x:0,y:0});

  function clearSeatCards(){ for (const arr of seatCards.values()) arr.forEach(n=>n.remove()); seatCards.clear(); }
  function clearBoardCards(){ qa('.pkr-card.board', layer).forEach(n=>n.remove()); }

  function markTurn(seatIdx){
    qa('.seat').forEach(n=>n.classList.remove('pkr-turn'));
    if (Number.isInteger(seatIdx) && seatIdx>=0) seats[seatIdx]?.classList.add('pkr-turn');
  }
  function clearTurn(){ qa('.seat').forEach(n=>n.classList.remove('pkr-turn')); }

  async function animateDeal(st){
    if (dealt) return;
    dealt = true; lastBoardCount=0;
    clearSeatCards(); clearBoardCards(); reanchorLiveCards();

    const order = (st.actors||[]).map(a=>a.seatId).filter(Number.isInteger);
    for (let round=0; round<2; round++){
      for (const sIdx of order){
        const p = seatPt(sIdx);
        const card = makeCard(null, true);
        moveTo(card, GEO.deck.x, GEO.deck.y, 0);
        await sleep(10);
        moveTo(card, p.x, p.y, 300);
        if (!seatCards.has(sIdx)) seatCards.set(sIdx, []);
        const arr = seatCards.get(sIdx); arr.push(card);
        await sleep(90);
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
    b.style.opacity='0'; await sleep(80); b.remove();
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
  actionBar.id='poker-actions';
  const bFold = document.createElement('button'); bFold.textContent='Fold';
  const bCheck= document.createElement('button'); bCheck.textContent='Check';
  const bCall = document.createElement('button'); bCall.textContent='Call';
  actionBar.append(bFold,bCheck,bCall);
  canvas.appendChild(actionBar);
  const hideActions=()=> actionBar.style.display='none';
  const showActions=(need)=>{ bCheck.style.display = need>0?'none':''; bCall.style.display = need>0?'':'none'; actionBar.style.display=''; };
  bFold.onclick = ()=>{ try{ socket.emit('poker:act',{action:'fold'}); }catch{} hideActions(); };
  bCheck.onclick= ()=>{ try{ socket.emit('poker:act',{action:'check'});}catch{} hideActions(); };
  bCall.onclick = ()=>{ try{ socket.emit('poker:act',{action:'call'}); }catch{} hideActions(); };

  /* ---------- socket wiring ---------- */
  function wireSocket(){
    socket.on('connect', ()=>{
      socket.emit('identify', { addr: myAddrLower||'-' });
      socket.emit('join_table', { table: tableId });
    });
    socket.on('table:update', (t)=>{ renderAllSeats(t); updateDevBotVisibility(t); });
    socket.on('table:started', ()=>{
      if (!centerBanner) return;
      centerBanner.style.display='block';
      centerBanner.textContent='New hand starting…';
      setTimeout(()=>{ centerBanner.style.display='none'; }, 1000);
    });
    socket.on('poker:state', async (st)=>{
      const turnSeat = (st.actors?.[st.turnIndex||0]?.seatId);
      markTurn(Number.isInteger(turnSeat)?turnSeat:-1);

      if (st.stage==='preflop' && !dealt) await animateDeal(st);
      const board = st.community||[];
      if (st.stage==='flop' && board.length>=3 && lastBoardCount<3){ await animateBurn(); await animateFlop(board.slice(0,3)); }
      else if (st.stage==='turn' && board.length>=4 && lastBoardCount<4){ await animateBurn(); await animateTurnRiver(board[3],3); }
      else if (st.stage==='river' && board.length>=5 && lastBoardCount<5){ await animateBurn(); await animateTurnRiver(board[4],4); }

      try{
        hideActions();
        if (!myAddrLower || !Array.isArray(st.actors)) return;
        const me = st.actors.find(a=> a?.addr && a.addr.toLowerCase()===myAddrLower);
        const mine = (st.actors?.[st.turnIndex||0]?.addr||'').toLowerCase()===myAddrLower;
        if (me && mine && !me.folded){
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
      if (h?.exposures){
        for (const ex of h.exposures){
          let sIdx=-1;
          for (let i=0;i<seatState.length;i++){
            const s=seatState[i];
            if (s?.addr && ex.addr && s.addr.toLowerCase()===ex.addr.toLowerCase()){ sIdx=i; break; }
          }
          if (sIdx>=0){
            const arr = seatCards.get(sIdx)||[];
            for (let i=0;i<Math.min(2,arr.length);i++) setFaceUp(arr[i], ex.cards[i]);
          }
        }
      }
      try{
        const winners = (h?.winners||[]).map(w=>short(w.addr)).join(', ');
        if (winners && centerBanner){
          centerBanner.style.display='block';
          centerBanner.textContent = `Pot ${Number(h.pot||0)} — Winner: ${winners}`;
        }
      }catch{}
      setTimeout(()=>{ if(centerBanner) centerBanner.style.display='none'; dealt=false; lastBoardCount=0; clearSeatCards(); clearBoardCards(); reanchorLiveCards(); }, 2500);
    });

    // F2P rebuy helper
    const rebuyBtn = document.createElement('button');
    rebuyBtn.textContent='Rebuy 100';
    Object.assign(rebuyBtn.style,{ position:'absolute', right:'16px', bottom:'16px', zIndex:4, display:'none' });
    rebuyBtn.onclick = ()=> { try{ socket.emit('sim:rebuy'); }catch{} };
    canvas.appendChild(rebuyBtn);
    socket.on('table:update', (t)=>{
      try{
        if (!t?.simulated){ rebuyBtn.style.display='none'; return; }
        const me = (t.seats||[]).find(s=> s?.addr && myAddrLower && s.addr.toLowerCase()===myAddrLower);
        rebuyBtn.style.display = (me && Number(me.chips||0)<=0) ? '' : 'none';
      }catch{}
    });
  }

  /* ---------- boot ---------- */
  try{
    socket = getSocket();
    wireSocket();
    if (socket.__standalone){
      socket.on('connect', ()=>{
        socket.emit('identify', { addr: myAddrLower||'-' });
        socket.emit('join_table', { table: tableId });
      });
    }
  }catch(e){ console.error(e); }
})();
