// aaClient.js
import { createSmartAccountClient } from "@zerodev/sdk";
import {
  MONAD_BUNDLER_RPC,
  ZD_PAYMASTER_RPC,
  PAYMASTER_ADDRESS,
} from "./config.js";

let smartAccount;

/**
 * Initialize ZeroDev Smart Account client using:
 * - bundlerRpc: your ZeroDev bundler
 * - paymasterRpc: same project, self-funded mode
 * - paymasterAddress: your deployed self-funded paymaster contract
 */
export async function initSmartAccount(provider) {
  if (smartAccount) return smartAccount;

  smartAccount = await createSmartAccountClient({
    chainId: 10143,                    // Monad testnet
    bundlerRpc: MONAD_BUNDLER_RPC,     // includes ?selfFunded=true
    paymasterRpc: ZD_PAYMASTER_RPC,    // includes ?selfFunded=true
    paymasterAddress: PAYMASTER_ADDRESS,
    provider,
  });

  // Debug hook: surface sponsorship status in console
  try {
    smartAccount.on?.("userOperation", (evt) => {
      // evt: { hash, request, paymaster, sponsorship }
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
