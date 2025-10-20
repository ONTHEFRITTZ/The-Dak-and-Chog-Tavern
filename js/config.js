// -------------------- AA / Paymaster config --------------------
const DEFAULT_PIMLICO_RPC = "https://api.pimlico.io/v2/monad-testnet/rpc";

const ALCHEMY_BUNDLER_OVERRIDE = runtimeConfigValue("ALCHEMY_BUNDLER_RPC", "");
const PIMLICO_BUNDLER_OVERRIDE = runtimeConfigValue("PIMLICO_BUNDLER_RPC", "");
const MONAD_BUNDLER_OVERRIDE = runtimeConfigValue("MONAD_BUNDLER_RPC", DEFAULT_PIMLICO_RPC);

export const MONAD_BUNDLER_RPC =
  ALCHEMY_BUNDLER_OVERRIDE ||
  PIMLICO_BUNDLER_OVERRIDE ||
  MONAD_BUNDLER_OVERRIDE;
export const PIMLICO_BUNDLER_RPC = PIMLICO_BUNDLER_OVERRIDE || "";

function runtimeConfigValue(key, fallback = "") {
  try {
    if (typeof window !== "undefined" && window && typeof window[key] === "string") {
      const value = window[key].trim();
      if (value) return value;
    }
  } catch {}
  return fallback;
}

// Your self-funded paymaster contract (you deployed this)
export const PAYMASTER_ADDRESS = "0x225526A98049aCAFb71bB9526dd431E1A114E048";

// Paymaster RPC (prefer Pimlico, fall back to legacy ZeroDev names)
const ALCHEMY_PAYMASTER_OVERRIDE = runtimeConfigValue("ALCHEMY_PAYMASTER_RPC", "");
const PIMLICO_PAYMASTER_OVERRIDE = runtimeConfigValue("PIMLICO_PAYMASTER_RPC", "");
const ZD_PAYMASTER_OVERRIDE = runtimeConfigValue("ZD_PAYMASTER_RPC", DEFAULT_PIMLICO_RPC);

const PAYMASTER_RPC =
  ALCHEMY_PAYMASTER_OVERRIDE ||
  PIMLICO_PAYMASTER_OVERRIDE ||
  ZD_PAYMASTER_OVERRIDE;
export const ZD_PAYMASTER_RPC = PAYMASTER_RPC;
export const PIMLICO_PAYMASTER_RPC = PAYMASTER_RPC;

const PAYMASTER_API_KEY =
  runtimeConfigValue(
    "ALCHEMY_API_KEY",
    runtimeConfigValue(
      "PIMLICO_API_KEY",
      runtimeConfigValue("ZD_API_KEY", "")
    )
  );
export const ZD_API_KEY = PAYMASTER_API_KEY;
export const PIMLICO_API_KEY = PAYMASTER_API_KEY;
export const ALCHEMY_API_KEY = PAYMASTER_API_KEY;

const PAYMASTER_POLICY_ID =
  runtimeConfigValue("PIMLICO_POLICY_ID", "");
export const PIMLICO_POLICY_ID = PAYMASTER_POLICY_ID;

// Primary Monad network metadata (shared by lobby, AA, bankroll helpers)
export const MONAD = {
  id: 10143,
  name: 'Monad Testnet',
  rpcHttp: 'https://monad-testnet.drpc.org',
  explorer: 'https://testnet.monadexplorer.com',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }
};

try {
  if (typeof window !== 'undefined') {
    if (!window.MONAD) window.MONAD = MONAD;
    if (!window.RPC_ENDPOINTS) window.RPC_ENDPOINTS = {};
    if (!window.RPC_ENDPOINTS[MONAD.id]) window.RPC_ENDPOINTS[MONAD.id] = MONAD.rpcHttp;
    if (!window.EXPLORERS) window.EXPLORERS = {};
    if (!window.EXPLORERS[MONAD.id]) window.EXPLORERS[MONAD.id] = MONAD.explorer;
  }
} catch {}

// -------------------- Shared contract addresses --------------------
// Base defaults (used when no chain-specific mapping exists)
const DEFAULT_ADDRESSES = {
  tavern: "", // router removed; games use dedicated addresses
  faro:   "0x953f1Bba2eeEa57482037377BD5103cEbA85C987",
  pool:   "0x31574064907cbE75C61Fea28C545264817A9AA4a",
  wmon:   "0x7b4E8B2a3E934701D8bF6cFB31C3f3BDaC5e30Ff",
  dcmon:  "0x3AcbbD49603D8140C0acbf13E3471DBF691b2Bd7",
  hazard:   "0xb0103807b4B758945331BF6783873Cd776037f89",
  shell:   "0x7Ff5A1b0d71eE4C66D24121D2E68D7844704D377",
  dakchog:   "0xa8F48cccE4968F5bf40f3411B2265cEBDB517ADf",
  pokerTable:   "0x424F89FE230331df8f656B683812b6394c323f17",
};

