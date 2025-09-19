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
      { href: '/rules.html', label: 'Rules' },
    ];

    const nav = document.createElement('nav');
    nav.id = 'sidebar';
    nav.className = 'sidebar';
    nav.setAttribute('aria-label', 'Site');
    // Ensure full-height overlay even if stale CSS is cached
    try { nav.style.position = 'fixed'; nav.style.top = '0'; nav.style.bottom = '0'; nav.style.left = '0'; } catch {}

    const header = document.createElement('div');
    header.className = 'sidebar-header';
    // Page-specific logo at top of sidebar
    const logo = document.createElement('img');
    logo.className = 'sidebar-logo';
    (function(){
      try {
        const p = String((location && location.pathname) || '').toLowerCase();
        let src = '/assets/images/d-and-c.png';
        let alt = 'The Dak and Chog Tavern';
        let kind = 'tavern';
        if (p.includes('/games/faro/')) { src = '/assets/images/faro-logo.png'; alt = 'Faro'; kind = 'faro'; }
        else if (p.includes('/games/poker/')) { src = '/assets/images/texas-holdem-logo.png'; alt = 'Poker'; kind = 'poker'; }
        else if (p.includes('/games/hazard/')) { src = '/assets/images/hazard-logo.png'; alt = 'Hazard'; }
        else if (p.includes('/games/shell/')) { src = '/assets/images/shell-game-logo.png'; alt = 'Shell Game'; }
        else if (p.includes('/games/dakchog/')) { src = '/assets/images/dakandchog-logo.png'; alt = 'Dak & Chog'; }
        // Home page explicit check: ONLY treat site root as home, not game sub-index pages
        if (p === '/' || p === '/index.html') { kind = 'tavern'; src = '/assets/images/d-and-c.png'; alt = 'The Dak and Chog Tavern'; }
        logo.src = src; logo.alt = alt;
        if (kind) logo.classList.add('sidebar-logo--' + kind);
        // Force full-width bleed on all sidebar logos to avoid cached CSS constraints
        try {
          logo.style.display = 'block';
          logo.style.width = 'calc(100% + 20px)';
          logo.style.maxWidth = 'none';
          logo.style.height = 'auto';
          logo.style.marginLeft = '-10px';
          logo.style.marginRight = '-10px';
          logo.style.objectFit = 'contain';
          // Per-kind vertical allowance
          var mh = 140;
          if (kind === 'poker') mh = 160;
          if (kind === 'tavern') mh = 120;
          logo.style.maxHeight = mh + 'px';
        } catch {}
      } catch {}
    })();
    // Append logo on all pages (including Tavern home)
    try { header.appendChild(logo); } catch {}

    const btn = document.createElement('button');
    btn.className = 'sidebar-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle navigation');
    btn.title = 'Toggle navigation';
    btn.textContent = '☰';
    header.appendChild(btn);

    const list = document.createElement('ul');
    list.className = 'sidebar-links';

    const cacheBust = () => String(window.__BUILD_TAG || Date.now());
    function withNow(u){ try { const url = new URL(u, location.href); url.searchParams.set('now', cacheBust()); return url.pathname + '?' + url.searchParams.toString(); } catch { return u; } }

    for (const { href, label } of links) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = withNow(href);
      a.textContent = label;
      // Force fresh navigation on click; avoid history-cache restores
      a.addEventListener('click', function(e){
        try {
          e.preventDefault();
          const target = withNow(href);
          window.location.assign(target);
        } catch { /* fall back to default */ }
      });
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

    // Maintain a CSS variable for top banner offset so it never overlaps sidebar
    function updateSidebarOffset() {
      try {
        const w = window.innerWidth || 0;
        const collapsed = nav.classList.contains('collapsed');
        let px = '240px';
        if (w <= 800) {
          // On small screens, sidebar is offscreen when collapsed
          px = collapsed ? '0px' : '240px';
        } else {
          // Desktop: collapsed rail width is 64px
          px = collapsed ? '64px' : '240px';
        }
        document.documentElement.style.setProperty('--sidebar-left', px);
        const tb = document.querySelector('.top-banner');
        if (tb) { tb.style.left = px; }
        // Hide/show footer inline to avoid reliance on cached CSS
        try { footer.style.display = collapsed ? 'none' : ''; } catch {}
      } catch {}
    }
    updateSidebarOffset();

    // Toggle handler
    btn.addEventListener('click', function(){
      const next = !nav.classList.contains('collapsed');
      if (next) nav.classList.add('collapsed'); else nav.classList.remove('collapsed');
      setCollapsed(next);
      updateSidebarOffset();
    });
    window.addEventListener('resize', updateSidebarOffset);

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
