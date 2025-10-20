'use client';

import { useEffect, useState } from "react";

type LegacyAA = typeof window extends { AA: infer T } ? T : any;

export function useAAClient(): LegacyAA | null {
  const [ready, setReady] = useState<LegacyAA | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const maybeAA = (window as any).AA;
    if (maybeAA) {
      setReady(maybeAA);
      return;
    }
    const handler = () => {
      const aa = (window as any).AA;
      if (aa) {
        setReady(aa);
        window.removeEventListener("aa:ready", handler as EventListener);
      }
    };
    window.addEventListener("aa:ready", handler as EventListener);
    return () => window.removeEventListener("aa:ready", handler as EventListener);
  }, []);

  return ready;
}
