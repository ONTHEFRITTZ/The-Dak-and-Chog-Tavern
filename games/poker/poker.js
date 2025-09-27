/* Poker Lobby + Table UI (pure JS) */
'use strict';

/* ---------- DOM refs ---------- */
const statusEl   = document.getElementById('poker-status') || document.getElementById('status');
const connectBtn = document.getElementById('connect-wallet');
const tableEl    = document.getElementById('table') || document.getElementById('poker-table');
const wiAddrEl   = document.getElementById('wb-addr') || document.getElementById('wi-address');

/* Lobby section refs (match your index.html) */
const listFL  = document.getElementById('list-onchain-limit');
const listNL  = document.getElementById('list-onchain-nl');
const listOFF = document.getElementById('list-offchain');
const noteFL  = document.getElementById('oclim-note');
const noteNL  = document.getElementById('ocnl-note');
const noteOFF = document.getElementById('off-note');

/* ---------- URL helpers ---------- */
function getQueryParam(k) {
  try { return new URL(window.location.href).searchParams.get(k); } catch (e) { return null; }
}
const currentTableId = (window.currentTableId || getQueryParam('table')) || null;

/* ---------- globals ---------- */
let socket = null;
let myAddr = null;
let chainIdHex = null;

/* ---------- utils ---------- */
function short(a) {
  try { return a && a.length > 10 ? (a.slice(0, 6) + '...' + a.slice(-4)) : (a || ''); }
  catch (e) { return a || ''; }
}
function setStatus(t) { try { if (statusEl) statusEl.textContent = t; } catch (e) {} }
function lc(a) { return (a || '').toString().toLowerCase(); }

function setKnownAddress(addr) {
  try {
    myAddr = lc(addr || '');
    if (myAddr) {
      try {
        localStorage.setItem('walletConnected', 'true');
        sessionStorage.setItem('walletConnected', 'true');
        localStorage.setItem('walletAddress', myAddr);
        sessionStorage.setItem('walletAddress', myAddr);
      } catch (e) {}
      if (wiAddrEl) wiAddrEl.textContent = short(myAddr);
      window.__WALLET_ADDR = myAddr;
      try {
        window.dispatchEvent(new CustomEvent('wallet:connected', { detail: { address: myAddr, chainId: chainIdHex } }));
      } catch (e) {}

      if (socket && socket.connected) {
        try { socket.emit('identify', { addr: myAddr }); } catch (e) {}
        if (currentTableId) {
          try { socket.emit('lobby:get'); socket.emit('join_table', { table: currentTableId }); } catch (e) {}
        }
      }
      setStatus('Wallet: ' + short(myAddr));
    } else {
      if (wiAddrEl) wiAddrEl.textContent = '—';
      setStatus('Wallet: not connected');
    }
  } catch (e) {
    console.warn('setKnownAddress failed', e);
  }
}

