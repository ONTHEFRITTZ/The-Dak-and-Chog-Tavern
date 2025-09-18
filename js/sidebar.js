// Sidebar injection for Dak & Chog Tavern
// Renders a collapsible left navigation across pages.
// Persists collapsed state in localStorage: sidebar.collapsed = 'true' | 'false'

(function(){
  try {
    if (window.__SIDEBAR_LOADED__) return; // guard against double-inject
    window.__SIDEBAR_LOADED__ = true;

    const LS_KEY = 'sidebar.collapsed';
    const isCollapsed = () => {
      try { return localStorage.getItem(LS_KEY) === 'true'; } catch { return false; }
    };
    const setCollapsed = (v) => { try { localStorage.setItem(LS_KEY, v ? 'true' : 'false'); } catch {} };

    const links = [
      { href: '/index.html', label: 'Home' },
      { href: '/games/faro/lobby.html', label: 'Faro Lobby' },
      { href: '/games/poker/index.html', label: "Poker" },
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
    header.innerHTML = '<span class="title">Tavern</span>';

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
