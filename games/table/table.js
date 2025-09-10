// Minimal client for multiplayer table (hybrid: on-chain bets to Faro contract)
import { getAddressFor } from '../../js/config.js';
import { signer as walletSigner, provider as walletProvider } from '../../js/tavern.js';
const __isLocalHost = ['localhost','127.0.0.1'].includes(location.hostname);

const statusEl = document.getElementById('status');
const rulesOverlay = document.getElementById('rules-overlay');
const rulesAck = document.getElementById('rules-ack');
const openRulesBtn = document.getElementById('open-rules');
let faroAck = false;
const RULES_VERSION = 'v2';
const logEl = document.getElementById('log');
const tableInput = document.getElementById('table-id');
const joinBtn = document.getElementById('join-table');
const lobbyPanel = document.getElementById('lobby-panel');
const lobbyList = document.getElementById('lobby-list');
const tablePanel = document.getElementById('table-panel');
const centerReadout = document.getElementById('center-readout');
const seatsEls = Array.from(document.querySelectorAll('.seat'));
const returnBtn = document.getElementById('return');
const betAmtInput = document.getElementById('bet-amt');
const betCopperInput = document.getElementById('bet-copper');
const clearBetsBtn = document.getElementById('clear-bets');
const rankButtons = Array.from(document.querySelectorAll('.rank-btn'));

let socket; let myAddr = null; let currentTable = null; let mySeatId = null; let myIsOwner = false;
let onchainSigner = null; let onchainProvider = null; let faroAddr = null;

function short(v) { return v && v.length > 10 ? `${v.slice(0,6)}...${v.slice(-4)}` : (v || ''); }
function log(msg) { try { logEl.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + (logEl.textContent || ''); } catch {} }

// Resolve Faro address based on current provider/network and overrides
async function resolveFaroAddress() {
  try {
    if (!onchainProvider && window.ethereum) {
      const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      onchainProvider = provider;
      onchainSigner = provider.getSigner();
    }
  } catch {}
  try {
    const addr = await getAddressFor('faro', onchainProvider);
    if (addr && addr !== faroAddr) {
      faroAddr = addr;
      log(`Using Faro: ${short(faroAddr)}`);
    }
  } catch {}
}

// Lobby rendering is disabled on the game page
function renderLobby() { try { lobbyPanel.style.display = 'none'; } catch {} }

