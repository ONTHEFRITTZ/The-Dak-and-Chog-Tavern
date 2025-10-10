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

function normalizedAddr(value) {
  try {
    const str = String(value || '').trim();
    if (!str) return '';
    const lower = str.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(lower)) return '';
    if (lower === '0x' + '0'.repeat(40)) return '';
    return lower;
  } catch {
    return '';
  }
}

let monadConfigPromise = null;
async function loadMonadConfig() {
  if (monadConfigPromise) return monadConfigPromise;
  monadConfigPromise = (async () => {
    try {
      const mod = await import('../../js/aa/config.js');
      if (mod?.MONAD) return mod.MONAD;
    } catch (err) {
      console.warn('poker lobby: MONAD config import failed', err);
    }
    return window?.MONAD || null;
  })();
  return monadConfigPromise;
}

async function ensureMonadNetwork(provider) {
  if (!provider?.request) return true;
  try {
    const mon = await loadMonadConfig();
    if (!mon?.id) return true;
    const targetHex = '0x' + Number(mon.id).toString(16);
    const currentHex = await provider.request({ method: 'eth_chainId' }).catch(() => null);
    const currentId = currentHex != null
      ? parseInt(String(currentHex), currentHex?.toString().startsWith('0x') ? 16 : 10)
      : null;
    if (currentHex === targetHex || currentId === mon.id) return true;
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetHex }]
      });
      return true;
    } catch (switchErr) {
      if (switchErr?.code === 4902) {
        const params = [{
          chainId: targetHex,
          chainName: mon.name || 'Monad Testnet',
          rpcUrls: mon.rpcHttp ? [mon.rpcHttp] : [],
          nativeCurrency: mon.nativeCurrency || { name: 'MON', symbol: 'MON', decimals: 18 },
          blockExplorerUrls: mon.explorer ? [mon.explorer] : undefined
        }];
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params
          });
          return true;
        } catch (addErr) {
          console.warn('poker lobby: wallet_addEthereumChain failed', addErr);
          return false;
        }
      }
      if (switchErr?.code === 4001) {
        console.warn('poker lobby: user rejected network switch');
        return false;
      }
      console.warn('poker lobby: wallet_switchEthereumChain failed', switchErr);
      return false;
    }
  } catch (err) {
    console.warn('poker lobby: ensureMonadNetwork failed', err);
    return false;
  }
}

function persistWallet(addr) {
  const normalized = normalizedAddr(addr);
  if (!normalized) {
    try { sessionStorage.removeItem('walletConnected'); } catch {}
    try { localStorage.removeItem('walletConnected'); } catch {}
    try { sessionStorage.removeItem('walletAddress'); } catch {}
    try { localStorage.removeItem('walletAddress'); } catch {}
    return '';
  }
  try { sessionStorage.setItem('walletConnected', 'true'); } catch {}
  try { localStorage.setItem('walletConnected', 'true'); } catch {}
  try { sessionStorage.setItem('walletAddress', normalized); } catch {}
  try { localStorage.setItem('walletAddress', normalized); } catch {}
  return normalized;
}

function readPersistedAddr() {
  try {
    const connected = sessionStorage.getItem('walletConnected') === 'true'
      || localStorage.getItem('walletConnected') === 'true';
    if (!connected) return '';
    const direct = sessionStorage.getItem('walletAddress') || localStorage.getItem('walletAddress');
    const directNorm = normalizedAddr(direct);
    if (directNorm) return directNorm;
    const msg = sessionStorage.getItem('walletMsg') || localStorage.getItem('walletMsg') || '';
    const match = msg.match(/Address:\s*(0x[0-9a-fA-F]{40})/i);
    return normalizedAddr(match ? match[1] : '');
  } catch {
    return '';
  }
}

let myAddr = readPersistedAddr();
let chainIdHex = null;
let providerWatcherAttached = false;

// ---- utils ----
function short(a){ try { return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); } catch { return a||''; } }
function setStatus(t){ try { if (statusEl) statusEl.textContent = t; } catch {} }
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
try { window.__getSelectedProvider = getSelectedProvider; } catch {}

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
const lobbyScriptPromises = new Map();
const dcmonContractCache = new WeakMap();

