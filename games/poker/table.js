// table.js — drop-in replacement with AA route for chip contributions etc.
// Keeps your UI, sockets, and rendering intact. Adds AA auto-blinds + sponsor pill (no layout edits).

(function(){
  // --- Table mode (f2p | onchain) ---
  const htmlMode = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
  const qpMode = (new URL(location.href)).searchParams.get('mode');
  const TABLE_MODE = (qpMode ? String(qpMode).toLowerCase() : htmlMode) === 'onchain' ? 'onchain' : 'f2p';

  // ----- Minimal AA config / helpers (non-breaking) -----
  // Feature flag for auto-post blinds (on by default)
  window.__AA_AUTO_BLINDS = (typeof window.__AA_AUTO_BLINDS === 'boolean') ? window.__AA_AUTO_BLINDS : true;

  // Optional config override via table.html:
  //   <script>window.CONFIG = Object.assign(window.CONFIG||{}, {
  //     MONAD_EXPLORER_TX_BASE: "https://explorer.monad.xyz/tx/",
  //     BLINDS_WEI: { sb: "100000000000000", bb: "200000000000000" }
  //   });</script>
  const EXPLORER_TX_BASE =
    (window.CONFIG && window.CONFIG.MONAD_EXPLORER_TX_BASE) ||
    "https://explorer.monad.xyz/tx/";

  const BLINDS_WEI = (window.CONFIG && window.CONFIG.BLINDS_WEI) || {
    sb: "100000000000000",   // 0.0001 MON (test-friendly)
    bb: "200000000000000"    // 0.0002 MON
  };

  function isOnChainTableId(id) { return /^poker-(nl|fl)-/i.test(String(id || "")); }

  // Toasts (no CSS edits required)
  (function initToasts(){
    if (document.getElementById('toast-root')) return;
    const root = document.createElement('div');
    root.id = 'toast-root';
    Object.assign(root.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: '8px'
    });
    document.body.appendChild(root);
  })();
  function toast(msg, opts={}) {
    const el = document.createElement('div');
    el.role = 'status'; el.setAttribute('aria-live','polite');
    Object.assign(el.style, {
      background: opts.error ? '#3b0b0b' : '#0b3b1a',
      color: '#fff', padding: '10px 12px', borderRadius: '10px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)', maxWidth: '320px', fontSize: '14px'
    });
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => el.remove(), opts.persist ? 7000 : 3500);
    return el;
  }
  function addExplorerLink(toastEl, txHash) {
    if (!txHash) return;
    const wrap = document.createElement('div');
    wrap.style.marginTop = '6px';
    const a = document.createElement('a');
    a.textContent = 'View on Monad Explorer';
    a.href = EXPLORER_TX_BASE + txHash;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.style.fontSize = '12px'; a.style.textDecoration = 'underline';
    wrap.appendChild(a);
    toastEl.appendChild(wrap);
  }

  /* -------------------------- Config (sprite + layout) -------------------------- */
  const SPRITE_URL  = '/assets/images/cards/cards-sprite.png';
  const SPRITE_COLS = 13;
  const SPRITE_ROWS = 5;
  const SUIT_ROW = { h:0, d:1, c:2, s:3 };
  const RANKS   = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const BACK_POS = { row: 4, col: 0 };

  /* ------------------------------- DOM refs ------------------------------------ */
  const canvas     = document.querySelector('.table-canvas');
  const seatEls    = Array.from(document.querySelectorAll('.seat'));
  const centerEl   = document.getElementById('poker-center');

  function ensureOverlayEl(id, className, parent){
    let el = document.getElementById(id);
    if (!el){
      el = document.createElement('div');
      el.id = id;
      if (className) el.className = className;
      (parent||canvas).appendChild(el);
    }
    return el;
  }
  const boardEl    = ensureOverlayEl('board-cards', 'board', canvas);
  const burnsEl    = ensureOverlayEl('burn-pile', 'burn-pile', canvas);

  // Action bar under my seat (created on demand)
  let actionBarEl = null;

  /* ------------------------------- State --------------------------------------- */
  function qp(k){ try{ return new URL(window.location.href).searchParams.get(k) }catch{ return null } }
  const tableId = qp('table');
  const IS_ONCHAIN = (() => {
    // Prefer explicit mode, but also treat poker-nl-* / poker-fl-* as on-chain
    if (TABLE_MODE === 'onchain') return true;
    return isOnChainTableId(tableId);
  })();

  // Sponsored pill for on-chain tables
  (function sponsorPill(){
    if (!IS_ONCHAIN) return;
    if (document.getElementById('sponsored-pill')) return;
    const pill = document.createElement('div');
    pill.id = 'sponsored-pill';
    pill.textContent = 'Sponsored by Dak & Chog Tavern';
    Object.assign(pill.style, {
      position: 'fixed', top: '12px', right: '12px', background: '#111827', color: '#e5e7eb',
      padding: '8px 12px', borderRadius: '9999px', fontSize: '12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)', zIndex: 9999, opacity: 0.92
    });
    document.body.appendChild(pill);
  })();

  let socket;

  let myAddr   = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').toLowerCase();
  let mySeat   = -1;

  let state       = null;   // last 'poker:state'
  let myHole      = [];     // ['As','Kd'] when dealt
  let oppHasHole  = new Set(); // seatIds of opponents in-hand (we show backs)

  /* ------------------------------- Helpers ------------------------------------- */
  function short(a){ return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }
  function lc(s){ return (s||'').toLowerCase(); }

  function cardStylesFromCode(code){
    if (!code || typeof code !== 'string' || code.length < 2){
      return cardBackStyles();
    }
    const r = code[0].toUpperCase();
    const s = code[1].toLowerCase();
    const col = Math.max(0, RANKS.indexOf(r));
    const row = (s in SUIT_ROW) ? SUIT_ROW[s] : 0;
    return {
      backgroundImage: `url("${SPRITE_URL}")`,
      backgroundSize: `${SPRITE_COLS*100}% ${SPRITE_ROWS*100}%`,
      backgroundPosition: `${(col/(SPRITE_COLS-1))*100}% ${(row/(SPRITE_ROWS-1))*100}%`
    };
  }
  function cardBackStyles(){
    return {
      backgroundImage: `url("${SPRITE_URL}")`,
      backgroundSize: `${SPRITE_COLS*100}% ${SPRITE_ROWS*100}%`,
      backgroundPosition: `${(BACK_POS.col/(SPRITE_COLS-1))*100}% ${(BACK_POS.row/(SPRITE_ROWS-1))*100}%`
    };
  }

  function makeCardEl(code, hole=false, faceUp=true){
    const el = document.createElement('div');
    el.className = 'card' + (hole ? ' card--hole' : '');
    const styles = faceUp ? cardStylesFromCode(code) : cardBackStyles();
    el.style.backgroundImage = styles.backgroundImage;
    el.style.backgroundSize = styles.backgroundSize;
    el.style.backgroundPosition = styles.backgroundPosition;
    return el;
  }

  function burnsForStage(stage){
    if (stage === 'flop')  return 1;
    if (stage === 'turn')  return 2;
    if (stage === 'river') return 3;
    return 0;
  }