function renderTable(table) {
  currentTable = table;
  try {
    const seatedNow = Array.isArray(table?.seats) ? table.seats.filter(Boolean).length : 0;
    lobbyPanel.style.display = 'none';
    tablePanel.style.display = (table?.started || seatedNow > 0) ? 'block' : 'none';
  } catch {}
  myIsOwner = false; mySeatId = null;
  try { centerReadout.textContent = ''; } catch {}
  for (const el of seatsEls) {
    const idx = Number(el.dataset.index);
    const s = table.seats[idx];
    el.classList.toggle('ready', !!s?.ready);
    el.innerHTML = '';
    if (s) {
      // Avatar from X handle (public profile); else blank
      try {
        const handle = (s.x||'').replace(/^@/, '').trim();
        if (handle) {
          const img = document.createElement('img');
          img.className = 'avatar';
          img.alt = '';
          img.referrerPolicy = 'no-referrer';
          img.src = `https://unavatar.io/twitter/${encodeURIComponent(handle)}`;
          el.appendChild(img);
        }
      } catch {}
      const a = document.createElement('div'); a.className = 'addr'; a.textContent = s?.x ? (`${s.x} (${short(s.addr||s.id)})`) : short(s.addr || s.id); el.appendChild(a);
      const bal = document.createElement('div'); bal.className = 'bal'; bal.textContent = `Bal: ${Number(s.balance ?? 0)}`; el.appendChild(bal);
      // Show aggregate bet chip if present
      try {
        const total = Number(s.betTotal || 0);
        if (total > 0) { const chip = document.createElement('div'); chip.className = 'chip'; chip.textContent = String(total); el.appendChild(chip); }
      } catch {}
      const me = (s.addr && myAddr && s.addr.toLowerCase() === myAddr.toLowerCase());
      if (me) { mySeatId = s.id; }
      if (me) {
        const btns = document.createElement('div'); btns.className = 'btns';
        const vacate = document.createElement('button'); vacate.textContent = 'Leave';
        vacate.onclick = () => socket?.emit('seat', { index: -1 });
        const readyBtn = document.createElement('button'); readyBtn.textContent = s.ready ? 'Unready' : 'Ready';
        readyBtn.onclick = () => socket?.emit('ready', { ready: !s.ready });
        btns.appendChild(vacate);
        btns.appendChild(readyBtn);
        el.appendChild(btns);
      }
      // Countdown placeholder element
      try {
        let cd = el.querySelector('.countdown');
        if (!cd) {
          cd = document.createElement('div');
          cd.className = 'countdown';
          cd.style.cssText = 'position:absolute; top:-10px; left:-10px; background:#8b0000; color:#fff; font-size:12px; padding:2px 6px; border-radius:999px; display:none;';
          el.appendChild(cd);
        }
      } catch {}
    } else {
      const a = document.createElement('div'); a.className = 'addr'; a.textContent = 'Empty'; el.appendChild(a);
      const btns = document.createElement('div'); btns.className = 'btns';
      const sit = document.createElement('button'); sit.textContent = 'Sit';
      if (!faroAck) { sit.disabled = true; sit.title = 'Acknowledge rules to join'; }
      sit.onclick = () => { if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; } socket?.emit('seat', { index: idx }); };
      btns.appendChild(sit); el.appendChild(btns);
    }
  }
  const seated = table.seats.filter(Boolean);
  const allReady = seated.length && seated.every(s => !!s.ready);
  try {
    const meSeat = seated.find(s => s?.addr && myAddr && s.addr.toLowerCase()===String(myAddr).toLowerCase());
    if (!table.started) {
      centerReadout.textContent = 'Place your bet';
    } else if (!allReady) {
      const myBetPlaced = Number(meSeat?.betTotal||0) > 0;
      if (meSeat && !meSeat.ready) centerReadout.textContent = myBetPlaced ? 'Click Ready to lock your bet' : 'Place your bet';
      else centerReadout.textContent = 'Waiting for players to Ready...';
    } else {
      centerReadout.textContent = 'All players ready';
    }
    // Toggle Clear Bets visibility: only during placing bets stage for my seat
    try {
      if (clearBetsBtn) {
        const show = !!meSeat && !!table.started && !meSeat.ready && Number(meSeat?.betTotal||0) > 0;
        clearBetsBtn.style.display = show ? 'inline-block' : 'none';
      }
    } catch {}
  } catch {}
  // No manual start/deal controls
}

// Update per-seat countdown timers (visible only in last 30s of a 90s window)
const INACTIVITY_MS = 90_000; const SHOW_WINDOW_MS = 30_000;
function updateCountdowns() {
  try {
    if (!currentTable || !currentTable.started) return;
    const seats = Array.isArray(currentTable.seats) ? currentTable.seats : [];
    seatsEls.forEach((el) => {
      try {
        const idx = Number(el.dataset.index);
        const s = seats[idx];
        const cd = el.querySelector('.countdown');
        if (!s || !cd) { if (cd) cd.style.display = 'none'; return; }
        if (s.ready) { cd.style.display = 'none'; return; }
        const last = Number(s.lastActive||0);
        if (!last) { cd.style.display = 'none'; return; }
        const rem = INACTIVITY_MS - (Date.now() - last);
        if (rem <= 0) { cd.style.display = 'none'; return; }
        if (rem <= SHOW_WINDOW_MS) {
          cd.textContent = `${Math.ceil(rem/1000)}s`;
          cd.style.display = 'inline-block';
        } else {
          cd.style.display = 'none';
        }
      } catch {}
    });
  } catch {}
}
setInterval(updateCountdowns, 1000);

async function ensureIo(){
  if (window.io) return;
  await new Promise((resolve)=>{
    const s=document.createElement('script');
    s.src='https://cdn.socket.io/4.7.5/socket.io.min.js';
    s.onload=resolve; s.onerror=resolve; document.head.appendChild(s);
  });
}

