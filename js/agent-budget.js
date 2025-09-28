// Minimal UI + policy for agent budgets (optional, default OFF)
// Theme-aligned with your soft panels. No external deps.

(function(){
  const LS_KEY = 'agentCfg.v1';
  const DEF = {
    enabled: false,           // default OFF so you can rely on rake. flip on per-user.
    autoCallMon: 0.01,        // not enforced here; just displayed, your auto-logic can read it
    maxPerHandMon: 0.03,      // sensible guardrail
    sessionBudgetMon: 0.30,   // daily-ish soft ceiling
    sessionSpentWei: '0',     // running tally in wei
  };

  // State (runtime only)
  let handSpentWei = '0';

  function loadCfg(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { ...DEF };
      const cfg = JSON.parse(raw);
      return { ...DEF, ...cfg };
    } catch { return { ...DEF }; }
  }
  function saveCfg(cfg){
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch {}
  }

  function monToWei(x){
    // MON uses 18 decimals (EVM native)
    const s = String(x||'0').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return '0';
    const [a,b=''] = s.split('.');
    const frac = (b + '000000000000000000').slice(0,18);
    return BigInt(a + frac).toString();
  }
  function weiToMonStr(wei){
    try{
      const bi = BigInt(String(wei||'0'));
      const s = bi.toString().padStart(19,'0');
      const int = s.slice(0, -18) || '0';
      const frac = s.slice(-18).replace(/0+$/,'');
      return frac ? `${int}.${frac}` : int;
    }catch{ return '0'; }
  }

  let cfg = loadCfg();

  // UI
  function el(tag, cls, text){
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text!=null) e.textContent = text;
    return e;
  }

  function renderPanel(){
    let wrap = document.getElementById('agent-panel');
    if (!wrap){
      wrap = el('div');
      wrap.id = 'agent-panel';
      wrap.style.cssText = [
        'position:fixed','left:12px','bottom:12px','z-index:9500',
        'background: var(--panel-bg-soft)','border:1px solid rgba(255,255,255,0.12)',
        'border-radius:14px','padding:10px 12px','color:#f4e6d3',
        'box-shadow:0 12px 32px rgba(0,0,0,0.35)','min-width:220px'
      ].join(';');
      document.body.appendChild(wrap);
    }
    wrap.innerHTML = '';

    const title = el('div', null, 'Agent');
    title.style.cssText = 'font-weight:700; margin-bottom:6px;';

    const row = (label, inputEl) => {
      const r = el('div');
      r.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; margin:6px 0;';
      const l = el('div', null, label);
      l.style.cssText = 'font-size:12px;';
      r.appendChild(l);
      r.appendChild(inputEl);
      return r;
    };

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = !!cfg.enabled;
    enabled.onchange = () => { cfg.enabled = enabled.checked; saveCfg(cfg); };

    const ac = document.createElement('input');
    ac.type = 'number'; ac.step='0.001'; ac.min='0'; ac.value = String(cfg.autoCallMon);
    ac.style.cssText='width:90px; text-align:right;';
    ac.onchange = ()=> { cfg.autoCallMon = Math.max(0, Number(ac.value)||0); saveCfg(cfg); };

    const mph = document.createElement('input');
    mph.type = 'number'; mph.step='0.001'; mph.min='0'; mph.value = String(cfg.maxPerHandMon);
    mph.style.cssText='width:90px; text-align:right;';
    mph.onchange = ()=> { cfg.maxPerHandMon = Math.max(0, Number(mph.value)||0); saveCfg(cfg); };

    const sb = document.createElement('input');
    sb.type = 'number'; sb.step='0.001'; sb.min='0'; sb.value = String(cfg.sessionBudgetMon);
    sb.style.cssText='width:90px; text-align:right;';
    sb.onchange = ()=> { cfg.sessionBudgetMon = Math.max(0, Number(sb.value)||0); saveCfg(cfg); };

    const spent = el('div', null, '0');
    spent.style.cssText = 'font-size:12px; opacity:0.9;';

    const reset = el('button', null, 'Reset session');
    reset.style.cssText='padding:4px 8px; font-size:12px; border-radius:8px; margin-left:6px;';
    reset.onclick = ()=>{
      cfg.sessionSpentWei = '0';
      handSpentWei = '0';
      saveCfg(cfg);
      refreshCounters();
    };

    function refreshCounters(){
      const hand = weiToMonStr(handSpentWei);
      const sess = weiToMonStr(cfg.sessionSpentWei);
      spent.textContent = `Spent — Hand: ${hand} • Session: ${sess}`;
    }

    wrap.appendChild(title);
    wrap.appendChild(row('Enable agent', enabled));
    wrap.appendChild(row('Auto-call ≤ (MON)', ac));
    wrap.appendChild(row('Max per hand (MON)', mph));
    wrap.appendChild(row('Session budget (MON)', sb));

    const meterRow = el('div');
    meterRow.style.cssText='display:flex; align-items:center; justify-content:space-between; gap:6px; margin-top:6px;';
    meterRow.appendChild(spent);
    meterRow.appendChild(reset);
    wrap.appendChild(meterRow);

    refreshCounters();
  }

  renderPanel();

  // Hand reset from table.js broadcast
  window.addEventListener('poker:handstart', ()=>{
    handSpentWei = '0';
    // keep UI reflecting fresh hand
    const _ = loadCfg(); // no-op, but ensures LS consistency
    setTimeout(()=>renderPanel(), 0);
  });

  // Public API for your future auto-action code
  function isEnabled(){ return !!loadCfg().enabled; }

  function canSpend(weiStr){
    const now = loadCfg();
    if (!now.enabled) return false;

    const want = BigInt(String(weiStr||'0'));
    const hp  = BigInt(monToWei(now.maxPerHandMon));
    const sb  = BigInt(monToWei(now.sessionBudgetMon));
    const spentSess = BigInt(now.sessionSpentWei || '0');
    const spentHand = BigInt(handSpentWei || '0');

    if (hp > 0n && (spentHand + want) > hp) return false;
    if (sb > 0n && (spentSess + want) > sb) return false;
    return true;
  }

  function noteSpend(weiStr){
    const want = BigInt(String(weiStr||'0'));
    handSpentWei = (BigInt(handSpentWei||'0') + want).toString();
    const now = loadCfg();
    const sess = (BigInt(now.sessionSpentWei||'0') + want).toString();
    now.sessionSpentWei = sess;
    saveCfg(now);
    // refresh numbers visible
    renderPanel();
  }

  // Expose read-only helpers for the rest of your app/agent
  function getConfig(){ return loadCfg(); }

  try {
    window.AgentBudget = { isEnabled, canSpend, noteSpend, getConfig };
  } catch {}

})();
