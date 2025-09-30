// aaClient.js — dynamic ZeroDev loader with graceful fallback
import { MONAD_BUNDLER_RPC, ZD_PAYMASTER_RPC, PAYMASTER_ADDRESS } from "./aa/config.js";

let smartAccount = null;
let loaded = false;
let ZD = null;

async function loadZeroDev() {
  if (loaded) return ZD;
  // only attempt when onchain; f2p pages won't have the importmap
  const mode = (document.documentElement.getAttribute('data-table-mode') || '').toLowerCase();
  if (mode !== 'onchain') { loaded = true; return null; }
  try {
    ZD = await import("@zerodev/sdk");
  } catch (e) {
    console.warn("[aaClient] ZeroDev SDK not available (import map missing?)", e);
    ZD = null;
  } finally {
    loaded = true;
  }
  return ZD;
}

function pickFactory(mod) {
  if (!mod) return null;
  return (
    mod.createSmartAccountClient ||
    mod.createKernelAccountClient ||
    mod.createZeroDevClient ||   // some builds
    null
  );
}

export async function initSmartAccount(provider) {
  if (smartAccount) return smartAccount;

  const mod = await loadZeroDev();
  const factory = pickFactory(mod);

  if (!factory) {
    console.warn("[aaClient] No compatible factory in @zerodev/sdk. Available keys:", mod ? Object.keys(mod) : []);
    // graceful no-op façade so the site continues to run
    smartAccount = {
      contribute: async () => { throw new Error("AA unavailable"); },
      on(){}, off(){},
    };
    return smartAccount;
  }

  smartAccount = await factory({
    chainId: 10143,
    bundlerRpc: MONAD_BUNDLER_RPC,
    paymasterRpc: ZD_PAYMASTER_RPC,
    paymasterAddress: PAYMASTER_ADDRESS,
    provider
  });

  try {
    smartAccount.on?.("userOperation", (e) => console.log("[AA] UserOp:", e));
    smartAccount.on?.("receipt", (r) => console.log("[AA] Receipt:", r));
    smartAccount.on?.("error", (err) => console.warn("[AA] Error:", err));
  } catch {}

  return smartAccount;
}

export function getSmartAccount() { return smartAccount; }
