// Minimal EIP-5792 bundler utilities
// Works with EIP-1193 providers (MetaMask Smart Accounts, etc.)

function resolveInjected() {
  try { return window.__walletProvider || window.ethereum; } catch { return undefined; }
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

try { window.Bundler = { detectBundler, walletSendCalls, extractTxHash, waitForTransactionReceipt }; } catch {}

export function extractTxHash(result) {
  if (!result) return null;
  if (typeof result === 'string' && result.startsWith('0x') && result.length >= 66) return result;
  if (Array.isArray(result)) {
    for (const item of result) {
      const hash = extractTxHash(item);
      if (hash) return hash;
    }
    return null;
  }
  if (typeof result === 'object') {
    if (typeof result.hash === 'string' && result.hash.startsWith('0x')) return result.hash;
    if (typeof result.txHash === 'string' && result.txHash.startsWith('0x')) return result.txHash;
    if (typeof result.transactionHash === 'string' && result.transactionHash.startsWith('0x')) return result.transactionHash;
    if (result.result != null) return extractTxHash(result.result);
  }
  return null;
}

function unwrapProvider(providerLike) {
  if (!providerLike) return undefined;
  if (providerLike.provider) return providerLike.provider;
  return providerLike;
}

export async function waitForTransactionReceipt(providerLike, hash, timeoutMs = 120000, confirmations = 1) {
  if (!hash) return null;
  const provider = unwrapProvider(providerLike) || unwrapProvider(resolveInjected());
  if (!provider || typeof provider.waitForTransaction !== 'function') {
    if (!provider || typeof provider.getTransactionReceipt !== 'function') return null;
    try { return await provider.getTransactionReceipt(hash); } catch { return null; }
  }
  try {
    const receipt = await provider.waitForTransaction(hash, confirmations, timeoutMs);
    return receipt || null;
  } catch (err) {
    try { return await provider.getTransactionReceipt(hash); } catch { return null; }
  }
}

