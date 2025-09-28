// /js/aaClient.js
import { createSmartAccountClient } from "@zerodev/sdk";
import {
  MONAD_BUNDLER_RPC,
  ZD_PAYMASTER_RPC,
  PAYMASTER_ADDRESS,
} from "./config.js";

let smartAccount;

/**
 * Initializes a ZeroDev Smart Account (SDK v4) using:
 * - bundlerRpc: your ZeroDev bundler
 * - paymasterRpc: same project, self-funded mode
 * - paymasterAddress: your deployed self-funded paymaster contract
 *
 * NOTE: Keep @zerodev/sdk pinned to v4 in the import map.
 */
export async function initSmartAccount(provider) {
  if (smartAccount) return smartAccount;
  if (!provider) throw new Error("Provider not ready");

  smartAccount = await createSmartAccountClient({
    chainId: 10143,                // Monad testnet
    bundlerRpc: MONAD_BUNDLER_RPC, // includes ?selfFunded=true
    paymasterRpc: ZD_PAYMASTER_RPC, // includes ?selfFunded=true
    paymasterAddress: PAYMASTER_ADDRESS,
    provider,
  });

  // Optional: surface events to console for quick debug
  try {
    smartAccount.on?.("userOperation", (evt) => {
      console.log("[AA] UserOp sent:", evt);
    });
    smartAccount.on?.("receipt", (rcpt) => {
      console.log("[AA] UserOp receipt:", rcpt);
    });
    smartAccount.on?.("error", (err) => {
      console.warn("[AA] UserOp error:", err);
    });
  } catch {}

  return smartAccount;
}

export function getSmartAccount() {
  return smartAccount;
}