// Address book keyed by chainId (as number or string) or "default"
export const ADDRESS_BOOK = {
  default: { ...DEFAULT_ADDRESSES },
  10143: { // Monad Testnet
    tavern: "",
    faro: "0x953f1Bba2eeEa57482037377BD5103cEbA85C987",
    pool:   "0x31574064907cbE75C61Fea28C545264817A9AA4a",
    wmon:   "0x7b4E8B2a3E934701D8bF6cFB31C3f3BDaC5e30Ff",
    dcmon:  "0x3AcbbD49603D8140C0acbf13E3471DBF691b2Bd7",
    hazard: "0xb0103807b4B758945331BF6783873Cd776037f89",
    shell: "0x7Ff5A1b0d71eE4C66D24121D2E68D7844704D377",
    dakchog: "0xa8F48cccE4968F5bf40f3411B2265cEBDB517ADf",
    pokerTable: "0x424F89FE230331df8f656B683812b6394c323f17",
  },
};
export const TAVERN_ADDRESS = DEFAULT_ADDRESSES.tavern;
export const CONTRACTS = { ...DEFAULT_ADDRESSES };

export function getAddress(contractKey, chainId) {
  const idKey = chainId != null ? String(chainId) : null;
  const byChain = (idKey && ADDRESS_BOOK[idKey]);
  if (!byChain) return undefined;
  return byChain[contractKey];
}

export async function detectChainId(provider) {
  try {
    if (provider?.getNetwork) {
      const net = await provider.getNetwork();
      return Number(net.chainId);
    }
  } catch {}
  try {
    const injected = (window && window.__walletProvider) || (window && window.ethereum);
    if (injected && typeof injected.request === 'function') {
      const hex = await injected.request({ method: 'eth_chainId' });
      return parseInt(hex, 16);
    }
  } catch {}
  return undefined;
}

export async function getAddressFor(contractKey, provider) {
  const chainId = await detectChainId(provider);
  return getAddress(contractKey, chainId);
}

// Chain names / explorers
export const CHAIN_NAMES = {
  1: 'Ethereum',
  5: 'Goerli',
  10: 'Optimism',
  56: 'BSC',
  100: 'Gnosis',
  137: 'Polygon',
  8453: 'Base',
  84532: 'Base Sepolia',
  42161: 'Arbitrum One',
  43114: 'Avalanche',
  11155111: 'Sepolia',
  10143: 'Monad Testnet',
};

export const EXPLORERS = {
  1: 'https://etherscan.io',
  5: 'https://goerli.etherscan.io',
  10: 'https://optimistic.etherscan.io',
  56: 'https://bscscan.com',
  100: 'https://gnosisscan.io',
  137: 'https://polygonscan.com',
  8453: 'https://basescan.org',
  84532: 'https://sepolia.basescan.org',
  42161: 'https://arbiscan.io',
  43114: 'https://snowtrace.io',
  11155111: 'https://sepolia.etherscan.io',
  10143: 'https://testnet.monadexplorer.com',
};

// Optional: RPC endpoints for convenience
export const RPC_ENDPOINTS = {
  10143: 'wss://monad-testnet.drpc.org',
};

export function getChainName(chainId) {
  if (chainId == null) return 'Unknown';
  const id = Number(chainId);
  return CHAIN_NAMES[id] || `Chain ${id}`;
}

export function explorerAddressUrl(chainId, address) {
  const base = EXPLORERS[Number(chainId)];
  if (!base || !address) return null;
  return `${base}/address/${address}`;
}

export async function switchToChain(chainIdHex) {
  try {
    const injected = (window && window.__walletProvider) || (window && window.ethereum);
    if (!injected || typeof injected.request !== 'function') throw new Error('No wallet provider');
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
    return true;
  } catch (err) {
    console.warn('Switch network error', err);
    return false;
  }
}

// --- UI helpers (unchanged) ---
export function renderNetworkBanner() { try { const el=document.getElementById('network-banner'); if (el) el.remove(); } catch {} return; }

// Clean banner variant (unchanged)
export function renderTavernBanner() { try { const a=document.getElementById('nb-top-info'); if (a) a.remove(); } catch {} try { const b=document.getElementById('network-banner'); if (b) b.remove(); } catch {} return; }

// Toasts (unchanged)
export function showToast(message, type = 'info', duration = 2600) {
  try {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = [
        'position:fixed','top:16px','left:50%','transform:translateX(-50%)',
        'z-index:100000','display:flex','flex-direction:column','gap:8px','align-items:center'
      ].join(';');
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const colors = {
      info:  { bg: 'rgba(50, 115, 220, 0.95)', fg: '#fff' },
      success: { bg: 'rgba(40, 167, 69, 0.95)', fg: '#fff' },
      error: { bg: 'rgba(220, 53, 69, 0.95)', fg: '#fff' },
    };
    const c = colors[type] || colors.info;
    toast.textContent = String(message || '');
    toast.style.cssText = [
      'min-width: 220px','max-width: 420px','padding:10px 12px','border-radius:8px',
      `background:${c.bg}`,`color:${c.fg}`,'box-shadow:0 6px 16px rgba(0,0,0,0.18)',
      'font-size:13px','opacity:0','transform:translateY(-6px)',
      'transition:opacity .2s ease, transform .2s ease','pointer-events:auto'
    ].join(';');
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
    setTimeout(() => {
      toast.style.opacity = '0'; toast.style.transform = 'translateY(-6px)';
      setTimeout(() => { try { container.removeChild(toast); } catch {} }, 220);
    }, Math.max(800, Number(duration)||2600));
  } catch {}
}
