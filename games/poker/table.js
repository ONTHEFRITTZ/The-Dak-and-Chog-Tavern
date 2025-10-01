/* Poker table client (F2P + on-chain compatible)
 * - Listens for: table:update, poker:state, poker:hole, poker:hand
 * - Seats ring outside table edge; board centered; cards only render when present
 * - Ephemeral sim wallet if none, so F2P can act and get private hole cards
 * - Minimal controls: check / call / fold (server validates)
 */

/* -------------------------- Socket.IO bootstrap -------------------------- */
(() => {
  const ioPath = '/poker.io/'; // nginx maps this → /socket.io/ upstream
  // eslint-disable-next-line no-undef
  const socket = window.io ? window.io(window.location.origin, { path: ioPath }) : null;
  if (!socket) {
    console.error('Socket.IO not found on window.io');
    return;
  }

  /* ------------------------------ DOM scaffold ------------------------------ */
  const root = document.getElementById('table-stage') || (() => {
    const r = document.createElement('div');
    r.id = 'table-stage';
    document.body.appendChild(r);
    return r;
  })();

  // Inline minimal stage layout so this file works even if CSS misses
  Object.assign(root.style, {
    position: 'relative',
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    background: 'radial-gradient(ellipse at center, #0b4d2a 0%, #05331b 60%, #031f12 100%)'
  });

  // Felt image (optional; harmless if your CSS already draws the table)
  const felt = document.getElementById('table-felt') || (() => {
    const f = document.createElement('div');
    f.id = 'table-felt';
    Object.assign(f.style, {
      position: 'absolute',
      left: '50%', top: '50%',
      transform: 'translate(-50%,-50%)',
      width: '76vmin', height: '52vmin',
      backgroundImage: 'url(/assets/images/poker-table.png)',
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      pointerEvents: 'none'
    });
    root.appendChild(f);
    return f;
  })();

  // Layers
  const seatLayer = document.getElementById('seats-layer') || (() => {
    const l = document.createElement('div');
    l.id = 'seats-layer';
    Object.assign(l.style, { position: 'absolute', inset: 0 });
    root.appendChild(l);
    return l;
  })();

  const boardLayer = document.getElementById('board-layer') || (() => {
    const l = document.createElement('div');
    l.id = 'board-layer';
    Object.assign(l.style, {
      position: 'absolute',
      left: '50%', top: '50%',
      transform: 'translate(-50%,-50%)',
      width: '50vmin',
      height: '14vmin',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1vmin',
      pointerEvents: 'none'
    });
    root.appendChild(l);
    return l;
  })();

  const myHoleLayer = document.getElementById('my-hole') || (() => {
    const l = document.createElement('div');
    l.id = 'my-hole';
    Object.assign(l.style, {
      position: 'absolute',
      left: '50%', bottom: '3vmin',
      transform: 'translateX(-50%)',
      height: '12vmin',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1vmin',
      pointerEvents: 'none',
      filter: 'drop-shadow(0 0.6vmin 0.6vmin rgba(0,0,0,0.45))'
    });
    root.appendChild(l);
    return l;
  })();

  const controls = document.getElementById('controls') || (() => {
    const c = document.createElement('div');
    c.id = 'controls';
    Object.assign(c.style, {
      position: 'absolute',
      left: '50%', bottom: '16vmin',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: '1rem'
    });
    root.appendChild(c);
    return c;
  })();

  function mkBtn(text, onClick) {
    const b = document.createElement('button');
    b.textContent = text;
    Object.assign(b.style, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '1rem',
      padding: '0.6rem 1rem',
      borderRadius: '999px',
      border: 'none',
      cursor: 'pointer',
      boxShadow: '0 6px 16px rgba(0,0,0,0.25)'
    });
    b.addEventListener('click', onClick);
    return b;
  }

  const btnFold = mkBtn('Fold', () => safeEmit('poker:act', { action: 'fold' }));
  btnFold.style.background = '#a22626'; btnFold.style.color = '#fff';

  const btnCheck = mkBtn('Check', () => safeEmit('poker:act', { action: 'check' }));
  btnCheck.style.background = '#2b6cb0'; btnCheck.style.color = '#fff';

  const btnCall = mkBtn('Call', () => safeEmit('poker:act', { action: 'call' }));
  btnCall.style.background = '#16a34a'; btnCall.style.color = '#fff';

  controls.append(btnFold, btnCheck, btnCall);
  controls.style.display = 'none';

  /* ------------------------------ Local state ------------------------------- */
  const url = new URL(window.location.href);
  const tableId = url.searchParams.get('table') || 'poker-sim-1';

  const CARD_BASE = '/assets/images/chog_cards/'; // your chog_*.png set
  function mkCard(src) {
    const img = document.createElement('img');
    img.src = CARD_BASE + src;
    Object.assign(img.style, {
      height: '100%',
      width: 'auto',
      userSelect: 'none'
    });
    return img;
  }

  // Ephemeral id for F2P if no wallet integration provided
  const savedAddr = localStorage.getItem('tavern_addr');
  let myAddr = savedAddr || `sim:${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem('tavern_addr', myAddr);

  let seats = [];            // from table:update
  let mySeatIndex = -1;

  // Poker round state (public)
  let pState = null;         // {stage, community[], pot, toCall, turnIndex, dealerSeatId}

  function safeEmit(ev, payload) {
    try { socket.emit(ev, payload); } catch (e) { console.error('emit error', ev, e); }
  }

  /* --------------------------- Geometry / Seats UI -------------------------- */
  const SEAT_COUNT = 8;
  const seatEls = new Array(SEAT_COUNT).fill(null);

  function ensureSeat(i) {
    if (seatEls[i]) return seatEls[i];
    const wrap = document.createElement('div');
    wrap.dataset.seat = String(i);
    Object.assign(wrap.style, {
      position: 'absolute',
      transform: 'translate(-50%,-50%)',
      width: '18vmin',
      textAlign: 'center',
      color: '#eee',
      fontFamily: 'system-ui, sans-serif',
      pointerEvents: 'none'
    });

    const chip = document.createElement('div');
    Object.assign(chip.style, {
      width: '8vmin', height: '8vmin',
      margin: '0 auto 0.5vmin auto',
      borderRadius: '50%',
      background: 'radial-gradient(circle at 35% 35%, #ffd166 0%, #e85d04 60%, #6a040f 100%)',
      boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
      pointerEvents: 'auto', cursor: 'pointer'
    });
    wrap.appendChild(chip);

    const label = document.createElement('div');
    label.textContent = `Seat ${i+1}`;
    Object.assign(label.style, { fontSize: '0.9rem', opacity: 0.9, marginTop: '0.3vmin' });
    wrap.appendChild(label);

    const action = document.createElement('button');
    action.textContent = 'Sit';
    Object.assign(action.style, {
      marginTop: '0.4vmin',
      fontSize: '0.8rem',
      padding: '0.4rem 0.8rem',
      borderRadius: '8px',
      border: 'none',
      cursor: 'pointer',
      background: '#334155',
      color: '#fff',
      pointerEvents: 'auto'
    });
    wrap.appendChild(action);

    action.addEventListener('click', () => {
      if (mySeatIndex === i) {
        // leave
        safeEmit('seat', { index: -1 });
      } else if (seats[i] == null) {
        // take
        safeEmit('seat', { index: i });
      }
    });

    const readyBtn = document.createElement('button');
    readyBtn.textContent = 'Ready';
    Object.assign(readyBtn.style, {
      marginTop: '0.3vmin',
      fontSize: '0.8rem',
      padding: '0.35rem 0.7rem',
      borderRadius: '8px',
      border: 'none',
      cursor: 'pointer',
      background: '#16a34a',
      color: '#fff',
      display: 'none',
      pointerEvents: 'auto'
    });
    wrap.appendChild(readyBtn);

    readyBtn.addEventListener('click', () => {
      const mine = (mySeatIndex >= 0) ? seats[mySeatIndex] : null;
      if (!mine) return;
      const next = !mine.ready;
      safeEmit('ready', { ready: next });
    });

    seatLayer.appendChild(wrap);
    seatEls[i] = { wrap, chip, label, action, readyBtn };
    return seatEls[i];
  }

  function positionSeats() {
    // place seats around felt rim (just outside)
    const rect = root.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    // ellipse radii approximating felt size
    const rx = Math.min(rect.width, rect.height) * 0.42; // felt half width
    const ry = rx * (52/76); // aspect to match 76x52
    const rim = 1.10; // push slightly outside the felt rim

    for (let i = 0; i < SEAT_COUNT; i++) {
      const el = ensureSeat(i);
      const angle = (i / SEAT_COUNT) * Math.PI * 2 - Math.PI / 2; // start at top
      const x = cx + Math.cos(angle) * rx * rim;
      const y = cy + Math.sin(angle) * ry * rim;
      el.wrap.style.left = `${x}px`;
      el.wrap.style.top  = `${y}px`;
    }

    // board stays centered by CSS (translate -50%, -50%)
  }

  window.addEventListener('resize', positionSeats);

  /* ----------------------------- Rendering logic ---------------------------- */
  function renderTableUpdate(t) {
    seats = t.seats || new Array(SEAT_COUNT).fill(null);

    // find my seat by address (or sim id)
    mySeatIndex = seats.findIndex(s => s && String(s.addr || '') === String(myAddr));
    // update seat tiles
    for (let i = 0; i < SEAT_COUNT; i++) {
      const el = ensureSeat(i);
      const s = seats[i];

      el.label.textContent = s ? (s.addr ? shortAddr(s.addr) : `Seat ${i+1}`) : `Seat ${i+1}`;
      el.action.textContent = (mySeatIndex === i) ? 'Leave' : (s ? 'Taken' : 'Sit');
      el.action.style.background = (mySeatIndex === i) ? '#a22626' : (s ? '#334155' : '#16a34a');
      el.action.style.pointerEvents = s && mySeatIndex!==i ? 'none' : 'auto';
      el.readyBtn.style.display = (mySeatIndex === i) ? 'inline-block' : 'none';
      if (s && s.ready && el.readyBtn.style.display === 'inline-block') {
        el.readyBtn.textContent = 'Unready';
        el.readyBtn.style.background = '#ef4444';
      } else if (el.readyBtn.style.display === 'inline-block') {
        el.readyBtn.textContent = 'Ready';
        el.readyBtn.style.background = '#16a34a';
      }
    }

    positionSeats();
  }

  function renderBoard(cards) {
    // cards is array of 'chog-*.png' names from server
    boardLayer.innerHTML = '';
    if (!cards || !cards.length) return; // invisible when empty
    boardLayer.style.height = '12vmin';
    cards.forEach(src => {
      const c = mkCard(src);
      c.style.height = '12vmin';
      boardLayer.appendChild(c);
    });
  }

  function renderMyHole(cards) {
    myHoleLayer.innerHTML = '';
    if (!cards || cards.length === 0) return;
    cards.forEach(src => {
      const c = mkCard(src);
      c.style.height = '12vmin';
      myHoleLayer.appendChild(c);
    });
  }

  function occupiedSeatIndicesInOrderFrom(dealerSeatId) {
    const idxs = [];
    for (let k = 0; k < SEAT_COUNT; k++) {
      const si = (dealerSeatId + k) % SEAT_COUNT;
      if (seats[si]) idxs.push(si);
    }
    return idxs;
  }

  function isMyTurn() {
    if (!pState || mySeatIndex < 0) return false;
    const order = occupiedSeatIndicesInOrderFrom(pState.dealerSeatId);
    const seatIdForTurn = order[pState.turnIndex] ?? -1;
    return seatIdForTurn === mySeatIndex;
  }

  function updateControls() {
    if (isMyTurn()) {
      controls.style.display = 'flex';
      // Minimal heuristic text update (server decides legality anyway)
      btnCheck.textContent = pState && Number(pState.toCall||0) > 0 ? '—' : 'Check';
      btnCall.textContent  = pState && Number(pState.toCall||0) > 0 ? `Call` : '—';
      btnCheck.disabled = !!(pState && Number(pState.toCall||0) > 0);
      btnCall.disabled  = !(pState && Number(pState.toCall||0) > 0);
    } else {
      controls.style.display = 'none';
    }
  }

  /* ----------------------------- Event wiring ------------------------------ */
  socket.on('connect', () => {
    // Identify (ephemeral ok for F2P)
    safeEmit('identify', { addr: myAddr });
    // Join requested table
    safeEmit('join_table', { table: tableId });
    // Ask lobby list (optional)
    safeEmit('lobby:get', {});
  });

  socket.on('table:update', (t) => {
    try {
      renderTableUpdate(t);
      // controls may change if dealer or seat occupancy changed
      updateControls();
    } catch (e) { console.error('table:update render error', e); }
  });

  socket.on('poker:state', (s) => {
    try {
      pState = s || null;
      renderBoard(s?.community || []);
      updateControls();
    } catch (e) { console.error('poker:state error', e); }
  });

  // PRIVATE to you: your two cards as chog png names
  socket.on('poker:hole', (m) => {
    try {
      const cards = Array.isArray(m?.cards) ? m.cards : [];
      renderMyHole(cards);
    } catch (e) { console.error('poker:hole error', e); }
  });

  // Hand ended: reveal winners/board; clear my hole after a bit (server already clears)
  socket.on('poker:hand', (m) => {
    try {
      renderBoard(m?.community || []);
      setTimeout(() => { renderMyHole([]); }, 1200);
      controls.style.display = 'none';
    } catch (e) { console.error('poker:hand error', e); }
  });

  socket.on('system', (msg) => console.log('[system]', msg));
  socket.on('error', (e) => console.warn('[server-error]', e));

  /* ------------------------------ Utilities -------------------------------- */
  function shortAddr(a) {
    if (!a) return '';
    if (a.startsWith('sim:')) return a;
    if (a.length <= 10) return a;
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  // Initial paint
  positionSeats();
})();
