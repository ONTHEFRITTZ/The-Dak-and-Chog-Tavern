// games/poker/table.js — minimal, image-table version (no overlays)

(() => {
  const CARD_BACK = '/assets/images/chog_cards/dak-and-chog-cardback.png';

  // Map "Ah", "Td", etc → CHOG filenames. If unknown, fall back to back.
  function cardToImg(code) {
    if (!code) return CARD_BACK;
    if (typeof code === 'string') {
      const r = code.replace(/10/i,'T').trim();
      const m = /^([2-9TJQKA])([cdhs])$/i.exec(r);
      if (m) {
        const rankMap = { '2':'two','3':'three','4':'four','5':'five','6':'six','7':'seven','8':'eight','9':'nine','T':'ten','J':'jack','Q':'queen','K':'king','A':'ace' };
        const suitMap = { c:'clubs', d:'diamonds', h:'hearts', s:'spades' };
        const rr = rankMap[m[1].toUpperCase()];
        const ss = suitMap[m[2].toLowerCase()];
        if (rr && ss) return `/assets/images/chog_cards/chog-${rr}-of-${ss}.png`;
      }
    }
    return CARD_BACK;
  }

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Fixed seat positions (percentages) tuned for the poker-table.png image
  const SEAT_POS = [
    [50, 12],  // 0 top-center
    [78, 22],  // 1 top-right
    [90, 50],  // 2 right
    [78, 78],  // 3 bottom-right
    [50, 88],  // 4 bottom-center
    [22, 78],  // 5 bottom-left
    [10, 50],  // 6 left
    [22, 22],  // 7 top-left
  ];

  // Build a #board layer once (for community cards)
  const canvas = $('.table-canvas');
  let board = $('#board');
  if (!board) {
    board = document.createElement('div');
    board.id = 'board';
    canvas.appendChild(board);
  }

  const seats = $$('.seat');
  // Anchor seats around the rail
  seats.forEach((el, i) => {
    const [x, y] = SEAT_POS[i] || [50, 50];
    el.style.left = x + '%';
    el.style.top  = y + '%';
    if (!el.querySelector('.cards')) {
      const cards = document.createElement('div');
      cards.className = 'cards';
      el.appendChild(cards);
    }
    if (!el.querySelector('.addr')) {
      const addr = document.createElement('div');
      addr.className = 'addr';
      el.appendChild(addr);
    }
    if (!el.querySelector('.btns')) {
      const btns = document.createElement('div');
      btns.className = 'btns';
      el.appendChild(btns);
    }
  });

  // Socket
  const socket = window.io ? window.io({ path: '/socket.io/' }) : null;
  if (!socket) {
    console.error('Socket.IO missing');
    return;
  }

  // Identify helper: pull addr from wallet badge or tavern.js
  function currentAddr() {
    const t = ($('#wi-address')?.textContent || '').trim();
    if (/^0x[0-9a-fA-F]{4,}$/.test(t)) return t;
    if (window.__ADDR && /^0x/i.test(window.__ADDR)) return window.__ADDR;
    if (window.tavern && /^0x/i.test(window.tavern.addr || '')) return window.tavern.addr;
    return null;
  }
  function ensureIdentify() {
    const a = currentAddr();
    if (a) socket.emit('identify', { addr: a });
  }

  // Which table?
  const qp = new URL(location.href).searchParams;
  const tableId = qp.get('table') || 'poker-sim-1';

  // Local state
  let lastTable = null; // server public table snapshot
  let mySeat = -1;      // index of my seat when seated
  let lastStage = null; // to know when a hand starts/ends

  socket.on('connect', () => {
    ensureIdentify();
    socket.emit('join_table', { table: tableId });
  });

  socket.on('rt:state', () => { /* paused/rake — not critical for UI */ });

  // Render helpers
  function short(addr) {
    return addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : '—';
  }

  function clearSeatCards(idx) {
    const el = seats[idx];
    if (!el) return;
    const cards = el.querySelector('.cards');
    if (cards) cards.innerHTML = '';
  }

  function renderSeat(idx, data) {
    const el = seats[idx];
    if (!el) return;
    const btns = el.querySelector('.btns');
    const addrEl = el.querySelector('.addr');
    const mine = data && data.addr && currentAddr() && data.addr.toLowerCase() === currentAddr().toLowerCase();

    // Address / label
    addrEl.textContent = data ? short(data.addr) + (data.ready ? ' ✅' : '') : '';

    // Buttons
    btns.innerHTML = '';
    if (!data) {
      // Empty — show Sit
      const b = document.createElement('button');
      b.textContent = 'Sit';
      b.onclick = () => { ensureIdentify(); socket.emit('seat', { index: idx }); };
      btns.appendChild(b);
    } else if (mine) {
      // My seat — Ready / Leave
      const ready = document.createElement('button');
      ready.textContent = data.ready ? 'Unready' : 'Ready';
      ready.onclick = () => socket.emit('ready', { ready: !data.ready });
      const leave = document.createElement('button');
      leave.textContent = 'Leave';
      leave.onclick = () => socket.emit('seat', { index: -1 });
      btns.appendChild(ready);
      btns.appendChild(leave);
    } else {
      // Occupied by someone else — no controls
    }
  }

  function renderAllSeats(table) {
    // Remember my seat
    const me = currentAddr();
    mySeat = -1;
    (table.seats || []).forEach((s, i) => {
      if (s && me && s.addr && s.addr.toLowerCase() === me.toLowerCase()) mySeat = i;
    });

    // Render buttons/labels
    for (let i = 0; i < seats.length; i++) {
      renderSeat(i, table.seats[i] || null);
    }
  }

  function renderBoard(community) {
    board.innerHTML = '';
    if (!community || !community.length) return; // keep hidden when empty
    community.forEach(c => {
      const img = document.createElement('div');
      img.className = 'card';
      img.style.backgroundImage = `url("${cardToImg(c)}")`;
      board.appendChild(img);
    });
  }

  // === Socket event wiring ===

  socket.on('table:update', (table) => {
    lastTable = table;
    renderAllSeats(table);
    // On any table update (like end-of-hand), clear board if no community in state
    // (the poker:state event will repaint it when present)
  });

  // Start of a hand / progression
  socket.on('poker:state', (st) => {
    // st: { stage, community, actors, toCall, turnIndex, ... }
    if (st?.community) renderBoard(st.community);
    if (lastStage !== st?.stage) {
      // New stage → clear seat cards at preflop start, then show backs for everyone
      if (st?.stage === 'preflop' && lastTable) {
        (lastTable.seats || []).forEach((s, i) => {
          clearSeatCards(i);
          if (s) {
            const el = seats[i];
            const cards = el.querySelector('.cards');
            // show two facedown backs for all occupied seats
            for (let k = 0; k < 2; k++) {
              const d = document.createElement('div');
              d.className = 'card';
              d.style.backgroundImage = `url("${CARD_BACK}")`;
              cards.appendChild(d);
            }
          }
        });
      }
      lastStage = st?.stage || null;
    }
  });

  // Your private hole cards
  socket.on('poker:private', (msg) => {
    // Expecting something like { seatId, cards: ['Ah','Td'] } or { addr, cards: [...] }
    const seatId = Number.isFinite(msg?.seatId) ? msg.seatId
      : (lastTable?.seats || []).findIndex(s => s && msg?.addr && s.addr?.toLowerCase() === String(msg.addr).toLowerCase());
    if (seatId < 0 || seatId >= seats.length) return;

    // If it's not me, keep them face down
    const mine = (seatId === mySeat);
    if (!mine) return;

    const el = seats[seatId];
    const cards = el.querySelector('.cards');
    if (!cards) return;
    cards.innerHTML = ''; // replace backs

    (msg.cards || []).slice(0, 2).forEach(code => {
      const d = document.createElement('div');
      d.className = 'card';
      d.style.backgroundImage = `url("${cardToImg(code)}")`;
      cards.appendChild(d);
    });
  });

  // End of hand / showdown
  socket.on('poker:hand', (msg) => {
    // Clear everything after a brief moment
    setTimeout(() => {
      // Clear seat cards
      for (let i = 0; i < seats.length; i++) clearSeatCards(i);
      // Clear board
      board.innerHTML = '';
      lastStage = null;
    }, 1500);
  });

  // Dev bot toggle (F2P only): only send if the server supports it; otherwise harmless no-op.
  const devBtn = $('#wi-devbot');
  if (devBtn) {
    devBtn.addEventListener('click', () => {
      socket.emit('devbot:toggle', { table: tableId }); // server handler may be devbot:set or devbot:toggle
    });
  }

  // Re-anchor seats when the canvas size changes
  const ro = new ResizeObserver(() => {
    seats.forEach((el, i) => {
      const [x, y] = SEAT_POS[i] || [50, 50];
      el.style.left = x + '%';
      el.style.top  = y + '%';
    });
  });
  ro.observe(canvas);

  // Join table right away for F2P; on-chain tables rely on tavern.js for wallet first.
  ensureIdentify();
  socket.emit('join_table', { table: tableId });
})();
