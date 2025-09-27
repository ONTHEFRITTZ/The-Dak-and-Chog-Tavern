// =================== Poker UI + Networking (Split Lobby + Wallet-hardened) ===================

// ---- DOM refs ----
const statusEl   = document.getElementById('poker-status') || document.getElementById('status');
const lobbyEl    = document.getElementById('lobby');
const connectBtn = document.getElementById('connect-wallet');
const tableEl    = document.getElementById('table') || document.getElementById('poker-table');
const wiAddrEl   = document.getElementById('wi-address'); // optional (navbar)

// ---- URL helpers (tableId from ?table=...) ----
function getQueryParam(k){ try { return new URL(window.location.href).searchParams.get(k); } catch { return null; } }
const currentTableId = (window.currentTableId ?? getQueryParam('table')) || null;

// ---- globals ----
let socket;
let myAddr = null;
let chainIdHex = null;

// ---- utils ----
function short(a){ try { return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); } catch { return a||''; } }
function setStatus(t){ try { if (statusEl) statusEl.textContent = t; } catch {} }
function lc(a){ return (a||'').toString().toLowerCase(); }

// =================== Wallet state ===================
function setKnownAddress(addr){
  try {
    myAddr = lc(addr);
    if (myAddr) {
      try { localStorage.setItem('walletConnected','true'); } catch {}
      try { sessionStorage.setItem('walletConnected','true'); } catch {}
      try { localStorage.setItem('walletAddress', myAddr); } catch {}
      try { sessionStorage.setItem('walletAddress', myAddr); } catch {}
      if (wiAddrEl) wiAddrEl.textContent = short(myAddr);
      window.__WALLET_ADDR = myAddr;
      try { window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: myAddr, chainId: chainIdHex } })); } catch {}

      if (socket?.connected) {
        try { socket.emit('identify', { addr: myAddr }); } catch {}
        if (currentTableId) {
          try { socket.emit('lobby:get'); socket.emit('join_table', { table: currentTableId }); } catch {}
        }
      }
      setStatus(`Wallet: ${short(myAddr)}`);
    } else {
      if (wiAddrEl) wiAddrEl.textContent = '-';
      setStatus('Wallet: not connected');
    }
  } catch (e) { console.warn('setKnownAddress failed', e); }
}

// =================== Lobby classification & rendering ===================

// Prefer backend flags if present; otherwise infer from id patterns.
function isOffchain(row) {
  if (typeof row?.simulated === 'boolean') return !!row.simulated;
  if (typeof row?.onchain   === 'boolean') return !row.onchain;
  const id = String(row?.id || '').toLowerCase();
  return id.includes('-sim-') || id.startsWith('poker-sim-') || id.endsWith('-sim');
}
function isOnchain(row){ return !isOffchain(row); }

function limitType(row){
  const raw = (row?.limit || '').toString().toUpperCase();
  if (raw === 'NL' || raw === 'NO_LIMIT' || raw === 'NO-LIMIT') return 'NL';
  if (raw === 'FL' || raw === 'FIXED_LIMIT' || raw === 'FIXED-LIMIT' || raw === 'LIMIT') return 'FL';
  const id = String(row?.id || '').toLowerCase();
  if (id.includes('-fl-') || id.startsWith('poker-fl-') || id.endsWith('-fl') || id.includes('fixed')) return 'FL';
  return 'NL';
}

function sortTables(a, b) {
  if (!!b.started - !!a.started) return (!!b.started - !!a.started);     // LIVE first
  if ((b.seated|0) - (a.seated|0)) return (b.seated|0) - (a.seated|0);   // more players
  return String(a.id).localeCompare(String(b.id));                        // lexicographic id
}

function makeLobbySectionsContainer(){
  // Build sections dynamically inside #lobby so you don't need to edit HTML.
  const root = document.createElement('div');
  root.className = 'poker-lobby-sections';

  const section = (titleTxt, subSections=[]) => {
    const s = document.createElement('section');
    s.className = 'lobby-sec';
    const h = document.createElement('h3');
    h.textContent = titleTxt;
    h.style.margin = '8px 0';
    s.appendChild(h);
    subSections.forEach(ss => s.appendChild(ss));
    return s;
  };

  const listBlock = (heading) => {
    const wrap = document.createElement('div');
    wrap.className = 'lobby-subsec';
    const h = document.createElement('h4');
    h.textContent = heading;
    h.style.margin = '6px 0';
    const list = document.createElement('div');
    list.className = 'lobby-list-grid';
    wrap.appendChild(h);
    wrap.appendChild(list);
    return { wrap, list };
  };

  const onNL   = listBlock('No-Limit');
  const onFL   = listBlock('Fixed-Limit');
  const offSim = listBlock('Off-Chain (Simulated)');

  const onChainSection = section('On-Chain Tables', [onNL.wrap, onFL.wrap]);
  const offChainSection = section('Off-Chain Tables', [offSim.wrap]);

  root.appendChild(onChainSection);
  root.appendChild(offChainSection);

  return { root, lists: { onNL: onNL.list, onFL: onFL.list, offSim: offSim.list } };
}

