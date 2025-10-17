async function foo(){ const cfg = await import(`/js/config.js?v=${encodeURIComponent(Date.now())}`); }
