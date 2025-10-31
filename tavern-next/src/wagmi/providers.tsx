'use client';

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/wagmi/config";

const WagmiQueryContext = createContext<QueryClient | null>(null);

export function WagmiQueryProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiQueryContext.Provider value={queryClient}>{children}</WagmiQueryContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useQueryClientInstance() {
  const client = useContext(WagmiQueryContext);
  if (!client) throw new Error("QueryClient unavailable");
  return client;
}
