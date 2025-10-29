'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { resolveRealtimeEndpoint } from "@/lib/realtime";

export type PokerSeat = {
  id: number;
  addr: string;
  balance: number;
  lastActive: number;
  chips?: number;
  x?: number | null;
};

export type PokerActor = {
  seatId: number;
  addr: string;
  contrib: number;
  folded: boolean;
  acted: boolean;
  stack?: number;
};

export type PokerTableMeta = {
  chipValueDcmon?: number;
  blinds?: { sb?: string; bb?: string } | null;
  minBuy?: { amount?: string; unit?: string; wei?: string } | null;
  typeKey?: string | null;
  tableMode?: "onchain" | "f2p" | null;
};

export type PokerState = {
  stage: string;
  community: string[];
  pot: number;
  toCall: number;
  turnIndex: number;
  turnSeatId?: number;
  dealerIndex?: number;
  sbIndex?: number;
  bbIndex?: number;
  dealerSeatId?: number;
  actors: PokerActor[];
  rng?: { commit?: string | null };
};

export type PokerPrivate = {
  seatId: number;
  addr: string;
  cards: string[];
};

export type PokerWinner = {
  addr: string;
  seatId?: number;
  amount?: number;
  combo?: string[];
};

export type PokerExposure = {
  addr: string;
  seatId: number;
  cards: string[];
};

export type PokerHandSummary = {
  winners: PokerWinner[];
  community: string[];
  exposures: PokerExposure[];
  pot: number;
  rng?: { commit?: string | null; seed?: string | null };
};

export type PokerTableSnapshot = {
  id: string;
  seats: (PokerSeat | null)[];
  started: boolean;
  simulated: boolean;
  tableMode?: "onchain" | "f2p";
  dealerSigner?: boolean;
  limit?: string | null;
  stakes?: string | null;
  capacity: number;
  meta?: PokerTableMeta | null;
};

export type PokerRealtimeMessage = {
  id: number;
  level: "system" | "chat";
  text: string;
  from?: string;
  at: number;
};

export type UseRealtimePokerTableOptions = {
  url?: string;
  autoConnect?: boolean;
};

export type UseRealtimePokerTableResult = {
  table: PokerTableSnapshot | null;
  state: PokerState | null;
  privateCards: PokerPrivate | null;
  handSummary: PokerHandSummary | null;
  messages: PokerRealtimeMessage[];
  connected: boolean;
  connecting: boolean;
  status: string | null;
  error: string | null;
  identify: (address: string | null | undefined) => void;
  joinTable: (tableId: string) => void;
  setSeat: (seatIndex: number) => void;
  leaveSeat: () => void;
  sendAction: (action: string, amount?: number | string | null) => void;
  sendChat: (message: string) => void;
  requestRebuy: () => void;
  reconnect: () => void;
  disconnect: () => void;
};

type RawSeat = {
  id?: unknown;
  addr?: unknown;
  balance?: unknown;
  lastActive?: unknown;
  chips?: unknown;
  x?: unknown;
};

type RawPokerState = {
  stage?: unknown;
  community?: unknown;
  pot?: unknown;
  toCall?: unknown;
  turnIndex?: unknown;
  turnSeatId?: unknown;
  dealerIndex?: unknown;
  sbIndex?: unknown;
  bbIndex?: unknown;
  dealerSeatId?: unknown;
  actors?: unknown;
  rng?: unknown;
};

type RawTableMeta = {
  chipValueDcmon?: unknown;
  blinds?: unknown;
  minBuy?: unknown;
  typeKey?: unknown;
  tableMode?: unknown;
};

type RawActor = {
  seatId?: unknown;
  addr?: unknown;
  contrib?: unknown;
  folded?: unknown;
  acted?: unknown;
  stack?: unknown;
};

type RawPrivate = {
  seatId?: unknown;
  addr?: unknown;
  cards?: unknown;
};

type RawHandSummary = {
  winners?: unknown;
  community?: unknown;
  exposures?: unknown;
  pot?: unknown;
  rng?: unknown;
};

function toLowerAddr(value: unknown): string {
  if (typeof value === "string" && value.startsWith("0x") && value.length === 42) {
    return value.toLowerCase();
  }
  return "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item == null) return "";
      return String(item);
    })
    .filter((item) => item.length > 0);
}

function normalizeSeat(entry: unknown): PokerSeat | null {
  if (!entry || typeof entry !== "object") return null;
  const seat = entry as RawSeat;
  const id = asNumber(seat.id);
  const addr = toLowerAddr(seat.addr);
  if (!Number.isInteger(id) || id < 0) return null;
  if (!addr) return null;
  return {
    id,
    addr,
    balance: asNumber(seat.balance),
    lastActive: asNumber(seat.lastActive),
    chips: seat.chips != null ? asNumber(seat.chips) : undefined,
    x: typeof seat.x === "number" ? seat.x : null,
  };
}

