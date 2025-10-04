\n    // Footer removed per requirements; nav appended without network panel.\n    document.body.appendChild(nav);

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
    function movePills(){ /* removed */ });
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
