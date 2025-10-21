'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import { notFound } from "next/navigation";
import { useRealtimePokerTable } from "@/hooks/useRealtimePokerTable";
import { useWallet } from "@/context/WalletContext";
import { useHoldemPokerActions } from "@/modules/poker/useHoldemPokerActions";

const cx = (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" ");

type PokerOverlay = {
  ready?: () => boolean;
  refreshSeats?: () => void;
  setContext?: (ctx: { address?: string | null; seatId?: number }) => void;
  applyState?: (state: unknown) => void;
  applyPrivate?: (payload: unknown) => void;
  applyHand?: (summary: unknown) => void;
};

const getPokerOverlay = (): PokerOverlay | null => {
  if (typeof window === "undefined") return null;
  return (window as typeof window & { __PokerOverlay?: PokerOverlay }).__PokerOverlay ?? null;
};

type TablePageProps = {
  params: { tableId: string };
};

function short(addr: string | null | undefined) {
  if (!addr) return "-";
  const lower = addr.toLowerCase();
  return `${lower.slice(0, 6)}...${lower.slice(-4)}`;
}

function formatCommunity(community: string[]) {
  if (!community?.length) return "--";
  return community.join(" ");
}

function formatPot(chips: number, chipValue: number) {
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

export default function PokerTablePage({ params }: TablePageProps) {
  const rawId = Array.isArray(params.tableId) ? params.tableId[0] : params.tableId;
  if (!rawId) {
    notFound();
  }

  const tableId = decodeURIComponent(rawId);
  const { address, connect, disconnect, isConnecting } = useWallet();
  const realtime = useRealtimePokerTable(tableId);
  const holdem = useHoldemPokerActions();
  const addressLower = useMemo(() => (address ?? "").toLowerCase(), [address]);

  const [betAmount, setBetAmount] = useState("1");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [isSitModalOpen, setSitModalOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    realtime.identify(address);
  }, [address, realtime]);

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
    const overlay = getPokerOverlay();
    overlay?.applyState?.(realtime.state ?? null);
  }, [realtime]);

  useEffect(() => {
    const overlay = getPokerOverlay();
    overlay?.applyPrivate?.(realtime.privateCards ?? null);
  }, [realtime.privateCards]);

  useEffect(() => {
    const overlay = getPokerOverlay();
    overlay?.applyHand?.(realtime.handSummary ?? null);
  }, [realtime.handSummary]);

  const chipValueDcmon = useMemo(() => {
    const meta = realtime.table?.meta;
    if (!meta) return 1;
    const direct = Number(meta.chipValueDcmon);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const sb = Number(meta.blinds?.sb);
    if (Number.isFinite(sb) && sb > 0) return sb;
    return 1;
  }, [realtime.table?.meta]);

  const mySeatId = useMemo(() => {
    const seats = realtime.table?.seats ?? [];
    for (const seat of seats) {
      if (seat && seat.addr === addressLower) return seat.id;
    }
    return -1;
  }, [realtime.table?.seats, addressLower]);

  useEffect(() => {
    const overlay = getPokerOverlay();
    if (!overlay?.setContext) return;
    overlay.setContext({ address: addressLower, seatId: mySeatId });
  }, [addressLower, mySeatId]);

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

  const isSimulatedTable = Boolean(realtime.table?.simulated);
  const totalSeats = realtime.table?.capacity ?? 6;

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const overlay = getPokerOverlay();
    const refresh = overlay?.refreshSeats;
    if (!refresh) return;
    const raf = window.requestAnimationFrame(() => {
      refresh();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [orderedSeatIndices, seatPositions]);

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
        Number.isFinite(stackChips) && chipValueDcmon > 0
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
      } else if (realtime.state?.stage) {
        statusLabel = realtime.state.stage === "preflop" ? "Waiting to act" : "Live";
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
      };
    });
  }, [
    orderedSeatIndices,
    seatEntries,
    seatPositions,
    playerName,
    address,
    chipValueDcmon,
    turnSeatId,
    dealerSeatId,
    sbSeatId,
    bbSeatId,
    realtime.state?.stage,
    winnerSeatIds,
  ]);

  const isSeated = mySeatId >= 0;
  const tableCanvasClassName = useMemo(
    () => cx("table-canvas", isSeated ? null : "pre-seat", isSimulatedTable ? "sim-table" : null),
    [isSeated, isSimulatedTable]
  );
  const centerBannerMessage = actionStatus ?? realtime.status ?? null;
  const centerBannerClassName = cx("center-banner", centerBannerMessage && "show");
  const actionInfo = useMemo(() => {
    if (actionStatus) return actionStatus;
    if (!isSeated) return "Take a seat to begin playing.";
    if (!isMyTurn) return "Waiting for your turn...";
    if (callAmountChips > 0) {
      return `Call ${callAmountChips.toFixed(2)} chips (~${callAmountDcmon.toFixed(3)} DCMon) or raise.`;
    }
    return "Check or set your bet to act.";
  }, [actionStatus, isSeated, isMyTurn, callAmountChips, callAmountDcmon]);
  const actionBarClassName = cx("action-bar", !isSeated && "hidden");
  const potChips = Number(realtime.state?.pot || 0);
  const potLabel = formatPot(potChips, chipValueDcmon);
  const myContributionChips = Number(myActor?.contrib || 0);
  const myContributionDcmon = myContributionChips * chipValueDcmon;
  const myPrivateCards = useMemo(() => {
    if (!realtime.privateCards) return [];
    if (realtime.privateCards.seatId !== mySeatId) return [];
    return realtime.privateCards.cards ?? [];
  }, [mySeatId, realtime.privateCards]);
  const latestHand = realtime.handSummary;
  const communityCards = realtime.state?.community ?? [];
  const stageLabel = realtime.state?.stage ?? "Waiting";

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
    const target = Number(betAmount);
    if (!Number.isFinite(target) || target <= 0) return;
    const already = Number(myActor?.contrib || 0);
    const deltaChips = Math.max(0, target - already);
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
  ]);

  const handleRebuy = useCallback(() => {
    realtime.requestRebuy();
  }, [realtime]);

  const handleRefreshOverlay = useCallback(() => {
    const overlay = getPokerOverlay();
    if (!overlay) return;
    overlay.refreshSeats?.();
    overlay.applyState?.(realtime.state ?? null);
    overlay.applyHand?.(realtime.handSummary ?? null);
  }, [realtime.state, realtime.handSummary]);

  const rngCommit =
    realtime.state?.rng?.commit ?? realtime.handSummary?.rng?.commit ?? undefined;
  const tableModeLabel =
    realtime.table?.tableMode ??
    (realtime.table?.simulated ? "f2p" : realtime.table ? "onchain" : undefined);

  return (
    <>
      <Script
        src="/js/poker/cards-overlay.js"
        strategy="afterInteractive"
        onLoad={() => {
          const overlay = getPokerOverlay();
          if (!overlay) return;
          overlay?.refreshSeats?.();
          overlay?.setContext?.({ address: addressLower, seatId: mySeatId });
          overlay?.applyState?.(realtime.state ?? null);
          overlay?.applyPrivate?.(realtime.privateCards ?? null);
          overlay?.applyHand?.(realtime.handSummary ?? null);
        }}
      />
      <main className="poker-table-view">
      <header className="poker-table-header">
        <div className="poker-table-info">
          <h1>{tableId}</h1>
          <p className="muted">
            Stage: <span className="highlight">{stageLabel}</span> - Pot:{" "}
            <span className="highlight">{potLabel}</span>
          </p>
          <p className="muted">
            Community cards:{" "}
            <span className="highlight">{formatCommunity(communityCards)}</span>
          </p>
        </div>
        <div className="poker-table-actions">
          <Link className="rules-btn" href="/games/poker">
            Back to Lobby
          </Link>
          <div className="wallet-chip">
            <span>{short(address)}</span>
            {address ? (
              <button type="button" onClick={disconnect}>
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => connect().catch(() => void 0)}
                disabled={isConnecting}
              >
                {isConnecting ? "Connecting..." : "Connect"}
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="poker-table-layout">
        <div className="table-stage">
          <div className={tableCanvasClassName}>
            <div className="table-surface" role="presentation" aria-hidden="true" />
            {centerBannerMessage && (
              <div className={centerBannerClassName}>
                <span>{centerBannerMessage}</span>
              </div>
            )}
            <div className="pot-indicator">Pot {potLabel}</div>
            <div className={actionBarClassName} aria-live="polite">
              <div className="info">{actionInfo}</div>
              <button
                type="button"
                onClick={handleFold}
                disabled={!isMyTurn || actionBusy || !isSeated}
              >
                Fold
              </button>
              <button
                type="button"
                onClick={handleCheckOrCall}
                disabled={!isMyTurn || actionBusy || !isSeated}
              >
                {callAmountChips > 0
                  ? `Call ${callAmountChips.toFixed(2)} chips`
                  : "Check"}
              </button>
              <input
                type="number"
                min="0"
                step="0.01"
                value={betAmount}
                onChange={(event) => setBetAmount(event.target.value)}
                disabled={!isMyTurn || actionBusy || !isSeated}
                aria-label="Bet amount in chips"
                className="bet-input"
              />
              <button
                type="button"
                onClick={handleBet}
                disabled={!isMyTurn || actionBusy || !isSeated}
              >
                {callAmountChips > 0 ? "Raise" : "Bet"}
              </button>
            </div>
            <div className="seat-layer">
              {orderedSeats.map((seat) => (
                <div
                  key={seat.seatId}
                  data-seat-id={seat.seatId}
                  className={cx(
                    "seat",
                    "seat-node",
                    seat.isUser && "me",
                    seat.isUser && "seat-me",
                    seat.isEmpty && "empty-seat",
                    seat.isEmpty && "seat-empty",
                    !seat.isEmpty && "seat-occupied",
                    seat.isTurn && "turn",
                    seat.hasFolded && "folded",
                    seat.isWinner && "winner"
                  )}
                  style={{ top: seat.position.top, left: seat.position.left }}
                >
                  {seat.markerLabel && (
                    <div className={cx("marker", seat.markerClass, "show")}>{seat.markerLabel}</div>
                  )}
                  <div className="seat-name name">{seat.label}</div>
                  {!seat.isEmpty && (
                    <>
                      <div className="seat-stack stack">
                        {seat.stackLabel && <span>{seat.stackLabel}</span>}
                        {seat.dcmonStack && <span>{seat.dcmonStack}</span>}
                      </div>
                      {seat.statusLabel && (
                        <div className="seat-status status">{seat.statusLabel}</div>
                      )}
                    </>
                  )}
                  <div className="seat-actions btns">
                    {seat.isEmpty && seat.displayIndex === 0 && !isSeated && (
                      <button
                        type="button"
                        className="seat-sit-btn"
                        onClick={handleOpenSitModal}
                        disabled={actionBusy || preferredSeatId < 0}
                      >
                        Sit
                      </button>
                    )}
                    {seat.isUser && !seat.isEmpty && (
                      <button
                        type="button"
                        className="seat-leave-btn"
                        onClick={handleLeaveSeat}
                        disabled={actionBusy}
                      >
                        Leave
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="poker-sidebar">
          <section className="poker-status">
            <h2>Table Status</h2>
            <p className="muted">
              Connection:{" "}
              <span className={realtime.connected ? "status-online" : "status-offline"}>
                {realtime.connected ? "Online" : "Offline"}
              </span>
            </p>
            {realtime.status && <p className="muted">{realtime.status}</p>}
            {realtime.error && <p className="error">{realtime.error}</p>}
            {realtime.table?.simulated && (
              <button type="button" className="rebuy-btn" onClick={handleRebuy}>
                Free Rebuy (100 chips)
              </button>
            )}
          </section>

          <section className="poker-controls">
            <h2>Action</h2>
            <p className="muted">Use the table controls when it is your turn.</p>
            <p className="muted">
              Call amount:{" "}
              <span className="highlight">
                {callAmountChips.toFixed(2)} chips (~{callAmountDcmon.toFixed(3)} DCMon)
              </span>
            </p>
            <p className="muted">
              Your contribution:{" "}
              <span className="highlight">
                {myContributionChips.toFixed(2)} chips (~{myContributionDcmon.toFixed(3)} DCMon)
              </span>
            </p>
          </section>

          <section className="poker-messages">
            <h2>Table Log</h2>
            <div className="message-list">
              {realtime.messages.map((message) => (
                <div key={message.id} className={`message ${message.level}`}>
                  {message.from && <span className="from">{message.from}: </span>}
                  <span>{message.text}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="poker-hand">
            <h2>Private Cards</h2>
            {myPrivateCards.length > 0 ? (
              <div className="card-row">
                {myPrivateCards.map((card, idx) => (
                  <span key={`${card}-${idx}`} className="card-pill">
                    {card}
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted">Cards appear when you are in hand.</p>
            )}
          </section>

          <section className="poker-admin">
            <h2>Dealer Tools</h2>
            <p className="muted">
              Mode:{" "}
              <span className="highlight">
                {(tableModeLabel ?? "unknown").toUpperCase()}
              </span>
            </p>
            <p className="muted">
              Dealer seat:{" "}
              <span className="highlight">
                {dealerSeatId >= 0 ? `#${dealerSeatId + 1}` : "Unassigned"}
              </span>
            </p>
            <p className="muted">
              Turn seat:{" "}
              <span className="highlight">{turnSeatId >= 0 ? `#${turnSeatId + 1}` : "Waiting"}</span>
            </p>
            {rngCommit && (
              <p className="muted">
                RNG commit: <span className="highlight">{rngCommit.slice(0, 12)}…</span>
              </p>
            )}
            <div className="admin-actions">
              <button type="button" onClick={handleRefreshOverlay}>
                Refresh Overlay
              </button>
              <button type="button" onClick={realtime.reconnect}>
                Reconnect Socket
              </button>
            </div>
          </section>

          {latestHand && (
            <section className="poker-summary">
              <h2>Last Hand</h2>
              <p className="muted">
                Pot: <span className="highlight">{formatPot(latestHand.pot, chipValueDcmon)}</span>
              </p>
              <p className="muted">
                Board:{" "}
                <span className="highlight">{formatCommunity(latestHand.community ?? [])}</span>
              </p>
              <ul>
                {latestHand.winners.map((winner) => (
                  <li key={`${winner.addr}-${winner.seatId ?? 0}`}>
                    <span>{short(winner.addr)}</span>
                    {winner.amount != null && (
                      <span>
                        {" "}- {formatPot(winner.amount, chipValueDcmon)} ({winner.amount.toFixed(2)} chips)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </section>

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
    </>
  );
}
