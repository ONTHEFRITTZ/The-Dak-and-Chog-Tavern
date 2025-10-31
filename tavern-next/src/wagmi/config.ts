'use client';

import { createConfig, http } from "wagmi";
import { injected, metaMask } from "wagmi/connectors";
import { MONAD, MONAD_CHAIN } from "@/lib/config";

const APP_NAME = "The Dak & Chog Tavern";

export const wagmiConfig = createConfig({
  chains: [MONAD_CHAIN],
  connectors: [
    metaMask({
      chains: [MONAD_CHAIN],
      dappMetadata: {
        name: APP_NAME,
        url: typeof window !== "undefined" ? window.location.origin : "https://thedakandchog.xyz",
      },
      shimDisconnect: true,
    }),
    injected({
      chains: [MONAD_CHAIN],
      shimDisconnect: true,
    }),
  ],
  transports: {
    [MONAD.id]: http(MONAD.rpcHttp),
  },
  multiInjectedProviderDiscovery: true,
  ssr: true,
  syncConnectedChain: false,
  batch: {
    multicall: {
      wait: 16,
    },
  },
  autoConnect: true,
});

