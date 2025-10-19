// Minimal EIP-5792 bundler utilities
// Works with EIP-1193 providers (MetaMask Smart Accounts, etc.)
import { ZD_PAYMASTER_RPC, ZD_API_KEY } from './aa/config.js';

function resolveInjected() {
  try { return window.__walletProvider || window.ethereum; } catch { return undefined; }
}

export async function detectBundler(explicitProvider) {
  const provider = explicitProvider || resolveInjected();
  if (!provider || typeof provider.request !== 'function') return { provider: null, available: false };
  try {
    let caps = null; try { const accs = await provider.request({ method: 'eth_accounts' }).catch(() => []); const who = (Array.isArray(accs) && accs[0]) ? String(accs[0]) : null; if (who) { caps = await provider.request({ method: 'wallet_getCapabilities', params: [who] }).catch(() => null); } } catch {} if (!caps) { try { caps = await provider.request({ method: 'wallet_getCapabilities', params: [] }); } catch { try { caps = await provider.request({ method: 'wallet_getCapabilities' }); } catch { caps = null; } } }
    const hasSendCalls = !!(caps && (caps['wallet_sendCalls'] || caps['wallet_sendCalls:1']));
    const supports = !!hasSendCalls;
    return { provider, available: supports };
  } catch {
    return { provider, available: false };
  }
}

export async function walletSendCalls({ provider, from, chainId, calls }) {
  if (!provider || typeof provider.request !== 'function') throw new Error('No EIP-1193 provider');
  if (!Array.isArray(calls) || !calls.length) throw new Error('No calls');
  const normCalls = calls.map(c => ({ to: c.to, data: c.data || '0x', value: c.value || '0x0' }));
  // Include fields some MetaMask builds require
  const capabilities = {};
  try {
    if (ZD_PAYMASTER_RPC) {
      const headers = {};
      try {
        if (ZD_API_KEY) {
          headers['x-api-key'] = ZD_API_KEY;
          headers['authorization'] = `Bearer ${ZD_API_KEY}`;
        }
      } catch {}
      capabilities.paymasterService = {
        url: ZD_PAYMASTER_RPC,
        ...(Object.keys(headers).length ? { headers } : {})
      };
    }
  } catch {}
  const params = [{ from, chainId, calls: normCalls, version: '1', atomicRequired: false, capabilities }];
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