function rowCard(row){
  const wrap = document.createElement('div');
  wrap.className = 'lobby-item';
  wrap.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px; border:1px solid rgba(255,255,255,0.16); border-radius:10px; background:rgba(0,0,0,0.25);';

  const left = document.createElement('div');
  left.style.flex='1 1 auto';
  const title = document.createElement('div');
  title.style.fontWeight = '700';
  title.textContent = row.id;

  const meta = document.createElement('div');
  meta.style.fontSize = '12px';
  const limitTxt = (row.limitLabel || (limitType(row) === 'FL' ? 'Fixed-Limit' : 'No-Limit'));
  const parts = [];
  if (row.stakes) parts.push(String(row.stakes));
  parts.push(`Players ${row.seated}/${row.capacity}`);
  parts.push(limitTxt);
  if (row.started) parts.push('LIVE');
  meta.textContent = parts.join(' • ');

  left.appendChild(title);
  left.appendChild(meta);

  const btn = document.createElement('button');
  btn.textContent = 'Join';
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

  wrap.appendChild(left);
  wrap.appendChild(btn);
  return wrap;
}

function renderLobby(list){
  try {
    if (!lobbyEl) return;
    const items = Array.isArray(list) ? list : [];

    // Build sections container fresh each time (simple and safe)
    lobbyEl.innerHTML = '';
    const { root, lists } = makeLobbySectionsContainer();
    lobbyEl.appendChild(root);

    // Split & sort
    const on  = items.filter(isOnchain);
    const off = items.filter(isOffchain);
    const onNL = on.filter(r => limitType(r) === 'NL').sort(sortTables);
    const onFL = on.filter(r => limitType(r) === 'FL').sort(sortTables);
    const offX = off.sort(sortTables);

    // Fill lists
    if (onNL.length) onNL.forEach(r => lists.onNL.appendChild(rowCard(r)));
    else lists.onNL.innerHTML = `<div class="muted" style="opacity:.8;">No No-Limit tables yet.</div>`;

    if (onFL.length) onFL.forEach(r => lists.onFL.appendChild(rowCard(r)));
    else lists.onFL.innerHTML = `<div class="muted" style="opacity:.8;">No Fixed-Limit tables yet.</div>`;

    if (offX.length) offX.forEach(r => lists.offSim.appendChild(rowCard(r)));
    else lists.offSim.innerHTML = `<div class="muted" style="opacity:.8;">No off-chain tables yet.</div>`;
  } catch (e) {
    console.error('renderLobby error', e);
    try { lobbyEl.textContent = 'Failed to render lobby.'; } catch {}
  }
}

// =================== Table Rendering (unchanged) ===================
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

        if (myAddr && s.addr && lc(s.addr)===myAddr){
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
  } catch (e) { console.error('renderTable error', e); }
}

// =================== Socket.IO ===================
function initSocket(){
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
    console.error('Socket init error', e);
    return;
  }

  socket.on('connect', () => {
    setStatus('Connected');
    if (myAddr) { try { socket.emit('identify', { addr: myAddr }); } catch {} }
    try { socket.emit('lobby:get'); } catch {}
    if (currentTableId) { try { socket.emit('join_table', { table: currentTableId }); } catch {} }
  });

  socket.on('connect_error', (err) => { setStatus('Lobby unavailable. Retrying...'); console.warn('connect_error', err?.message || err); });
  socket.on('reconnect_error', () => { setStatus('Reconnecting...'); });
  socket.on('disconnect', () => setStatus('Disconnected'));

  // Flat list from server → split into sections client-side
  socket.on('lobby:list', (list) => renderLobby(list));

  // Keep compatibility with both event names
  socket.on('table:update', (t) => renderTable(t));
  socket.on('table:state',  (t) => renderTable(t));
}

// =================== Wallet Sync (robust) ===================
function getInjectedProvider(){
  try {
    if (window.phantom?.ethereum) return window.phantom.ethereum;
    if (window.ethereum) return window.ethereum;
    if (window.__walletProvider) return window.__walletProvider;
  } catch {}
  return null;
}

