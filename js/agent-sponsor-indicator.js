// agent-sponsor-indicator.js
(function () {
  try {
    const root = document.querySelector('.top-banner .banner-right') || document.body;
    if (!root) return;

    // Create element
    let sponsorEl = document.getElementById('sponsor-indicator');
    if (!sponsorEl) {
      sponsorEl = document.createElement('div');
      sponsorEl.id = 'sponsor-indicator';
      sponsorEl.style.cssText = [
        'display:inline-block',
        'margin-left:8px',
        'padding:2px 8px',
        'border-radius:12px',
        'background:#2b1e12',
        'color:#fff',
        'font-size:11px',
        'font-weight:600',
        'white-space:nowrap'
      ].join(';');
      sponsorEl.textContent = 'Gas sponsored by The Dak & Chog Tavern';
      sponsorEl.style.display = 'none'; // hidden until enabled
      root.appendChild(sponsorEl);
    }

    // Listen for sponsorship toggle events from aaClient.js
    window.addEventListener('aa:sponsored', (e) => {
      if (!sponsorEl) return;
      sponsorEl.style.display = e.detail && e.detail.active ? 'inline-block' : 'none';
    });
  } catch (err) {
    console.warn('Sponsor indicator init failed', err);
  }
})();
