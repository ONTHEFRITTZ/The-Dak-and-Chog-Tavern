const statusEl = document.getElementById('poker-status') || document.getElementById('status');
const lobbyEl = document.getElementById('lobby');
const connectBtn = document.getElementById('connect-wallet');
let socket; let myAddr = null;

function setStatus(t){ try { statusEl.textContent = t; } catch {} }

function renderLobby(list){
  try {
    const items = Array.isArray(list)? list : [];
    lobbyEl.innerHTML = '';
    items.forEach(row => {
      const card = document.createElement('div'); card.className='lobby-item';
      const left = document.createElement('div'); left.textContent = `${row.id} - Players ${row.seated}/${row.capacity}`;
      const btn = document.createElement('button'); btn.textContent = 'Open Table';
      btn.onclick = () => {
        try {
          const u = new URL(window.location.href);
          u.pathname = '/games/poker/table.html';
          u.searchParams.set('table', row.id);
          window.location.href = u.toString();
        } catch {
          window.location.href = `/games/poker/table.html?table=${encodeURIComponent(row.id)}`;
        }
      };
      card.appendChild(left); card.appendChild(btn);
      lobbyEl.appendChild(card);
    });
    if (!items.length) lobbyEl.textContent = 'No poker tables yet.';
  } catch {}
}

function short(a){ try { return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); } catch { return a||''; } }

function renderTable(t){
  try {
    if (!t || t.id !== currentTableId) return;
    tableEl.innerHTML = '';
    const title = document.createElement('div'); title.style.marginBottom='8px'; title.textContent = `Table ${t.id}`; tableEl.appendChild(title);
    const grid = document.createElement('div'); grid.style.cssText='display:grid; grid-template-columns: repeat(3, minmax(120px,1fr)); gap:10px;';
    const seats = Array.isArray(t.seats) ? t.seats : [];
    for (let i=0;i<6;i++){
      const panel = document.createElement('div'); panel.style.cssText='border:1px solid #7800cd; border-radius:8px; padding:8px; background:rgba(255,255,255,0.6);';
      const s = seats[i];
      const label = document.createElement('div'); label.textContent = `Seat ${i}`; panel.appendChild(label);
      const info = document.createElement('div'); info.style.fontSize='12px'; info.style.margin='6px 0';
      if (s) { info.textContent = short(s.addr||s.id); panel.appendChild(info);
        if (myAddr && s.addr && String(s.addr).toLowerCase()===String(myAddr).toLowerCase()){
          const btnLeave = document.createElement('button'); btnLeave.textContent='Leave'; btnLeave.onclick=()=> socket.emit('seat',{ index:-1 }); panel.appendChild(btnLeave);
          const btnReady = document.createElement('button'); btnReady.style.marginLeft='6px'; btnReady.textContent = s.ready? 'Unready':'Ready'; btnReady.onclick=()=> socket.emit('ready',{ ready: !s.ready }); panel.appendChild(btnReady);
        }
      } else {
        info.textContent = 'Empty'; panel.appendChild(info);
        const btnSit = document.createElement('button'); btnSit.textContent='Sit';
        if (!myAddr) { btnSit.disabled=true; btnSit.title='Connect wallet to sit'; }
        btnSit.onclick=()=>{ if (!myAddr) return; socket.emit('seat',{ index:i }); };
        panel.appendChild(btnSit);
      }
      grid.appendChild(panel);
    }
    tableEl.appendChild(grid);
  } catch {}
}

async function connect(){
  try {
    socket = io(window.location.origin, {
      path: '/poker.io/',
      transports: ['polling','websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
      forceNew: true
    });
  } catch (e) {
    setStatus('Socket.IO not available');
    return;
  }
  socket.on('connect', () => { setStatus('Connected'); if (myAddr) { try { socket.emit('identify', { addr: myAddr }); } catch {} } try { socket.emit('lobby:get'); } catch {} });
  socket.on('connect_error', (err) => { setStatus('Lobby unavailable. Retrying...'); try { console.error('connect_error', err && err.message); } catch {} });
  socket.on('reconnect_error', () => { setStatus('Reconnecting...'); });
  socket.on('disconnect', () => setStatus('Disconnected'));
socket.on('lobby:list', (list) => renderLobby(list));
  // No in-lobby seat rendering; seating happens on table.html
  socket.on('system', (m) => { /* noop */ });
}

connect();

// Wallet connect (isolated): gate seating until wallet connected
connectBtn?.addEventListener('click', async () => {
  try {
    const injected = (window.__walletProvider || window.ethereum || null); if(pref==='phantom') return (window.phantom&&window.phantom.ethereum)||window.__walletProvider; if(pref==='metamask') return window.ethereum||window.__walletProvider; return window.__walletProvider||window.ethereum||(window.phantom&&window.phantom.ethereum)||null; } catch { return window.__walletProvider||window.ethereum||(window.phantom&&window.phantom.ethereum)||null; } })();
    if (!injected || !window.ethers) { setStatus('No wallet provider found'); return; }
    await injected.request({ method: 'eth_requestAccounts' });
    const provider = new window.ethers.providers.Web3Provider(injected, 'any');
    const signer = provider.getSigner();
    const addr = await signer.getAddress();
    myAddr = String(addr||'').toLowerCase();
    setStatus(`Wallet: ${short(myAddr)}`);
    try { if (socket && socket.connected) socket.emit('identify', { addr: myAddr }); } catch {}
    // Re-render table to enable Sit buttons
    try { if (currentTableId) socket.emit('lobby:get'); if (currentTableId) try { socket.emit('join_table', { table: currentTableId }); } catch {} } catch {}
  } catch (e) {
    setStatus('Wallet connect failed');
  }
});

