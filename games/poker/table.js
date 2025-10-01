/* games/poker/table.js — F2P-first, safe init, seat/ready/leave + DevBot toggle */

(() => {
  // --------- DOM refs ----------
  const seats = Array.from(document.querySelectorAll('.seat'));
  const center = document.getElementById('poker-center');
  const wiAddrEl = document.getElementById('wi-address');
  const devbotBtn = document.getElementById('wi-devbot');
  const discBtn = document.getElementById('wi-disconnect');

  // --------- State ----------
  const qp = new URL(location.href).searchParams;
  const tableId = qp.get('table') || 'poker-sim-1';
  let myAddr = null;
  let tableState = null;

  // predeclare before any function uses them (avoid TDZ errors)
  const seatCards = Array(8).fill(null).map(() => []); // future use (hole cards)
  const boardCards = [];                                // future use (community)

  // --------- Helpers ----------
  const short = (a) => (a && a.length > 10 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a || '—');

  function cardImageUrl(code) {
    // Accepts "QS" or {rank:'queen', suit:'spades'} or "chog-queen-of-spades"
    if (typeof code === 'string' && code.includes('-of-')) {
      return `/assets/images/chog_cards/${code}.png`;
    }
    if (typeof code === 'string' && code.length === 2) {
      const rankMap = { A:'ace', K:'king', Q:'queen', J:'jack', T:'ten', '9':'nine','8':'eight','7':'seven','6':'six','5':'five','4':'four','3':'three','2':'two' };
      const suitMap = { S:'spades', H:'hearts', D:'diamonds', C:'clubs' };
      const r = rankMap[code[0].toUpperCase()], s = suitMap[code[1].toUpperCase()];
      return `/assets/images/chog_cards/chog-${r}-of-${s}.png`;
    }
    if (code && code.rank && code.suit) {
      return `/assets/images/chog_cards/chog-${code.rank}-of-${code.suit}.png`;
    }
    return '/assets/images/chog_cards/dak-and-chog-cardback.png';
  }

  function setBanner(msg) {
    if (!center) return;
    if (msg) { center.textContent = msg; center.style.display = 'block'; }
    else { center.textContent = ''; center.style.display = 'none'; }
  }

  function hydrateWallet() {
    try {
      // prefer tavern if present; fallback to session storage
      const tAddr = (window.tavern && window.tavern.wallet && window.tavern.wallet.address) || null;
      const ssAddr = sessionStorage.getItem('walletAddr') || null;
      myAddr = (tAddr || ssAddr || '').toLowerCase() || null;
      if (myAddr && wiAddrEl) wiAddrEl.textContent = short(myAddr);
      if (discBtn) discBtn.style.display = 'inline-block';
    } catch { /*noop*/ }
  }

  function ensureIdentified() {
    if (myAddr) return true;
    setBanner('No wallet address detected. Please reconnect on the landing page.');
    return false;
  }

  // --------- Seat & controls render ----------
  function renderSeats() {
    const st = tableState || {};
    seats.forEach((el) => {
      const i = Number(el.dataset.index);
      const s = (st.seats && st.seats[i]) || null;

      // reset seat content
      el.innerHTML = '';

      const label = document.createElement('div');
      label.className = 'seat-label';

      if (s) {
        label.textContent = short(s.addr);
        el.appendChild(label);

        if (s.addr === myAddr) {
          // Leave seat
          const leave = document.createElement('button');
          leave.className = 'seat-leave';
          leave.textContent = 'Leave seat';
          leave.onclick = () => socket.emit('seat', { index: -1 });
          el.appendChild(leave);

          // Ready / Unready
          const ready = document.createElement('button');
          ready.className = 'seat-ready';
          ready.textContent = s.ready ? 'Unready' : 'Ready';
          ready.onclick = () => socket.emit('ready', { ready: !s.ready });
          el.appendChild(ready);

          // Rebuy for F2P when bust
          if (st.simulated) {
            const chips = Number(s.chips || 0);
            if (chips <= 0) {
              const rb = document.createElement('button');
              rb.className = 'seat-rebuy';
              rb.textContent = 'Rebuy 100';
              rb.onclick = () => socket.emit('sim:rebuy');
              el.appendChild(rb);
            }
          }
        } else {
          // Other player seat: show a single cardback to signal hidden hole cards
          const back = document.createElement('img');
          back.alt = 'Card back';
          back.src = '/assets/images/chog_cards/dak-and-chog-cardback.png';
          back.className = 'seat-cardback';
          el.appendChild(back);
        }
      } else {
        // Empty seat → Sit button
        const sit = document.createElement('button');
        sit.className = 'seat-sit';
        sit.textContent = 'Sit';
        sit.onclick = () => { if (ensureIdentified()) socket.emit('seat', { index: i }); };
        el.appendChild(sit);
      }
    });
  }

  // --------- DevBot visibility & toggle ----------
  function setDevbotVisibility() {
    if (!devbotBtn) return;
    const st = tableState || {};
    const humans = (st.seats || []).filter(s => s && typeof s.addr === 'string' && !s.addr.startsWith('bot:')).length;
    // Only show on F2P, exactly one human
    if (st.simulated && humans === 1) {
      devbotBtn.style.display = 'inline-block';
      devbotBtn.disabled = false;
    } else {
      devbotBtn.style.display = 'none';
    }
  }

  if (devbotBtn) {
    devbotBtn.addEventListener('click', () => {
      if (!tableState?.simulated) return;
      socket.emit('devbot', { table: tableId, enable: !tableState.devBotEnabled });
    });
  }

  // --------- Geometry (ellipse around the felt) ----------
  function recomputeGeom() {
    const wrap = document.querySelector('.table-canvas');
    if (!wrap) return;

    const rect = wrap.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height * 0.52;  // slightly below center looks better
    const rx = rect.width * 0.38;
    const ry = rect.height * 0.36;

    // 8 seats, clockwise starting near bottom-center
    const angles = [260, 300, 340, 20, 60, 120, 180, 220].map(a => a * Math.PI / 180);

    seats.forEach((el, i) => {
      const a = angles[i];
      const x = cx + rx * Math.cos(a);
      const y = cy + ry * Math.sin(a);
      el.style.position = 'absolute';
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
      el.style.transform = 'translate(-50%, -50%)';
      el.style.pointerEvents = 'auto';
    });
  }

  window.addEventListener('resize', recomputeGeom);

  // --------- Socket.IO ----------
  const socket = io({ path: '/socket.io/' });

  socket.on('connect', () => {
    hydrateWallet();
    if (myAddr) socket.emit('identify', { addr: myAddr });
    socket.emit('join_table', { table: tableId });
    socket.emit('lobby:get');
  });

  socket.on('rt:state', () => { /* not used yet */ });

  socket.on('table:update', (pub) => {
    tableState = pub;
    setDevbotVisibility();
    renderSeats();
    recomputeGeom();
    setBanner(''); // clear any wallet warning once updates flow
  });

  socket.on('table:started', (pub) => {
    tableState = pub;
    setDevbotVisibility();
    renderSeats();
  });

  // Private hole cards just for me
  socket.on('poker:hole', (m) => {
    try {
      const mySeatIndex = (tableState?.seats || []).findIndex(s => s && s.addr === myAddr);
      if (mySeatIndex >= 0) {
        const el = seats[mySeatIndex];
        // clear old holes
        Array.from(el.querySelectorAll('img.seat-hole')).forEach(n => n.remove());
        // add my 2 cards
        (m.cards || []).slice(0, 2).forEach((code, k) => {
          const img = document.createElement('img');
          img.className = 'seat-hole';
          img.src = cardImageUrl(code);
          img.alt = 'Hole';
          img.style.marginLeft = k ? '10px' : '0';
          el.appendChild(img);
        });
      }
    } catch { /* noop */ }
  });

  // (Optional) future events to animate: 'poker:state', 'poker:burn', 'poker:flop', 'poker:turn', 'poker:river', 'poker:hand'

  // --------- Disconnect button fallback ---------
  if (discBtn) {
    discBtn.addEventListener('click', () => {
      try { sessionStorage.removeItem('walletSigned'); } catch {}
      location.replace('/landing.html');
    });
  }

  // Initial layout
  hydrateWallet();
  renderSeats();
  recomputeGeom();
})();
