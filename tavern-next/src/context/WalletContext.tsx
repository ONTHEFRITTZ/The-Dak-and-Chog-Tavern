'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, getAddress } from "ethers";
import { useAccount, useConnect, useDisconnect, useWalletClient } from "wagmi";
import type { Connector } from "wagmi";
import type { PickedProvider } from "@/modules/aa/toolkitContext";

type WalletType = "metamask" | "phantom" | "unknown" | null;

type WalletContextValue = {
  address: string | null;
  provider: BrowserProvider | null;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  walletType: WalletType;
  rawProvider: PickedProvider | null;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

const STORAGE_KEY = "tavern:wallet:remember";
const WALLET_TYPE_KEY = "tavern:wallet:type";

function detectWalletType(provider: PickedProvider | null): WalletType {
  if (!provider) return "unknown";
  if ((provider as any).isMetaMask) return "metamask";
  if ((provider as any).isPhantom || (provider as any).isPhantomEthereum) return "phantom";
  try {
    if (typeof window !== "undefined") {
      if (window.phantom?.ethereum === provider) return "phantom";
      if (window.ethereum === provider) return "metamask";
    }
  } catch {
    // ignore detection failures
  }
  return "unknown";
}

function getFallbackProvider(): PickedProvider | null {
  if (typeof window === "undefined") return null;
  return (
    (window.__walletProvider as PickedProvider | undefined) ??
    (window.ethereum as PickedProvider | undefined) ??
    (window.phantom?.ethereum as PickedProvider | undefined) ??
    null
  );
}

function pickConnector(connectors: readonly Connector[]): Connector | null {
  return (
    connectors.find((connector) => connector.id === "metaMask") ??
    connectors.find((connector) => connector.id === "injected") ??
    connectors[0] ??
    null
  );
}

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { address: wagmiAddress, status } = useAccount();
  const { connectAsync, connectors, isPending: connectPending } = useConnect();
  const { disconnectAsync, isPending: disconnectPending } = useDisconnect();
  const { data: walletClient } = useWalletClient();

  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [walletType, setWalletType] = useState<WalletType>(null);
  const [manualConnecting, setManualConnecting] = useState(false);
  const providerSourceRef = useRef<PickedProvider | null>(null);

  const syncSelectedProvider = useCallback(
    (rawProvider: PickedProvider | null, remember = true) => {
      if (!rawProvider?.request) return;
      if (providerSourceRef.current === rawProvider && provider) return;
      providerSourceRef.current = rawProvider;
      const nextType = detectWalletType(rawProvider);
      setWalletType(nextType);
      setProvider(new BrowserProvider(rawProvider as any));
      if (typeof window !== "undefined") {
        window.__walletProvider = rawProvider;
        if (typeof window.__getSelectedProvider !== "function") {
          window.__getSelectedProvider = () =>
            window.__walletProvider ?? window.ethereum ?? window.phantom?.ethereum ?? null;
        }
        if (remember) {
          sessionStorage.setItem(STORAGE_KEY, "true");
          sessionStorage.setItem(WALLET_TYPE_KEY, nextType ?? "unknown");
        }
      }
    },
    [provider]
  );

  const connect = useCallback(async () => {
    if (manualConnecting) return;
    const connector = pickConnector(connectors);
    if (!connector) {
      throw new Error("No wallet connector available");
    }
    setManualConnecting(true);
    try {
      await connectAsync({ connector });
      const rawProvider = (await connector.getProvider()) as PickedProvider;
      syncSelectedProvider(rawProvider);
    } finally {
      setManualConnecting(false);
    }
  }, [connectAsync, connectors, manualConnecting, syncSelectedProvider]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectAsync();
    } catch {
      // ignore disconnect errors
    } finally {
      providerSourceRef.current = null;
      setProvider(null);
      setWalletType(null);
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(WALLET_TYPE_KEY);
        try {
          delete window.__walletProvider;
        } catch {
          (window as any).__walletProvider = undefined;
        }
        window.dispatchEvent(new CustomEvent("wallet:disconnected"));
      }
    }
  }, [disconnectAsync]);

  useEffect(() => {
    if (!wagmiAddress) {
      providerSourceRef.current = null;
      setProvider(null);
      setWalletType(null);
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(WALLET_TYPE_KEY);
        try {
          delete window.__walletProvider;
        } catch {
          (window as any).__walletProvider = undefined;
        }
      }
      return;
    }

    const transportProvider = (walletClient as any)?.transport?.value as PickedProvider | undefined;
    if (transportProvider?.request) {
      syncSelectedProvider(transportProvider, false);
      return;
    }

    const fallback = getFallbackProvider();
    if (fallback) {
      syncSelectedProvider(fallback);
    }
  }, [wagmiAddress, walletClient, syncSelectedProvider]);

  const checksumAddress = useMemo(() => {
    if (!wagmiAddress) return null;
    try {
      return getAddress(wagmiAddress);
    } catch {
      return wagmiAddress;
    }
  }, [wagmiAddress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (checksumAddress) {
      window.dispatchEvent(new CustomEvent("wallet:connected", { detail: { address: checksumAddress } }));
    } else {
      window.dispatchEvent(new CustomEvent("wallet:disconnected"));
    }
  }, [checksumAddress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (checksumAddress) {
        (window as any).__walletOwnerAddress = checksumAddress;
      } else if ((window as any).__walletOwnerAddress) {
        delete (window as any).__walletOwnerAddress;
      }
    } catch {
      (window as any).__walletOwnerAddress = checksumAddress ?? undefined;
    }
  }, [checksumAddress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!checksumAddress || !walletClient) return;
    const rawProvider =
      providerSourceRef.current ??
      ((walletClient.transport as any)?.value as PickedProvider | undefined) ??
      null;
    if (!rawProvider) return;
    const prime = async () => {
      try {
        if (typeof (window as any).ensureDelegationToolkitReady === "function") {
          await (window as any).ensureDelegationToolkitReady({
            ownerAddress: checksumAddress,
            walletClient: walletClient as any,
            provider: rawProvider,
          });
        }
      } catch (err: any) {
        const message = typeof err?.message === "string" ? err.message.toLowerCase() : "";
        if (
          message.includes("evm provider not detected") ||
          message.includes("wallet client unavailable") ||
          message.includes("connect wallet")
        ) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[wallet] delegation toolkit not ready yet", err?.message || err);
          }
        } else {
          console.warn("[wallet] delegation toolkit prime failed", err);
        }
      }
    };
    prime();
  }, [checksumAddress, walletClient, provider]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (walletClient) {
        (window as any).__wagmiWalletClient = walletClient;
      } else if ((window as any).__wagmiWalletClient) {
        delete (window as any).__wagmiWalletClient;
      }
    } catch {
      (window as any).__wagmiWalletClient = walletClient ?? undefined;
    }
  }, [walletClient]);

  const isConnecting =
    manualConnecting || connectPending || status === "connecting" || disconnectPending;
  const rawProviderValue = providerSourceRef.current;

  const value = useMemo<WalletContextValue>(
    () => ({
      address: checksumAddress,
      provider,
      isConnecting,
      connect,
      disconnect,
      walletType,
      rawProvider: rawProviderValue ?? null,
    }),
    [checksumAddress, provider, isConnecting, connect, disconnect, walletType, rawProviderValue]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = (): WalletContextValue => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
};

declare global {
  interface Window {
    __walletProvider?: PickedProvider;
    __getSelectedProvider?: (hint?: string) => any;
    ethereum?: any;
    phantom?: { ethereum?: PickedProvider };
  }
}
