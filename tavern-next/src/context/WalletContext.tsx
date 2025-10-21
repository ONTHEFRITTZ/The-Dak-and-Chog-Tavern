'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserProvider, getAddress } from "ethers";
import type { PickedProvider } from "@/modules/aa/toolkitContext";

type WalletType = "metamask" | "phantom" | "unknown" | null;

type WalletContextValue = {
  address: string | null;
  provider: BrowserProvider | null;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  walletType: WalletType;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function getInjectedProvider(): PickedProvider | null {
  if (typeof window === "undefined") return null;
  if (window.__walletProvider) return window.__walletProvider;
  if (window.ethereum) return window.ethereum;
  if (window.phantom?.ethereum) return window.phantom.ethereum;
  return null;
}

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

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletType, setWalletType] = useState<WalletType>(null);

  const reset = useCallback(async () => {
    setProvider(null);
    setAddress(null);
    setWalletType(null);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(STORAGE_KEY);
       sessionStorage.removeItem(WALLET_TYPE_KEY);
      try { delete window.__walletProvider; } catch { window.__walletProvider = undefined; }
    }
  }, []);

  const disconnect = useCallback(async () => {
    await reset();
  }, [reset]);

  const connect = useCallback(async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const injected = getInjectedProvider();
      if (!injected?.request) {
        throw new Error("No EVM wallet detected");
      }
      const accounts: string[] = await injected.request({ method: "eth_requestAccounts" });
      if (!accounts?.length) {
        throw new Error("No accounts returned");
      }
      const primary = getAddress(accounts[0]);
      const browserProvider = new BrowserProvider(injected);
      const type = detectWalletType(injected);
      setProvider(browserProvider);
      setAddress(primary);
      setWalletType(type);
      if (typeof window !== "undefined") {
        sessionStorage.setItem(STORAGE_KEY, "true");
        sessionStorage.setItem(WALLET_TYPE_KEY, type ?? "unknown");
        window.__walletProvider = injected;
        window.dispatchEvent(new CustomEvent("wallet:connected", { detail: { address: primary } }));
      }
    } catch (err) {
      console.warn("[wallet] connect failed", err);
      await reset();
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, reset]);

  useEffect(() => {
    const injected = getInjectedProvider();
    if (!injected?.on) return;
    const handleAccountsChanged = (accounts: unknown) => {
      if (!Array.isArray(accounts) || accounts.length === 0) {
        reset();
        return;
      }
      const primary = getAddress(String(accounts[0]));
      setAddress(primary);
    };
    const handleDisconnect = () => reset();
    injected.on("accountsChanged", handleAccountsChanged);
    injected.on("disconnect", handleDisconnect);
    return () => {
      try { injected.removeListener?.("accountsChanged", handleAccountsChanged); } catch {}
      try { injected.removeListener?.("disconnect", handleDisconnect); } catch {}
    };
  }, [reset]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const remember = sessionStorage.getItem(STORAGE_KEY) === "true";
    if (!remember) return;
    const injected = getInjectedProvider();
    if (!injected?.request) return;
    injected.request({ method: "eth_accounts" })
      .then((accounts: string[]) => {
        if (!accounts?.length) return;
        const primary = getAddress(accounts[0]);
        setProvider(new BrowserProvider(injected));
        setAddress(primary);
        const storedType = sessionStorage.getItem(WALLET_TYPE_KEY) as WalletType | null;
        setWalletType(storedType ?? detectWalletType(injected));
        window.__walletProvider = injected;
      })
      .catch(() => reset());
  }, [reset]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const getSelected = () => window.__walletProvider ?? getInjectedProvider();
    if (typeof window.__getSelectedProvider !== "function") {
      window.__getSelectedProvider = getSelected;
    }
    if (address) {
      window.dispatchEvent(new CustomEvent("wallet:connected", { detail: { address } }));
    } else {
      window.dispatchEvent(new CustomEvent("wallet:disconnected"));
    }
  }, [address]);

  const value = useMemo<WalletContextValue>(() => ({
    address,
    provider,
    isConnecting,
    connect,
    disconnect,
    walletType,
  }), [address, provider, isConnecting, connect, disconnect, walletType]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
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
    ethereum?: PickedProvider;
    phantom?: { ethereum?: PickedProvider };
  }
}
