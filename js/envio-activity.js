// js/envio-activity.js (helper-only)
// Provides helpers to fetch recent events and compute an activity score.

export function getEnvioUrl() {
  try { if (typeof window.ENVIO_HYPERSYNC_URL === 'string' && window.ENVIO_HYPERSYNC_URL) return window.ENVIO_HYPERSYNC_URL; } catch {}
  try { const u = localStorage.getItem('envio.hypersync.url'); if (u) return u; } catch {}
  try { return location.origin; } catch { return ''; }
}

export async function fetchRecentEvents({ endpoint, tableAddress, limit = 10 }) {
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
      if (Array.isArray(json)) return json;
      if (Array.isArray(json?.items)) return json.items;
      if (Array.isArray(json?.data)) return json.data;
    } catch {}
  }
  return [];
}

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



