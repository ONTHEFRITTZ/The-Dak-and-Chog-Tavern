// at the very top of aa/ui.js
const __MODE = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
const __IS_F2P = __MODE === 'f2p';

import { ensureMonadSelected, getAccounts, isSmartAccount, upgradeToSmartAccount } from './account.js';
import { MONAD } from './config.js';
import { AA, initAA, getSmartAccountAddress } from '../aaClient.js';
import {
  presets as buildPresets,
  revokeDelegation,
  loadDelegation,
  ensureDelegationActive,
  nowSec,
  clearDelegationSuppression,
  isDelegationSuppressed
} from './delegation.js';

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

const SMART_ACCOUNT_OPT_IN_KEY = 'aa.smartAccount.optIn';

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
    c.style.display = 'flex';
    c.style.marginLeft = '0';
    c.style.width = '100%';
    c.style.maxWidth = '100%';
  } else {
    c.style.display = 'none';
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

function ensureDelegationBox(){ const c=ensureContainer(); let box=c.querySelector('#aa-delegation-info'); if(!box){ box=document.createElement('div'); box.id='aa-delegation-info'; box.style.display='none'; c.appendChild(box);} return box;}

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
  const {
    addr,
    controller,
    smartAddress,
    smartType,
    delegationActive,
    delegation,
    chainOk,
    bundlerReady,
    sponsored,
    delegationError
  } = state;
  const box = ensureStatusBox();
  const statusBits = [];

  if (!controller) {
    statusBits.push('Wallet: not connected');
  } else {
    statusBits.push(`Wallet: ${short(controller)}`);
  }

  if (smartType === 'aa4337') {
    statusBits.push(`Gasless Mode: ${short(smartAddress)}`);
  } else if (smartType === 'fallback') {
    statusBits.push('Gasless Mode: fallback (EOA)');
  } else if (smartType === 'legacy-smart') {
    statusBits.push(`Gasless Mode: legacy (${short(smartAddress)})`);
  } else {
    statusBits.push(`Gasless Mode: ${short(smartAddress || addr || '-')}`);
  }

  const netLabel = chainOk ? `Network: ${MONAD.name || 'Monad Testnet'}` : 'Network: switch to Monad';
  statusBits.push(netLabel);

  let delegationLabel;
  if (delegationError) {
    delegationLabel = `Delegation: setup failed (${delegationError.message || delegationError})`;
  } else if (delegationActive) {
    delegationLabel = `Delegation: active${delegation?.preset ? ` (${delegation.preset})` : ''}`;
  } else if (delegation) {
    delegationLabel = 'Delegation: expired';
  } else {
    delegationLabel = 'Delegation: none';
  }
  statusBits.push(delegationLabel);

  statusBits.push(`Bundler: ${bundlerReady ? 'ready' : 'fallback'}`);
  if (sponsored != null) {
    statusBits.push(`Gas: ${sponsored ? 'sponsored' : 'self-pay'}`);
  }

  box.textContent = statusBits.join(' | ');
}

function renderDelegationInfo(){ try{ const box=ensureDelegationBox(); box.style.display='none'; box.innerHTML=''; } catch{} }

