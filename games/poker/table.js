// Poker Table UI (8-max), wallet choice carried from landing (no auto-preference)

(function(){
  /* ---------- DOM ---------- */
  const centerEl = document.getElementById('poker-center');
  const seatsEls = Array.from(document.querySelectorAll('.seat'));
  const sbWallet = document.getElementById('sb-wallet');
  const sbChips  = document.getElementById('sb-chips');
  const sbPNL    = document.getElementById('sb-pnl');
  const sbHands  = document.getElementById('sb-hands');
  const wiAddrEl = document.getElementById('wi-address');
  const btnDisconnect = document.getElementById('wi-disconnect');
  const btnDevBot     = document.getElementById('toggle-dev-bot');

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

  /* ---------- Wallet provider selection (from landing) ---------- */
  function pickMetaMask(){
    const eth = window.ethereum;
    if (!eth) return null;
    if (eth.isMetaMask) return eth;
    if (Array.isArray(eth.providers)) {
      const mm = eth.providers.find(p => p && p.isMetaMask);
      if (mm) return mm;
    }
    return eth;
  }
  function pickPhantom(){
    return (window.phantom && window.phantom.ethereum) ? window.phantom.ethereum : null;
  }
  function getSelectedProvider(){
    try {
      if (window.__walletProvider) return window.__walletProvider;
      const key = (sessionStorage.getItem('walletProvider') || '').toLowerCase();
      if (key === 'metamask') return pickMetaMask();
      if (key === 'phantom')  return pickPhantom();
    } catch {}
    return null;
  }

  /* ---------- Seat ring layout (8 spots, wider oval) ---------- */
function layoutSeats(){
  const wrap = document.querySelector('.table-canvas');
  if (!wrap) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const cx = W/2, cy = H/2;

  // Make the oval wider/taller → pushes seats outward
  const rx = W * 0.44;   // horizontal radius (was 0.36)
  const ry = H * 0.42;   // vertical radius (was 0.34)

  // Angles for 8 seats evenly distributed around oval
  const positions = [
    270, 315,   0,  45,   // top arc (left → right)
     90, 135, 180, 225    // bottom arc (right → left)
  ];

  seatsEls.forEach((el,i)=>{
    const ang = (positions[i]||0) * Math.PI/180;
    const x = cx + rx * Math.cos(ang);
    const y = cy + ry * Math.sin(ang);
    el.style.left = Math.round(x - el.clientWidth/2) + 'px';
    el.style.top  = Math.round(y - el.clientHeight/2) + 'px';
  });
}

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
  }

  /* ---------- Socket ---------- */
  function initSocket(){
    try{
      socket = io(window.location.origin, {
        path:'/poker.io/',
        transports:['websocket','polling'],
        upgrade:true, reconnection:true,
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
    socket.on('table:state',  (t)=> renderTable(t)); // back-compat

    // poker hand state (public)
    socket.on('poker:state', (m)=>{
      state = m || null;
      community = Array.isArray(m?.community) ? m.community.slice(0,5) : [];
      if (typeof m?.pot !== 'undefined'){
        showCenter(`Stage: ${m.stage||'-'} • Pot: ${m.pot}`, 800);
      }
    });

    // personal hole cards
    socket.on('poker:hole', (payload)=>{
      try{
        const arr = Array.isArray(payload?.cards) ? payload.cards.slice(0,2) : [];
        myHole = arr;
      }catch{}
    });

    // showdown / hand complete
    socket.on('poker:hand', (h)=>{
      try{
        const winners = Array.isArray(h?.winners) ? h.winners : [];
        if (winners.length){
          const names = winners.map(w=> short(w.addr)).join(', ');
          showCenter(`Hand complete — Winner: ${names}`, 1800);
        }else{
          showCenter('Hand complete', 1200);
        }
      }catch{}
      setTimeout(()=>{ clearCards(); }, 600);
    });

    socket.on('table:reset', ()=>{
      clearCards();
      showCenter('Table reset', 800);
    });
  }

  /* ---------- Wallet sync (selected provider only) ---------- */
  function setKnownAddress(addr){
    myAddr = lc(addr||'');
    if (wiAddrEl) wiAddrEl.textContent = myAddr ? short(myAddr) : '-';
    try{
      if (myAddr){
        localStorage.setItem('walletConnected','true');
        sessionStorage.setItem('walletConnected','true');
        localStorage.setItem('walletAddress', myAddr);
        sessionStorage.setItem('walletAddress', myAddr);
        if (btnDisconnect) btnDisconnect.style.display = '';
      } else {
        if (btnDisconnect) btnDisconnect.style.display = 'none';
      }
    }catch{}
    if (socket?.connected && myAddr){
      try{ socket.emit('identify', { addr: myAddr }); }catch{}
    }
    if (sbWallet) sbWallet.textContent = myAddr ? short(myAddr) : '—';
  }

  async function adoptFromSelectedProvider(){
    try{
      const provider = getSelectedProvider();
      if (!provider) { setKnownAddress(''); return; }
      const accts = await provider.request?.({ method:'eth_accounts' }).catch(()=>[]);
      const a = (accts && accts[0]) || '';
      setKnownAddress(a);
      if (provider.on){
        provider.on('accountsChanged', (arr)=> setKnownAddress((arr && arr[0]) || ''));
        provider.on('chainChanged', ()=>{}); // optional
      }
    }catch{
      setKnownAddress('');
    }
  }

  // Disconnect clears local state and returns to landing
  btnDisconnect?.addEventListener('click', ()=>{
    try {
      sessionStorage.removeItem('walletSigned');
      sessionStorage.removeItem('walletProvider');
      sessionStorage.removeItem('walletMsg');
      sessionStorage.removeItem('walletSig');
      sessionStorage.removeItem('walletAddress');
      localStorage.removeItem('walletAddress');
      localStorage.removeItem('walletConnected');
    } catch {}
    setKnownAddress('');
    // back to landing to pick a wallet again
    window.location.replace('/landing.html');
  });

  // Dev bot toggle (only effective on OFFCHAIN_NL tables)
  btnDevBot?.addEventListener('click', ()=>{
    try { socket?.emit('poker:devbot', { enabled: true }); } catch {}
  });

  /* ---------- Contract address into navbar/footer, if present ---------- */
  async function updateContractLabels(){
    try {
      const provider = getSelectedProvider();
      const mod = await import('../../js/config.js').catch(()=>null);
      if (!mod || !mod.getAddressFor) return;
      let ethersProvider = null;
      if (window.ethers && provider) {
        ethersProvider = new window.ethers.providers.Web3Provider(provider, 'any');
      }
      const addr = await mod.getAddressFor('pokerTable', ethersProvider);
      if (!addr) return;
      const shortAddr = addr.slice(0,6) + '...' + addr.slice(-4);
      ['contract-address','nav-contract','footer-contract'].forEach(id=>{
        const el = document.getElementById(id);
        if (el) { el.textContent = shortAddr; el.title = addr; }
      });
    } catch {}
  }

  /* ---------- Bootstrap ---------- */
  function bootstrap(){
    initSocket();
    if (myAddr) setKnownAddress(myAddr);
    adoptFromSelectedProvider();
    updateContractLabels();
  }

  bootstrap();
})();
