(function () {
  /* -------------------- wiring -------------------- */
  const q = (s, r=document) => r.querySelector(s);
  const qa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const ioReady = () => window.io ? Promise.resolve(window.io) : new Promise(r=>{
    const i = setInterval(()=>{ if(window.io){ clearInterval(i); r(window.io); } }, 20);
  });

  const tableCanvas = q('.table-canvas');
  if (!tableCanvas) { console.error('poker table: no .table-canvas'); return; }

  /* Layers for cards */
  const layer = document.createElement('div'); layer.className='pkr-layer';
  const deckLayer = document.createElement('div'); deckLayer.className='pkr-deck';
  const burnLayer = document.createElement('div'); burnLayer.className='pkr-burn';
  const boardLayer = document.createElement('div'); boardLayer.className='pkr-board';
  tableCanvas.append(layer, deckLayer, burnLayer, boardLayer);

  /* Compute geometry once per resize */
  let G = null;
  function computeGeom(){
    const r = tableCanvas.getBoundingClientRect();
    const cx = r.left + r.width/2, cy = r.top + r.height*0.46;
    const deck = { x: cx, y: cy };
    // Board slots across center
    const spacing = Math.min(r.width, 820) / 7.2;
    const startX = cx - spacing*2;
    const by = r.top + r.height*0.30;
    const board = Array.from({length:5}, (_,i)=>({ x: startX + spacing*i, y: by }));
    // Burn pile slightly left of deck
    const burn = { x: cx - Math.min(36, r.width*0.03), y: cy - Math.min(24, r.height*0.04) };
    // Seat centers (use existing .seat positions)
    const seats = qa('.seat').map(el=>{
      const b = el.getBoundingClientRect();
      return { el, x: b.left + b.width/2, y: b.top + b.height/2 };
    });
    G = { deck, burn, board, seats, rect: r };
  }
  computeGeom();
  window.addEventListener('resize', () => { computeGeom(); positionBoardHolders(); });

  /* Board holders (empty slots so the layout is obvious even before flop) */
  const boardHolders = Array.from({length:5}, ()=> {
    const h = document.createElement('div'); h.className='pkr-board-slot';
    boardLayer.appendChild(h); return h;
  });
  function positionBoardHolders(){
    if (!G) computeGeom();
    boardHolders.forEach((h,i)=>{
      const p = G.board[i]; if(!p) return;
      h.style.left = p.x + 'px'; h.style.top = p.y + 'px';
    });
  }
  positionBoardHolders();

  /* -------------------- assets & mapping -------------------- */
  const IMG_BASE = '/assets/images/chog_cards/';
  const RANK = { 'A':'ace','K':'king','Q':'queen','J':'jack','T':'ten','9':'nine','8':'eight','7':'seven','6':'six','5':'five','4':'four','3':'three','2':'two' };
  const SUIT = { 's':'spades','h':'hearts','d':'diamonds','c':'clubs' };
  function codeToUrl(code){
    // code like "As", "Td", "Qh"
    if (!code || code.length<2) return IMG_BASE + 'dak-and-chog-cardback.png';
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
    el.dataset.code = code;
    el.style.backgroundImage = `url("${codeToUrl(code)}")`;
  }

  /* -------------------- state -------------------- */
  let socket, tableId=null, myAddrLower=null;
  let lastStage=null, lastBoardLen=0, dealt=false;
  let mySeat=-1; // seat index for me
  let currentActors = []; // from server state
  let currentDealerSeat = -1;

  /* -------------------- helpers -------------------- */
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
  function toDeck(el){ const p=G.deck; el.style.left=p.x+'px'; el.style.top=p.y+'px'; }
  function flyTo(el, x,y, t=380){ el.style.transitionDuration = (t|0)+'ms'; el.style.left=x+'px'; el.style.top=y+'px'; }
  function seatCenter(i){ if(!G || !G.seats[i]) computeGeom(); return G.seats[i]||{x:G.deck.x, y:G.deck.y}; }
  function isMe(addr){ return addr && myAddrLower && addr.toLowerCase()===myAddrLower; }
  function markTurn(seatIdx){
    qa('.seat').forEach(n=>n.classList.remove('pkr-turn'));
    const s = qa('.seat')[seatIdx]; if (s) s.classList.add('pkr-turn');
  }
  function clearTurn(){ qa('.seat').forEach(n=>n.classList.remove('pkr-turn')); }

  /* Keep card DOMs per seat */
  const seatCards = new Map(); // seatIdx -> [cardEls]
  function clearSeatCards(){
    for (const arr of seatCards.values()){ arr.forEach(n=>n.remove()); }
    seatCards.clear();
  }
  function clearBoardCards(){
    qa('.pkr-card.board').forEach(n=>n.remove());
  }

  /* -------------------- animations -------------------- */
  async function animateDeal(st){
    if (dealt) return;
    dealt = true;
    clearSeatCards(); clearBoardCards(); positionBoardHolders();
    lastBoardLen = 0;

    // Build dealing order from server actors array (already in order of action)
    const order = (st.actors||[]).map(a => a.seatId).filter(i => Number.isInteger(i));
    // Two rounds
    for (let round=0; round<2; round++){
      for (const seatIdx of order){
        const p = seatCenter(seatIdx);
        const opp = makeCard(null, true);
        opp.style.opacity = '0';
        layer.appendChild(opp);
        toDeck(opp);
        await sleep(12);
        opp.style.opacity = '1';
        flyTo(opp, p.x, p.y, 360);
        if (!seatCards.has(seatIdx)) seatCards.set(seatIdx, []);
        seatCards.get(seatIdx).push(opp);
        await sleep(50);
      }
      await sleep(180);
    }
  }

  async function animateBurn(){
    const c = makeCard(null,true);
    c.style.opacity='0'; layer.appendChild(c);
    toDeck(c);
    await sleep(10);
    c.style.opacity='1';
    flyTo(c, G.burn.x, G.burn.y, 220);
    await sleep(240);
    c.style.opacity='0';
    await sleep(120);
    c.remove();
  }

  async function animateFlop(codes){
    // Expect 3 codes
    for (let i=0;i<3;i++){
      const el = makeCard(codes[i], true); // fly face-down then flip-up
      el.classList.add('board'); el.style.opacity='0'; layer.appendChild(el);
      toDeck(el);
      await sleep(10);
      el.style.opacity='1';
      const p = G.board[i];
      flyTo(el, p.x, p.y, 320);
      await sleep(340);
      // flip up
      el.style.transform += ' scaleX(0.01)';
      await sleep(90);
      setFaceUp(el, codes[i]);
      el.style.transform = el.style.transform.replace(' scaleX(0.01)','');
      await sleep(60);
    }
    lastBoardLen = 3;
  }

  async function animateTurnOrRiver(code, idx){
    const el = makeCard(code, true);
    el.classList.add('board'); el.style.opacity='0'; layer.appendChild(el);
    toDeck(el);
    await sleep(10);
    el.style.opacity='1';
    const p = G.board[idx];
    flyTo(el, p.x, p.y, 320);
    await sleep(340);
    el.style.transform += ' scaleX(0.01)';
    await sleep(90);
    setFaceUp(el, code);
    el.style.transform = el.style.transform.replace(' scaleX(0.01)','');
    await sleep(60);
    lastBoardLen = idx+1;
  }

  function showMyHole(cards){
    // Replace my two (if dealt facedown) with face-up at my seat
    if (mySeat<0) return;
    const arr = seatCards.get(mySeat) || [];
    for (let i=0;i<Math.min(2,arr.length);i++){
      setFaceUp(arr[i], cards[i]);
      arr[i].classList.remove('dim');
    }
  }

  /* -------------------- sockets -------------------- */
  async function main(){
    // resolve my wallet address from tavern globals
    try {
      if (window.Tavern?.wallet?.address){ myAddrLower = String(window.Tavern.wallet.address).toLowerCase(); }
    } catch {}
    const qp = new URL(location.href).searchParams;
    tableId = qp.get('table') || 'poker-nl-1';

    const io = await ioReady();
    socket = io({ path: '/socket.io/' });

    socket.on('connect', ()=>{
      socket.emit('identify', { addr: myAddrLower||'-' });
      socket.emit('join_table', { table: tableId });
    });

    socket.on('system', (m)=>{ /* optional log */ });

    // Whole-table snapshots
    socket.on('table:update', (t)=>{
      // find my seat index
      mySeat = -1;
      (t.seats||[]).forEach((s,idx)=>{ if (s && s.addr && isMe(s.addr)) mySeat = idx; });
    });

    // Live poker state (stage & turn)
    socket.on('poker:state', async (st)=>{
      currentActors = st.actors||[];
      currentDealerSeat = st.dealerSeatId ?? -1;
      markTurn(st.turnSeatId ?? st.actors?.[st.turnIndex||0]?.seatId ?? -1);

      // Start of hand → deal everyone
      if (st.stage === 'preflop' && !dealt) {
        await animateDeal(st);
      }

      // Stage transitions
      if (st.stage === 'flop' && lastBoardLen < 3 && (st.community||[]).length>=3){
        await animateBurn();
        await animateFlop(st.community.slice(0,3));
      } else if (st.stage === 'turn' && (st.community||[]).length>=4 && lastBoardLen < 4){
        await animateBurn();
        await animateTurnOrRiver(st.community[3], 3);
      } else if (st.stage === 'river' && (st.community||[]).length>=5 && lastBoardLen < 5){
        await animateBurn();
        await animateTurnOrRiver(st.community[4], 4);
      }

      lastStage = st.stage;
    });

    // Private hole cards (only to me)
    socket.on('poker:hole', (payload)=>{
      // payload could be { cards:['As','Kd'], seatId: mySeat }
      const cards = Array.isArray(payload) ? payload : (payload?.cards||[]);
      showMyHole(cards);
    });

    // Showdown & cleanup
    socket.on('poker:hand', (h)=>{
      clearTurn();
      // Optionally reveal exposures (if server sent them)
      if (h?.exposures){
        for (const ex of h.exposures){
          const seatIdx = ex.seatId ?? (currentActors.find(a=>a.addr===ex.addr)?.seatId);
          if (Number.isInteger(seatIdx)) {
            const arr = seatCards.get(seatIdx) || [];
            for (let i=0;i<Math.min(2,arr.length);i++){
              setFaceUp(arr[i], ex.cards[i]);
            }
          }
        }
      }
      // Reset for next hand after a short pause
      setTimeout(()=>{
        dealt=false; lastBoardLen=0; clearSeatCards(); clearBoardCards(); positionBoardHolders();
      }, 2500);
    });
  }

  main().catch(console.error);
})();
