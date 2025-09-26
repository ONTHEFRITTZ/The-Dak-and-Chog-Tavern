// =================== Poker UI + Networking (Cleaned) ===================

// ---- DOM refs ----
const statusEl   = document.getElementById('poker-status') || document.getElementById('status');
const lobbyEl    = document.getElementById('lobby');
const connectBtn = document.getElementById('connect-wallet');
const tableEl    = document.getElementById('table') || document.getElementById('poker-table');

// ---- URL helpers (tableId from ?table=...) ----
function getQueryParam(k){ try { return new URL(window.location.href).searchParams.get(k); } catch { return null; } }
const currentTableId = (window.currentTableId ?? getQueryParam('table')) || null;

// ---- globals ----
let socket;
let myAddr = null;

// ---- utils ----
function setStatus(t){ try { if (statusEl) statusEl.textContent = t; } catch {} }
function short(a){ try { return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); } catch { return a||''; } }

// =================== Lobby Rendering ===================
function renderLobby(list){
  try {
    const items = Array.isArray(list) ? list : [];
    if (!lobbyEl) return;

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
      card.appendChild(left);
      card.appendChild(btn);
      lobbyEl.appendChild(card);
    });
    if (!items.length) lobbyEl.textContent = 'No poker tables yet.';
  } catch (e) {
    console.error('renderLobby error', e);
  }
}

// =================== Table Rendering ===================
function renderTable(t){
  try {
    if (!tableEl) return;
    if (!t || (currentTableId && t.id !== currentTableId)) return;

    tableEl.innerHTML = '';

    const title = document.createElement('div');
    title.style.marginBottom='8px';
    title.textContent = `Table ${t.id}`;
    tableEl.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText='display:grid; grid-template-columns: repeat(3, minmax(120px,1fr)); gap:10px;';

    const seats = Array.isArray(t.seats) ? t.seats : [];
    for (let i=0; i<6; i++){
      const panel = document.createElement('div');
      panel.style.cssText='border:1px solid #7800cd; border-radius:8px; padding:8px; background:rgba(255,255,255,0.6);';

      const s = seats[i];
      const label = document.createElement('div'); label.textContent = `Seat ${i}`; panel.appendChild(label);

      const info = document.createElement('div'); info.style.fontSize='12px'; info.style.margin='6px 0';

      if (s) {
        info.textContent = short(s.addr||s.id);
        panel.appendChild(info);

        if (myAddr && s.addr && String(s.addr).toLowerCase()===String(myAddr).toLowerCase()){
          const btnLeave = document.createElement('button');
          btnLeave.textContent='Leave';
          btnLeave.onclick = () => { try { socket?.emit('seat',{ index:-1 }); } catch {} };
          panel.appendChild(btnLeave);

          const btnReady = document.createElement('button');
          btnReady.style.marginLeft='6px';
          btnReady.textContent = s.ready ? 'Unready' : 'Ready';
          btnReady.onclick = () => { try { socket?.emit('ready',{ ready: !s.ready }); } catch {} };
          panel.appendChild(btnReady);
        }
      } else {
        info.textContent = 'Empty';
        panel.appendChild(info);

        const btnSit = document.createElement('button'); btnSit.textContent='Sit';
        if (!myAddr) { btnSit.disabled = true; btnSit.title = 'Connect wallet to sit'; }
        btnSit.onclick = () => { if (!myAddr) return; try { socket?.emit('seat',{ index:i }); } catch {} };
        panel.appendChild(btnSit);
      }

      grid.appendChild(panel);
    }

    tableEl.appendChild(grid);
  } catch (e) {
    console.error('renderTable error', e);
  }
}

// =================== Socket.IO ===================
function initSocket(){
  try {
    // io must be available (socket.io client)
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
    console.error('Socket init error', e);
    return;
  }

  socket.on('connect', () => {
    setStatus('Connected');
    try {
      if (myAddr) socket.emit('identify', { addr: myAddr });
    } catch {}
    try { socket.emit('lobby:get'); } catch {}
    // If we are on table page and have an id, ask to join to get state updates
    if (currentTableId) {
      try { socket.emit('join_table', { table: currentTableId }); } catch {}
    }
  });

  socket.on('connect_error', (err) => {
    setStatus('Lobby unavailable. Retrying...');
    try { console.error('connect_error', err?.message || err); } catch {}
  });

  socket.on('reconnect_error', () => { setStatus('Reconnecting...'); });
  socket.on('disconnect', () => setStatus('Disconnected'));

  socket.on('lobby:list', (list) => renderLobby(list));

  // Table-only channels (your server should emit these on table pages)
  socket.on('table:state', (t) => renderTable(t));
  socket.on('system', () => { /* noop */ });
}

initSocket();

// =================== Wallet Connect (fixed) ===================
function getInjectedProvider(){
  // Prefer explicit injected providers if present
  try {
    // Phantom may expose phantom.ethereum
    if (window.phantom?.ethereum) return window.phantom.ethereum;
    // MetaMask / EIP-1193
    if (window.ethereum) return window.ethereum;
    // Custom injected (if you set one elsewhere)
    if (window.__walletProvider) return window.__walletProvider;
  } catch {}
  return null;
}

