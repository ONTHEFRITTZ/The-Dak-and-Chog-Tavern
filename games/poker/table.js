// table.js — clean seat layout + no auto-sim + bottom-center toasts

(function () {
  /* -------------------- utils -------------------- */
  const htmlMode = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
  const IS_ONCHAIN = htmlMode === 'onchain';

  function $(q, r = document) { return r.querySelector(q); }
  function $all(q, r = document) { return Array.from(r.querySelectorAll(q)); }
  function short(a) { return a && a.length > 10 ? (a.slice(0, 6) + '...' + a.slice(-4)) : (a || ''); }
  function lc(s) { return (s || '').toLowerCase(); }

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
  const seatEls = $all('.seat');

  /* -------------------- layout seats on an outer ellipse -------------------- */
  function layoutSeats() {
    if (!canvas || !surface) return;

    const c = canvas.getBoundingClientRect();
    const s = surface.getBoundingClientRect();

    // ellipse that follows the *outside* of the leather rail
    const rail = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-thickness')) || 70;
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--seat-gap')) || 18;

    const rx = (s.width / 2) + rail / 2 + gap;   // a bit outside the image edge
    const ry = (s.height / 2) + rail / 2 + gap;

    // seat size for centering
    const probe = seatEls[0];
    const sw = (probe && probe.offsetWidth) || 150;
    const sh = (probe && probe.offsetHeight) || 160;

    // angles: leave dealer gap at top (90°). Start near top-right and go clockwise.
    // tweakable to align with mug lugs on your art.
    const base = [60, 15, -20, -60, -120, -165, 160, 120]; // degrees

    seatEls.forEach((el, i) => {
      const deg = base[i % base.length];
      const rad = (deg * Math.PI) / 180;
      const cx = c.width / 2;
      const cy = c.height / 2;

      const x = cx + rx * Math.cos(rad);
      const y = cy - ry * Math.sin(rad); // screen Y is inverted

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
  let socket, tableId, myAddr = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').toLowerCase();
  let mySeat = -1;
  let state = null;

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
      } catch { }
    });

    socket.on('disconnect', () => { showCenter('Disconnected', 800); });

    // authoritative state—no auto-advance/simulation anywhere
    socket.on('poker:state', (m) => {
      state = m || null;
      renderTableModel(m?.table || null);
      updateActionBar();
    });

    socket.on('table:update', (t) => renderTableModel(t));

    // dealt hole to me
    socket.on('poker:hole', (payload) => {
      // keep UI minimal here; you can extend as needed
      updateActionBar();
    });

    socket.on('poker:hand', () => { updateActionBar(); });
    socket.on('table:reset', () => { updateActionBar(); });
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

  /* -------------------- wallet sync -------------------- */
  function setKnownAddress(addr) {
    myAddr = lc(addr || '');
    try {
      if (myAddr) {
        localStorage.setItem('walletConnected', 'true');
        localStorage.setItem('walletAddress', myAddr);
        sessionStorage.setItem('walletConnected', 'true');
        sessionStorage.setItem('walletAddress', myAddr);
        $('#wi-address').textContent = short(myAddr);
        $('#wi-disconnect').style.display = '';
      }
    } catch { }
    try { if (socket?.connected && myAddr) socket.emit('identify', { addr: myAddr }); } catch { }
  }

  window.addEventListener('wallet:connected', (e) => {
    const a = e?.detail?.address || e?.detail?.addr;
    if (a) setKnownAddress(a);
  });

  const disc = $('#wi-disconnect');
  if (disc) disc.onclick = () => {
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
