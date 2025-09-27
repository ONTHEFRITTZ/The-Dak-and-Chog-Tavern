// Poker Table UI (8-max) — shows personal hole cards, clears between hands.

(function(){
  /* ---------- DOM ---------- */
  const centerEl = document.getElementById('poker-center');
  const seatsEls = Array.from(document.querySelectorAll('.seat'));
  const sbWallet = document.getElementById('sb-wallet');
  const sbChips  = document.getElementById('sb-chips');
  const sbPNL    = document.getElementById('sb-pnl');
  const sbHands  = document.getElementById('sb-hands');
  const wiAddrEl = document.getElementById('wi-address');

  /* ---------- URL / globals ---------- */
  function getParam(k){ try{ return new URL(window.location.href).searchParams.get(k) }catch{ return null } }
  const tableId = getParam('table');
  let socket, myAddr = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').toLowerCase();
  let mySeat = -1;
  let myHole = [];       // e.g. ['As','Kh']
  let community = [];    // 5
  let state = null;      // last poker:state

  function short(a){ return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }
  function lc(s){ return (s||'').toLowerCase(); }

  /* ---------- Seat ring layout (8 spots) ---------- */
  function layoutSeats(){
    const wrap = document.querySelector('.table-canvas');
    if (!wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const cx = W/2, cy = H/2;
    const rx = W*0.36, ry = H*0.34;
    const positions = [
      270, 315,   0,  45,  // top arc (left -> right)
       90, 135, 180, 225   // bottom arc (right -> left)
    ];
    seatsEls.forEach((el,i)=>{
      const ang = (positions[i]||0) * Math.PI/180;
      const x = cx + rx * Math.cos(ang);
      const y = cy + ry * Math.sin(ang);
      el.style.left = Math.round(x - el.clientWidth/2) + 'px';
      el.style.top  = Math.round(y - el.clientHeight/2) + 'px';
    });
  }
  window.addEventListener('resize', layoutSeats);
  window.addEventListener('load', layoutSeats);

  /* ---------- Rendering ---------- */
  function renderTable(t){
    try{
      if (!t || t.id !== tableId) return;

      mySeat = -1;
      const seats = Array.isArray(t.seats) ? t.seats : [];

      seatsEls.forEach((el, i)=>{
        const s = seats[i];
        el.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'addr';
        head.textContent = s ? short(s.addr||('Seat '+i)) : 'Empty';
        el.appendChild(head);

        const btns = document.createElement('div');
        btns.className = 'btns';

        if (s){
          if (myAddr && s.addr && lc(s.addr)===lc(myAddr)){
            mySeat = i;
            const bLeave = document.createElement('button');
            bLeave.textContent = 'Leave';
            bLeave.onclick = ()=> socket?.emit('seat',{ index:-1 });
            btns.appendChild(bLeave);

            const bReady = document.createElement('button');
            bReady.textContent = s.ready ? 'Unready' : 'Ready';
            bReady.style.marginLeft='6px';
            bReady.onclick = ()=> socket?.emit('ready', { ready: !s.ready });
            btns.appendChild(bReady);
          }
        }else{
          const bSit = document.createElement('button');
          bSit.textContent = 'Sit';
          if (!myAddr){ bSit.disabled = true; bSit.title = 'Connect wallet'; }
          bSit.onclick = ()=> { if (!myAddr) return; socket?.emit('seat', { index:i }); };
          btns.appendChild(bSit);
        }

        el.appendChild(btns);
      });

      // Update small stats header
      if (sbWallet) sbWallet.textContent = myAddr ? short(myAddr) : '—';
      layoutSeats();
    }catch(e){ console.warn('renderTable', e); }
  }

  function showCenter(msg, ms=1500){
    if (!centerEl) return;
    centerEl.textContent = msg;
    centerEl.style.display = 'block';
    if (ms>0){ setTimeout(()=>{ centerEl.style.display='none'; }, ms); }
  }

  function clearCards(){
    myHole = [];
    community = [];
    // remove any card DOM if you add visuals later
  }

  /* ---------- Socket ---------- */
  function initSocket(){
    try{
      socket = io(window.location.origin, {
        path:'/poker.io/',
        transports:['polling','websocket'], upgrade:true, reconnection:true,
        reconnectionAttempts:10, reconnectionDelay:800, forceNew:true
      });
    }catch(e){ showCenter('Socket unavailable', 2000); return; }

    socket.on('connect', ()=>{
      try{
        if (myAddr) socket.emit('identify', { addr: myAddr });
        socket.emit('join_table', { table: tableId });
        socket.emit('lobby:get');
      }catch{}
    });
    socket.on('disconnect', ()=> showCenter('Disconnected', 1200));

    // table model
    socket.on('table:update', (t)=> renderTable(t));
    socket.on('table:state',  (t)=> renderTable(t)); // back-compat name

    // poker hand state (public)
    socket.on('poker:state', (m)=>{
      state = m || null;
      // community cards
      community = Array.isArray(m?.community) ? m.community.slice(0,5) : [];
      // simple center banner
      if (typeof m?.pot !== 'undefined'){
        showCenter(`Stage: ${m.stage||'-'} • Pot: ${m.pot}`, 800);
      }
    });

    // personal hole cards (only this socket receives)
    socket.on('poker:hole', (payload)=>{
      try{
        const arr = Array.isArray(payload?.cards) ? payload.cards.slice(0,2) : [];
        myHole = arr;
      }catch{}
    });

    // showdown / hand complete
    socket.on('poker:hand', (h)=>{
      try{
        // brief winner banner
        const winners = Array.isArray(h?.winners) ? h.winners : [];
        if (winners.length){
          const names = winners.map(w=> short(w.addr)).join(', ');
          showCenter(`Hand complete — Winner: ${names}`, 1800);
        }else{
          showCenter('Hand complete', 1200);
        }
      }catch{}
      // clear all local visuals after short delay
      setTimeout(()=>{ clearCards(); }, 600);
    });

    // explicit table reset from server (e.g., bot ejected, table cleared)
    socket.on('table:reset', ()=>{
      clearCards();
      showCenter('Table reset', 800);
    });
  }

  /* ---------- Wallet sync (listen to navbar/tavern.js) ---------- */
  function setKnownAddress(addr){
    myAddr = lc(addr||'');
    if (wiAddrEl) wiAddrEl.textContent = myAddr ? short(myAddr) : '-';
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

  // bootstrap
  initSocket();
  if (myAddr) setKnownAddress(myAddr);
})();
