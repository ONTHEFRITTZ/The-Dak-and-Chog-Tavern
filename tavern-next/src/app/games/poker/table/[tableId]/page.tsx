'use client';

import { useMemo, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useRealtimePokerTable } from "@/hooks/useRealtimePokerTable";
import { useWallet } from "@/context/WalletContext";
import { useHoldemPokerActions } from "@/modules/poker/useHoldemPokerActions";

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

export default function PokerTablePage({ params }: TablePageProps) {
  const rawId = Array.isArray(params.tableId) ? params.tableId[0] : params.tableId;
  if (!rawId) {
    notFound();
  }

  const tableId = decodeURIComponent(rawId);
  const { address, connect, disconnect, isConnecting } = useWallet();
  const realtime = useRealtimePokerTable(tableId);
  const holdem = useHoldemPokerActions();

  const [betAmount, setBetAmount] = useState("1");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    realtime.identify(address);
  }, [address, realtime]);

  const addressLower = (address ?? "").toLowerCase();

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

  const callAmountChips = useMemo(() => {
    if (!realtime.state || !myActor) return 0;
    const target = Number(realtime.state.toCall || 0);
    const already = Number(myActor.contrib || 0);
    return Math.max(0, target - already);
  }, [realtime.state, myActor]);

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

  const myContributionChips = Number(myActor?.contrib || 0);
  const myContributionDcmon = myContributionChips * chipValueDcmon;
  const callAmountDcmon = callAmountChips * chipValueDcmon;
  const potChips = Number(realtime.state?.pot || 0);
  const potLabel = formatPot(potChips, chipValueDcmon);
  const myPrivateCards = useMemo(() => {
    if (!realtime.privateCards) return [];
    if (realtime.privateCards.seatId !== mySeatId) return [];
    return realtime.privateCards.cards ?? [];
  }, [mySeatId, realtime.privateCards]);
  const latestHand = realtime.handSummary;

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

  const handleJoinSeat = useCallback(
    (seatIndex: number) => {
      if (!address) {
        connect().catch(() => void 0);
        return;
      }
      runAction("Joining seat...", async () => {
        await holdem.joinSeat({ seatId: seatIndex, onProgress: setActionStatus });
        realtime.setSeat(seatIndex);
      });
    },
    [address, connect, holdem, realtime, runAction]
  );

  const handleLeaveSeat = useCallback(() => {
    if (mySeatId < 0) return;
    runAction("Leaving seat...", async () => {
      await holdem.leaveSeat({
        seatId: mySeatId,
        duringHand: isInHand,
        onProgress: setActionStatus,
      });
      realtime.leaveSeat();
    });
  }, [holdem, isInHand, mySeatId, realtime, runAction]);

  const handleFold = useCallback(() => {
    realtime.sendAction("fold");
  }, [realtime]);

  const handleCheckOrCall = useCallback(() => {
    if (mySeatId < 0) return;
    if (callAmountChips > 0) {
      runAction("Calling...", async () => {
        await holdem.contributeChips({
          seatId: mySeatId,
          chips: callAmountChips,
          chipValueDcmon,
          onProgress: setActionStatus,
        });
        realtime.sendAction("call");
      });
    } else {
      realtime.sendAction("check");
    }
  }, [callAmountChips, chipValueDcmon, holdem, mySeatId, realtime, runAction]);

  const handleBet = useCallback(() => {
    if (mySeatId < 0) return;
    const targetChips = Number(betAmount);
    if (!Number.isFinite(targetChips) || targetChips <= 0) return;
    const alreadyChips = Number(myActor?.contrib || 0);
    const deltaChips = Math.max(0, targetChips - alreadyChips);
    const action = callAmountChips > 0 ? "raise" : "bet";
    runAction(action === "raise" ? "Raising..." : "Betting...", async () => {
      if (deltaChips > 0) {
        await holdem.contributeChips({
          seatId: mySeatId,
          chips: deltaChips,
          chipValueDcmon,
          onProgress: setActionStatus,
        });
      }
      realtime.sendAction(action, targetChips);
    });
  }, [
    betAmount,
    callAmountChips,
    chipValueDcmon,
    holdem,
    myActor?.contrib,
    mySeatId,
    realtime,
    runAction,
  ]);

  const handleRebuy = useCallback(() => {
    realtime.requestRebuy();
  }, [realtime]);

  const stageLabel = realtime.state?.stage ?? "Waiting";
  const communityCards = formatCommunity(realtime.state?.community ?? []);

  return (
    <main className="poker-table-view">
      <header className="poker-table-header">
        <div className="poker-table-info">
          <h1>{tableId}</h1>
          <p className="muted">
            Stage: <span className="highlight">{stageLabel}</span> - Pot:{" "}
            <span className="highlight">{potLabel}</span>
          </p>
          <p className="muted">
            Community cards: <span className="highlight">{communityCards}</span>
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
        <div className="seat-grid">
          {(realtime.table?.seats ?? Array.from({ length: realtime.table?.capacity ?? 6 })).map(
            (seat, index) => {
              const occupied = Boolean(seat);
              const isMe = seat?.addr === addressLower;
              const chips = Number(seat?.chips ?? seat?.balance ?? 0);
              const chipsLabel = Number.isFinite(chips) ? chips.toFixed(2) : "0.00";
              const dcmonLabel = Number.isFinite(chips)
                ? (chips * chipValueDcmon).toFixed(3)
                : "0.000";
              return (
                <div key={index} className={`seat-card ${isMe ? "me" : ""}`}>
                  <header>
                    <span>Seat {index + 1}</span>
                  </header>
                  {occupied ? (
                    <div className="seat-body">
                      <div className="seat-address">{short(seat?.addr)}</div>
                      <div className="seat-meta">
                        <span>Stack: {chipsLabel} chips</span>
                        <span>(~{dcmonLabel} DCMon)</span>
                      </div>
                      {isMe && (
                        <button
                          type="button"
                          className="seat-leave"
                          onClick={handleLeaveSeat}
                          disabled={actionBusy}
                        >
                          Leave Seat
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="seat-empty">
                      <button
                        type="button"
                        onClick={() => handleJoinSeat(index)}
                        disabled={actionBusy}
                      >
                        Take Seat
                      </button>
                    </div>
                  )}
                </div>
              );
            }
          )}
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
            {actionStatus && <p className="muted">{actionStatus}</p>}
            {realtime.error && <p className="error">{realtime.error}</p>}
            {realtime.table?.simulated && (
              <button type="button" className="rebuy-btn" onClick={handleRebuy}>
                Free Rebuy (100 chips)
              </button>
            )}
          </section>

          <section className="poker-controls">
            <h2>Action</h2>
            {mySeatId < 0 ? (
              <p className="muted">Take a seat to act.</p>
            ) : (
              <>
                <div className="action-row">
                  <button type="button" onClick={handleFold} disabled={!isMyTurn || actionBusy}>
                    Fold
                  </button>
                  <button
                    type="button"
                    onClick={handleCheckOrCall}
                    disabled={!isMyTurn || actionBusy}
                  >
                    {callAmountChips > 0
                      ? `Call ${callAmountChips.toFixed(2)} chips (~${callAmountDcmon.toFixed(
                          3
                        )} DCMon)`
                      : "Check"}
                  </button>
                </div>
                <div className="action-row">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={betAmount}
                    onChange={(event) => setBetAmount(event.target.value)}
                    disabled={!isMyTurn || actionBusy}
                    aria-label="Bet amount in chips"
                  />
                  <button type="button" onClick={handleBet} disabled={!isMyTurn || actionBusy}>
                    {callAmountChips > 0 ? "Raise" : "Bet"}
                  </button>
                </div>
                <p className="muted">
                  Your contribution:{" "}
                  <span className="highlight">
                    {myContributionChips.toFixed(2)} chips (~{myContributionDcmon.toFixed(3)} DCMon)
                  </span>
                </p>
              </>
            )}
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
              <p className="muted">Cards will appear when you are in hand.</p>
            )}
          </section>

          {latestHand && (
            <section className="poker-summary">
              <h2>Last Hand</h2>
              <p className="muted">
                Pot: <span className="highlight">{formatPot(latestHand.pot, chipValueDcmon)}</span>
              </p>
              <p className="muted">
                Board:{" "}
                <span className="highlight">
                  {formatCommunity(latestHand.community ?? [])}
                </span>
              </p>
              <ul>
                {latestHand.winners.map((winner) => (
                  <li key={`${winner.addr}-${winner.seatId ?? 0}`}>
                    <span>{short(winner.addr)}</span>
                    {winner.amount != null && (
                      <span>
                        {" "} - {formatPot(winner.amount, chipValueDcmon)} ({winner.amount.toFixed(2)} chips)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </section>
    </main>
  );
}







