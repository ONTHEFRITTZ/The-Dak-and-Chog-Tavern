// js/aa/init-all.js
// Site-wide Smart Account bootstrap for MetaMask Delegation Toolkit v15.
// Load this as the first module after provider-pin.js on every page.

import { AA, initAA, getSmartAccountAddress } from '../aaClient.js';
import { loadDelegation, issueOpenDelegationForLanding, isDelegationActive } from './delegation.js';

const SMART_ACCOUNT_OPT_IN_KEY = 'aa.smartAccount.optIn';

function lc(s) { return (s || '').toLowerCase(); }

function dispatchSmartEvent(address, type = 'delegation-toolkit') {
  try {
    window.dispatchEvent(new CustomEvent('aa:smartaccount', { detail: { address, type } }));
  } catch {}
}

function persistEnabled(address) {
  try { localStorage.setItem('aa.smartAccountAddress', address || ''); } catch {}
  try { localStorage.setItem(SMART_ACCOUNT_OPT_IN_KEY, 'true'); } catch {}
  try { if (window.AA) window.AA.smartAccountAddress = address || null; } catch {}
  dispatchSmartEvent(address);
}

export async function enableSmartAccountNow() {
  // Internal-only: derive SA then sign a single open delegation. No typed-data fallbacks.
  const aa = await initAA({});
  const address = await getSmartAccountAddress();
  if (!address) {
    throw new Error('MetaMask Smart Accounts appear disabled. Enable Smart Accounts in MetaMask and try again.');
  }
  await issueOpenDelegationForLanding();
  persistEnabled(address);
  return address;
}

function ensureModalElements() {
  // Reuse existing landing modal if present, otherwise create a minimal one.
  let modal = document.getElementById('sa-modal');
  let enableBtn = document.getElementById('sa-enable-here');
  let proceedBtn = document.getElementById('sa-proceed');
  let dismissBtn = document.getElementById('sa-dismiss');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sa-modal';
    try { modal.dataset.owner = 'aa-init'; } catch {}
    modal.setAttribute('aria-hidden', 'true');
    modal.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.68);z-index:15000;padding:20px;';
    const dialog = document.createElement('div');
    dialog.className = 'sa-dialog';
    dialog.style.cssText = 'background:var(--panel-bg-soft);border:1px solid rgba(255,255,255,0.16);border-radius:16px;box-shadow:0 28px 70px rgba(0,0,0,0.6);padding:24px 26px;width:min(92vw,460px);color:#f4e6d3;display:flex;flex-direction:column;gap:12px;position:relative;';
    const title = document.createElement('h2'); title.textContent = 'MetaMask Smart Account Recommended'; title.style.margin = '0';
    const msg = document.createElement('p'); msg.textContent = 'Enable a Smart Account to unlock sponsored gas and AA-only features.'; msg.style.margin = '4px 0 2px'; msg.style.fontSize = '15px'; msg.style.lineHeight = '1.4';
    const actions = document.createElement('div'); actions.className = 'sa-actions'; actions.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin-top:10px;align-items:stretch;';
    enableBtn = document.createElement('button'); enableBtn.id = 'sa-enable-here'; enableBtn.className = 'sa-primary'; enableBtn.textContent = 'Enable MetaMask Smart Account'; enableBtn.style.cssText = 'height:48px;border-radius:10px;border:none;background:linear-gradient(135deg,#9200fa,#5f00a8);color:#fff;font-weight:600;cursor:pointer;';
    proceedBtn = document.createElement('button'); proceedBtn.id = 'sa-proceed'; proceedBtn.className = 'sa-secondary'; proceedBtn.textContent = 'Enter with fewer features'; proceedBtn.style.cssText = 'height:48px;border-radius:10px;border:none;background:rgba(255,255,255,0.06);color:#f4e6d3;font-weight:600;cursor:pointer;';
    dismissBtn = document.createElement('button'); dismissBtn.id = 'sa-dismiss'; dismissBtn.className = 'sa-close'; dismissBtn.textContent = 'Ã—'; dismissBtn.setAttribute('aria-label', 'Dismiss'); dismissBtn.style.cssText = 'position:absolute;top:10px;right:12px;background:transparent;border:none;color:#f4e6d3;font-size:26px;cursor:pointer;';
    actions.appendChild(enableBtn); actions.appendChild(proceedBtn);
    dialog.appendChild(dismissBtn); dialog.appendChild(title); dialog.appendChild(msg); dialog.appendChild(actions);
    modal.appendChild(dialog);
    document.body.appendChild(modal);
  }
  return { modal, enableBtn, proceedBtn, dismissBtn };
}

export function openSmartAccountModal() {
  const { modal, enableBtn, proceedBtn, dismissBtn } = ensureModalElements();
  if (!modal) return false;
  modal.setAttribute('aria-hidden', 'false');
  modal.style.display = 'flex';
  const close = () => { modal.setAttribute('aria-hidden', 'true'); modal.style.display = 'none'; };
  const owned = !!(modal && modal.dataset && modal.dataset.owner === 'aa-init');
  if (owned) {
    if (dismissBtn && !dismissBtn.__wired) { dismissBtn.__wired = true; dismissBtn.addEventListener('click', close); }
    if (modal && !modal.__wiredBackdrop) { modal.__wiredBackdrop = true; modal.addEventListener('click', (e) => { if (e.target === modal) close(); }); }
    if (enableBtn && !enableBtn.__wired) {
      enableBtn.__wired = true;
      enableBtn.addEventListener('click', async () => { try { sessionStorage.removeItem('aa:disableAutoDelegation'); } catch {} enableSmartAccountNow(); close(); } catch (e) { console.warn('Enable SA failed', e); enableBtn.disabled = false; enableBtn.textContent = prev; }
      });
    }
    if (proceedBtn && !proceedBtn.__wired) {
      proceedBtn.__wired = true;
      proceedBtn.addEventListener('click', () => { close(); /* EOA path for this visit only */ });
    }
  }
  return true;
}

// Expose helpers globally for pages to call.
try {
  window.openSmartAccountModal = openSmartAccountModal;
  window.enableSmartAccountNow = enableSmartAccountNow;
} catch {}

async function siteWideInit() {\n  // Never auto-sign. Only broadcast if a valid delegation already exists.\n  const existing = loadDelegation();\n  if (existing && existing.end && Math.floor(Date.now()/1000) < Number(existing.end)) {\n    try { if (existing.delegate) persistEnabled(lc(existing.delegate)); } catch {}\n  }\n}\n    return;
  }

  // On landing page, do not auto-enable; wait for explicit user choice.
  const path = (typeof location !== 'undefined' ? String(location.pathname || '') : '');
  const isLanding = /(^|\/)landing\.html$/i.test(path);
  if (isLanding) return;

  // If no delegation, but SA address can be derived and differs from EOA, auto-enable by issuing an open delegation once (content pages only).
  try {
    const smartAddr = await getSmartAccountAddress();
    const controller = AA?.controllerAddress || AA?.address || null;
    const smartIsDistinct = !!(smartAddr && controller && lc(smartAddr) !== lc(controller));
    if (smartIsDistinct) {
      await issueOpenDelegationForLanding();
      persistEnabled(lc(smartAddr));
      return;
    }
  } catch (err) {
    // Non-fatal; pages can call openSmartAccountModal() when needed.
    console.warn('[init-all] smart account auto-enable skipped', err);
  }
}

// Kick off initialization but donâ€™t block page rendering.
siteWideInit().catch(() => {});

