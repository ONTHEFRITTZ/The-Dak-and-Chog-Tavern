// Sidebar injection for Dak & Chog Tavern (logo + nav links only)
// Keeps prior collapsed state in localStorage. No network/contract pills.

(function(){
  try {
    if (window.__SIDEBAR_LOADED__) return;
    window.__SIDEBAR_LOADED__ = true;

    const LS_KEY = 'sidebar.collapsed';
    const isCollapsed = () => { try { return localStorage.getItem(LS_KEY) === 'true'; } catch { return false; } };
    const setCollapsed = (v) => { try { localStorage.setItem(LS_KEY, v ? 'true' : 'false'); } catch {} };

    const links = [
      { href: '/index.html', label: 'Home' },
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

    const header = document.createElement('div');
    header.className = 'sidebar-header';

    // Logo selection by path
    const logo = document.createElement('img');
    logo.className = 'sidebar-logo';
    (function(){
      try {
        const p = String((location && location.pathname) || '').toLowerCase();
        let src = '/assets/images/d-and-c.png';
        let alt = 'The Dak and Chog Tavern';
        if (p.includes('/games/poker/')) { src = '/assets/images/texas-holdem-logo.png'; alt = 'Poker'; }
        else if (p.includes('/games/hazard/')) { src = '/assets/images/hazard-logo.png'; alt = 'Hazard'; }
        else if (p.includes('/games/shell/')) { src = '/assets/images/shell-game-logo.png'; alt = 'Shell Game'; }
        else if (p.includes('/games/dakchog/')) { src = '/assets/images/dakandchog-logo.png'; alt = 'Dak & Chog'; }
        if (p === '/' || p === '/index.html') { src = '/assets/images/d-and-c.png'; alt = 'The Dak and Chog Tavern'; }
        logo.src = src; logo.alt = alt;
      } catch {}
    })();
    header.appendChild(logo);

    const btn = document.createElement('button');
    btn.className = 'sidebar-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle navigation');
    btn.title = 'Toggle navigation';
    header.appendChild(btn);

    const list = document.createElement('ul');
    list.className = 'sidebar-links';
    links.forEach(({href, label}) => {
      const li = document.createElement('li');
      const a = document.createElement('a'); a.href = href; a.textContent = label;
      li.appendChild(a); list.appendChild(li);
    });

    nav.appendChild(header);
    nav.appendChild(list);
    document.body.appendChild(nav);

    function updateSidebarOffset() {
      try {
        const w = window.innerWidth || 0;
        const collapsed = nav.classList.contains('collapsed');
        let px = '240px';
        if (w <= 800) {
          px = collapsed ? '0px' : '240px';
        } else {
          px = collapsed ? '64px' : '240px';
        }
        document.documentElement.style.setProperty('--sidebar-left', px);
      } catch {}
    }

    function applyCollapse(collapsed, persist = true) {
      nav.classList.toggle('collapsed', collapsed);
      if (persist) setCollapsed(collapsed);
      btn.textContent = collapsed ? '...' : 'Close';
      btn.setAttribute('aria-expanded', String(!collapsed));
      updateSidebarOffset();
    }

    let initialCollapsed = false;
    try {
      if (localStorage.getItem(LS_KEY) === null && (window.innerWidth || 0) <= 800) {
        setCollapsed(true);
      }
      initialCollapsed = isCollapsed();
    } catch {
      initialCollapsed = false;
    }

    applyCollapse(initialCollapsed, false);

    btn.addEventListener('click', function(){
      const next = !nav.classList.contains('collapsed');
      applyCollapse(next);
    });

    window.addEventListener('resize', updateSidebarOffset);
  } catch (e) {
    console.error('sidebar inject failed', e);
  }
})();
