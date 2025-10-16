// js/envio-activity.js
// Lightweight Envio integration: fetch and render recent on-chain activity.
// - Reads endpoint from window.ENVIO_HYPERSYNC_URL or localStorage['envio.hypersync.url']
// - Tries a couple of common shapes; renders gracefully if endpoint is missing

function getEnvioUrl() {
  try { if (typeof window.ENVIO_HYPERSYNC_URL === 'string' && window.ENVIO_HYPERSYNC_URL) return window.ENVIO_HYPERSYNC_URL; } catch {}
  try { const u = localStorage.getItem('envio.hypersync.url'); if (u) return u; } catch {}
  // Safe default: same-origin server route added in server/realtime.js
  try { return location.origin; } catch { return ''; }
}

function ensurePanel() {
  let host = document.getElementById('envio-activity');
  if (!host) {
    host = document.createElement('div');
    host.id = 'envio-activity';
    host.style.cssText = [
      'position:fixed','bottom:12px','left:12px','z-index:12000',
      'max-width:380px','min-width:260px','color:#f4e6d3',
      'background:rgba(0,0,0,0.45)','backdrop-filter:blur(6px)',
      'border:1px solid rgba(255,255,255,0.15)','border-radius:12px','padding:8px 10px',
      'font-size:12px','box-shadow:0 10px 24px rgba(0,0,0,0.35)'
    ].join(';');
    const h = document.createElement('div');
    h.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px';
    const title = document.createElement('strong');
    title.textContent = 'Table Activity';
    title.style.cssText = 'font-size:12px;letter-spacing:0.03em';
    const right = document.createElement('div'); right.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const status = document.createElement('span'); status.id = 'envio-status'; status.textContent = 'loading…'; status.style.opacity = '0.85';
    const close = document.createElement('button'); close.textContent = '×'; close.style.cssText = 'cursor:pointer;background:transparent;border:none;color:#f4e6d3;font-size:16px;';
    close.addEventListener('click', ()=> host.style.display = 'none');
    right.appendChild(status); right.appendChild(close);
    h.appendChild(title); h.appendChild(right);
    const list = document.createElement('div'); list.id = 'envio-list'; list.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto;';
    host.appendChild(h); host.appendChild(list);
    (document.body || document.documentElement).appendChild(host);
  }
  return host;
}

function short(addr){ try { return addr && addr.length>10 ? addr.slice(0,6)+'…'+addr.slice(-4) : (addr||''); } catch { return addr||''; } }

async function fetchRecentEvents({ endpoint, tableAddress, limit = 10 }) {
  // Try a few shapes so we can demo regardless of specific indexer mapping.
  const urls = [
    `${endpoint}/events?address=${encodeURIComponent(tableAddress)}&limit=${limit}`,
    `${endpoint}/api/events?address=${encodeURIComponent(tableAddress)}&limit=${limit}`,
    `${endpoint}/api/v1/events?contract=${encodeURIComponent(tableAddress)}&limit=${limit}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const json = await res.json();
      // Normalize a few possible shapes
      if (Array.isArray(json)) return json;
      if (Array.isArray(json?.items)) return json.items;
      if (Array.isArray(json?.data)) return json.data;
    } catch {}
  }
  return [];
}

function render(items) {
  const host = ensurePanel();
  const list = host.querySelector('#envio-list');
  const status = host.querySelector('#envio-status');
  list.innerHTML = '';
  if (!Array.isArray(items) || !items.length) {
    status.textContent = 'no recent events';
    return;
  }
  status.textContent = `${items.length} events`;
  items.slice(0, 10).forEach((ev) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;background:rgba(0,0,0,0.25);padding:4px 6px;border-radius:8px;';
    const when = document.createElement('span'); when.style.opacity = '0.85';
    let ts = ev.blockTimestamp || ev.timestamp || ev.time || 0;
    try { if (typeof ts === 'string') ts = Date.parse(ts)/1000; } catch {}
    const dt = ts ? new Date(ts*1000) : new Date();
    when.textContent = dt.toLocaleTimeString();
    const what = document.createElement('span'); what.style.fontWeight = '600';
    const name = ev.event || ev.name || ev.type || 'event';
    const from = (ev.args?.player || ev.args?.from || ev.from || '').toString();
    const to = (ev.args?.to || ev.to || '').toString();
    what.textContent = name;
    const who = document.createElement('span'); who.style.opacity = '0.9'; who.textContent = [from||'', to?`→ ${short(to)}`:''].filter(Boolean).join(' ');
    row.appendChild(when); row.appendChild(document.createTextNode(' ')); row.appendChild(what); row.appendChild(document.createTextNode(' ')); row.appendChild(who);
    list.appendChild(row);
  });
}

async function main() {
  const endpoint = getEnvioUrl();
  if (!endpoint) return; // quietly no-op if not configured
  let tableAddress = '';
  try { if (window.HoldemPokerAddress) tableAddress = window.HoldemPokerAddress; } catch {}
  if (!tableAddress) {
    try {
      // Best-effort: derive from config
      const mod = await import('/js/config.js');
      tableAddress = (mod && mod.CONTRACTS && mod.CONTRACTS.pokerTable) || '';
    } catch {}
  }
  if (!tableAddress) return;
  ensurePanel();
  try {
    const items = await fetchRecentEvents({ endpoint, tableAddress, limit: 10 });
    render(items);
  } catch {
    // best-effort only
  }
}

try { main().catch(()=>{}); } catch {}

// Expose simple helpers for reward/active scoring demo
export async function getActiveScoreFor(address) {
  const endpoint = getEnvioUrl();
  if (!endpoint) return 0;
  let tableAddress = '';
  try { tableAddress = window.HoldemPokerAddress || ''; } catch {}
  if (!tableAddress) return 0;
  const items = await fetchRecentEvents({ endpoint, tableAddress, limit: 100 });
  const addr = String(address||'').toLowerCase();
  let score = 0;
  for (const ev of items) {
    const from = (ev.args?.player || ev.args?.from || ev.from || '').toString().toLowerCase();
    if (from && addr && from === addr) score += 1;
  }
  return score;
}
