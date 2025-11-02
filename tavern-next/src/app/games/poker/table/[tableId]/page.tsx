'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { notFound } from "next/navigation";
import { useRealtimePokerTable } from "@/hooks/useRealtimePokerTable";
import { useWallet } from "@/context/WalletContext";
import { useHoldemPokerActions } from "@/modules/poker/useHoldemPokerActions";
import { usePageBackdrop } from "@/hooks/usePageBackdrop";
import { useBankroll, formatDcmon } from "@/modules/bankroll";

const cx = (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" ");

type TablePageProps = {
  params: { tableId: string };
};

function short(addr: string | null | undefined) {
  if (!addr) return "-";
  const lower = addr.toLowerCase();
  return `${lower.slice(0, 6)}...${lower.slice(-4)}`;
}

function formatPot(chips: number, chipValue: number) {
  if (chipValue <= 0) {
    return `${chips.toFixed(2)} chips`;
  }
  const dcmon = chips * chipValue;
  if (!Number.isFinite(dcmon)) return "0.000";
  if (dcmon >= 1_000_000) return `${(dcmon / 1_000_000).toFixed(2)}M DCMon`;
  if (dcmon >= 1_000) return `${(dcmon / 1_000).toFixed(2)}k DCMon`;
  return `${dcmon.toFixed(3)} DCMon`;
}

function computeSeatPositions(total: number) {
  if (total <= 0) return [];
  const rx = 42;
  const ry = 34;
  return Array.from({ length: total }, (_, idx) => {
    const angleDeg = 90 + (360 / total) * idx;
    const rad = (angleDeg * Math.PI) / 180;
    const left = 50 + rx * Math.cos(rad);
    const top = 50 + ry * Math.sin(rad);
    return { left: `${left}%`, top: `${top}%` };
  });
}

const CARD_RANK_LABEL: Record<string, string> = {
  A: "ace",
  K: "king",
  Q: "queen",
  J: "jack",
  T: "ten",
  "9": "nine",
  "8": "eight",
  "7": "seven",
  "6": "six",
  "5": "five",
  "4": "four",
  "3": "three",
  "2": "two",
};

const CARD_SUIT_LABEL: Record<string, string> = {
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
};

const pokerCardImageUrl = (code: string) => {
  if (!code || code.length < 2) {
    return "/assets/images/chog_cards/dak-and-chog-cardback.png";
  }
  const rank = CARD_RANK_LABEL[code[0].toUpperCase()] ?? "ace";
  const suit = CARD_SUIT_LABEL[code[1].toLowerCase()] ?? "spades";
  return `/assets/images/chog_cards/chog-${rank}-of-${suit}.png`;
};

type SeatCard = {
  code: string;
  hidden: boolean;
};

const renderPokerCard = (card: SeatCard, key: string) => {
  if (card.hidden) {
    return (
      <span key={key} className="poker-card poker-card-hidden">
        ??
      </span>
    );
  }
  return (
    <span
      key={key}
      className="poker-card poker-card-image"
      style={{ backgroundImage: `url("${pokerCardImageUrl(card.code)}")` }}
      aria-label={card.code}
    />
  );
};

const OPEN_HISTORY_EVENT = "tavern:poker:openHistory";
const CHANGE_NAME_EVENT = "tavern:poker:changeName";
const LEAVE_SEAT_EVENT = "tavern:poker:leaveSeat";

