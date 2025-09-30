// agent-sponsor-indicator.js — tiny pill that mirrors sponsor state (mounted bottom-right)
(function () {
  try {
    let sponsorEl = document.getElementById('sponsor-indicator');
    if (!sponsorEl) {
      sponsorEl = document.createElement('div');
      sponsorEl.id = 'sponsor-indicator';
      sponsorEl.style.cssText = [
        'position:fixed','right:12px','bottom:62px','z-index:12050',
        'display:none','padding:4px 10px','border-radius:12px',
        'background:#2b1e12','color:#fff','font-size:12px','font-weight:700',
        'box-shadow:0 6px 16px rgba(0,0,0,0.35)'
      ].join(';');
      sponsorEl.textContent = 'Gas sponsored by The Dak & Chog Tavern';
      document.body.appendChild(sponsorEl);
    }
    window.addEventListener('aa:sponsored', (e) => {
      sponsorEl.style.display = (e?.detail?.active ? 'inline-block' : 'none');
    });
  } catch (err) { console.warn('Sponsor indicator init failed', err); }
})();
