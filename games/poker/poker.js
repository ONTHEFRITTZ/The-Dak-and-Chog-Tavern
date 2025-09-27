// =================== Poker Lobby (respects landing wallet choice; 3 sections) ===================

// ---- DOM refs ----
const statusEl        = document.getElementById('poker-status') || document.getElementById('status');
const connectBtn      = document.getElementById('connect-wallet');
const wiAddrEl        = document.getElementById('wb-addr') || document.getElementById('wi-address'); // navbar pill

// Three lists + notes (as in your lobby HTML)
const listLimitEl     = document.getElementById('list-onchain-limit');
const listNLEl        = document.getElementById('list-onchain-nl');
const listOffEl       = document.getElementById('list-offchain');
const noteLimitEl     = document.getElementById('oclim-note');
const noteNLEl        = document.getElementById('ocnl-note');
const noteOffEl       = document.getElementById('off-note');

// ---- URL helpers ----
function getQueryParam(k){ try { return new URL(window.location.href).searchParams.get(k); } catch { return null; } }
const currentTableId = (window.currentTableId ?? getQueryParam('table')) || null;

// ---- globals ----
let socket;
let myAddr = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').toLowerCase();
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
    if (window.__walletProvider) return window.__walletProvider; // landing may have set this
    const key = (sessionStorage.getItem('walletProvider') || '').toLowerCase();
    if (key === 'metamask') return pickMetaMask();
    if (key === 'phantom')  return pickPhantom();
  } catch {}
  return null; // no auto-fallback — user must choose on landing
}

// ---------------- Contract address display (optional) ----------------
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

// =================== Render helpers for the three sections ===================
function clearLists(){
  if (listLimitEl) listLimitEl.innerHTML = '';
  if (listNLEl)    listNLEl.innerHTML    = '';
  if (listOffEl)   listOffEl.innerHTML   = '';
}
function setNotes(limitCnt, nlCnt, offCnt){
  if (noteLimitEl) noteLimitEl.textContent = limitCnt ? `${limitCnt} table${limitCnt>1?'s':''}` : 'no tables';
  if (noteNLEl)    noteNLEl.textContent    = nlCnt    ? `${nlCnt} table${nlCnt>1?'s':''}`     : 'no tables';
  if (noteOffEl)   noteOffEl.textContent   = offCnt   ? `${offCnt} table${offCnt>1?'s':''}`   : 'no tables';
}
function cardFor(row){
  const card = document.createElement('div'); card.className='lobby-item';
  const left = document.createElement('div');
  const meta = [
    `Players ${row.seated}/${row.capacity}`,
    row.limit ? row.limit : '',
    row.stakes ? row.stakes : '',
    row.simulated ? 'sim' : ''
  ].filter(Boolean).join(' • ');
  left.innerHTML = `<strong>${row.id}</strong><span class="muted">${meta}</span>`;
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
  return card;
}

// List splitter based on server fields:
// - row.limit: 'FL' (fixed/limit) => ON-CHAIN LIMIT
// - row.limit: 'NL' and !row.simulated => ON-CHAIN NL
// - row.simulated === true => OFF-CHAIN (Simulated)
function renderLobby(list){
  try {
    const items = Array.isArray(list) ? list : [];
    clearLists();

    const limit = [];
    const nl    = [];
    const off   = [];

    items.forEach(row => {
      // Guard: only poker rows should have these fields, but handle generically
      if (row.simulated) {
        off.push(row);
      } else if (String(row.limit||'').toUpperCase() === 'FL') {
        limit.push(row);
      } else if (String(row.limit||'').toUpperCase() === 'NL') {
        nl.push(row);
      }
    });

    // Populate each list
    if (listLimitEl) {
      if (limit.length) limit.forEach(r => listLimitEl.appendChild(cardFor(r)));
      else listLimitEl.innerHTML = '';
    }
    if (listNLEl) {
      if (nl.length) nl.forEach(r => listNLEl.appendChild(cardFor(r)));
      else listNLEl.innerHTML = '';
    }
    if (listOffEl) {
      if (off.length) off.forEach(r => listOffEl.appendChild(cardFor(r)));
      else listOffEl.innerHTML = '';
    }

    setNotes(limit.length, nl.length, off.length);
  } catch (e) { console.error('renderLobby error', e); }
}

// =================== Socket.IO ===================
function initSocket(){
  try {
    socket = io(window.location.origin, {
      path: '/poker.io/',
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

  // table events are harmless here; ignore or use if you show a preview
  socket.on('table:update', () => {});
  socket.on('table:state',  () => {});
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
      }
      setStatus(`Wallet: ${short(myAddr)}`);
    } else {
      if (wiAddrEl) wiAddrEl.textContent = '—';
      setStatus('Wallet: not connected');
    }
  } catch (e) { console.warn('setKnownAddress failed', e); }
}

async function ensureWalletFromSelected(){
  const saved = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').trim();
  if (saved) setKnownAddress(saved);

  const addr = await detectExistingAccountFromSelected();
  if (addr) setKnownAddress(addr);

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
