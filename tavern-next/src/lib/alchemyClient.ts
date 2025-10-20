'use client';

import type { Address } from "viem";
import { createLightAccountAlchemyClient } from "@alchemy/aa-alchemy";
import { createLightAccount } from "@alchemy/aa-accounts";
import {
  type LightAccount,
  type SmartAccountSigner,
} from "@alchemy/aa-core";
import { http } from "viem";
import { MONAD, MONAD_BUNDLER_RPC, ALCHEMY_API_KEY, ALCHEMY_PAYMASTER_RPC, ALCHEMY_POLICY_ID } from "./config";

type SupportedSigner = SmartAccountSigner & { getAddress(): Promise<Address> };

/**
 * Placeholder Alchemy Smart Account factory.
 * Monad is not supported yet by the public AccountVersionRegistry, so this helper keeps
 * the wiring ready while gracefully rejecting on unsupported networks.
 */
export async function initAlchemyLightAccount<TSigner extends SupportedSigner>(
  signer: TSigner
): Promise<LightAccount<TSigner>> {
  if (!ALCHEMY_API_KEY || !MONAD_BUNDLER_RPC) {
    throw new Error("Alchemy AA env vars missing. Set NEXT_PUBLIC_ALCHEMY_* to enable.");
  }

  const transport = http(MONAD.rpcHttp);
  const signerAddress = await signer.getAddress();

  try {
    return await createLightAccount({
      transport,
      chain: { ...MONAD },
      signer,
      accountAddress: signerAddress,
    });
  } catch (err) {
    throw new Error(
      "Alchemy Light Account is not yet available for Monad. " +
        "Install factory metadata or wait for official support.",
      { cause: err },
    );
  }
}

export async function createAlchemySmartAccountClient<TSigner extends SupportedSigner>(
  signer: TSigner
) {
  if (!ALCHEMY_API_KEY || !MONAD_BUNDLER_RPC) {
    throw new Error("Alchemy AA env vars missing. Set NEXT_PUBLIC_ALCHEMY_* to enable.");
  }

  const account = await initAlchemyLightAccount(signer);

  return createLightAccountAlchemyClient({
    apiKey: ALCHEMY_API_KEY,
    chain: { ...MONAD },
    transport: http(MONAD_BUNDLER_RPC),
    account,
    gasManagerConfig: ALCHEMY_PAYMASTER_RPC
      ? {
          policyId: ALCHEMY_POLICY_ID,
          provider: ALCHEMY_PAYMASTER_RPC,
        }
      : undefined,
  });
}
