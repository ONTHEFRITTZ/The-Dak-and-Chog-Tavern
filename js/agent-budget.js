import { AA } from './aaClient.js';

(() => {
  const mode = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
  if (mode !== 'onchain') return;

  let pill = document.getElementById('aa-budget-indicator');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'aa-budget-indicator';
    pill.style.cssText = [
      'position:fixed','right:12px','bottom:92px','z-index:12050',
      'display:none','align-items:center','gap:6px',
      'padding:6px 12px','border-radius:12px','font-size:12px',
      'background:rgba(26,14,8,0.92)','color:#f4e6d3',
      'box-shadow:0 12px 28px rgba(0,0,0,0.45)','font-weight:700'
    ].join(';');
    document.body.appendChild(pill);
  }

  const ONE_MON = 1_000_000_000_000_000_000n;
  let initComplete = false;
  let initFailed = false;
  let initPromise = null;

  function parseWei(value) {
    if (value === null || value === undefined) return 0n;
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return 0n;
      return BigInt(Math.floor(value));
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return 0n;
      if (/^0x/i.test(trimmed)) {
        try { return BigInt(trimmed); } catch { return 0n; }
      }
      if (/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
        const [whole, frac = ''] = trimmed.split('.');
        let wei = BigInt(whole || '0') * ONE_MON;
        if (frac) {
          const padded = (frac + '000000000000000000').slice(0, 18);
          try { wei += BigInt(padded || '0'); } catch {}
        }
        return wei;
      }
      try { return BigInt(trimmed); } catch { return 0n; }
    }
    if (typeof value === 'object') {
      try {
        if (value && typeof value._hex === 'string') return parseWei(value._hex);
        if (typeof value.toString === 'function') return parseWei(value.toString());
      } catch {}
    }
    return 0n;
  }

  function formatDcmon(wei) {
    let v = typeof wei === 'bigint' ? wei : parseWei(wei);
    const neg = v < 0n;
    if (neg) v = -v;
    const whole = v / ONE_MON;
    const remainder = v % ONE_MON;
    let frac = '';
    if (remainder !== 0n) {
      const scaled = (remainder * 10000n) / ONE_MON; // four decimal places
      let str = scaled.toString().padStart(4, '0');
      str = str.replace(/0+$/, '');
      if (str.length) frac = '.' + str;
    }
    let out = whole.toString();
    if (frac) {
      out += frac;
    } else if (remainder !== 0n && whole === 0n) {
      out = '<0.0001';
    }
    if (neg) out = '-' + out;
    return out;
  }

  function sessionActive(sess) {
    if (!sess) return false;
    if (!sess.exp) return true;
    return Number(sess.exp) > Math.floor(Date.now() / 1000);
  }

  async function ensureInit() {
    if (initComplete) return true;
    if (initFailed) return false;
    if (!initPromise) {
      initPromise = AA.init().then(() => {
        initComplete = true;
        return true;
      }).catch((err) => {
        console.warn('[agent-budget] AA init failed', err);
        initFailed = true;
        return false;
      });
    }
    return initPromise;
  }

  async function update() {
    pill.style.display = 'inline-flex';
    const ready = await ensureInit();
    if (!ready) {
      pill.textContent = 'Smart account unavailable';
      pill.style.opacity = '0.65';
      return;
    }
    pill.style.opacity = '1';

    const sess = AA.session;
    const active = sessionActive(sess);
    const spent = active ? parseWei(sess?.spentWei || '0x0') : 0n;
    const limit = active ? parseWei(sess?.spendLimitWei || '0x0') : 0n;
    let cap = AA.budgetWei && AA.budgetWei > 0n ? AA.budgetWei : 0n;
    if (cap === 0n && limit > 0n) cap = limit;

    const spentStr = formatDcmon(spent);
    const capStr = cap > 0n ? formatDcmon(cap) : 'Infinity';
    let pctText = '';
    if (cap > 0n) {
      const pct100 = Number((spent * 10000n) / cap) / 100; // two decimals
      pctText = ` (${pct100.toFixed(2)}%)`;
    }

    const parts = [
      `Session ${active ? 'On' : 'Off'}`,
      `Gas ${AA.sponsored ? 'On' : 'Off'}`,
      cap === 0n && spent === 0n
        ? 'Budget unlimited'
        : `Budget ${spentStr}/${capStr} DCMon${pctText}`
    ];

    pill.textContent = parts.join(' • ');
  }

  update();
  window.addEventListener('aa:sponsored', update);
  window.addEventListener('aa:session', update);
  window.addEventListener('aa:budget', update);
  window.addEventListener('focus', update);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
})();
