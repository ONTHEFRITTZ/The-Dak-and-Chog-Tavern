// at the very top of aa/ui.js
const __MODE = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
const __IS_F2P = __MODE === 'f2p';

import { ensureMonadSelected, getAccounts, isSmartAccount, upgradeToSmartAccount } from './account.js';
import { MONAD, getPokerTableAddress } from './config.js';
import { presets as buildPresets, createDelegation, revokeDelegation, loadDelegation, isDelegationActive, nowSec } from './delegation.js';

function short(a){ return a && a.length>10 ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); }

function ensureContainer() {
  if (__IS_F2P) {
    // Return a detached element so rest of code doesn't blow up, but nothing mounts.
    const ghost = document.createElement('div');
    return ghost;
  }
  let c = document.getElementById('aa-controls');
  if (c) return c;
  const host = document.getElementById('wallet-inline') || document.body;
  c = document.createElement('div');
  c.id = 'aa-controls';
  c.style.cssText = 'display:flex;gap:8px;align-items:center;margin-left:8px;';
  host.appendChild(c);
  return c;
}


function renderStatus({ addr, smart, active, end, chainOk }) {
  const c = ensureContainer();
  let pill = c.querySelector('.aa-pill');
  if (!pill) { pill = document.createElement('span'); pill.className = 'aa-pill'; pill.style.cssText='background:rgba(0,0,0,0.5);color:#fff;padding:4px 8px;border-radius:999px;font-weight:700;'; c.appendChild(pill); }
  const endStr = active ? ` • until ${new Date(end*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : '';
  const net = chainOk ? '' : ' • (wrong net)';
  pill.textContent = `${smart?'Smart Acct':'EOA'} • ${active?'Delegation ON':'Delegation OFF'}${endStr}${net}`;
}

async function renderButtons({ addr }) {
  const c = ensureContainer();
  c.querySelectorAll('button.aa-btn, select.aa-btn').forEach(b=>b.remove());

  const bUpgrade = document.createElement('button');
  bUpgrade.className = 'aa-btn';
  bUpgrade.textContent = 'Upgrade to Smart Account';
  bUpgrade.onclick = async () => { const ok = await upgradeToSmartAccount(addr); if (ok) hydrate(); };
  c.appendChild(bUpgrade);

  const dd = document.createElement('select');
  dd.className = 'aa-btn';
  dd.style.cssText = 'padding:6px 8px;border-radius:8px;';
  let presetMap = null;
  try {
    presetMap = await buildPresets();
  } catch (err) {
    console.warn('Delegation presets unavailable', err);
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Delegation unavailable';
    dd.appendChild(opt);
    dd.disabled = true;
  }
  if (presetMap) {
    const items = [
      { key:'playOnly', label: presetMap.playOnly?.label || 'Play only' },
      { key:'playPlusTableOps', label: presetMap.playPlusTableOps?.label || 'Play + table ops' },
    ];
    items.forEach(it => {
      const o = document.createElement('option');
      o.value = it.key;
      o.textContent = it.label;
      dd.appendChild(o);
    });
  }
  c.appendChild(dd);

  const bStart = document.createElement('button');
  bStart.className = 'aa-btn';
  bStart.textContent = 'Start Delegated Session';
  bStart.onclick = async () => {
    try {
      const all = await buildPresets();
      const selected = dd.value === 'playPlusTableOps' ? all.playPlusTableOps : all.playOnly;
      const sess = await createDelegation({ address: addr, preset: selected });
      if (sess) hydrate();
    } catch (err) {
      console.error('Delegation creation failed', err);
      alert(err?.message || 'Delegation failed. Check console for details.');
    }
  };
  c.appendChild(bStart);

  const bRevoke = document.createElement('button');
  bRevoke.className = 'aa-btn';
  bRevoke.textContent = 'Revoke';
  bRevoke.onclick = async () => { await revokeDelegation(); hydrate(); };
  c.appendChild(bRevoke);
}

async function hydrate(){
  if (__IS_F2P) return;  // Completely skip on free tables
  const okNet = await ensureMonadSelected();
  const accs = await getAccounts();
  const addr = (accs[0] || '').toLowerCase();
  const smart = await isSmartAccount(addr);
  const d = loadDelegation();
  renderStatus({ addr, smart, active: !!d && nowSec() < d.end, end: d?.end || 0, chainOk: okNet });
  await renderButtons({ addr });
  // optional: display resolved HoldemPoker address for debug
  // const target = await getPokerTableAddress(window?.ethereum);
  // console.debug('HoldemPoker target:', target);
}

window.addEventListener('load', hydrate);
window.addEventListener('wallet:connected', hydrate);
