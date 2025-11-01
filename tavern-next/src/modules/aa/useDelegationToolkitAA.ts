'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlchemySmartAccountClient } from "@account-kit/infra";
import { createAlchemySmartAccountClient, alchemy } from "@account-kit/infra";
import { getEntryPoint, type SmartContractAccount } from "@aa-sdk/core";
import { type Chain, type Hex, type Address, type WalletClient } from "viem";
import { useWalletClient } from "wagmi";
import { useWallet } from "@/context/WalletContext";
import {
  ALCHEMY_API_KEY,
  MONAD,
  MONAD_BUNDLER_RPC,
  MONAD_CHAIN,
} from "@/lib/config";
import { ensureDelegationToolkitContext, resetDelegationToolkitContext } from "./toolkitContext";
import type { DelegationToolkitContext, PickedProvider } from "./toolkitContext";
import { loadSmartAccountAddress, storeSmartAccountAddress } from "./storage";

type SendTransactionParams = {
  to: string;
  data?: Hex | string;
  value?: bigint;
  useFallback?: boolean;
};

export type DelegationToolkitAA = {
  ready: boolean;
  initializing: boolean;
  sendTransaction: (params: SendTransactionParams) => Promise<string | null>;
  ensureReady: () => Promise<Address | null>;
  smartAccountAddress: Address | null;
  ownerAddress: Address | null;
};

type DelegationModule = any;

declare global {
  interface Window {
    AAClient?: {
      sendTransaction: (params: Record<string, unknown>) => Promise<any>;
      waitForUserOperationTransaction?: (params: Record<string, unknown>) => Promise<any>;
      smartAccountAddress?: string | null;
      __tavernClient?: boolean;
    };
  }
}

function pickImplementation(module: DelegationModule) {
  const { Implementation } = module;
  if (!Implementation) return null;
  // Prefer Hybrid when available, then fallback to Stateless7702, then MultiSig.
  return (
    Implementation.Hybrid ??
    Implementation.Stateless7702 ??
    Implementation.MultiSig ??
    null
  );
}

function deriveAlchemyRpcBase(url?: string | null) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/v2.*/i, "/v2");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function serializeBigNumberish(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Math.trunc(value).toString();
  if (typeof value === "string") return value;
  if (value == null) return "0";
  try {
    return BigInt(value as any).toString();
  } catch {
    return String(value);
  }
}

function bypassesPaymaster(overrides: Record<string, unknown> | undefined | null) {
  if (!overrides) return false;
  if (typeof overrides !== "object") return false;
  if ("paymasterAndData" in overrides) return true;
  if ("paymaster" in overrides || "paymasterData" in overrides) return true;
  return false;
}

