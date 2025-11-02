'use client';

import { createPublicClient, createWalletClient, custom, http, type Address, type Chain, type PublicClient, type WalletClient } from "viem";
import { toAccount } from "viem/accounts";
import { MONAD, MONAD_CHAIN } from "@/lib/config";
import { MONAD_DELEGATION_ENV, type DelegationEnvironment } from "./delegationEnvironment";
import { getWalletClient } from "@wagmi/core";
import { wagmiConfig } from "@/wagmi/config";

export type PickedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

export type DelegationToolkitContext = {
  provider: PickedProvider;
  accounts: string[];
  account: string;
  ownerAccount: string;
  publicClient: PublicClient;
  walletClient: WalletClient;
  walletChain: Chain;
  environment: DelegationEnvironment;
  viem: typeof import("viem");
};

let contextPromise: Promise<DelegationToolkitContext> | null = null;

function pickProvider(): PickedProvider | null {
  if (typeof window === "undefined") return null;
  try {
    if (typeof window.__getSelectedProvider === "function") {
      const selected = window.__getSelectedProvider("metamask");
      if (selected?.request) return selected;
    }
  } catch {
    // ignore
  }
  const ethereum = (window as any).ethereum;
  if (ethereum?.request) return ethereum;
  const phantom = (window as any).phantom?.ethereum;
  if (phantom?.request) return phantom;
  return null;
}

async function requestAccounts(provider: PickedProvider): Promise<string[]> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("Wallet connection required");
  }
  return accounts.map((address) => String(address).toLowerCase());
}

