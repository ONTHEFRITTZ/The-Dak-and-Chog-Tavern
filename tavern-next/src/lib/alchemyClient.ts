'use client';

import type { Address } from "viem";
import { createLightAccountAlchemyClient } from "@alchemy/aa-alchemy";
import type { SmartAccountSigner } from "@alchemy/aa-core";
import {
  MONAD_CHAIN,
  ALCHEMY_API_KEY,
  ALCHEMY_POLICY_ID,
} from "./config";

export type SupportedSigner = SmartAccountSigner & { getAddress(): Promise<Address> };

export async function createAlchemySmartAccountClient<TSigner extends SupportedSigner>(
  signer: TSigner
) {
  if (!ALCHEMY_API_KEY) {
    throw new Error("Alchemy AA env vars missing. Set NEXT_PUBLIC_ALCHEMY_* to enable.");
  }

  const accountAddress = await signer.getAddress();

  return createLightAccountAlchemyClient({
    apiKey: ALCHEMY_API_KEY,
    chain: MONAD_CHAIN as any,
    signer,
    accountAddress,
    gasManagerConfig: ALCHEMY_POLICY_ID ? { policyId: ALCHEMY_POLICY_ID } : undefined,
  });
}
