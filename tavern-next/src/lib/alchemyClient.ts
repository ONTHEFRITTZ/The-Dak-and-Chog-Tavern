'use client';

import type { Address, Chain } from 'viem';
import type { SmartAccountSigner } from '@aa-sdk/core';
import { alchemy } from '@account-kit/infra';
import { createLightAccountAlchemyClient } from '@account-kit/smart-contracts';

import {
  MONAD_CHAIN,        // your viem Chain for Monad (testnet/mainnet)
  ALCHEMY_API_KEY,
  ALCHEMY_POLICY_ID,
  MONAD_BUNDLER_RPC,
} from './config';

export type SupportedSigner = SmartAccountSigner & {
  getAddress(): Promise<Address>;
};

function withAlchemyRpc(chain: Chain, apiKey: string): Chain {
  const http = [`https://monad-testnet.g.alchemy.com/v2/${apiKey}`];
  const webSocket = [`wss://monad-testnet.g.alchemy.com/v2/${apiKey}`];

  return {
    ...chain,
    rpcUrls: {
      ...(chain.rpcUrls ?? {}),
      alchemy: { http, webSocket },
      default: { http, webSocket },
      public: { http, webSocket },
    },
  } as Chain;
}

export async function createAlchemySmartAccountClient<TSigner extends SupportedSigner>(
  signer: TSigner
) {
  const accountAddress = await signer.getAddress();

  const transportConfig: Parameters<typeof alchemy>[0] = (() => {
    if (ALCHEMY_API_KEY) {
      return { apiKey: ALCHEMY_API_KEY };
    }
    if (MONAD_BUNDLER_RPC) {
      return { rpcUrl: MONAD_BUNDLER_RPC };
    }
    throw new Error(
      'Alchemy transport configuration missing. Set NEXT_PUBLIC_ALCHEMY_API_KEY or NEXT_PUBLIC_MONAD_BUNDLER_RPC.'
    );
  })();

  const chain =
    'apiKey' in transportConfig
      ? withAlchemyRpc(MONAD_CHAIN as Chain, transportConfig.apiKey!)
      : (MONAD_CHAIN as Chain);

  const transport = alchemy(transportConfig);

  return createLightAccountAlchemyClient({
    chain,
    transport,
    signer,
    accountAddress,
    policyId: ALCHEMY_POLICY_ID || undefined,
  });
}