async function switchToMonad(provider: PickedProvider): Promise<void> {
  const targetChainHex = `0x${MONAD.id.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainHex }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: targetChainHex,
              chainName: MONAD.name,
              rpcUrls: [MONAD.rpcHttp],
              nativeCurrency: {
                name: MONAD.nativeCurrency.name,
                symbol: MONAD.nativeCurrency.symbol,
                decimals: MONAD.nativeCurrency.decimals,
              },
              blockExplorerUrls: [MONAD.explorer],
            },
          ],
        });
      } catch {
        // ignore add errors - user can switch manually
      }
    }
  }
}


function createWalletClientWithAccount(provider: PickedProvider, address: Address): WalletClient {
  const account = toAccount(address);
  const client = createWalletClient({
    chain: MONAD_CHAIN,
    transport: custom(provider as any),
    account,
  }) as WalletClient;
  return assignAccountToWalletClient(client, account);
}

function assignAccountToWalletClient(walletClient: WalletClient, account: ReturnType<typeof toAccount>): WalletClient {
  const supplyAddresses = async () => [account.address as Address];
  try {
    Object.defineProperty(walletClient, "account", {
      configurable: true,
      enumerable: true,
      value: account,
      writable: false,
    });
  } catch {
    (walletClient as any).account = account;
  }
  if (!(walletClient as any).getAddresses) {
    (walletClient as any).getAddresses = supplyAddresses;
  }
  if (!(walletClient as any).requestAddresses) {
    (walletClient as any).requestAddresses = supplyAddresses;
  }
  return walletClient;
}

async function ensureWalletClientAccount(
  walletClient: WalletClient | null,
  ownerAddress: Address,
  provider: PickedProvider
): Promise<WalletClient> {
  if (!walletClient) {
    return createWalletClientWithAccount(provider, ownerAddress);
  }

  const currentAddress = (walletClient as any)?.account?.address as Address | undefined;
  if (currentAddress) {
    return walletClient;
  }

  let discoveredAddress: Address | undefined;
  try {
    const fromClient = await walletClient.getAddresses?.();
    if (fromClient && fromClient.length > 0) {
      discoveredAddress = fromClient[0] as Address;
    }
  } catch {
    // ignore getAddresses errors
  }

  if (!discoveredAddress) {
    try {
      const fromProvider = await provider.request({ method: "eth_accounts" });
      if (Array.isArray(fromProvider) && fromProvider.length > 0) {
        discoveredAddress = fromProvider[0] as Address;
      }
    } catch {
      // ignore provider lookup failures
    }
  }

  const account = toAccount((discoveredAddress ?? ownerAddress) as Address);
  return assignAccountToWalletClient(walletClient, account);
}
function normalizeEnvironment(source: DelegationEnvironment) {
  const env = JSON.parse(JSON.stringify(source)) as DelegationEnvironment;
  try {
    if (env?.caveatEnforcers && typeof env.caveatEnforcers === "object") {
      for (const key of Object.keys(env.caveatEnforcers)) {
        const value = (env.caveatEnforcers as Record<string, unknown>)[key];
        (env.caveatEnforcers as Record<string, string | unknown>)[key] =
          typeof value === "object" && value !== null && "address" in (value as any)
            ? ((value as any).address as string)
            : (value as string);
      }
    }
  } catch {
    // ignore normalization errors
  }
  return env;
}

export async function ensureDelegationToolkitContext(overrides?: {
  ownerAccount?: Address;
  walletClient?: WalletClient | null;
  provider?: PickedProvider | null;
}): Promise<DelegationToolkitContext> {
  if (contextPromise) return contextPromise;

  contextPromise = (async () => {
    if (typeof window === "undefined") {
      throw new Error("Delegation Toolkit requires a browser environment");
    }

    const cached = (window as any).__aaToolkitContext as DelegationToolkitContext | undefined;
    if (
      cached &&
      (!overrides?.ownerAccount ||
        cached.ownerAccount?.toLowerCase() === overrides.ownerAccount.toLowerCase()) &&
      cached.walletClient?.account?.address
    ) {
      return cached;
    }

    let providerOverride = overrides?.provider ?? null;
    let ownerAccount = overrides?.ownerAccount ?? null;
    let walletClient = overrides?.walletClient ?? null;
    let accounts: string[] | null = null;

    if (ownerAccount && walletClient) {
      providerOverride =
        providerOverride ??
        ((walletClient.transport as any)?.value as PickedProvider | undefined) ??
        pickProvider();
      if (!providerOverride?.request) {
        throw new Error("EVM provider not detected");
      }
      await switchToMonad(providerOverride);
      accounts = [ownerAccount.toLowerCase()];
    } else {
      const provider = providerOverride ?? pickProvider();
      if (!provider) {
        throw new Error("EVM provider not detected");
      }
      await switchToMonad(provider);
      const requestedAccounts = await requestAccounts(provider);
      ownerAccount = requestedAccounts[0] as Address;
      accounts = requestedAccounts;
      walletClient = (await getWalletClient(wagmiConfig, {
        chainId: MONAD.id,
        account: ownerAccount,
      })) as WalletClient | null;
      if (!walletClient) {
        throw new Error("Wallet client unavailable");
      }
      providerOverride = provider;
    }

    const ownerAddress = ownerAccount as Address;
    const baseProvider = providerOverride as PickedProvider;
    const hydratedWalletClient = await ensureWalletClientAccount(walletClient, ownerAddress, baseProvider);
    const hydratedAccountAddress = (hydratedWalletClient as any)?.account?.address as Address | undefined;
    const finalWalletClient =
      hydratedAccountAddress && typeof hydratedAccountAddress === "string"
        ? hydratedWalletClient
        : createWalletClientWithAccount(baseProvider, ownerAddress);
    const usedWagmiClient =
      walletClient === hydratedWalletClient &&
      walletClient === finalWalletClient &&
      !!(walletClient as any)?.account?.address;
    if (!(finalWalletClient as any)?.account?.address) {
      console.error("[aa:toolkitContext] wallet client missing account", finalWalletClient);
      throw new Error("Delegation Toolkit wallet client lacks an account address");
    }

    const viem = await import("viem");
    const publicClient = createPublicClient({
      chain: MONAD_CHAIN,
      transport: http(MONAD.rpcHttp),
    });

    try {
      const addresses = await finalWalletClient.getAddresses?.();
      if (addresses?.length) {
        accounts = addresses.map((addr) => String(addr).toLowerCase());
      }
    } catch {
      // ignore getAddresses errors
    }
    if (!accounts || accounts.length === 0) {
      accounts = [ownerAccount!.toLowerCase()];
    }

    if (process.env.NODE_ENV !== "production") {
      console.debug("[aa:toolkitContext] walletClient.account", (finalWalletClient as any).account);
    } else if (!usedWagmiClient) {
      console.info("[aa:toolkitContext] using fallback viem wallet client");
    }

    const context: DelegationToolkitContext = {
      provider: baseProvider,
      accounts,
      account: ownerAccount!,
      ownerAccount: ownerAccount!,
      publicClient,
      walletClient: finalWalletClient,
      walletChain: MONAD_CHAIN,
      environment: normalizeEnvironment(MONAD_DELEGATION_ENV),
      viem,
    };
    if (process.env.NODE_ENV !== "production") {
      console.debug("[aa:toolkitContext] context snapshot", {
        accounts,
        ownerAccount,
        walletClientAccount: (finalWalletClient as any).account,
      });
    }

    try {
      (window as any).__aaToolkitContext = context;
    } catch {
      // ignore window assignment issues
    }

    return context;
  })().catch((err) => {
    contextPromise = null;
    throw err;
  });

  return contextPromise;
}

export function resetDelegationToolkitContext() {
  contextPromise = null;
}

declare global {
  interface Window {
    __aaToolkitContext?: DelegationToolkitContext;
    __getSelectedProvider?: (hint?: string) => any;
    phantom?: { ethereum?: PickedProvider };
  }
}
