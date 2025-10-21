'use client';

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useWallet } from "@/context/WalletContext";
import { useBlackjack } from "@/modules/blackjack/useBlackjack";
import type { Card } from "@/modules/blackjack/engine";

const RANK_LABEL: Record<string, string> = {
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

const SUIT_LABEL: Record<string, string> = {
  C: "clubs",
  D: "diamonds",
  H: "hearts",
  S: "spades",
};

const SEAT_POSITIONS = [
  { top: "24%", left: "78%" },
  { top: "56%", left: "86%" },
  { top: "82%", left: "50%" }, // player
  { top: "56%", left: "14%" },
  { top: "24%", left: "22%" },
];

const cardImageUrl = (card: Card) => {
  const rank = RANK_LABEL[card[0]] ?? "ace";
  const suit = SUIT_LABEL[card[1]] ?? "spades";
  return `/assets/images/chog_cards/chog-${rank}-of-${suit}.png`;
};

const renderCard = (card: Card, hidden = false, key?: string | number) => {
  if (hidden) {
    return (
      <span key={`hidden-${key ?? card}`} className="bj-card bj-card-hidden" aria-hidden="true">
        🂠
      </span>
    );
  }
  return (
    <span
      key={`${card}-${key ?? 0}`}
      className="bj-card bj-card-image"
      style={{ backgroundImage: `url("${cardImageUrl(card)}")` }}
      aria-label={card}
    />
  );
};

export default function BlackjackPage() {
  const { address, connect, disconnect, isConnecting } = useWallet();
  const blackjack = useBlackjack();
  const [wagerInput, setWagerInput] = useState(() => blackjack.baseWager.toFixed(2));

  const activeHand = blackjack.playerHands[blackjack.activeHandIndex] ?? null;
  const canAct = blackjack.phase === "player" && !blackjack.isBusy && activeHand && !activeHand.isFinished;
  const dealerCards = blackjack.dealerCards;
  const revealHole = blackjack.revealDealer || blackjack.phase === "payout";

  const seatNodes = useMemo(() => {
    return SEAT_POSITIONS.map((pos, idx) => {
      if (idx === 2 && activeHand) {
        return (
          <div
            key="player-seat"
            className={`bj-seat me ${blackjack.phase === "player" ? "active" : ""}`}
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="seat-name">{address ? "You" : "Player"}</div>
            <div className="card-group">
              {activeHand.cards.map((card, i) => renderCard(card, false, i))}
            </div>
            <div className="seat-info">
              <span>Total {activeHand.score.bestTotal}</span>
              {typeof activeHand.payout === "number" && blackjack.phase === "payout" && (
                <span className={activeHand.payout >= 0 ? "bj-win" : "bj-loss"}>
                  {activeHand.payout >= 0 ? "+" : ""}
                  {activeHand.payout.toFixed(3)} DCMon
                </span>
              )}
            </div>
          </div>
        );
      }

      return (
        <div key={`seat-${idx}`} className="bj-seat" style={{ top: pos.top, left: pos.left }}>
          <div className="seat-name">Open Seat</div>
        </div>
      );
    });
  }, [address, activeHand, blackjack.phase]);

  const handleWagerChange = (value: string) => {
    setWagerInput(value);
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      blackjack.setWager(parsed);
    }
  };

  const dealerContent = useMemo(() => {
    if (dealerCards.length === 0) {
      return <span className="bj-placeholder">Deal to begin.</span>;
    }
    return dealerCards.map((card, idx) => renderCard(card, !revealHole && idx === 1, idx));
  }, [dealerCards, revealHole]);

  const enableDeal = blackjack.phase === "betting" && !blackjack.isBusy;

  return (
    <main className="tavern game blackjack">
      <header className="blackjack-header">
        <div className="header-main">
          <Image
            className="game-logo"
            src="/assets/images/games-table.png"
            alt="Blackjack"
            width={280}
            height={120}
          />
          <Link href="/" className="rules-btn">
            Return to Tavern
          </Link>
        </div>
        <div className="wallet-strip">
          <span className="wallet-balance">
            Balance: <strong>{blackjack.formattedBalance} DCMon</strong>
          </span>
          {address ? (
            <button type="button" className="wallet-btn" onClick={disconnect}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="wallet-btn"
              onClick={() => connect().catch(() => void 0)}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      <section className="blackjack-stage">
        <div className="table-stage">
          <div className="table-canvas blackjack-table">
            <div className="dealer-node">
              <h2>Dealer</h2>
              <div className="card-group">{dealerContent}</div>
              {blackjack.revealDealer && blackjack.dealerScore && (
                <p className="muted">Total {blackjack.dealerScore.bestTotal}</p>
              )}
            </div>
            <div className="seat-layer">{seatNodes}</div>
          </div>
        </div>

        <aside className="blackjack-sidebar">
          <section className="panel">
            <h3>Table Limits</h3>
            <p className="muted">
              Min {blackjack.minBet.toFixed(2)} • Max {blackjack.maxBet.toFixed(2)} DCMon
            </p>
            <label className="field">
              <span>Wager</span>
              <input
                type="number"
                step="0.1"
                min={blackjack.minBet}
                max={blackjack.maxBet}
                value={wagerInput}
                onChange={(event) => handleWagerChange(event.target.value)}
                disabled={!enableDeal}
              />
            </label>
            <button
              type="button"
              className="primary-btn"
              disabled={!enableDeal}
              onClick={() => blackjack.startHand().catch(() => void 0)}
            >
              Deal
            </button>
            {blackjack.phase === "payout" && (
              <button type="button" className="secondary-btn" onClick={blackjack.nextHand}>
                Play Again
              </button>
            )}
          </section>

          <section className="panel">
            <h3>Actions</h3>
            <div className="action-grid">
              <button type="button" onClick={() => blackjack.hit().catch(() => void 0)} disabled={!canAct}>
                Hit
              </button>
              <button type="button" onClick={() => blackjack.stand().catch(() => void 0)} disabled={!canAct}>
                Stand
              </button>
              <button
                type="button"
                onClick={() => blackjack.doubleDown().catch(() => void 0)}
                disabled={!canAct || !activeHand?.canDouble}
              >
                Double
              </button>
              <button type="button" disabled>
                Split
              </button>
            </div>
            <p className="muted">{blackjack.message}</p>
            {blackjack.error && (
              <div className="error-banner">
                <span>{blackjack.error}</span>
                <button type="button" onClick={blackjack.resetError}>
                  ×
                </button>
              </div>
            )}
          </section>

          <section className="panel">
            <h3>Recent Hands</h3>
            {blackjack.history.length === 0 ? (
              <div className="bj-placeholder">No hands yet. Ready when you are.</div>
            ) : (
              <ul className="history-list">
                {blackjack.history.map((entry) => {
                  const net = entry.payout - entry.wager;
                  return (
                    <li key={entry.id}>
                      <span className="history-result">{entry.result.toUpperCase()}</span>
                      <span className="history-wager">
                        Wager {entry.wager.toFixed(2)} • {net >= 0 ? "+" : ""}
                        {net.toFixed(3)} DCMon
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
