// at the very top of aa/ui.js
const __MODE = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
const __IS_F2P = __MODE === 'f2p';

import { ensureMonadSelected, getAccounts, isSmartAccount, upgradeToSmartAccount } from './account.js';
import { MONAD } from './config.js';
import { AA, initAA, getSmartAccountAddress } from '../aaClient.js';
import { presets as buildPresets, createDelegation, revokeDelegation, loadDelegation, nowSec } from './delegation.js';

function short(addr) {
  return addr && addr.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : (addr || '');
}

function formatRelativeExpiry(tsSec) {
  if (!tsSec) return null;
  const delta = tsSec - nowSec();
  if (delta <= 0) return 'expired';
  if (delta < 60) return `${delta}s`;
  const mins = Math.floor(delta / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function ensureContainer() {
  if (__IS_F2P) {
    return document.createElement('div');
  }
  let c = document.getElementById('aa-controls');
  const preferredHost = document.getElementById('wi-aa-panel-host');
  const host = preferredHost || document.getElementById('wallet-inline') || document.body;
  if (!c) {
    c = document.createElement('div');
    c.id = 'aa-controls';
    c.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'align-items:flex-start',
      'margin-left:8px',
      'max-width:360px',
      'font-size:12px',
      'color:#f5f5f5'
    ].join(';');
    host.appendChild(c);
  } else if (host && c.parentElement !== host) {
    host.appendChild(c);
  }
  if (preferredHost) {
    c.style.marginLeft = '0';
    c.style.width = '100%';
    c.style.maxWidth = '100%';
  } else {
    c.style.marginLeft = '8px';
    c.style.maxWidth = '360px';
    c.style.width = '';
  }
  return c;
}

function ensureStatusBox() {
  const c = ensureContainer();
  let box = c.querySelector('.aa-status');
  if (!box) {
    box = document.createElement('div');
    box.className = 'aa-status';
    box.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:6px',
      'align-items:center',
      'background:rgba(0,0,0,0.45)',
      'padding:6px 10px',
      'border-radius:10px',
      'font-weight:600'
    ].join(';');
    c.appendChild(box);
  }
  return box;
}

function ensureDelegationBox() {
  const c = ensureContainer();
  let box = c.querySelector('#aa-delegation-info');
  if (!box) {
    box = document.createElement('div');
    box.id = 'aa-delegation-info';
    box.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:2px',
      'padding:6px 8px',
      'border-radius:8px',
      'background:rgba(0,0,0,0.35)',
      'color:#f5f5f5'
    ].join(';');
    c.appendChild(box);
  }
  return box;
}

function ensureActionsBox() {
  const c = ensureContainer();
  let box = c.querySelector('#aa-actions');
  if (!box) {
    box = document.createElement('div');
    box.id = 'aa-actions';
    box.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:6px',
      'align-items:center'
    ].join(';');
    c.appendChild(box);
  }
  return box;
}

function setBusy(button, busy, labelWhenBusy = 'Working...') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.label) {
      button.dataset.label = button.textContent || button.value || '';
    }
    button.disabled = true;
    button.textContent = labelWhenBusy;
  } else {
    const original = button.dataset.label || button.textContent;
    button.disabled = false;
    button.textContent = original;
  }
}

function renderStatus(state) {
  const { addr, smartAddress, smartType, delegationActive, delegation, chainOk, bundlerReady, sponsored } = state;
  const box = ensureStatusBox();
  const statusBits = [];

  if (!addr) {
    statusBits.push('Wallet: not connected');
  } else {
    statusBits.push(`Wallet: ${short(addr)}`);
  }

  if (smartType === 'delegation-toolkit') {
    statusBits.push(`Smart Account: ${short(smartAddress)}`);
  } else if (smartType === 'fallback') {
    statusBits.push('Smart Account: fallback (EOA)');
  } else if (smartType === 'legacy-smart') {
    statusBits.push(`Smart Account: legacy (${short(smartAddress)})`);
  } else {
    statusBits.push(`Smart Account: ${short(smartAddress || addr || '-')}`);
  }

  const netLabel = chainOk ? `Network: ${MONAD.name || 'Monad Testnet'}` : 'Network: switch to Monad';
  statusBits.push(netLabel);

  const delegationLabel = delegationActive
    ? `Delegation: active${delegation?.preset ? ` (${delegation.preset})` : ''}`
    : (delegation ? 'Delegation: expired' : 'Delegation: none');
  statusBits.push(delegationLabel);

  statusBits.push(`Bundler: ${bundlerReady ? 'ready' : 'fallback'}`);
  if (sponsored != null) {
    statusBits.push(`Gas: ${sponsored ? 'sponsored' : 'self-pay'}`);
  }

  box.textContent = statusBits.join(' | ');
}

