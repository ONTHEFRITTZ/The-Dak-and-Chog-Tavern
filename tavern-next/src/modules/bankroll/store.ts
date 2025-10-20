import { useSyncExternalStore } from "react";

export type BankrollSnapshot = {
  dcmonBalance: bigint;
  monBalance: bigint;
  loading: boolean;
  lastUpdated: number | null;
};

type Listener = () => void;

const listeners = new Set<Listener>();

let state: BankrollSnapshot = {
  dcmonBalance: 0n,
  monBalance: 0n,
  loading: false,
  lastUpdated: null,
};

function emit() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.warn("[BankrollStore] listener error", err);
    }
  }
}

export function getBankrollState(): BankrollSnapshot {
  return state;
}

export function updateBankrollState(partial: Partial<BankrollSnapshot>) {
  const next: BankrollSnapshot = {
    ...state,
    ...partial,
    lastUpdated: partial.lastUpdated ?? Date.now(),
  };
  state = next;
  emit();
}

export function subscribeBankroll(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBankrollState(): BankrollSnapshot {
  return useSyncExternalStore(
    subscribeBankroll,
    getBankrollState,
    getBankrollState
  );
}

