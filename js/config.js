// Shared contract addresses for the Tavern and games
// - Supports per-chain mapping with a sensible default
// - Allows runtime overrides via URL params or localStorage

// Base defaults (used when no chain-specific mapping exists)
const DEFAULT_ADDRESSES = {
  shell: "0x0055522ef5BB9922E916739456F6FA73a8f20dFc",
  hazard: "0x9cedd769cd1CD5cC52D8b3c46ec31c61b7c5dE10",
};

// Address book keyed by chainId (as number or string) or "default"
// Add entries like 1, 11155111, etc. when you deploy to new chains.
export const ADDRESS_BOOK = {
  default: { ...DEFAULT_ADDRESSES },
  // 1: { shell: "0x...", hazard: "0x..." },
  // 11155111: { shell: "0x...", hazard: "0x..." },
};

export const SHELL_ADDRESS = DEFAULT_ADDRESSES.shell;
export const HAZARD_ADDRESS = DEFAULT_ADDRESSES.hazard;

export const CONTRACTS = { ...DEFAULT_ADDRESSES };

function getUrlOverride(key) {
  try {
    const url = new URL(window.location.href);
    const val = url.searchParams.get(`contract.${key}`);
    return val && /^0x[0-9a-fA-F]{40}$/.test(val) ? val : null;
  } catch {
    return null;
  }
}

function getLocalOverride(key) {
  try {
    const val = localStorage.getItem(`contract.${key}`);
    return val && /^0x[0-9a-fA-F]{40}$/.test(val) ? val : null;
  } catch {
    return null;
  }
}

export function getAddress(contractKey, chainId) {
  const override = getUrlOverride(contractKey) || getLocalOverride(contractKey);
  if (override) return override;
  const idKey = chainId != null ? String(chainId) : null;
  const byChain = (idKey && ADDRESS_BOOK[idKey]) || ADDRESS_BOOK.default;
  return byChain?.[contractKey] || DEFAULT_ADDRESSES[contractKey];
}

export async function detectChainId(provider) {
  try {
    if (provider?.getNetwork) {
      const net = await provider.getNetwork();
      return Number(net.chainId);
    }
  } catch {}
  try {
    if (window?.ethereum?.request) {
      const hex = await window.ethereum.request({ method: 'eth_chainId' });
      return parseInt(hex, 16);
    }
  } catch {}
  return undefined;
}

export async function getAddressFor(contractKey, provider) {
  const chainId = await detectChainId(provider);
  return getAddress(contractKey, chainId);
}

// Chain name helpers and banner rendering
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
    if (!window?.ethereum?.request) throw new Error('No wallet provider');
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
    return true;
  } catch (err) {
    console.warn('Switch network error', err);
    return false;
  }
}

export function renderNetworkBanner({ contractKey, address, chainId, wallet }) {
  try {
    const root = document.querySelector('.tavern') || document.body;
    let el = document.getElementById('network-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'network-banner';
      el.style.cssText = [
        'margin: 8px auto',
        'padding: 8px 12px',
        'max-width: 1280px',
        'font-size: 30px',
        'border-radius: 8px',
        'background: rgba(0,0,0,0.08)',
        'color: #2b1e12',
        'display:flex',
          'flex-wrap:nowrap',
          'gap:4px',
          'align-items:center',
          'justify-content:center',
          'text-align:center',
      ].join(';');
      if (root.firstChild) root.insertBefore(el, root.firstChild); else root.appendChild(el);
    }
    const name = getChainName(chainId);
    const keyLabel = contractKey ? contractKey.charAt(0).toUpperCase() + contractKey.slice(1) : 'Contract';
    const addrShort = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'N/A';
    const explorer = explorerAddressUrl(chainId, address);
    const mismatch = chainId != null && !ADDRESS_BOOK[String(chainId)];
    const targetChainKey = Object.keys(ADDRESS_BOOK).find(k => k !== 'default' && !isNaN(Number(k)));
    const targetChainId = targetChainKey ? Number(targetChainKey) : null;
    const walletShort = wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : '';

      el.innerHTML = `
        <div style="display:flex; align-items:center; white-space:nowrap; gap:6px;">
          <strong>Network:</strong> ${name}${chainId ? ` (${chainId})` : ''}
          ${mismatch ? '<span style="margin-left:8px;padding:2px 6px;border-radius:6px;background:#9200fa;color:#fff;">Using default address</span>' : ''}
          <span style="margin-left:6px; white-space:nowrap;"><strong>${keyLabel}:</strong> ${explorer ? `<a id="nb-addr" href="${explorer}" target="_blank" rel="noopener" style="white-space:nowrap; display:inline-block; letter-spacing:0; word-spacing:0; font-variant-ligatures:none;">${addrShort}</a>` : addrShort}
          </span>
        </div>
        <div style="display:flex; align-items:center; white-space:nowrap; gap:6px;">
          ${wallet ? `<span title="Connected wallet" style="margin-right:4px; white-space:nowrap; display:inline-block; letter-spacing:0; word-spacing:0; font-variant-ligatures:none;">${walletShort}</span>` : ''}
          ${mismatch && window?.ethereum && targetChainId ? `<button id="nb-switch" style="padding:4px 8px;border-radius:6px;cursor:pointer;">Switch to ${getChainName(targetChainId)}</button>` : ''}
          ${address ? '<button id="nb-copy" style="margin-left:6px;padding:4px 8px;border-radius:6px;cursor:pointer;">Copy</button>' : ''}
        </div>
      `;

    const copyBtn = el.querySelector('#nb-copy');
    if (copyBtn && address) {
      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(address); copyBtn.textContent = 'Copied'; setTimeout(()=>copyBtn.textContent='Copy', 1200); } catch {}
      };
    }
    const switchBtn = el.querySelector('#nb-switch');
    if (switchBtn && targetChainId != null) {
      switchBtn.onclick = async () => {
        const hex = '0x' + Number(targetChainId).toString(16);
        await switchToChain(hex);
      };
    }
  } catch {
    // no-op if DOM not available
  }
}