function loadScriptOnce(src) {
  if (!src) return Promise.resolve(false);
  if (lobbyScriptPromises.has(src)) return lobbyScriptPromises.get(src);
  const existing = Array.from(document.getElementsByTagName('script')).find(s => s.src && s.src.includes(src));
  if (existing && (existing.dataset.loaded === '1' || existing.readyState === 'complete')) {
    return Promise.resolve(true);
  }
  const promise = new Promise((resolve, reject) => {
    try {
      const script = existing || document.createElement('script');
      if (!existing) {
        script.src = src;
        script.async = false;
        document.head.appendChild(script);
      }
      script.addEventListener('load', () => {
        script.dataset.loaded = '1';
        resolve(true);
      }, { once: true });
      script.addEventListener('error', reject, { once: true });
    } catch (err) {
      reject(err);
    }
  }).catch(err => {
    lobbyScriptPromises.delete(src);
    console.error('loadScriptOnce failed', src, err);
    return false;
  });
  lobbyScriptPromises.set(src, promise);
  return promise;
}

function readSponsorActive() {
  try { return localStorage.getItem('aa:sponsored') === 'true'; } catch { return false; }
}

function bigNumberFrom(value) {
  try {
    if (!window.ethers || !window.ethers.BigNumber) return null;
    if (value === undefined || value === null) return null;
    const str = String(value);
    if (!str || str === '0') return null;
    return window.ethers.BigNumber.from(str);
  } catch {
    return null;
  }
}

async function ensureDcmonReadContract(provider) {
  if (!provider || !window.ethers) return null;
  if (dcmonContractCache.has(provider)) return dcmonContractCache.get(provider);
  const promise = (async () => {
    try {
      await loadScriptOnce('../../js/DCMonABI.js');
      let configMod = null;
      try { configMod = await import('../../js/config.js'); } catch (err) { console.warn('config import failed', err); }
      const web3 = new window.ethers.providers.Web3Provider(provider, 'any');
      let address = null;
      if (configMod?.getAddressFor) {
        try { address = await configMod.getAddressFor('dcmon', web3).catch(() => null); } catch {}
      }
      if (!address) {
        address = configMod?.CONTRACTS?.dcmon || window?.CONTRACTS?.dcmon || null;
      }
      if (!address || !window.DCMonABI) return null;
      const contract = new window.ethers.Contract(address, window.DCMonABI, web3);
      return { contract, provider: web3 };
    } catch (err) {
      console.error('ensureDcmonReadContract error', err);
      return null;
    }
  })().then(result => {
    if (!result) dcmonContractCache.delete(provider);
    return result;
  });
  dcmonContractCache.set(provider, promise);
  return promise;
}

