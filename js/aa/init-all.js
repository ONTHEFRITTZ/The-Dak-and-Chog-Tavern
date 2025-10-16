// js/aa/init-all.js
// Site-wide AA bootstrap (4337/bundler). No delegation.
// Load this as the first module after provider-pin.js on every page.

import { AA, initAA } from '../aaClient.js';

// No internal-signer detection in v13 mode

const SMART_ACCOUNT_OPT_IN_KEY = 'aa.smartAccount.optIn'; // repurposed as gasless opt-in

function lc(s) { return (s || '').toLowerCase(); }

function dispatchSmartEvent(address, type = 'delegation-toolkit') {
  try {
    window.dispatchEvent(new CustomEvent('aa:smartaccount', { detail: { address, type } }));
  } catch {}
}

function persistOptInDelegationMode() {
  try { localStorage.setItem(SMART_ACCOUNT_OPT_IN_KEY, 'true'); } catch {}
}

export async function enableSmartAccountNow() {
  // Enable gasless/AA across site. No signing, no delegation.
  await initAA({});
  try { AA.setSponsored(true); } catch {}
  persistOptInDelegationMode();
  try { window.dispatchEvent(new CustomEvent('aa:sponsored', { detail: { active: true } })); } catch {}
  return null;
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
    const title = document.createElement('h2'); title.textContent = 'Enable Gasless Mode'; title.style.margin = '0';
    const msg = document.createElement('p'); msg.textContent = 'Turn on gasless transactions (bundler/paymaster) for a smoother experience.'; msg.style.margin = '4px 0 2px'; msg.style.fontSize = '15px'; msg.style.lineHeight = '1.4';
    const actions = document.createElement('div'); actions.className = 'sa-actions'; actions.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin-top:10px;align-items:stretch;';
    enableBtn = document.createElement('button'); enableBtn.id = 'sa-enable-here'; enableBtn.className = 'sa-primary'; enableBtn.textContent = 'Enable Gasless Mode'; enableBtn.style.cssText = 'height:48px;border-radius:10px;border:none;background:linear-gradient(135deg,#9200fa,#5f00a8);color:#fff;font-weight:600;cursor:pointer;';
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
      enableBtn.__wired = true;
      enableBtn.addEventListener('click', async () => {
        if (enableBtn.disabled) return;
        const prev = enableBtn.textContent;
        enableBtn.disabled = true;
        enableBtn.textContent = 'Enabling gasless...';
        try {
          try { sessionStorage.removeItem('aa:disableAutoDelegation'); } catch {}
          await enableSmartAccountNow();
          close();
        } catch (e) {
          console.warn('Enable SA failed', e);
          enableBtn.disabled = false;
          enableBtn.textContent = prev;
        }
      });
    if (proceedBtn && !proceedBtn.__wired) {
      proceedBtn.__wired = true;
      proceedBtn.addEventListener('click', () => { close(); /* EOA path for this visit only */ });
    }
  }
  // Proactively detect availability and disable the enable button if internal signer is not present (pre-v15 vendor).
  return true;
}

// Expose helpers globally for pages to call.
try {
  window.openSmartAccountModal = openSmartAccountModal;
  window.enableSmartAccountNow = enableSmartAccountNow;
} catch {}

async function siteWideInit() {
  // Broadcast current sponsored (gasless) preference. Never auto-sign.
  const optIn = (() => { try { return localStorage.getItem(SMART_ACCOUNT_OPT_IN_KEY) === 'true'; } catch { return false; } })();
  if (optIn) {
    try { await initAA({}); AA.setSponsored(true); } catch {}
    try { window.dispatchEvent(new CustomEvent('aa:sponsored', { detail: { active: true } })); } catch {}
  }
}

// Run immediately and also on DOM ready to ensure early broadcast without signing
try { siteWideInit(); } catch {}
try {
  if (document && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', () => { try { siteWideInit(); } catch {} }, { once: true });
  }
} catch {}