/* =================== Lobby Rendering (3 buckets) ===================
   Backend rows contain: id, seated, capacity, started, limit ('NL'|'FL'), stakes, simulated (bool)
   Bucket rules:
   - On-chain Limit:   row.limit === 'FL'
   - On-chain NL:      row.limit !== 'FL' && row.simulated === false
   - Off-chain (Sim):  row.simulated === true
==================================================================== */
function renderLobby(list) {
  try {
    const rows = Array.isArray(list) ? list.filter(Boolean) : [];
    if (!listFL || !listNL || !listOFF) return;

    listFL.innerHTML = '';
    listNL.innerHTML = '';
    listOFF.innerHTML = '';

    let cFL = 0, cNL = 0, cOFF = 0;

    function makeCard(row, subtitle) {
      const card = document.createElement('div');
      card.className = 'lobby-item';

      const left = document.createElement('div');
      left.style.flex = '1 1 auto';

      const title = document.createElement('strong');
      title.textContent = row.id;

      const meta = document.createElement('div');
      meta.className = 'muted';
      const parts = ['Players ' + Number(row.seated || 0) + '/' + Number(row.capacity || 0)];
      if (subtitle) parts.unshift(subtitle);
      meta.textContent = parts.join(' • ');

      left.appendChild(title);
      left.appendChild(meta);

      const btn = document.createElement('button');
      btn.textContent = 'Open Table';
      btn.onclick = function () {
        try {
          const u = new URL(window.location.href);
          u.pathname = '/games/poker/table.html';
          u.searchParams.set('table', row.id);
          window.location.href = u.toString();
        } catch (e) {
          window.location.href = '/games/poker/table.html?table=' + encodeURIComponent(row.id);
        }
      };

      card.appendChild(left);
      card.appendChild(btn);
      return card;
    }

    rows.forEach(function (row) {
      // poker tables (ignore Faro rows if any slipped in)
      const isPokerish = (row.limit === 'NL' || row.limit === 'FL' || typeof row.simulated === 'boolean');
      if (!isPokerish) return;

      if (row.limit === 'FL') {
        listFL.appendChild(makeCard(row, row.stakes ? ('Limit • ' + row.stakes) : 'Limit'));
        cFL++;
      } else if (row.simulated === true) {
        listOFF.appendChild(makeCard(row, 'Simulated (Off-chain)'));
        cOFF++;
      } else {
        listNL.appendChild(makeCard(row, 'No-Limit'));
        cNL++;
      }
    });

    if (noteFL)  noteFL.textContent  = cFL  ? (cFL + ' table' + (cFL !== 1 ? 's' : ''))  : 'no tables';
    if (noteNL)  noteNL.textContent  = cNL  ? (cNL + ' table' + (cNL !== 1 ? 's' : ''))  : 'no tables';
    if (noteOFF) noteOFF.textContent = cOFF ? (cOFF + ' table' + (cOFF !== 1 ? 's' : '')) : 'no tables';
  } catch (e) {
    console.error('renderLobby error', e);
  }
}

/* =================== Table Rendering (Poker; 8 seats) =================== */
function renderTable(t) {
  try {
    if (!tableEl) return;
    if (!t || (currentTableId && t.id !== currentTableId)) return;

    tableEl.innerHTML = '';

    const title = document.createElement('div');
    title.style.marginBottom = '8px';
    title.textContent = 'Table ' + t.id;
    tableEl.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns: repeat(4, minmax(140px,1fr)); gap:10px;';

    const seats = Array.isArray(t.seats) ? t.seats : [];
    const CAP = Math.max(8, Number(t.capacity || 8));

    for (let i = 0; i < CAP; i++) {
      const panel = document.createElement('div');
      panel.style.cssText = 'border:1px solid #7800cd; border-radius:8px; padding:8px; background:rgba(255,255,255,0.6);';

      const s = seats[i];
      const label = document.createElement('div');
      label.textContent = 'Seat ' + i;
      panel.appendChild(label);

      const info = document.createElement('div');
      info.style.fontSize = '12px';
      info.style.margin = '6px 0';

      if (s) {
        info.textContent = short(s.addr || s.id);
        panel.appendChild(info);

        if (myAddr && s.addr && lc(s.addr) === myAddr) {
          const btnLeave = document.createElement('button');
          btnLeave.textContent = 'Leave';
          btnLeave.onclick = function () { try { if (socket) socket.emit('seat', { index: -1 }); } catch (e) {} };
          panel.appendChild(btnLeave);

          const btnReady = document.createElement('button');
          btnReady.style.marginLeft = '6px';
          btnReady.textContent = s.ready ? 'Unready' : 'Ready';
          btnReady.onclick = function () { try { if (socket) socket.emit('ready', { ready: !s.ready }); } catch (e) {} };
          panel.appendChild(btnReady);
        }
      } else {
        info.textContent = 'Empty';
        panel.appendChild(info);

        const btnSit = document.createElement('button');
        btnSit.textContent = 'Sit';
        if (!myAddr) { btnSit.disabled = true; btnSit.title = 'Connect wallet to sit'; }
        btnSit.onclick = function () {
          if (!myAddr) return;
          try { if (socket) socket.emit('seat', { index: i }); } catch (e) {}
        };
        panel.appendChild(btnSit);
      }

      grid.appendChild(panel);
    }

    tableEl.appendChild(grid);
  } catch (e) {
    console.error('renderTable error', e);
  }
}