function normaliseRowMeta(row) {
  const meta = row && typeof row.meta === 'object' ? { ...row.meta } : {};
  meta.tableMode = meta.tableMode || (row?.simulated ? 'f2p' : 'onchain');
  meta.currency = meta.currency || (meta.tableMode === 'onchain' ? 'DCMon' : 'Chips');
  meta.typeLabel = meta.typeLabel || (meta.tableMode === 'onchain'
    ? (row?.limit === 'FL' ? 'On-Chain Limit' : 'On-Chain NL')
    : 'Free to Play');
  meta.tooltip = meta.tooltip || (meta.tableMode === 'onchain'
    ? 'DCMon bankroll with on-chain dealer settlement.'
    : 'Simulated chips only.');
  const blinds = meta.blinds && typeof meta.blinds === 'object' ? { ...meta.blinds } : {};
  if (!blinds.sb || !blinds.bb) {
    if (typeof row?.stakes === 'string' && row.stakes.includes('/')) {
      const parts = row.stakes.split('/').map(s => s.trim());
      if (!blinds.sb && parts[0]) blinds.sb = parts[0].replace(/mon/ig, meta.currency);
      if (!blinds.bb && parts[1]) blinds.bb = parts[1].replace(/mon/ig, meta.currency);
    }
  }
  meta.blinds = blinds;
  if (blinds.sb && blinds.bb) {
    meta.blindsText = `Blinds ${blinds.sb} / ${blinds.bb} ${meta.currency}`.replace(/\s+/g, ' ').trim();
  } else if (row?.stakes) {
    meta.blindsText = String(row.stakes).replace(/mon/ig, meta.currency);
  } else {
    meta.blindsText = '';
  }
  const minBuy = meta.minBuy && typeof meta.minBuy === 'object' ? { ...meta.minBuy } : {};
  if (!('amount' in minBuy)) {
    minBuy.amount = meta.tableMode === 'onchain' ? '1' : '0';
  }
  if (!('unit' in minBuy)) {
    minBuy.unit = meta.currency;
  }
  if (!('wei' in minBuy) && meta.tableMode === 'onchain') {
    try {
      const decimals = Number(meta.decimals || 18);
      const amountNum = Number(minBuy.amount || 0);
      if (Number.isFinite(decimals) && Number.isFinite(amountNum) && window.ethers?.utils?.parseUnits) {
        minBuy.wei = window.ethers.utils.parseUnits(String(amountNum), decimals).toString();
      }
    } catch {}
  }
  meta.minBuy = minBuy;
  if (Number(minBuy.amount || 0) > 0) {
    meta.minBuyText = `Min ${minBuy.amount} ${minBuy.unit}`.trim();
  } else {
    meta.minBuyText = meta.tableMode === 'onchain' ? 'Min buy-in required' : 'Practice chips';
  }
  meta.stackRequirement = meta.stackRequirement || (meta.tableMode === 'onchain'
    ? 'Bring DCMon before you sit (50+ BB recommended).'
    : 'Stacks use simulated chips.');
  meta.preflight = meta.preflight && typeof meta.preflight === 'object'
    ? { ...meta.preflight }
    : { needsWallet: meta.tableMode === 'onchain', needsDcmon: meta.tableMode === 'onchain', needsSponsor: false };
  meta.decimals = Number.isFinite(Number(meta.decimals)) ? Number(meta.decimals) : (meta.tableMode === 'onchain' ? 18 : 0);
  return meta;
}

function createBadge(label, opts = {}) {
  const span = document.createElement('span');
  span.className = 'pill';
  span.textContent = label;
  if (opts.bg) span.style.background = opts.bg;
  if (opts.color) span.style.color = opts.color;
  if (opts.title) span.title = opts.title;
  if (opts.opacity) span.style.opacity = String(opts.opacity);
  if (opts.border) span.style.border = opts.border;
  return span;
}

function goToTable(tableId) {
  try {
    const u = new URL(window.location.href);
    u.pathname = '/games/poker/table.html';
    u.searchParams.set('table', tableId);
    window.location.href = u.toString();
  } catch {
    window.location.href = `/games/poker/table.html?table=${encodeURIComponent(tableId)}`;
  }
}

async function runPreflight(row, meta) {
  try {
    const needs = meta?.preflight || {};
    const needsWallet = needs.needsWallet !== undefined ? !!needs.needsWallet : meta.tableMode === 'onchain';
    if (!needsWallet) return { ok: true };
    const provider = getSelectedProvider();
    if (!provider) {
      return { ok: false, reason: 'Select a wallet on landing before opening on-chain tables.' };
    }
    const networkOk = await ensureMonadNetwork(provider);
    if (!networkOk) {
      return { ok: false, reason: 'Switch to Monad Testnet in your wallet, then retry.' };
    }
    if (!window.ethers) {
      return { ok: false, reason: 'Wallet runtime unavailable (ethers).' };
    }
    let accounts = [];
    try { accounts = await provider.request({ method: 'eth_accounts' }); } catch {}
    if (!accounts || !accounts.length) {
      try {
        accounts = await provider.request({ method: 'eth_requestAccounts' });
      } catch (err) {
        console.warn('Wallet approval rejected', err);
        return { ok: false, reason: 'Wallet approval required to continue.' };
      }
    }
    const addr = normalizedAddr((accounts && accounts[0]) ? accounts[0] : null);
    if (!addr) {
      if (typeof setKnownAddress === 'function') setKnownAddress('', { persist: true });
      return { ok: false, reason: 'No wallet account available.' };
    }
    if (typeof setKnownAddress === 'function') setKnownAddress(addr, { persist: true });
    if (needs.needsDcmon) {
      const ctx = await ensureDcmonReadContract(provider);
      if (!ctx?.contract) {
        return { ok: true, warning: "DCMon contract not resolved yet. Try again after refresh." };
      }
      const minWei = bigNumberFrom(meta?.minBuy?.wei);
      if (minWei) {
        try {
          const balance = await ctx.contract.balanceOf(addr);
          if (balance.lt(minWei)) {
            const label = meta?.minBuy?.amount ? `${meta.minBuy.amount} ${meta.minBuy.unit || meta.currency || 'DCMon'}` : 'the required DCMon';
            return { ok: true, warning: `Insufficient DCMon (need ${label}). You can mint once the table loads.` };
          }
        } catch (balanceErr) {
          console.warn('poker lobby: DCMon balance check failed', balanceErr);
          return {
            ok: true,
            warning: 'Unable to read your DCMon balance. The table page will offer minting once loaded.'
          };
        }
      }
    }
    return { ok: true, address: addr };
  } catch (err) {
    console.error('runPreflight failed', err);
    return { ok: false, reason: 'Preflight check failed.' };
  }
}

