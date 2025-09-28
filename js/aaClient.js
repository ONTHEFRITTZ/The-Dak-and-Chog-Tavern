// aaClient.js
import { createSmartAccountClient } from "@zerodev/sdk";
import { MONAD_BUNDLER_RPC } from "./config.js";

let smartAccount;

export async function initSmartAccount(provider) {
  if (smartAccount) return smartAccount;

  try {
    smartAccount = await createSmartAccountClient({
      chainId: 10143, // Monad testnet
      bundlerRpc: MONAD_BUNDLER_RPC,
      provider,
    });

    // Dispatch sponsorship ON event since we're connected via ZeroDev bundler
    window.dispatchEvent(new CustomEvent('aa:sponsored', { detail: { active: true } }));

    return smartAccount;
  } catch (err) {
    console.error("Failed to init SmartAccount with bundler:", err);

    // Dispatch sponsorship OFF if creation fails
    window.dispatchEvent(new CustomEvent('aa:sponsored', { detail: { active: false } }));

    throw err;
  }
}

export function getSmartAccount() {
  return smartAccount;
}