/* ---------- Seat ring layout (outside the table, 8 spots) ---------- */
/*
Tuning dials – adjust once to line up with the beer mugs:
- RING_INSET_X/Y: shrink (+) or grow (-) the ellipse taken from the table image.
- OUTWARD_OFFSET: how far OUTSIDE the rim to place seats.
- CENTER_BIAS_X/Y: small pixel nudges if the table art isn’t perfectly centered.
- DEALER_ANGLE_DEG: where Seat 0 goes; 270 = bottom, 90 = top, 0 = right.
*/
const RING_INSET_X     = 18;   // px inward from the table image on X (positive = slightly tighter)
const RING_INSET_Y     = 34;   // px inward from the table image on Y (positive = slightly tighter)
const OUTWARD_OFFSET   = 32;   // px OUTSIDE the table edge
const CENTER_BIAS_X    = 0;    // px, + moves to the right
const CENTER_BIAS_Y    = 4;    // px, + moves down
const DEALER_ANGLE_DEG = 270;  // Seat 0 at bottom (dealer)

function layoutSeats() {
  const wrap   = document.querySelector('.table-canvas');
  const surface= document.querySelector('.table-surface');
  if (!wrap || !surface || !seatEls.length) return;

  // Measure canvas and table image
  const cRect = wrap.getBoundingClientRect();
  const sRect = surface.getBoundingClientRect();

  // Seat size (use first seat as probe)
  const probe = seatEls[0];
  const seatW = (probe && probe.offsetWidth)  ? probe.offsetWidth  : 110;
  const seatH = (probe && probe.offsetHeight) ? probe.offsetHeight : 130;

  // Ellipse based on the table surface image (slightly inset to follow rim),
  // then push seats OUTSIDE by OUTWARD_OFFSET + half the seat depth in that axis.
  const cx = (sRect.left - cRect.left) + (sRect.width  / 2) + CENTER_BIAS_X;
  const cy = (sRect.top  - cRect.top ) + (sRect.height / 2) + CENTER_BIAS_Y;

  // “Rim” radii before pushing outward
  const rimRx = Math.max(0, (sRect.width  / 2) - RING_INSET_X);
  const rimRy = Math.max(0, (sRect.height / 2) - RING_INSET_Y);

  // How far to push outside the rim for each axis so seats don’t overlap the leather
  const pushX = OUTWARD_OFFSET + seatW * 0.50;   // 50% of seat width looks good
  const pushY = OUTWARD_OFFSET + seatH * 0.50;   // 50% of seat height looks good

  const N = seatEls.length || 8;

  for (let i = 0; i < N; i++) {
    // Seat 0 = dealer at DEALER_ANGLE_DEG (bottom by default), then clockwise
    const angDeg = DEALER_ANGLE_DEG + (i * 360 / N);
    const ang    = angDeg * Math.PI / 180;

    // “Outside” ellipse radii
    const rx = rimRx + pushX;
    const ry = rimRy + pushY;

    const x = cx + rx * Math.cos(ang);
    const y = cy + ry * Math.sin(ang);

    const el = seatEls[i];
    el.style.left = Math.round(x - seatW / 2) + 'px';
    el.style.top  = Math.round(y - seatH / 2) + 'px';
  }
}


  /* ------------------------------ Rendering ------------------------------------ */
  function showCenter(msg, ms=1200){
    if (!centerEl) return;
    centerEl.textContent = msg;
    centerEl.style.display = 'block';
    if (ms>0){ setTimeout(()=>{ centerEl.style.display='none'; }, ms); }
  }

  function clearBoard(){
    boardEl.innerHTML = '';
    burnsEl.innerHTML = '';
  }

  function renderBoard(){
    if (!state){ clearBoard(); return; }
    const cards = Array.isArray(state.community) ? state.community.slice(0,5) : [];
    boardEl.innerHTML = '';

    cards.forEach((code, i) => {
      const c = makeCardEl(code, false, true);
      c.dataset.slot = String(i);
      boardEl.appendChild(c);
    });

    const nBurns = burnsForStage(state.stage||'');
    burnsEl.innerHTML = '';
    for (let i=0; i<nBurns; i++){
      const back = makeCardEl(null, false, false);
      back.classList.add('card--burn');
      burnsEl.appendChild(back);
    }
  }

  function drawSeatCards(seatId){
    const el = seatEls[seatId];
    if (!el) return;

    let row = el.querySelector('.cards');
    if (!row){
      row = document.createElement('div');
      row.className = 'cards';
      el.insertBefore(row, el.firstChild.nextSibling);
    }
    row.innerHTML = '';

    if (seatId === mySeat && myHole && myHole.length){
      row.appendChild(makeCardEl(myHole[0], true, true));
      row.appendChild(makeCardEl(myHole[1], true, true));
      return;
    }

    if (oppHasHole.has(seatId)){
      row.appendChild(makeCardEl(null, true, false));
      row.appendChild(makeCardEl(null, true, false));
    }
  }

  function renderTableModel(t){
    if (!t || t.id !== tableId) return;

    // seats + buttons
    mySeat = -1;
    const seats = Array.isArray(t.seats) ? t.seats : [];

    seatEls.forEach((el, i)=>{
      const s = seats[i];
      el.innerHTML = '';

      // name / addr
      const head = document.createElement('div');
      head.className = 'addr';
      head.textContent = s ? short(s.addr||('Seat '+i)) : 'Empty';
      el.appendChild(head);

      // cards row (created on demand in drawSeatCards)
      const cardsRow = document.createElement('div');
      cardsRow.className = 'cards';
      el.appendChild(cardsRow);

      // buttons
      const btns = document.createElement('div');
      btns.className = 'btns';

      if (s){
        // me
        if (myAddr && s.addr && lc(s.addr)===lc(myAddr)){
          mySeat = i;

          // Leave
          const bLeave = document.createElement('button');
          bLeave.textContent = 'Leave';
          bLeave.onclick = async ()=> {
            // If this table is on-chain, try to mirror the action via AA first
            if (IS_ONCHAIN) {
              try {
                if (window.AgentOps?.leaveSeat) {
                  await window.AgentOps.leaveSeat(mySeat);
                } else if (window.AgentOps?.unseatSeat) {
                  await window.AgentOps.unseatSeat(mySeat);
                }
                toast('Left seat on-chain ✅');
              } catch(e){
                console.warn('AA leaveSeat failed', e);
                showCenter('Could not leave on-chain (sponsored).', 1200);
              }
            }
            // Always keep the socket model authoritative
            socket?.emit('seat',{ index:-1 });
          };
          btns.appendChild(bLeave);

          // Ready / Unready (UI state is server-driven)
          const bReady = document.createElement('button');
          bReady.textContent = s.ready ? 'Unready' : 'Ready';
          bReady.style.marginLeft='6px';
          bReady.onclick = ()=> socket?.emit('ready', { ready: !s.ready });
          btns.appendChild(bReady);
        }
      } else {
        // empty seat → Sit
        const bSit = document.createElement('button');
        bSit.textContent = 'Sit';
        if (!myAddr){ bSit.disabled = true; bSit.title = 'Connect wallet'; }
        bSit.onclick = async ()=> {
          if (!myAddr) return;

          // If this table is on-chain, try to mirror the action via AA first
          if (IS_ONCHAIN) {
            try {
              if (window.AgentOps?.joinSeat) {
                const res = await window.AgentOps.joinSeat(i);
                let txHash = res && (res.hash || res.txHash || res.transactionHash);
                if (!txHash && res?.wait) { const rcpt = await res.wait(); txHash = rcpt?.transactionHash || rcpt?.hash; }
                const t = toast('Seated on-chain ✅');
                addExplorerLink(t, txHash);
              } else if (window.AgentOps?.sitSeat) {
                const res = await window.AgentOps.sitSeat(i);
                let txHash = res && (res.hash || res.txHash || res.transactionHash);
                if (!txHash && res?.wait) { const rcpt = await res.wait(); txHash = rcpt?.transactionHash || rcpt?.hash; }
                const t = toast('Seated on-chain ✅');
                addExplorerLink(t, txHash);
              }
            } catch(e){
              console.warn('AA joinSeat failed', e);
              showCenter('Could not sit on-chain (sponsored).', 1200);
              // proceed anyway so server keeps flow moving
            }
          }

          // Always keep the socket model authoritative
          socket?.emit('seat', { index:i });
        };
        btns.appendChild(bSit);
      }

      el.appendChild(btns);
    });

    // After rebuilding, lay out and re-draw any known cards
    layoutSeats();
    renderBoard();
    refreshSeatCardBacksFromState(); // opp backs
    if (mySeat >= 0) drawSeatCards(mySeat);
  }


  function refreshSeatCardBacksFromState(){
    oppHasHole.clear();
    if (!state || !Array.isArray(state.actors)) return;

    state.actors.forEach(a => {
      if (!a) return;
      if (a.seatId === mySeat) return;
      if (a.folded) return;
      oppHasHole.add(a.seatId);
    });

    seatEls.forEach((_, i) => drawSeatCards(i));
  }

  function updateActionBar(){
    if (mySeat < 0 || !state || !Array.isArray(state.actors)) {
      if (actionBarEl){ actionBarEl.remove(); actionBarEl = null; }
      return;
    }

    const idx = state.turnIndex|0;
    const actor = state.actors[idx];
    if (!actor || actor.seatId !== mySeat || actor.folded){
      if (actionBarEl){ actionBarEl.remove(); actionBarEl = null; }
      return;
    }

    const need = Math.max(0, Number(state.toCall||0) - Number(actor.contrib||0));
    const under = seatEls[mySeat];

    if (!actionBarEl){
      actionBarEl = document.createElement('div');
      actionBarEl.className = 'action-bar';
      canvas.appendChild(actionBarEl);
    }
    const r = under.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    actionBarEl.style.left = (r.left - c.left + r.width/2) + 'px';
    actionBarEl.style.top  = (r.top  - c.top  + r.height + 10) + 'px';

    actionBarEl.innerHTML = '';

    // ---- Fold ----
    const bFold = document.createElement('button');
    bFold.textContent = 'Fold';
    bFold.onclick = ()=> {
      socket?.emit('poker:act', { action:'fold' });
      // no onchain tx for fold
    };
    actionBarEl.appendChild(bFold);

    // ---- Check / Call ----
    const bCheckCall = document.createElement('button');
    bCheckCall.textContent = (need > 0) ? `Call ${need}` : 'Check';
    bCheckCall.onclick = async ()=> {
      socket?.emit('poker:act', { action:(need>0?'call':'check') });
      if (IS_ONCHAIN && need>0){
        try {
          const res = await window.AgentOps?.contribute?.(mySeat, String(need));
          let txHash = res && (res.hash || res.txHash || res.transactionHash);
          if (!txHash && res?.wait) { const rcpt = await res.wait(); txHash = rcpt?.transactionHash || rcpt?.hash; }
          const t = toast('Call posted on-chain ✅');
          addExplorerLink(t, txHash);
        } catch(e){ console.warn(e); showCenter('Call tx failed'); }
      }
    };
    actionBarEl.appendChild(bCheckCall);

    // ---- Bet / Raise (simple fixed raise for demo) ----
    const bRaise = document.createElement('button');
    const raiseAmt = need + Number(state.bigBlind||0);
    bRaise.textContent = `Raise ${raiseAmt}`;
    bRaise.onclick = async ()=> {
      socket?.emit('poker:act', { action:'raise', amount:raiseAmt });
      if (IS_ONCHAIN){
        try {
          const res = await window.AgentOps?.contribute?.(mySeat, String(raiseAmt));
          let txHash = res && (res.hash || res.txHash || res.transactionHash);
          if (!txHash && res?.wait) { const rcpt = await res.wait(); txHash = rcpt?.transactionHash || rcpt?.hash; }
          const t = toast('Raise posted on-chain ✅');
          addExplorerLink(t, txHash);
        } catch(e){ console.warn(e); showCenter('Raise tx failed'); }
      }
    };
    actionBarEl.appendChild(bRaise);
  }

  /* --------------------------- Auto-blinds plumbing ---------------------------- */
  async function tryAutoPostBlind(kind, seatIndex, valueWei) {
    if (!window.AgentOps || typeof window.AgentOps.contribute !== 'function') return;
    const tag = `[AA:${kind}]`;
    let t = toast(`${tag} preparing sponsored operation…`, {persist:true});
    try {
      const res = await window.AgentOps.contribute(seatIndex, valueWei);
      let txHash = res && (res.hash || res.txHash || res.transactionHash);
      if (!txHash && res && typeof res.wait === 'function') {
        const rcpt = await res.wait(); txHash = rcpt && (rcpt.transactionHash || rcpt.hash);
      } else if (!txHash && res && typeof res.waitForTx === 'function') {
        const rcpt = await res.waitForTx(); txHash = rcpt && (rcpt.transactionHash || rcpt.hash);
      }
      t.textContent = `${tag} posted successfully ✅`;
      addExplorerLink(t, txHash);
    } catch (err) {
      console.warn('Auto blind failed', err);
      t.remove();
      toast(`${tag} failed: ${err?.shortMessage || err?.message || 'reverted'}`, {error:true});
    }
  }

  function installAutoBlinds(socket, getState, opts={}) {
    const timeoutMs = opts.timeoutMs || 9000;

    function handleMeta(meta) {
      const st = (typeof getState === 'function') ? getState() : {};
      if (!IS_ONCHAIN) return;
      if (!window.__AA_AUTO_BLINDS) return;

      const me = st.mySeat;
      if (me == null || me === -1) return;

      const sbSeat = meta?.sbSeat ?? meta?.smallBlindSeat ?? meta?.blinds?.sbSeat;
      const bbSeat = meta?.bbSeat ?? meta?.bigBlindSeat ?? meta?.blinds?.bbSeat;
      const sbWei = meta?.blinds?.sbWei || BLINDS_WEI.sb;
      const bbWei = meta?.blinds?.bbWei || BLINDS_WEI.bb;

      if (me === sbSeat) setTimeout(() => tryAutoPostBlind('SB', me, sbWei), 200);
      if (me === bbSeat) setTimeout(() => tryAutoPostBlind('BB', me, bbWei), 400);

      // server retains authority and will fallback off-chain after timeout
      setTimeout(() => {}, timeoutMs);
    }

    // Preferred dedicated meta hook
    socket.on('table:handMeta', handleMeta);

    // Back-compat: infer from poker:state snapshots
    socket.on('poker:state', (snap) => {
      const meta = snap?.handMeta || snap?.hand || snap?.blinds || {};
      if (meta && (meta.sbSeat != null || meta.bbSeat != null ||
                   meta.smallBlindSeat != null || meta.bigBlindSeat != null)) {
        handleMeta(meta);
      }
    });
  }

  /* ------------------------------ Socket wiring ------------------------------- */
  function initSocket(){
    try{
      socket = io(window.location.origin, {
        path:'/poker.io/',
        transports:['websocket','polling'],
        upgrade:true,
        reconnection:true,
        reconnectionAttempts:10,
        reconnectionDelay:800,
        forceNew:true
      });
    }catch(e){ showCenter('Socket unavailable', 1800); return; }

    socket.on('connect', ()=>{
      try{
        if (myAddr) socket.emit('identify', { addr: myAddr });
        socket.emit('join_table', { table: tableId });
        socket.emit('lobby:get');
      }catch{}
    });
    socket.on('disconnect', ()=> {
      showCenter('Disconnected', 1000);
      if (actionBarEl){ actionBarEl.remove(); actionBarEl = null; }
    });

    socket.on('table:update', (t)=> renderTableModel(t));
    socket.on('table:state',  (t)=> renderTableModel(t)); // back-compat

    socket.on('poker:state', (m)=>{
      state = m || null;
      renderBoard();
      refreshSeatCardBacksFromState();
      updateActionBar();

      if (typeof m?.pot !== 'undefined'){
        showCenter(`Stage: ${m.stage||'-'} • Pot: ${m.pot}`, 700);
      }

      if (state && Array.isArray(state.actors)){
        const me = state.actors.find(a => a && a.seatId === mySeat);
        if (me && me.folded){
          myHole = [];
          drawSeatCards(mySeat);
        }
      }
    });

    socket.on('poker:hole', (payload)=>{
      const arr = Array.isArray(payload?.cards) ? payload.cards.slice(0,2) : [];
      myHole = arr;
      if (mySeat >= 0) drawSeatCards(mySeat);
    });

    socket.on('poker:hole_clear', ()=>{
      myHole = [];
      if (mySeat >= 0) drawSeatCards(mySeat);
    });

    socket.on('poker:hand', (h)=>{
      try{
        const winners = Array.isArray(h?.winners) ? h.winners : [];
        if (winners.length){
          const names = winners.map(w=> short(w.addr)).join(', ');
          showCenter(`Hand complete — Winner: ${names}`, 1800);

          const usedCommunity = winners[0]?.usedCommunity || [];
          Array.from(boardEl.children).forEach((el, i)=>{
            if (usedCommunity.includes(i)) el.classList.add('card--win');
          });
          if (mySeat >= 0 && winners.some(w => lc(w.addr)===lc(myAddr))){
            const myW = winners.find(w => lc(w.addr)===lc(myAddr));
            const row = seatEls[mySeat].querySelector('.cards');
            if (row && Array.isArray(myW?.usedHole)){
              Array.from(row.children).forEach((el, i)=>{
                if (myW.usedHole.includes(i)) el.classList.add('card--win');
              });
            }
          }
        } else {
          showCenter('Hand complete', 1200);
        }
      }catch{}

      setTimeout(()=> {
        Array.from(boardEl.children).forEach(el=> el.classList.remove('card--win'));
        if (actionBarEl){ actionBarEl.remove(); actionBarEl = null; }
      }, 1800);
    });

    socket.on('table:reset', ()=>{
      myHole = [];
      clearBoard();
      seatEls.forEach((_, i)=> drawSeatCards(i));
      if (actionBarEl){ actionBarEl.remove(); actionBarEl = null; }
      showCenter('Table reset', 800);
    });

    // Install AA auto-blinds once we have the socket; getter supplies live mySeat
    installAutoBlinds(socket, () => ({ mySeat }));
  }

  /* ---------------------- Wallet sync from navbar/tavern ----------------------- */
  function setKnownAddress(addr){
    myAddr = lc(addr||'');
    try{
      if (myAddr){
        localStorage.setItem('walletConnected','true');
        sessionStorage.setItem('walletConnected','true');
        localStorage.setItem('walletAddress', myAddr);
        sessionStorage.setItem('walletAddress', myAddr);
      }
    }catch{}
    if (socket?.connected && myAddr){
      try{ socket.emit('identify', { addr: myAddr }); }catch{}
    }
  }
  window.addEventListener('wallet:connected', (e)=>{
    const a = e?.detail?.address || e?.detail?.addr;
    if (a) setKnownAddress(a);
  });

  /* ------------------------------- Bootstrap ----------------------------------- */
  // Reflow seats on viewport changes (safe no-op if already correct)
  window.addEventListener('resize', () => requestAnimationFrame(layoutSeats));

  // Run initial layout before any server state arrives, and re-check after paint
  requestAnimationFrame(layoutSeats);
  window.addEventListener('load', () => {
    layoutSeats();
    setTimeout(layoutSeats, 50);
    setTimeout(layoutSeats, 300);
  });

  // Preload sprite to avoid first-deal flash
  try{ (new Image()).src = SPRITE_URL; }catch(e){}

  // Initialize AA/execution client (non-blocking)
  try { window.AgentOps?.init?.(); } catch {}

  initSocket();
  if (myAddr) setKnownAddress(myAddr);

})();
