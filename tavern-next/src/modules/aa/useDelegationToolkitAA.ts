'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MONAD_BUNDLER_RPC } from "@/lib/config";

type AaClientModule = {
  initAA: (opts?: { bundlerUrl?: string; paymasterUrl?: string; provider?: unknown }) => Promise<any>;
  client?: {
    sendTransaction?: (tx: { to: string; data?: string; value?: bigint }) => Promise<string | null>;
  };
};

type SendTransactionParams = {
  to: string;
  data?: string;
  value?: bigint;
};

export type DelegationToolkitAA = {
  ready: boolean;
  initializing: boolean;
  sendTransaction: (params: SendTransactionParams) => Promise<string | null>;
  ensureReady: () => Promise<void>;
};

const PAYMASTER_SIGN_ENDPOINT = "/api/paymaster/sign";

export function useDelegationToolkitAA(): DelegationToolkitAA {
  const moduleRef = useRef<AaClientModule | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  const [initializing, setInitializing] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ensureModule = useCallback(async (): Promise<AaClientModule> => {
    if (moduleRef.current) return moduleRef.current;
    const mod: AaClientModule = await import(
      /* webpackIgnore: true */ "/js/aaClient.js"
    );
    moduleRef.current = mod;
    return mod;
  }, []);

  const ensureReady = useCallback(async () => {
    if (ready) return;
    if (initPromiseRef.current) {
      await initPromiseRef.current;
      return;
    }
    const promise = (async () => {
      setInitializing(true);
      try {
        const mod = await ensureModule();
        const bundlerUrl = MONAD_BUNDLER_RPC || undefined;
        const paymasterUrl = PAYMASTER_SIGN_ENDPOINT;
        await mod.initAA({
          bundlerUrl,
          paymasterUrl,
        });
        if (mountedRef.current) {
          setReady(true);
        }
      } finally {
        if (mountedRef.current) {
          setInitializing(false);
        }
        initPromiseRef.current = null;
      }
    })();
    initPromiseRef.current = promise;
    await promise;
  }, [ensureModule, ready]);

  const sendTransaction = useCallback(
    async ({ to, data, value = 0n }: SendTransactionParams) => {
      if (!to) throw new Error("Transaction target missing");
      await ensureReady();
      const mod = moduleRef.current;
      if (!mod?.client?.sendTransaction) {
        throw new Error("Delegation Toolkit client unavailable");
      }
      try {
        const hash = await mod.client.sendTransaction({
          to,
          data,
          value,
        });
        return hash ?? null;
      } catch (err) {
        console.warn("[useDelegationToolkitAA] sendTransaction failed", err);
        throw err;
      }
    },
    [ensureReady]
  );

  return useMemo(
    () => ({
      ready,
      initializing,
      sendTransaction,
      ensureReady,
    }),
    [ready, initializing, sendTransaction, ensureReady]
  );
}