function renderDelegationInfo(state) {
  const { delegation, delegationActive, smartAddress } = state;
  const box = ensureDelegationBox();
  box.innerHTML = '';
  if (!delegation) {
    box.textContent = 'Delegation: none configured';
    return;
  }

  const header = document.createElement('div');
  header.textContent = delegationActive ? 'Delegation is active' : 'Delegation saved (inactive)';
  header.style.cssText = 'font-weight:700;';
  box.appendChild(header);

  const rows = [];
  rows.push(['Preset', delegation.preset || 'custom']);
  rows.push(['Delegator', short(delegation.from || smartAddress || '')]);
  rows.push(['Delegate', short(delegation.to || '')]);
  if (delegation.chainId) {
    rows.push(['Chain', String(delegation.chainId)]);
  }
  if (delegation.permissionContext) {
    try {
      const grants = delegation.permissionContext.length;
      rows.push(['Permission sets', String(grants)]);
    } catch {}
  }
  if (delegation.delegation?.caveats?.length) {
    rows.push(['Caveats', String(delegation.delegation.caveats.length)]);
  }
  if (delegation.end) {
    const readable = new Date(delegation.end * 1000).toLocaleString();
    const rel = formatRelativeExpiry(delegation.end);
    rows.push(['Expires', `${readable}${rel ? ` (${rel})` : ''}`]);
  }

  rows.forEach(([label, value]) => {
    const line = document.createElement('div');
    line.innerHTML = `<strong>${label}:</strong> ${value}`;
    box.appendChild(line);
  });
}

async function renderButtons(state, presetMap) {
  const { addr, chainOk, smartType, delegationActive } = state;
  const actions = ensureActionsBox();
  actions.innerHTML = '';

  const disabledColor = 'rgba(255,255,255,0.35)';

  if (!addr) {
    const note = document.createElement('span');
    note.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.8);';
    note.textContent = 'Connect MetaMask to enable smart account controls.';
    actions.appendChild(note);
    return;
  }

  const makeButton = (label) => {
    const btn = document.createElement('button');
    btn.className = 'aa-btn';
    btn.style.cssText = [
      'padding:6px 10px',
      'border-radius:8px',
      'border:none',
      'background:#2d6aee',
      'color:#fff',
      'font-weight:600',
      'cursor:pointer'
    ].join(';');
    btn.textContent = label;
    btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.background = '#2f7bff'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#2d6aee'; });
    return btn;
  };

  const safeRun = (btn, fn, labelBusy) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      setBusy(btn, true, labelBusy);
      try {
        await fn();
      } catch (err) {
        console.error('[aa/ui] action failed', err);
        alert(err?.message || 'Operation failed. See console for details.');
      } finally {
        setBusy(btn, false);
        await hydrate();
      }
    });
  };

  if (!chainOk) {
    const switchBtn = makeButton('Switch to Monad');
    safeRun(switchBtn, async () => {
      const ok = await ensureMonadSelected({ requestSwitch: true });
      if (!ok) {
        throw new Error('MetaMask did not switch to Monad Testnet.');
      }
    }, 'Switching...');
    actions.appendChild(switchBtn);
  }

  const upgradeBtn = makeButton(
    smartType === 'delegation-toolkit' ? 'Smart Account Ready' : 'Initialize Smart Account'
  );
  if (smartType === 'delegation-toolkit') {
    upgradeBtn.disabled = true;
    upgradeBtn.style.background = 'rgba(0,0,0,0.45)';
    upgradeBtn.style.color = disabledColor;
  } else {
    safeRun(upgradeBtn, async () => {
      const ok = await upgradeToSmartAccount();
      if (!ok) {
        throw new Error('Unable to initialize MetaMask smart account.');
      }
    }, 'Initializing...');
  }
  actions.appendChild(upgradeBtn);

  let presets = presetMap;
  if (!presets && smartType === 'delegation-toolkit' && chainOk) {
    try {
      presets = await buildPresets();
    } catch (err) {
      console.warn('[aa/ui] preset load failed', err);
    }
  }

  const delegationAvailable = smartType === 'delegation-toolkit' && chainOk && !!presets;

  const select = document.createElement('select');
  select.className = 'aa-btn';
  select.style.cssText = [
    'padding:6px 8px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.2)',
    'background:rgba(0,0,0,0.3)',
    'color:#fff'
  ].join(';');

  if (!delegationAvailable) {
    select.disabled = true;
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = chainOk ? 'Delegation unavailable' : 'Select Monad first';
    select.appendChild(opt);
  } else {
    const entries = [
      { key: 'playOnly', label: presets.playOnly?.label || 'Poker gameplay only' },
      { key: 'playPlusTableOps', label: presets.playPlusTableOps?.label || 'Poker + table ops' }
    ];
    entries.forEach((entry) => {
      const opt = document.createElement('option');
      opt.value = entry.key;
      opt.textContent = entry.label;
      select.appendChild(opt);
    });
  }
  actions.appendChild(select);

  const startBtn = makeButton('Issue Delegation');
  if (!delegationAvailable) {
    startBtn.disabled = true;
    startBtn.style.background = 'rgba(0,0,0,0.45)';
    startBtn.style.color = disabledColor;
  } else {
    safeRun(startBtn, async () => {
      const presetsMapFresh = presets || await buildPresets();
      const chosen = select.value === 'playPlusTableOps'
        ? presetsMapFresh.playPlusTableOps
        : presetsMapFresh.playOnly;
      if (!chosen) throw new Error('Preset not found');
      await createDelegation({ address: addr, preset: chosen });
    }, 'Issuing...');
  }
  actions.appendChild(startBtn);

  const revokeBtn = makeButton('Revoke Delegation');
  if (!delegationAvailable || !delegationActive) {
    revokeBtn.disabled = !delegationAvailable;
    revokeBtn.style.background = 'rgba(0,0,0,0.45)';
    revokeBtn.style.color = disabledColor;
    if (delegationActive) {
      revokeBtn.disabled = false;
      revokeBtn.style.background = '#b53f3f';
      revokeBtn.addEventListener('mouseenter', () => { if (!revokeBtn.disabled) revokeBtn.style.background = '#c95050'; });
      revokeBtn.addEventListener('mouseleave', () => { revokeBtn.style.background = '#b53f3f'; });
      revokeBtn.addEventListener('click', async () => {
        if (revokeBtn.disabled) return;
        setBusy(revokeBtn, true, 'Revoking...');
        try {
          await revokeDelegation();
        } catch (err) {
          console.error('[aa/ui] revoke failed', err);
          alert(err?.message || 'Failed to revoke delegation.');
        } finally {
          setBusy(revokeBtn, false);
          await hydrate();
        }
      });
    }
  } else {
    revokeBtn.style.background = '#b53f3f';
    revokeBtn.addEventListener('mouseenter', () => { if (!revokeBtn.disabled) revokeBtn.style.background = '#c95050'; });
    revokeBtn.addEventListener('mouseleave', () => { revokeBtn.style.background = '#b53f3f'; });
    safeRun(revokeBtn, async () => {
      await revokeDelegation();
    }, 'Revoking...');
  }
  actions.appendChild(revokeBtn);

  const refreshBtn = makeButton('Refresh');
  refreshBtn.addEventListener('click', () => { hydrate(); });
  actions.appendChild(refreshBtn);
}

