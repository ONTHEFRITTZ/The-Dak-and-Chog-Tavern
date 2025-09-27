// Poker lobby renderer (grouped)
(function(){
  const statusEl = document.getElementById('poker-status');
  const elLimit  = document.getElementById('list-onchain-limit');
  const elNL     = document.getElementById('list-onchain-nolimit');
  const elSim    = document.getElementById('list-offchain');

  function setStatus(t){ try{ if(statusEl) statusEl.textContent=t }catch{} }
  function openTable(id){
    try{
      const u = new URL(window.location.href);
      u.pathname = '/games/poker/table.html';
      u.searchParams.set('table', id);
      window.location.href = u.toString();
    }catch{
      window.location.href = '/games/poker/table.html?table='+encodeURIComponent(id);
    }
  }
  function rowHTML(meta){
    const seated = Number(meta.seated||0), cap = Number(meta.capacity||8);
    const stakes = meta.stakes ? (meta.stakes.sb+'/'+meta.stakes.bb+' '+(meta.stakes.denom||'MON')) : '';
    const betStr = (meta.mode==='onchain' && meta.betting==='limit') ? 'Limit '+stakes
                 : (meta.mode==='onchain' ? 'No-Limit' : 'Sim');
    return `
      <div class="row">
        <div class="meta"><strong>${meta.id}</strong> • ${seated}/${cap} seated • ${betStr}</div>
        <div><button data-open="${meta.id}">Open</button></div>
      </div>
    `;
  }
  function mountList(el, arr){
    el.innerHTML = (arr && arr.length) ? arr.map(rowHTML).join('') : '<div class="muted">No tables yet.</div>';
    el.querySelectorAll('button[data-open]').forEach(btn=>{
      btn.onclick = ()=> openTable(btn.getAttribute('data-open'));
    });
  }

  let socket;
  try{
    socket = io(window.location.origin, {
      path:'/poker.io/',
      transports:['polling','websocket'], upgrade:true, reconnection:true,
      reconnectionAttempts:10, reconnectionDelay:800, forceNew:true
    });
  }catch(e){ setStatus('Socket.IO unavailable'); return; }

  socket.on('connect', ()=>{ setStatus('Connected'); try{ socket.emit('lobby:get'); }catch{} });
  socket.on('disconnect', ()=> setStatus('Disconnected'));
  socket.on('connect_error', ()=> setStatus('Lobby unavailable. Retrying…'));

  socket.on('lobby:full', (g)=>{
    try{
      mountList(elLimit, g?.onchain?.limit || []);
      mountList(elNL,    g?.onchain?.nolimit || []);
      mountList(elSim,   g?.offchain || []);
    }catch(e){ console.warn(e); }
  });
  socket.on('lobby:list', (list)=>{
    try{
      const arr = Array.isArray(list)?list:[];
      mountList(elSim, arr);
    }catch(e){ console.warn(e); }
  });
})();