function normalizeTable(payload: unknown): PokerTableSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const table = payload as Record<string, unknown>;
  const id = typeof table.id === "string" ? table.id : "";
  if (!id) return null;
  const seatsRaw = Array.isArray(table.seats) ? table.seats : [];
  const seats = seatsRaw.map((seat) => normalizeSeat(seat));
  const capacity = asNumber(table.capacity);
  const normalizeMeta = (meta: unknown): PokerTableMeta | null => {
    if (!meta || typeof meta !== "object") return null;
    const record = meta as RawTableMeta & Record<string, unknown>;
    const blindsRaw = record.blinds;
    const minBuyRaw = record.minBuy;
    return {
      chipValueDcmon:
        record.chipValueDcmon != null ? Number(record.chipValueDcmon) || undefined : undefined,
      blinds:
        blindsRaw && typeof blindsRaw === "object"
          ? {
              sb:
                (blindsRaw as Record<string, unknown>).sb != null
                  ? String((blindsRaw as Record<string, unknown>).sb)
                  : undefined,
              bb:
                (blindsRaw as Record<string, unknown>).bb != null
                  ? String((blindsRaw as Record<string, unknown>).bb)
                  : undefined,
            }
          : null,
      minBuy:
        minBuyRaw && typeof minBuyRaw === "object"
          ? {
              amount:
                (minBuyRaw as Record<string, unknown>).amount != null
                  ? String((minBuyRaw as Record<string, unknown>).amount)
                  : undefined,
              unit:
                (minBuyRaw as Record<string, unknown>).unit != null
                  ? String((minBuyRaw as Record<string, unknown>).unit)
                  : undefined,
              wei:
                (minBuyRaw as Record<string, unknown>).wei != null
                  ? String((minBuyRaw as Record<string, unknown>).wei)
                  : undefined,
            }
          : null,
      typeKey:
        record.typeKey != null
          ? String(record.typeKey)
          : typeof (meta as Record<string, unknown>).typeKey === "string"
          ? ((meta as Record<string, unknown>).typeKey as string)
          : null,
      tableMode:
        record.tableMode != null && typeof record.tableMode === "string"
          ? (record.tableMode as PokerTableMeta["tableMode"])
          : null,
    };
  };
  const meta = table.meta != null ? normalizeMeta(table.meta) : null;
  const tableMode =
    typeof table.tableMode === "string"
      ? (table.tableMode as PokerTableSnapshot["tableMode"])
      : meta?.tableMode ?? (table.simulated ? "f2p" : "onchain");
  return {
    id,
    seats,
    started: asBoolean(table.started),
    simulated: asBoolean(table.simulated) || false,
    tableMode,
    dealerSigner: typeof table.dealerSigner === "boolean" ? table.dealerSigner : undefined,
    limit: typeof table.limit === "string" ? table.limit : null,
    stakes: typeof table.stakes === "string" ? table.stakes : null,
    capacity: capacity > 0 ? capacity : Math.max(seats.length, 6),
    meta,
  };
}

function normalizeActor(entry: unknown): PokerActor | null {
  if (!entry || typeof entry !== "object") return null;
  const actor = entry as RawActor;
  const seatId = asNumber(actor.seatId);
  if (!Number.isInteger(seatId) || seatId < 0) return null;
  const addr = toLowerAddr(actor.addr);
  if (!addr) return null;
  const contrib = asNumber(actor.contrib);
  const stackValue = actor.stack != null ? asNumber(actor.stack) : undefined;
  return {
    seatId,
    addr,
    contrib,
    folded: asBoolean(actor.folded),
    acted: asBoolean(actor.acted),
    stack: stackValue,
  };
}

function normalizePokerState(payload: unknown): PokerState | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as RawPokerState;
  const stage = typeof raw.stage === "string" ? raw.stage : "";
  if (!stage) return null;
  const actorsRaw = Array.isArray(raw.actors) ? raw.actors : [];
  const actors: PokerActor[] = [];
  for (const entry of actorsRaw) {
    const actor = normalizeActor(entry);
    if (actor) actors.push(actor);
  }
  return {
    stage,
    community: asStringArray(raw.community),
    pot: asNumber(raw.pot),
    toCall: asNumber(raw.toCall),
    turnIndex: asNumber(raw.turnIndex),
    turnSeatId:
      raw.turnSeatId != null && Number.isFinite(Number(raw.turnSeatId))
        ? Number(raw.turnSeatId)
        : undefined,
    dealerIndex:
      raw.dealerIndex != null && Number.isFinite(Number(raw.dealerIndex))
        ? Number(raw.dealerIndex)
        : undefined,
    sbIndex:
      raw.sbIndex != null && Number.isFinite(Number(raw.sbIndex)) ? Number(raw.sbIndex) : undefined,
    bbIndex:
      raw.bbIndex != null && Number.isFinite(Number(raw.bbIndex)) ? Number(raw.bbIndex) : undefined,
    dealerSeatId:
      raw.dealerSeatId != null && Number.isFinite(Number(raw.dealerSeatId))
        ? Number(raw.dealerSeatId)
        : undefined,
    actors,
    rng:
      raw.rng && typeof raw.rng === "object"
        ? { commit: (raw.rng as Record<string, unknown>).commit as string | null | undefined }
        : undefined,
  };
}

