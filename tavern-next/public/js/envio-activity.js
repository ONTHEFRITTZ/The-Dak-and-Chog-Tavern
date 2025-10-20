// js/envio-activity.js (helper-only)
// Provides helpers to fetch recent events and compute an activity score.

export function getEnvioUrl() {
  try {
    if (typeof window.ENVIO_HYPERSYNC_URL === 'string' && window.ENVIO_HYPERSYNC_URL) return window.ENVIO_HYPERSYNC_URL;
  } catch {}
  try {
    const ls = localStorage.getItem('envio.hypersync.url');
    if (ls) return ls;
  } catch {}
  try { return location.origin; } catch { return ''; }
}

// Allow UI to set the HyperSync/HyperIndex endpoint at runtime
export function setEnvioUrl(url) {
  try {
    const v = String(url || '').trim();
    if (v) {
      localStorage.setItem('envio.hypersync.url', v);
      window.ENVIO_HYPERSYNC_URL = v;
    } else {
      localStorage.removeItem('envio.hypersync.url');
    }
  } catch {}
}

function isGraphQlEndpoint(u) {
  try { return /graphql/i.test(String(u || '')); } catch { return false; }
}

async function tryGraphQl(endpoint, limit) {
  const queries = [
    {
      q: `query Recent($limit: Int!) { Activity(limit: $limit, order_by: { blockTimestamp: desc }) { event player seat handId amount winners payouts rake txHash blockNumber blockTimestamp } }`,
      pick: (data) => data?.Activity
    },
    {
      q: `query Recent($limit: Int!) { activities(limit: $limit, order_by: { blockTimestamp: desc }) { event player seat handId amount winners payouts rake txHash blockNumber blockTimestamp } }`,
      pick: (data) => data?.activities
    },
    {
      q: `query Recent($limit: Int!) { Activitys(limit: $limit, orderBy: blockTimestamp_DESC) { event player seat handId amount winners payouts rake txHash blockNumber blockTimestamp } }`,
      pick: (data) => data?.Activitys
    }
  ];
  for (const { q, pick } of queries) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, variables: { limit: Number(limit || 10) } }),
        cache: 'no-store'
      });
      if (!res.ok) continue;
      const json = await res.json();
      const items = pick(json?.data || {});
      if (Array.isArray(items)) return items;
    } catch {}
  }
  return null;
}

export async function fetchRecentEvents({ endpoint, tableAddress, limit = 10 }) {
  // Resolve configured endpoint (ignore caller override)
  try { endpoint = getEnvioUrl(); } catch {}

  // If a GraphQL endpoint is provided, try it first
  if (endpoint && isGraphQlEndpoint(endpoint)) {
    const items = await tryGraphQl(endpoint, limit);
    if (Array.isArray(items)) return items;
    // Fallback to local server if GraphQL fails
    try { endpoint = (location && location.origin) || ''; } catch { endpoint = ''; }
  }

  // REST fallbacks: use our realtime server aggregator
  const base = endpoint || (typeof location !== 'undefined' ? (location.origin || '') : '');
  const urls = [
    `${base}/events?address=${encodeURIComponent(tableAddress || '')}&limit=${limit}`,
    `${base}/api/events?address=${encodeURIComponent(tableAddress || '')}&limit=${limit}`,
    `${base}/api/v1/events?contract=${encodeURIComponent(tableAddress || '')}&limit=${limit}`,
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



