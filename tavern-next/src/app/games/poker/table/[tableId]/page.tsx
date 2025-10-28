'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { notFound } from "next/navigation";
import { useRealtimePokerTable } from "@/hooks/useRealtimePokerTable";
import { useWallet } from "@/context/WalletContext";
import { useHoldemPokerActions } from "@/modules/poker/useHoldemPokerActions";
import { usePageBackdrop } from "@/hooks/usePageBackdrop";

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
  const addressLower = useMemo(() => (address ?? "").toLowerCase(), [address]);
  const isSimulatedTable = useMemo(
    () => realtime.table?.tableMode === "f2p" || Boolean(realtime.table?.simulated),
    [realtime.table?.tableMode, realtime.table?.simulated]
  );

  const [betAmount, setBetAmount] = useState("1");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [isSitModalOpen, setSitModalOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<"info" | "history" | "log" | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    realtime.identify(address);
  }, [address, realtime]);

  const togglePanel = useCallback((panel: "info" | "history" | "log") => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem("poker:name");
    if (stored) {
      setPlayerName(stored);
      setNameInput(stored);
    }
  }, []);

  useEffect(() => {
    if (!isSitModalOpen) return;
    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  }, [isSitModalOpen]);

  useEffect(() => {
    if (!activePanel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActivePanel(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePanel]);

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
      const stack = Number(actor?.stack ?? seatInfo?.chips ?? seatInfo?.balance ?? 0);
      const contrib = Number(actor?.contrib ?? seatInfo?.balance ?? 0);
      return {
        seatId,
        rawAddress,
        addr: normalized,
        isUser: normalized != null && normalized === addressLower,
        stack: Number.isFinite(stack) ? stack : 0,
        contrib: Number.isFinite(contrib) ? contrib : 0,
        actor,
      };
    });
  }, [totalSeats, realtime.table?.seats, actorBySeat, addressLower]);

  const emptySeatIds = useMemo(
    () => seatEntries.filter((entry) => !entry.rawAddress).map((entry) => entry.seatId),
    [seatEntries]
  );

  const preferredSeatId = useMemo(() => {
    if (mySeatId >= 0) return mySeatId;
    if (emptySeatIds.length > 0) return emptySeatIds[0];
    return -1;
  }, [mySeatId, emptySeatIds]);

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
        : "Open Seat";
      const stackChips = entry.stack;
      const stackLabel = Number.isFinite(stackChips) ? `${stackChips.toFixed(2)} chips` : null;
      const dcmonStack =
        !isSimulatedTable && Number.isFinite(stackChips) && chipValueDcmon > 0
          ? `${(stackChips * chipValueDcmon).toFixed(3)} DCMon`
          : null;
      let statusLabel: string | null = null;
      if (isEmpty) {
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
        statusLabel = "Ready";
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

  const currentTurnSeatLabel = useMemo(() => {
    if (turnSeatId < 0) return null;
    const currentSeat = orderedSeats.find((seat) => seat.seatId === turnSeatId);
    return currentSeat?.label ?? null;
  }, [orderedSeats, turnSeatId]);

  const isSeated = mySeatId >= 0;
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
  const centerBannerMessage = useMemo(() => {
    if (actionStatus) return actionStatus;
    if (realtime.status) return realtime.status;
    if (!isSeated) return "Take a seat to join the action.";
    if (!realtime.state) return "Waiting for game state...";
    if (isMyTurn) return "Your move.";
    if (currentTurnSeatLabel) return `Waiting on ${currentTurnSeatLabel}`;
    switch (stageKey) {
      case "":
      case "waiting":
        return "Waiting for the next hand...";
      case "betting":
        return "Preparing the next deal...";
      case "preflop":
        return "Dealing preflop cards.";
      case "flop":
        return "Flop on the felt.";
      case "turn":
        return "Turn card in play.";
      case "river":
        return "River card in play.";
      case "showdown":
        return "Showdown!";
      default:
        return stageKey.charAt(0).toUpperCase() + stageKey.slice(1);
    }
  }, [actionStatus, realtime.status, isSeated, realtime.state, isMyTurn, currentTurnSeatLabel, stageKey]);
  const centerBannerClassName = cx("center-banner", centerBannerMessage && "show");
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
  const myContributionDcmon = isSimulatedTable ? 0 : myContributionChips * chipValueDcmon;
  const myStackChips = Number(myActor?.stack || 0);
  const communityCards = realtime.state?.community ?? [];
  const boardCards = communityCards.map((card) => ({ code: card, hidden: false }));
  const callAmountLabel = isSimulatedTable
    ? `${callAmountChips.toFixed(2)} chips`
    : `${callAmountChips.toFixed(2)} chips (~${callAmountDcmon.toFixed(3)} DCMon)`;
  const contributionLabel = isSimulatedTable
    ? `${myContributionChips.toFixed(2)} chips`
    : `${myContributionChips.toFixed(2)} chips (~${myContributionDcmon.toFixed(3)} DCMon)`;
  const stackLabel = `${myStackChips.toFixed(2)} chips`;
  const actionButtonsDisabled = !isSeated || !isMyTurn || actionBusy;
  const canAllIn = !actionButtonsDisabled && myStackChips > 0.0001;
  const latestHand = realtime.handSummary;
  const rngCommit = realtime.state?.rng?.commit ?? latestHand?.rng?.commit ?? undefined;
  const tableModeLabel = isSimulatedTable
    ? "Free to Play"
    : (realtime.table?.tableMode ?? "On-chain").toUpperCase();
  const messages = realtime.messages;
  const blinds = realtime.table?.meta?.blinds;
  const blindsLabel =
    !blinds || (isSimulatedTable && !blinds?.sb && !blinds?.bb)
      ? "—"
      : `${blinds?.sb ?? "-"} / ${blinds?.bb ?? "-"}`;
  const seatCapacity = totalSeats;
  const seatedCount = seatEntries.reduce((count, entry) => (entry.rawAddress ? count + 1 : count), 0);
  const dealerSeatLabel = dealerSeatId >= 0 ? `Seat ${dealerSeatId + 1}` : "—";
  const turnSeatLabel = currentTurnSeatLabel ?? (turnSeatId >= 0 ? `Seat ${turnSeatId + 1}` : "—");
  const formatChipLabel = useCallback(
    (chips: number) =>
      isSimulatedTable ? `${chips.toFixed(2)} chips` : formatPot(chips, chipValueDcmon),
    [chipValueDcmon, isSimulatedTable]
  );
  const infoItems = useMemo(
    () => [
      { label: "Stage", value: stageKey ? stageKey.charAt(0).toUpperCase() + stageKey.slice(1) : "Waiting" },
      { label: "Mode", value: tableModeLabel },
      { label: "Players", value: `${seatedCount}/${seatCapacity}` },
      { label: "Dealer", value: dealerSeatLabel },
      { label: "Turn", value: turnSeatLabel },
      { label: "Blinds", value: blindsLabel },
      { label: "Pot", value: formatChipLabel(potChips) },
      { label: "Connection", value: realtime.connected ? "Online" : "Offline" },
      ...(rngCommit ? [{ label: "RNG Commit", value: `${rngCommit.slice(0, 10)}…` }] : []),
      { label: "Table ID", value: realtime.table?.id ?? tableId },
    ],
    [
      stageKey,
      tableModeLabel,
      seatedCount,
      seatCapacity,
      dealerSeatLabel,
      turnSeatLabel,
      blindsLabel,
      formatChipLabel,
      potChips,
      realtime.connected,
      rngCommit,
      realtime.table?.id,
      tableId,
    ]
  );
  const panelData = useMemo(() => {
    if (!activePanel) return null;
    if (activePanel === "info") {
      return {
        title: "Table Info",
        content: (
          <div className="table-panel-info">
            {infoItems.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <span>{item.value}</span>
              </div>
            ))}
            {realtime.status && (
              <div>
                <span>Status</span>
                <span>{realtime.status}</span>
              </div>
            )}
            {realtime.error && (
              <div>
                <span>Error</span>
                <span>{realtime.error}</span>
              </div>
            )}
          </div>
        ),
      };
    }
    if (activePanel === "history") {
      if (!latestHand) {
        return {
          title: "Last Hand",
          content: <p>No completed hands yet.</p>,
        };
      }
      return {
        title: "Last Hand",
        content: (
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
        ),
      };
    }
    const logEntries = messages;
    return {
      title: "Table Messages",
      content:
        logEntries.length === 0 && !realtime.status && !realtime.error ? (
          <p>No messages yet.</p>
        ) : (
          <ul>
            {logEntries.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.from ? `${entry.from}: ` : ""}</strong>
                <span>{entry.text}</span>
              </li>
            ))}
            {realtime.status && (
              <li>
                <strong>Status: </strong>
                <span>{realtime.status}</span>
              </li>
            )}
            {realtime.error && (
              <li>
                <strong>Error: </strong>
                <span>{realtime.error}</span>
              </li>
            )}
          </ul>
        ),
    };
  }, [activePanel, infoItems, realtime.status, realtime.error, latestHand, formatChipLabel, messages]);

  const runAction = useCallback(
    async (initialMessage: string, task: () => Promise<void>) => {
      if (actionBusy) return;
      setActionBusy(true);
      setActionStatus(initialMessage);
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
    setNameInput(playerName || "");
    setSitModalOpen(true);
  }, [preferredSeatId, playerName]);

  const handleConfirmSit = useCallback(() => {
    if (preferredSeatId < 0) {
      setActionStatus("No open seats available right now.");
      return;
    }
    const trimmed = nameInput.trim().slice(0, 16);
    const finalName = trimmed || "Player";
    runAction("Joining seat...", async () => {
      if (!isSimulatedTable) {
        await holdem.joinSeat({ seatId: preferredSeatId, onProgress: setActionStatus });
      }
      realtime.setSeat(preferredSeatId);
      setPlayerName(finalName);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("poker:name", finalName);
      }
      setSitModalOpen(false);
      setActivePanel(null);
    });
  }, [preferredSeatId, nameInput, runAction, holdem, realtime, isSimulatedTable]);

  const handleCancelSit = useCallback(() => {
    setSitModalOpen(false);
    setNameInput(playerName);
  }, [playerName]);

  const handleLeaveSeat = useCallback(() => {
    if (mySeatId < 0) return;
    runAction("Leaving seat...", async () => {
      if (!isSimulatedTable) {
        await holdem.leaveSeat({
          seatId: mySeatId,
          duringHand: isInHand,
          onProgress: setActionStatus,
        });
      }
      realtime.leaveSeat();
      setActivePanel(null);
    });
  }, [mySeatId, isSimulatedTable, holdem, isInHand, realtime, runAction]);

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

  return (
    <main className="poker-page">
      <section className="poker-stage">
          <div className={tableCanvasClassName}>
            <div className="table-surface" role="presentation" aria-hidden="true" />
            {centerBannerMessage && (
              <div className={centerBannerClassName}>
                <span>{centerBannerMessage}</span>
              </div>
            )}
            <div className="poker-board">
              {boardCards.length === 0 ? (
                <span className="poker-board-hint">
                  {stageKey === "waiting" || stageKey === "betting"
                    ? "Waiting for the shuffle..."
                    : "Board cards pending"}
                </span>
              ) : (
                boardCards.map((card, idx) => renderPokerCard(card, `board-${idx}`))
              )}
            </div>
            <div className="pot-indicator">Pot {potLabel}</div>
            <div className="seat-layer">
              {orderedSeats.map((seat) => (
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
                  {seat.markerLabel && (
                    <div className={cx("marker", seat.markerClass, "show")}>{seat.markerLabel}</div>
                  )}
                  <div className="seat-name">{seat.label}</div>
                  {seat.cards.length > 0 && (
                    <div className="seat-cards">
                      {seat.cards.map((card, idx) =>
                        renderPokerCard(card, `seat-${seat.seatId}-card-${idx}`)
                      )}
                    </div>
                  )}
                  {seat.isEmpty ? (
                    seat.displayIndex === 0 && !isSeated ? (
                      <>
                        <button
                          type="button"
                          className="bj-sit-btn"
                          onClick={handleOpenSitModal}
                          disabled={actionBusy || preferredSeatId < 0}
                        >
                          Sit
                        </button>
                        <span className="seat-hint">Take this seat to play.</span>
                      </>
                    ) : (
                      <span className="seat-hint">{seat.statusLabel ?? "Seat Open"}</span>
                    )
                  ) : (
                    <>
                      <div className="seat-info">
                        {seat.stackLabel && <span>{seat.stackLabel}</span>}
                        {seat.dcmonStack && <span>{seat.dcmonStack}</span>}
                      </div>
                      {seat.statusLabel && <div className="seat-status">{seat.statusLabel}</div>}
                      {seat.isUser && (
                        <div className="seat-actions">
                          <button type="button" onClick={handleLeaveSeat} disabled={leaveDisabled}>
                            Leave
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            {!isSeated && (
              <div className="poker-callout">
                Take a seat, place your wager, and join the action.
              </div>
            )}
          </div>

        </div>
        <div className="table-dock-wrapper">
          <div
            className={cx(
              "table-dock",
              isMyTurn && isSeated && !actionBusy && "active",
              !isSeated && "disabled"
            )}
          >
            <div className="dock-info">{actionInfo}</div>
            <div className="dock-stats">
              <span>Pot {potLabel}</span>
              {isSeated && <span>Your stack: {stackLabel}</span>}
              {isSeated && <span>Your contribution: {contributionLabel}</span>}
              {isSeated && callAmountChips > 0 && <span>Call: {callAmountLabel}</span>}
            </div>
            <div className="dock-controls">
              <button type="button" onClick={handleFold} disabled={actionButtonsDisabled}>
                Fold
              </button>
              <button type="button" onClick={handleCheckOrCall} disabled={actionButtonsDisabled}>
                {callAmountChips > 0 ? `Call ${callAmountLabel}` : "Check"}
              </button>
              <div className="bet-input-group">
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
                <button type="button" onClick={handleBet} disabled={actionButtonsDisabled}>
                  {callAmountChips > 0 ? "Raise" : "Bet"}
                </button>
              </div>
              <button type="button" onClick={handleAllIn} disabled={!canAllIn}>
                All In
              </button>
              {isSimulatedTable && (
                <button type="button" onClick={handleRebuy} disabled={actionBusy || !isSeated}>
                  Rebuy 100 Chips
                </button>
              )}
            </div>
            <div className="dock-secondary" role="group" aria-label="Additional table details">
              <button
                type="button"
                className={activePanel === "info" ? "active" : undefined}
                onClick={() => togglePanel("info")}
              >
                Table Info
              </button>
              <button
                type="button"
                className={activePanel === "history" ? "active" : undefined}
                onClick={() => togglePanel("history")}
              >
                Last Hand
              </button>
              <button
                type="button"
                className={activePanel === "log" ? "active" : undefined}
                onClick={() => togglePanel("log")}
              >
                Messages{messages.length > 0 ? ` (${messages.length})` : ""}
              </button>
            </div>
          </div>
        </div>
      </section>

      {activePanel && panelData && (
        <div className="table-panel" role="dialog" aria-modal="true">
          <div className="table-panel-content">
            <div className="table-panel-header">
              <h3>{panelData.title}</h3>
              <button
                type="button"
                className="table-panel-close"
                onClick={() => setActivePanel(null)}
              >
                Close
              </button>
            </div>
            <div className="table-panel-body">{panelData.content}</div>
          </div>
        </div>
      )}

      {isSitModalOpen && (
        <div className="poker-modal-backdrop">
          <div className="poker-modal">
            <h3>Take Your Seat</h3>
            <p className="muted">
              Enter the name you want other players to see when you act at the table.
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
                disabled={actionBusy || preferredSeatId < 0}
              >
                Take Seat
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