/* =================== Socket.IO =================== */
function initSocket() {
  try {
    if (!window.io) {
      setStatus('Socket.IO script missing');
      return;
    }
    socket = window.io(window.location.origin, {
      path: '/poker.io/',
      transports: ['websocket'],   // force WS
      upgrade: false,
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

  socket.on('connect', function () {
    setStatus('Connected');
    try { socket.emit('lobby:get'); } catch (e) {}
    if (myAddr) { try { socket.emit('identify', { addr: myAddr }); } catch (e) {} }
    if (currentTableId) { try { socket.emit('join_table', { table: currentTableId }); } catch (e) {} }
  });

  socket.on('connect_error', function (err) {
    setStatus('Lobby unavailable. Retrying...');
    console.warn('connect_error', (err && (err.message || err)) || 'error');
  });
  socket.on('reconnect_error', function () { setStatus('Reconnecting...'); });
  socket.on('disconnect', function () { setStatus('Disconnected'); });

  /* LOBBY */
  socket.on('lobby:list', function (list) { renderLobby(list); });

  /* TABLE (accept both) */
  socket.on('table:update', function (t) { renderTable(t); });
  socket.on('table:state',  function (t) { renderTable(t); });

  /* Optional, keep hooks ready
  socket.on('poker:state', function (m) {});
  socket.on('poker:hand',  function (m) {});
  */
}

/* =================== Wallet Sync =================== */
function getInjectedProvider() {
  try {
    if (window.phantom && window.phantom.ethereum) return window.phantom.ethereum;
    if (window.ethereum) return window.ethereum;
    if (window.__walletProvider) return window.__walletProvider;
  } catch (e) {}
  return null;
}

function detectExistingAccount() {
  return (async function () {
    try {
      const injected = getInjectedProvider();
      if (!injected) return null;
      const accts = await (injected.request ? injected.request({ method: 'eth_accounts' }) : Promise.resolve([])).catch(function () { return []; });
      const addr = (accts && accts[0]) || null;
      chainIdHex = await (injected.request ? injected.request({ method: 'eth_chainId' }) : Promise.resolve(null)).catch(function () { return null; });
      return addr;
    } catch (e) { return null; }
  })();
}

function ensureWalletFromAnySource() {
  (function () {
    try {
      const saved = (localStorage.getItem('walletAddress') || sessionStorage.getItem('walletAddress') || '').trim();
      if (saved) setKnownAddress(saved);
    } catch (e) {}
  })();

  detectExistingAccount().then(function (addr) {
    if (addr) setKnownAddress(addr);
  });

  window.addEventListener('wallet:connected', function (e) {
    const addr2 = (e && e.detail && (e.detail.address || e.detail.addr)) || null;
    if (addr2) setKnownAddress(addr2);
  });

  const injected = getInjectedProvider();
  if (injected && injected.on) {
    injected.on('accountsChanged', function (arr) {
      const a = (arr && arr[0]) || null;
      setKnownAddress(a || '');
    });
    injected.on('chainChanged', function (id) {
      chainIdHex = id;
      if (myAddr) setStatus('Wallet: ' + short(myAddr) + ' | Chain ' + id);
    });
  }
}

if (connectBtn) {
  connectBtn.addEventListener('click', function () {
    (async function () {
      try {
        const injected = getInjectedProvider();
        if (!injected || !window.ethers) { setStatus('No wallet provider found'); return; }
        if (injected.request) {
          await injected.request({ method: 'eth_requestAccounts' });
          const accts = await injected.request({ method: 'eth_accounts' }) || [];
          const addr = accts[0] || '';
          chainIdHex = await injected.request({ method: 'eth_chainId' }).catch(function () { return null; });
          setKnownAddress(addr);
        }
      } catch (e) {
        console.error('Wallet connect failed', e);
        setStatus('Wallet connect failed');
      }
    })();
  });
}

/* =================== On-chain orchestration (your logic kept) =================== */
(function () {
  let onChain = false, hp = null, hpOwner = null, lastState = null, nextHandId = 1;

  async function ensureHp() {
    try {
      if (!window.ethers || !window.HoldemPokerABI) return false;
      const mod = await import('../../js/config.js').catch(function () { return null; });
      if (!mod) return false;

      const provider = new window.ethers.providers.Web3Provider(getInjectedProvider() || window.ethereum, 'any');
      const signer   = provider.getSigner();
      const addr     = await (mod.getAddressFor ? mod.getAddressFor('pokerTable', provider) : null);
      if (!addr) return false;

      hp      = new window.ethers.Contract(addr, window.HoldemPokerABI, signer);
      hpOwner = await hp.owner();
      return true;
    } catch (e) { console.warn('ensureHp failed', e); return false; }
  }

  function isOwner(addr) {
    try { return !!addr && !!hpOwner && lc(addr) === lc(hpOwner); }
    catch (e) { return false; }
  }

  async function myAddrNow() {
    try {
      const injected = getInjectedProvider() || window.ethereum;
      if (!injected || !window.ethers) return null;
      const p = new window.ethers.providers.Web3Provider(injected, 'any');
      const a = await p.listAccounts();
      return (a && a[0]) || null;
    } catch (e) { return null; }
  }

  async function sendCalls(calls) {
    const from = await myAddrNow();
    try {
      const det = await (window.Bundler && window.Bundler.detectBundler ? window.Bundler.detectBundler(getInjectedProvider() || window.ethereum) : null);
      if (det && det.available) {
        const net = await (new window.ethers.providers.Web3Provider(getInjectedProvider() || window.ethereum, 'any')).getNetwork().catch(function () { return { chainId: undefined }; });
        const res = await window.Bundler.walletSendCalls({ provider: det.provider, from: from, chainId: Number(net && net.chainId), calls: calls });
        const hash = window.Bundler.extractTxHash ? window.Bundler.extractTxHash(res) : null;
        if (hash && window.Bundler.waitForTransactionReceipt) {
          await window.Bundler.waitForTransactionReceipt(det.provider, hash);
        }
        return true;
      }
    } catch (e) { console.warn('bundled send failed', e); }

    try {
      const injected = getInjectedProvider() || window.ethereum;
      const w3 = new window.ethers.providers.Web3Provider(injected, 'any');
      const signer = w3.getSigner();
      for (let i = 0; i < (calls || []).length; i++) {
        const c = calls[i];
        const tx = await signer.sendTransaction({ to: c.to, data: c.data, value: c.value || '0x0' });
        if (tx && tx.wait) await tx.wait();
      }
      return true;
    } catch (e) { console.warn('fallback send failed', e); return false; }
  }

  async function onState(st) {
    try {
      if (!onChain || !hp) return;
      const me = await myAddrNow(); if (!isOwner(me)) return;

      if ((!lastState || !lastState.stage) && st && st.stage === 'preflop') {
        const dealer = (Number(st.dealerIndex || 0) | 0);
        const N = (st.actors && st.actors.length) ? st.actors.length : 6;
        const sb = (dealer + 1) % N;
        const bb = (dealer + 2) % N;
        const data = hp.interface.encodeFunctionData('beginHand', [nextHandId++, dealer, sb, bb]);
        await sendCalls([{ to: hp.address, data: data }]);
      }

      if (lastState && lastState.actors && st && st.actors && Array.isArray(st.actors)) {
        const calls = [];
        for (let i = 0; i < st.actors.length; i++) {
          const now = Number(st.actors[i] && st.actors[i].contrib || 0);
          const prev = Number(lastState.actors[i] && lastState.actors[i].contrib || 0);
          const d = Math.max(0, now - prev);
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

  async function onHand(m) {
    try {
      if (!onChain || !hp) return;
      const me = await myAddrNow(); if (!isOwner(me)) return;

      const winners = Array.isArray(m && m.winners) ? m.winners.map(function (w) { return w.addr; }) : [];
      const payouts = Array.isArray(m && m.winners) ? m.winners.map(function (w) { return Number(w.amount || 0); }) : [];
      const data = hp.interface.encodeFunctionData('settleHand', [winners, payouts, 0]);
      await sendCalls([{ to: hp.address, data: data }]);
    } catch (e) {
      console.warn('settleHand failed', e);
    }
  }

  (function bootHp() { ensureHp().catch(function () {}); })();

  (function bind() {
    try {
      if (socket) {
        socket.on('poker:mode',  function (m) { onChain = !(m && m.simulated); });
        socket.on('poker:state', onState);
        socket.on('poker:hand',  onHand);
      } else {
        setTimeout(bind, 300);
      }
    } catch (e) {
      setTimeout(bind, 300);
    }
  })();
})();

/* =================== Bootstrap =================== */
initSocket();
ensureWalletFromAnySource();
