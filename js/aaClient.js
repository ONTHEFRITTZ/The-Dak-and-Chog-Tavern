// aaClient.js
import { createSmartAccountClient } from "@zerodev/sdk";
import { MONAD_BUNDLER_RPC } from "./config.js";

let smartAccount;

export async function initSmartAccount(provider) {
  if (smartAccount) return smartAccount;

  smartAccount = await createSmartAccountClient({
    chainId: 10143, // Monad testnet
    bundlerRpc: MONAD_BUNDLER_RPC,
    provider,
  });

  return smartAccount;
}

export function getSmartAccount() {
  return smartAccount;
}