async function connect() {
  await ensureIo();
  // Prefer websocket but allow polling fallback through proxies/CDNs
  socket = io(window.location.origin, { path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 800 });
  const showLobby = () => { try { lobbyPanel.style.display = 'none'; } catch {} };

  socket.on('connect', () => {
    log('Connected to server');
    if (myAddr) socket.emit('identify', { addr: myAddr });
    // Auto-join table from URL ?table=ID if present; otherwise default to 'faro-1'
    let tableId = null;
    try { const u = new URL(window.location.href); tableId = u.searchParams.get('table'); } catch {}
    if (!tableId) tableId = 'faro-1';
    try { socket.emit('join_table', { table: tableId }); } catch {}
    // Publish public handle from localStorage if available
    try { const x = localStorage.getItem('profile.public.x'); if (x) socket.emit('profile_public', { x }); } catch {}
  });
  socket.on('connect_error', (err) => {
    log('Connection error: ' + (err?.message || 'unknown'));
    showLobby('Lobby server unavailable. Retrying…');
  });
  socket.on('reconnect_error', () => { showLobby('Reconnecting to lobby…'); });
  socket.on('reconnect_failed', () => { showLobby('Unable to reach lobby. Please retry.'); });
  socket.on('lobby:list', (list) => { renderLobby(Array.isArray(list)?list:[]); });
  socket.on('table:update', (table) => { renderTable(table); });
  socket.on('table:started', (table) => {
    log('Game started!');
    try { tablePanel.style.display = 'block'; } catch {}
    try { centerReadout.textContent = 'Place your bet'; } catch {}
    renderTable(table);
  });
  socket.on('table:coup', (m) => {
    const bank = Number(m.bankRank); const player = Number(m.playerRank);
    const name = (r)=> ({1:'A',11:'J',12:'Q',13:'K'}[r] || String(r));
    log(`Coup: bank=${bank}(${name(bank)}), player=${player}(${name(player)})${m.doublet ? ' (doublet)' : ''}`);
    const winners = Array.isArray(m.results) ? m.results.filter(r => Number(r.delta||0) > 0).map(r => short(String(r.addr||''))) : [];
    if (Array.isArray(m.results)) m.results.forEach(r => log(`${short(r.addr)}: ${r.delta >= 0 ? '+' : ''}${r.delta}`));
    try {
      const label = `Bank ${name(bank)} vs Player ${name(player)}${m.doublet?' (doublet)':''}`;
      const who = winners.length ? ` Winners: ${winners.join(', ')}` : '';
      centerReadout.textContent = label + who;
    } catch {}
    renderTable(m.table);
  });
  socket.on('chat', (m) => { log(`${m.from}: ${m.text}`); });
  socket.on('error', (e) => { log(`Error: ${e?.message || 'unknown'}`); });
  socket.on('disconnect', () => { log('Disconnected. Reconnecting in 2s...'); setTimeout(connect, 2000); showLobby(); });
}

// Attach UI handlers
joinBtn?.addEventListener('click', () => {
  if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; }
  const id = (tableInput?.value || 'lobby').trim();
  socket?.emit('join_table', { table: id });
});


// No start/deal buttons

rankButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!faroAck) { try { rulesOverlay.style.display='flex'; } catch{}; return; }
    const rankLabel = btn.dataset.rank;
    const map = { A:1, J:11, Q:12, K:13 };
    const rankNum = map[rankLabel] || Number(rankLabel);
    const amt = Number(betAmtInput.value || 0);
    if (!(rankNum>=1 && rankNum<=13)) return;
    if (!(amt>0)) { log('Enter a valid MON amount'); return; }
    const copper = !!betCopperInput.checked;
    try { const chips = Math.max(1, Math.floor(amt * 100)); socket?.emit('place_bet', { rank: rankNum, amount: chips, copper }); } catch {}
    placeOnchainBet(rankNum, amt, copper).catch(e=> log('Tx failed: ' + (e?.data?.message || e?.message || 'unknown')));
  });
});

// Clear bets handler
clearBetsBtn?.addEventListener('click', () => {
  try { socket?.emit('clear_bets'); } catch {}
});

returnBtn?.addEventListener('click', () => { window.location.href = '/index.html'; });

