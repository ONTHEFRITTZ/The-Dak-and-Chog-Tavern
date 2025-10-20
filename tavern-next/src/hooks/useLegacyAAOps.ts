'use client';

import { useEffect, useState } from "react";

type LegacyAAOps = {
  encodeFromSignature?: (signature: string, args?: unknown[]) => string | null;
  sendTxViaAA?: (payload: { to: string; data: string; valueMON?: string }) => Promise<string | null>;
} | null;

/**
 * Loads the existing `/js/aa/ops.js` helper on demand so React components
 * can reuse the MetaMask delegation-toolkit integration without rewriting it.
 */
export function useLegacyAAOps(): { ops: LegacyAAOps; error: Error | null; loading: boolean } {
  const [ops, setOps] = useState<LegacyAAOps>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        if (typeof window === "undefined") return;
        setLoading(true);
        const tag = encodeURIComponent(String(window.__BUILD_TAG ?? Date.now()));
        const module = await import(
          /* webpackIgnore: true */ `/js/aa/ops.js?v=${tag}`
        );
        if (mounted) {
          setOps(module ?? null);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error("Failed to load AA ops"));
          setOps(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return { ops, error, loading };
}

declare global {
  interface Window {
    __BUILD_TAG?: string | number;
  }
}
