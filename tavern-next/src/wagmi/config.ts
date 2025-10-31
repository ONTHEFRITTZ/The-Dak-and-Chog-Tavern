'use client';

import { createConfig, http } from "wagmi";
import { injected, metaMask } from "wagmi/connectors";
import { MONAD, MONAD_CHAIN } from "@/lib/config";

export const wagmiConfig = createConfig({
  chains: [MONAD_CHAIN],
  connectors: [
    metaMask(),
    injected(),
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
});
