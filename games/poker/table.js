// games/poker/table.js
// Restores the image-based felt, seat layout, private hole handling, burn flashes,
// simple dealing animations, action controls.

(() => {
  const { ethers } = window;
  const tableMode = (document.documentElement.getAttribute('data-table-mode') || 'f2p').toLowerCase();
  const isOnchainTable = tableMode === 'onchain';

  function getBankrollHelper() {
    return window.Bankroll || window.__PokerBankroll || null;
  }

  async function waitForBankrollHelper(timeout = 6000) {
    const existing = getBankrollHelper();
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeout;
      let settled = false;
      let poller = null;

      function cleanup() {
        if (settled) return;
        settled = true;
        if (poller) clearInterval(poller);
        document.removeEventListener('bankroll:ready', onReady);
      }

      function onResolve(helper) {
        cleanup();
        resolve(helper);
      }

      function onReady() {
        const helper = getBankrollHelper();
        if (helper) onResolve(helper);
      }

      poller = setInterval(() => {
        const helper = getBankrollHelper();
        if (helper) return onResolve(helper);
        if (Date.now() > deadline) {
          cleanup();
          reject(new Error('Bankroll helper missing'));
        }
      }, 80);

      document.addEventListener('bankroll:ready', onReady);
      onReady();
    });
  }
  const trimDecimals = (str) => {
    if (str == null) return '';
    let out = String(str);
    if (out.includes('.')) {
      out = out.replace(/(\.\d*?[1-9])0+$/, '').replace(/\.0+$/, '').replace(/\.$/, '');
    }
    if (out === '-0') out = '0';
    return out;
  };

  const ZERO_ADDR = '0x' + '0'.repeat(40);
  const ASSET_BASE = '/assets/images/chog_cards/';
  const CARD_BACK = `${ASSET_BASE}dak-and-chog-cardback.png`;
  const TURN_MS = 25_000;

  const rankMap = {
    '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven',
    '8': 'eight', '9': 'nine', T: 'ten', J: 'jack', Q: 'queen', K: 'king', A: 'ace'
  };
  const suitMap = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };

  const STAGE_LABEL = {
    preflop: 'Pre-Flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River'
  };

  function readRingValue(name, fallback) {
    try {
      const cs = getComputedStyle(canvas);
      const raw = cs.getPropertyValue(name);
      const parsed = parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function seatPosition(index, total) {
    const rx = readRingValue('--ring-rx', 54);
    const ry = readRingValue('--ring-ry', 46);
    const rotation = readRingValue('--ring-rotation', -90);
    const angleDeg = rotation + (360 / total) * index;
    const rad = angleDeg * Math.PI / 180;
    const left = 50 + rx * Math.cos(rad);
    const top = 50 + ry * Math.sin(rad);
    return { left, top };
  }

  function positionSeats() {
    const total = seats.length || 8;
    seats.forEach((seat, idx) => {
      const { left, top } = seatPosition(idx, total);
      seat.style.left = `${left}%`;
      seat.style.top = `${top}%`;
    });
  }

  const canvas = document.querySelector('.table-canvas');
  if (!canvas) return;

  const seats = Array.from(document.querySelectorAll('.seat'));
  let onchainAdapterPromise = null;
  let configModulePromise = null;
  let tableSnapshot = null;
  let chipValueDcmon = isOnchainTable ? 0.001 : 1;
  let chipValueWei = null;

  function setChipValue(nextValue) {
    const numeric = Number(nextValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return false;
    chipValueDcmon = numeric;
    if (ethers?.utils?.parseUnits) {
      try {
        chipValueWei = ethers.utils.parseUnits(trimDecimals(String(numeric)), 18);
      } catch (err) {
        console.warn('Poker table: failed to parse chip value', err);
        chipValueWei = null;
      }
    } else {
      chipValueWei = null;
    }
    return true;
  }

  function chipsToWei(chips) {
    if (!isOnchainTable || chipValueDcmon <= 0 || !ethers?.utils?.parseUnits) return null;
    const amount = Number(chips);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    try {
      const dcmonValue = amount * chipValueDcmon;
      const formatted = trimDecimals(dcmonValue.toFixed(9));
      return ethers.utils.parseUnits(formatted || '0', 18);
    } catch (err) {
      console.warn('Poker table: chipsToWei failed', err);
      return null;
    }
  }

  function dcmonToChips(amountDcmon) {
    if (!isOnchainTable || chipValueDcmon <= 0) return null;
    const numeric = Number(amountDcmon);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const raw = numeric / chipValueDcmon;
    const rounded = Math.round((raw + Number.EPSILON) * 1e6) / 1e6;
    return rounded;
  }

  function updateChipValueFromTable(table) {
    if (!isOnchainTable || !table) return;
    try {
      const meta = table.meta || {};
      if (meta.chipValueDcmon != null) {
        setChipValue(meta.chipValueDcmon);
        return;
      }
      if (meta.blinds && meta.blinds.sb != null) {
        const sb = Number(meta.blinds.sb);
        if (Number.isFinite(sb) && sb > 0) setChipValue(sb);
      }
    } catch (err) {
      console.warn('Poker table: updateChipValueFromTable failed', err);
    }
  }

  async function loadConfigModule() {
    if (!configModulePromise) {
      configModulePromise = import('../../js/config.js').catch((err) => {
        console.error('Poker table: config import failed', err);
        return null;
      });
    }
    return configModulePromise;
  }

  async function resolvePokerTableAddress(provider) {
    const mod = await loadConfigModule();
    let addr = null;
    if (mod?.getAddressFor) {
      try {
        addr = await mod.getAddressFor('pokerTable', provider).catch(() => null);
      } catch (err) {
        console.warn('Poker table: getAddressFor failed', err);
      }
    }
    if (!addr && mod?.CONTRACTS?.pokerTable) addr = mod.CONTRACTS.pokerTable;
    if (!addr && window.CONTRACTS?.pokerTable) addr = window.CONTRACTS.pokerTable;
    return addr;
  }

  async function getOnchainAdapter() {
    if (!isOnchainTable) return null;
    if (!onchainAdapterPromise) {
      onchainAdapterPromise = createOnchainAdapter().catch((err) => {
        console.error('Poker table: adapter init failed', err);
        onchainAdapterPromise = null;
        return null;
      });
    }
    return onchainAdapterPromise;
  }

  async function createOnchainAdapter() {
    if (!isOnchainTable || !ethers || !window.HoldemPokerABI) return null;
    const bankroll = await waitForBankrollHelper();

    if (typeof bankroll.ensureContracts === 'function') {
      const ok = await bankroll.ensureContracts();
      if (!ok) throw new Error('Bankroll contracts unavailable');
    }

    const provider = typeof bankroll.getProvider === 'function' ? await bankroll.getProvider() : null;
    const signer = typeof bankroll.getSigner === 'function' ? await bankroll.getSigner() : null;
    if (!provider || !signer) throw new Error('Connect wallet before joining on-chain tables');

    const tableAddress = await resolvePokerTableAddress(provider);
    if (!tableAddress) throw new Error('Poker table address missing');

    const contract = new ethers.Contract(tableAddress, window.HoldemPokerABI, signer);
    let cachedAddr = null;

    async function ownerAddress() {
      if (!cachedAddr) cachedAddr = await signer.getAddress();
      return cachedAddr;
    }

    const contracts = typeof bankroll.getContracts === 'function' ? bankroll.getContracts() : null;
    const dcmonRead = contracts?.dcmonRead || null;

    async function ensureAllowance(amountWei) {
      const addr = await ownerAddress();
      if (typeof bankroll.ensureDcmonAllowance === 'function') {
        const allowed = await bankroll.ensureDcmonAllowance(amountWei, addr, tableAddress);
        if (!allowed) throw new Error('DCMon allowance not granted');
      }
      return true;
    }

    async function contribute(seatId, chips) {
      if (!Number.isFinite(chips) || chips <= 0) return true;
      const wei = chipsToWei(chips);
      if (!wei) throw new Error('Invalid contribution amount');
      const addr = await ownerAddress();
      if (dcmonRead) {
        const bal = await dcmonRead.balanceOf(addr);
        if (!bal || bal.lt(wei)) throw new Error('Insufficient DCMon balance');
      }
      await ensureAllowance(wei);
      const tx = await contract.contribute(seatId, wei);
      await tx.wait();
      if (typeof bankroll.refreshBalance === 'function') {
        setTimeout(() => {
          try { bankroll.refreshBalance(addr); } catch (refreshErr) {
            console.warn('Poker table: refresh after contribute failed', refreshErr);
          }
        }, 350);
      }
      return true;
    }

    async function joinSeat(seatId) {
      const tx = await contract.joinSeat(seatId);
      await tx.wait();
      cachedAddr = await signer.getAddress();
      return true;
    }

    async function leaveSeat(seatId, opts) {
      const active = !!(opts && opts.inHand);
      const method = active ? 'leaveDuringHand' : 'unseat';
      if (typeof contract[method] !== 'function') return false;
      const tx = await contract[method](seatId);
      await tx.wait();
      return true;
    }

    return { address: tableAddress, contract, joinSeat, leaveSeat, contribute, ownerAddress };
  }

  setChipValue(chipValueDcmon);

  if (!seats.length) return;

  let board = canvas.querySelector('#board');
  if (!board) {
    board = document.createElement('div');
    board.id = 'board';
    board.className = 'board-cards';
    canvas.insertBefore(board, seats[0] || null);
  }
  board.classList.add('empty');

  let burnPile = canvas.querySelector('.burn-pile');
  if (!burnPile) {
    burnPile = document.createElement('div');
    burnPile.className = 'burn-pile';
    canvas.insertBefore(burnPile, seats[0] || null);
  }

  const centerBanner = document.getElementById('poker-center');
  const lastHandBox = document.getElementById('last-hand');
  const lastHandEl = document.getElementById('lh-content');

  positionSeats();

  const seatMeta = seats.map((seat) => {
    let timer = seat.querySelector('.timer');
    if (!timer) {
      timer = document.createElement('div');
      timer.className = 'timer';
      const fill = document.createElement('span');
      fill.className = 'fill';
      timer.appendChild(fill);
      seat.appendChild(timer);
    }

    let cards = seat.querySelector('.cards');
    if (!cards) {
      cards = document.createElement('div');
      cards.className = 'cards';
      seat.appendChild(cards);
    }

    let addr = seat.querySelector('.addr');
    if (!addr) {
      addr = document.createElement('div');
      addr.className = 'addr';
      addr.textContent = '';
      seat.appendChild(addr);
    }

    let stack = seat.querySelector('.stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'stack';
      stack.textContent = '';
      seat.appendChild(stack);
    }

    let btns = seat.querySelector('.btns');
    if (!btns) {
      btns = document.createElement('div');
      btns.className = 'btns';
      seat.appendChild(btns);
    }

    return {
      seat,
      cards,
      addr,
      stack,
      btns,
      timerFill: seat.querySelector('.timer .fill')
    };
  });
  const actionBar = document.createElement('div');
  actionBar.className = 'action-bar hidden';
  const infoText = document.createElement('div');
  infoText.className = 'info';
  const foldBtn = document.createElement('button');
  foldBtn.textContent = 'Fold';
  const callBtn = document.createElement('button');
  callBtn.textContent = 'Check';
  const betInput = document.createElement('input');
  betInput.type = 'number';
  betInput.min = '0';
  betInput.step = '1';
  betInput.placeholder = 'Amount';
  betInput.className = 'bet-input';
  const betBtn = document.createElement('button');
  betBtn.textContent = 'Bet';
  actionBar.append(infoText, foldBtn, callBtn, betInput, betBtn);
  canvas.appendChild(actionBar);

  // Purge any non-address labels from seats immediately
  try {
    document.querySelectorAll('.seat .addr').forEach(el => {
      const txt = (el.textContent || '').trim();
      if (!/^0x[0-9a-fA-F]{6}\.\.\.[0-9a-fA-F]{4}$/.test(txt) && !/^0x[0-9a-fA-F]{40}$/.test(txt)) {
        el.textContent = '';
      }
    });
  } catch {}

  // Allow Enter key and simple keyboard shortcuts when action bar is visible
  betInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const act = betBtn.dataset.action || 'bet';
      sendAction(act, betInput.value);
    }
  });
  window.addEventListener('keydown', (e) => {
    if (actionBar.classList.contains('hidden')) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'f') { e.preventDefault(); sendAction('fold'); }
    if (k === 'c') { e.preventDefault(); const act = callBtn.dataset.action || 'check'; sendAction(act); }
    if (k === 'b') { e.preventDefault(); const act = betBtn.dataset.action || 'bet'; sendAction(act, betInput.value); }
  });

  function cardToImg(code) {
    if (!code) return CARD_BACK;
    const m = /^([2-9TJQKA])([cdhs])$/i.exec(code.trim());
    if (!m) return CARD_BACK;
    const rank = rankMap[m[1].toUpperCase()];
    const suit = suitMap[m[2].toLowerCase()];
    if (!rank || !suit) return CARD_BACK;
    return `${ASSET_BASE}chog-${rank}-of-${suit}.png`;
  }

  const $ = (s, el = document) => el.querySelector(s);
  const formatChips = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    if (isOnchainTable) {
      const dcmon = n * chipValueDcmon;
      const abs = Math.abs(dcmon);
      if (abs >= 10) return trimDecimals(dcmon.toFixed(2));
      if (abs >= 1) return trimDecimals(dcmon.toFixed(3));
      return trimDecimals(dcmon.toFixed(4));
    }
    if (Math.abs(n) >= 1000) return n.toLocaleString();
    if (Math.abs(n) >= 1) return n.toString();
    return n.toFixed(2);
  };
  const short = (addr) => {
    try {
      const s = String(addr || '');
      if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s.slice(0, 6) + '...' + s.slice(-4);
    } catch {}
    return '';
  };

  function storedAddr() {
    try {
      const connected = sessionStorage.getItem('walletConnected') === 'true'
        || localStorage.getItem('walletConnected') === 'true';
      if (!connected) return null;
      const direct = sessionStorage.getItem('walletAddress') || localStorage.getItem('walletAddress');
      if (direct && isValidAddr(direct)) return String(direct).toLowerCase();
    } catch {}
    try {
      const msg = sessionStorage.getItem('walletMsg') || localStorage.getItem('walletMsg') || '';
      const match = msg.match(/Address:\s*(0x[0-9a-fA-F]{40})/i);
      if (match && match[1] && isValidAddr(match[1])) return String(match[1]).toLowerCase();
    } catch {}
    return null;
  }

  function persistAddr(addr) {
    try {
      const normalized = isValidAddr(addr) ? String(addr).toLowerCase() : '';
      if (!normalized) {
        sessionStorage.removeItem('walletConnected');
        localStorage.removeItem('walletConnected');
        sessionStorage.removeItem('walletAddress');
        localStorage.removeItem('walletAddress');
        return;
      }
      sessionStorage.setItem('walletConnected', 'true');
      localStorage.setItem('walletConnected', 'true');
      sessionStorage.setItem('walletAddress', normalized);
      localStorage.setItem('walletAddress', normalized);
    } catch {}
  }

  function currentAddr() {
    const saved = storedAddr();
    if (saved) return saved;
    const badge = ($('#wi-address')?.textContent || '').trim();
    if (isValidAddr(badge)) return String(badge).toLowerCase();
    if (window.tavern && isValidAddr(window.tavern.addr || '')) return String(window.tavern.addr).toLowerCase();
    return null;
  }

  const qp = new URL(location.href).searchParams;
  const tableId = qp.get('table') || 'poker-sim-1';

  // Connect socket with environment-aware path
  const socket = (() => {
    if (!window.io) return null;
    try {
      const host = (location.hostname || '').toLowerCase();
      const isLocal = host === 'localhost' || host === '127.0.0.1';
      const path = isLocal ? '/socket.io/' : '/poker.io/';
      return window.io({ path });
    } catch {
      try { return window.io(); } catch { return null; }
    }
  })();
  if (!socket) {
    console.error('Socket.IO missing');
    return;
  }

  let lastTable = null;
  let mySeat = -1;
  let lastStage = null;
  let lastCommunity = [];
  let currentState = null;
  let currentTurnSeat = -1;
  let timerRaf = null;
  

  async function ensureIdentify() {
    try {
      let provider = null;
      try { if (typeof window.__getSelectedProvider === 'function') provider = window.__getSelectedProvider(); } catch {}
      if (!provider && window.ethereum?.request) provider = window.ethereum;

      let addr = null;
      if (provider?.request) {
        const accs = await provider.request({ method: 'eth_accounts' }).catch(() => []);
        const first = Array.isArray(accs) && accs[0] ? String(accs[0]) : '';
        if (isValidAddr(first)) {
          addr = first;
          persistAddr(addr);
        } else {
          persistAddr(null);
        }
      }

      if (!addr) {
        addr = storedAddr();
      }

      if (isValidAddr(addr)) {
        socket.emit('identify', { addr });
        return true;
      }
    } catch (err) {
      console.warn('Poker table: ensureIdentify failed', err);
    }
    return false;
  }

  function seatIndexForAddr(addr) {
    if (!addr || !lastTable) return -1;
    const target = String(addr).toLowerCase();
    const seatsList = lastTable.seats || [];
    return seatsList.findIndex(s => s && String(s.addr || '').toLowerCase() === target);
  }

  function seatIndexForActor(actor) {
    if (!actor) return -1;
    if (Number.isFinite(actor.seatId)) return actor.seatId;
    return seatIndexForAddr(actor.addr);
  }

  function clearSeatCards(idx) {
    const meta = seatMeta[idx];
    if (!meta) return;
    meta.cards.innerHTML = '';
  }

  function setSeatCards(idx, cards, { faceDown = false } = {}) {
    const meta = seatMeta[idx];
    if (!meta) return;
    meta.cards.innerHTML = '';
    (cards || []).forEach(code => {
      const el = document.createElement('img');
      el.className = 'card deal';
      el.alt = '';
      el.src = faceDown ? CARD_BACK : cardToImg(code);
      meta.cards.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
    });
  }

  function renderBoard(cards) {
    const arr = Array.isArray(cards) ? cards : [];
    if (!arr.length) {
      board.innerHTML = '';
      board.classList.add('empty');
      return;
    }
    board.classList.remove('empty');
    const children = Array.from(board.children);
    arr.forEach((code, idx) => {
      let el = children[idx];
      if (!el) {
        el = document.createElement('img');
        el.className = 'card deal';
        el.alt = '';
        board.appendChild(el);
      }
      el.dataset.code = code;
      el.src = cardToImg(code);
      if (!el.classList.contains('show')) {
        requestAnimationFrame(() => el.classList.add('show'));
      }
    });
    while (board.children.length > arr.length) {
      board.removeChild(board.lastElementChild);
    }
  }

  function flashBurn() {
    burnPile.innerHTML = '';
    const el = document.createElement('img');
    el.className = 'card';
    el.alt = '';
    el.src = CARD_BACK;
    burnPile.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 180);
    }, 220);
  }

  function updateCenter(st) {
    if (!centerBanner) return;
    if (!st) {
      centerBanner.style.display = 'none';
      return;
    }
    const parts = [];
    const stage = STAGE_LABEL[st.stage] || st.stage;
    if (stage) parts.push(stage.toUpperCase());
    if (Number.isFinite(st.pot)) parts.push(`Pot ${formatChips(st.pot)}${isOnchainTable ? ' DCMon' : ''}`);
    if (Number.isFinite(st.toCall) && st.toCall > 0) parts.push(`To Call ${formatChips(st.toCall)}${isOnchainTable ? ' DCMon' : ''}`);
    if (!parts.length) {
      centerBanner.style.display = 'none';
      return;
    }
    centerBanner.textContent = parts.join(' - ');
    centerBanner.style.display = 'block';
  }

  function hideActionBar() {
    actionBar.classList.add('hidden');
    currentTurnSeat = -1;
  }

  function anchorActionBar() {
    const canvasRect = canvas.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    const desiredTop = (boardRect.bottom - canvasRect.top) + 20;
    const canvasHeight = canvasRect.height;
    const actionHeight = actionBar.offsetHeight || 0;
    let maxTop = canvasHeight - actionHeight - 24;
    const bottomMost = seatMeta.reduce((max, meta) => {
      if (!meta || !meta.seat) return max;
      const rect = meta.seat.getBoundingClientRect();
      return Math.max(max, rect.bottom - canvasRect.top);
    }, 0);
    if (bottomMost > 0) {
      maxTop = Math.min(maxTop, bottomMost - actionHeight - 24);
    }
    const minTop = Math.max((boardRect.bottom - canvasRect.top) + 12, 12);
    const top = Math.min(Math.max(minTop, desiredTop), maxTop);
    actionBar.style.top = `${top}px`;
  }

  function startTurnTimer(seatIdx) {
    if (timerRaf) cancelAnimationFrame(timerRaf);
    seatMeta.forEach(meta => {
      if (meta.timerFill) meta.timerFill.style.width = '0%';
      meta.seat.classList.remove('turn');
    });
    if (seatIdx < 0) return;
    const meta = seatMeta[seatIdx];
    if (!meta || !meta.timerFill) return;
    const deadline = performance.now() + TURN_MS;
    meta.seat.classList.add('turn');
    const tick = () => {
      const remaining = deadline - performance.now();
      const pct = Math.max(0, Math.min(1, remaining / TURN_MS));
      meta.timerFill.style.width = `${(1 - pct) * 100}%`;
      if (remaining > 0) {
        timerRaf = requestAnimationFrame(tick);
      } else {
        meta.timerFill.style.width = '100%';
        timerRaf = null;
      }
    };
    meta.timerFill.style.width = '0%';
    timerRaf = requestAnimationFrame(tick);
  }

  function clearTimers() {
    if (timerRaf) cancelAnimationFrame(timerRaf);
    timerRaf = null;
    seatMeta.forEach(meta => {
      if (meta.timerFill) meta.timerFill.style.width = '0%';
      meta.seat.classList.remove('turn');
    });
  }

  async function sendAction(action, amountInput) {
    try {
      await ensureIdentify();

      if (!isOnchainTable) {
        const payload = { action };
        if (action === 'bet' || action === 'raise') {
          const amt = Number(amountInput);
          if (!Number.isFinite(amt) || amt <= 0) {
            console.warn('Invalid bet/raise amount');
            return;
          }
          payload.amount = amt;
        }
        socket.emit('poker:act', payload);
        hideActionBar();
        return;
      }

      const payload = { action };
      const state = currentState || tableSnapshot || null;
      const seatIndex = mySeat;
      if (!Number.isInteger(seatIndex) || seatIndex < 0) {
        alert('Take a seat before acting.');
        return;
      }

      const adapter = await getOnchainAdapter();
      if (!adapter) {
        alert('Wallet adapter unavailable. Refresh and try again.');
        return;
      }

      const actor = actorForSeat(state, seatIndex) || {};
      const already = Number(actor.contrib || 0);
      const target = Number(state?.toCall || 0);
      const toCallChips = Math.max(0, target - already);
      let deltaChips = 0;

      if (action === 'call') {
        deltaChips = toCallChips;
      } else if (action === 'bet' || action === 'raise') {
        const dcmonValue = Number(amountInput);
        if (!Number.isFinite(dcmonValue) || dcmonValue <= 0) {
          alert('Enter a valid DCMon amount.');
          return;
        }
        const chipsTarget = dcmonToChips(dcmonValue);
        if (!Number.isFinite(chipsTarget) || chipsTarget <= already) {
          alert('Bet must exceed your current contribution.');
          return;
        }
        payload.amount = chipsTarget;
        deltaChips = Math.max(0, chipsTarget - already);
      }

      let restoreControls = null;
      if (deltaChips > 0) {
        const buttons = [foldBtn, callBtn, betBtn];
        const prevDisabled = buttons.map(btn => btn.disabled);
        const prevInputDisabled = betInput.disabled;
        const prevText = infoText.textContent;
        buttons.forEach(btn => { btn.disabled = true; });
        betInput.disabled = true;
        infoText.textContent = 'Confirming on-chain contribution...';
        restoreControls = () => {
          buttons.forEach((btn, idx) => { btn.disabled = prevDisabled[idx]; });
          betInput.disabled = prevInputDisabled;
          infoText.textContent = prevText;
        };

        try {
          await adapter.contribute(seatIndex, deltaChips);
        } catch (err) {
          console.error('Poker table: contribution failed', err);
          alert(err?.message || 'Contribution failed. Check wallet and try again.');
          if (restoreControls) restoreControls();
          return;
        }
        if (restoreControls) restoreControls();
      }

      socket.emit('poker:act', payload);
      hideActionBar();
    } catch (err) {
      console.error('Poker table: action failed', err);
      alert(err?.message || 'Action failed. Please try again.');
    }
  }

  foldBtn.addEventListener('click', () => sendAction('fold'));
  callBtn.addEventListener('click', () => {
    const action = callBtn.dataset.action || 'check';
    sendAction(action);
  });
  betBtn.addEventListener('click', () => {
    const action = betBtn.dataset.action || 'bet';
    sendAction(action, betInput.value);
  });

  function actorForSeat(state, seatIdx) {
    if (!Number.isInteger(seatIdx)) return null;
    if (!Array.isArray(state?.actors)) return null;
    return state.actors.find(actor => seatIndexForActor(actor) === seatIdx) || null;
  }

  function updateActionBar(turnSeat, state) {
    if (turnSeat < 0 || turnSeat !== mySeat) {
      hideActionBar();
      return;
    }
    const actor = actorForSeat(state, mySeat);
    const already = Number(actor?.contrib || 0);
    const target = Number(state?.toCall || 0);
    const toCall = Math.max(0, target - already);
    const raiseAction = target > 0 ? 'raise' : 'bet';
    callBtn.dataset.action = toCall > 0 ? 'call' : 'check';
    callBtn.textContent = toCall > 0 ? `Call ${formatChips(toCall)}${isOnchainTable ? ' DCMon' : ''}` : 'Check';
    betBtn.dataset.action = raiseAction;
    betBtn.textContent = raiseAction === 'raise' ? 'Raise' : 'Bet';
    betInput.style.display = 'inline-block';
    betInput.value = '';
    betInput.placeholder = isOnchainTable ? 'Bet amount (DCMon)' : 'Bet amount';
    const needText = toCall > 0 ? `To call: ${formatChips(toCall)}${isOnchainTable ? ' DCMon' : ''}` : 'Check or bet';
    infoText.textContent = `Your turn - ${needText}`;
    actionBar.classList.remove('hidden');
    // Enhance placeholder/min suggestions and button enablement
    try {
      const min = raiseAction === 'raise' ? Math.max(target * 2, 2) : 1;
      betInput.min = String(min);
      betInput.step = '1';
      betInput.placeholder = raiseAction === 'raise' ? ('Raise to ' + formatChips(min) + (isOnchainTable ? ' DCMon' : '')) : (isOnchainTable ? 'Bet amount (DCMon)' : 'Bet amount');
      const enableCheck = () => {
        const v = Number(betInput.value);
        const ok = Number.isFinite(v) && v >= min;
        betBtn.disabled = (raiseAction === 'raise') ? !ok : false;
      };
      betInput.oninput = enableCheck;
      enableCheck();
    } catch {}
    currentTurnSeat = turnSeat;
    anchorActionBar();
  }

  function updateSeatStates(state) {
    seatMeta.forEach(meta => {
      meta.seat.classList.remove('folded', 'acted', 'winner');
    });
    const actors = Array.isArray(state?.actors) ? state.actors : [];
    actors.forEach(actor => {
      const idx = seatIndexForActor(actor);
      if (idx < 0) return;
      const meta = seatMeta[idx];
      if (actor.folded) meta.seat.classList.add('folded');
      if (actor.acted) meta.seat.classList.add('acted');
    });
  }



  function isValidAddr(s) {
    try {
      const value = String(s || '').toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(value)) return false;
      if (value === ZERO_ADDR) return false;
      return true;
    } catch {
      return false;
    }
  }

  function renderAllSeats(table) {
    const prevTable = lastTable;
    lastTable = table;
    tableSnapshot = table;
    if (isOnchainTable) updateChipValueFromTable(table);

    const bankroll = getBankrollHelper() || null;
    const seatsList = Array.isArray(table?.seats) ? table.seats : [];
    const prevSeats = Array.isArray(prevTable?.seats) ? prevTable.seats : [];
    const meAddr = (currentAddr() || '').toLowerCase();
    mySeat = -1;

    seatMeta.forEach((meta, idx) => {
      if (!meta) return;
      const seatData = seatsList[idx] || null;
      const seatAddr = ((seatData && seatData.addr) || '').toLowerCase();
      const valid = !!seatData && isValidAddr(seatAddr);
      const isMe = valid && seatAddr === meAddr;
      const prevSeat = prevSeats[idx] || null;
      const prevAddr = ((prevSeat && prevSeat.addr) || '').toLowerCase();

      if (isMe) mySeat = idx;

      meta.seat.classList.toggle('occupied', valid);
      meta.seat.classList.toggle('ready', !!(valid && seatData.ready));
      meta.seat.classList.toggle('me', isMe);

      meta.addr.textContent = valid
        ? `${short(seatData.addr)}${seatData.ready ? ' [ready]' : ''}`
        : '';

      if (!valid) {
        meta.stack.textContent = '';
      } else if (isOnchainTable) {
        const rawBalance = Number(seatData && seatData.balance != null ? seatData.balance : 0);
        const display = Number.isFinite(rawBalance)
          ? trimDecimals((rawBalance >= 10 ? rawBalance.toFixed(2) : rawBalance.toFixed(3)))
          : '0';
        meta.stack.textContent = `Stack: ${display} DCMon`;
      } else {
        const chips = Number(seatData && seatData.chips != null ? seatData.chips : 0);
        meta.stack.textContent = `Stack: ${formatChips(chips)} chips`;
      }

      if (!valid || seatAddr !== prevAddr) {
        meta.cards.innerHTML = '';
      }

      meta.btns.innerHTML = '';

      if (!valid) {
        const sit = document.createElement('button');
        sit.textContent = 'Sit';
        sit.addEventListener('click', async () => {
          if (sit.disabled) return;
          const original = sit.textContent;
          try { sit.disabled = true; sit.textContent = 'Seating...'; } catch {}
          const ok = await ensureIdentify();
          if (!ok) {
            try { sit.disabled = false; sit.textContent = original; } catch {}
            alert('Connect your wallet first in the Tavern, then return to sit.');
            return;
          }
          if (isOnchainTable) {
            const adapter = await getOnchainAdapter();
            if (!adapter) {
              try { sit.disabled = false; sit.textContent = original; } catch {}
              alert('On-chain adapter unavailable. Refresh and try again.');
              return;
            }
            try {
              sit.textContent = 'Joining...';
              await adapter.joinSeat(idx);
            } catch (err) {
              console.error('Poker table: joinSeat failed', err);
              try { sit.disabled = false; sit.textContent = original; } catch {}
              alert('Seat transaction failed. Confirm wallet status and retry.');
              return;
            }
          }
          socket.emit('seat', { index: idx });
        });
        meta.btns.appendChild(sit);
      } else if (isMe) {
        if (isOnchainTable && bankroll && typeof bankroll.buyIn === 'function') {
          const myBalance = Number(seatData && seatData.balance != null ? seatData.balance : 0);
          if (!Number.isFinite(myBalance) || myBalance < 1) {
            const autoBtn = document.createElement('button');
            autoBtn.textContent = 'Auto Buy 1 DCMon';
              autoBtn.addEventListener('click', async () => {
                if (autoBtn.disabled) return;
                const bankrollNow = getBankrollHelper();
                if (!bankrollNow || typeof bankrollNow.buyIn !== 'function') {
                  alert('Open the wallet controls to buy in.');
                  return;
                }
                try {
                  autoBtn.disabled = true;
                  const buyInput = document.getElementById('wi-buy-input');
                  if (buyInput) buyInput.value = '1';
                  if (typeof bankrollNow.ready === 'function') await bankrollNow.ready();
                  await bankrollNow.buyIn();
                  setTimeout(() => {
                    try {
                      const helper = getBankrollHelper();
                      if (helper && typeof helper.refreshBalance === 'function') {
                        helper.refreshBalance(seatData.addr);
                      }
                    } catch (refreshErr) { console.warn('Poker table: auto buy refresh failed', refreshErr); }
                  }, 350);
                } catch (err) {
                  console.error('Poker table: auto buy failed', err);
                  alert(err?.message || 'Buy-in failed');
                } finally {
                  setTimeout(() => { autoBtn.disabled = false; }, 350);
                }
              });
            meta.btns.appendChild(autoBtn);
          }
        }

        const leaveBtn = document.createElement('button');
        leaveBtn.textContent = 'Leave';
        leaveBtn.addEventListener('click', async () => {
          if (leaveBtn.disabled) return;
          await ensureIdentify();
          if (isOnchainTable) {
            const adapter = await getOnchainAdapter();
            if (!adapter) {
              alert('On-chain adapter unavailable. Refresh and try again.');
              return;
            }
            try {
              leaveBtn.disabled = true;
              leaveBtn.textContent = 'Leaving...';
              const inHand = !!(currentState && currentState.stage);
              await adapter.leaveSeat(idx, { inHand });
            } catch (err) {
              console.error('Poker table: leaveSeat failed', err);
              leaveBtn.disabled = false;
              leaveBtn.textContent = 'Leave';
              alert('Leave transaction failed. Try again.');
              return;
            }
          }
          socket.emit('seat', { index: -1 });
        });
        meta.btns.appendChild(leaveBtn);
      }
    });

    if (isOnchainTable && bankroll && typeof bankroll.refreshBalance === 'function' && mySeat >= 0) {
      const mySeatData = seatsList[mySeat] || null;
      const prevSeatData = prevSeats[mySeat] || null;
      const myAddrNow = mySeatData && mySeatData.addr ? mySeatData.addr : null;
      const prevAddrAtSeat = prevSeatData && prevSeatData.addr ? prevSeatData.addr : null;
      const prevLower = prevAddrAtSeat ? prevAddrAtSeat.toLowerCase() : '';
      if (myAddrNow && myAddrNow.toLowerCase() !== prevLower) {
        setTimeout(() => {
          try { bankroll.refreshBalance(myAddrNow); } catch {}
        }, 300);
      }
    }

    try {
      seatMeta.forEach((meta, i) => {
        if (!meta) return;
        if (i !== mySeat) meta.seat.classList.toggle('me', false);
      });
    } catch {}
  }

  socket.on('connect', () => {
    ensureIdentify();
    socket.emit('join_table', { table: tableId });
  });

  socket.on('table:update', (table) => {
    renderAllSeats(table);
  });

  socket.on('poker:state', (state) => {
    currentState = state;
    updateCenter(state);
    updateSeatStates(state);

    if (state?.stage !== lastStage) {
      if (state?.stage === 'preflop' && lastTable) {
        (lastTable.seats || []).forEach((seatData, idx) => {
          const saddr = seatData && String(seatData.addr||'').toLowerCase();
          const meAddr = (currentAddr()||'').toLowerCase();
          const valid = seatData && isValidAddr(saddr);
          if (valid && saddr !== meAddr) {
            setSeatCards(idx, [null, null], { faceDown: true });
          } else if (!valid) {
            clearSeatCards(idx);
          }
        });
        board.innerHTML = '';
        burnPile.innerHTML = '';
        lastCommunity = [];
      }
      lastStage = state?.stage || null;
    }

    if (Array.isArray(state?.community)) {
      if (state.community.length > lastCommunity.length && state.stage !== 'preflop') {
        flashBurn();
      }
      renderBoard(state.community);
      lastCommunity = state.community.slice();
    }

    const turnActor = Array.isArray(state?.actors) && Number.isFinite(state.turnIndex)
      ? state.actors[state.turnIndex] : null;
    const turnSeat = seatIndexForActor(turnActor);
    currentTurnSeat = turnSeat;
    startTurnTimer(turnSeat);
    updateActionBar(turnSeat, state);
  });

  socket.on('poker:private', (msg) => {
    const seatId = Number.isFinite(msg?.seatId) ? msg.seatId : seatIndexForAddr(msg?.addr);
    if (!Number.isInteger(seatId) || seatId < 0) return;
    if (mySeat < 0) mySeat = seatId;
    if (seatId !== mySeat) return;
    const cards = (msg.cards || []).slice(0, 2);
    setSeatCards(seatId, cards, { faceDown: false });
  });

  socket.on('poker:hand', (msg) => {
    clearTimers();
    hideActionBar();
    if (Array.isArray(msg?.community)) {
      renderBoard(msg.community);
      lastCommunity = msg.community.slice();
    }

    seatMeta.forEach(meta => meta.seat.classList.remove('winner'));

    if (Array.isArray(msg?.exposures)) {
      msg.exposures.forEach(ex => {
        const idx = Number.isFinite(ex?.seatId) ? ex.seatId : seatIndexForAddr(ex?.addr);
        if (idx >= 0) setSeatCards(idx, ex.cards || [], { faceDown: false });
      });
    }

    if (Array.isArray(msg?.winners) && msg.winners.length) {
      const names = msg.winners.map(w => short(w.addr)).join(', ');
      if (centerBanner) {
        centerBanner.textContent = `Winner: ${names}`;
        centerBanner.style.display = 'block';
      }
      msg.winners.forEach(w => {
        const idx = Number.isFinite(w?.seatId) ? w.seatId : seatIndexForAddr(w?.addr);
        if (idx >= 0) seatMeta[idx].seat.classList.add('winner');
      });
    }

    if (lastHandEl) {
      try {
        const winners = Array.isArray(msg?.winners) ? msg.winners : [];
        const names = winners.map(w => short(w?.addr || ''))
                             .filter(Boolean)
                             .join(', ');
        const pot = Number.isFinite(msg?.pot) ? (' +' + formatChips(msg.pot) + (isOnchainTable ? ' DCMon' : '')) : '';
        lastHandEl.textContent = names ? ('Last: ' + names + pot) : 'Hand complete';
        if (lastHandBox) lastHandBox.style.display = '';
      } catch {
        try { if (lastHandBox) lastHandBox.style.display = 'none'; } catch {}
      }
    }

    setTimeout(() => {
      board.innerHTML = '';
      burnPile.innerHTML = '';
      lastStage = null;
      lastCommunity = [];
      seatMeta.forEach((meta, idx) => {
        if (!lastTable || !lastTable.seats || !lastTable.seats[idx]) {
          meta.cards.innerHTML = '';
        }
        meta.seat.classList.remove('winner', 'folded', 'acted', 'turn');
        if (meta.timerFill) meta.timerFill.style.width = '0%';
      });
      updateCenter(null);
    }, 1800);
  });

  window.addEventListener('resize', () => {
    positionSeats();
    if (!actionBar.classList.contains('hidden')) {
      anchorActionBar();
    }
  });

  const ro = new ResizeObserver(() => {
    positionSeats();
    if (!actionBar.classList.contains('hidden')) {
      anchorActionBar();
    }
  });
  ro.observe(canvas);

  ensureIdentify();
  socket.emit('join_table', { table: tableId });
  window.addEventListener('focus', ensureIdentify);
})();



