export default function PokerTablePage({ params }: TablePageProps) {
  usePageBackdrop("poker-table");

  const rawId = Array.isArray(params.tableId) ? params.tableId[0] : params.tableId;
  if (!rawId) {
    notFound();
  }

  const tableId = decodeURIComponent(rawId);
  const { address } = useWallet();
  const realtime = useRealtimePokerTable(tableId);
  const holdem = useHoldemPokerActions();
  const { dcmonBalance } = useBankroll();
  const addressLower = useMemo(() => (address ?? "").toLowerCase(), [address]);
  const isSimulatedTable = useMemo(() => {
    const table = realtime.table;
    const metaRecord = (table?.meta ?? null) as Record<string, unknown> | null;

    const tokens: string[] = [];
    const pushToken = (value: string | null | undefined) => {
      if (!value) return;
      const trimmed = value.trim();
      if (trimmed) {
        tokens.push(trimmed.toLowerCase());
      }
    };

    const readMetaValue = (key: string) => (metaRecord ? metaRecord[key] : undefined);
    const metaString = (key: string) => {
      const value = readMetaValue(key);
      return typeof value === "string" ? value : null;
    };
    const metaBoolean = (key: string) => {
      const value = readMetaValue(key);
      return typeof value === "boolean" ? value : null;
    };

    const tableModeRaw = typeof table?.tableMode === "string" ? table.tableMode : null;
    const normalizedMode = tableModeRaw?.trim().toLowerCase() ?? null;
    const metaModeRaw = metaString("tableMode");
    const normalizedMetaMode = metaModeRaw?.trim().toLowerCase() ?? null;

    pushToken(tableModeRaw);
    pushToken(metaModeRaw);
    pushToken(metaString("mode"));
    pushToken(metaString("typeKey"));
    pushToken(metaString("category"));
    pushToken(metaString("kind"));
    pushToken(metaString("stakes"));
    pushToken(metaString("name"));
    pushToken(metaString("label"));
    pushToken(metaString("displayName"));
    pushToken(metaString("slug"));
    pushToken(typeof table?.id === "string" ? table.id : null);
    pushToken(typeof table?.limit === "string" ? table.limit : null);
    pushToken(typeof table?.stakes === "string" ? table.stakes : null);

    const metaTags = readMetaValue("tags");
    if (Array.isArray(metaTags)) {
      for (const entry of metaTags) {
        if (typeof entry === "string") {
          pushToken(entry);
        }
      }
    }

    const offchainMatches = ["f2p", "free", "freeplay", "offchain", "sim", "simulated", "practice", "demo", "sandbox"];
    const onchainMatches = ["onchain", "on-chain", "real", "cash"];

    const includesKeyword = (value: string | null, keywords: string[]) =>
      Boolean(value && keywords.some((keyword) => value.includes(keyword)));

    if (includesKeyword(normalizedMode, offchainMatches)) return true;
    if (includesKeyword(normalizedMode, onchainMatches)) return false;
    if (includesKeyword(normalizedMetaMode, offchainMatches)) return true;
    if (includesKeyword(normalizedMetaMode, onchainMatches)) return false;

    const metaOffchain = metaBoolean("offchain");
    if (metaOffchain != null) return metaOffchain;

    const metaSimulated = metaBoolean("simulated");
    if (metaSimulated != null) return metaSimulated;

    const metaOnchain = metaBoolean("onchain");
    if (metaOnchain != null) return !metaOnchain;

    if (typeof table?.simulated === "boolean") return table.simulated;

    const tokensContain = (keywords: string[]) =>
      tokens.some((token) => keywords.some((keyword) => token.includes(keyword)));

    if (tokensContain(offchainMatches)) return true;
    if (tokensContain(onchainMatches)) return false;

    const chipValueRaw =
      readMetaValue("chipValueDcmon") ?? readMetaValue("chipValue") ?? readMetaValue("dcmonValue");
    const chipValue = Number(chipValueRaw);
    if (Number.isFinite(chipValue)) {
      if (chipValue <= 0) return true;
      if (chipValue > 0) return false;
    }

    return false;
  }, [realtime.table]);

  const [betAmount, setBetAmount] = useState("1");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [readySubmitted, setReadySubmitted] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [isSitModalOpen, setSitModalOpen] = useState(false);
  const [sitModalMode, setSitModalMode] = useState<"join" | "rename">("join");
  const [tableModal, setTableModal] = useState<"history" | null>(null);
  const [pendingSeatId, setPendingSeatId] = useState<number | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const updatePlayerName = useCallback((value: string) => {
    const trimmed = value.trim().slice(0, 16);
    const finalName = trimmed || "Player";
    setPlayerName(finalName);
    setNameInput(finalName);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem("poker:name", finalName);
      } catch {
        // ignore storage failures
      }
    }
    return finalName;
  }, []);

  useEffect(() => {
    realtime.identify(address);
  }, [address, realtime]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.body.dataset.gamePage;
    document.body.dataset.gamePage = "poker-table";
    return () => {
      if (previous) {
        document.body.dataset.gamePage = previous;
      } else {
        delete document.body.dataset.gamePage;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const previous = root.dataset.tableMode;
    const mode = isSimulatedTable ? "f2p" : "onchain";
    root.dataset.tableMode = mode;
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(new CustomEvent("poker:tableMode", { detail: { mode } }));
      } catch {
        // ignore dispatch failures
      }
    }
    return () => {
      if (previous) {
        root.dataset.tableMode = previous;
      } else {
        delete root.dataset.tableMode;
      }
      if (typeof window !== "undefined") {
        try {
          window.dispatchEvent(
            new CustomEvent("poker:tableMode", { detail: { mode: previous ?? null } })
          );
        } catch {
          // ignore dispatch failures
        }
      }
    };
  }, [isSimulatedTable]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem("poker:name");
    if (stored) {
      updatePlayerName(stored);
    }
  }, [updatePlayerName]);

  useEffect(() => {
    if (!isSitModalOpen) return;
    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  }, [isSitModalOpen]);

  useEffect(() => {
    if (!tableModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTableModal(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tableModal]);

  const chipValueDcmon = useMemo(() => {
    if (isSimulatedTable) return 0;
    const meta = realtime.table?.meta;
    if (!meta) return 1;
    const direct = Number(meta.chipValueDcmon);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const sb = Number(meta.blinds?.sb);
    if (Number.isFinite(sb) && sb > 0) return sb;
    return 1;
  }, [isSimulatedTable, realtime.table?.meta]);

  const mySeatId = useMemo(() => {
    const seats = realtime.table?.seats ?? [];
    for (const seat of seats) {
      if (seat && seat.addr === addressLower) return seat.id;
    }
    return -1;
  }, [realtime.table?.seats, addressLower]);

  const myActor = useMemo(() => {
    if (!realtime.state) return null;
    const actors = realtime.state.actors;
    const byAddress = actors.find((actor) => actor.addr === addressLower);
    if (byAddress) return byAddress;
    if (mySeatId >= 0) {
      return actors.find((actor) => actor.seatId === mySeatId) ?? null;
    }
    return null;
  }, [realtime.state, addressLower, mySeatId]);

  const actorBySeat = useMemo(() => {
    type Actor = NonNullable<typeof realtime.state>["actors"][number];
    const map = new Map<number, Actor>();
    if (!realtime.state) return map;
    for (const actor of realtime.state.actors) {
      if (Number.isInteger(actor.seatId)) {
        map.set(actor.seatId, actor);
      }
    }
    return map;
  }, [realtime]);

  const turnSeatId = useMemo(() => {
    if (!realtime.state) return -1;
    if (typeof realtime.state.turnSeatId === "number" && realtime.state.turnSeatId >= 0) {
      return realtime.state.turnSeatId;
    }
    const idx = realtime.state.turnIndex;
    if (!Number.isFinite(idx) || idx < 0) return -1;
    const actor = realtime.state.actors[idx];
    return actor ? actor.seatId : -1;
  }, [realtime]);

  const dealerSeatId = realtime.state?.dealerSeatId ?? -1;

  const sbSeatId = useMemo(() => {
    if (!realtime.state) return -1;
    if (!Number.isFinite(realtime.state.sbIndex)) return -1;
    const actor = realtime.state.actors[Number(realtime.state.sbIndex)];
    return actor ? actor.seatId : -1;
  }, [realtime]);

  const bbSeatId = useMemo(() => {
    if (!realtime.state) return -1;
    if (!Number.isFinite(realtime.state.bbIndex)) return -1;
    const actor = realtime.state.actors[Number(realtime.state.bbIndex)];
    return actor ? actor.seatId : -1;
  }, [realtime.state]);

  const winnerSeatIds = useMemo(() => {
    const set = new Set<number>();
    if (!realtime.handSummary) return set;
    for (const winner of realtime.handSummary.winners ?? []) {
      if (winner.seatId != null && Number.isFinite(winner.seatId)) {
        set.add(Number(winner.seatId));
      }
    }
    return set;
  }, [realtime.handSummary]);

  const callAmountChips = useMemo(() => {
    if (!realtime.state || !myActor) return 0;
    const target = Number(realtime.state.toCall || 0);
    const already = Number(myActor.contrib || 0);
    return Math.max(0, target - already);
  }, [realtime.state, myActor]);
  const callAmountDcmon = callAmountChips * chipValueDcmon;

  const isMyTurn = useMemo(() => {
    if (!realtime.state || !myActor) return false;
    const { turnIndex, actors } = realtime.state;
    if (turnIndex < 0 || turnIndex >= actors.length) return false;
    const current = actors[turnIndex];
    return current.addr === myActor.addr || current.seatId === myActor.seatId;
  }, [realtime.state, myActor]);

  const isInHand = useMemo(() => {
    const stage = realtime.state?.stage?.toLowerCase() ?? "";
    return ["preflop", "flop", "turn", "river", "showdown"].includes(stage);
  }, [realtime.state?.stage]);

  const stageKey = (realtime.state?.stage ?? "").toLowerCase();

  const totalSeats = realtime.table?.capacity ?? 6;

  const exposedCardsBySeat = useMemo(() => {
    const map = new Map<number, string[]>();
    const exposures = realtime.handSummary?.exposures ?? [];
    for (const exposure of exposures) {
      if (!exposure) continue;
      const seatId = Number((exposure as { seatId?: unknown }).seatId);
      if (!Number.isFinite(seatId) || seatId < 0) continue;
      const cards = Array.isArray(exposure.cards)
        ? exposure.cards.filter((card): card is string => typeof card === "string" && card.length >= 2)
        : [];
      if (cards.length > 0) {
        map.set(seatId, cards);
      }
    }
    return map;
  }, [realtime.handSummary?.exposures]);

  const privateCardsBySeat = useMemo(() => {
    const map = new Map<number, string[]>();
    const info = realtime.privateCards;
    if (info && Number.isFinite(Number(info.seatId))) {
      const seatId = Number(info.seatId);
      const cards = Array.isArray(info.cards)
        ? info.cards.filter((card): card is string => typeof card === "string" && card.length >= 2)
        : [];
      if (cards.length > 0) {
        map.set(seatId, cards);
      }
    }
    return map;
  }, [realtime.privateCards]);

  const seatEntries = useMemo(() => {
    return Array.from({ length: totalSeats }, (_, seatId) => {
      const seatInfo = realtime.table?.seats?.[seatId] ?? null;
      const actor = actorBySeat.get(seatId) ?? null;
      const rawAddress = seatInfo?.addr ?? actor?.addr ?? null;
      const normalized = rawAddress ? rawAddress.toLowerCase() : null;
      const stack = Number(actor?.stack ?? seatInfo?.balance ?? 0);
      const contrib = Number(actor?.contrib ?? seatInfo?.balance ?? 0);
      const baseEntry = {
        seatId,
        rawAddress,
        addr: normalized,
        isUser: normalized != null && normalized === addressLower,
        stack: Number.isFinite(stack) ? stack : 0,
        contrib: Number.isFinite(contrib) ? contrib : 0,
        actor,
        pending: false,
      };
      if (
        pendingSeatId != null &&
        seatId === pendingSeatId &&
        !baseEntry.rawAddress &&
        addressLower
      ) {
        return {
          ...baseEntry,
          rawAddress: addressLower,
          addr: addressLower,
          isUser: true,
          pending: true,
        };
      }
      return baseEntry;
    });
  }, [totalSeats, realtime.table?.seats, actorBySeat, addressLower, pendingSeatId]);

  const emptySeatIds = useMemo(
    () => seatEntries.filter((entry) => !entry.rawAddress).map((entry) => entry.seatId),
    [seatEntries]
  );

  const preferredSeatId = useMemo(() => {
    if (mySeatId >= 0) return mySeatId;
    if (pendingSeatId != null) return pendingSeatId;
    if (emptySeatIds.length > 0) return emptySeatIds[0];
    return -1;
  }, [mySeatId, pendingSeatId, emptySeatIds]);

  const seatPositions = useMemo(() => computeSeatPositions(totalSeats), [totalSeats]);

  const orderedSeatIndices = useMemo(() => {
    if (totalSeats === 0) return [];
    const base = Array.from({ length: totalSeats }, (_, idx) => idx);
    if (preferredSeatId < 0) return base;
    const pivot = preferredSeatId % totalSeats;
    return base.slice(pivot).concat(base.slice(0, pivot));
  }, [totalSeats, preferredSeatId]);

  const orderedSeats = useMemo(() => {
    return orderedSeatIndices.map((seatId, displayIndex) => {
      const entry = seatEntries[seatId];
      const isPending = entry.pending;
      const isEmpty = !entry.rawAddress;
      const isUser = entry.isUser;
      const actor = entry.actor;
      const hasFolded = Boolean(actor?.folded);
      const hasActed = Boolean(actor?.acted);
      const isTurn = seatId === turnSeatId;
      const isDealer = seatId === dealerSeatId;
      const isSmallBlind = seatId === sbSeatId;
      const isBigBlind = seatId === bbSeatId;
      const isWinner = winnerSeatIds.has(seatId);
      const label = isUser
        ? playerName || (address ? short(address) : "You")
        : entry.rawAddress
        ? short(entry.rawAddress)
        : "Empty Seat";
      const stackChips = entry.stack;
      const stackLabel = Number.isFinite(stackChips) ? `${stackChips.toFixed(2)} chips` : null;
      const dcmonStack =
        !isSimulatedTable && Number.isFinite(stackChips) && chipValueDcmon > 0
          ? `${(stackChips * chipValueDcmon).toFixed(3)} DCMon`
          : null;
      const balanceLabel = isEmpty ? null : dcmonStack ?? stackLabel;
      let statusLabel: string | null = null;
      if (isPending) {
        statusLabel = "Joining...";
      } else if (isEmpty) {
        statusLabel = "Seat Open";
      } else if (isWinner) {
        statusLabel = "Winner";
      } else if (isTurn) {
        statusLabel = "Acting";
      } else if (hasFolded) {
        statusLabel = "Folded";
      } else if (entry.contrib > 0) {
        statusLabel = `In Pot: ${entry.contrib.toFixed(2)} chips`;
      } else if (hasActed) {
        statusLabel = "Acted";
      } else if (stageKey === "waiting" || stageKey === "betting") {
        statusLabel = hasActed ? "Ready" : "Waiting";
      } else if (isInHand) {
        statusLabel = "Live";
      }

      const knownPrivate = privateCardsBySeat.get(seatId) ?? null;
      const knownExposed = exposedCardsBySeat.get(seatId) ?? null;
      const visibleCards =
        knownPrivate && knownPrivate.length > 0 ? knownPrivate : knownExposed ?? [];
      const cards: SeatCard[] = [];

      if (visibleCards.length > 0) {
        visibleCards.forEach((card) => {
          cards.push({ code: card, hidden: false });
        });
      } else if (!isEmpty && isInHand && !hasFolded) {
        const placeholderCount = 2;
        for (let idx = 0; idx < placeholderCount; idx += 1) {
          cards.push({ code: "??", hidden: true });
        }
      }

      const markerTokens: string[] = [];
      if (isDealer) markerTokens.push("D");
      if (isSmallBlind) markerTokens.push("SB");
      if (isBigBlind) markerTokens.push("BB");
      const markerLabel = markerTokens.join("/");
      const markerClass = markerTokens
        .filter((token) => token === "SB" || token === "BB")
        .map((token) => token.toLowerCase())
        .join(" ");

      return {
        ...entry,
        displayIndex,
        position: seatPositions[displayIndex] ?? { top: "50%", left: "50%" },
        label,
        isEmpty,
        stackLabel,
        dcmonStack,
        balanceLabel,
        statusLabel,
        isTurn,
        isDealer,
        isSmallBlind,
        isBigBlind,
        isWinner,
        hasFolded,
        hasActed,
        markerLabel,
        markerClass,
        cards,
        isPending,
      };
    });
  }, [
    orderedSeatIndices,
    seatEntries,
    seatPositions,
    playerName,
    address,
    chipValueDcmon,
    isSimulatedTable,
    isInHand,
    stageKey,
    turnSeatId,
    dealerSeatId,
    sbSeatId,
    bbSeatId,
    winnerSeatIds,
    privateCardsBySeat,
    exposedCardsBySeat,
  ]);

  const hasPendingSeat = pendingSeatId != null;
  const isActuallySeated = mySeatId >= 0;
  const isSeated = isActuallySeated || hasPendingSeat;
  const handleRenamePlayer = useCallback(() => {
    if (!isSeated) {
      handleOpenSitModal();
      return;
    }
    setNameInput(playerName || "");
    setSitModalMode("rename");
    setSitModalOpen(true);
  }, [isSeated, handleOpenSitModal, playerName]);
  const tableCanvasClassName = useMemo(
    () =>
      cx(
        "table-canvas",
        "poker-table",
        isSeated ? null : "pre-seat",
        isSimulatedTable ? "sim-table" : null
      ),
    [isSeated, isSimulatedTable]
  );
  const actionInfo = useMemo(() => {
    if (actionStatus) return actionStatus;
    if (!isSeated) return "Take a seat to begin playing.";
    if (!isMyTurn) return "Waiting for your turn...";
    if (callAmountChips > 0) {
      const callLabel = isSimulatedTable
        ? `${callAmountChips.toFixed(2)} chips`
        : `${callAmountChips.toFixed(2)} chips (~${callAmountDcmon.toFixed(3)} DCMon)`;
      return `Call ${callLabel} or raise.`;
    }
    return isSimulatedTable ? "Check or set your wager in chips." : "Check or set your bet to act.";
  }, [actionStatus, isSeated, isMyTurn, callAmountChips, callAmountDcmon, isSimulatedTable]);
  const potChips = Number(realtime.state?.pot || 0);
  const potLabel = isSimulatedTable
    ? `${potChips.toFixed(2)} chips`
    : formatPot(potChips, chipValueDcmon);
  const myContributionChips = Number(myActor?.contrib || 0);
  const myStackChips = Number(myActor?.stack || 0);
  const communityCards = realtime.state?.community ?? [];
  const boardCards = communityCards.map((card) => ({ code: card, hidden: false }));
  const callAmountLabel = isSimulatedTable
    ? `${callAmountChips.toFixed(2)} chips`
    : `${callAmountChips.toFixed(2)} chips (~${callAmountDcmon.toFixed(3)} DCMon)`;
  const actionButtonsDisabled = !isSeated || !isMyTurn || actionBusy;
  const canAllIn = !actionButtonsDisabled && myStackChips > 0.0001;
  const isReadyStage = ["", "waiting", "betting", "showdown"].includes(stageKey);
  const showReadyButton = isSeated && !isInHand && isReadyStage;
  const showActionButtons = isSeated && isMyTurn && isInHand && !actionBusy;
  const myDcmonBalanceLabel = useMemo(
    () => `${formatDcmon(dcmonBalance)} DCMon`,
    [dcmonBalance]
  );
  useEffect(() => {
    if (!showReadyButton || !isSeated) {
      setReadySubmitted(false);
    }
  }, [showReadyButton, isSeated]);
  const boardHint = useMemo(() => {
    if (boardCards.length > 0) return null;
    if (!isSeated) return null;
    if (isReadyStage) return "Hit ready to begin play.";
    switch (stageKey) {
      case "preflop":
        return "Dealing preflop cards...";
      case "flop":
        return "Flop incoming...";
      case "turn":
        return "Waiting on the turn card.";
      case "river":
        return "Waiting on the river card.";
      default:
        return "Board cards pending...";
    }
  }, [boardCards.length, isSeated, isReadyStage, stageKey]);
  const latestHand = realtime.handSummary;
  const blinds = realtime.table?.meta?.blinds;
  const blindsLabel =
    !blinds || (isSimulatedTable && !blinds?.sb && !blinds?.bb)
      ? "--"
      : `${blinds?.sb ?? "-"} / ${blinds?.bb ?? "-"}`;
  const formatChipLabel = useCallback(
    (chips: number) =>
      isSimulatedTable ? `${chips.toFixed(2)} chips` : formatPot(chips, chipValueDcmon),
    [chipValueDcmon, isSimulatedTable]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent("poker:blinds", { detail: { label: blindsLabel } }));
    } catch {
      // ignore dispatch errors
    }
    return () => {
      try {
        window.dispatchEvent(new CustomEvent("poker:blinds", { detail: { label: null } }));
      } catch {
        // ignore cleanup errors
      }
    };
  }, [blindsLabel]);
  const runAction = useCallback(
    async (initialMessage: string | null, task: () => Promise<void>) => {
      if (actionBusy) return;
      setActionBusy(true);
      if (initialMessage) {
        setActionStatus(initialMessage);
      }
      try {
        await task();
        setActionStatus(null);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
            ? err
            : "Action failed.";
        setActionStatus(message);
      } finally {
        setActionBusy(false);
      }
    },
    [actionBusy]
  );

  const handleOpenSitModal = useCallback(() => {
    if (preferredSeatId < 0) {
      setActionStatus("No open seats available right now.");
      return;
    }
    setSitModalMode("join");
    setNameInput(playerName || "");
    setSitModalOpen(true);
  }, [preferredSeatId, playerName]);

  const handleConfirmSit = useCallback(() => {
    const trimmed = nameInput.trim().slice(0, 16);
    const finalName = trimmed || "Player";

    if (sitModalMode === "rename") {
      updatePlayerName(finalName);
      setSitModalOpen(false);
      setSitModalMode("join");
      return;
    }

    if (preferredSeatId < 0) {
      setActionStatus("No open seats available right now.");
      return;
    }

    runAction(null, async () => {
      const targetSeat = preferredSeatId;
      setPendingSeatId(targetSeat);
      if (!isSimulatedTable) {
        try {
          await holdem.joinSeat({ seatId: preferredSeatId, onProgress: setActionStatus });
        } catch (err) {
          setPendingSeatId((current) => (current === targetSeat ? null : current));
          throw err;
        }
      }
      try {
        realtime.setSeat(preferredSeatId);
      } catch (err) {
        setPendingSeatId((current) => (current === targetSeat ? null : current));
        throw err;
      }
      updatePlayerName(finalName);
      setSitModalOpen(false);
      setSitModalMode("join");
      setTableModal(null);
    });
  }, [
    nameInput,
    sitModalMode,
    preferredSeatId,
    runAction,
    isSimulatedTable,
    holdem,
    realtime,
    updatePlayerName,
  ]);

  const handleCancelSit = useCallback(() => {
    setSitModalOpen(false);
    setNameInput(playerName);
    setSitModalMode("join");
  }, [playerName]);

  const handleLeaveSeat = useCallback(() => {
    if (mySeatId < 0) return;
    runAction(null, async () => {
      if (!isSimulatedTable) {
        await holdem.leaveSeat({
          seatId: mySeatId,
          duringHand: isInHand,
          onProgress: setActionStatus,
        });
      }
      realtime.leaveSeat();
      setTableModal(null);
      setPendingSeatId(null);
    });
  }, [mySeatId, isSimulatedTable, holdem, isInHand, realtime, runAction]);

  useEffect(() => {
    if (pendingSeatId == null) return;
    const seat = realtime.table?.seats?.[pendingSeatId] ?? null;
    if (seat && seat.addr && seat.addr.toLowerCase() === addressLower) {
      setPendingSeatId(null);
    } else if (mySeatId >= 0) {
      setPendingSeatId(null);
    }
  }, [pendingSeatId, realtime.table?.seats, addressLower, mySeatId]);

  const handleFold = useCallback(() => {
    realtime.sendAction("fold");
  }, [realtime]);

  const handleCheckOrCall = useCallback(() => {
    if (mySeatId < 0) return;
    if (callAmountChips > 0) {
      runAction("Calling...", async () => {
        if (!isSimulatedTable) {
          await holdem.contributeChips({
            seatId: mySeatId,
            chips: callAmountChips,
            chipValueDcmon,
            onProgress: setActionStatus,
          });
        }
        realtime.sendAction("call");
      });
    } else {
      realtime.sendAction("check");
    }
  }, [
    mySeatId,
    callAmountChips,
    runAction,
    isSimulatedTable,
    holdem,
    chipValueDcmon,
    realtime,
  ]);

  const handleBet = useCallback(() => {
    if (mySeatId < 0) return;
    const targetRaw = Number(betAmount);
    if (!Number.isFinite(targetRaw) || targetRaw <= 0) return;
    const already = Number(myActor?.contrib || 0);
    const maxTarget = already + Math.max(myStackChips, 0);
    const target = Math.max(already, Math.min(targetRaw, maxTarget));
    const deltaChips = Math.max(0, target - already);
    if (deltaChips <= 0) {
      setActionStatus("Enter an amount above your current contribution.");
      return;
    }
    const action = callAmountChips > 0 ? "raise" : "bet";
    runAction(action === "raise" ? "Raising..." : "Betting...", async () => {
      if (!isSimulatedTable && deltaChips > 0) {
        await holdem.contributeChips({
          seatId: mySeatId,
          chips: deltaChips,
          chipValueDcmon,
          onProgress: setActionStatus,
        });
      }
      realtime.sendAction(action, target);
    });
  }, [
    mySeatId,
    betAmount,
    callAmountChips,
    runAction,
    isSimulatedTable,
    holdem,
    chipValueDcmon,
    realtime,
    myActor?.contrib,
    myStackChips,
  ]);

  const handleAllIn = useCallback(() => {
    if (mySeatId < 0) return;
    if (!Number.isFinite(myStackChips) || myStackChips <= 0) return;
    const already = Number(myActor?.contrib || 0);
    const target = already + myStackChips;
    const action = callAmountChips > 0 ? "raise" : "bet";
    runAction("All-in...", async () => {
      if (!isSimulatedTable && myStackChips > 0) {
        await holdem.contributeChips({
          seatId: mySeatId,
          chips: myStackChips,
          chipValueDcmon,
          onProgress: setActionStatus,
        });
      }
      realtime.sendAction(action, target);
    });
  }, [
    mySeatId,
    myStackChips,
    myActor?.contrib,
    callAmountChips,
    runAction,
    isSimulatedTable,
    holdem,
    chipValueDcmon,
    realtime,
  ]);

  const handleRebuy = useCallback(() => {
    realtime.requestRebuy();
  }, [realtime]);

  const handleReady = useCallback(() => {
    if (!isSeated) return;
    setReadySubmitted(true);
    runAction("Ready...", async () => {
      try {
        realtime.sendAction("ready");
      } catch (err) {
        setReadySubmitted(false);
        throw err;
      }
    });
  }, [isSeated, runAction, realtime]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const openHistory = () => setTableModal("history");
    const requestRename = () => handleRenamePlayer();
    const requestLeave = () => handleLeaveSeat();
    window.addEventListener(OPEN_HISTORY_EVENT, openHistory);
    window.addEventListener(CHANGE_NAME_EVENT, requestRename);
    window.addEventListener(LEAVE_SEAT_EVENT, requestLeave);
    return () => {
      window.removeEventListener(OPEN_HISTORY_EVENT, openHistory);
      window.removeEventListener(CHANGE_NAME_EVENT, requestRename);
      window.removeEventListener(LEAVE_SEAT_EVENT, requestLeave);
    };
  }, [handleRenamePlayer, handleLeaveSeat]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let disposed = false;
    let button: HTMLButtonElement | null = null;
    let timeout: number | null = null;

    const handleClick = (event: Event) => {
      event.preventDefault();
      handleLeaveSeat();
    };

    const ensureButton = () => {
      if (disposed) return;
      const pill = document.getElementById("wallet-inline");
      if (!pill) {
        timeout = window.setTimeout(ensureButton, 200);
        return;
      }
      if (!isSeated) {
        if (button && button.dataset.origin === "poker-table") {
          button.removeEventListener("click", handleClick);
          if (button.parentElement === pill) {
            pill.removeChild(button);
          }
          button = null;
        }
        return;
      }
      button = document.getElementById("wi-leave-table") as HTMLButtonElement | null;
      if (!button) {
        button = document.createElement("button");
        button.id = "wi-leave-table";
        button.type = "button";
      }
      button.className = "wi-leave-table";
      button.dataset.origin = "poker-table";
      button.textContent = "Leave Table";
      button.removeEventListener("click", handleClick);
      button.addEventListener("click", handleClick);
      button.disabled = actionBusy;
      button.style.removeProperty("display");
      const disconnectButton = pill.querySelector("#wi-disconnect");
      if (disconnectButton && button.nextSibling !== disconnectButton) {
        pill.insertBefore(button, disconnectButton);
      } else if (!disconnectButton && button.parentElement !== pill) {
        pill.appendChild(button);
      } else if (button.parentElement !== pill) {
        pill.appendChild(button);
      }
    };

    ensureButton();

    return () => {
      disposed = true;
      if (timeout != null) {
        window.clearTimeout(timeout);
      }
      if (button && button.dataset.origin === "poker-table") {
        button.removeEventListener("click", handleClick);
        if (button.parentElement) {
          button.parentElement.removeChild(button);
        }
      } else if (button) {
        button.removeEventListener("click", handleClick);
      }
    };
  }, [handleLeaveSeat, actionBusy, isSeated]);

  return (
    <main className="poker-page">
      <section className="poker-stage">
          <div className={tableCanvasClassName}>
            <div className="table-surface" role="presentation" aria-hidden="true" />
            <div className="poker-board">
              {boardCards.length === 0 ? (
                boardHint ? <span className="poker-board-hint">{boardHint}</span> : null
              ) : (
                boardCards.map((card, idx) => renderPokerCard(card, `board-${idx}`))
              )}
            </div>
            <div className="pot-indicator">Pot {potLabel}</div>
            <div className="seat-layer">
              {orderedSeats.map((seat) => {
                const isMySeat = seat.isUser;
                const baseStatus = seat.statusLabel;
                const derivedStatus =
                  isMySeat && showReadyButton && readySubmitted && baseStatus !== "Ready"
                    ? "Ready"
                    : baseStatus;
                const balanceDisplay = seat.isUser ? myDcmonBalanceLabel : seat.balanceLabel;

                return (
                  <div
                    key={seat.seatId}
                    data-seat-id={seat.seatId}
                    className={cx(
                      "seat",
                      "seat-node",
                      seat.isUser && "me",
                      seat.isEmpty ? "pending" : "occupied",
                      seat.isTurn && !seat.isEmpty && "turn",
                      seat.hasFolded && !seat.isEmpty && "folded",
                      seat.isWinner && "winner"
                    )}
                    style={{ top: seat.position.top, left: seat.position.left }}
                  >
                    {seat.markerLabel ? (
                      <div className={cx("marker", seat.markerClass, "show")}>{seat.markerLabel}</div>
                    ) : null}
                    {!(seat.isPending && seat.isEmpty) && !(seat.isEmpty && seat.displayIndex === 0 && !isSeated) && (
                      <div className="seat-name">{seat.label}</div>
                    )}
                    {seat.cards.length > 0 && (
                      <div className="seat-cards">
                        {seat.cards.map((card, idx) =>
                          renderPokerCard(card, `seat-${seat.seatId}-card-${idx}`)
                        )}
                      </div>
                    )}
                    {seat.isEmpty ? (
                      seat.displayIndex === 0 && !isSeated ? (
                        <button
                          type="button"
                          className="bj-sit-btn"
                          onClick={handleOpenSitModal}
                          disabled={actionBusy || preferredSeatId < 0}
                        >
                          Sit
                        </button>
                      ) : null
                    ) : (
                    <>
                      {balanceDisplay && (
                        <div className="seat-info">
                          <span>{balanceDisplay}</span>
                        </div>
                      )}
                      {derivedStatus && <div className="seat-status">{derivedStatus}</div>}
                      {isMySeat && (
                        <div className="seat-console">
                          <div className="seat-console-top">
                            {actionInfo && <div className="seat-prompt">{actionInfo}</div>}
                          </div>
                          {showReadyButton && (
                            <div className="seat-ready">
                              <button
                                type="button"
                                className="seat-ready-button"
                                onClick={handleReady}
                                disabled={actionBusy || derivedStatus === "Ready" || !isActuallySeated}
                              >
                                {derivedStatus === "Ready" ? "Ready" : "Ready Up"}
                              </button>
                            </div>
                          )}
                          {(showActionButtons || isSimulatedTable) && (
                            <div className="seat-controls">
                              <div className="seat-rail seat-rail-left">
                                {showActionButtons && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={handleFold}
                                      disabled={actionButtonsDisabled}
                                    >
                                      Fold
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleCheckOrCall}
                                      disabled={actionButtonsDisabled}
                                    >
                                      {callAmountChips > 0 ? `Call ${callAmountLabel}` : "Check"}
                                    </button>
                                  </>
                                )}
                              </div>
                              <div className="seat-rail seat-rail-right">
                                {showActionButtons && (
                                  <>
                                    <div className="bet-input-inline">
                                      <input
                                        type="number"
                                        min="0"
                                          max={Math.max(myContributionChips + myStackChips, 0)}
                                          step="0.01"
                                          value={betAmount}
                                          onChange={(event) => setBetAmount(event.target.value)}
                                          disabled={actionButtonsDisabled}
                                          aria-label="Bet amount in chips"
                                          className="bet-input"
                                        />
                                        <button
                                          type="button"
                                          onClick={handleBet}
                                          disabled={actionButtonsDisabled}
                                        >
                                          {callAmountChips > 0 ? "Raise" : "Bet"}
                                        </button>
                                      </div>
                                      <button type="button" onClick={handleAllIn} disabled={!canAllIn}>
                                        All In
                                      </button>
                                    </>
                                  )}
                                  {isSimulatedTable && (
                                    <button
                                      type="button"
                                      onClick={handleRebuy}
                                      disabled={actionBusy || !isSeated}
                                    >
                                      Rebuy 100 Chips
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {!isSeated && (
              <div className="poker-callout">
                Take a seat, place your wager, and join the action.
              </div>
            )}
          </div>
      </section>

      {tableModal === "history" && (
        <div className="table-panel" role="dialog" aria-modal="true">
          <div className="table-panel-content">
            <div className="table-panel-header">
              <h3>Recent Hand</h3>
              <button
                type="button"
                className="table-panel-close"
                onClick={() => setTableModal(null)}
              >
                Close
              </button>
            </div>
            <div className="table-panel-body">
              {latestHand ? (
                <>
                  <div className="table-panel-info">
                    <div>
                      <span>Pot</span>
                      <span>{formatChipLabel(latestHand.pot ?? 0)}</span>
                    </div>
                    <div>
                      <span>Board</span>
                      <span>{(latestHand.community ?? []).join(" ") || "--"}</span>
                    </div>
                  </div>
                  <ul>
                    {(latestHand.winners ?? []).map((winner) => (
                      <li key={`${winner.addr}-${winner.seatId ?? 0}`}>
                        <strong>{short(winner.addr)}</strong>
                        {winner.amount != null && (
                          <span>{` Wins ${formatChipLabel(winner.amount)}`}</span>
                        )}
                        {winner.combo && winner.combo.length > 0 && (
                          <span>{` (${winner.combo.join(" ")})`}</span>
                        )}
                      </li>
                    ))}
                    {(latestHand.winners ?? []).length === 0 && <li>No winner data provided.</li>}
                  </ul>
                </>
              ) : (
                <p>No completed hands yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {isSitModalOpen && (
        <div className="poker-modal-backdrop">
          <div className="poker-modal">
            <h3>{sitModalMode === "rename" ? "Update Your Name" : "Take Your Seat"}</h3>
            <p className="muted">
              {sitModalMode === "rename"
                ? "Choose how other players will see you at the table."
                : "Enter the name you want other players to see when you act at the table."}
            </p>
            <input
              ref={nameInputRef}
              type="text"
              maxLength={16}
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Dak & Chog Regular"
              disabled={actionBusy}
            />
            <div className="modal-actions">
              <button type="button" onClick={handleCancelSit} disabled={actionBusy}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSit}
                disabled={actionBusy || (sitModalMode === "join" && preferredSeatId < 0)}
              >
                {sitModalMode === "rename" ? "Save" : "Take Seat"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}