function cardFor(row){
  const meta = normaliseRowMeta(row || {});
  const card = document.createElement('div'); card.className='lobby-item';
  const left = document.createElement('div');
  left.style.display = 'flex';
  left.style.flexDirection = 'column';
  left.style.gap = '6px';
  left.style.flex = '1 1 auto';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.flexWrap = 'wrap';
  header.style.gap = '8px';

  const title = document.createElement('strong');
  title.textContent = row.id;
  header.appendChild(title);

  const badgeWrap = document.createElement('div');
  badgeWrap.style.display = 'flex';
  badgeWrap.style.alignItems = 'center';
  badgeWrap.style.flexWrap = 'wrap';
  badgeWrap.style.gap = '6px';

  badgeWrap.appendChild(createBadge(meta.typeLabel || (meta.tableMode === 'onchain' ? 'On-Chain' : 'Free to Play'), {
    bg: meta.tableMode === 'onchain' ? 'rgba(38,132,92,0.55)' : 'rgba(0,0,0,0.45)',
    color: '#f4e6d3',
    title: meta.tooltip || ''
  }));

  if (meta.tableMode === 'onchain') {
    badgeWrap.appendChild(createBadge(meta.currency || 'DCMon', {
      bg: 'rgba(105,80,180,0.55)',
      color: '#f4e6d3',
      title: `Settles in ${meta.currency || 'DCMon'}`
    }));
  }

  header.appendChild(badgeWrap);
  left.appendChild(header);

  const infoLine = document.createElement('div');
  infoLine.className = 'muted';
  infoLine.textContent = [
    `Seats ${row.seated}/${row.capacity}`,
    meta.blindsText,
    meta.minBuyText
  ].filter(Boolean).join(' | ');
  left.appendChild(infoLine);

  if (meta.stackRequirement) {
    const stackLine = document.createElement('div');
    stackLine.className = 'muted';
    stackLine.textContent = meta.stackRequirement;
    left.appendChild(stackLine);
  }

  const statusWrap = document.createElement('div');
  statusWrap.style.display = 'flex';
  statusWrap.style.flexWrap = 'wrap';
  statusWrap.style.gap = '6px';

  if (meta.tableMode === 'onchain') {
    const dealerReady = row.dealerSigner !== false;
    statusWrap.appendChild(createBadge(dealerReady ? 'Ready' : 'Dealer Offline', {
      bg: dealerReady ? 'rgba(38,132,92,0.65)' : 'rgba(180,60,60,0.68)',
      color: '#f4e6d3',
      title: dealerReady ? 'On-chain dealer signer configured.' : 'Dealer signer missing; actions will fallback off-chain.'
    }));

    const walletOk = !!myAddr;
    statusWrap.appendChild(createBadge(walletOk ? 'Wallet OK' : 'Wallet Required', {
      bg: walletOk ? 'rgba(72,104,180,0.55)' : 'rgba(200,120,40,0.65)',
      color: '#f4e6d3',
      title: walletOk ? `Connected as ${short(myAddr)}` : 'Connect your wallet on landing before joining on-chain tables.'
    }));

    const sponsorActive = readSponsorActive();
    statusWrap.appendChild(createBadge(sponsorActive ? 'Sponsor On' : 'Sponsor Off', {
      bg: sponsorActive ? 'rgba(88,140,220,0.55)' : 'rgba(96,96,96,0.55)',
      color: '#f4e6d3',
      title: sponsorActive ? 'Gas sponsorship active from Smart Account panel.' : 'Enable gas sponsor in Smart Account panel if desired.'
    }));
  } else {
    statusWrap.appendChild(createBadge('Practice', {
      bg: 'rgba(0,0,0,0.45)',
      color: '#f4e6d3',
      title: 'Simulated chips only.'
    }));
  }

  if (statusWrap.childNodes.length) {
    left.appendChild(statusWrap);
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = meta.tableMode === 'onchain' ? 'Launch On-Chain Table' : 'Play Table';

  btn.addEventListener('click', async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Checking...';
    try {
      const result = await runPreflight(row, meta);
      if (!result?.ok) {
        setStatus(result?.reason || 'Unable to launch table.');
        btn.disabled = false;
        btn.textContent = original;
        return;
      }
      if (result?.warning) setStatus(result.warning);
      btn.textContent = 'Launching...';
      goToTable(row.id);
    } catch (err) {
      console.error('Lobby preflight failed', err);
      setStatus('Preflight check failed.');
      btn.disabled = false;
      btn.textContent = original;
    }
  });

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
      // Polling first so Cloudflare/CDN handshakes succeed, then upgrade
      transports: ['polling','websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 800
    });
  } catch (e) {
    setStatus('Socket.IO not available');
    console.error('Socket init error', e);
    return;
  }

  socket.on('connect', () => {
    setKnownAddress(myAddr);
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
    const addr = normalizedAddr(Array.isArray(accts) ? accts[0] : null);
    chainIdHex = await provider.request?.({ method: 'eth_chainId' }).catch(()=>null);
    return addr || null;
  } catch { return null; }
}

