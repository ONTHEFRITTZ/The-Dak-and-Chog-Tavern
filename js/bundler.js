// Minimal EIP-5792 bundler utilities
// Works with EIP-1193 providers (MetaMask Smart Accounts, etc.)

function resolveInjected() {
  try { return window.__walletProvider || (window.phantom && window.phantom.ethereum) || window.ethereum; } catch { return undefined; }
}

export async function detectBundler(explicitProvider) {
  const provider = explicitProvider || resolveInjected();
  if (!provider || typeof provider.request !== 'function') return { provider: null, available: false };
  try {
    const caps = await provider.request({ method: 'wallet_getCapabilities' }).catch(() => null);
    const hasSendCalls = !!(caps && (caps['wallet_sendCalls'] || caps['wallet_sendCalls:1']));
    const supports = hasSendCalls || true; // optimistic; we'll catch on actual call
    return { provider, available: !!supports };
  } catch {
    return { provider, available: false };
  }
}

export async function walletSendCalls({ provider, from, chainId, calls }) {
  if (!provider || typeof provider.request !== 'function') throw new Error('No EIP-1193 provider');
  if (!Array.isArray(calls) || !calls.length) throw new Error('No calls');
  const normCalls = calls.map(c => ({ to: c.to, data: c.data || '0x', value: c.value || '0x0' }));
  const params = [{ from, chainId, calls: normCalls }];
  try { return await provider.request({ method: 'wallet_sendCalls', params }); } catch (e) {
    try { return await provider.request({ method: 'wallet_sendCalls:1', params }); } catch (e2) {
      throw (e2 || e);
    }
  }
}

try { window.Bundler = { detectBundler, walletSendCalls }; } catch {}
