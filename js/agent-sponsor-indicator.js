// agent-sponsor-indicator.js — bottom-right “Sponsored by Dak & Chog Tavern” pill
// Shows ONLY on on-chain tables and only when AA emits {active:true}.

(function () {
  try {
    // Only show on on-chain tables; F2P is additionally gated via CSS.
    const mode = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
    if (mode !== 'onchain') return;

    const root = document.querySelector('.top-banner .banner-right') || document.body;
    if (!root) return;

    // Create element
    let sponsorEl = document.getElementById('sponsor-indicator');
    if (!sponsorEl) {
      sponsorEl = document.createElement('div');
      sponsorEl.id = 'sponsor-indicator';
      sponsorEl.className = 'agent-sponsor-indicator';
      sponsorEl.style.cssText = [
        'display:inline-block',
        'position:fixed',
        'right:12px',
        'bottom:12px',
        'padding:6px 10px',
        'border-radius:12px',
        'background:#2b1e12',
        'color:#fff',
        'font-size:12px',
        'font-weight:700',
        'white-space:nowrap',
        'z-index:12050',
        'box-shadow:0 6px 16px rgba(0,0,0,0.35)'
      ].join(';');
      sponsorEl.setAttribute('aria-live', 'polite');
      sponsorEl.textContent = 'Sponsored by Dak & Chog Tavern';
      sponsorEl.style.display = 'none'; // hidden until enabled
      root.appendChild(sponsorEl);
    }

    // Listen for sponsorship toggle events from aaClient.js
    window.addEventListener('aa:sponsored', (e) => {
      if (!sponsorEl) return;
      const on = !!(e && e.detail && e.detail.active);
      sponsorEl.style.display = on ? 'inline-block' : 'none';
    });
  } catch (err) {
    console.warn('Sponsor indicator init failed', err);
  }
})();