async function detectExistingAccount(){
  try {
    const injected = getInjectedProvider();
    if (!injected) return null;
    const accts = await injected.request?.({ method: 'eth_accounts' }).catch(()=>[]);
    const addr = (accts && accts[0]) || null;
    chainIdHex = await injected.request?.({ method: 'eth_chainId' }).catch(()=>null);
    return addr;
  } catch { return null; }
}

async function ensureWalletFromAnySource(){
  const saved = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').trim();
  if (saved) setKnownAddress(saved);

  const addr = await detectExistingAccount();
  if (addr) setKnownAddress(addr);

  window.addEventListener('wallet:connected', (e) => {
    const addr2 = e?.detail?.address || e?.detail?.addr;
    if (addr2) setKnownAddress(addr2);
  });

  const injected = getInjectedProvider();
  if (injected && injected.on) {
    injected.on('accountsChanged', (arr) => {
      const a = (arr && arr[0]) || null;
      setKnownAddress(a || '');
    });
    injected.on('chainChanged', (id) => {
      chainIdHex = id;
      if (myAddr) setStatus(`Wallet: ${short(myAddr)} | Chain ${id}`);
    });
  }
}

connectBtn?.addEventListener('click', async () => {
  try {
    const injected = getInjectedProvider();
    if (!injected || !window.ethers) { setStatus('No wallet provider found'); return; }
    await injected.request?.({ method: 'eth_requestAccounts' });
    const [addr] = await injected.request?.({ method: 'eth_accounts' }) || [];
    chainIdHex = await injected.request?.({ method: 'eth_chainId' }).catch(()=>null);
    setKnownAddress(addr || '');
  } catch (e) {
    console.error('Wallet connect failed', e);
    setStatus('Wallet connect failed');
  }
});

// =================== On-chain orchestration (guarded / optional) ===================
(function(){
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
    } catch (e) { console.warn('ensureHp failed', e); return false; }
  }

  function isOwner(addr){
    try { return !!addr && !!hpOwner && lc(addr) === lc(hpOwner); } catch { return false; }
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
      const det  = await window.Bundler?.detectBundler?.(getInjectedProvider() || window.ethereum);
      if (det?.available) {
        const net  = await (new window.ethers.providers.Web3Provider(getInjectedProvider() || window.ethereum,'any')).getNetwork().catch(()=>({ chainId: undefined }));
        const res  = await window.Bundler.walletSendCalls({ provider: det.provider, from, chainId: Number(net?.chainId), calls });
        const hash = window.Bundler.extractTxHash?.(res);
        if (hash) await window.Bundler.waitForTransactionReceipt?.(det.provider, hash);
        return true;
      }
    } catch (e) { console.warn('bundled send failed', e); }

    try {
      const injected = getInjectedProvider() || window.ethereum;
      const w3 = new window.ethers.providers.Web3Provider(injected, 'any');
      const signer = w3.getSigner();
      for (const c of (calls || [])){
        const tx = await signer.sendTransaction({ to: c.to, data: c.data, value: c.value || '0x0' });
        await tx.wait?.();
      }
      return true;
    } catch (e) { console.warn('fallback send failed', e); return false; }
  }

  async function onState(st){
    try {
      if (!onChain || !hp) return;
      const me = await myAddrNow(); if (!isOwner(me)) return;

      if ((!lastState || !lastState.stage) && st?.stage === 'preflop'){
        const dealer = Number(st.dealerIndex || 0) | 0;
        const N      = (st.actors?.length || 6);
        const sb     = (dealer + 1) % N;
        const bb     = (dealer + 2) % N;
        const data   = hp.interface.encodeFunctionData('beginHand', [nextHandId++, dealer, sb, bb]);
        await sendCalls([{ to: hp.address, data }]);
      }

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
    } catch (e) { console.warn('onState error', e); }
    finally { lastState = st; }
  }

  async function onHand(m){
    try {
      if (!onChain || !hp) return;
      const me = await myAddrNow(); if (!isOwner(me)) return;

      const winners = Array.isArray(m?.winners) ? m.winners.map(w=>w.addr) : [];
      const payouts = Array.isArray(m?.winners) ? m.winners.map(w=>Number(w.amount || 0)) : [];
      const data    = hp.interface.encodeFunctionData('settleHand', [winners, payouts, 0]);
      await sendCalls([{ to: hp.address, data }]);
    } catch (e) { console.warn('settleHand failed', e); }
  }

  (async () => { try { await ensureHp(); } catch {} })();

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

// =================== Bootstrap ===================
initSocket();
ensureWalletFromAnySource();