function normalizePrivate(payload: unknown): PokerPrivate | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as RawPrivate;
  const seatId = asNumber(raw.seatId);
  if (!Number.isInteger(seatId) || seatId < 0) return null;
  const addr = toLowerAddr(raw.addr);
  return {
    seatId,
    addr,
    cards: asStringArray(raw.cards),
  };
}

function normalizeWinners(value: unknown): PokerWinner[] {
  if (!Array.isArray(value)) return [];
  const winners: PokerWinner[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const addr = toLowerAddr(row.addr);
    if (!addr) continue;
    const seatId = row.seatId != null ? asNumber(row.seatId) : undefined;
    const amount = row.amount != null ? asNumber(row.amount) : undefined;
    const combo = row.combo != null ? asStringArray(row.combo) : undefined;
    winners.push({ addr, seatId, amount, combo });
  }
  return winners;
}

function normalizeExposures(value: unknown): PokerExposure[] {
  if (!Array.isArray(value)) return [];
  const exposures: PokerExposure[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const addr = toLowerAddr(row.addr);
    const seatId = asNumber(row.seatId);
    if (!addr || !Number.isInteger(seatId) || seatId < 0) continue;
    exposures.push({ addr, seatId, cards: asStringArray(row.cards) });
  }
  return exposures;
}

function normalizeHandSummary(payload: unknown): PokerHandSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as RawHandSummary;
  const winners = normalizeWinners(raw.winners);
  const community = asStringArray(raw.community);
  const exposures = normalizeExposures(raw.exposures);
  const pot = asNumber(raw.pot);
  const rng =
    raw.rng && typeof raw.rng === "object"
      ? {
          commit: (raw.rng as Record<string, unknown>).commit as string | null | undefined,
          seed: (raw.rng as Record<string, unknown>).seed as string | null | undefined,
        }
      : undefined;
  return { winners, community, exposures, pot, rng };
}

