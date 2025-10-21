'use client';

import { useEffect } from "react";

export type BackdropKey =
  | "tavern"
  | "poker-floor"
  | "poker-table"
  | "hazard"
  | "shell"
  | "dakchog"
  | "blackjack"
  | "none";

export function usePageBackdrop(backdrop: BackdropKey) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.body.dataset.backdrop ?? null;
    document.body.dataset.backdrop = backdrop;
    return () => {
      if (previous) {
        document.body.dataset.backdrop = previous;
      } else {
        delete document.body.dataset.backdrop;
      }
    };
  }, [backdrop]);
}
