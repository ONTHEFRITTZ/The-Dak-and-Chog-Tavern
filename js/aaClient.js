// /js/aaClient.js
import * as ZeroDev from "@zerodev/sdk";
import {
  MONAD_BUNDLER_RPC,
  ZD_PAYMASTER_RPC,
  PAYMASTER_ADDRESS,
} from "./config.js";

let smartAccount;

/** Try to find a factory function across SDK variants (both root and default). */
function pickFactory() {
  const cand = [
    "createSmartAccountClient",
    "createKernelAccountClient",
    "createZeroDevClient",
  ];

  // scan root first
  for (const k of cand) if (typeof ZeroDev[k] === "function") return ZeroDev[k];
  // some builds hang everything off default
  const d = ZeroDev && ZeroDev.default ? ZeroDev.default : null;
  if (d) for (const k of cand) if (typeof d[k] === "function") return d[k];

  // if the module default itself is callable, treat it as factory
  if (typeof d === "function") return d;
  if (typeof ZeroDev === "function") return ZeroDev;

  return null;
}

/** Wrap different SDK client shapes to a common interface AgentOps expects. */
function adaptClient(sa) {
  if (!sa) return null;

  // Find a "send" function (varies by SDK/build)
  const _send =
    sa.sendTransaction ||
    sa.sendUserOperation ||
    sa.send ||
    sa.execute ||
    null;

  // Find a "wait" that resolves the UO hash (varies by SDK/build)
  const _wait =
    sa.waitForUserOperationTransaction ||
    sa.waitForTx ||
    sa.wait ||
    null;

  if (!_send) {
    console.warn("[aaClient] SDK client found but has no supported send method", sa);
    return null;
  }

  // Normalize to a tiny adapter with the names AgentOps uses
  return {
    // Pass through original for debugging if needed
    __raw: sa,

    async sendTransaction(tx) {
      // Support object or positional depending on SDK
      // Normalize common fields
      const to = tx?.to;
      const data = tx?.data || "0x";
      const value = tx?.value ?? "0x0";

      // Many SDKs accept a single tx object; a few accept args
      try {
        return await _send.call(sa, { to, data, value });
      } catch (e) {
        // try positional if the SDK expects it
        try {
          return await _send.call(sa, to, data, value);
        } catch (e2) {
          throw (e2 || e);
        }
      }
    },

    async waitForUserOperationTransaction(hash) {
      if (!_wait) return { hash }; // nothing to do; return best-effort
      try {
        return await _wait.call(sa, hash);
      } catch (e) {
        // Some SDKs return a promise-like tx with .wait()
        if (hash && typeof hash.wait === "function") {
          try { return await hash.wait(); } catch (e2) { throw (e2 || e); }
        }
        throw e;
      }
    },

    // Nice to have: allow listeners if SDK supports EventEmitter-ish API
    on: (...args) => (typeof sa.on === "function" ? sa.on(...args) : undefined),
    off: (...args) => (typeof sa.off === "function" ? sa.off(...args) : undefined),
  };
}

/**
 * Initialize a ZeroDev Smart Account (self-funded paymaster).
 * Returns an adapter with { sendTransaction, waitForUserOperationTransaction, on/off? }.
 */
export async function initSmartAccount(provider) {
  if (smartAccount) return smartAccount;

  const factory = pickFactory();
  if (!factory) {
    console.error("[aaClient] Could not find a compatible factory in @zerodev/sdk.");
    console.info("Available keys on module:", Object.keys(ZeroDev || {}), ZeroDev?.default ? { defaultKeys: Object.keys(ZeroDev.default) } : {});
    throw new Error(
      "[aaClient] No compatible ZeroDev factory. " +
      "Import map must reference a build exposing one of: " +
      "createSmartAccountClient | createKernelAccountClient | createZeroDevClient."
    );
  }

  // Try the common v4-ish signature first
  let raw;
  try {
    raw = await factory({
      chainId: 10143,                // Monad testnet
      bundlerRpc: MONAD_BUNDLER_RPC, // includes ?selfFunded=true
      paymasterRpc: ZD_PAYMASTER_RPC,
      paymasterAddress: PAYMASTER_ADDRESS,
      provider,                      // EIP-1193 / ethers
    });
  } catch (e) {
    // If that fails, log and rethrow—adjust here if your project uses a very different signature
    console.warn("[aaClient] ZeroDev factory call failed with provided options:", e);
    throw e;
  }

  const adapted = adaptClient(raw);
  if (!adapted) {
    throw new Error("[aaClient] Smart Account client created, but could not adapt methods.");
  }

  smartAccount = adapted;

  // Debug hooks if the underlying client supports them
  try {
    raw.on?.("userOperation", (evt) => console.log("[AA] UserOp sent:", evt));
    raw.on?.("receipt", (rcpt) => console.log("[AA] UserOp receipt:", rcpt));
    raw.on?.("error", (err) => console.warn("[AA] UserOp error:", err));
  } catch {}

  // Let the sponsor-indicator UI know AA is hot
  try {
    window.dispatchEvent(new CustomEvent("aa:sponsored", { detail: { active: true } }));
  } catch {}

  return smartAccount;
}

export function getSmartAccount() {
  return smartAccount || null;
}
