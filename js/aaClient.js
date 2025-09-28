// js/aaClient.js
import * as ZeroDev from "@zerodev/sdk";
import {
  MONAD_BUNDLER_RPC,
  ZD_PAYMASTER_RPC,
  PAYMASTER_ADDRESS,
} from "./config.js";

let smartAccount;

// Choose the available factory across SDK versions
function pickFactory() {
  return (
    ZeroDev.createSmartAccountClient ||        // some v3 builds
    ZeroDev.createKernelAccountClient ||       // some v4 builds
    ZeroDev.createZeroDevClient ||             // fallback name in certain distros
    null
  );
}

/**
 * Initialize ZeroDev Smart Account client using your project settings.
 * - chainId 10143 (Monad testnet)
 * - bundlerRpc / paymasterRpc are your Zerodev endpoints
 * - paymasterAddress is the self-funded paymaster you deployed
 */
export async function initSmartAccount(provider) {
  if (smartAccount) return smartAccount;

  const factory = pickFactory();
  if (!factory) {
    console.error("Available @zerodev/sdk keys:", Object.keys(ZeroDev));
    throw new Error(
      "[aaClient] Could not find a compatible ZeroDev factory. " +
      "Ensure @zerodev/sdk is reachable and your import map points to a version that includes one of: " +
      "createSmartAccountClient | createKernelAccountClient | createZeroDevClient."
    );
  }

  smartAccount = await factory({
    chainId: 10143,
    bundlerRpc: MONAD_BUNDLER_RPC,
    paymasterRpc: ZD_PAYMASTER_RPC,
    paymasterAddress: PAYMASTER_ADDRESS,
    provider, // your EIP-1193/ethers provider
  });

  try {
    // Optional: surface lifecycle for debugging
    smartAccount.on?.("userOperation", (evt) => console.log("[AA] UserOp sent:", evt));
    smartAccount.on?.("receipt", (rcpt) => console.log("[AA] UserOp receipt:", rcpt));
    smartAccount.on?.("error", (err) => console.warn("[AA] UserOp error:", err));
  } catch {}

  return smartAccount;
}

export function getSmartAccount() {
  return smartAccount;
}
