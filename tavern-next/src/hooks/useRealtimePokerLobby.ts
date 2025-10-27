'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";

export type PokerLobbyMeta = {
  typeLabel?: string;
  typeKey?: string;
  tooltip?: string;
  currency?: string;
  decimals?: number;
  blinds?: { sb?: string; bb?: string };
  minBuy?: { amount?: string; unit?: string; wei?: string };
  maxBuy?: { amount?: string; unit?: string; wei?: string };
  stackRequirement?: string;
  preflight?: {
    needsWallet?: boolean;
    needsDcmon?: boolean;
    needsSponsor?: boolean;
  };
  chipValueDcmon?: number;
  tableMode?: "onchain" | "f2p";
};

export type PokerLobbyTable = {
  id: string;
  seated: number;
  capacity: number;
  started: boolean;
  simulated: boolean;
  limit?: string | null;
  stakes?: string | null;
  tableMode: "onchain" | "f2p";
  dealerSigner: boolean;
  meta?: PokerLobbyMeta | null;
};

export type RealtimeState = {
  paused: boolean;
  rakeBps: number;
  feesAccrued: bigint;
};

type LobbyEventTable = {
  id?: unknown;
  seated?: unknown;
  capacity?: unknown;
  started?: unknown;
  simulated?: unknown;
  limit?: unknown;
  stakes?: unknown;
  tableMode?: unknown;
  dealerSigner?: unknown;
  meta?: unknown;
};

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function normalizeMeta(meta: unknown, fallbackMode: "onchain" | "f2p"): PokerLobbyMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = meta as Record<string, unknown>;
  const blindsRaw = raw.blinds;
  const normalizeCurrencyAmount = (input: unknown) => {
    if (!input || typeof input !== "object") return undefined;
    const obj = input as Record<string, unknown>;
    return {
      amount: obj.amount != null ? asString(obj.amount) : undefined,
      unit: obj.unit != null ? asString(obj.unit) : undefined,
      wei: obj.wei != null ? asString(obj.wei) : undefined,
    };
  };

  const preflightRaw = raw.preflight;
  const normalized: PokerLobbyMeta = {
    typeLabel: raw.typeLabel != null ? asString(raw.typeLabel) : undefined,
    typeKey: raw.typeKey != null ? asString(raw.typeKey) : undefined,
    tooltip: raw.tooltip != null ? asString(raw.tooltip) : undefined,
    currency: raw.currency != null ? asString(raw.currency) : undefined,
    decimals:
      raw.decimals != null
        ? asNumber(raw.decimals, Number.isInteger(raw.decimals) ? (raw.decimals as number) : 18)
        : undefined,
    blinds:
      blindsRaw && typeof blindsRaw === "object"
        ? {
            sb: (blindsRaw as Record<string, unknown>).sb != null
              ? asString((blindsRaw as Record<string, unknown>).sb)
              : undefined,
            bb: (blindsRaw as Record<string, unknown>).bb != null
              ? asString((blindsRaw as Record<string, unknown>).bb)
              : undefined,
          }
        : undefined,
    minBuy: normalizeCurrencyAmount(raw.minBuy),
    maxBuy: normalizeCurrencyAmount(raw.maxBuy),
    stackRequirement: raw.stackRequirement != null ? asString(raw.stackRequirement) : undefined,
    preflight:
      preflightRaw && typeof preflightRaw === "object"
        ? {
            needsWallet: asBoolean((preflightRaw as Record<string, unknown>).needsWallet),
            needsDcmon: asBoolean((preflightRaw as Record<string, unknown>).needsDcmon),
            needsSponsor: asBoolean((preflightRaw as Record<string, unknown>).needsSponsor),
          }
        : undefined,
    chipValueDcmon:
      raw.chipValueDcmon != null ? Number(raw.chipValueDcmon) || undefined : undefined,
    tableMode:
      raw.tableMode === "onchain" || raw.tableMode === "f2p"
        ? (raw.tableMode as "onchain" | "f2p")
        : fallbackMode,
  };

  return normalized;
}

function normalizeLobbyTable(entry: LobbyEventTable): PokerLobbyTable | null {
  const id = asString(entry.id);
  if (!id) return null;
  const tableModeRaw = asString(entry.tableMode).toLowerCase();
  const mode: "onchain" | "f2p" = tableModeRaw === "onchain" ? "onchain" : "f2p";
  const meta = normalizeMeta(entry.meta, mode);
  return {
    id,
    seated: asNumber(entry.seated),
    capacity: Math.max(0, asNumber(entry.capacity, mode === "onchain" ? 6 : 9)),
    started: asBoolean(entry.started),
    simulated: mode === "f2p" || asBoolean(entry.simulated),
    limit: entry.limit != null ? asString(entry.limit) : null,
    stakes: entry.stakes != null ? asString(entry.stakes) : null,
    tableMode: mode,
    dealerSigner: asBoolean(entry.dealerSigner),
    meta,
  };
}

