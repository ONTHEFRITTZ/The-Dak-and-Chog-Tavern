'use client';

import type { ReactNode } from "react";
import { WagmiQueryProviders } from "@/wagmi/providers";
import { WalletProvider } from "@/context/WalletContext";

type ProvidersProps = {
  children: ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  return (
    <WagmiQueryProviders>
      <WalletProvider>{children}</WalletProvider>
    </WagmiQueryProviders>
  );
}