// ---------------- On-chain orchestration (MetaMask Smart Accounts) ----------------
// When the dev bot is NOT toggled on (simulated=false), we orchestrate HoldemPoker
// calls on-chain from the table owner (contract owner). We automatically bundle
// beginHand/contribute/settle calls via wallet_sendCalls when available.
(function(){
  let onChain = false; let hp = null; let hpOwner = null; let lastState = null; let nextHandId = 1;
  async function ensureHp() {
    try {
      if (!window.HoldemPokerABI || !window.ethers) return false;
      const mod = await import('../../js/config.js');
      const provider = new window.ethers.providers.Web3Provider(window.ethereum,'any');
      const signer = provider.getSigner();
      const addr = await mod.getAddressFor('pokerTable', provider);
      if (!addr) return false;
      hp = new window.ethers.Contract(addr, window.HoldemPokerABI, signer);
      hpOwner = await hp.owner();
      return true;
    } catch { return false; }
  }
  function isOwner(addr){ try { return addr && hpOwner && String(addr).toLowerCase()===String(hpOwner).toLowerCase(); } catch { return false; } }
  async function myAddrNow(){ try { const p=new window.ethers.providers.Web3Provider(window.ethereum,'any'); const a=await p.listAccounts(); return (a&&a[0])||null; } catch { return null; } }
  async function sendCalls(calls){
    const from = await myAddrNow();
    try {
      const det = await window.Bundler?.detectBundler?.(window.ethereum);
      if (det && det.available) {
        const net = await (new window.ethers.providers.Web3Provider(window.ethereum,'any')).getNetwork().catch(()=>({chainId:undefined}));
        const res = await window.Bundler.walletSendCalls({ provider: det.provider, from, chainId: Number(net?.chainId), calls });
        const hash = window.Bundler.extractTxHash(res); if (hash) await window.Bundler.waitForTransactionReceipt(det.provider, hash);
        return true;
      }
    } catch (e) { console.warn('bundled send failed', e); }
    // Fallback: send sequentially
    for (const c of calls){ await (await window.ethers.getDefaultProvider()).waitForTransaction?.(await (await (new window.ethers.providers.Web3Provider(window.ethereum,'any')).getSigner()).sendTransaction({ to: c.to, data: c.data, value: c.value||'0x0' })); }
    return true;
  }
  async function onState(st){
    try {
      if (!onChain || !hp) return;
      const me = await myAddrNow(); if (!isOwner(me)) return;
      // Begin hand
      if ((!lastState || !lastState.stage) && st.stage==='preflop'){
        const dealer = Number(st.dealerIndex||0)|0; const sb=(dealer+1)% (st.actors?.length||6); const bb=(dealer+2)% (st.actors?.length||6);
        const data = hp.interface.encodeFunctionData('beginHand',[nextHandId++, dealer, sb, bb]);
        await sendCalls([{ to: hp.address, data }]);
      }
      // Contribute deltas
      if (lastState && st && Array.isArray(st.actors) && Array.isArray(lastState.actors)){
        const deltas = [];
        for (let i=0;i<st.actors.length;i++){
          const now = Number(st.actors[i]?.contrib||0); const prev = Number(lastState.actors[i]?.contrib||0);
          const d = Math.max(0, now-prev); if (d>0) deltas.push({ seat:i, amount:d });
        }
        if (deltas.length){ const calls = deltas.map(c=>({ to: hp.address, data: hp.interface.encodeFunctionData('contribute',[c.seat, c.amount]) })); await sendCalls(calls); }
      }
    } catch {}
    finally { lastState = st; }
  }
  async function onHand(m){
    try {
      if (!onChain || !hp) return; const me=await myAddrNow(); if (!isOwner(me)) return;
      const winners = Array.isArray(m && m.winners) ? m.winners.map(w=>w.addr) : [];
      const payouts = Array.isArray(m && m.winners) ? m.winners.map(w=>Number(w.amount||0)) : [];
      const data = hp.interface.encodeFunctionData('settleHand',[winners, payouts, 0]);
      await sendCalls([{ to: hp.address, data }]);
    } catch (e) { console.warn('settleHand failed', e); }
  }
  (async function init(){ try { await ensureHp(); } catch {} })();
  try {
    const _io = io; // already defined above in connect(); if not, ignore
    // These listeners will be set after connect in practice too; safe to attach here
    // We subscribe via global socket if available on window
  } catch {}
  // Attach via window.socket if connect() has run
  (function bind(){ try { if (socket) { socket.on('poker:mode', (m)=>{ onChain = !m?.simulated; }); socket.on('poker:state', onState); socket.on('poker:hand', onHand); } else { setTimeout(bind, 300); } } catch { setTimeout(bind, 300); } })();
})();
