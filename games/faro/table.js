// Minimal client for multiplayer table (hybrid: on-chain bets to Faro contract)
import { getAddressFor } from '../../js/config.js';
import { signer as walletSigner, provider as walletProvider } from '../../js/tavern.js';
const __isLocalHost = ['localhost','127.0.0.1'].includes(location.hostname);

const statusEl = document.getElementById('status');
// Inline wallet elements (match Poker UI)
const disconnectBtn = document.getElementById('wi-disconnect') || document.getElementById('disconnect-wallet');
const walletAddrSpan = document.getElementById('wi-address');
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

// Modal elements for multi-bet flow
const betModal = document.getElementById('bet-modal');
const betRowsEl = document.getElementById('bet-rows');
const betAddBtn = document.getElementById('bet-add');
const betClearBtn = document.getElementById('bet-clear');
const betCancelBtn = document.getElementById('bet-cancel');
const betConfirmBtn = document.getElementById('bet-confirm');

// Local state
let stagedBets = [];     // [{ rank: 1..13, amountEth: number, copper: bool }]
let myPendingBets = [];  // queued for on-chain when Ready
let centerLockUntil = 0; // keep results visible briefly after a coup

// Ensure the center banner sits visually on top and as the last child of the canvas
function elevateCenterBanner() {
  try {
    const el = document.getElementById('center-readout');
    if (!el) return;
    // Bring to top visually
    el.style.position = 'absolute';
    // Keep below bet modal (z-index 21000) so it never covers it
    el.style.zIndex = '20000';
    el.style.pointerEvents = 'none';
    // Re-append as last child of canvas to ensure it paints last
    const canvas = document.querySelector('.table-canvas');
    if (canvas && el.parentElement === canvas && canvas.lastElementChild !== el) {
      canvas.appendChild(el);
    }
  } catch {}
}

// Center message helper that respects result lock window
function setCenter(text, forceOverride = false) {
  try {
    const now = Date.now();
    if (!centerReadout) return;
    if (forceOverride || now >= centerLockUntil) {
      elevateCenterBanner();
      centerReadout.textContent = String(text || '');
    }
  } catch {}
}

function rankLabel(n){ return ({1:'A',11:'J',12:'Q',13:'K'}[n] || String(n)); }
function rankNumber(l){ const map={A:1,J:11,Q:12,K:13}; return map[l] || Number(l); }
function allRanks(){ return [1,2,3,4,5,6,7,8,9,10,11,12,13]; }

// Open modal seeded with clicked rank
function openBetModal(initialRank){
  try{
    const r = Number(initialRank);
    if (!stagedBets.length) {
      stagedBets = [{ rank: r, amountEth: Number(betAmtInput?.value||0.01)||0.01, copper: !!betCopperInput?.checked }];
    } else if (!stagedBets.some(b => b.rank === r)) {
      stagedBets.push({ rank: r, amountEth: Number(betAmtInput?.value||0.01)||0.01, copper: !!betCopperInput?.checked });
    }
    renderBetRows();
    if (betModal) betModal.style.display = 'flex';
  }catch(e){}
}

// --- Center table seats in an even ring around the surface (like Poker) ---
function getRingRadii() {
  try {
    const canvas = document.querySelector('.table-canvas');
    const cs = getComputedStyle(canvas || document.documentElement);
    const rx = parseFloat(cs.getPropertyValue('--ring-rx')) || 46;
    const ry = parseFloat(cs.getPropertyValue('--ring-ry')) || 42;
    return { rx, ry };
  } catch { return { rx: 46, ry: 42 }; }
}
function positionSeatsRing(){
  try {
    const n = seatsEls.length || 6;
    const rr = getRingRadii();
    const rx = rr.rx, ry = rr.ry, startDeg = -90;
    seatsEls.forEach(function(el, i){
      const ang = (startDeg + (360 / n) * i) * Math.PI / 180;
      const left = 50 + rx * Math.cos(ang);
      const top = 50 + ry * Math.sin(ang);
      el.style.left = left.toFixed(2) + '%';
      el.style.top = top.toFixed(2) + '%';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = 'translate(-50%,-50%)';
    });
  } catch {}
}
try { positionSeatsRing(); window.addEventListener('resize', positionSeatsRing); } catch {}

