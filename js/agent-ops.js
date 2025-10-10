// agent-ops.js — UI panel for sponsor toggle, session (delegation) grant/revoke, budget
import { AA, defaultAllowlist } from './aaClient.js';

(function () {
  const htmlMode = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
  if (htmlMode !== 'onchain') return; // never show on F2P/off-chain

  let root = document.getElementById('aa-panel');
  if (!root) {
    root = document.createElement('div');
    root.id = 'aa-panel';
    root.style.cssText = [
      'position:fixed','right:12px','bottom:12px','z-index:12050',
      'background:rgba(26,14,8,0.9)','border:1px solid rgba(255,255,255,0.12)',
      'border-radius:14px','padding:10px 12px','color:#f4e6d3',
      'box-shadow:0 18px 40px rgba(0,0,0,0.45)','min-width:220px'
    ].join(';');
    document.body.appendChild(root);
  }

  function row(label, el) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; margin:6px 0;';
    const lab = document.createElement('div'); lab.textContent = label; lab.style.fontWeight = '700';
    wrap.appendChild(lab); wrap.appendChild(el);
    return wrap;
  }

  function btn(txt, id) {
    const b = document.createElement('button');
    b.textContent = txt;
    b.id = id || '';
    b.style.cssText = 'background:#9200fa;color:#fff;border:none;border-radius:10px;padding:6px 10px;cursor:pointer;';
    b.onmouseenter = () => (b.style.background = '#7800cd');
    b.onmouseleave = () => (b.style.background = '#9200fa');
    return b;
  }

  function pill(txt) {
    const el = document.createElement('span');
    el.textContent = txt;
    el.style.cssText = 'background:rgba(0,0,0,0.6); padding:3px 8px; border-radius:999px; font-size:12px;';
    return el;
  }

  // Build skeleton UI
  const head = document.createElement('div');
  head.textContent = 'Smart Account';
  head.style.cssText = 'font-weight:800; margin-bottom:6px;';
  root.appendChild(head);

  const sponsorToggle = document.createElement('input');
  sponsorToggle.type = 'checkbox';
  sponsorToggle.id = 'aa-sponsor-toggle';

  const sponsorRow = document.createElement('div');
  sponsorRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';
  const sponsorLabel = document.createElement('label'); sponsorLabel.textContent = 'Gas Sponsor'; sponsorLabel.htmlFor = sponsorToggle.id; sponsorLabel.style.fontWeight = '700';
  sponsorRow.appendChild(sponsorLabel); sponsorRow.appendChild(sponsorToggle);
  root.appendChild(sponsorRow);

  // Budget
  const budgetField = document.createElement('input');
  budgetField.type = 'number'; budgetField.min = '0'; budgetField.step = '0.001'; budgetField.value = (localStorage.getItem('aa:budget')||'0');
  budgetField.style.cssText = 'width:92px; text-align:center; background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.16); color:#f4e6d3; border-radius:8px; padding:4px 6px;';
  root.appendChild(row('Budget (DCMon)', budgetField));

  const grants = document.createElement('div');
  grants.style.cssText = 'display:flex; gap:8px; align-items:center; justify-content:flex-end;';
  const grantBtn = btn('Grant Session', 'aa-grant');
  const revokeBtn = btn('Revoke', 'aa-revoke');
  revokeBtn.style.background = '#444';
  revokeBtn.onmouseenter = () => (revokeBtn.style.background = '#333');
  revokeBtn.onmouseleave = () => (revokeBtn.style.background = '#444');
  grants.appendChild(grantBtn); grants.appendChild(revokeBtn);
  root.appendChild(grants);

  const stateLine = document.createElement('div');
  stateLine.style.cssText = 'font-size:12px; opacity:.95; margin-top:6px;';
  root.appendChild(stateLine);

  // Live status pill used by sponsor indicator too
  const sponsorPill = pill('Gas: Off');
  sponsorPill.id = 'aa-sponsor-pill';
  sponsorPill.style.marginTop = '6px';
  root.appendChild(sponsorPill);

  // Init client
  (async () => {
    try {
      await AA.init();
      sponsorToggle.checked = AA.sponsored;
      updatePill();

      budgetField.addEventListener('change', () => {
        const v = Number(budgetField.value || 0);
        AA.setBudget(v);
        localStorage.setItem('aa:budget', String(v||0));
        stateLine.textContent = `Budget set to ${v.toFixed(3)} DCMon`;
      });

      sponsorToggle.addEventListener('change', () => {
        AA.setSponsored(sponsorToggle.checked);
        stateLine.textContent = sponsorToggle.checked ? 'Gas sponsorship: ON' : 'Gas sponsorship: OFF';
        updatePill();
      });

      grantBtn.addEventListener('click', async () => {
        const allow = await defaultAllowlist();
        const cap = Number(localStorage.getItem('aa:budget') || '0') || 0.05;
        const sess = await AA.grantSessionKey({ minutes: 120, monCap: cap, allowlist: allow });
        stateLine.textContent = `Session granted (cap ${cap} DCMon, expires in ~2h)`;
        updatePill();
      });

      revokeBtn.addEventListener('click', () => {
        AA.revokeSession();
        stateLine.textContent = 'Session revoked';
        updatePill();
      });

      window.__aa = AA; // handy for quick console testing
    } catch (e) {
      stateLine.textContent = 'Smart Account unavailable';
      root.style.opacity = '.6';
    }
  })();

  function updatePill() {
    sponsorPill.textContent = 'Gas: ' + (AA.sponsored ? 'Sponsored' : 'Off');
    // Also ping the global pill listener (keeps the tiny banner in sync)
    window.dispatchEvent(new CustomEvent('aa:sponsored', { detail: { active: AA.sponsored } }));
  }
})();
