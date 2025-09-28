/* Poker Table UI (8-max) — OFFCHAIN sim chips + wallet choice carry-over */
(function(){
  /* ---------- DOM ---------- */
  const centerEl   = document.getElementById('poker-center');
  const seatsEls   = Array.from(document.querySelectorAll('.seat'));
  const wiAddrEl   = document.getElementById('wi-address');
  const btnDisc    = document.getElementById('wi-disconnect');
  const btnDevBot  = document.getElementById('toggle-dev-bot');
  const sbWallet   = document.getElementById('sb-wallet');

  /* ---------- URL / globals ---------- */
  function getParam(k){ try{ return new URL(window.location.href).searchParams.get(k) }catch{ return null } }
  const tableId = getParam('table');

  let socket = null;
  let myAddr = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').toLowerCase();
  let isSim  = true;

  function short(a){ return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }
  function lc(s){ return (s||'').toLowerCase(); }

  /* ---------- Provider selection carried from landing ---------- */
  function getSelectedProvider(){
    const key = (sessionStorage.getItem('walletProvider') || '').toLowerCase();
    if (key === 'metamask') {
      const eth = window.ethereum;
      if (eth?.isMetaMask) return eth;
      if (Array.isArray(eth?.providers)) {
        const mm = eth.providers.find(p => p && p.isMetaMask);
        if (mm) return mm;
      }
      return eth || null;
    }
    if (key === 'phantom') return window.phantom?.ethereum || null;
    // fallback
    if (window.phantom?.ethereum) return window.phantom.ethereum;
    if (window.ethereum) return window.ethereum;
    return window.__walletProvider || null;
  }
  async function resolveAddressFromSelection(){
    try {
      const prov = getSelectedProvider();
      if (!prov?.request) return null;
      const accts = await prov.request({ method:'eth_accounts' }).catch(()=>[]);
      const addr  = (accts && accts[0]) ? String(accts[0]) : null;
      return addr ? lc(addr) : null;
    } catch { return null; }
  }
  function applyKnownAddress(addr){
    myAddr = lc(addr || '');
    if (wiAddrEl) wiAddrEl.textContent = myAddr ? short(myAddr) : '-';
    if (sbWallet) sbWallet.textContent = myAddr ? short(myAddr) : '—';
    try{
      if (myAddr){
        localStorage.setItem('walletConnected','true');
        sessionStorage.setItem('walletConnected','true');
        localStorage.setItem('walletAddress', myAddr);
        sessionStorage.setItem('walletAddress', myAddr);
      } else {
        localStorage.removeItem('walletAddress');
        sessionStorage.removeItem('walletAddress');
      }
    }catch{}
    if (socket?.connected && myAddr){
      try { socket.emit('identify', { addr: myAddr }); } catch {}
    }
  }

  // Disconnect button
  if (btnDisc){
    btnDisc.style.display = 'inline-block';
    btnDisc.onclick = () => {
      try {
        sessionStorage.removeItem('walletAddress');
        localStorage.removeItem('walletAddress');
        sessionStorage.removeItem('walletConnected');
        localStorage.removeItem('walletConnected');
        sessionStorage.removeItem('walletProvider');
        applyKnownAddress('');
        window.dispatchEvent(new CustomEvent('wallet:connected', { detail:{ address:'' } }));
      } catch {}
    };
  }

  // Adopt landing choice on load (no prompt)
  (async () => {
    const a = await resolveAddressFromSelection();
    if (a) applyKnownAddress(a);
  })();

  // Listen to global wallet events
  window.addEventListener('wallet:connected', (e)=>{
    const a = e?.detail?.address || e?.detail?.addr;
    if (a) applyKnownAddress(a);
  });

  /* ---------- Seat ring layout (spaced oval) ---------- */
  function layoutSeats(){
    const wrap = document.querySelector('.table-canvas');
    if (!wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const cx = W/2, cy = H/2;
    const rx = W * 0.46, ry = H * 0.44; // more space
    const positions = [270, 315, 0, 45, 90, 135, 180, 225];
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

  function showCenter(msg, ms=1500){
    if (!centerEl) return;
    centerEl.textContent = msg;
    centerEl.style.display = 'block';
    if (ms>0){ setTimeout(()=>{ centerEl.style.display='none'; }, ms); }
  }

  /* ---------- Rendering ---------- */
  function renderTable(t){
    try{
      if (!t || t.id !== tableId) return;

      isSim = !!t.simulated;
      if (btnDevBot) btnDevBot.style.display = (isSim ? 'inline-block' : 'none');

      const seats = Array.isArray(t.seats) ? t.seats : [];
      seatsEls.forEach((el, i)=>{
        const s = seats[i];
        el.innerHTML = '';

        const head = document.createElement('div');
        head.className = 'addr';
        head.textContent = s ? short(s.addr||('Seat '+i)) : 'Empty';
        el.appendChild(head);

        const info = document.createElement('div');
        info.style.fontSize = '12px';
        info.style.opacity = '0.9';
        if (s && isSim) {
          info.textContent = `Chips: ${Number(s.chips||0)}`;
          el.appendChild(info);
        }

        const btns = document.createElement('div');
        btns.className = 'btns';

        if (s){
          const mine = myAddr && s.addr && lc(s.addr)===lc(myAddr);
          if (mine){
            const bLeave = document.createElement('button');
            bLeave.textContent = 'Leave';
            bLeave.onclick = ()=> socket?.emit('seat',{ index:-1 });
            btns.appendChild(bLeave);

            const bReady = document.createElement('button');
            bReady.textContent = s.ready ? 'Unready' : 'Ready';
            bReady.style.marginLeft='6px';
            bReady.onclick = ()=> socket?.emit('ready', { ready: !s.ready });
            btns.appendChild(bReady);

            if (isSim) {
              const bBuy = document.createElement('button');
              bBuy.textContent = 'Buy 100';
              bBuy.style.marginLeft = '6px';
              bBuy.onclick = ()=> socket?.emit('sim:rebuy');
              if (Number(s.chips||0) <= 0) bBuy.style.boxShadow = '0 0 0 2px #ffd166';
              btns.appendChild(bBuy);
            }
          }
        } else {
          const bSit = document.createElement('button');
          bSit.textContent = 'Sit';
          if (!myAddr){ bSit.disabled = true; bSit.title = 'Connect wallet'; }
          bSit.onclick = ()=> { if (!myAddr) return; socket?.emit('seat', { index:i }); };
          btns.appendChild(bSit);
        }

        el.appendChild(btns);
      });

      if (sbWallet) sbWallet.textContent = myAddr ? short(myAddr) : '—';
      layoutSeats();
    }catch(e){ console.warn('renderTable', e); }
  }

  /* ---------- Socket ---------- */
  function initSocket(){
    try{
      socket = io(window.location.origin, {
        path:'/poker.io/',
        transports:['websocket'], upgrade:false,
        reconnection:true, reconnectionAttempts:10, reconnectionDelay:800,
        forceNew:true, withCredentials:true
      });
    }catch(e){ showCenter('Socket unavailable', 2000); return; }

    socket.on('connect', async ()=>{
      try{
        let addr = myAddr;
        if (!addr) {
          const resolved = await resolveAddressFromSelection();
          if (resolved) { addr = resolved; applyKnownAddress(resolved); }
        }
        if (addr) socket.emit('identify', { addr });
        socket.emit('join_table', { table: tableId });
        socket.emit('lobby:get');
      }catch{}
    });

    socket.on('disconnect', ()=> showCenter('Disconnected', 1200));

    socket.on('table:update', (t)=> renderTable(t));
    socket.on('table:state',  (t)=> renderTable(t));

    socket.on('poker:mode', (m)=>{ isSim = !!m?.simulated; });

    socket.on('poker:state', (m)=>{
      if (typeof m?.pot !== 'undefined') showCenter(`Stage: ${m.stage||'-'} • Pot: ${m.pot}`, 900);
    });

    socket.on('poker:hand', (h)=>{
      try{
        const winners = Array.isArray(h?.winners) ? h.winners : [];
        if (winners.length){
          const names = winners.map(w=> short(w.addr)).join(', ');
          showCenter(`Hand complete — Winner: ${names}`, 1600);
        } else {
          showCenter('Hand complete', 1200);
        }
      }catch{}
    });

    if (btnDevBot){
      btnDevBot.onclick = ()=> { try { socket.emit('poker:devbot', { enabled: true }); showCenter('Dev bot toggled', 800); } catch {} };
    }
  }

  /* ---------- Bootstrap ---------- */
  initSocket();
  if (myAddr) applyKnownAddress(myAddr);
})();