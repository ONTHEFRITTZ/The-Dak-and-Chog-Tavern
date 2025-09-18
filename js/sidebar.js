// Sidebar injection for Dak & Chog Tavern
// Renders a collapsible left navigation across pages.
// Persists collapsed state in localStorage: sidebar.collapsed = 'true' | 'false'

(function(){
  try {
    // Exclusions: do not render on landing or admin pages
    try {
      const p = String((location && location.pathname) || '').toLowerCase();
      const isLanding = p.endsWith('/landing.html') || document.body.classList.contains('age-landing');
      const isAdmin = p.includes('/admin/');
      if (isLanding || isAdmin) return;
    } catch {}

    if (window.__SIDEBAR_LOADED__) return; // guard against double-inject
    window.__SIDEBAR_LOADED__ = true;

    const LS_KEY = 'sidebar.collapsed';
    const isCollapsed = () => {
      try { return localStorage.getItem(LS_KEY) === 'true'; } catch { return false; }
    };
    const setCollapsed = (v) => { try { localStorage.setItem(LS_KEY, v ? 'true' : 'false'); } catch {} };

    const links = [
      { href: '/index.html', label: 'Home' },
      { href: '/games/faro/lobby.html', label: 'Faro' },
      { href: '/games/poker/index.html', label: 'Poker' },
      { href: '/games/hazard/index.html', label: 'Hazard' },
      { href: '/games/shell/index.html', label: 'Shell Game' },
      { href: '/games/dakchog/index.html', label: 'Dak & Chog' },
    ];

    const nav = document.createElement('nav');
    nav.id = 'sidebar';
    nav.className = 'sidebar';
    nav.setAttribute('aria-label', 'Site');

    const header = document.createElement('div');
    header.className = 'sidebar-header';
    // Page-specific logo at top of sidebar
    const logo = document.createElement('img');
    logo.className = 'sidebar-logo';
    (function(){
      try {
        const p = String((location && location.pathname) || '').toLowerCase();
        let src = '/assets/images/sign.png';
        let alt = 'The Dak and Chog Tavern';
        let kind = 'tavern';
        if (p.includes('/games/faro/')) { src = '/assets/images/faro-logo.png'; alt = 'Faro'; kind = 'faro'; }
        else if (p.includes('/games/poker/')) { src = '/assets/images/texas-holdem-logo.png'; alt = 'Poker'; kind = 'poker'; }
        else if (p.includes('/games/hazard/')) { src = '/assets/images/hazard-logo.png'; alt = 'Hazard'; }
        else if (p.includes('/games/shell/')) { src = '/assets/images/shell-game-logo.png'; alt = 'Shell Game'; }
        else if (p.includes('/games/dakchog/')) { src = '/assets/images/dakandchog-logo.png'; alt = 'Dak & Chog'; }
        // Home page explicit check
        if (p === '/' || p.endsWith('/index.html')) { kind = 'tavern'; }
        logo.src = src; logo.alt = alt;
        if (kind) logo.classList.add('sidebar-logo--' + kind);
      } catch {}
    })();
    header.appendChild(logo);

    const btn = document.createElement('button');
    btn.className = 'sidebar-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle navigation');
    btn.title = 'Toggle navigation';
    btn.textContent = '☰';
    header.appendChild(btn);

    const list = document.createElement('ul');
    list.className = 'sidebar-links';

    for (const { href, label } of links) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      li.appendChild(a);
      list.appendChild(li);
    }

    nav.appendChild(header);
    nav.appendChild(list);

    // Footer for network/contract readout
    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    footer.id = 'sidebar-footer';
    footer.innerHTML = '<div class="sb-net">Loading network…</div>';
    nav.appendChild(footer);
    document.body.appendChild(nav);

    // Initial state: default to collapsed on small screens if no prior choice
    try {
      if (localStorage.getItem(LS_KEY) === null && (window.innerWidth || 0) <= 800) {
        setCollapsed(true);
      }
    } catch {}
    if (isCollapsed()) nav.classList.add('collapsed');

    // Toggle handler
    btn.addEventListener('click', function(){
      const next = !nav.classList.contains('collapsed');
      if (next) nav.classList.add('collapsed'); else nav.classList.remove('collapsed');
      setCollapsed(next);
    });

    // Accessibility: close with Esc when focused within the sidebar (optional behavior)
    nav.addEventListener('keydown', function(e){
      if (e.key === 'Escape') {
        nav.classList.add('collapsed');
        setCollapsed(true);
      }
    });
  } catch (e) {
    console.error('sidebar inject failed', e);
  }
})();
