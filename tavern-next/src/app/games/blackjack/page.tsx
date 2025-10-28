'use client';

import { useMemo, useState, useEffect, useCallback } from "react";
import { useWallet } from "@/context/WalletContext";
import { useBlackjack } from "@/modules/blackjack/useBlackjack";
import type { Card } from "@/modules/blackjack/engine";
import { usePageBackdrop } from "@/hooks/usePageBackdrop";

const cx = (...args: Array<string | false | null | undefined>) => args.filter(Boolean).join(" ");

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

const PLAYER_SEAT_INDEX = 2;
const SPECTATOR_NAMES = ["Dak", "Chog", "Lucky Lynx", "Ivy", "Mara"] as const;

const cardImageUrl = (card: Card) => {
  const rank = RANK_LABEL[card[0]] ?? "ace";
  const suit = SUIT_LABEL[card[1]] ?? "spades";
  return `/assets/images/chog_cards/chog-${rank}-of-${suit}.png`;
};

const renderCard = (card: Card, hidden = false, key?: string | number) => {
  if (hidden) {
    return (
      <span key={`hidden-${key ?? card}`} className="bj-card bj-card-hidden" aria-hidden="true">
        ??
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
  usePageBackdrop("blackjack");

  const { address } = useWallet();
  const blackjack = useBlackjack();
  const [wagerInput, setWagerInput] = useState(() => blackjack.baseWager.toFixed(2));
  const [isSeated, setIsSeated] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [activePanel, setActivePanel] = useState<"info" | "history" | null>(null);

  const activeHand = blackjack.playerHands[blackjack.activeHandIndex] ?? null;
  const canAct =
    isSeated && blackjack.phase === "player" && !blackjack.isBusy && activeHand && !activeHand.isFinished;
  const dealerCards = blackjack.dealerCards;
  const revealHole = blackjack.revealDealer || blackjack.phase === "payout";
  const shortAddress = useMemo(() => {
    if (!address) return "Player";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, [address]);
  const displayName = useMemo(() => {
    const trimmed = playerName.trim();
    return trimmed.length > 0 ? trimmed : shortAddress;
  }, [playerName, shortAddress]);

  const togglePanel = useCallback((panel: "info" | "history") => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("blackjack:name");
      if (stored) {
        setPlayerName(stored);
      }
    } catch {
      // ignore storage access issues
    }
  }, []);

  useEffect(() => {
    if (blackjack.playerHands.length > 0 && !isSeated) {
      setIsSeated(true);
    }
  }, [blackjack.playerHands.length, isSeated]);

  useEffect(() => {
    if (!address && blackjack.playerHands.length === 0 && blackjack.phase === "betting") {
      setIsSeated(false);
      setActivePanel(null);
    }
  }, [address, blackjack.phase, blackjack.playerHands.length]);

  const spectatorAssignments = useMemo(() => {
    const map = new Map<number, string>();
    let cursor = 0;
    SEAT_POSITIONS.forEach((_, idx) => {
      if (idx === PLAYER_SEAT_INDEX) return;
      const fallback = `Guest ${cursor + 1}`;
      map.set(idx, SPECTATOR_NAMES[cursor] ?? fallback);
      cursor += 1;
    });
    return map;
  }, []);

  const storePlayerName = useCallback((value: string) => {
    setPlayerName(value);
    if (typeof window === "undefined") return;
    try {
      if (value.trim()) {
        window.localStorage.setItem("blackjack:name", value);
      } else {
        window.localStorage.removeItem("blackjack:name");
      }
    } catch {
      // ignore persistence errors
    }
  }, []);

  const promptForTableName = useCallback(
    (initial?: string) => {
      if (typeof window === "undefined") return initial ?? displayName;
      const baseline = initial ?? displayName;
      const response = window.prompt("Choose your table name", baseline);
      if (response === null) {
        return baseline;
      }
      const trimmed = response.trim().slice(0, 24);
      storePlayerName(trimmed);
      return trimmed || shortAddress;
    },
    [displayName, shortAddress, storePlayerName]
  );

  const handleRename = useCallback(() => {
    promptForTableName(displayName);
  }, [displayName, promptForTableName]);

  const handleSit = useCallback(() => {
    if (!playerName.trim()) {
      promptForTableName(shortAddress);
    }
    setIsSeated(true);
    setActivePanel(null);
  }, [playerName, promptForTableName, shortAddress]);

  const seatNodes = useMemo(() => {
    return SEAT_POSITIONS.map((pos, idx) => {
      const style = { top: pos.top, left: pos.left };
      if (idx === PLAYER_SEAT_INDEX) {
        if (!isSeated) {
          return (
            <div key="player-seat" className="bj-seat me pending" style={style}>
              <button type="button" className="bj-sit-btn" onClick={handleSit}>
                Sit
              </button>
              <span className="seat-hint">Anchor this table to play.</span>
            </div>
          );
        }
        if (!activeHand) {
          return (
            <div key="player-seat" className="bj-seat me waiting" style={style}>
              <div className="seat-name">{displayName}</div>
              <div className="card-group bj-card-placeholder">
                <span className="bj-placeholder">Waiting for deal…</span>
              </div>
            </div>
          );
        }
        return (
          <div
            key="player-seat"
            className={`bj-seat me ${blackjack.phase === "player" ? "active" : ""}`}
            style={style}
          >
            <div className="seat-name">{displayName}</div>
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

      const occupant = isSeated ? spectatorAssignments.get(idx) : null;
      return (
        <div key={`seat-${idx}`} className={`bj-seat${occupant ? " occupied" : ""}`} style={style}>
          <div className="seat-name">{occupant ?? "Open Seat"}</div>
          {occupant && (
            <div className="card-group bj-card-placeholder">
              <span className="bj-placeholder">Watching the action</span>
            </div>
          )}
        </div>
      );
    });
  }, [activeHand, blackjack.phase, displayName, handleSit, isSeated, spectatorAssignments]);

  const handleWagerChange = (value: string) => {
    setWagerInput(value);
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      blackjack.setWager(parsed);
    }
  };

  const handleLeaveTable = useCallback(() => {
    blackjack.nextHand();
    blackjack.resetError();
    setIsSeated(false);
    setWagerInput(blackjack.baseWager.toFixed(2));
    setActivePanel(null);
  }, [blackjack, setWagerInput]);

  const dealerContent = useMemo(() => {
    if (dealerCards.length === 0) {
      return <span className="bj-placeholder">Deal to begin.</span>;
    }
    return dealerCards.map((card, idx) => renderCard(card, !revealHole && idx === 1, idx));
  }, [dealerCards, revealHole]);

  const enableDeal = blackjack.phase === "betting" && !blackjack.isBusy && isSeated;

  const playerScore = activeHand?.score;
  const playerBestTotal = playerScore?.bestTotal ?? null;
  const dealerBestTotal =
    blackjack.revealDealer && blackjack.dealerScore ? blackjack.dealerScore.bestTotal : null;
  const dealerTotalLabel =
    dealerBestTotal != null ? `${dealerBestTotal}` : dealerCards.length > 0 ? "Face Down" : "--";
  const playerTotalLabel =
    playerBestTotal != null
      ? `${playerBestTotal}${playerScore?.isSoft ? " (Soft)" : ""}`
      : isSeated
      ? "Awaiting deal"
      : "--";
  const canDeal = enableDeal && !blackjack.isBusy;
  const canPlayAgain = blackjack.phase === "payout" && !blackjack.isBusy && isSeated;
  const canDouble = canAct && Boolean(activeHand?.canDouble);
  const canSplit = canAct && Boolean(activeHand?.canSplit);
  const wagerNumeric = Number.parseFloat(wagerInput);
  const wagerDisplay = Number.isFinite(wagerNumeric) ? wagerNumeric.toFixed(2) : wagerInput;
  const dockMessage = useMemo(() => {
    if (blackjack.error) return blackjack.error;
    if (blackjack.message) return blackjack.message;
    switch (blackjack.phase) {
      case "betting":
        return isSeated ? "Set your wager and deal the next hand." : "Take a seat to begin.";
      case "dealing":
        return "Dealing cards...";
      case "player":
        return canAct ? "Choose your action." : "Waiting for the next card.";
      case "dealer":
        return "Dealer is drawing to 17.";
      case "payout":
        return "Settling wagers.";
      default:
        return "Shuffling the shoe...";
    }
  }, [blackjack.error, blackjack.message, blackjack.phase, isSeated, canAct]);

  const infoItems = useMemo(
    () => [
      { label: "Phase", value: blackjack.phase.toUpperCase() },
      {
        label: "Seat",
        value: isSeated ? displayName : "Open",
      },
      { label: "Current Wager", value: `${wagerDisplay} DCMon` },
      {
        label: "Limits",
        value: `${blackjack.minBet.toFixed(2)} / ${blackjack.maxBet.toFixed(2)} DCMon`,
      },
      { label: "Dealer Total", value: dealerTotalLabel },
      { label: "Your Total", value: playerTotalLabel },
      {
        label: "Hands Played",
        value: `${blackjack.history.length}`,
      },
    ],
    [
      blackjack.phase,
      blackjack.minBet,
      blackjack.maxBet,
      blackjack.history.length,
      isSeated,
      displayName,
      wagerInput,
      dealerTotalLabel,
      playerTotalLabel,
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
          </div>
        ),
      };
    }
    if (blackjack.history.length === 0) {
      return {
        title: "Recent Hands",
        content: <p>No hands yet. Ready when you are.</p>,
      };
    }
    return {
      title: "Recent Hands",
      content: (
        <ul>
          {blackjack.history.map((entry) => {
            const net = entry.payout - entry.wager;
            return (
              <li key={entry.id}>
                <strong>{entry.result.toUpperCase()}</strong>
                <span>
                  Wager {entry.wager.toFixed(2)} � {net >= 0 ? "+" : ""}
                  {net.toFixed(3)} DCMon
                </span>
              </li>
            );
          })}
        </ul>
      ),
    };
  }, [activePanel, blackjack.history, infoItems]);

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

  return (
    <main className="blackjack-page">
      <section className="blackjack-stage">
        <div className="blackjack-table-wrap">
          <div className="table-canvas blackjack-table">
            <div className="dealer-node">
              <h2>Dealer</h2>
              <div className="card-group">{dealerContent}</div>
              {blackjack.revealDealer && blackjack.dealerScore && (
                <p className="muted">Total {blackjack.dealerScore.bestTotal}</p>
              )}
            </div>
            <div className="seat-layer">{seatNodes}</div>
            {!isSeated && (
              <div className="blackjack-callout">
                Take a seat, place your wager, and take on the dealer.
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="table-dock-wrapper">
        <div
          className={cx(
            "table-dock",
            canAct && isSeated && !blackjack.isBusy && "active",
            !isSeated && "disabled"
          )}
        >
          <div className="dock-info">{dockMessage}</div>
          <div className="dock-stats">
            <span>Dealer: {dealerTotalLabel}</span>
            <span>You: {playerTotalLabel}</span>
            <span>
              Wager: {wagerDisplay} DCMon (Min {blackjack.minBet.toFixed(2)} / Max{" "}
              {blackjack.maxBet.toFixed(2)})
            </span>
          </div>
          <div className="dock-controls">
            <div className="bet-input-group">
              <input
                type="number"
                step="0.1"
                min={blackjack.minBet}
                max={blackjack.maxBet}
                value={wagerInput}
                onChange={(event) => handleWagerChange(event.target.value)}
                disabled={!canDeal}
                aria-label="Wager amount in DCMon"
                className="bet-input"
              />
              <button type="button" onClick={() => blackjack.startHand().catch(() => void 0)} disabled={!canDeal}>
                Deal
              </button>
              <button type="button" onClick={blackjack.nextHand} disabled={!canPlayAgain}>
                Play Again
              </button>
            </div>
            <button type="button" onClick={() => blackjack.hit().catch(() => void 0)} disabled={!canAct}>
              Hit
            </button>
            <button type="button" onClick={() => blackjack.stand().catch(() => void 0)} disabled={!canAct}>
              Stand
            </button>
            <button
              type="button"
              onClick={() => blackjack.doubleDown().catch(() => void 0)}
              disabled={!canDouble}
            >
              Double
            </button>
            <button type="button" disabled={!canSplit}>
              Split
            </button>
            <button type="button" onClick={handleRename} disabled={!isSeated || blackjack.isBusy}>
              Change Name
            </button>
            <button type="button" onClick={handleLeaveTable} disabled={!isSeated || blackjack.isBusy}>
              Leave Table
            </button>
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
              Recent Hands{blackjack.history.length > 0 ? ` (${blackjack.history.length})` : ""}
            </button>
            {blackjack.error && (
              <button type="button" onClick={blackjack.resetError}>
                Dismiss Error
              </button>
            )}
          </div>
        </div>
      </div>

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
    </main>
  );
}
