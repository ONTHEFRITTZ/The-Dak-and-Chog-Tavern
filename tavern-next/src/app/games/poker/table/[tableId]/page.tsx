'use client';

import { useMemo, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useRealtimePokerTable } from "@/hooks/useRealtimePokerTable";
import { useWallet } from "@/context/WalletContext";

type TablePageProps = {
  params: { tableId: string };
};

function short(addr: string | null | undefined) {
  if (!addr) return "-";
  const lower = addr.toLowerCase();
  return `${lower.slice(0, 6)}…${lower.slice(-4)}`;
}

function formatCommunity(community: string[]) {
  if (!community?.length) return "—";
  return community.join(" ");
}

function formatPot(pot: number) {
  if (!Number.isFinite(pot)) return "0";
  if (pot >= 1_000_000) return `${(pot / 1_000_000).toFixed(2)}M`;
  if (pot >= 1_000) return `${(pot / 1_000).toFixed(2)}k`;
  return pot.toFixed(3);
}

export default function PokerTablePage({ params }: TablePageProps) {
  const rawId = Array.isArray(params.tableId) ? params.tableId[0] : params.tableId;
  if (!rawId) {
    notFound();
  }
  const tableId = decodeURIComponent(rawId);
  const { address, connect, disconnect, isConnecting } = useWallet();
  const realtime = useRealtimePokerTable(tableId);
  const [betAmount, setBetAmount] = useState("0.5");

  useEffect(() => {
    realtime.identify(address);
  }, [address, realtime]);

  const addressLower = (address ?? "").toLowerCase();

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

  const callAmount = useMemo(() => {
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

  const handleJoinSeat = useCallback(
    (seatIndex: number) => {
      if (!address) {
        connect().catch(() => void 0);
        return;
      }
      realtime.setSeat(seatIndex);
    },
    [address, connect, realtime]
  );

  const handleLeaveSeat = useCallback(() => {
    realtime.leaveSeat();
  }, [realtime]);

  const handleFold = useCallback(() => {
    realtime.sendAction("fold");
  }, [realtime]);

  const handleCheckOrCall = useCallback(() => {
    if (callAmount > 0) {
      realtime.sendAction("call");
    } else {
      realtime.sendAction("check");
    }
  }, [callAmount, realtime]);

  const handleBet = useCallback(() => {
    const parsed = Number(betAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const action = callAmount > 0 ? "raise" : "bet";
    realtime.sendAction(action, parsed);
  }, [betAmount, callAmount, realtime]);

  const handleRebuy = useCallback(() => {
    realtime.requestRebuy();
  }, [realtime]);

  const stageLabel = realtime.state?.stage ?? "Waiting";
  const communityCards = formatCommunity(realtime.state?.community ?? []);
  const potLabel = formatPot(realtime.state?.pot ?? 0);

  return (
    <main className="poker-table-view">
      <header className="poker-table-header">
        <div className="poker-table-info">
          <h1>{tableId}</h1>
          <p className="muted">
            Stage: <span className="highlight">{stageLabel}</span> • Pot:{" "}
            <span className="highlight">{potLabel} DCMon</span>
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
                {isConnecting ? "Connecting…" : "Connect"}
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
              return (
                <div key={index} className={`seat-card ${isMe ? "me" : ""}`}>
                  <header>
                    <span>Seat {index + 1}</span>
                  </header>
                  {occupied ? (
                    <div className="seat-body">
                      <div className="seat-address">{short(seat?.addr)}</div>
                      <div className="seat-meta">
                        <span>Contrib: {seat?.balance?.toFixed?.(3) ?? "0"}</span>
                        {typeof seat?.chips === "number" && (
                          <span>Chips: {seat?.chips.toFixed(2)}</span>
                        )}
                      </div>
                      {isMe && (
                        <button type="button" className="seat-leave" onClick={handleLeaveSeat}>
                          Leave Seat
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="seat-empty">
                      <button type="button" onClick={() => handleJoinSeat(index)}>
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
                  <button type="button" onClick={handleFold} disabled={!isMyTurn}>
                    Fold
                  </button>
                  <button type="button" onClick={handleCheckOrCall} disabled={!isMyTurn}>
                    {callAmount > 0 ? `Call ${callAmount.toFixed(3)}` : "Check"}
                  </button>
                </div>
                <div className="action-row">
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={betAmount}
                    onChange={(event) => setBetAmount(event.target.value)}
                    disabled={!isMyTurn}
                  />
                  <button type="button" onClick={handleBet} disabled={!isMyTurn}>
                    {callAmount > 0 ? "Raise" : "Bet"}
                  </button>
                </div>
                <p className="muted">
                  Your contribution:{" "}
                  <span className="highlight">{Number(myActor?.contrib ?? 0).toFixed(3)} DCMon</span>
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
        </aside>
      </section>
    </main>
  );
}