async function renderButtons(state, presetMap) {
  const {
    addr,
    controller,
    chainOk,
    smartType,
    delegationActive,
    smartOptIn,
    delegationSuppressed
  } = state;
  const actions = ensureActionsBox();
  actions.innerHTML = '';

  const disabledColor = 'rgba(255,255,255,0.35)';

  if (!controller) {
    const note = document.createElement('span');
    note.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.8);';
    note.textContent = 'Connect MetaMask to Enable Gasless Mode controls.';
    actions.appendChild(note);
    return;
  }

  if (state.delegationError) {
    const warn = document.createElement('div');
    warn.style.cssText = 'font-size:11px;color:#ff9a9a;margin-bottom:6px;max-width:320px;';
    warn.textContent = state.delegationError.message || 'Delegation setup failed. Open MetaMask and ensure the base account is connected.';
    actions.appendChild(warn);
  }
  if (delegationSuppressed) {
    const warn = document.createElement('div');
    warn.style.cssText = 'font-size:11px;color:#ff9a9a;margin-bottom:6px;max-width:320px;';
    warn.textContent = 'Delegation signing was previously rejected. Disable MetaMask Gasless Mode, then click "Enable Gasless Mode" to try again.';
    actions.appendChild(warn);
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

  if (!smartOptIn) {
    const enableBtn = makeButton('Enable Gasless Mode');
    if (!chainOk) {
      enableBtn.disabled = true;
      enableBtn.style.background = 'rgba(0,0,0,0.45)';
      enableBtn.style.color = disabledColor;
    } else {
      safeRun(enableBtn, async () => {
        clearDelegationSuppression();
        try { const m = await import('../aaClient.js'); m.enableToolkitSmartAccount?.(); } catch {}
        // Derive the Gasless Mode address first so the delegation targets the internal account.
        await initAA({});
        const mmAddr = (await getSmartAccountAddress()) || null;
        // If Gasless Mode are not active in MetaMask, block and show guidance.
        if (!mmAddr) {
          throw new Error('Gasless Mode appear disabled in MetaMask. Click "Open MetaMask" below and Enable Gasless Modes for this wallet, then try again.');
        }
        const targetDelegate = mmAddr;
        let existing = loadDelegation();
        if (!existing || !(existing.end && nowSec() < existing.end)) {
          const delMod = await import('../aa/delegation.js');
          existing = await delMod.loadDelegation?.();
          if (!existing || !(existing.end && nowSec() < existing.end)) {
            existing = await delMod.issueOpenDelegationForLanding();
          }
        }
        if (!existing) {
          throw new Error("Delegation signature was not completed.");
        }
        try { localStorage.setItem(SMART_ACCOUNT_OPT_IN_KEY, "true"); } catch {}
        await initAA({});
      }, 'Enabling...');
    }
    actions.appendChild(enableBtn);
    // Provide a helper to open MetaMask so user can Enable Gasless Modes
    const openMM = makeButton('Open MetaMask');
    if (!chainOk) {
      openMM.disabled = true;
      openMM.style.background = 'rgba(0,0,0,0.45)';
      openMM.style.color = disabledColor;
    } else {
      safeRun(openMM, async () => {
        try {
          // Ensure correct network first
          await ensureMonadSelected({ requestSwitch: true });
        } catch {}
        try {
          const provider = (typeof window.__getSelectedProvider === 'function' ? window.__getSelectedProvider() : window.ethereum) || null;
          if (provider && typeof provider.request === 'function') {
            // Permissions request reliably opens MetaMask; user can Enable Gasless Modes in the UI
            await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
          }
        } catch (_) {}
      }, 'Opening...');
    }
    actions.appendChild(openMM);

    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.75);margin-top:6px;max-width:340px;';
    note.innerHTML = 'If Gasless Mode are disabled in MetaMask, click <strong>Open MetaMask</strong> and Enable Gasless Modes for this wallet. Then click <strong>Enable Gasless Mode</strong> again.';
    actions.appendChild(note);
    return;
  }

  // Show internal signer readiness for quick diagnosis
  try {
    const status = document.createElement('div');
    status.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.75);margin:4px 0;';
    const ready = (window.smartAccount && (window.smartAccount.signDelegation || (window.smartAccount.mmAccount && window.smartAccount.mmAccount.signDelegation))) ? 'ready' : 'not ready';
    status.textContent = `Internal signer: ${ready}`;
    actions.appendChild(status);
  } catch {}

  const disableBtn = makeButton('Use Base Wallet Only');
  safeRun(disableBtn, async () => {
    try { localStorage.setItem(SMART_ACCOUNT_OPT_IN_KEY, 'false'); } catch {}
    clearDelegationSuppression();
    try { await revokeDelegation(); } catch {}
    try {
      AA.smartAccountType = 'fallback';
      AA.toolkitContext = null;
    } catch {}
  }, 'Disabling...');
  actions.appendChild(disableBtn);

  const upgradeBtn = makeButton(
    smartType === 'aa4337' ? 'Gasless Mode Ready' : 'Initialize Gasless Mode'
  );
  if (smartType === 'aa4337') {
    upgradeBtn.disabled = true;
    upgradeBtn.style.background = 'rgba(0,0,0,0.45)';
    upgradeBtn.style.color = disabledColor;
  } else {
    safeRun(upgradeBtn, async () => {
      try { const m = await import('../aaClient.js'); m.enableToolkitSmartAccount?.(); } catch {}
      const ok = await upgradeToSmartAccount();
      if (!ok) {
        throw new Error('Unable to initialize MetaMask Gasless Mode.');
      }
    }, 'Initializing...');
  }
  actions.appendChild(upgradeBtn);

  let presets = presetMap;
  if (!presets && smartType === 'aa4337' && chainOk) {
    try {
      presets = await buildPresets();
    } catch (err) {
      console.warn('[aa/ui] preset load failed', err);
    }
  }

  const delegationAvailable = smartType === 'aa4337' && chainOk && !!presets;

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

  const reissueBtn = makeButton('Reissue Delegation');
  if (!delegationAvailable) {
    reissueBtn.disabled = true;
    reissueBtn.style.background = 'rgba(0,0,0,0.45)';
    reissueBtn.style.color = disabledColor;
  } else {
    safeRun(reissueBtn, async () => {
      const presetsMapFresh = presets || await buildPresets();
      const presetKey = select.value === 'playPlusTableOps' ? 'playPlusTableOps' : 'playOnly';
      const choice = presetsMapFresh[presetKey] || presetsMapFresh.playPlusTableOps || presetsMapFresh.playOnly;
      if (!choice) throw new Error('Preset not found');
      await ensureDelegationActive({ presetKey: choice.key, address: controller || addr, force: false });
    }, 'Reissuing...');
  }
  actions.appendChild(reissueBtn);

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

  const smartOptIn = (() => {
    try {
      const d = loadDelegation();
      return !!(d && d.end && nowSec() < d.end);
    } catch { return false; }
  })();
  const delegationSuppressed = isDelegationSuppressed();

  let smartAccountAddress = addr;
  let smartType = 'fallback';
  let bundlerReady = false;
  if (smartOptIn) {
    try {
      await initAA({});
      smartAccountAddress = (await getSmartAccountAddress()) || addr;
      smartType = AA.smartAccountType || 'fallback';
      bundlerReady = smartType === 'aa4337' && !!AA.toolkitContext;
    } catch (err) {
      console.warn('[aa/ui] initAA failed', err);
      smartAccountAddress = AA.smartAccountAddress || addr;
      smartType = AA.smartAccountType || 'fallback';
      bundlerReady = smartType === 'aa4337' && !!AA.toolkitContext;
    }
  } else {
    try {
      AA.smartAccountType = 'fallback';
      AA.smartAccountAddress = null;
      AA.toolkitContext = null;
    } catch {}
  }

  if (smartType === 'fallback') {
    try {
      const legacy = await isSmartAccount(addr);
      if (legacy) {
        smartType = 'legacy-smart';
      }
    } catch {}
  }

  let delegation = loadDelegation();
  let delegationActive = !!(delegation && nowSec() < (delegation.end || 0));
  let delegationError = null;
  const sponsored = typeof AA.sponsored === 'boolean' ? AA.sponsored : null;

  let presetsMap = null;
  if (smartOptIn && smartType === 'aa4337' && chainOk) {
    try {
      presetsMap = await buildPresets();
    } catch (err) {
      console.warn('[aa/ui] unable to build presets', err);
    }

    if (!delegationActive && !delegationSuppressed) {
      try {
        delegation = await ensureDelegationActive({});
        delegationActive = !!(delegation && nowSec() < (delegation.end || 0));
      } catch (autoErr) {
        delegationError = autoErr;
        console.warn('[aa/ui] automatic delegation setup failed', autoErr);
      }
    }
  }

  const controllerAddr = AA.controllerAddress || addr || null;

  const state = {
    addr,
    controller: controllerAddr,
    smartAddress: smartAccountAddress,
    smartType,
    delegation,
    delegationActive,
    smartOptIn,
    delegationSuppressed,
    delegationError,
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


// Override buttons with Gasless Mode controls only (no delegation UI)
function renderButtons(state) {
  const { controller, chainOk } = state;
  const actions = ensureActionsBox();
  actions.innerHTML = '';
  const disabledColor = 'rgba(255,255,255,0.35)';
  const makeButton = (label) => { const b=document.createElement('button'); b.className='aa-btn'; b.style.cssText=['padding:6px 10px','border-radius:8px','border:none','background:#2d6aee','color:#fff','font-weight:600','cursor:pointer'].join(';'); b.textContent=label; b.addEventListener('mouseenter',()=>{ if(!b.disabled) b.style.background='#2f7bff';}); b.addEventListener('mouseleave',()=>{ b.style.background='#2d6aee';}); return b; };
  const safeRun = (btn, fn, labelBusy) => { btn.addEventListener('click', async ()=>{ if(btn.disabled) return; const prev=btn.textContent; btn.disabled=true; if(labelBusy) btn.textContent=labelBusy; try{ await fn(); } catch(e){ console.error('[aa/ui] action failed', e); alert(e?.message||'Operation failed.'); } finally { btn.disabled=false; btn.textContent=prev; hydrate().catch(()=>{}); } }); };
  if (!controller) { const note=document.createElement('span'); note.style.cssText='font-size:11px;color:rgba(255,255,255,0.8)'; note.textContent='Connect MetaMask to Enable Gasless Mode controls.'; actions.appendChild(note); return; }
  if (!chainOk) { const switchBtn=makeButton('Switch to Monad'); safeRun(switchBtn, async()=>{ const ok = await ensureMonadSelected({ requestSwitch:true }); if(!ok) throw new Error('Wallet did not switch to Monad.'); }, 'Switching...'); actions.appendChild(switchBtn); return; }
  const smartOptIn = (window.AA && AA.sponsored) ? true : (localStorage.getItem('aa.smartAccount.optIn')==='true');
  if (!smartOptIn) { const enableBtn=makeButton('Enable Gasless Mode'); safeRun(enableBtn, async()=>{ try{ localStorage.setItem('aa.smartAccount.optIn','true'); }catch{} try{ await initAA({}); AA.setSponsored(true); }catch{} }, 'Enabling...'); actions.appendChild(enableBtn); return; }
  const disableBtn=makeButton('Disable Gasless Mode'); safeRun(disableBtn, async()=>{ try{ localStorage.setItem('aa.smartAccount.optIn','false'); }catch{} try{ await initAA({}); AA.setSponsored(false); }catch{} }, 'Disabling...'); actions.appendChild(disableBtn);
}