// --- Inline wallet panel sync (no prompts) ---
try {
  // Adopt Tavern-connected wallet if present
  if (window.userAddress && String(window.userAddress)) {
    const a = String(window.userAddress).toLowerCase();
    try { if (walletAddrSpan) walletAddrSpan.textContent = short(a); } catch{}
    try { if (disconnectBtn) { disconnectBtn.style.display=''; disconnectBtn.onclick = () => { try{ localStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletConnected'); }catch(_){} try{ location.replace('/landing.html'); }catch(_){} }; } } catch{}
  }
} catch {}
try {
  window.addEventListener('wallet:connected', function(ev){
    try {
      const addr = String((ev && ev.detail && ev.detail.address) || '').toLowerCase();
      if (!addr) return;
      try { if (walletAddrSpan) walletAddrSpan.textContent = short(addr); } catch{}
      try { if (disconnectBtn) { disconnectBtn.style.display=''; disconnectBtn.onclick = () => { try{ localStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletConnected'); }catch(_){} try{ location.replace('/landing.html'); }catch(_){} }; } } catch{}
    } catch {}
  });
} catch {}

// Build rows (rank select, amount, copper, remove), prevent duplicate ranks
function renderBetRows(){
  try{
    if (!betRowsEl) return;
    betRowsEl.innerHTML = '';
    const used = new Set(stagedBets.map(b=>b.rank));
    stagedBets.forEach((b, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;';

      const sel = document.createElement('select'); sel.setAttribute('aria-label','Rank');
      sel.style.cssText = 'padding:4px;';
      allRanks().forEach(n=>{
        const opt = document.createElement('option');
        opt.value=String(n); opt.textContent=rankLabel(n);
        if (n===b.rank) opt.selected=true; else if (used.has(n)) opt.disabled=true;
        sel.appendChild(opt);
      });
      sel.onchange = () => {
        const nr = Number(sel.value);
        if (stagedBets.some((x,i)=> i!==idx && x.rank===nr)) { sel.value = String(b.rank); return; }
        used.delete(b.rank); b.rank = nr; used.add(nr); renderBetRows();
      };

      const amt = document.createElement('input');
      amt.type='number'; amt.min='0.001'; amt.step='0.001'; amt.value=String(b.amountEth);
      amt.style.cssText = 'width:110px; text-align:center;';
      try { amt.name = 'amount'; amt.setAttribute('aria-label','Amount (DCMon)'); } catch {}
      amt.oninput = () => { const v = Number(amt.value||0); b.amountEth = v>0 ? v : b.amountEth; };

      const lab = document.createElement('label');
      lab.style.cssText='font-size:13px; display:flex; align-items:center; gap:4px;';
      const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=!!b.copper; cb.onchange=()=>{ b.copper = !!cb.checked; };
      lab.appendChild(cb); lab.appendChild(document.createTextNode('Copper'));

      const del = document.createElement('button');
      del.textContent='Remove'; del.className='btn danger'; del.style.cssText='padding:4px 8px; border-radius:6px;';
      del.onclick = () => { stagedBets.splice(idx,1); renderBetRows(); };

      row.appendChild(sel);
      row.appendChild(document.createTextNode('Amount (DCMon):'));
      row.appendChild(amt);
      row.appendChild(lab);
      if (stagedBets.length>1) row.appendChild(del);
      betRowsEl.appendChild(row);
    });
    if (betConfirmBtn) betConfirmBtn.textContent = stagedBets.length>1 ? 'Confirm bets' : 'Confirm bet';
  }catch(e){}
}

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

// Ensure wallet identity is known and sent to server before seat/bets
async function ensureIdentity() {
  try {
    if (myAddr) { try { socket?.emit('identify', { addr: myAddr }); } catch {} return true; }
    if (window.ethereum) {
      const provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      let accounts = await provider.listAccounts();
      if (!accounts || !accounts.length) {
        try { accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }); } catch {}
      }
      if (accounts && accounts.length) {
        myAddr = accounts[0];
        onchainProvider = walletProvider || provider;
        onchainSigner = walletSigner || provider.getSigner();
        try { socket?.emit('identify', { addr: myAddr }); } catch {}
        return true;
      }
    }
  } catch {}
  log('Connect wallet first');
  return false;
}

// Match ACK behavior used by other games (e.g., Hazard)
const onReady = (fn) => { if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', fn, { once: true }); } else { fn(); } };
onReady(() => {
  faroAck = true;
  try { if (rulesOverlay) rulesOverlay.style.display = 'none'; } catch {}
  try { if (openRulesBtn) openRulesBtn.style.display = 'none'; } catch {}
});

// Lobby rendering is disabled on the game page
function renderLobby() { try { lobbyPanel.style.display = 'none'; } catch {} }

function renderTable(table) {
  currentTable = table;
  try {
    lobbyPanel.style.display = 'none';
  } catch {}
  myIsOwner = false; mySeatId = null;
  try { if (Date.now() >= centerLockUntil) centerReadout.textContent = ''; } catch {}
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
      const betDiv = document.createElement('div'); betDiv.className = 'bal'; betDiv.textContent = `Bets: ${Number(s.betTotal||0)}`; el.appendChild(betDiv);
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
        readyBtn.onclick = async () => {
          try {
            const willReady = !s.ready;
            if (willReady && Array.isArray(myPendingBets) && myPendingBets.length) {
              const bets = myPendingBets.slice();
              let bundled = false;
              try {
                const det = await window.Bundler?.detectBundler?.(window.ethereum);
                const ethersRef = window.ethers;
                const net = await (onchainProvider || new ethersRef.providers.Web3Provider(window.ethereum,'any')).getNetwork().catch(()=>({chainId: undefined}));
                const fromAddr = myAddr || (await onchainSigner?.getAddress()?.catch(()=>null));
                const hasAbi = !!(window.FaroV3ABI || window.FaroABI);
                if (!hasAbi) {
                  const cand=['/js/FaroV3ABI.js','/js/FaroABI.js','../../js/FaroV3ABI.js','../../js/FaroABI.js'];
                  for (const src of cand) {
                    if (window.FaroV3ABI || window.FaroABI) break;
                    await new Promise(res=>{ const sc=document.createElement('script'); sc.src=src; sc.onload=()=>res(true); sc.onerror=()=>res(false); document.head.appendChild(sc); });
                  }
                }
                const iface = new ethersRef.utils.Interface(window.FaroV3ABI || window.FaroABI);
                if (det && det.available && fromAddr && faroAddr) {
                  const calls = bets.map(b => {
                    const data = window.FaroV3ABI ? iface.encodeFunctionData('playFaro', [Number(b.rank), !!b.copper])
                                                  : iface.encodeFunctionData('playFaro', [Number(b.rank)]);
                    const val = ethersRef.utils.hexlify(ethersRef.utils.parseEther(String(b.amountEth||0)));
                    return { to: faroAddr, data, value: val };
                  });
                  log(`Bundling ${calls.length} Faro bets...`);
                  const result = await window.Bundler.walletSendCalls({ provider: det.provider, from: fromAddr, chainId: Number(net?.chainId), calls });
                  const hash = window.Bundler.extractTxHash(result);
                  if (hash) { log(`Bundle sent: ${String(hash).slice(0,10)}… waiting…`); await window.Bundler.waitForTransactionReceipt(det.provider, hash); }
                  bundled = true;
                }
              } catch (e) { console.warn('Bundled send failed; falling back to sequential txs', e); }
              if (!bundled) {
                for (const b of bets) {
                  try { await placeOnchainBet(b.rank, b.amountEth, !!b.copper); }
                  catch (e) { log('Tx failed: ' + (e?.data?.message || e?.message || 'unknown')); }
                }
              }
              myPendingBets = [];
            }
          } catch(e){}
          socket?.emit('ready', { ready: !s.ready });
        };
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
      // Require wallet connection before seating
      try {
        const connected = !!myAddr;
        sit.disabled = !connected;
        sit.title = connected ? '' : 'Connect wallet to sit';
      } catch {}
      sit.onclick = async () => { try { const ok = await ensureIdentity(); if (ok) socket?.emit('seat', { index: idx }); } catch{} };
      btns.appendChild(sit); el.appendChild(btns);
    }
  }
  // Enable betting only when seated
  try {
    const canBet = (typeof mySeatId === 'number');
    rankButtons.forEach(b => { b.disabled = !canBet; b.title = canBet ? '' : 'Click Sit to place bets'; });
  } catch {}
  // Show panel only when I am seated; also toggle reserved layout
  try {
    const isSeated = (typeof mySeatId === 'number');
    if (tablePanel) tablePanel.style.display = isSeated ? 'block' : 'none';
    document.body.classList.toggle('panel-open', isSeated);
  } catch {}
  const seated = table.seats.filter(Boolean);
  const allReady = seated.length && seated.every(s => !!s.ready);
  try {
    const meSeat = seated.find(s => s?.addr && myAddr && s.addr.toLowerCase()===String(myAddr).toLowerCase());
    const now = Date.now();
    if (now >= centerLockUntil) {
      if (!table.started) {
        setCenter('Place your bet');
      } else if (!allReady) {
        const myBetPlaced = Number(meSeat?.betTotal||0) > 0;
        if (meSeat && !meSeat.ready) setCenter(myBetPlaced ? 'Click Ready to lock your bet' : 'Place your bet');
        else setCenter('Waiting for players to Ready...');
      } else {
        setCenter('All players ready');
      }
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
    if (myAddr) socket.emit('identify', { addr: myAddr }); else { try { ensureIdentity(); } catch {} }
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
    try { centerReadout.textContent = 'Place your bet'; } catch {}
    renderTable(table);
  });
  socket.on('table:coup', (m) => {
    const bank = Number(m.bankRank); const player = Number(m.playerRank);
    const name = (r)=> ({1:'A',11:'J',12:'Q',13:'K'}[r] || String(r));
    log(`Coup: bank=${bank}(${name(bank)}), player=${player}(${name(player)})${m.doublet ? ' (doublet)' : ''}`);
    const winners = Array.isArray(m.results) ? m.results.filter(r => Number(r.delta||0) > 0).map(r => short(String(r.addr||''))) : [];
    if (Array.isArray(m.results)) m.results.forEach(r => log(`${short(r.addr)}: ${r.delta >= 0 ? '+' : ''}${r.delta}`));
    // Render table first (updates seats), then override center readout with results so it isn't overwritten
    try { renderTable(m.table); } catch {}
    try { centerLockUntil = Date.now() + 12000; } catch {}
    try {
      const mine = Array.isArray(m.results) ? m.results.find(r => r.addr && myAddr && r.addr.toLowerCase()===String(myAddr).toLowerCase()) : null;
      const myTxt = mine ? (mine.delta>0 ? ` You won +${mine.delta}` : (mine.delta<0 ? ` You lost ${mine.delta}` : ' Push')) : '';
      const label = `Bank ${name(bank)} vs Player ${name(player)}${m.doublet?' (doublet)':''}`;
      const who = winners.length ? ` Winners: ${winners.join(', ')}` : '';
      // Ensure result banner persists during lock window
      try { setCenter(`${label}${who}${myTxt ? ' -'+myTxt : ''}`, true); } catch {}
      centerReadout.textContent = `${label}${who}${myTxt ? ' —'+myTxt : ''}`;
    } catch {}
  });
  socket.on('chat', (m) => { log(`${m.from}: ${m.text}`); });
  socket.on('error', (e) => { log(`Error: ${e?.message || 'unknown'}`); });
  socket.on('disconnect', () => { log('Disconnected. Reconnecting in 2s...'); setTimeout(connect, 2000); showLobby(); });
}

// Attach UI handlers
joinBtn?.addEventListener('click', () => {
  // rules gate removed
  const id = (tableInput?.value || 'lobby').trim();
  socket?.emit('join_table', { table: id });
});


// No start/deal buttons

// Replace rank click with bet builder modal
rankButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const lbl = btn.dataset.rank;
    const rnum = rankNumber(lbl);
    if (!(rnum>=1 && rnum<=13)) return;
    // Gating: require rules ACK and being seated before placing bets
    // rules gate removed
    if (!(typeof mySeatId === 'number')) { log('Take a seat to place bets.'); return; }
    openBetModal(rnum);
  });
});

// Clear bets handler
clearBetsBtn?.addEventListener('click', () => { try { socket?.emit('clear_bets'); } catch {} });

// Modal controls
betAddBtn?.addEventListener('click', () => {
  try {
    const used = new Set(stagedBets.map(b=>b.rank));
    const next = allRanks().find(n => !used.has(n));
    if (next) { stagedBets.push({ rank: next, amountEth: Number(betAmtInput?.value||0.01)||0.01, copper: false }); renderBetRows(); }
  } catch(e){}
});
betClearBtn?.addEventListener('click', () => {
  try { stagedBets = []; myPendingBets = []; socket?.emit('clear_bets'); if (betModal) betModal.style.display='none'; } catch(e){}
});
betCancelBtn?.addEventListener('click', () => { try { stagedBets = []; if (betModal) betModal.style.display='none'; } catch(e){} });
betConfirmBtn?.addEventListener('click', async () => {
  try {
    const ok = await ensureIdentity(); if (!ok) return;
    const seen = new Set();
    for (const b of stagedBets) {
      if (!b || !(b.rank>=1&&b.rank<=13) || !(Number(b.amountEth)>0) || seen.has(b.rank)) { log('Invalid bet selection'); return; }
      seen.add(b.rank);
    }
    socket?.emit('clear_bets');
    stagedBets.forEach(b => {
      const chips = Math.max(1, Math.floor(Number(b.amountEth)*100));
      socket?.emit('place_bet', { rank: b.rank, amount: chips, copper: !!b.copper });
    });
    myPendingBets = stagedBets.map(b => ({ rank: b.rank, amountEth: Number(b.amountEth), copper: !!b.copper }));
    stagedBets = [];
    if (betModal) betModal.style.display = 'none';
  } catch(e){}
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
          window.ethereum.on('accountsChanged', async (accs) => {
            try {
              myAddr = (accs && accs[0]) ? accs[0] : null;
              // Refresh seat UI to enable/disable Sit button when wallet connects/disconnects
              try { if (currentTable) renderTable(currentTable); } catch {}
            } catch {}
          });
        }
      } catch {}
    }
  } catch {}
  await connect();
})();

// (removed duplicate onReady/rules handler)

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
  log(`Submitting on-chain bet ${ethAmount} DCMon on ${rankNum}${copper ? ' (copper)' : ''}…`);
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