function normalizeRtState(payload: any): RealtimeState {
  const paused = asBoolean(payload?.paused);
  const rakeBps = asNumber(payload?.rakeBps);
  let feesAccrued: bigint = 0n;
  const raw = payload?.feesAccrued;
  if (typeof raw === "bigint") {
    feesAccrued = raw;
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    feesAccrued = BigInt(Math.max(0, Math.floor(raw)));
  } else if (typeof raw === "string") {
    try {
      feesAccrued = raw.startsWith("0x") ? BigInt(raw) : BigInt(Math.floor(Number(raw)));
    } catch {
      feesAccrued = 0n;
    }
  }
  return { paused, rakeBps, feesAccrued };
}

export type UseRealtimePokerLobbyOptions = {
  /**
   * Provide the base URL for the Socket.IO client. Defaults to the current origin.
   */
  url?: string;
  /**
   * Optional flag to delay connection until explicitly triggered.
   */
  autoConnect?: boolean;
};

export type UseRealtimePokerLobbyResult = {
  tables: PokerLobbyTable[];
  state: RealtimeState | null;
  connected: boolean;
  connecting: boolean;
  status: string | null;
  error: string | null;
  joinTable: (tableId: string) => void;
  identify: (address: string | null | undefined) => void;
  disconnect: () => void;
  reconnect: () => void;
};

export function useRealtimePokerLobby(
  options: UseRealtimePokerLobbyOptions = {}
): UseRealtimePokerLobbyResult {
  const [tables, setTables] = useState<PokerLobbyTable[]>([]);
  const [state, setState] = useState<RealtimeState | null>(null);
  const [status, setStatus] = useState<string | null>("Connecting to lobby...");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const pendingIdentifyRef = useRef<string | null>(null);
  const connectingRef = useRef(false);

  const connecting = useMemo(() => connectingRef.current && !connected, [connected]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { autoConnect = true } = options;
    const baseUrl = options.url || window.location.origin;
    const socket = io(baseUrl, {
      path: "/poker.io/",
      transports: ["polling", "websocket"],
      autoConnect: autoConnect,
      reconnection: true,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    const handleConnect = () => {
      setConnected(true);
      connectingRef.current = false;
      setStatus(null);
      setError(null);
      socket.emit("lobby:get");
      const pending = pendingIdentifyRef.current;
      if (pending) {
        socket.emit("identify", { addr: pending });
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
      setStatus("Disconnected");
    };

    const handleConnectError = (err: any) => {
      setError(err?.message || "Lobby connection failed");
      setStatus("Lobby unavailable. Retrying...");
    };

    const handleLobbyList = (list: unknown) => {
      if (!Array.isArray(list)) return;
      const normalized: PokerLobbyTable[] = [];
      for (const entry of list) {
        const table = normalizeLobbyTable(entry as LobbyEventTable);
        if (table) normalized.push(table);
      }
      normalized.sort((a, b) => a.id.localeCompare(b.id));
      const filtered = normalized.filter((table) => {
        const id = table.id.toLowerCase();
        const typeKey = table.meta?.typeKey?.toLowerCase();
        return !id.startsWith("faro") && typeKey !== "faro";
      });
      setTables(filtered);
      setStatus(null);
    };

    const handleRtState = (payload: any) => {
      setState(normalizeRtState(payload));
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("reconnect_error", handleConnectError);
    socket.on("lobby:list", handleLobbyList);
    socket.on("rt:state", handleRtState);

    if (autoConnect && !socket.connected) {
      connectingRef.current = true;
      socket.connect();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("reconnect_error", handleConnectError);
      socket.off("lobby:list", handleLobbyList);
      socket.off("rt:state", handleRtState);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [options]);

  const joinTable = useCallback((tableId: string) => {
    if (!tableId) return;
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("join_table", { table: tableId });
  }, []);

  const identify = useCallback((address: string | null | undefined) => {
    const normalized = address ? address.toLowerCase() : null;
    pendingIdentifyRef.current = normalized;
    const socket = socketRef.current;
    if (socket?.connected && normalized) {
      socket.emit("identify", { addr: normalized });
    }
  }, []);

  const disconnect = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.disconnect();
  }, []);

  const reconnect = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (!socket.connected) {
      connectingRef.current = true;
      socket.connect();
    }
  }, []);

  return {
    tables,
    state,
    connected,
    connecting,
    status,
    error,
    joinTable,
    identify,
    disconnect,
    reconnect,
  };
}