// Clean banner variant with explorer/Copy/Disconnect and optional Switch button
export function renderTavernBanner({ contractKey, address, chainId, wallet, labelOverride }) {
  try {
    const root = document.querySelector('.tavern') || document.body;
    let el = document.getElementById('network-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'network-banner';
      el.style.cssText = [
        'margin: 8px auto',
        'padding: 8px 12px',
        'max-width: 1280px',
        'font-size: 30px',
        'border-radius: 8px',
        'background: rgba(0,0,0,0.08)',
        'color: #2b1e12',
        'display:flex',
          'flex-wrap:nowrap',
          'gap:4px',
          'align-items:center',
          'justify-content:center',
          'text-align:center',
      ].join(';');
      if (root.firstChild) root.insertBefore(el, root.firstChild); else root.appendChild(el);
    }
    const name = getChainName(chainId);
    const keyLabel = labelOverride || (contractKey ? contractKey.charAt(0).toUpperCase() + contractKey.slice(1) : 'Contract');
    const short = (v) => (v && v.length > 10 ? `${v.slice(0,6)}...${v.slice(-4)}` : (v||'N/A'));
    const explorer = explorerAddressUrl(chainId, address);
    const mismatch = chainId != null && !ADDRESS_BOOK[String(chainId)];
    const targetChainKey = Object.keys(ADDRESS_BOOK).find(k => k !== 'default' && !isNaN(Number(k)));
    const targetChainId = targetChainKey ? Number(targetChainKey) : null;

    el.innerHTML = `
      <div style="display:flex; align-items:center; white-space:nowrap; gap:6px;">
        <strong>Network:</strong> ${name}${chainId ? ` (${chainId})` : ''}
        ${mismatch ? '<span style="margin-left:8px;padding:2px 6px;border-radius:6px;background:#9200fa;color:#fff;">Using default address</span>' : ''}
        <span style="margin-left:6px; white-space:nowrap;"><strong>${keyLabel}:</strong> ${explorer ? `<a id="nb-addr" href="${explorer}" target="_blank" rel="noopener" style="white-space:nowrap; display:inline-block; letter-spacing:0; word-spacing:0; font-variant-ligatures:none;">${short(address)}</a>` : short(address)}
        </span>
      </div>
      <div style="display:flex; align-items:center; white-space:nowrap; gap:6px;">
        ${wallet ? `<span title=\"Connected wallet\" style=\"margin-right:4px; white-space:nowrap; display:inline-block; letter-spacing:0; word-spacing:0; font-variant-ligatures:none;\">${short(wallet)}</span>` : ''}
        ${mismatch && window?.ethereum && targetChainId ? `<button id="nb-switch" style="padding:4px 8px;border-radius:6px;cursor:pointer;">Switch to ${getChainName(targetChainId)}</button>` : ''}
        ${address ? '<button id="nb-copy" style="margin-left:6px;padding:4px 8px;border-radius:6px;cursor:pointer;">Copy</button>' : ''}
        ${wallet ? '<button id="nb-disconnect" style="margin-left:6px;padding:4px 8px;border-radius:6px;cursor:pointer;">Disconnect</button>' : ''}
      </div>
    `;

    const copyBtn = el.querySelector('#nb-copy');
    if (copyBtn && address) {
      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(address); copyBtn.textContent = 'Copied'; setTimeout(()=>copyBtn.textContent='Copy', 1200); } catch {}
      };
    }
    const switchBtn = el.querySelector('#nb-switch');
    if (switchBtn && targetChainId != null) {
      switchBtn.onclick = async () => {
        const hex = '0x' + Number(targetChainId).toString(16);
        await switchToChain(hex);
      };
    }
    const disconnectBtn = el.querySelector('#nb-disconnect');
    if (disconnectBtn) {
      disconnectBtn.onclick = () => {
        try { sessionStorage.removeItem('walletConnected'); } catch {}
        try { location.reload(); } catch {}
      };
    }
  } catch {}
}

// Lightweight toast notifications
export function showToast(message, type = 'info', duration = 2600) {
  try {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = [
        'position:fixed','top:16px','right:16px','z-index:9999',
        'display:flex','flex-direction:column','gap:8px'
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
      'min-width: 220px','max-width: 360px','padding:10px 12px','border-radius:8px',
      `background:${c.bg}`,`color:${c.fg}`,'box-shadow:0 6px 16px rgba(0,0,0,0.18)',
      'font-size:14px','opacity:0','transform:translateY(-6px)','transition:opacity .2s ease, transform .2s ease'
    ].join(';');
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
    setTimeout(() => {
      toast.style.opacity = '0'; toast.style.transform = 'translateY(-6px)';
      setTimeout(() => { try { container.removeChild(toast); } catch {} }, 220);
    }, Math.max(800, Number(duration)||2600));
  } catch {}
}
