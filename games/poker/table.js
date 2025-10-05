// games/poker/table.js ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â rebuilt minimal client for The Dak & Chog poker table
// Restores the image-based felt, seat layout, private hole handling, burn flashes,
// simple dealing animations, action controls.

(() => {
  const ASSET_BASE = '/assets/images/chog_cards/';
  const CARD_BACK = `${ASSET_BASE}dak-and-chog-cardback.png`;
  const TURN_MS = 25_000;

  const rankMap = {
    '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven',
    '8': 'eight', '9': 'nine', T: 'ten', J: 'jack', Q: 'queen', K: 'king', A: 'ace'
  };
  const suitMap = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };

  const STAGE_LABEL = {
    preflop: 'Pre-Flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River'
  };

  function readRingValue(name, fallback) {
    try {
      const cs = getComputedStyle(canvas);
      const raw = cs.getPropertyValue(name);
      const parsed = parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function seatPosition(index, total) {
    const rx = readRingValue('--ring-rx', 54);
    const ry = readRingValue('--ring-ry', 46);
    const rotation = readRingValue('--ring-rotation', -90);
    const angleDeg = rotation + (360 / total) * index;
    const rad = angleDeg * Math.PI / 180;
    const left = 50 + rx * Math.cos(rad);
    const top = 50 + ry * Math.sin(rad);
    return { left, top };
  }

  function positionSeats() {
    const total = seats.length || 8;
    seats.forEach((seat, idx) => {
      const { left, top } = seatPosition(idx, total);
      seat.style.left = `${left}%`;
      seat.style.top = `${top}%`;
    });
  }

  const canvas = document.querySelector('.table-canvas');
  if (!canvas) return;

  const seats = Array.from(document.querySelectorAll('.seat'));
  if (!seats.length) return;

 

  let board = canvas.querySelector('#board');
  if (!board) {
    board = document.createElement('div');
    board.id = 'board';
    board.className = 'board-cards';
    canvas.insertBefore(board, seats[0] || null);
  }
  board.classList.add('empty');

  let burnPile = canvas.querySelector('.burn-pile');
  if (!burnPile) {
    burnPile = document.createElement('div');
    burnPile.className = 'burn-pile';
    canvas.insertBefore(burnPile, seats[0] || null);
  }

  const centerBanner = document.getElementById('poker-center');
  const lastHandBox = document.getElementById('last-hand');
  const lastHandEl = document.getElementById('lh-content');

  positionSeats();

  const seatMeta = seats.map((seat) => {

    let timer = seat.querySelector('.timer');
    if (!timer) {
      timer = document.createElement('div');
      timer.className = 'timer';
      const fill = document.createElement('span');
      fill.className = 'fill';
      timer.appendChild(fill);
      seat.appendChild(timer);
    }

    let cards = seat.querySelector('.cards');
    if (!cards) {
      cards = document.createElement('div');
      cards.className = 'cards';
      seat.appendChild(cards);
    }

    let addr = seat.querySelector('.addr');
    if (!addr) {
      addr = document.createElement('div');
      addr.className = 'addr';
      addr.textContent = '';
      seat.appendChild(addr);
    }

    let btns = seat.querySelector('.btns');
    if (!btns) {
      btns = document.createElement('div');
      btns.className = 'btns';
      seat.appendChild(btns);
    }

    return {
      seat,
      cards,
      addr,
      btns,
      timerFill: seat.querySelector('.timer .fill')
    };
  });

  const actionBar = document.createElement('div');
  actionBar.className = 'action-bar hidden';
  const infoText = document.createElement('div');
  infoText.className = 'info';
  const foldBtn = document.createElement('button');
  foldBtn.textContent = 'Fold';
  const callBtn = document.createElement('button');
  callBtn.textContent = 'Check';
  const betInput = document.createElement('input');
  betInput.type = 'number';
  betInput.min = '0';
  betInput.step = '1';
  betInput.placeholder = 'Amount';
  betInput.className = 'bet-input';
  const betBtn = document.createElement('button');
  betBtn.textContent = 'Bet';
  actionBar.append(infoText, foldBtn, callBtn, betInput, betBtn);
  canvas.appendChild(actionBar);

  // Purge any non-address labels from seats immediately
  try {
    document.querySelectorAll('.seat .addr').forEach(el => {
      const txt = (el.textContent || '').trim();
      if (!/^0x[0-9a-fA-F]{6}\.\.\.[0-9a-fA-F]{4}$/.test(txt) && !/^0x[0-9a-fA-F]{40}$/.test(txt)) {
        el.textContent = '';
      }
    });
  } catch {}

  // Allow Enter key and simple keyboard shortcuts when action bar is visible
  betInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const act = betBtn.dataset.action || 'bet';
      sendAction(act, betInput.value);
    }
  });
  window.addEventListener('keydown', (e) => {
    if (actionBar.classList.contains('hidden')) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'f') { e.preventDefault(); sendAction('fold'); }
    if (k === 'c') { e.preventDefault(); const act = callBtn.dataset.action || 'check'; sendAction(act); }
    if (k === 'b') { e.preventDefault(); const act = betBtn.dataset.action || 'bet'; sendAction(act, betInput.value); }
  });

  function cardToImg(code) {
    if (!code) return CARD_BACK;
    const m = /^([2-9TJQKA])([cdhs])$/i.exec(code.trim());
    if (!m) return CARD_BACK;
    const rank = rankMap[m[1].toUpperCase()];
    const suit = suitMap[m[2].toLowerCase()];
    if (!rank || !suit) return CARD_BACK;
    return `${ASSET_BASE}chog-${rank}-of-${suit}.png`;
  }

  const $ = (s, el = document) => el.querySelector(s);
  const formatChips = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    if (Math.abs(n) >= 1000) return n.toLocaleString();
    if (Math.abs(n) >= 1) return n.toString();
    return n.toFixed(2);
  };
  const short = (addr) => {
    try {
      const s = String(addr || '');
      if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s.slice(0, 6) + '...' + s.slice(-4);
    } catch {}
    return '';
  };

  function storedAddr() {
    try {
      const direct = sessionStorage.getItem('walletAddress') || localStorage.getItem('walletAddress');
      if (direct && /^0x[0-9a-fA-F]{40}$/.test(direct)) return direct;
    } catch {}
    try {
      const msg = sessionStorage.getItem('walletMsg') || localStorage.getItem('walletMsg') || '';
      const match = msg.match(/Address:\s*(0x[0-9a-fA-F]{40})/i);
      if (match && match[1]) return match[1];
    } catch {}
    return null;
  }

  function currentAddr() {
    const saved = storedAddr();
    if (saved) return saved;
    const badge = ($('#wi-address')?.textContent || '').trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(badge)) return badge;
    if (window.__ADDR && /^0x[0-9a-fA-F]{40}$/i.test(String(window.__ADDR))) return window.__ADDR;
    if (window.tavern && /^0x[0-9a-fA-F]{40}$/i.test(String(window.tavern.addr || ''))) return window.tavern.addr;
    return null;
  }

  const qp = new URL(location.href).searchParams;
  const tableId = qp.get('table') || 'poker-sim-1';

  // Connect socket with environment-aware path
  const socket = (() => {
    if (!window.io) return null;
    try {
      const host = (location.hostname || '').toLowerCase();
      const isLocal = host === 'localhost' || host === '127.0.0.1';
      const path = isLocal ? '/socket.io/' : '/poker.io/';
      return window.io({
        path,
        transports: ['polling', 'websocket'],
        upgrade: true,
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 800,
      });
    } catch {
      try { return window.io(); } catch { return null; }
    }
  })();
  if (!socket) {
    console.error('Socket.IO missing');
    return;
  }

  let lastTable = null;
  let mySeat = -1;
  let lastStage = null;
  let lastCommunity = [];
  let currentState = null;
  let currentTurnSeat = -1;
  let timerRaf = null;
  

  async function ensureIdentify() {
    try {
      // Prefer any stored full address first
      let addr = currentAddr();
      if (!addr) {
        // Try injected provider
        let provider = null;
        try { if (typeof window.__getSelectedProvider === 'function') provider = window.__getSelectedProvider(); } catch {}
        if (!provider && window.ethereum?.request) provider = window.ethereum;
        if (provider?.request) {
          const accs = await provider.request({ method: 'eth_accounts' }).catch(() => []);
          if (Array.isArray(accs) && accs[0] && /^0x[0-9a-fA-F]{40}$/.test(String(accs[0]))) {
            addr = String(accs[0]);
            try { sessionStorage.setItem('walletAddress', addr); } catch {}
          }
        }
      }
      if (addr) {
        socket.emit('identify', { addr });
        return true;
      }
    } catch {}
    return false;
  }

  function seatIndexForAddr(addr) {
    if (!addr || !lastTable) return -1;
    const target = String(addr).toLowerCase();
    const seatsList = lastTable.seats || [];
    return seatsList.findIndex(s => s && String(s.addr || '').toLowerCase() === target);
  }

  function seatIndexForActor(actor) {
    if (!actor) return -1;
    if (Number.isFinite(actor.seatId)) return actor.seatId;
    return seatIndexForAddr(actor.addr);
  }

  function clearSeatCards(idx) {
    const meta = seatMeta[idx];
    if (!meta) return;
    meta.cards.innerHTML = '';
  }

  function setSeatCards(idx, cards, { faceDown = false } = {}) {
    const meta = seatMeta[idx];
    if (!meta) return;
    meta.cards.innerHTML = '';
    (cards || []).forEach(code => {
      const el = document.createElement('img');
      el.className = 'card deal';
      el.alt = '';
      el.src = faceDown ? CARD_BACK : cardToImg(code);
      meta.cards.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
    });
  }

  function renderBoard(cards) {
    const arr = Array.isArray(cards) ? cards : [];
    if (!arr.length) {
      board.innerHTML = '';
      board.classList.add('empty');
      return;
    }
    board.classList.remove('empty');
    const children = Array.from(board.children);
    arr.forEach((code, idx) => {
      let el = children[idx];
      if (!el) {
        el = document.createElement('img');
        el.className = 'card deal';
        el.alt = '';
        board.appendChild(el);
      }
      el.dataset.code = code;
      el.src = cardToImg(code);
      if (!el.classList.contains('show')) {
        requestAnimationFrame(() => el.classList.add('show'));
      }
    });
    while (board.children.length > arr.length) {
      board.removeChild(board.lastElementChild);
    }
  }

  function flashBurn() {
    burnPile.innerHTML = '';
    const el = document.createElement('img');
    el.className = 'card';
    el.alt = '';
    el.src = CARD_BACK;
    burnPile.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 180);
    }, 220);
  }

  function updateCenter(st) {
    if (!centerBanner) return;
    if (!st) {
      centerBanner.style.display = 'none';
      return;
    }
    const parts = [];
    const stage = STAGE_LABEL[st.stage] || st.stage;
    if (stage) parts.push(stage.toUpperCase());
    if (Number.isFinite(st.pot)) parts.push(`Pot ${formatChips(st.pot)}`);
    if (Number.isFinite(st.toCall) && st.toCall > 0) parts.push(`To Call ${formatChips(st.toCall)}`);
    if (!parts.length) {
      centerBanner.style.display = 'none';
      return;
    }
    centerBanner.textContent = parts.join(' - ');
    centerBanner.style.display = 'block';
  }

  function hideActionBar() {
    actionBar.classList.add('hidden');
    currentTurnSeat = -1;
  }

  function anchorActionBar() {
    const canvasRect = canvas.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    const desiredTop = (boardRect.bottom - canvasRect.top) + 20;
    const canvasHeight = canvasRect.height;
    const actionHeight = actionBar.offsetHeight || 0;
    let maxTop = canvasHeight - actionHeight - 24;
    const bottomMost = seatMeta.reduce((max, meta) => {
      if (!meta || !meta.seat) return max;
      const rect = meta.seat.getBoundingClientRect();
      return Math.max(max, rect.bottom - canvasRect.top);
    }, 0);
    if (bottomMost > 0) {
      maxTop = Math.min(maxTop, bottomMost - actionHeight - 24);
    }
    const minTop = Math.max((boardRect.bottom - canvasRect.top) + 12, 12);
    const top = Math.min(Math.max(minTop, desiredTop), maxTop);
    actionBar.style.top = `${top}px`;
  }

  function startTurnTimer(seatIdx) {
    if (timerRaf) cancelAnimationFrame(timerRaf);
    seatMeta.forEach(meta => {
      if (meta.timerFill) meta.timerFill.style.width = '0%';
      meta.seat.classList.remove('turn');
    });
    if (seatIdx < 0) return;
    const meta = seatMeta[seatIdx];
    if (!meta || !meta.timerFill) return;
    const deadline = performance.now() + TURN_MS;
    meta.seat.classList.add('turn');
    const tick = () => {
      const remaining = deadline - performance.now();
      const pct = Math.max(0, Math.min(1, remaining / TURN_MS));
      meta.timerFill.style.width = `${(1 - pct) * 100}%`;
      if (remaining > 0) {
        timerRaf = requestAnimationFrame(tick);
      } else {
        meta.timerFill.style.width = '100%';
        timerRaf = null;
      }
    };
    meta.timerFill.style.width = '0%';
    timerRaf = requestAnimationFrame(tick);
  }

  function clearTimers() {
    if (timerRaf) cancelAnimationFrame(timerRaf);
    timerRaf = null;
    seatMeta.forEach(meta => {
      if (meta.timerFill) meta.timerFill.style.width = '0%';
      meta.seat.classList.remove('turn');
    });
  }

  function sendAction(action, amount) {
    ensureIdentify();
    const payload = { action };
    if (action === 'bet' || action === 'raise') {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        console.warn('Invalid bet/raise amount');
        return;
      }
      payload.amount = amt;
    }
    socket.emit('poker:act', payload);
    hideActionBar();
  }

  foldBtn.addEventListener('click', () => sendAction('fold'));
  callBtn.addEventListener('click', () => {
    const action = callBtn.dataset.action || 'check';
    sendAction(action);
  });
  betBtn.addEventListener('click', () => {
    const action = betBtn.dataset.action || 'bet';
    sendAction(action, betInput.value);
  });

  function actorForSeat(state, seatIdx) {
    if (!Number.isInteger(seatIdx)) return null;
    if (!Array.isArray(state?.actors)) return null;
    return state.actors.find(actor => seatIndexForActor(actor) === seatIdx) || null;
  }

  function updateActionBar(turnSeat, state) {
    if (turnSeat < 0 || turnSeat !== mySeat) {
      hideActionBar();
      return;
    }
    const actor = actorForSeat(state, mySeat);
    const already = Number(actor?.contrib || 0);
    const target = Number(state?.toCall || 0);
    const toCall = Math.max(0, target - already);
    const raiseAction = target > 0 ? 'raise' : 'bet';
    callBtn.dataset.action = toCall > 0 ? 'call' : 'check';
    callBtn.textContent = toCall > 0 ? `Call ${formatChips(toCall)}` : 'Check';
    betBtn.dataset.action = raiseAction;
    betBtn.textContent = raiseAction === 'raise' ? 'Raise' : 'Bet';
    betInput.style.display = 'inline-block';
    betInput.value = '';
    betInput.placeholder = 'Bet amount';
    const needText = toCall > 0 ? `To call: ${formatChips(toCall)}` : 'Check or bet';
    infoText.textContent = `Your turn - ${needText}`;
    actionBar.classList.remove('hidden');
    // Enhance placeholder/min suggestions and button enablement
    try {
      const min = raiseAction === 'raise' ? Math.max(target * 2, 2) : 1;
      betInput.min = String(min);
      betInput.step = '1';
      betInput.placeholder = raiseAction === 'raise' ? ('Raise to ' + formatChips(min)) : 'Bet amount';
      const enableCheck = () => {
        const v = Number(betInput.value);
        const ok = Number.isFinite(v) && v >= min;
        betBtn.disabled = (raiseAction === 'raise') ? !ok : false;
      };
      betInput.oninput = enableCheck;
      enableCheck();
    } catch {}
    currentTurnSeat = turnSeat;
    anchorActionBar();
  }

  function updateSeatStates(state) {
    seatMeta.forEach(meta => {
      meta.seat.classList.remove('folded', 'acted', 'winner');
    });
    const actors = Array.isArray(state?.actors) ? state.actors : [];
    actors.forEach(actor => {
      const idx = seatIndexForActor(actor);
      if (idx < 0) return;
      const meta = seatMeta[idx];
      if (actor.folded) meta.seat.classList.add('folded');
      if (actor.acted) meta.seat.classList.add('acted');
    });
  }



  function isValidAddr(s) {
    try { return /^0x[0-9a-fA-F]{40}$/.test(String(s||'')); } catch { return false; }
  }

  function renderAllSeats(table) {
    lastTable = table;
    const me = (currentAddr() || '').toLowerCase();
    mySeat = -1;
    const list = table.seats || [];
    let humanCount = 0;
    list.forEach((seatData, idx) => {
      const meta = seatMeta[idx];
      if (!meta) return;
      const seatAddr = (seatData && seatData.addr ? seatData.addr : '').toLowerCase();
      const valid = seatData && isValidAddr(seatAddr);
      if (valid && seatAddr === me) {
        mySeat = idx;
        
      }
      if (valid) humanCount += 1;
      meta.addr.textContent = valid ? `${short(seatData.addr)}${seatData.ready ? ' [ready]' : ''}` : '';
      meta.seat.classList.toggle('occupied', !!valid);
      meta.seat.classList.toggle('ready', !!(valid && seatData.ready));
      meta.btns.innerHTML = '';
      if (!valid) {
        const sit = document.createElement('button');
        sit.textContent = 'Sit';
        sit.addEventListener('click', async () => {
          try { sit.disabled = true; sit.textContent = 'Seating...'; } catch {}
          const ok = await ensureIdentify();
          if (!ok) {
            try { sit.disabled = false; sit.textContent = 'Sit'; } catch {}
            alert('Connect your wallet first in the Tavern, then return to sit.');
            return;
          }
          socket.emit('seat', { index: idx });
        });
        meta.btns.appendChild(sit);
        meta.cards.innerHTML = '';
      } else if (seatAddr === me) {
        const leaveBtn = document.createElement('button');
        leaveBtn.textContent = 'Leave';
        leaveBtn.addEventListener('click', () => {
          ensureIdentify();
          // Server expects 'seat' with index -1 to leave current seat
          socket.emit('seat', { index: -1 });
        });
        meta.btns.appendChild(leaveBtn);
      }
    });
    try { seatMeta.forEach((m, i) => m.seat.classList.toggle('me', i === mySeat)); } catch {}
    // LastÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“chance DOM scrub: never display any nonÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“0x labels (e.g., legacy bot strings)
    try {
      document.querySelectorAll('.seat .addr').forEach(el => {
        const txt = (el.textContent || '').trim();
        if (!/^0x[0-9a-fA-F]{6}\.\.\.[0-9a-fA-F]{4}$/.test(txt) && !/^0x[0-9a-fA-F]{40}$/.test(txt)) {
          el.textContent = '';
        }
      });
    } catch {}
  }

  socket.on('connect', () => {
    // Attempt identify on connect; if no wallet connected, seat will be blocked server-side
    ensureIdentify();
    socket.emit('join_table', { table: tableId });
  });

  socket.on('table:update', (table) => {
    renderAllSeats(table);
  });

  socket.on('poker:state', (state) => {
    currentState = state;
    updateCenter(state);
    updateSeatStates(state);

    if (state?.stage !== lastStage) {
      if (state?.stage === 'preflop' && lastTable) {
        (lastTable.seats || []).forEach((seatData, idx) => {
          const saddr = seatData && String(seatData.addr||'').toLowerCase();
          const meAddr = (currentAddr()||'').toLowerCase();
          const valid = seatData && isValidAddr(saddr);
          if (valid && saddr !== meAddr) {
            setSeatCards(idx, [null, null], { faceDown: true });
          } else if (!valid) {
            clearSeatCards(idx);
          }
        });
        board.innerHTML = '';
        burnPile.innerHTML = '';
        lastCommunity = [];
      }
      lastStage = state?.stage || null;
    }

    if (Array.isArray(state?.community)) {
      if (state.community.length > lastCommunity.length && state.stage !== 'preflop') {
        flashBurn();
      }
      renderBoard(state.community);
      lastCommunity = state.community.slice();
    }

    const turnActor = Array.isArray(state?.actors) && Number.isFinite(state.turnIndex)
      ? state.actors[state.turnIndex] : null;
    const turnSeat = seatIndexForActor(turnActor);
    currentTurnSeat = turnSeat;
    startTurnTimer(turnSeat);
    updateActionBar(turnSeat, state);
  });

  socket.on('poker:private', (msg) => {
    const seatId = Number.isFinite(msg?.seatId) ? msg.seatId : seatIndexForAddr(msg?.addr);
    if (!Number.isInteger(seatId) || seatId < 0) return;
    if (mySeat < 0) mySeat = seatId;
    if (seatId !== mySeat) return;
    const cards = (msg.cards || []).slice(0, 2);
    setSeatCards(seatId, cards, { faceDown: false });
  });

  socket.on('poker:hand', (msg) => {
    clearTimers();
    hideActionBar();
    if (Array.isArray(msg?.community)) {
      renderBoard(msg.community);
      lastCommunity = msg.community.slice();
    }

    seatMeta.forEach(meta => meta.seat.classList.remove('winner'));

    if (Array.isArray(msg?.exposures)) {
      msg.exposures.forEach(ex => {
        const idx = Number.isFinite(ex?.seatId) ? ex.seatId : seatIndexForAddr(ex?.addr);
        if (idx >= 0) setSeatCards(idx, ex.cards || [], { faceDown: false });
      });
    }

    if (Array.isArray(msg?.winners) && msg.winners.length) {
      const names = msg.winners.map(w => short(w.addr)).join(', ');
      if (centerBanner) {
        centerBanner.textContent = `Winner: ${names}`;
        centerBanner.style.display = 'block';
      }
      msg.winners.forEach(w => {
        const idx = Number.isFinite(w?.seatId) ? w.seatId : seatIndexForAddr(w?.addr);
        if (idx >= 0) seatMeta[idx].seat.classList.add('winner');
      });
    }

    if (lastHandEl) {
      try {
        const winners = Array.isArray(msg?.winners) ? msg.winners : [];
        const names = winners.map(w => short(w?.addr || ''))
                             .filter(Boolean)
                             .join(', ');
        const pot = Number.isFinite(msg?.pot) ? (' +' + formatChips(msg.pot)) : '';
        lastHandEl.textContent = names ? ('Last: ' + names + pot) : 'Hand complete';
        if (lastHandBox) lastHandBox.style.display = '';
      } catch {
        try { if (lastHandBox) lastHandBox.style.display = 'none'; } catch {}
      }
    }

    setTimeout(() => {
      board.innerHTML = '';
      burnPile.innerHTML = '';
      lastStage = null;
      lastCommunity = [];
      seatMeta.forEach((meta, idx) => {
        if (!lastTable || !lastTable.seats || !lastTable.seats[idx]) {
          meta.cards.innerHTML = '';
        }
        meta.seat.classList.remove('winner', 'folded', 'acted', 'turn');
        if (meta.timerFill) meta.timerFill.style.width = '0%';
      });
      updateCenter(null);
    }, 1800);
  });

  window.addEventListener('resize', () => {
    positionSeats();
    if (!actionBar.classList.contains('hidden')) {
      anchorActionBar();
    }
  });

  const ro = new ResizeObserver(() => {
    positionSeats();
    if (!actionBar.classList.contains('hidden')) {
      anchorActionBar();
    }
  });
  ro.observe(canvas);

  ensureIdentify();
  socket.emit('join_table', { table: tableId });
  window.addEventListener('focus', ensureIdentify);
})();

