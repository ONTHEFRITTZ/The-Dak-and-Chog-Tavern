/* Poker Table UI — OFFCHAIN sim (no auto-sim), Dev Bot toggle (opt-in, hidden with ≥2 humans) */
(function(){
  const centerEl  = document.getElementById('poker-center');
  const seatsEls  = Array.from(document.querySelectorAll('.seat'));
  const wiAddrEl  = document.getElementById('wi-address');
  const btnDisc   = document.getElementById('wi-disconnect');
  const btnDevBot = document.getElementById('toggle-dev-bot');
  const sbWallet  = document.getElementById('sb-wallet');

  function getParam(k){ try{ return new URL(window.location.href).searchParams.get(k); }catch{ return null; } }
  const tableId = getParam('table');

  let socket=null, myAddr=(localStorage.getItem('walletAddress')||sessionStorage.getItem('walletAddress')||'').toLowerCase();
  let isSim=false, devBotEnabled=false;

  function short(a){ return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }
  function lc(s){ return (s||'').toLowerCase(); }

  /* ---- Wallet provider from landing choice ---- */
  function getSelectedProvider(){
    const key=(sessionStorage.getItem('walletProvider')||'').toLowerCase();
    if (key==='metamask'){
      const eth=window.ethereum;
      if (eth?.isMetaMask) return eth;
      if (Array.isArray(eth?.providers)){ const mm=eth.providers.find(p=>p&&p.isMetaMask); if(mm) return mm; }
      return eth||null;
    }
    if (key==='phantom') return window.phantom?.ethereum || null;
    if (window.phantom?.ethereum) return window.phantom.ethereum;
    if (window.ethereum) return window.ethereum;
    return window.__walletProvider || null;
  }
  async function resolveAddressFromSelection(){
    try{ const p=getSelectedProvider(); if(!p?.request) return null; const a=await p.request({method:'eth_accounts'}).catch(()=>[]); return a&&a[0]? lc(a[0]):null; }catch{ return null; }
  }
  function applyKnownAddress(addr){
    myAddr=lc(addr||'');
    if (wiAddrEl) wiAddrEl.textContent = myAddr ? short(myAddr) : '-';
    if (sbWallet) sbWallet.textContent = myAddr ? short(myAddr) : '—';
    try{
      if(myAddr){
        localStorage.setItem('walletConnected','true'); sessionStorage.setItem('walletConnected','true');
        localStorage.setItem('walletAddress',myAddr);   sessionStorage.setItem('walletAddress',myAddr);
      } else {
        localStorage.removeItem('walletAddress'); sessionStorage.removeItem('walletAddress');
      }
    }catch{}
    if (socket?.connected && myAddr){ try{ socket.emit('identify',{addr:myAddr}); }catch{} }
  }

  if (btnDisc){
    btnDisc.style.display='inline-block';
    btnDisc.onclick=()=>{ try{
      sessionStorage.removeItem('walletAddress'); localStorage.removeItem('walletAddress');
      sessionStorage.removeItem('walletConnected'); localStorage.removeItem('walletConnected');
      sessionStorage.removeItem('walletProvider'); applyKnownAddress('');
      window.dispatchEvent(new CustomEvent('wallet:connected',{detail:{address:''}}));
    }catch{} };
  }

  (async()=>{ const a=await resolveAddressFromSelection(); if(a) applyKnownAddress(a); })();
  window.addEventListener('wallet:connected',(e)=>{ const a=e?.detail?.address||e?.detail?.addr; if(a) applyKnownAddress(a); });

  /* ---- Layout: roomier oval ---- */
  function layoutSeats(){
    const wrap=document.querySelector('.table-canvas'); if(!wrap) return;
    const W=wrap.clientWidth, H=wrap.clientHeight, cx=W/2, cy=H/2, rx=W*0.46, ry=H*0.44;
    const deg=[270,315,0,45,90,135,180,225];
    seatsEls.forEach((el,i)=>{ const a=(deg[i]||0)*Math.PI/180; const x=cx+rx*Math.cos(a), y=cy+ry*Math.sin(a); el.style.left=Math.round(x-el.clientWidth/2)+'px'; el.style.top=Math.round(y-el.clientHeight/2)+'px'; });
  }
  window.addEventListener('resize',layoutSeats);
  window.addEventListener('load',layoutSeats);

  function showCenter(msg,ms=1200){ if(!centerEl) return; centerEl.textContent=msg; centerEl.style.display='block'; if(ms>0) setTimeout(()=> centerEl.style.display='none', ms); }

  /* ---- Render ---- */
  function renderTable(t){
    if (!t || t.id!==tableId) return;
    isSim = !!t.simulated;
    devBotEnabled = !!t.devBotEnabled;

    const seats = Array.isArray(t.seats)? t.seats : [];
    // compute human count for button visibility
    const humanCount = seats.filter(s=> s && s.addr && !String(s.addr).startsWith('bot:')).length;

    // Dev Bot button: only when OFFCHAIN & exactly one human
    if (btnDevBot){
      if (isSim && humanCount===1){
        btnDevBot.style.display = 'inline-block';
        btnDevBot.textContent = devBotEnabled ? 'Disable Dev Bot' : 'Enable Dev Bot';
        btnDevBot.onclick = ()=>{
          try { socket?.emit('poker:devbot', { enabled: !devBotEnabled }); } catch {}
        };
      } else {
        btnDevBot.style.display='none';
      }
    }

    seatsEls.forEach((el,i)=>{
      const s=seats[i]; el.innerHTML='';
      const head=document.createElement('div'); head.className='addr'; head.textContent = s ? (s.addr||`Seat ${i}`) : 'Empty';
      el.appendChild(head);

      if (isSim && s){
        const chips=document.createElement('div'); chips.style.fontSize='12px'; chips.style.opacity='.9';
        chips.textContent = `Chips: ${Number(s.chips||0)}`;
        el.appendChild(chips);
      }

      const btns=document.createElement('div'); btns.className='btns';
      if (s){
        const mine = myAddr && s.addr && lc(s.addr)===myAddr;
        if (mine){
          const b1=document.createElement('button'); b1.textContent='Leave'; b1.onclick=()=> socket?.emit('seat',{index:-1}); btns.appendChild(b1);
          const b2=document.createElement('button'); b2.textContent= s.ready?'Unready':'Ready'; b2.style.marginLeft='6px'; b2.onclick=()=> socket?.emit('ready',{ready:!s.ready}); btns.appendChild(b2);
          if (isSim){
            const b3=document.createElement('button'); b3.textContent='Buy 100'; b3.style.marginLeft='6px'; b3.onclick=()=> socket?.emit('sim:rebuy'); btns.appendChild(b3);
          }
        }
      } else {
        const sit=document.createElement('button'); sit.textContent='Sit';
        if(!myAddr){ sit.disabled=true; sit.title='Connect wallet'; }
        sit.onclick=()=>{ if(!myAddr) return; socket?.emit('seat',{index:i}); };
        btns.appendChild(sit);
      }
      el.appendChild(btns);
    });

    if (sbWallet) sbWallet.textContent = myAddr ? short(myAddr) : '—';
    layoutSeats();
  }

  /* ---- Socket ---- */
  function initSocket(){
    try{
      socket=io(window.location.origin,{
        path:'/poker.io/',
        transports:['websocket'], upgrade:false, reconnection:true, reconnectionAttempts:10, reconnectionDelay:800, forceNew:true, withCredentials:true
      });
    }catch(e){ showCenter('Socket unavailable',1500); return; }

    socket.on('connect', async ()=>{
      let addr=myAddr;
      if(!addr){ const r=await resolveAddressFromSelection(); if(r){ addr=r; applyKnownAddress(r); } }
      if(addr) socket.emit('identify',{addr});
      socket.emit('join_table',{ table:tableId });
      socket.emit('lobby:get');
    });

    socket.on('disconnect', ()=> showCenter('Disconnected',1000));

    socket.on('table:update', t=> renderTable(t));
    socket.on('table:state',  t=> renderTable(t));

    socket.on('poker:state', (m)=>{ if(typeof m?.pot!=='undefined'){ showCenter(`Stage: ${m.stage||'-'} • Pot: ${m.pot}`, 800); } });
    socket.on('poker:hand',  (h)=>{ const w=Array.isArray(h?.winners)?h.winners:[]; showCenter(w.length?`Hand complete — Winner: ${w.map(x=>x.addr&&x.addr.length>10? (x.addr.slice(0,6)+'...'+x.addr.slice(-4)) : x.addr).join(', ')}`:'Hand complete', 1400); });

    // keep local flag in sync
    socket.on('poker:mode', (m)=>{ isSim=!!m?.simulated; });
  }

  /* ---- Bootstrap ---- */
  initSocket();
  if (myAddr) applyKnownAddress(myAddr);
})();