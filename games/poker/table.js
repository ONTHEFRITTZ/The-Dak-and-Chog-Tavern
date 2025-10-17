// games/poker/table.js
// Restores the image-based felt, seat layout, private hole handling, burn flashes,
// simple dealing animations, action controls.
function initializePokerTable() {
  let ethers = window.ethers;
  const tableMode = (document.documentElement.getAttribute('data-table-mode') || 'f2p').toLowerCase();
  let isOnchainTable = tableMode === 'onchain';
  function getBankrollHelper() {
    return window.Bankroll || window.__PokerBankroll || null;
  }
  function requestBankrollRefresh(addr) {
    if (!isOnchainTable || !isValidAddr(addr)) return;
    let poller = null;
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (poller) {
        clearInterval(poller);
        poller = null;
      }
      document.removeEventListener('bankroll:ready', onReady);
    };
    const tryRefresh = () => {
      const bankroll = getBankrollHelper();
      if (bankroll?.refreshBalance) {
        try { bankroll.refreshBalance(addr); } catch {}
        cleanup();
        return true;
      }
      return false;
    };
    const onReady = () => { tryRefresh(); };
    if (tryRefresh()) return;
    document.addEventListener('bankroll:ready', onReady);
    const start = Date.now();
    poller = setInterval(() => {
      if (tryRefresh()) return;
      if (Date.now() - start > 6500) cleanup();
    }, 600);
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
  async function waitForGlobal(checkFn, label, timeout = 6000, interval = 80) {
    try {
      if (typeof checkFn === 'function' && checkFn()) return true;
    } catch {}
    return new Promise((resolve) => {
      const deadline = Date.now() + timeout;
      let poller = null;
      const cleanup = (result) => {
        if (poller) clearInterval(poller);
        resolve(result);
      };
      poller = setInterval(() => {
        try {
          if (typeof checkFn === 'function' && checkFn()) {
            cleanup(true);
            return;
          }
        } catch {}
        if (Date.now() > deadline) {
          if (label) {
            console.warn(`Poker table: wait for ${label} timed out`);
          }
          cleanup(false);
        }
      }, interval);
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
    const offset = (typeof mySeat === 'number' && mySeat >= 0)
      ? (((total >= 6 ? 3 : Math.floor(total/2)) - mySeat + total) % total)
      : 0;
    seats.forEach((seat, idx) => {
      const visual = (idx + offset) % total;
      const { left, top } = seatPosition(visual, total);
      seat.style.left = `${left}%`;
      seat.style.top = `${top}%`;
    });
  }
  const canvas = document.querySelector('.table-canvas');
  if (!canvas) return;
  // Pre-seat: hide action UI until the user sits
  try { canvas.classList.add('pre-seat'); } catch {}
  const sitCta = document.getElementById('sit-cta');
  const sitCenterBtn = document.getElementById('sit-center');
  const nameModal = document.getElementById('name-modal');
  const nameInput = document.getElementById('nm-input');
  const nameCancel = document.getElementById('nm-cancel');
  const nameContinue = document.getElementById('nm-continue');
  const showSitCta = (show) => {
    try {
      if (!sitCta) return;
      const hiding = !show;
      if (hiding) {
        // If focus is inside the overlay, move it before hiding for a11y
        try {
          if (sitCta.contains(document.activeElement)) {
            if (canvas && typeof canvas.setAttribute === 'function') {
              if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '-1');
              try { canvas.focus(); } catch {}
            }
            try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch {}
          }
        } catch {}
        try { sitCta.setAttribute('inert', ''); } catch {}
      } else {
        try { sitCta.removeAttribute('inert'); } catch {}
      }
      sitCta.classList.toggle('show', !!show);
      sitCta.setAttribute('aria-hidden', show ? 'false' : 'true');
      if (show) {
        try { sitCenterBtn && sitCenterBtn.focus && sitCenterBtn.focus(); } catch {}
      }
    } catch {}
  };
  showSitCta(true);

  function showNameModal(show) {
    try {
      if (!nameModal) return;
      nameModal.classList.toggle('show', !!show);
      nameModal.setAttribute('aria-hidden', show ? 'false' : 'true');
      if (show) {
        if (!sitCta.classList.contains('show')) showSitCta(true);
        // Hide the Sit button while modal is active
        try { if (sitCenterBtn) sitCenterBtn.style.display = 'none'; } catch {}
        if (nameInput) {
          nameInput.value = (localStorage.getItem('poker.username')||'').slice(0,12);
          nameInput.focus();
        }
      } else {
        try { if (document.activeElement && nameModal.contains(document.activeElement)) document.activeElement.blur(); } catch {}
        // Restore Sit button only if CTA still visible (i.e., user canceled)
        try { if (sitCenterBtn && sitCta.classList.contains('show')) sitCenterBtn.style.display = ''; } catch {}
      }
    } catch {}
  }

  // Seat selection + center sit handler (scoped here to access locals)
  async function pickPreferredSeatIndex() {
    const total = seats.length || 6;
    const order = (total >= 6) ? [3,2,4,1,5,0].slice(0,total) : Array.from({length: total}, (_,i)=>i);
    if (!isOnchainTable) return order[0] || 0;
    try {
      const adapter = await getOnchainAdapter();
      if (!adapter || typeof adapter.readSeatOwnerLower !== 'function') return order[0] || 0;
      for (const idx of order) {
        try { const owner = await adapter.readSeatOwnerLower(idx); if (!owner || owner === ZERO_ADDR) return idx; } catch {}
      }
    } catch {}
    return order[0] || 0;
  }
  async function handleCenterSit() {
    try {
      const ok = await ensureIdentify();
      if (!ok) { alert('Connect your wallet first.'); return; }
      // Collect or reuse display name via modal
      let name = '';
      try { name = String(localStorage.getItem('poker.username')||'').trim().slice(0,12); } catch {}
      const isPlaceholder = !name || /^player$/i.test(name);
      // Treat default placeholder as missing so we always ask nicely
      if (isPlaceholder && nameModal && nameInput) {
        showNameModal(true);
        await new Promise((resolve) => {
          const onCancel = () => { name = ''; cleanup(); resolve(); };
          const onContinue = () => {
            const raw = String(nameInput.value||'').trim().slice(0,12);
            name = sanitizeName(raw);
            try { if (name) localStorage.setItem('poker.username', name); } catch {}
            cleanup(); resolve();
          };
          function cleanup() {
            try { nameCancel?.removeEventListener('click', onCancel); } catch {}
            try { nameContinue?.removeEventListener('click', onContinue); } catch {}
            showNameModal(false);
          }
          nameCancel?.addEventListener('click', onCancel);
          nameContinue?.addEventListener('click', onContinue);
          // Allow Enter key to submit
          try {
            const onKey = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onContinue(); } };
            nameInput?.addEventListener('keydown', onKey, { once: true });
          } catch {}
        });
      }
      if (isPlaceholder && (!nameModal || !nameInput)) {
        // Fallback prompt if modal missing
        try { name = String(prompt('What is your name?','')||'').trim().slice(0,12); } catch {}
        name = sanitizeName(name);
        try { localStorage.setItem('poker.username', name || 'Player'); } catch {}
      }
      if (!name) { name = 'Player'; try { localStorage.setItem('poker.username', name); } catch {} }
      const seatIdx = await pickPreferredSeatIndex();
      if (isOnchainTable) {
        const adapter = await getOnchainAdapter();
        if (!adapter) { alert(describeAdapterError()); return; }
        await adapter.joinSeat(seatIdx);
        // Inform server for UI sync and set optimistic local seat state
        emitSocket('seat', { index: seatIdx });
        mySeat = seatIdx;
        try { if (seatMeta[seatIdx]?.nameEl) {
          const uname = String(localStorage.getItem('poker.username')||'').trim().slice(0,12);
          seatMeta[seatIdx].nameEl.textContent = uname; }
        } catch {}
      } else {
        emitSocket('seat', { index: seatIdx });
      }
      showSitCta(false);
      try { canvas.classList.remove('pre-seat'); } catch {}
    } catch (e) { console.warn('Center sit failed', e); showSitCta(true); }
  }
  function sanitizeName(raw) {
    try {
      let s = String(raw||'').trim().slice(0,12);
      // Disallow obvious URLs
      if (/https?:\/\//i.test(s) || /\.[a-z]{2,}$/i.test(s)) s = '';
      // Collapse to alphanum + space + basic punctuation
      s = s.replace(/[^\w \-'.]/g, '');
      return s;
    } catch { return ''; }
  }
  if (sitCenterBtn) sitCenterBtn.addEventListener('click', handleCenterSit);

  function seatIndexForSeatId(seatId){
    try{
      if (!Array.isArray(currentState?.actors)) return -1;
      const a = currentState.actors.find(z=> Number(z?.seatId)===Number(seatId));
      return a ? seatIndexForActor(a) : -1;
    } catch (e) { return -1; }
  }
  const MAX_ONCHAIN_SEATS = 6;
  const seatNodes = Array.from(document.querySelectorAll('.seat'));
  const seats = isOnchainTable ? seatNodes.slice(0, MAX_ONCHAIN_SEATS) : seatNodes;
  // Ensure mySeat is defined before any function references it
  let mySeat = -1;
  if (isOnchainTable && seatNodes.length > seats.length) {
    seatNodes.slice(seats.length).forEach((seat) => {
      try {
        seat.classList.add('seat-disabled');
        seat.style.display = 'none';
      } catch {}
    });
  }
  let onchainAdapterPromise = null;
  let onchainAdapterError = null;
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
      const tag = (typeof window !== 'undefined' && (window.__BUILD_TAG || Date.now())) || Date.now();
      configModulePromise = import(`../../js/config.js?v=${encodeURIComponent(tag)}`).catch((err) => {
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
      onchainAdapterPromise = createOnchainAdapter()
        .then((adapter) => {
          onchainAdapterError = null;
          return adapter;
        })
        .catch((err) => {
          const wrapped = err instanceof Error ? err : new Error(String(err || 'On-chain adapter error'));
          onchainAdapterError = wrapped;
          console.error('Poker table: adapter init failed', err);
          onchainAdapterPromise = null;
          return null;
        });
    }
    const adapter = await onchainAdapterPromise;
    if (!adapter) {
      onchainAdapterPromise = null;
    }
    return adapter;
  }
  function describeAdapterError(defaultMessage) {
    if (onchainAdapterError && onchainAdapterError.message) {
      return `On-chain adapter unavailable: ${onchainAdapterError.message}`;
    }
    return defaultMessage || 'On-chain adapter unavailable. Refresh and try again.';
  }
  async function createOnchainAdapter() {
    if (!isOnchainTable) return null;
    const ethersReady = await waitForGlobal(() => {
      if (window.ethers && window.ethers.Contract) {
        if (!ethers) ethers = window.ethers;
        return true;
      }
      return false;
    }, 'ethers');
    if (!ethersReady || !ethers) {
      try {
        const mod = await import('https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js');
        if (mod?.ethers) {
          ethers = mod.ethers;
          try { window.ethers = mod.ethers; } catch {}
        }
      } catch (err) {
        throw new Error('Ethers.js not loaded');
      }
      if (!ethers || !ethers.Contract) {
        throw new Error('Ethers.js not loaded');
      }
    }
    const abiReady = await waitForGlobal(
      () => Array.isArray(window.HoldemPokerABI) && window.HoldemPokerABI.length > 0,
      'HoldemPokerABI'
    );
    if (!abiReady) throw new Error('HoldemPoker ABI not loaded');
    let bankroll = null;
    try {
      bankroll = await waitForBankrollHelper();
    } catch (err) {
      console.warn('Poker table: bankroll helper unavailable, using fallback provider', err);
      bankroll = null;
    }
    if (bankroll && typeof bankroll.ensureContracts === 'function') {
      const ok = await bankroll.ensureContracts();
      if (!ok) throw new Error('Bankroll contracts unavailable');
    }
    let provider = bankroll && typeof bankroll.getProvider === 'function'
      ? await bankroll.getProvider()
      : null;
    if (!provider && window.ethereum && ethers?.providers?.Web3Provider) {
      try {
        provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
      } catch (provErr) {
        console.warn('Poker table: fallback provider init failed', provErr);
      }
    }
    if (provider && typeof provider.send === 'function') {
      try { await provider.send('eth_requestAccounts', []); } catch (reqErr) {
        console.warn('Poker table: provider account request failed', reqErr);
      }
    } else if (window.ethereum && typeof window.ethereum.request === 'function') {
      try { await window.ethereum.request({ method: 'eth_requestAccounts' }); } catch {}
    }
    let signer = bankroll && typeof bankroll.getSigner === 'function'
      ? await bankroll.getSigner()
      : null;
    if (!signer && provider?.getSigner) {
      try {
        signer = await provider.getSigner();
      } catch (signErr) {
        console.warn('Poker table: provider getSigner failed', signErr);
        signer = null;
      }
    }
    if (!provider || !signer) throw new Error('Connect wallet before joining on-chain tables');
    const tableAddress = await resolvePokerTableAddress(provider);
    if (!tableAddress) throw new Error('Poker table address missing');
    const contract = new ethers.Contract(tableAddress, window.HoldemPokerABI, signer);
    let cachedAddr = null;
    let aaOpsModule = null;
    let lastAAError = null;
    let seatProbeSupported = false;
    let seatProbeWarned = false;
    async function ownerAddress() {
      try {
        if (window.AA && typeof window.AA.smartAccountAddress === 'string' && window.AA.smartAccountAddress) {
          return window.AA.smartAccountAddress;
        }
      } catch {}
      if (!cachedAddr) cachedAddr = await signer.getAddress();
      return cachedAddr;
    }
    async function ensureAAOps() {
      if (aaOpsModule) return aaOpsModule;
      const tag = window.__BUILD_TAG || window.__ASSET_TAG || Date.now();
      const src = `/js/aa/ops.js?v=${encodeURIComponent(tag)}`;
      try {
        aaOpsModule = await import(/* @vite-ignore */ src);
      } catch (err) {
        console.warn('Poker table: AA ops unavailable', err);
        aaOpsModule = null;
      }
      return aaOpsModule;
    }
    async function callViaAA(signature, args, valueMON) {
      const ops = await ensureAAOps();
      if (!ops || typeof ops.callWithDelegation !== 'function') {
        lastAAError = new Error('MetaMask smart account delegation unavailable');
        return false;
      }
      try {
        const txHash = await ops.callWithDelegation({ to: tableAddress, signature, args, valueMON });
        if (txHash && provider?.waitForTransaction) {
          try { await provider.waitForTransaction(txHash); } catch (waitErr) {
            console.warn('Poker table: waitForTransaction failed', waitErr);
          }
        }
        lastAAError = null;
        return !!txHash;
      } catch (err) {
        console.warn('Poker table: AA call failed', signature, err);
        lastAAError = err;
        return false;
      }
    }
    const contracts = bankroll && typeof bankroll.getContracts === 'function' ? bankroll.getContracts() : null;
    let dcmonRead = contracts?.dcmonRead || null;
    if (!dcmonRead && provider) {
      try {
        const config = await loadConfigModule();
        const dcmonAddr =
          (config?.CONTRACTS && config.CONTRACTS.dcmon)
          || (window.CONTRACTS && window.CONTRACTS.dcmon)
          || null;
        const dcmonAbi = Array.isArray(window.DCMonABI)
          ? window.DCMonABI
          : (window.__BANKROLL_FALLBACK_ABIS__?.dcmon || []);
        if (dcmonAddr && Array.isArray(dcmonAbi) && dcmonAbi.length) {
          dcmonRead = new ethers.Contract(dcmonAddr, dcmonAbi, provider);
        }
      } catch (dcmonErr) {
        console.warn('Poker table: dcmon contract fallback failed', dcmonErr);
      }
    }
    async function ensureAllowance(amountWei) {
      if (!amountWei) return true;
      const addr = await ownerAddress();
      if (bankroll && typeof bankroll.ensureDcmonAllowance === 'function') {
        const allowed = await bankroll.ensureDcmonAllowance(amountWei, addr, tableAddress);
        if (!allowed) throw new Error('DCMon allowance not granted');
        return true;
      }
      if (!dcmonRead) return true;
      try {
        const current = await dcmonRead.allowance(addr, tableAddress);
        if (current && typeof current.gte === 'function' && current.gte(amountWei)) {
          return true;
        }
      } catch (allowErr) {
        console.warn('Poker table: allowance check failed', allowErr);
      }
      try {
        const dcmonWriter = dcmonRead.connect(signer);
        const maxUint = (ethers?.constants?.MaxUint256)
          || (ethers?.BigNumber ? ethers.BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') : null);
        const approvalAmount = maxUint || amountWei;
        const tx = await dcmonWriter.approve(tableAddress, approvalAmount);
        await tx.wait();
        return true;
      } catch (approveErr) {
        console.warn('Poker table: DCMon approve failed', approveErr);
        throw new Error('DCMon allowance not granted');
      }
    }
    async function contribute(seatId, chips) {
      if (!isOnchainTable) return true;
      if (seatId >= MAX_ONCHAIN_SEATS) {
        const err = new Error('Seat unavailable on-chain.');
        err.code = 'seat_range';
        throw err;
      }
      if (!Number.isFinite(chips) || chips <= 0) return true;
      const wei = chipsToWei(chips);
      if (!wei) throw new Error('Invalid contribution amount');
      const addr = await ownerAddress();
      if (dcmonRead) {
        const bal = await dcmonRead.balanceOf(addr);
        if (!bal || bal.lt(wei)) throw new Error('Insufficient DCMon balance');
      }
      await ensureAllowance(wei);
      const aaOk = await callViaAA('contribute(uint8,uint256)', [seatId, wei]);
      if (!aaOk) {
        const tx = await contract.contribute(seatId, wei);
        await tx.wait();
      }
      if (bankroll && typeof bankroll.refreshBalance === 'function') {
        setTimeout(() => {
          try { bankroll.refreshBalance(addr); } catch (refreshErr) {
            console.warn('Poker table: refresh after contribute failed', refreshErr);
          }
        }, 350);
      }
      return true;
    }
    async function readSeatOwnerLower(seatId) {
      if (!contract || !seatProbeSupported) return '';
      if (isOnchainTable && seatId >= MAX_ONCHAIN_SEATS) {
        const outOfRange = new Error('seat-range');
        outOfRange.code = 'seat_range';
        throw outOfRange;
      }
      try {
        if (typeof contract.seats !== 'function') {
          seatProbeSupported = false;
          return '';
        }
        const seatView = await contract.seats(seatId);
        const holder = typeof seatView === 'string'
          ? seatView
          : seatView && typeof seatView === 'object' && typeof seatView.player === 'string'
            ? seatView.player
            : Array.isArray(seatView) && typeof seatView[0] === 'string'
              ? seatView[0]
              : '';
        return holder ? holder.toLowerCase() : '';
      } catch (err) {
        if (!seatProbeWarned) {
          seatProbeWarned = true;
          const reason = String(err?.message || '').toLowerCase();
          const isRevert = reason.includes('revert') || reason.includes('execution reverted');
          const logFn = isRevert ? console.info : console.warn;
          logFn.call(
            console,
            'Poker table: seat owner probe unavailable; continuing without on-chain seat check.'
          );
        }
        seatProbeSupported = false;
        return '';
      }
    }
    async function autoClearSeat(seatId) {
      const waitFor = async (txHash) => {
        if (!txHash) return;
        try {
          if (provider?.waitForTransaction) {
            await provider.waitForTransaction(txHash);
          }
        } catch (err) {
          console.warn('Poker table: wait after auto-clear failed', err);
        }
      };
      try {
        const tx = await callViaAA('unseat(uint8)', [seatId]);
        if (tx) {
          await waitFor(tx);
          return true;
        }
      } catch (err) {
        const msg = String(err?.message || '').toLowerCase();
        if (msg.includes('hand')) {
          try {
            const tx = await callViaAA('leaveDuringHand(uint8)', [seatId]);
            if (tx) {
              await waitFor(tx);
              return true;
            }
          } catch (err2) {
            console.warn('Poker table: leaveDuringHand auto-clear failed', err2);
          }
        } else {
          console.warn('Poker table: auto-unseat via AA failed', err);
        }
      }
      if (typeof contract.unseat === 'function') {
        try {
          const tx = await contract.unseat(seatId);
          await tx.wait();
          return true;
        } catch {}
      }
      return false;
    }
    async function joinSeat(seatId) {
      if (!isOnchainTable) return true;
      if (seatId >= MAX_ONCHAIN_SEATS) {
        const err = new Error('Seat unavailable on-chain.');
        err.code = 'seat_range';
        throw err;
      }
      const smartAddr = (await ownerAddress())?.toLowerCase?.() || '';
      let seatOwner = await readSeatOwnerLower(seatId);
      let seatKnown = seatOwner && seatOwner !== ZERO_ADDR;
      if (seatKnown && seatOwner === smartAddr) {
        const cleared = await autoClearSeat(seatId);
        if (cleared) {
          seatOwner = await readSeatOwnerLower(seatId);
          seatKnown = seatOwner && seatOwner !== ZERO_ADDR;
        } else {
          const err = new Error('Seat already taken on-chain.');
          err.code = 'seat_taken';
          throw err;
        }
      }
      if (seatKnown && seatOwner !== smartAddr) {
        const err = new Error('Seat already taken on-chain.');
        err.code = 'seat_taken';
        throw err;
      }
      const aaOk = await callViaAA('joinSeat(uint8)', [seatId]);
      if (!aaOk) {
        // Try direct AA client send before falling back to signer
        try {
          const ops = await ensureAAOps();
          if (ops && typeof ops.encodeFromSignature === 'function' && typeof ops.sendTxViaAA === 'function') {
            const data = ops.encodeFromSignature('joinSeat(uint8)', [seatId]);
            const txHash = await ops.sendTxViaAA({ to: tableAddress, data });
            if (txHash) {
              try { if (provider?.waitForTransaction) await provider.waitForTransaction(txHash); } catch {}
              cachedAddr = await ownerAddress();
              return true;
            }
          }
        } catch {}
        const signerAddr = typeof signer.getAddress === 'function'
          ? (await signer.getAddress()).toLowerCase()
          : '';
        if (seatKnown && seatOwner !== signerAddr) {
          const err = new Error('Seat is held by your MetaMask Smart Account. Re-enable smart account delegation to manage this seat.');
          err.code = 'seat_owner_mismatch';
          err.details = { seatOwner };
          err.cause = lastAAError;
          throw err;
        }
        const tx = await contract.joinSeat(seatId);
        await tx.wait();
      }
      cachedAddr = await ownerAddress();
      return true;
    }
    async function leaveSeat(seatId, opts) {
      if (!isOnchainTable) return true;
      if (seatId >= MAX_ONCHAIN_SEATS) {
        const err = new Error('Seat unavailable on-chain.');
        err.code = 'seat_range';
        throw err;
      }
      const active = !!(opts && opts.inHand);
      const method = active ? 'leaveDuringHand' : 'unseat';
      if (typeof contract[method] !== 'function') return false;
      const signature = active ? 'leaveDuringHand(uint8)' : 'unseat(uint8)';
      const seatOwner = await readSeatOwnerLower(seatId);
      const seatKnown = seatOwner && seatOwner !== ZERO_ADDR;
      const smartAddr = (await ownerAddress())?.toLowerCase?.() || '';
      const aaOk = await callViaAA(signature, [seatId]);
      if (!aaOk) {
        // Try direct AA client send before falling back to signer
        try {
          const ops = await ensureAAOps();
          if (ops && typeof ops.encodeFromSignature === 'function' && typeof ops.sendTxViaAA === 'function') {
            const data = ops.encodeFromSignature(signature, [seatId]);
            const txHash = await ops.sendTxViaAA({ to: tableAddress, data });
            if (txHash) {
              try { if (provider?.waitForTransaction) await provider.waitForTransaction(txHash); } catch {}
              return true;
            }
          }
        } catch {}
        const signerAddr = typeof signer.getAddress === 'function'
          ? (await signer.getAddress()).toLowerCase()
          : '';
        if (seatKnown) {
          if (seatOwner === smartAddr && seatOwner !== signerAddr) {
            const err = new Error('Seat belongs to your MetaMask Smart Account. Re-enable smart account delegation to leave.');
            err.code = 'seat_owner_mismatch';
            err.details = { seatOwner };
            err.cause = lastAAError;
            throw err;
          }
          if (seatOwner !== signerAddr) {
            const err = new Error('Seat owned by a different address.');
            err.code = 'seat_owner_mismatch';
            err.details = { seatOwner };
            err.cause = lastAAError;
            throw err;
          }
        }
        const tx = await contract[method](seatId);
        await tx.wait();
      }
      return true;
    }

    if (isOnchainTable) {
      setTimeout(() => {
        (async () => {
          try {
            const smartAddr = (await ownerAddress())?.toLowerCase?.() || '';
            if (!smartAddr) return;
            for (let seatId = 0; seatId < MAX_ONCHAIN_SEATS; seatId++) {
              const holder = await readSeatOwnerLower(seatId);
              if (holder && holder === smartAddr) {
                await autoClearSeat(seatId);
              }
            }
          } catch (err) {
            console.warn('Poker table: automatic seat cleanup failed', err);
          }
        })();
      }, 0);
    }
    return { address: tableAddress, contract, joinSeat, leaveSeat, contribute, ownerAddress, readSeatOwnerLower };
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
  let updateConnectionBanner = () => {};
  const centerBanner = document.getElementById('poker-center');
  updateConnectionBanner = (message, tone) => {
    if (!centerBanner) return;
    if (!message) {
      if (centerBanner.dataset.mode === 'connection') {
        centerBanner.style.display = 'none';
        centerBanner.dataset.mode = '';
        centerBanner.style.color = '';
      }
      return;
    }
    centerBanner.dataset.mode = 'connection';
    centerBanner.textContent = message;
    centerBanner.style.display = 'block';
    if (tone === 'error') centerBanner.style.color = '#ff9a9a';
    else if (tone === 'info') centerBanner.style.color = '#d7d7d7';
    else centerBanner.style.color = '';
  };
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
    // Player display name (shown for your seat)
    let nameEl = seat.querySelector('.name');
    if (!nameEl) {
      nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = '';
      seat.appendChild(nameEl);
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
    let status = seat.querySelector('.status');
    if (!status) {
      status = document.createElement('div');
      status.className = 'status';
      seat.appendChild(status);
    }
    let marker = seat.querySelector('.marker');
    if (!marker) {
      marker = document.createElement('div');
      marker.className = 'marker';
      marker.style.display = 'none';
      seat.appendChild(marker);
    }
    return {
      seat,
      cards,
      addr,
      stack,
      btns,
      nameEl,
      status,
      marker,
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
  const allInBtn = document.createElement('button');
  allInBtn.textContent = 'All‑in';
  allInBtn.title = 'Bet your full DCMon balance';
  actionBar.append(infoText, foldBtn, callBtn, betInput, betBtn, allInBtn);

  // Optional: "Your Activity Score" near the wallet chip when Envio is configured
  // Removed wallet pill activity badge per request; activity now lives only in wallet modal.

  // Agent toggles (Auto Ready / Auto Rebuy / Auto Clear Seat)
  // Small floating panel near the wallet chip (top-right)
  const agentPanel = (() => {
    try {
      const panel = document.createElement('div');
      panel.id = 'agent-toggles';
      panel.style.cssText = [
        'position:fixed','top:64px','right:12px','z-index:12000',
        'display:flex','flex-direction:column','gap:6px','align-items:flex-start',
        'background:rgba(0,0,0,0.45)','backdrop-filter:blur(6px)',
        'border:1px solid rgba(255,255,255,0.15)','border-radius:12px','padding:8px 10px',
        'color:#f4e6d3','font-size:12px','max-width:280px'
      ].join(';');
      const title = document.createElement('div');
      title.textContent = 'Agent';
      title.style.cssText = 'font-weight:800;margin-bottom:2px;letter-spacing:.02em;opacity:.95';

      const row = (labelEl, inputEl) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%';
        wrap.appendChild(labelEl); wrap.appendChild(inputEl);
        return wrap;
      };

      const mkCheck = (key, labelText) => {
        const lab = document.createElement('label');
        lab.textContent = labelText;
        lab.style.fontWeight = '700';
        const box = document.createElement('input');
        box.type = 'checkbox';
        try { box.checked = (localStorage.getItem(key) === '1'); } catch {}
        box.addEventListener('change', () => { try { localStorage.setItem(key, box.checked ? '1' : '0'); } catch {} });
        return row(lab, box);
      };

      const rebuyLab = document.createElement('label');
      rebuyLab.textContent = 'Auto Rebuy (budget MON)';
      rebuyLab.style.fontWeight = '700';
      const rebuyWrap = document.createElement('div');
      rebuyWrap.style.cssText = 'display:flex;align-items:center;gap:6px';
      const rebuyToggle = document.createElement('input'); rebuyToggle.type='checkbox';
      try { rebuyToggle.checked = (localStorage.getItem('agent.autoRebuy') === '1'); } catch {}
      rebuyToggle.addEventListener('change', () => { try { localStorage.setItem('agent.autoRebuy', rebuyToggle.checked ? '1' : '0'); } catch {} });
      const rebuyBudget = document.createElement('input');
      rebuyBudget.type='number'; rebuyBudget.min='0'; rebuyBudget.step='0.001';
      rebuyBudget.placeholder = '0.50';
      try { const v = localStorage.getItem('agent.autoRebuy.budget'); if (v) rebuyBudget.value = v; } catch {}
      rebuyBudget.style.cssText='width:86px;text-align:center;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.16);color:#f4e6d3;border-radius:8px;padding:3px 6px;';
      rebuyBudget.addEventListener('change', () => { try { localStorage.setItem('agent.autoRebuy.budget', String(rebuyBudget.value||'')); } catch {} });
      // Place input to the left of the checkbox as requested
      rebuyWrap.appendChild(rebuyBudget); rebuyWrap.appendChild(rebuyToggle);

      panel.appendChild(title);
      panel.appendChild(mkCheck('agent.autoReady', 'Auto Ready'));
      panel.appendChild(row(rebuyLab, rebuyWrap));
      panel.appendChild(mkCheck('agent.autoClear', 'Auto Clear Seat'));

      // Only visible on on-chain tables
      panel.style.display = isOnchainTable ? '' : 'none';

      // Prefer near the wallet chip if present
      const host = document.getElementById('wallet-inline') || document.body || document.documentElement;
      host.appendChild(panel);

      // Position panel below wallet pill and any inline AA controls (avoid overlap)
      function positionAgentPanel() {
        try {
          let topPx = 64;
          const wallet = document.getElementById('wallet-inline');
          if (wallet) {
            const r = wallet.getBoundingClientRect();
            topPx = Math.max(topPx, (r.bottom + 8));
          }
          // Do not consider AA controls; anchor strictly to wallet pill to avoid jumps on session changes
          panel.style.top = `${Math.round(topPx)}px`;
        } catch {}
      }
      positionAgentPanel();
      try { window.addEventListener('resize', positionAgentPanel); } catch {}
      try { window.addEventListener('wallet:connected', positionAgentPanel); } catch {}
      try {  } catch {}
      return panel;
    } catch {}
    return null;
  })();

  function readAgentFlag(key) {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  }
  function readAgentBudgetMON() {
    try { const v = Number(localStorage.getItem('agent.autoRebuy.budget') || '0'); return Number.isFinite(v) && v > 0 ? v : 0; } catch { return 0; }
  }
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
  const formatDcmonBalance = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0.000';
    const fixed = num.toFixed(3);
    return fixed === '-0.000' ? '0.000' : fixed;
  };
  const formatChips = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    if (isOnchainTable) {
      const dcmon = n * chipValueDcmon;
      return formatDcmonBalance(dcmon);
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
  // Socket handling with path fallbacks
  if (!window.io) {
    console.error('Socket.IO missing');
    return;
  }
  let socket = null;
  const host = (location.hostname || '').toLowerCase();
  const socketPaths = (() => {
    const local = host === 'localhost' || host === '127.0.0.1';
    if (local) return ['/socket.io/'];
    return ['/poker.io/', '/socket.io/'];
  })();
  let activeSocketPath = null;
  let triedPaths = new Set();
  const pendingEmits = [];
  function flushPendingEmits() {
    if (!socket || !socket.connected) return;
    while (pendingEmits.length) {
      const { event, payload } = pendingEmits.shift();
      try { socket.emit(event, payload); } catch (err) { console.warn('[poker] pending emit failed', event, err); }
    }
  }
  function emitSocket(event, payload) {
    if (socket && socket.connected) {
      try {
        socket.emit(event, payload);
        return true;
      } catch (err) {
        console.warn('[poker] emit failed', event, err);
        return false;
      }
    }
    pendingEmits.push({ event, payload });
    return false;
  }
  let lastTable = null;
  mySeat = -1;
  let lastStage = null;
  let lastCommunity = [];
  let currentState = null;
  let currentTurnSeat = -1;
  let timerRaf = null;
  let joinPending = true;
  let connectionWarnTimer = null;
  let activeSocketIndex = -1;
  function clearConnectionWarning() {
    if (connectionWarnTimer) {
      clearTimeout(connectionWarnTimer);
      connectionWarnTimer = null;
    }
    updateConnectionBanner('', '');
  }
  function scheduleConnectionWarning(message = 'Connecting to poker server...') {
    clearConnectionWarning();
    connectionWarnTimer = setTimeout(() => {
      updateConnectionBanner(message, 'info');
    }, 600);
  }
  function maybeJoinTable() {
    if (!socket || !socket.connected) {
      joinPending = true;
      return;
    }
    emitSocket('join_table', { table: tableId });
    joinPending = false;
  }
  async function onSocketConnect() {
    clearConnectionWarning();
    updateConnectionBanner('', '');
    try {
      await ensureIdentify();
    } catch (err) {
      console.warn('[poker] identify on connect failed', err);
    }
    maybeJoinTable();
    flushPendingEmits();
  }
  function onSocketDisconnect(reason) {
    console.warn('[poker] socket disconnected', reason);
    joinPending = true;
    scheduleConnectionWarning(reason === 'io client disconnect' ? 'Reconnecting...' : 'Reconnecting to poker server...');
  }
  function onSocketError(err) {
    console.warn('[poker] socket error', err);
  }
  function attachSocketHandlers(newSocket, pathIndex) {
    if (!newSocket) return;
    if (socket && socket !== newSocket) {
      try {
        socket.off('connect', onSocketConnect);
        socket.off('disconnect', onSocketDisconnect);
        socket.off('table:update', handleTableUpdate);
        socket.off('poker:state', handlePokerState);
        socket.off('poker:private', handlePokerPrivate);
        socket.off('poker:hand', handlePokerHand);
        socket.off('error', onSocketError);
        socket.off('connect_error', onSocketError);
        socket.off('reconnect_error', onSocketError);
        socket.close();
      } catch {}
    }
    socket = newSocket;
    activeSocketIndex = pathIndex;
    socket.off('connect', onSocketConnect);
    socket.on('connect', onSocketConnect);
    socket.off('disconnect', onSocketDisconnect);
    socket.on('disconnect', onSocketDisconnect);
    socket.off('table:update', handleTableUpdate);
    socket.on('table:update', handleTableUpdate);
    socket.off('poker:state', handlePokerState);
    socket.on('poker:state', handlePokerState);
    socket.off('poker:private', handlePokerPrivate);
    socket.on('poker:private', handlePokerPrivate);
    socket.off('poker:hand', handlePokerHand);
    socket.on('poker:hand', handlePokerHand);
    socket.off('error', onSocketError);
    socket.on('error', onSocketError);
    socket.off('connect_error', onSocketError);
    socket.on('connect_error', onSocketError);
    socket.off('reconnect_error', onSocketError);
    socket.on('reconnect_error', onSocketError);
    if (socket.connected) {
      onSocketConnect();
    }
  }
  function connectSocket(startIndex = 0) {
    if (startIndex >= socketPaths.length) {
      clearConnectionWarning();
      updateConnectionBanner('Poker server unreachable. Please retry shortly.', 'error');
      return;
    }
    const path = socketPaths[startIndex];
    scheduleConnectionWarning();
    try {
      const candidate = window.io({
        path,
        transports: ['websocket', 'polling'],
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: 5
      });
      let connected = false;
      const handleConnect = () => {
        connected = true;
        candidate.off('connect_error', handleError);
        candidate.off('connect_timeout', handleError);
        attachSocketHandlers(candidate, startIndex);
      };
      const handleError = (err) => {
        if (connected) return;
        console.warn('[poker] socket path failed', path, err?.message || err);
        candidate.off('connect', handleConnect);
        candidate.off('connect_error', handleError);
        candidate.off('connect_timeout', handleError);
        try { candidate.close(); } catch {}
        connectSocket(startIndex + 1);
      };
      candidate.once('connect', handleConnect);
      candidate.once('connect_error', handleError);
      candidate.once('connect_timeout', handleError);
      candidate.connect();
    } catch (err) {
      console.warn('[poker] socket init failed on path', path, err);
      connectSocket(startIndex + 1);
    }
  }
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
        } else {
          try {
            const reqAccs = await provider.request({ method: 'eth_requestAccounts' }).catch((err) => {
              if (err && err.code === 4001) return [];
              throw err;
            });
            const reqFirst = Array.isArray(reqAccs) && reqAccs[0] ? String(reqAccs[0]) : '';
            if (isValidAddr(reqFirst)) {
              addr = reqFirst;
            }
          } catch (connectErr) {
            console.warn('Poker table: wallet connection prompt failed', connectErr);
          }
        }
        persistAddr(addr);
      } else {
        const fallback = storedAddr();
        if (isValidAddr(fallback)) {
          addr = fallback;
        }
      }
      if (isValidAddr(addr)) {
        emitSocket('identify', { addr });
        requestBankrollRefresh(addr);
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
  try {
    const count = burnPile.children.length;
    const el = document.createElement('img');
    el.className = 'card';
    el.alt = '';
    el.src = CARD_BACK;
    el.style.position = 'absolute';
    el.style.left = (count * 12) + 'px';
    el.style.top = (count * 4) + 'px';
    el.style.transform = 'rotate(' + (-10 + count * 5) + 'deg)';
    burnPile.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
  } catch {}
  }
  function updateCenter(st) {
    if (!centerBanner) return;
    if (!st) {
      if (centerBanner.dataset.mode === 'connection') return;
      centerBanner.classList.remove('show');
      centerBanner.style.display = 'none';
      centerBanner.dataset.mode = '';
      centerBanner.style.color = '';
      return;
    }
    const turnActor = Array.isArray(st.actors) && Number.isFinite(st.turnIndex)
      ? st.actors[st.turnIndex] : null;
    const turnSeat = seatIndexForActor(turnActor);
    let text = '';
    if (Number.isInteger(turnSeat) && turnSeat >= 0) {
      if (turnSeat === mySeat) {
        const toCall = Math.max(0, Number(st.toCall || 0));
        text = toCall > 0
          ? `Your turn — To call ${formatChips(toCall)}${isOnchainTable ? ' DCMon' : ''}`
          : 'Your turn — Check or bet';
      } else {
        const label = seatMeta[turnSeat]?.addr?.textContent || short(turnActor?.addr || '');
        text = label ? `Waiting on ${label}` : 'Waiting on player...';
      }
    }
    if (!text) {
      const parts = [];
      const stage = STAGE_LABEL[st.stage] || st.stage;
      if (stage) parts.push(stage.toUpperCase());
      if (Number.isFinite(st.pot)) parts.push(`Pot ${formatChips(st.pot)}${isOnchainTable ? ' DCMon' : ''}`);
      if (Number.isFinite(st.toCall) && st.toCall > 0) parts.push(`To Call ${formatChips(st.toCall)}${isOnchainTable ? ' DCMon' : ''}`);
      text = parts.join(' - ');
    }
    if (!text) {
      if (centerBanner.dataset.mode === 'connection') return;
      centerBanner.classList.remove('show');
      centerBanner.style.display = 'none';
      centerBanner.dataset.mode = '';
      centerBanner.style.color = '';
      return;
    }
    centerBanner.dataset.mode = 'game';
    centerBanner.style.color = '';
    centerBanner.textContent = text;
    centerBanner.style.display = 'block';
    requestAnimationFrame(() => centerBanner.classList.add('show'));
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
    let maxTop = canvasHeight - actionHeight - 48; // base clearance from canvas bottom
    const bottomMost = seatMeta.reduce((max, meta) => {
      if (!meta || !meta.seat) return max;
      const rect = meta.seat.getBoundingClientRect();
      return Math.max(max, rect.bottom - canvasRect.top);
    }, 0);
    // Derive seat height for dynamic clearance
    const sampleSeat = seatMeta.find(m => m && m.seat);
    let seatH = 140;
    try { seatH = Math.max(100, Math.round(sampleSeat.seat.getBoundingClientRect().height)); } catch {}
    const seatClear = Math.max(56, Math.round(seatH * 0.7));
    if (bottomMost > 0) {
      maxTop = Math.min(maxTop, bottomMost - actionHeight - seatClear);
    }
    const minTop = Math.max((boardRect.bottom - canvasRect.top) + 16, 12);
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
        emitSocket('poker:act', payload);
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
        alert(describeAdapterError('Wallet adapter unavailable. Refresh and try again.'));
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
        // Use DCMon directly (no chip conversion)
        const amountTotal = dcmonValue;
        if (!Number.isFinite(amountTotal) || amountTotal <= already) {
          alert('Bet must exceed your current contribution.');
          return;
        }
        payload.amount = amountTotal;
        deltaChips = Math.max(0, amountTotal - already);
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
      emitSocket('poker:act', payload);
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
  allInBtn.addEventListener('click', async () => {
    try {
      // Determine raise/bet action
      const state = currentState || tableSnapshot || null;
      const target = Number(state?.toCall || 0);
      const raiseAction = target > 0 ? 'raise' : 'bet';
      // Resolve wallet DCMon balance
      const br = getBankrollHelper();
      let dcWei = br?.getLastBalances?.()?.dcmonWei || null;
      if (!dcWei && typeof br?.refreshBalance === 'function') { try { br.refreshBalance(); dcWei = br?.getLastBalances?.()?.dcmonWei || null; } catch {} }
      let dcmonAmt = 0;
      if (dcWei && window.ethers?.utils?.formatEther) {
        dcmonAmt = Number.parseFloat(window.ethers.utils.formatEther(dcWei));
      }
      if (!Number.isFinite(dcmonAmt) || dcmonAmt <= 0) {
        alert('Insufficient DCMon to go all‑in.');
        return;
      }
      betInput.value = String(dcmonAmt);
      sendAction(raiseAction, betInput.value);
    } catch (e) { console.warn('All‑in failed', e); }
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
    // Prefill min amount in DCMon for the current state
    const minAmount = (() => {
      const limit = (tableSnapshot && tableSnapshot.limit) || 'NL';
      const sb = Number.isFinite(Number(chipValueDcmon)) && Number(chipValueDcmon) > 0 ? Number(chipValueDcmon) : 0.001;
      const bb = sb * 2;
      if (limit === 'FL') {
        const smallStreet = (state?.stage === 'preflop' || state?.stage === 'flop');
        const step = smallStreet ? sb : (2 * sb);
        if (toCall <= 0) return step; // opening bet
        const minTotal = toCall + step; // raise by one step
        return Math.max(0, minTotal);
      }
      // NL logic
      if (toCall <= 0) return bb; // open to at least big blind
      const minTotal = toCall + Math.max(0, toCall - already); // min raise total
      return Math.max(minTotal, toCall);
    })();
    betInput.value = String(Number.isFinite(minAmount) ? minAmount.toFixed(3) : '');
    betInput.placeholder = isOnchainTable ? 'Bet amount (DCMon)' : 'Bet amount';
    const needText = toCall > 0 ? `To call: ${formatChips(toCall)}${isOnchainTable ? ' DCMon' : ''}` : 'Check or bet';
    infoText.textContent = `Your turn - ${needText}`;
    actionBar.classList.remove('hidden');
    // Enhance placeholder/min suggestions and button enablement
    try {
      const min = Number(betInput.value) || 0;
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

  // Throttle helpers for agent auto-ops
  let lastAutoReadyAt = 0;
  let lastAutoRebuyAt = 0;
  const AUTO_READY_COOLDOWN_MS = 5000;
  const AUTO_REBUY_COOLDOWN_MS = 15000;

  async function maybeRunAgent(state) {
    if (!isOnchainTable) return;
    const nowMs = Date.now();
    const myIdx = mySeat;
    if (!Number.isInteger(myIdx) || myIdx < 0) return;

    // Auto Ready: if contract supports a ready() method and it’s our turn
    try {
      if (readAgentFlag('agent.autoReady') && currentTurnSeat === myIdx && nowMs - lastAutoReadyAt > AUTO_READY_COOLDOWN_MS) {
        lastAutoReadyAt = nowMs;
        try {
          const adapter = await getOnchainAdapter();
          if (adapter && adapter.contract && adapter.contract.interface && adapter.contract.interface.functions) {
            const hasReady = !!adapter.contract.interface.functions['ready()'];
            if (hasReady) {
              // Use AA call for readiness if available
              const ops = await (async () => { try { return await ensureAAOps(); } catch { return null; } })();
              if (ops && typeof ops.callWithDelegation === 'function') {
                try { await ops.callWithDelegation({ to: adapter.address, signature: 'ready()', args: [] }); } catch {}
              }
            }
          }
        } catch {}
      }
    } catch {}

    // Auto Rebuy: top up to budget if below
    try {
      if (readAgentFlag('agent.autoRebuy') && nowMs - lastAutoRebuyAt > AUTO_REBUY_COOLDOWN_MS) {
        const budgetMon = readAgentBudgetMON();
        if (budgetMon > 0) {
          const me = actorForSeat(state, myIdx) || {};
          const stackMon = Number(me.stack || 0);
          if (Number.isFinite(stackMon) && stackMon < budgetMon) {
            const needMon = Math.max(0, budgetMon - stackMon);
            const chips = dcmonToChips(needMon);
            if (Number.isFinite(chips) && chips > 0) {
              try {
                const adapter = await getOnchainAdapter();
                if (adapter && typeof adapter.contribute === 'function') {
                  await adapter.contribute(myIdx, chips);
                  lastAutoRebuyAt = Date.now();
                }
              } catch (e) { console.warn('Auto Rebuy failed', e); }
            }
          }
        }
      }
    } catch {}

    // Auto Clear Seat: if seat is blocked, try to clear
    try {
      if (readAgentFlag('agent.autoClear')) {
        const adapter = await getOnchainAdapter();
        if (adapter && typeof adapter.readSeatOwnerLower === 'function' && typeof adapter.ownerAddress === 'function') {
          const smartAddr = (await adapter.ownerAddress())?.toLowerCase?.() || '';
          const holder = await adapter.readSeatOwnerLower(myIdx).catch(() => '');
          if (holder && smartAddr && holder === smartAddr) {
            try { await autoClearSeat(myIdx); } catch {}
          }
        }
      }
    } catch {}
  }
  function updateSeatStates(state) {
    // reset
    seatMeta.forEach(meta => {
      meta.seat.classList.remove('folded','acted','winner');
      if (meta.marker) { meta.marker.style.display = 'none'; meta.marker.className = 'marker'; }
      if (meta.status) meta.status.textContent = '';
    });
    const actors = Array.isArray(state?.actors) ? state.actors : [];
    // markers
    try {
      const dIdx = Number.isFinite(state?.dealerSeatId) ? seatIndexForSeatId(state.dealerSeatId) : -1;
      const sbIdx = Number.isFinite(state?.sbIndex) && actors[state.sbIndex] ? seatIndexForActor(actors[state.sbIndex]) : -1;
      const bbIdx = Number.isFinite(state?.bbIndex) && actors[state.bbIndex] ? seatIndexForActor(actors[state.bbIndex]) : -1;
      if (dIdx >= 0 && seatMeta[dIdx]?.marker) { const m = seatMeta[dIdx].marker; m.textContent = 'D'; m.style.display = ''; requestAnimationFrame(() => { m.classList.add('show'); m.classList.add('pop'); }); }
      if (sbIdx >= 0 && seatMeta[sbIdx]?.marker) { const m = seatMeta[sbIdx].marker; m.textContent = 'SB'; m.classList.add('sb'); m.style.display = ''; requestAnimationFrame(() => { m.classList.add('show'); m.classList.add('pop'); }); }
      if (bbIdx >= 0 && seatMeta[bbIdx]?.marker) { const m = seatMeta[bbIdx].marker; m.textContent = 'BB'; m.classList.add('bb'); m.style.display = ''; requestAnimationFrame(() => { m.classList.add('show'); m.classList.add('pop'); }); }
    } catch {}
    // per-actor state
    actors.forEach(actor => {
      const idx = seatIndexForActor(actor);
      if (idx < 0) return;
      const meta = seatMeta[idx];
      if (actor.folded) meta.seat.classList.add('folded');
      if (actor.acted) meta.seat.classList.add('acted');
      // status line for last contrib vs toCall
      try {
        const already = Number(actor?.contrib || 0);
        const target = Number(state?.toCall || 0);
        if (meta.status) {
          let next = '';
          if (actor.folded) next = 'Fold';
          else if (already > 0 && target === 0) next = `Bet ${formatChips(already)}`;
          else if (already === target && target > 0 && actor.acted) next = `Call ${formatChips(target)}`;
          else if (already > target) next = `Raise to ${formatChips(already)}`;
          if (meta.status.textContent !== next) {
            meta.status.textContent = next;
            if (next) { meta.status.classList.remove('flash'); requestAnimationFrame(() => meta.status.classList.add('flash')); }
          }
        }
      } catch {}
      // For off-chain tables show chips in stack line
      if (!isOnchainTable) {
        const stackValue = Number(actor?.stack);
        if (Number.isFinite(stackValue)) {
          meta.stack.textContent = `Stack: ${formatChips(stackValue)} chips`;
        }
      }
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
    if (table?.simulated || table?.category === 'OFFCHAIN_NL') {
      if (isOnchainTable) {
        isOnchainTable = false;
        try { document.documentElement.setAttribute('data-table-mode', 'f2p'); } catch {}
      }
    } else {
      if (!isOnchainTable) {
        isOnchainTable = true;
        try { document.documentElement.setAttribute('data-table-mode', 'onchain'); } catch {}
      }
    }
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
      meta.seat.classList.toggle('empty-seat', !valid);
      const shortAddr = valid ? short(seatData.addr) : '';
      // Address line shows short address for all seats (hidden by CSS for your seat)
      meta.addr.textContent = shortAddr || '';
      // Name line precedence:
      // - Your seat: use local name (fallback to "Player")
      // - Off-chain others: use server-provided `x` profile if available
      // - Otherwise: blank
      try {
        const localNameStored = String(localStorage.getItem('poker.username') || '').trim();
        const localName = localNameStored || 'Player';
        if (isMe) {
          meta.nameEl.textContent = localName;
        } else if (!isOnchainTable && seatData && typeof seatData.x === 'string' && seatData.x.trim()) {
          meta.nameEl.textContent = seatData.x.trim().slice(0, 24);
        } else {
          meta.nameEl.textContent = '';
        }
        // Ensure visibility
        meta.nameEl.style.display = meta.nameEl.textContent ? '' : 'none';
      } catch {
        try {
          if (isMe) {
            const nm = String(localStorage.getItem('poker.username') || 'Player').trim() || 'Player';
            meta.nameEl.textContent = nm; meta.nameEl.style.display = '';
          } else { meta.nameEl.textContent = ''; meta.nameEl.style.display = 'none'; }
        } catch {}
      }
      if (!valid) {
        meta.stack.textContent = '';
        meta.nameEl.textContent = '';
      } else if (isOnchainTable) {
        // On-chain tables: show wallet DCMon for the connected player
        if (isMe) {
          try {
            const br = bankroll || getBankrollHelper();
            let dcWei = br?.getLastBalances?.()?.dcmonWei || null;
            if (!dcWei && typeof br?.refreshBalance === 'function') {
              try { br.refreshBalance(); dcWei = br?.getLastBalances?.()?.dcmonWei || null; } catch {}
            }
            if (dcWei && window.ethers?.utils?.formatEther) {
              const val = Number.parseFloat(window.ethers.utils.formatEther(dcWei));
              const display = Number.isFinite(val) ? formatDcmonBalance(val) : '--';
              meta.stack.textContent = `DCMon: ${display}`;
            } else {
              meta.stack.textContent = 'DCMon: --';
            }
          } catch {
            meta.stack.textContent = 'DCMon: --';
          }
        } else {
          meta.stack.textContent = '';
        }
      } else {
        const chips = Number(seatData && seatData.chips != null ? seatData.chips : 0);
        meta.stack.textContent = `Stack: ${formatChips(chips)} chips`;
      }
    if (!valid || seatAddr !== prevAddr) {
      meta.cards.innerHTML = '';
    }
      meta.btns.innerHTML = '';
      if (isMe) {
        requestBankrollRefresh(seatData.addr);
        const leaveBtn = document.createElement('button');
        leaveBtn.textContent = 'Leave';
        leaveBtn.addEventListener('click', async () => {
          if (leaveBtn.disabled) return;
          await ensureIdentify();
          if (isOnchainTable) {
      const adapter = await getOnchainAdapter();
      if (!adapter) {
        alert(describeAdapterError());
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
              if (err?.code === 'seat_owner_mismatch') {
                const owner = typeof err?.details?.seatOwner === 'string' ? err.details.seatOwner : '';
                const ownerShort = owner ? short(owner) : '';
                alert(ownerShort
                  ? `Seat control mismatch. Re-enable your MetaMask Smart Account (${ownerShort}) or connect the wallet that originally sat here.`
                  : 'Seat control mismatch. Re-enable your MetaMask Smart Account or connect the wallet that originally sat here.');
                return;
              }
              const reason = String(err?.error?.data?.message || err?.data?.message || err?.message || '').toLowerCase();
              if (reason.includes('seat owner')) {
                let latestOwner = '';
                try {
                  latestOwner = typeof adapter.readSeatOwnerLower === 'function' ? await adapter.readSeatOwnerLower(idx) : '';
                } catch (probeErr) {
                  console.warn('Poker table: seat owner probe post-failure failed', probeErr);
                }
                const ownerShort = latestOwner ? short(latestOwner) : '';
                alert(ownerShort
                  ? `Seat is owned by ${ownerShort}. Connect that wallet to leave.`
                  : 'Seat is owned by a different address. Connect the correct wallet to leave.');
                return;
              }
              alert('Leave transaction failed. Try again.');
              return;
            }
          }
          emitSocket('seat', { index: -1 });
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
  function handleTableUpdate(table) {
    clearConnectionWarning();
    updateConnectionBanner('', '');
    renderAllSeats(table);
  }
  function handlePokerState(state) {
    currentState = state;
    updateCenter(state);
    updateSeatStates(state);
    if (state?.stage !== lastStage) {
      if (state?.stage === 'preflop' && lastTable) {
        (lastTable.seats || []).forEach((seatData, idx) => {
          const saddr = seatData && String(seatData.addr || '').toLowerCase();
          const meAddr = (currentAddr() || '').toLowerCase();
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
    const actorsArr = Array.isArray(state?.actors) ? state.actors : [];
    const seatedCount = actorsArr.filter(a => isValidAddr(a?.addr)).length;
    const isLive = !!state?.stage && seatedCount >= 2 && Number.isFinite(state?.turnIndex);
    const turnActor = isLive ? actorsArr[state.turnIndex] : null;
    const turnSeat = seatIndexForActor(turnActor);
    currentTurnSeat = isLive ? turnSeat : -1;
    if (isLive) startTurnTimer(turnSeat); else clearTimers();
    updateActionBar(isLive ? turnSeat : -1, state);
    // Agent automations (non-blocking)
    try { maybeRunAgent(state); } catch {}
  }
  function handlePokerPrivate(msg) {
    const seatId = Number.isFinite(msg?.seatId) ? msg.seatId : seatIndexForAddr(msg?.addr);
    if (!Number.isInteger(seatId) || seatId < 0) return;
    if (mySeat < 0) mySeat = seatId;
    if (seatId !== mySeat) return;
    const cards = (msg.cards || []).slice(0, 2);
    setSeatCards(seatId, cards, { faceDown: false });
    // Ensure our seat shows our display name immediately
    try {
      const meta = seatMeta[seatId];
      if (meta && meta.nameEl) {
        const nm = String(localStorage.getItem('poker.username') || 'Player').trim() || 'Player';
        meta.nameEl.textContent = nm;
      }
    } catch {}
  }
  function handlePokerHand(msg) {
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
    // If not seated, ensure the action bar is hidden
    if (mySeat < 0) { hideActionBar(); showSitCta(true); try { canvas.classList.add('pre-seat'); } catch {} } else { showSitCta(false); try { canvas.classList.remove('pre-seat'); } catch {} }
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
        const combo = Array.isArray(w?.combo) ? w.combo.slice() : [];
        if (combo.length) {
          try {
            // Highlight board cards
            Array.from(board.children).forEach(el => {
              if (combo.includes(el.dataset.code)) el.classList.add('best');
            });
            // Highlight seat hole cards
            const meta = seatMeta[idx];
            if (meta && meta.cards) {
              Array.from(meta.cards.children).forEach(el => {
                if (combo.includes(el.dataset.code)) el.classList.add('best');
              });
            }
          } catch {}
        }
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
        try { Array.from(meta.cards.children).forEach(el => el.classList.remove('best')); } catch {}
        if (meta.timerFill) meta.timerFill.style.width = '0%';
      });
      try { Array.from(board.children).forEach(el => el.classList.remove('best')); } catch {}
      updateCenter(null);
    }, 10000);
  }
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
  connectSocket(0);
  renderAllSeats({
    id: tableId,
    seats: Array.from({ length: seatMeta.length }, () => null),
    capacity: seatMeta.length,
    simulated: !isOnchainTable,
    limit: isOnchainTable ? 'NL' : 'F2P'
  });
  ensureIdentify();
  window.addEventListener('focus', ensureIdentify);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePokerTable, { once: true });
} else {
  initializePokerTable();
}
















  async function pickPreferredSeatIndex() {
    const total = seats.length || 6;
    const order = (total >= 6) ? [3,2,4,1,5,0].slice(0,total) : Array.from({length: total}, (_,i)=>i);
    if (!isOnchainTable) return order[0] || 0;
    try {
      const adapter = await getOnchainAdapter();
      if (!adapter || typeof adapter.readSeatOwnerLower !== 'function') return order[0] || 0;
      for (const idx of order) {
        try { const owner = await adapter.readSeatOwnerLower(idx); if (!owner || owner === ZERO_ADDR) return idx; } catch {}
      }
    } catch {}
    return order[0] || 0;
  }
  


