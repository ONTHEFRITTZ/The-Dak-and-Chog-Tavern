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
    btn.textContent = 'â˜°';
    header.appendChild(btn);

    const list = document.createElement('ul');
    list.className = 'sidebar-links';

    const cacheBust = () => String(window.__BUILD_TAG || Date.now());
    function withNow(u){ try { const url = new URL(u, location.href); url.searchParams.set('now', cacheBust()); return url.pathname + '?' + url.searchParams.toString(); } catch { return u; } }

    function iconFor(href){
      try {
        if (href.includes('/games/faro/')) return '/assets/images/faro-logo.png';
        if (href.includes('/games/poker/')) return '/assets/images/texas-holdem-logo.png';
        if (href.includes('/games/hazard/')) return '/assets/images/hazard-logo.png';
        if (href.includes('/games/shell/')) return '/assets/images/shell-game-logo.png';
        if (href.includes('/games/dakchog/')) return '/assets/images/dakandchog-logo.png';
        if (href.includes('/rules')) return '/assets/images/d-and-c.png';
        return '/assets/images/d-and-c.png';
      } catch { return '/assets/images/d-and-c.png'; }
    }

    for (const { href, label } of links) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = withNow(href);
      // Build icon + text spans so we can toggle in collapsed state
      const ico = document.createElement('img');
      ico.className = 'sb-ico';
      ico.alt = label;
      ico.src = iconFor(href);
      ico.style.cssText = 'width:24px;height:24px;object-fit:contain;display:none;vertical-align:middle;';
      const sp = document.createElement('span');
      sp.className = 'sb-text';
      sp.textContent = label;
      sp.style.cssText = 'margin-left:8px;';
      a.appendChild(ico);
      a.appendChild(sp);
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
    footer.innerHTML = '<div class="sb-net">Loading networkâ€¦</div>';
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
    function refreshCollapsedPresentation() {
      try {
        const collapsed = nav.classList.contains('collapsed');
        // Kill any CSS bullet pseudo-element by injecting an override style once
        if (!document.getElementById('sb-no-bullets')) {
          const st = document.createElement('style');
          st.id = 'sb-no-bullets';
          st.textContent = '.sidebar.collapsed .sidebar-links li a::after{ content:"" !important; }';
          document.head.appendChild(st);
        }
        list.querySelectorAll('a').forEach(a => {
          const ico = a.querySelector('img.sb-ico');
          const txt = a.querySelector('span.sb-text');
          if (collapsed) {
            if (ico) ico.style.display = 'inline-block';
            if (txt) txt.style.display = 'none';
            a.style.textIndent = '0';
            a.style.display = 'flex';
            a.style.alignItems = 'center';
            a.style.justifyContent = 'center';
            a.style.gap = '0';
          } else {
            if (ico) ico.style.display = 'none';
            if (txt) txt.style.display = '';
            a.style.textIndent = '';
            a.style.display = '';
            a.style.alignItems = '';
            a.style.justifyContent = '';
            a.style.gap = '';
          }
        });
      } catch {}
    }

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
        refreshCollapsedPresentation();
      } catch {}
    }
    updateSidebarOffset();

    // Relocate any stray network/contract pills into the footer
    function movePills(){
      try {
        const targets = [
          document.getElementById('network-banner'),
          document.getElementById('nb-top-info'),
          document.querySelector('[data-network-pill]'),
        ].filter(Boolean);
        targets.forEach(el => { if (el && !footer.contains(el)) footer.appendChild(el); });
      } catch {}
    }
    movePills(); setTimeout(movePills, 300); setTimeout(movePills, 1000);

    // Ensure a top-right wallet pill exists and stays updated across pages
    (function walletPill(){
      try {
        let pill = document.getElementById('wallet-inline');
        if (!pill){
          pill = document.createElement('div');
          pill.id = 'wallet-inline';
          pill.style.cssText = 'position:fixed;top:12px;right:12px;z-index:12000;display:flex;align-items:center;gap:8px;background: var(--panel-bg-soft); border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:6px 10px; color:#f4e6d3;'
          pill.innerHTML = '<span id="wi-balance"></span><span id="wi-label">Wallet:</span><span id="wi-address">-</span><button id="wi-disconnect" style="display:none">Disconnect</button>';
          document.body.appendChild(pill);
        } else {
          if (!document.getElementById('wi-balance')){
            const bal = document.createElement('span'); bal.id = 'wi-balance';
            pill.prepend(bal);
          }
        }
        function short(a){ try { return (a && a.length>10) ? (a.slice(0,6)+'...'+a.slice(-4)) : (a||''); } catch { return a||''; } }
        function parseSavedAddress(){ try { var msg=sessionStorage.getItem('walletMsg')||localStorage.getItem('walletMsg')||''; var m=msg.match(/Address:\s*(0x[a-fA-F0-9]{40})/); return m?m[1]:''; } catch { return ''; } }
        async function refreshBalance(addr){
          try {
            if (!addr) return;
            const _ethers = window.ethers || (await import('https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js')).ethers;
            let prov=null; try{ prov = window.__getSelectedProvider? window.__getSelectedProvider(): null; }catch{}
            if(!prov && window.ethereum) prov=window.ethereum;
            if(!prov) return;
            const provider = new _ethers.providers.Web3Provider(prov,'any');
            const wei = await provider.getBalance(addr);
            const mon = Number(_ethers.utils.formatEther(wei));
            const el=document.getElementById('wi-balance'); if (el) el.textContent = isFinite(mon) ? (mon.toFixed(mon>=1?3:5) + ' MON') : '';
          } catch {}
        }
        function render(addr){
          try {
            const span=document.getElementById('wi-address'); if (span) span.textContent = short(String(addr||''));
            const btn=document.getElementById('wi-disconnect'); if (btn) { btn.style.display=''; btn.onclick=function(){ try{ localStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletConnected'); sessionStorage.removeItem('walletProvider'); sessionStorage.removeItem('walletMsg'); sessionStorage.removeItem('walletSig'); }catch(_){} try{ location.replace('/landing.html'); }catch(_){} }; }
            refreshBalance(addr);
          } catch {}
        }
        try { var saved = (sessionStorage.getItem('walletAddress')||localStorage.getItem('walletAddress')||''); if(saved) render(saved); else { var b=parseSavedAddress(); if(b) render(b); } } catch {}
        window.addEventListener('wallet:connected', function(ev){ try { var a=String(ev?.detail?.address||''); if (a) render(a); } catch {} });
      } catch {}
    })();

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