export function useRealtimePokerTable(
  tableId: string,
  options?: UseRealtimePokerTableOptions
): UseRealtimePokerTableResult {
  const [table, setTable] = useState<PokerTableSnapshot | null>(null);
  const [state, setState] = useState<PokerState | null>(null);
  const [privateCards, setPrivateCards] = useState<PokerPrivate | null>(null);
  const [handSummary, setHandSummary] = useState<PokerHandSummary | null>(null);
  const [messages, setMessages] = useState<PokerRealtimeMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string | null>("Connecting to table...");
  const [error, setError] = useState<string | null>(null);
  const messageIdRef = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const pendingIdentifyRef = useRef<string | null>(null);
  const pendingJoinRef = useRef<string | null>(tableId);
  const connectingRef = useRef(false);

  const connecting = useMemo(() => connectingRef.current && !connected, [connected]);
  const autoConnect = options?.autoConnect ?? true;
  const endpointUrl = options?.url ?? null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const endpoint = resolveRealtimeEndpoint(endpointUrl);
    const connectionOptions = {
      path: endpoint.socketPath,
      transports: ["polling", "websocket"],
      autoConnect: autoConnect,
      reconnection: true,
      reconnectionAttempts: Infinity,
    };
    const socket = endpoint.baseUrl
      ? io(endpoint.baseUrl, connectionOptions)
      : io(connectionOptions);
    socketRef.current = socket;

    const handleConnect = () => {
      setConnected(true);
      connectingRef.current = false;
      setStatus(null);
      setError(null);
      const pendingAddr = pendingIdentifyRef.current;
      if (pendingAddr) {
        socket.emit("identify", { addr: pendingAddr });
      }
      const pendingTable = pendingJoinRef.current ?? tableId;
      if (pendingTable) {
        socket.emit("join_table", { table: pendingTable });
        setStatus(`Joined table ${pendingTable}`);
      }
      socket.emit("lobby:get");
    };

    const handleDisconnect = () => {
      setConnected(false);
      setStatus("Disconnected from table");
    };

    const handleConnectError = (err: any) => {
      setError(err?.message || "Poker table connection failed");
      setStatus("Reconnecting...");
    };

    const handleTableUpdate = (payload: unknown) => {
      const normalized = normalizeTable(payload);
      if (normalized) {
        setTable(normalized);
      }
    };

    const handlePokerState = (payload: unknown) => {
      const normalized = normalizePokerState(payload);
      if (normalized) {
        setState(normalized);
        setHandSummary(null);
      }
    };

    const handlePokerPrivate = (payload: unknown) => {
      const normalized = normalizePrivate(payload);
      setPrivateCards(normalized);
    };

    const handlePokerHand = (payload: unknown) => {
      const summary = normalizeHandSummary(payload);
      if (summary) {
        setHandSummary(summary);
      }
      if (payload && typeof payload === "object" && "table" in payload) {
        const normalizedTable = normalizeTable((payload as Record<string, unknown>).table);
        if (normalizedTable) {
          setTable(normalizedTable);
        }
      }
    };

    const pushMessage = (text: string, level: "system" | "chat", from?: string) => {
      if (!text) return;
      messageIdRef.current += 1;
      setMessages((prev) => {
        const next = [...prev, { id: messageIdRef.current, text, level, from, at: Date.now() }];
        return next.slice(-50);
      });
    };

    const handleSystem = (message: unknown) => {
      if (typeof message === "string") {
        pushMessage(message, "system");
      }
    };

    const handleChat = (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const raw = payload as Record<string, unknown>;
      const text = typeof raw.text === "string" ? raw.text : "";
      const from = typeof raw.from === "string" ? raw.from : undefined;
      pushMessage(text, "chat", from);
    };

    const handleSocketError = (payload: unknown) => {
      const message =
        typeof payload === "string"
          ? payload
          : typeof payload === "object" && payload && "message" in payload
          ? String((payload as Record<string, unknown>).message ?? "")
          : "";
      if (message) {
        setError(message);
        pushMessage(message, "system");
      }
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("reconnect_error", handleConnectError);
    socket.on("table:update", handleTableUpdate);
    socket.on("poker:state", handlePokerState);
    socket.on("poker:private", handlePokerPrivate);
    socket.on("poker:hand", handlePokerHand);
    socket.on("system", handleSystem);
    socket.on("chat", handleChat);
    socket.on("error", handleSocketError);

    if (autoConnect && !socket.connected) {
      connectingRef.current = true;
      socket.connect();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("reconnect_error", handleConnectError);
      socket.off("table:update", handleTableUpdate);
      socket.off("poker:state", handlePokerState);
      socket.off("poker:private", handlePokerPrivate);
      socket.off("poker:hand", handlePokerHand);
      socket.off("system", handleSystem);
      socket.off("chat", handleChat);
      socket.off("error", handleSocketError);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [autoConnect, endpointUrl, tableId]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) {
      pendingJoinRef.current = tableId;
      return;
    }
    if (socket.connected) {
      socket.emit("join_table", { table: tableId });
      setStatus(`Joined table ${tableId}`);
    } else {
      pendingJoinRef.current = tableId;
    }
  }, [tableId]);

  const identify = useCallback((address: string | null | undefined) => {
    const normalized = address ? address.toLowerCase() : null;
    pendingIdentifyRef.current = normalized;
    const socket = socketRef.current;
    if (socket?.connected && normalized) {
      socket.emit("identify", { addr: normalized });
    }
  }, []);

  const joinTable = useCallback((targetTable: string) => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit("join_table", { table: targetTable });
      setStatus(`Joined table ${targetTable}`);
    } else {
      pendingJoinRef.current = targetTable;
    }
  }, []);

  const setSeat = useCallback((seatIndex: number) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("seat", { index: seatIndex });
  }, []);

  const leaveSeat = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("seat", { index: -1 });
  }, []);

  const sendAction = useCallback((action: string, amount?: number | string | null) => {
    if (!action) return;
    const socket = socketRef.current;
    if (!socket) return;
    const payload: Record<string, unknown> = { action };
    if (amount != null && amount !== "") {
      payload.amount = amount;
    }
    socket.emit("poker:act", payload);
  }, []);

  const sendChat = useCallback((message: string) => {
    if (!message) return;
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("chat", { msg: message });
  }, []);

  const requestRebuy = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("sim:rebuy");
  }, []);

  const reconnect = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (!socket.connected) {
      connectingRef.current = true;
      socket.connect();
    }
  }, []);

  const disconnect = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.disconnect();
  }, []);

  return {
    table,
    state,
    privateCards,
    handSummary,
    messages,
    connected,
    connecting,
    status,
    error,
    identify,
    joinTable,
    setSeat,
    leaveSeat,
    sendAction,
    sendChat,
    requestRebuy,
    reconnect,
    disconnect,
  };
}
