// =================== Poker Lobby (wallet-aware, NO auto-preference) ===================

// ---- DOM refs ----
const statusEl   = document.getElementById('poker-status') || document.getElementById('status');
const lobbyEl    = document.getElementById('lobby');
const connectBtn = document.getElementById('connect-wallet');
const tableEl    = document.getElementById('table') || document.getElementById('poker-table');
const wiAddrEl   = document.getElementById('wb-addr') || document.getElementById('wi-address'); // navbar pill

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

// ---------------- Wallet provider selection (from landing choice) ----------------
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
    // If landing page injected a provider directly, honor it
    if (window.__walletProvider) return window.__walletProvider;

    const key = (sessionStorage.getItem('walletProvider') || '').toLowerCase();
    if (key === 'metamask') return pickMetaMask();
    if (key === 'phantom')  return pickPhantom();
  } catch {}
  return null; // no auto-fallback — user must choose on landing
}

// ---------------- Contract address display ----------------
async function updateContractLabels(){
  try {
    const provider = getSelectedProvider();
    // config.js is ESM
    const mod = await import('../../js/config.js').catch(()=>null);
    if (!mod || !mod.getAddressFor) return;
    // Use plain ethers provider if available (optional for address resolution)
    let ethersProvider = null;
    if (window.ethers && provider) {
      ethersProvider = new window.ethers.providers.Web3Provider(provider, 'any');
    }
    const addr = await mod.getAddressFor('pokerTable', ethersProvider);
    if (!addr) return;
    const shortAddr = addr.slice(0,6) + '...' + addr.slice(-4);
    const ids = ['contract-address','nav-contract','footer-contract'];
    ids.forEach(id=>{
      const el = document.getElementById(id);
      if (el) { el.textContent = shortAddr; el.title = addr; }
    });
  } catch {}
}

// =================== Lobby Rendering ===================
function renderLobby(list){
  try {
    const items = Array.isArray(list) ? list : [];
    if (!lobbyEl) return;

    lobbyEl.innerHTML = '';
    items.forEach(row => {
      const card = document.createElement('div'); card.className='lobby-item';
      const left = document.createElement('div'); left.innerHTML = `<strong>${row.id}</strong><span class="muted">Players ${row.seated}/${row.capacity}${row.limit ? ' • '+row.limit : ''}${row.stakes ? ' • '+row.stakes : ''}${row.simulated ? ' • sim' : ''}</span>`;
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
  } catch (e) { console.error('renderLobby error', e); }
}

// =================== Table Rendering (lobby view target) ===================
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
    for (let i=0; i<8; i++){
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
      // leave both; backend supports WS and polling
      transports: ['websocket','polling'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
      forceNew: true,
      withCredentials: true
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

  socket.on('lobby:list', (list) => renderLobby(list));

  // Accept BOTH names so we work with any server build
  socket.on('table:update', (t) => renderTable(t));
  socket.on('table:state',  (t) => renderTable(t));
}

// =================== Wallet Sync (LOCKED to landing choice) ===================
async function detectExistingAccountFromSelected(){
  try {
    const provider = getSelectedProvider();
    if (!provider) return null;
    const accts = await provider.request?.({ method: 'eth_accounts' }).catch(()=>[]);
    const addr = (accts && accts[0]) || null;
    chainIdHex = await provider.request?.({ method: 'eth_chainId' }).catch(()=>null);
    return addr;
  } catch { return null; }
}

function setKnownAddress(addr){
  try {
    myAddr = lc(addr || '');
    if (wiAddrEl) wiAddrEl.textContent = myAddr ? short(myAddr) : '—';
    window.__WALLET_ADDR = myAddr || '';
    if (myAddr) {
      try { localStorage.setItem('walletConnected','true'); } catch {}
      try { sessionStorage.setItem('walletConnected','true'); } catch {}
      try { localStorage.setItem('walletAddress', myAddr); } catch {}
      try { sessionStorage.setItem('walletAddress', myAddr); } catch {}
      if (socket?.connected) {
        try { socket.emit('identify', { addr: myAddr }); } catch {}
        if (currentTableId) {
          try { socket.emit('lobby:get'); socket.emit('join_table', { table: currentTableId }); } catch {}
        }
      }
      setStatus(`Wallet: ${short(myAddr)}`);
    } else {
      if (wiAddrEl) wiAddrEl.textContent = '—';
      setStatus('Wallet: not connected');
    }
  } catch (e) { console.warn('setKnownAddress failed', e); }
}

async function ensureWalletFromSelected(){
  // 1) Carry the saved address if present
  const saved = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').trim();
  if (saved) setKnownAddress(saved);

  // 2) Ask the selected provider quietly (no prompt)
  const addr = await detectExistingAccountFromSelected();
  if (addr) setKnownAddress(addr);

  // 3) React to wallet changes (on the selected provider only)
  const provider = getSelectedProvider();
  if (provider && provider.on) {
    provider.on('accountsChanged', (arr) => {
      const a = (arr && arr[0]) || null;
      setKnownAddress(a || '');
    });
    provider.on('chainChanged', (id) => {
      chainIdHex = id;
      if (myAddr) setStatus(`Wallet: ${short(myAddr)} | Chain ${id}`);
    });
  }
}

connectBtn?.addEventListener('click', async () => {
  try {
    const provider = getSelectedProvider();
    if (!provider || !window.ethers) { setStatus('No wallet provider selected'); return; }
    await provider.request?.({ method: 'eth_requestAccounts' }); // prompt
    const [addr] = await provider.request?.({ method: 'eth_accounts' }) || [];
    chainIdHex = await provider.request?.({ method: 'eth_chainId' }).catch(()=>null);
    setKnownAddress(addr || '');
  } catch (e) {
    console.error('Wallet connect failed', e);
    setStatus('Wallet connect failed');
  }
});

// =================== Bootstrap ===================
initSocket();
ensureWalletFromSelected();
updateContractLabels();