// Resolve address (if connected previously via Tavern) for display/identity
(async () => {
  try {
    if (window.ethereum) {
      const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      const accounts = await provider.listAccounts();
      if (accounts && accounts.length) myAddr = accounts[0];
      // Auto-connect if previously authorized on this domain
      try {
        if ((!accounts || !accounts.length) && localStorage.getItem('walletConnected') === 'true') {
          await window.ethereum.request({ method: 'eth_requestAccounts' });
          const acc2 = await provider.listAccounts();
          if (acc2 && acc2.length) myAddr = acc2[0];
        }
      } catch {}
      onchainProvider = walletProvider || provider;
      onchainSigner = walletSigner || provider.getSigner();
      // Resolve Faro address
      try { await resolveFaroAddress(); } catch {}
      try {
        // React to network/account changes by refreshing address
        if (window.ethereum?.on) {
          window.ethereum.on('chainChanged', async () => { try { await resolveFaroAddress(); } catch {} });
          window.ethereum.on('accountsChanged', async (accs) => { try { myAddr = (accs && accs[0]) || myAddr; } catch {} });
        }
      } catch {}
    }
  } catch {}
  await connect();
})();

// Session-based rules modal for Faro
const onReady = (fn) => { if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', fn, { once: true }); } else { fn(); } };
onReady(() => {
  // Require rules acknowledgement every load
  faroAck = false;
  try { rulesOverlay.style.display='flex'; } catch {}
  rulesAck?.addEventListener('click', () => {
    faroAck = true;
    try { rulesOverlay.style.display='none'; } catch {}
  });
  openRulesBtn?.addEventListener('click', () => { try { rulesOverlay.style.display='flex'; } catch {} });
});

async function placeOnchainBet(rankNum, ethAmount, copper) {
  // Ensure ABI present (FaroV3 preferred)
  async function ensureAbi() {
    if (window.FaroV3ABI || window.FaroABI) return true;
    const candidates = ['/js/FaroV3ABI.js','/js/FaroABI.js','../../js/FaroV3ABI.js','../../js/FaroABI.js'];
    for (const src of candidates) {
      try {
        await new Promise((resolve) => { const s=document.createElement('script'); s.src=src; s.onload=()=>resolve(true); s.onerror=()=>resolve(false); document.head.appendChild(s); });
        if (window.FaroV3ABI || window.FaroABI) return true;
      } catch {}
    }
    return !!(window.FaroV3ABI || window.FaroABI);
  }
  await ensureAbi();
  const hasAbi = !!(window.FaroV3ABI || window.FaroABI);
  // Re-resolve address in case network/overrides changed
  try { await resolveFaroAddress(); } catch {}
  if (!onchainSigner || !faroAddr || !hasAbi) {
    if (!onchainSigner) log('Connect wallet first');
    else if (!faroAddr) log('Faro address missing. Set it on Admin (Override) or run: localStorage.setItem(\'contract.faro\',\'0x...\'); then reload');
    else if (!hasAbi) log('Faro ABI not loaded. Ensure /js/FaroV3ABI.js or /js/FaroABI.js is present');
    else log('Connect wallet; Faro contract not configured');
    return;
  }
  const ethersRef = window.ethers;
  let abi = window.FaroV3ABI || window.FaroABI; // prefer V3 with copper
  const c = new ethersRef.Contract(faroAddr, abi, onchainSigner);
  log(`Submitting on-chain bet ${ethAmount} MON on ${rankNum}${copper ? ' (copper)' : ''}…`);
  const tx = window.FaroV3ABI
    ? await c.playFaro(rankNum, copper, { value: ethersRef.utils.parseEther(String(ethAmount)) })
    : await c.playFaro(rankNum, { value: ethersRef.utils.parseEther(String(ethAmount)) });
  log(`Tx sent: ${tx.hash.slice(0,10)}… waiting…`);
  const rc = await tx.wait();
  try {
    const ev = rc.events?.find(e => e.event === 'FaroPlayed');
    if (ev && ev.args) {
      const win = !!ev.args.win; const push = !!ev.args.push;
      const bank = Number(ev.args.bankRank); const player = Number(ev.args.playerRank);
      log(push ? `Push. bank=${bank}, player=${player}` : (win ? `You won! bank=${bank}, player=${player}` : `You lost. bank=${bank}, player=${player}`));
    } else {
      log('Confirmed on-chain. Check explorer for details.');
    }
  } catch {}
}

