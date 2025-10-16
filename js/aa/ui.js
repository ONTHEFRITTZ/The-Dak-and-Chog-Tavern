// at the very top of aa/ui.js
const __MODE = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
const __IS_F2P = __MODE === 'f2p';

import { ensureMonadSelected, getAccounts, isSmartAccount, upgradeToSmartAccount } from './account.js';
import { MONAD } from './config.js';
import { AA, initAA, getSmartAccountAddress } from '../aaClient.js';
// Delegation UI removed; no imports from './delegation.js'

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
  const { addr, controller, smartAddress, smartType, chainOk, sponsored } = state;
  const box = ensureStatusBox();
  const statusBits = [];
  if (!controller) statusBits.push("Wallet: not connected"); else statusBits.push(`Wallet: ${short(controller)}`);
  if (smartType === "aa4337") statusBits.push(`Gasless Mode: ${short(smartAddress)}`); else statusBits.push("Gasless Mode: fallback (EOA)");
  const netLabel = chainOk ? `Network: ${MONAD.name || "Monad Testnet"}` : "Network: switch to Monad";
  statusBits.push(netLabel);
  if (sponsored != null) statusBits.push(`Gas: ${sponsored ? "sponsored" : "self-pay"}`);
  box.textContent = statusBits.join(" | ");
}
function renderDelegationInfo(){ try{ const box=ensureDelegationBox(); box.style.display='none'; box.innerHTML=''; } catch{} }

async function hydrate() {
  if (__IS_F2P) return;
  let chainOk = false;
  try { chainOk = await ensureMonadSelected({ requestSwitch: false }); } catch {}
  const accounts = await getAccounts();
  const addr = (accounts[0] || '').toLowerCase();
  const smartOptIn = (localStorage.getItem(SMART_ACCOUNT_OPT_IN_KEY) === 'true');
  let smartType = 'fallback';
  try { if (smartOptIn) { await initAA({}); smartType = AA.smartAccountType || (AA.sponsored ? 'aa4337' : 'fallback'); } } catch {}
  const controllerAddr = AA.controllerAddress || addr || null;
  const state = { addr, controller: controllerAddr, smartAddress: addr, smartType, chainOk, sponsored: !!AA.sponsored };
  renderStatus(state);
  renderDelegationInfo();
  await renderButtons(state);
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








