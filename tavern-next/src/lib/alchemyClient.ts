'use client';

import type { Address, Chain } from 'viem';
import { createLightAccountAlchemyClient } from '@alchemy/aa-alchemy';
import type { SmartAccountSigner } from '@alchemy/aa-core';

import {
  MONAD_CHAIN,        // your viem Chain for Monad (testnet/mainnet)
  ALCHEMY_API_KEY,
  ALCHEMY_POLICY_ID,
} from './config';

export type SupportedSigner = SmartAccountSigner & {
  getAddress(): Promise<Address>;
};

/**
 * Ensure the Chain object includes Alchemy RPC URLs.
 * If you're not on Monad Testnet, change the base URLs accordingly.
 */
function withAlchemyRpc(chain: Chain, apiKey: string): Chain {
  // 🔁 Swap these hosts if you're on a different network.
  // Examples:
  //   Ethereum Sepolia: https://eth-sepolia.g.alchemy.com/v2/
  //   Ethereum Mainnet: https://eth-mainnet.g.alchemy.com/v2/
  //   Base Sepolia:     https://base-sepolia.g.alchemy.com/v2/
  //   Polygon Amoy:     https://polygon-amoy.g.alchemy.com/v2/
  const http = [`https://monad-testnet.g.alchemy.com/v2/${apiKey}`];
  const webSocket = [`wss://monad-testnet.g.alchemy.com/v2/${apiKey}`];

  return {
    ...chain,
    rpcUrls: {
      ...(chain.rpcUrls ?? {}),
      default: { http, webSocket },
      public: { http, webSocket },
    },
  } as Chain;
}

export async function createAlchemySmartAccountClient<TSigner extends SupportedSigner>(
  signer: TSigner
) {
  if (!ALCHEMY_API_KEY) {
    throw new Error('Alchemy AA env vars missing. Set NEXT_PUBLIC_ALCHEMY_* to enable.');
  }

  const accountAddress = await signer.getAddress();

  // ✅ Make sure the chain carries an Alchemy RPC URL
  const chain = withAlchemyRpc(MONAD_CHAIN as Chain, ALCHEMY_API_KEY);

  return createLightAccountAlchemyClient({
    apiKey: ALCHEMY_API_KEY,
    chain,
    signer,
    accountAddress,
    gasManagerConfig: ALCHEMY_POLICY_ID ? { policyId: ALCHEMY_POLICY_ID } : undefined,
  });
}