async function hydrate() {
  if (__IS_F2P) return;
  let chainOk = false;
  try {
    chainOk = await ensureMonadSelected({ requestSwitch: false });
  } catch {}

  const accounts = await getAccounts();
  const addr = (accounts[0] || '').toLowerCase();

  let smartAccountAddress = addr;
  let smartType = AA.smartAccountType || 'fallback';
  let bundlerReady = false;
  try {
    await initAA({});
    smartAccountAddress = (await getSmartAccountAddress()) || addr;
    smartType = AA.smartAccountType || smartType;
    bundlerReady = smartType === 'delegation-toolkit' && !!AA.toolkitContext;
  } catch (err) {
    console.warn('[aa/ui] initAA failed', err);
    smartAccountAddress = AA.smartAccountAddress || addr;
    smartType = AA.smartAccountType || smartType;
    bundlerReady = smartType === 'delegation-toolkit' && !!AA.toolkitContext;
  }

  if (smartType === 'fallback') {
    try {
      const legacy = await isSmartAccount(addr);
      if (legacy) {
        smartType = 'legacy-smart';
      }
    } catch {}
  }

  const delegation = loadDelegation();
  const delegationActive = !!(delegation && nowSec() < (delegation.end || 0));
  const sponsored = typeof AA.sponsored === 'boolean' ? AA.sponsored : null;

  let presetsMap = null;
  if (smartType === 'delegation-toolkit' && chainOk) {
    try {
      presetsMap = await buildPresets();
    } catch (err) {
      console.warn('[aa/ui] unable to build presets', err);
    }
  }

  const state = {
    addr,
    smartAddress: smartAccountAddress,
    smartType,
    delegation,
    delegationActive,
    chainOk,
    bundlerReady,
    sponsored
  };

  renderStatus(state);
  renderDelegationInfo(state);
  await renderButtons(state, presetsMap);
}

window.addEventListener('load', () => { hydrate().catch(() => {}); });
window.addEventListener('wallet:connected', () => { hydrate().catch(() => {}); });
window.addEventListener('aa:smartaccount', () => { hydrate().catch(() => {}); });
window.addEventListener('aa:session', () => { hydrate().catch(() => {}); });