function setKnownAddress(addr, opts = {}){
  const { persist = false } = opts;
  try {
    const normalized = normalizedAddr(addr);
    myAddr = normalized;
    if (wiAddrEl) wiAddrEl.textContent = normalized ? short(normalized) : '-';
    window.__WALLET_ADDR = normalized || '';
    if (persist) {
      persistWallet(normalized);
    }
    if (normalized) {
      if (socket?.connected) {
        try { socket.emit('identify', { addr: normalized }); } catch {}
      }
      const chainNote = chainIdHex ? ` | Chain ${chainIdHex}` : '';
      setStatus(`Wallet: ${short(normalized)}${chainNote}`);
    } else {
      setStatus('Wallet required: connect in the Tavern');
    }
  } catch (e) { console.warn('setKnownAddress failed', e); }
}

async function ensureWalletFromSelected(){
  if (myAddr) {
    setKnownAddress(myAddr);
  } else {
    setKnownAddress('');
  }

  const addr = await detectExistingAccountFromSelected();
  if (addr) {
    setKnownAddress(addr, { persist: true });
  } else {
    setKnownAddress('', { persist: true });
  }

  const provider = getSelectedProvider();
  if (provider && provider.on && !providerWatcherAttached) {
    providerWatcherAttached = true;
    provider.on('accountsChanged', (arr) => {
      const next = normalizedAddr(arr && arr[0]);
      setKnownAddress(next || '', { persist: true });
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
    const accounts = await provider.request?.({ method: 'eth_accounts' }) || [];
    const next = normalizedAddr(Array.isArray(accounts) ? accounts[0] : null);
    chainIdHex = await provider.request?.({ method: 'eth_chainId' }).catch(()=>null);
    setKnownAddress(next || '', { persist: true });
    if (!next) setStatus('Wallet approval required to continue.');
  } catch (e) {
    console.error('Wallet connect failed', e);
    setStatus('Wallet connect failed');
  }
});

// =================== Bootstrap ===================
initSocket();
ensureWalletFromSelected();
updateContractLabels();