connectBtn?.addEventListener('click', async () => {
  try {
    const injected = getInjectedProvider();
    if (!injected || !window.ethers) {
      setStatus('No wallet provider found');
      return;
    }

    // Request accounts (EIP-1102 / EIP-1193)
    await injected.request?.({ method: 'eth_requestAccounts' });

    const provider = new window.ethers.providers.Web3Provider(injected, 'any');
    const signer   = provider.getSigner();
    const addr     = await signer.getAddress();

    myAddr = String(addr || '').toLowerCase();
    setStatus(`Wallet: ${short(myAddr)}`);

    // Identify to backend and (re)join table if applicable
    try { if (socket?.connected) socket.emit('identify', { addr: myAddr }); } catch {}
    try {
      if (currentTableId) {
        socket?.emit('lobby:get');
        socket?.emit('join_table', { table: currentTableId });
      }
    } catch {}
  } catch (e) {
    console.error('Wallet connect failed', e);
    setStatus('Wallet connect failed');
  }
});

// =================== On-chain orchestration (guarded) ===================
(function(){
  // Entire block is optional and fully guarded; it won’t run unless deps exist.
  let onChain = false, hp = null, hpOwner = null, lastState = null, nextHandId = 1;

  async function ensureHp() {
    try {
      if (!window.ethers || !window.HoldemPokerABI) return false;
      const mod = await import('../../js/config.js').catch(() => null);
      if (!mod) return false;

      const provider = new window.ethers.providers.Web3Provider(getInjectedProvider() || window.ethereum, 'any');
      const signer   = provider.getSigner();
      const addr     = await mod.getAddressFor?.('pokerTable', provider);
      if (!addr) return false;

      hp      = new window.ethers.Contract(addr, window.HoldemPokerABI, signer);
      hpOwner = await hp.owner();
      return true;
    } catch (e) {
      console.warn('ensureHp failed', e);
      return false;
    }
  }

  function isOwner(addr){
    try { return !!addr && !!hpOwner && String(addr).toLowerCase() === String(hpOwner).toLowerCase(); }
    catch { return false; }
  }

  async function myAddrNow(){
    try {
      const injected = getInjectedProvider() || window.ethereum;
      if (!injected || !window.ethers) return null;
      const p = new window.ethers.providers.Web3Provider(injected, 'any');
      const a = await p.listAccounts();
      return (a && a[0]) || null;
    } catch { return null; }
  }

  async function sendCalls(calls){
    const from = await myAddrNow();
    try {
      const det = await window.Bundler?.detectBundler?.(getInjectedProvider() || window.ethereum);
      if (det?.available) {
        const net  = await (new window.ethers.providers.Web3Provider(getInjectedProvider() || window.ethereum,'any')).getNetwork().catch(()=>({ chainId: undefined }));
        const res  = await window.Bundler.walletSendCalls({ provider: det.provider, from, chainId: Number(net?.chainId), calls });
        const hash = window.Bundler.extractTxHash?.(res);
        if (hash) await window.Bundler.waitForTransactionReceipt?.(det.provider, hash);
        return true;
      }
    } catch (e) {
      console.warn('bundled send failed', e);
    }

    // Fallback: sequential send (best-effort; requires signer)
    try {
      const injected = getInjectedProvider() || window.ethereum;
      const w3 = new window.ethers.providers.Web3Provider(injected, 'any');
      const signer = w3.getSigner();
      for (const c of (calls || [])){
        const tx = await signer.sendTransaction({ to: c.to, data: c.data, value: c.value || '0x0' });
        await tx.wait?.();
      }
      return true;
    } catch (e) {
      console.warn('fallback send failed', e);
      return false;
    }
  }

  async function onState(st){
    try {
      if (!onChain || !hp) return;
      const me = await myAddrNow(); if (!isOwner(me)) return;

      // Begin hand when entering preflop from no/unknown stage
      if ((!lastState || !lastState.stage) && st?.stage === 'preflop'){
        const dealer = Number(st.dealerIndex || 0) | 0;
        const N      = (st.actors?.length || 6);
        const sb     = (dealer + 1) % N;
        const bb     = (dealer + 2) % N;
        const data   = hp.interface.encodeFunctionData('beginHand', [nextHandId++, dealer, sb, bb]);
        await sendCalls([{ to: hp.address, data }]);
      }

      // Contribute deltas
      if (lastState?.actors && st?.actors && Array.isArray(st.actors)) {
        const calls = [];
        for (let i = 0; i < st.actors.length; i++){
          const now  = Number(st.actors[i]?.contrib || 0);
          const prev = Number(lastState.actors[i]?.contrib || 0);
          const d    = Math.max(0, now - prev);
          if (d > 0) calls.push({ to: hp.address, data: hp.interface.encodeFunctionData('contribute', [i, d]) });
        }
        if (calls.length) await sendCalls(calls);
      }
    } catch (e) {
      console.warn('onState error', e);
    } finally {
      lastState = st;
    }
  }

  async function onHand(m){
    try {
      if (!onChain || !hp) return;
      const me = await myAddrNow(); if (!isOwner(me)) return;

      const winners = Array.isArray(m?.winners) ? m.winners.map(w=>w.addr) : [];
      const payouts = Array.isArray(m?.winners) ? m.winners.map(w=>Number(w.amount || 0)) : [];
      const data    = hp.interface.encodeFunctionData('settleHand', [winners, payouts, 0]);
      await sendCalls([{ to: hp.address, data }]);
    } catch (e) {
      console.warn('settleHand failed', e);
    }
  }

  (async () => { try { await ensureHp(); } catch {} })();

  // Bind once socket is ready; retry until available
  (function bind(){
    try {
      if (socket) {
        socket.on('poker:mode',  (m) => { onChain = !m?.simulated; });
        socket.on('poker:state', onState);
        socket.on('poker:hand',  onHand);
      } else {
        setTimeout(bind, 300);
      }
    } catch {
      setTimeout(bind, 300);
    }
  })();
})();