export function useDelegationToolkitAA(): DelegationToolkitAA {
  const { provider, address } = useWallet();
  const [initializing, setInitializing] = useState(false);
  const [ready, setReady] = useState(false);
  const { data: wagmiWalletClient } = useWalletClient();
  const [smartAccountAddress, setSmartAccountAddress] = useState<Address | null>(null);
  const [ownerAddress, setOwnerAddress] = useState<Address | null>(null);

  const alchemyClientRef = useRef<AlchemySmartAccountClient | null>(null);
  const smartAccountRef = useRef<SmartContractAccount | null>(null);
  const contextRef = useRef<DelegationToolkitContext | null>(null);
  const initPromiseRef = useRef<Promise<Address | null> | null>(null);

  const resetState = useCallback(() => {
    alchemyClientRef.current = null;
    smartAccountRef.current = null;
    contextRef.current = null;
    initPromiseRef.current = null;
    setReady(false);
    setSmartAccountAddress(null);
    setOwnerAddress(null);
  }, []);

  useEffect(() => {
    if (!provider || !address) {
      resetDelegationToolkitContext();
      resetState();
    }
  }, [provider, address, resetState]);

  const ensureReady = useCallback(async (): Promise<Address | null> => {
    if (ready && alchemyClientRef.current && smartAccountRef.current) {
      try {
        const accountLike = smartAccountRef.current as any;
        if (typeof accountLike.getAddress === "function") {
          return (await accountLike.getAddress()) as Address;
        }
        return (accountLike?.address as Address) ?? smartAccountAddress ?? null;
      } catch {
        return smartAccountAddress ?? null;
      }
    }
    if (initPromiseRef.current) {
      return initPromiseRef.current;
    }

    const promise = (async (): Promise<Address | null> => {
      if (!provider || !address) {
        throw new Error("Connect wallet to continue.");
      }
      if (!wagmiWalletClient) {
        throw new Error("Wallet client unavailable");
      }
      setInitializing(true);

      const rawProvider =
        ((wagmiWalletClient.transport as any)?.value as PickedProvider | undefined) ??
        (provider as any)?.provider ??
        (provider as any);

      const ctx = await ensureDelegationToolkitContext({
        ownerAccount: address as Address,
        walletClient: wagmiWalletClient as unknown as WalletClient,
        provider: rawProvider ?? null,
      });
      contextRef.current = ctx;

      const { publicClient, walletClient, environment, ownerAccount } = ctx;
      setOwnerAddress(ownerAccount as Address);
      if (!walletClient || !publicClient) {
        throw new Error("Delegation Toolkit context incomplete");
      }

      const module: DelegationModule = await import("@metamask/delegation-toolkit");
      const implementation = pickImplementation(module);
      if (!implementation) {
        throw new Error("MetaMask Delegation Toolkit implementation unavailable");
      }

      const signerConfig =
        implementation === module.Implementation.MultiSig
          ? [{ walletClient }]
          : { walletClient };
      if (process.env.NODE_ENV !== "production") {
        console.debug("[useDelegationToolkitAA] signerConfig", {
          implementation,
          hasWalletClient: true,
        });
      }
      if (process.env.NODE_ENV !== "production") {
        console.debug("[useDelegationToolkitAA] signerConfig", {
          implementation,
          signerConfig,
          hasWalletClient: Array.isArray(signerConfig)
            ? signerConfig.some((entry) => "walletClient" in entry)
            : "walletClient" in (signerConfig as Record<string, unknown>),
        });
      }

      const storedAddress = loadSmartAccountAddress(publicClient.chain?.id ?? MONAD.id);
      const multiSigDeployParams: [string[], bigint] = [[ownerAccount], 1n];
      const hybridDeployParams: [string, string[], string[], string[]] = [ownerAccount, [], [], []];

      const accountOptions = storedAddress
        ? { address: storedAddress }
        : implementation === module.Implementation.MultiSig
        ? { deployParams: multiSigDeployParams, deploySalt: "0x0" as const }
        : implementation === module.Implementation.Hybrid
        ? { deployParams: hybridDeployParams, deploySalt: "0x0" as const }
        : {};

      const smartAccount = await module.toMetaMaskSmartAccount({
        client: publicClient as any,
        implementation,
        signer: signerConfig as any,
        environment,
        ...accountOptions,
      });

      const accountLike = smartAccount as any;
      const derivedSmartAccountAddress =
        typeof accountLike.getAddress === "function"
          ? await accountLike.getAddress()
          : accountLike.address;
      if (derivedSmartAccountAddress) {
        setSmartAccountAddress(derivedSmartAccountAddress as Address);
        storeSmartAccountAddress(publicClient.chain?.id ?? MONAD.id, derivedSmartAccountAddress);
      }

      const alchemyBase = deriveAlchemyRpcBase(MONAD_BUNDLER_RPC);
      const chain: Chain = (alchemyBase
        ? {
            ...MONAD_CHAIN,
            rpcUrls: {
              ...MONAD_CHAIN.rpcUrls,
              alchemy: {
                ...(MONAD_CHAIN.rpcUrls as any)?.alchemy,
                http: [alchemyBase],
              },
            },
          }
        : MONAD_CHAIN) as Chain;

      const transportConfig: Parameters<typeof alchemy>[0] = (() => {
        if (ALCHEMY_API_KEY) {
          return { apiKey: ALCHEMY_API_KEY };
        }
        if (MONAD_BUNDLER_RPC) {
          return { rpcUrl: MONAD_BUNDLER_RPC };
        }
        throw new Error(
          "Alchemy bundler configuration missing. Set NEXT_PUBLIC_ALCHEMY_API_KEY or NEXT_PUBLIC_MONAD_BUNDLER_RPC."
        );
      })();

      const transport = alchemy(transportConfig);

      const attachPaymaster = async (uo: any) => {
        try {
          const payload: Record<string, unknown> = {
            sender: uo.sender,
            nonce: serializeBigNumberish(uo.nonce),
            initCode: uo.initCode ?? "0x",
            callData: uo.callData ?? "0x",
            callGasLimit: serializeBigNumberish(uo.callGasLimit),
            verificationGasLimit: serializeBigNumberish(
              uo.verificationGasLimit ?? uo.paymasterVerificationGasLimit
            ),
            preVerificationGas: serializeBigNumberish(uo.preVerificationGas),
            maxFeePerGas: serializeBigNumberish(uo.maxFeePerGas),
            maxPriorityFeePerGas: serializeBigNumberish(uo.maxPriorityFeePerGas),
            signature: "0x",
            paymasterAndData: "0x",
          };
          if ("paymasterVerificationGasLimit" in uo) {
            payload.paymasterVerificationGasLimit = serializeBigNumberish(
              uo.paymasterVerificationGasLimit
            );
          }
          if ("paymasterPostOpGasLimit" in uo) {
            payload.paymasterPostOpGasLimit = serializeBigNumberish(
              uo.paymasterPostOpGasLimit
            );
          }

          const nowSeconds = Math.floor(Date.now() / 1000);
          const response = await fetch("/api/paymaster/sign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userOperation: payload,
              validUntil: nowSeconds + 3600,
              validAfter: 0,
            }),
          });

          if (!response.ok) {
            throw new Error(`paymaster/sign ${response.status}`);
          }

          const result = await response.json();
          if (result?.paymasterAndData) {
            return {
              ...uo,
              paymasterAndData: result.paymasterAndData as Hex,
            };
          }
          if (result?.paymaster && result?.paymasterData) {
            return {
              ...uo,
              paymaster: result.paymaster as Hex,
              paymasterData: result.paymasterData as Hex,
            };
          }
        } catch (err) {
          console.warn("[useDelegationToolkitAA] paymaster signing failed", err);
        }
        return uo;
      };

      const metamaskAccount = smartAccount as SmartContractAccount & {
        entryPoint?: { address: string; version?: string };
        getEntryPoint?: () => ReturnType<typeof getEntryPoint>;
      };
      if (!metamaskAccount.getEntryPoint) {
        const entryPointVersion = metamaskAccount.entryPoint?.version as string | undefined;
        const entryPointDef =
          entryPointVersion != null
            ? getEntryPoint(chain, { version: entryPointVersion as any })
            : getEntryPoint(chain);
        metamaskAccount.getEntryPoint = () => entryPointDef;
      }

      const alchemyClient = await createAlchemySmartAccountClient({
        chain,
        transport,
        account: metamaskAccount as SmartContractAccount,
        customMiddleware: async (struct, context) => {
          if (context?.overrides && bypassesPaymaster(context.overrides)) {
            return struct;
          }
          return attachPaymaster(struct);
        },
      });

      const identityMiddleware = async (uo: any) => uo;
      const zeroPaymasterMiddleware = async (uo: any) => {
        if (uo && typeof uo === "object") {
          if ("paymasterAndData" in uo) {
            return { ...uo, paymasterAndData: "0x" };
          }
          if ("paymaster" in uo || "paymasterData" in uo) {
            return {
              ...uo,
              paymaster: "0x",
              paymasterData: "0x",
            };
          }
        }
        return uo;
      };
      if (alchemyClient?.middleware) {
        (alchemyClient.middleware as any).paymasterAndData = identityMiddleware;
        (alchemyClient.middleware as any).dummyPaymasterAndData = zeroPaymasterMiddleware;
      }

      smartAccountRef.current = smartAccount;
      alchemyClientRef.current = alchemyClient;
      setReady(true);
      return derivedSmartAccountAddress as Address | null;
    })().catch((err) => {
      resetState();
      throw err;
    });

    initPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      setInitializing(false);
      initPromiseRef.current = null;
    }
  }, [
    address,
    provider,
    ready,
    resetState,
    wagmiWalletClient,
    smartAccountAddress,
  ]);

  const sendTransaction = useCallback(
    async ({ to, data, value = 0n, useFallback = true }: SendTransactionParams) => {
      if (!to) {
        throw new Error("Transaction target missing");
      }

      try {
        await ensureReady();
      } catch (err) {
        console.warn("[useDelegationToolkitAA] initialization failed", err);
        throw err;
      }

      const alchemyClient = alchemyClientRef.current;
      if (!alchemyClient) {
        throw new Error("Alchemy smart account client unavailable");
      }

      try {
        const userOpHash = await (alchemyClient as any).sendTransaction({
          to: to as Hex,
          data: data as Hex | undefined,
          value,
        });
        const txHash = await (alchemyClient as any).waitForUserOperationTransaction({ hash: userOpHash });
        return txHash;
      } catch (err) {
        console.warn("[useDelegationToolkitAA] sendTransaction via AA failed", err);
        if (!useFallback) {
          throw err;
        }
        if (!provider) throw err;
        const signer = await provider.getSigner();
        const txResponse = await signer.sendTransaction({
          to,
          data,
          value,
        });
        const receipt = await txResponse.wait();
        return receipt?.hash ?? txResponse.hash ?? null;
      }
    },
    [ensureReady, provider]
  );

  useEffect(() => {
    if (!provider || !address || !wagmiWalletClient) {
      return;
    }
    if (ready || initializing) {
      return;
    }
    ensureReady().catch((err) => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[useDelegationToolkitAA] auto ensureReady failed", err);
      }
    });
  }, [provider, address, wagmiWalletClient, ready, initializing, ensureReady]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!ready || !alchemyClientRef.current) {
      if (window.AAClient && window.AAClient.__tavernClient) {
        delete window.AAClient;
      }
      return;
    }

    const client = alchemyClientRef.current;
    window.AAClient = {
      __tavernClient: true,
      smartAccountAddress: smartAccountAddress ?? null,
      sendTransaction: async (params: Record<string, unknown>) => {
        const to = (params?.to as string) ?? (params?.target as string);
        if (!to) {
          throw new Error("Transaction target missing");
        }
        const data = (params?.data ?? params?.calldata) as Hex | string | undefined;
        const noFallback = params?.noSignerFallback === true;

        let valueBigInt: bigint = 0n;
        const rawValue = params?.value ?? params?.valueHex ?? params?.valueWei;
        if (typeof rawValue === "bigint") {
          valueBigInt = rawValue;
        } else if (typeof rawValue === "number") {
          valueBigInt = BigInt(Math.trunc(rawValue));
        } else if (typeof rawValue === "string" && rawValue) {
          try {
            valueBigInt = rawValue.startsWith("0x") ? BigInt(rawValue) : BigInt(rawValue);
          } catch {
            // ignore parse errors, default to zero
          }
        }

        return await sendTransaction({
          to,
          data,
          value: valueBigInt,
          useFallback: !noFallback,
        });
      },
      waitForUserOperationTransaction: async (params: Record<string, unknown>) => {
        const hash = (params?.hash as Hex | string | undefined) ?? undefined;
        if (!hash) return null;
        const waitFn = (client as any)?.waitForUserOperationTransaction;
        if (typeof waitFn === "function") {
          return waitFn({ hash });
        }
        return null;
      },
    };

    try {
      window.dispatchEvent(
        new CustomEvent("aa:client-ready", {
          detail: {
            address: smartAccountAddress ?? null,
          },
        })
      );
    } catch {
      /* no-op */
    }

    return () => {
      if (window.AAClient && window.AAClient.__tavernClient) {
        delete window.AAClient;
      }
    };
  }, [ready, smartAccountAddress, sendTransaction]);

  return useMemo(
    () => ({
      ready,
      initializing,
      sendTransaction,
      ensureReady,
      smartAccountAddress,
      ownerAddress,
    }),
    [ready, initializing, sendTransaction, ensureReady, smartAccountAddress, ownerAddress]
  );
}




