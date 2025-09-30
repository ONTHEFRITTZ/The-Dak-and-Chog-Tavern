// table.js — seat ellipse, sponsored pill gating, bottom-center toasts,
// and DevBot toggle that appears ONLY on F2P solo tables.

(function () {
  /* -------------------- utils -------------------- */
  const htmlMode = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
  const IS_ONCHAIN = htmlMode === 'onchain';

  const $ = (q, r = document) => r.querySelector(q);
  const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));
  const short = (a) => a && a.length > 10 ? (a.slice(0, 6) + '...' + a.slice(-4)) : (a || '');
  const lc = (s) => (s || '').toLowerCase();

  /* -------------------- toasts (bottom-center) -------------------- */
  (function ensureToastRoot () {
    if ($('#toast-root')) return;
    const root = document.createElement('div'); root.id = 'toast-root';
    document.body.appendChild(root);
  })();

  function toast(msg, opts = {}) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = 'toast' + (opts.error ? ' error' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), opts.persist ? 6500 : 3200);
    return el;
  }

  /* -------------------- DOM refs -------------------- */
  const canvas = $('.table-canvas');
  const surface = $('.table-surface');
  const centerEl = $('#poker-center');
  const seatEls = $$('.seat');

  // wallet chip UI
  const wiAddr = $('#wi-address');
  const wiDisc = $('#wi-disconnect');
  const wiDevBot = $('#wi-devbot');

  /* -------------------- layout seats on an outer ellipse -------------------- */
  function layoutSeats() {
    if (!canvas || !surface || seatEls.length === 0) return;

    const c = canvas.getBoundingClientRect();
    const s = surface.getBoundingClientRect();

    // ellipse that follows the *outside* of the leather rail
    const rail = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-thickness')) || 78;
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--seat-gap')) || 16;

    const rx = (s.width / 2) + rail / 2 + gap;   // slightly outside the image edge
    const ry = (s.height / 2) + rail / 2 + gap;

    // seat size for centering
    const probe = seatEls[0];
    const sw = (probe && probe.offsetWidth) || 150;
    const sh = (probe && probe.offsetHeight) || 160;

    // angles are tuned to align with mugs on poker-table.png art
    const base = [60, 15, -20, -60, -120, -165, 160, 120]; // degrees

    seatEls.forEach((el, i) => {
      const deg = base[i % base.length];
      const rad = (deg * Math.PI) / 180;
      const cx = c.width / 2;
      const cy = c.height / 2;

      const x = cx + rx * Math.cos(rad);
      const y = cy - ry * Math.sin(rad); // screen Y inverted

      el.style.left = Math.round(x - sw / 2) + 'px';
      el.style.top = Math.round(y - sh / 2) + 'px';
    });
  }

  /* -------------------- center banner -------------------- */
  function showCenter(msg, ms = 1200) {
    if (!centerEl) return;
    centerEl.textContent = msg;
    centerEl.style.display = 'block';
    if (ms > 0) setTimeout(() => { centerEl.style.display = 'none'; }, ms);
  }

  /* -------------------- socket (no auto-sim) -------------------- */
  let socket, tableId;
  let myAddr = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').toLowerCase();
  let mySeat = -1;
  let state = null;

  // DevBot local state (F2P only)
  let devBotEnabled = false;

  function initSocket() {
    try {
      socket = io(window.location.origin, { path: '/poker.io/', transports: ['websocket', 'polling'] });
    } catch (e) {
      showCenter('Socket unavailable', 1500);
      return;
    }

    socket.on('connect', () => {
      try {
        const u = new URL(location.href);
        tableId = u.searchParams.get('table');
        if (myAddr) socket.emit('identify', { addr: myAddr });
        socket.emit('join_table', { table: tableId });
        socket.emit('lobby:get');
        // Ask backend for current devbot state (harmless if not implemented)
        if (!IS_ONCHAIN) socket.emit('devbot:status', { table: tableId });
      } catch { }
    });

    socket.on('disconnect', () => { showCenter('Disconnected', 800); });

    // authoritative state—no auto-advance/simulation anywhere
    socket.on('poker:state', (m) => {
      state = m || null;
      renderTableModel(m?.table || null);
      updateActionBar();
      updateDevBotVisibility(m?.table || null);
    });

    socket.on('table:update', (t) => {
      renderTableModel(t);
      updateDevBotVisibility(t);
    });

    // optional devbot state echoes (if server supports)
    socket.on('devbot:state', (p) => {
      if (typeof p?.enabled === 'boolean') {
        devBotEnabled = !!p.enabled;
        syncDevBotButton();
      }
    });

    socket.on('poker:hole', () => updateActionBar());
    socket.on('poker:hand', () => updateActionBar());
    socket.on('table:reset', () => updateActionBar());
  }

  /* -------------------- render seats / controls shell -------------------- */
  function renderTableModel(t) {
    if (!t) return;
    const seats = Array.isArray(t.seats) ? t.seats : [];
    mySeat = -1;

    seatEls.forEach((el, i) => {
      const s = seats[i];
      el.innerHTML = '';

      const head = document.createElement('div');
      head.className = 'addr';
      head.textContent = s ? short(s.addr || ('Seat ' + i)) : 'Empty';
      el.appendChild(head);

      const btns = document.createElement('div');
      btns.className = 'btns';

      if (s) {
        if (myAddr && s.addr && lc(s.addr) === lc(myAddr)) {
          mySeat = i;

          const bLeave = document.createElement('button');
          bLeave.textContent = 'Leave';
          bLeave.onclick = () => socket?.emit('seat', { index: -1 });
          btns.appendChild(bLeave);

          const bReady = document.createElement('button');
          bReady.textContent = s.ready ? 'Unready' : 'Ready';
          bReady.onclick = () => socket?.emit('ready', { ready: !s.ready });
          btns.appendChild(bReady);
        }
      } else {
        const bSit = document.createElement('button');
        bSit.textContent = 'Sit';
        if (!myAddr) bSit.disabled = true;
        bSit.onclick = () => socket?.emit('seat', { index: i });
        btns.appendChild(bSit);
      }

      el.appendChild(btns);
    });

    layoutSeats();
  }

  /* -------------------- action bar (under my seat) -------------------- */
  let actionBarEl = null;
  function updateActionBar() {
    if (mySeat < 0 || !state || !Array.isArray(state.actors)) {
      if (actionBarEl) { actionBarEl.remove(); actionBarEl = null; }
      return;
    }

    const idx = state.turnIndex | 0;
    const actor = state.actors[idx];
    if (!actor || actor.seatId !== mySeat || actor.folded) {
      if (actionBarEl) { actionBarEl.remove(); actionBarEl = null; }
      return;
    }

    if (!actionBarEl) {
      actionBarEl = document.createElement('div');
      actionBarEl.className = 'action-bar';
      canvas.appendChild(actionBarEl);
    }

    // anchor just below my seat
    const me = seatEls[mySeat];
    const r = me.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    actionBarEl.style.left = (r.left - c.left + r.width / 2) + 'px';
    actionBarEl.style.top = (r.top - c.top + r.height + 8) + 'px';

    const need = Math.max(0, Number(state.toCall || 0) - Number(actor.contrib || 0));
    actionBarEl.innerHTML = '';

    const bFold = document.createElement('button');
    bFold.textContent = 'Fold';
    bFold.onclick = () => socket?.emit('poker:act', { action: 'fold' });
    actionBarEl.appendChild(bFold);

    const bCC = document.createElement('button');
    bCC.textContent = need > 0 ? `Call ${need}` : 'Check';
    bCC.onclick = () => socket?.emit('poker:act', { action: (need > 0 ? 'call' : 'check') });
    actionBarEl.appendChild(bCC);

    const raiseAmt = need + Number(state.bigBlind || 0);
    const bRaise = document.createElement('button');
    bRaise.textContent = `Raise ${raiseAmt}`;
    bRaise.onclick = () => socket?.emit('poker:act', { action: 'raise', amount: raiseAmt });
    actionBarEl.appendChild(bRaise);
  }

  /* -------------------- DevBot (F2P solo only) -------------------- */
  function countOtherHumans(table) {
    if (!table || !Array.isArray(table.seats)) return 0;
    return table.seats.filter(s =>
      s && s.addr && lc(s.addr) !== lc(myAddr) && !String(s.addr).toLowerCase().includes('bot')
    ).length;
  }

  function updateDevBotVisibility(table) {
    if (!wiDevBot) return;
    // Show only when: F2P, I'm seated, and there are NO other humans.
    const others = countOtherHumans(table);
    const shouldShow = !IS_ONCHAIN && mySeat >= 0 && others === 0;
    wiDevBot.style.display = shouldShow ? '' : 'none';
  }

  function syncDevBotButton() {
    if (!wiDevBot) return;
    wiDevBot.textContent = devBotEnabled ? 'Disable DevBot' : 'Enable DevBot';
    wiDevBot.title = 'F2P solo only';
  }

  if (wiDevBot) {
    wiDevBot.addEventListener('click', () => {
      if (IS_ONCHAIN) return; // guard, though button won’t show on on-chain
      const next = !devBotEnabled;
      devBotEnabled = next;
      syncDevBotButton();
      try {
        socket?.emit('devbot:toggle', { table: tableId, enable: next });
        toast(next ? 'DevBot enabled' : 'DevBot disabled');
      } catch {
        toast('DevBot toggle failed', { error: true });
      }
    });
  }

  /* -------------------- wallet sync -------------------- */
  function setKnownAddress(addr) {
    myAddr = lc(addr || '');
    try {
      if (myAddr) {
        localStorage.setItem('walletConnected', 'true');
        localStorage.setItem('walletAddress', myAddr);
        sessionStorage.setItem('walletConnected', 'true');
        sessionStorage.setItem('walletAddress', myAddr);
        wiAddr.textContent = short(myAddr);
        wiDisc.style.display = '';
      }
    } catch { }
    try { if (socket?.connected && myAddr) socket.emit('identify', { addr: myAddr }); } catch { }
  }

  window.addEventListener('wallet:connected', (e) => {
    const a = e?.detail?.address || e?.detail?.addr;
    if (a) setKnownAddress(a);
  });

  if (wiDisc) wiDisc.onclick = () => {
    try { localStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletConnected'); } catch { }
    location.replace('/landing.html');
  };

  /* -------------------- boot -------------------- */
  window.addEventListener('resize', () => requestAnimationFrame(layoutSeats));
  requestAnimationFrame(layoutSeats);
  window.addEventListener('load', () => { layoutSeats(); setTimeout(layoutSeats, 50); setTimeout(layoutSeats, 300); });

  initSocket();
  if (myAddr) setKnownAddress(myAddr);
})();
