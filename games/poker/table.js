/* Poker overlay — NO felt/background creation. Seats ring outside the table.
   Safe to re-run: it cleans any previous overlay. */

(() => {
  /* ------------------------- tear down any old overlays ------------------------- */
  document.querySelectorAll('#poker-overlay,[data-dc-overlay="1"]').forEach(n => {
    try { n.remove(); } catch {}
  });

  /* ------------------------------ find the felt -------------------------------- */
  function pickFelt() {
    const preferred = [
      '[data-role="poker-felt"]',
      '#poker-felt',
      '.poker-felt',
      '.table-felt'
    ];
    for (const sel of preferred) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // visible, large-ish table image fallbacks
    const cands = Array.from(document.querySelectorAll('img[src*="poker-table"], img[src*="games-table"], img[src*="table.png"], img[src*="/poker-table"]'))
      .filter(img => img.offsetWidth > 300 && img.offsetHeight > 300 && getComputedStyle(img).display !== 'none');
    if (cands.length) return cands[0];
    return null;
  }
  const feltEl = pickFelt();
  if (!feltEl) { console.error('[poker] No felt element found. Tag your image with data-role="poker-felt".'); return; }

  /* ------------------------------ overlay layers ------------------------------- */
  const host = feltEl.parentElement || document.body;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const overlay = document.createElement('div');
  overlay.id = 'poker-overlay';
  overlay.setAttribute('data-dc-overlay', '1');
  Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '5' });
  host.appendChild(overlay);

  const seatLayer  = document.createElement('div');
  const boardLayer = document.createElement('div');
  const myHole     = document.createElement('div');
  const controls   = document.createElement('div');
  [seatLayer, boardLayer, myHole, controls].forEach(el => { el.style.position = 'absolute'; overlay.appendChild(el); });

  Object.assign(seatLayer.style, { inset: '0' });
  Object.assign(boardLayer.style, { display: 'none', left:'0px', top:'0px', transform:'translate(-50%, -50%)', pointerEvents:'none' });
  Object.assign(myHole.style, { display:'none', pointerEvents:'none' });
  Object.assign(controls.style, { display:'none', pointerEvents:'auto', transform:'translate(-50%, 0)', zIndex:'6' });

  /* --------------------------------- sockets ---------------------------------- */
  const ioPath = '/poker.io/';
  // eslint-disable-next-line no-undef
  const socket = window.io ? window.io(window.location.origin, { path: ioPath }) : null;
  if (!socket) { console.error('[poker] Socket.IO not available'); return; }

  const savedAddr = localStorage.getItem('tavern_addr');
  const myAddr = savedAddr || `sim:${Math.random().toString(36).slice(2,8)}`;
  localStorage.setItem('tavern_addr', myAddr);

  const url = new URL(location.href);
  const tableId = url.searchParams.get('table') || 'poker-sim-1';
  const emit = (ev, payload) => { try { socket.emit(ev, payload); } catch(e) { console.error(ev, e); } };

  socket.on('connect', () => {
    emit('identify', { addr: myAddr });
    emit('join_table', { table: tableId });
    emit('lobby:get', {});
  });

  /* ---------------------------------- UI -------------------------------------- */
  function mkBtn(txt, onClick) {
    const b = document.createElement('button');
    b.textContent = txt;
    Object.assign(b.style, {
      font: '600 14px ui-sans-serif, system-ui',
      padding: '8px 14px',
      borderRadius: '999px',
      border: 'none',
      marginRight: '8px',
      boxShadow: '0 6px 16px rgba(0,0,0,.25)',
      cursor: 'pointer'
    });
    b.addEventListener('click', onClick);
    return b;
  }
  const btnFold  = mkBtn('Fold',  () => emit('poker:act', { action: 'fold'  }));
  const btnCheck = mkBtn('Check', () => emit('poker:act', { action: 'check' }));
  const btnCall  = mkBtn('Call',  () => emit('poker:act', { action: 'call'  }));
  btnFold.style.background  = '#a22626'; btnFold.style.color  = '#fff';
  btnCheck.style.background = '#2b6cb0'; btnCheck.style.color = '#fff';
  btnCall.style.background  = '#16a34a'; btnCall.style.color  = '#fff';
  controls.append(btnFold, btnCheck, btnCall);

  const SEATS = 8;
  const seatUI = new Array(SEATS);
  let seats = new Array(SEATS).fill(null);
  let mySeatIdx = -1;
  let pState = null;

  function feltRect() { return feltEl.getBoundingClientRect(); }
  function overlayRect() { return overlay.getBoundingClientRect(); }
  function feltCenterInOverlay() {
    const f = feltRect(), o = overlayRect();
    return { x: f.left - o.left + f.width/2, y: f.top - o.top + f.height/2, w:f.width, h:f.height };
  }

  function mkSeat(i) {
    const wrap = document.createElement('div');
    wrap.dataset.seat = String(i);
    Object.assign(wrap.style, { position:'absolute', transform:'translate(-50%, -50%)', width:'170px', maxWidth:'22vmin', textAlign:'center', pointerEvents:'none', color:'#f2f2f2', font:'14px ui-sans-serif, system-ui' });

    const pip = document.createElement('div');
    Object.assign(pip.style, { width:'70px', height:'70px', margin:'0 auto 6px', borderRadius:'50%',
      background:'radial-gradient(circle at 35% 35%, #ffd166 0%, #e85d04 60%, #6a040f 100%)',
      boxShadow:'0 6px 16px rgba(0,0,0,.35)', pointerEvents:'auto', cursor:'pointer'
    });
    wrap.appendChild(pip);

    const label = document.createElement('div');
    Object.assign(label.style, { fontSize:'12px', opacity:.9, marginTop:'2px' });
    label.textContent = `Seat ${i+1}`;
    wrap.appendChild(label);

    const sitBtn = document.createElement('button');
    sitBtn.textContent = 'Sit';
    Object.assign(sitBtn.style, { marginTop:'6px', fontSize:'12px', padding:'6px 10px', borderRadius:'8px', border:'none', cursor:'pointer', background:'#16a34a', color:'#fff', pointerEvents:'auto' });
    wrap.appendChild(sitBtn);

    const readyBtn = document.createElement('button');
    readyBtn.textContent = 'Ready';
    Object.assign(readyBtn.style, { marginTop:'6px', fontSize:'12px', padding:'6px 10px', borderRadius:'8px', border:'none', cursor:'pointer', background:'#16a34a', color:'#fff', display:'none', pointerEvents:'auto' });
    wrap.appendChild(readyBtn);

    sitBtn.addEventListener('click', () => {
      if (mySeatIdx === i) emit('seat', { index: -1 });
      else if (!seats[i]) emit('seat', { index: i });
    });
    readyBtn.addEventListener('click', () => {
      const mine = (mySeatIdx >= 0) ? seats[mySeatIdx] : null;
      if (!mine) return;
      emit('ready', { ready: !mine.ready });
    });

    seatLayer.appendChild(wrap);
    return seatUI[i] = { wrap, pip, label, sitBtn, readyBtn };
  }

  function short(a){ if(!a) return ''; if(a.startsWith('sim:')) return a; return `${a.slice(0,6)}…${a.slice(-4)}`; }

  function layout() {
    const c = feltCenterInOverlay();

    // Community board centered on felt (hidden until cards)
    boardLayer.style.left = `${c.x}px`;
    boardLayer.style.top  = `${c.y}px`;
    boardLayer.style.width = `${Math.round(c.w * 0.62)}px`;

    // Controls below felt
    controls.style.left = `${c.x}px`;
    controls.style.top  = `${c.y + c.h * 0.40}px`;

    // Seats: ellipse just OUTSIDE felt rim
    const margin = Math.max(40, Math.round(Math.min(c.w, c.h) * 0.06)); // ensures outside the leather rim
    const rx = c.w/2 + margin;
    const ry = c.h/2 + margin;

    for (let i=0;i<SEATS;i++){
      const ui = seatUI[i] || mkSeat(i);
      const ang = (i / SEATS) * Math.PI * 2 - Math.PI/2;
      ui.wrap.style.left = `${c.x + Math.cos(ang)*rx}px`;
      ui.wrap.style.top  = `${c.y + Math.sin(ang)*ry}px`;
    }

    // My hole cards: slightly inside my seat
    if (mySeatIdx >= 0){
      const ang = (mySeatIdx / SEATS) * Math.PI * 2 - Math.PI/2;
      const hx = c.x + Math.cos(ang) * (rx - Math.max(60, c.h*0.12));
      const hy = c.y + Math.sin(ang) * (ry - Math.max(60, c.h*0.12));
      myHole.style.left = `${hx}px`;
      myHole.style.top  = `${hy}px`;
      myHole.style.transform = 'translate(-50%, -50%)';
    }
  }
  window.addEventListener('resize', layout);
  window.addEventListener('scroll', layout, { passive:true });

  /* ------------------------------ render helpers ----------------------------- */
  const CARD_BASE = '/assets/images/chog_cards/';
  function mkCard(name, hPx){
    const img = document.createElement('img');
    img.src = CARD_BASE + name;
    img.decoding = 'async';
    img.loading = 'eager';
    img.style.height = `${hPx}px`;
    img.style.width = 'auto';
    img.style.userSelect = 'none';
    img.style.filter = 'drop-shadow(0 6px 10px rgba(0,0,0,.35))';
    return img;
  }

  function renderBoard(cards){
    boardLayer.innerHTML = '';
    if (!cards || !cards.length){ boardLayer.style.display = 'none'; return; }
    const c = feltCenterInOverlay();
    const h = Math.max(56, Math.round(c.h * 0.22));
    boardLayer.style.height = `${h}px`;
    boardLayer.style.display = 'flex';
    boardLayer.style.justifyContent = 'center';
    boardLayer.style.alignItems = 'center';
    boardLayer.style.gap = `${Math.max(8, Math.round(c.w*0.015))}px`;
    cards.forEach(n => boardLayer.appendChild(mkCard(n, h)));
  }

  function renderMyHole(cards){
    myHole.innerHTML = '';
    if (!cards || !cards.length){ myHole.style.display = 'none'; return; }
    const c = feltCenterInOverlay();
    const h = Math.max(54, Math.round(c.h * 0.20));
    myHole.style.display = 'flex';
    myHole.style.gap = `${Math.max(8, Math.round(c.w*0.015))}px`;
    cards.forEach(n => myHole.appendChild(mkCard(n, h)));
  }

  function orderFromDealer(dealerSeatId){
    const idxs = [];
    for (let k=0;k<SEATS;k++){ const si=(dealerSeatId+k)%SEATS; if(seats[si]) idxs.push(si); }
    return idxs;
  }
  function myTurn(){
    if (!pState || mySeatIdx<0) return false;
    const ord = orderFromDealer(pState.dealerSeatId);
    const seatForTurn = ord[pState.turnIndex] ?? -1;
    return seatForTurn === mySeatIdx;
  }
  function updateControls(){
    const c = feltCenterInOverlay();
    controls.style.left = `${c.x}px`;
    controls.style.top  = `${c.y + c.h * 0.40}px`;

    if (!pState || !myTurn()){ controls.style.display = 'none'; return; }
    const need = Math.max(0, Number(pState.toCall||0));
    btnCheck.disabled = need > 0;
    btnCall.disabled  = need === 0;
    btnCheck.textContent = need > 0 ? '—' : 'Check';
    btnCall.textContent  = need > 0 ? 'Call'  : '—';
    controls.style.display = 'block';
  }

  /* ------------------------------- server events ----------------------------- */
  socket.on('table:update', (t) => {
    seats = t?.seats || new Array(SEATS).fill(null);
    mySeatIdx = seats.findIndex(s => s && String(s.addr||'') === String(myAddr));
    for (let i=0;i<SEATS;i++){
      const ui = seatUI[i] || mkSeat(i);
      const s = seats[i];
      ui.label.textContent = s ? short(s.addr) : `Seat ${i+1}`;
      ui.sitBtn.textContent = (mySeatIdx===i) ? 'Leave' : (s ? 'Taken' : 'Sit');
      ui.sitBtn.style.background = (mySeatIdx===i) ? '#a22626' : (s ? '#334155' : '#16a34a');
      ui.sitBtn.style.pointerEvents = s && mySeatIdx!==i ? 'none' : 'auto';
      const showReady = (mySeatIdx===i);
      ui.readyBtn.style.display = showReady ? 'inline-block' : 'none';
      if (showReady){
        const mine = seats[mySeatIdx];
        const rOn = !!(mine && mine.ready);
        ui.readyBtn.textContent = rOn ? 'Unready' : 'Ready';
        ui.readyBtn.style.background = rOn ? '#ef4444' : '#16a34a';
      }
    }
    layout(); updateControls();
  });

  socket.on('poker:state', (s) => { pState = s || null; renderBoard(s?.community || []); updateControls(); });
  socket.on('poker:hole',  (m) => { renderMyHole(Array.isArray(m?.cards)? m.cards : []); });
  socket.on('poker:hand',  (m) => { renderBoard(m?.community || []); setTimeout(()=> renderMyHole([]), 1200); controls.style.display='none'; });

  socket.on('system', (msg)=>console.log('[system]', msg));
  socket.on('error',  (e)=>console.warn('[server-error]', e));

  // first paint
  layout();
})();
