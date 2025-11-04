'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import {
  useBlackjackOnchain,
  useBlackjackSimulated,
  type BlackjackHook,
  type BlackjackMode,
} from "@/modules/blackjack";
import type { Card } from "@/modules/blackjack/engine";
import { usePageBackdrop } from "@/hooks/usePageBackdrop";

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

const OPEN_HISTORY_EVENT = "tavern:poker:openHistory";
const CHANGE_NAME_EVENT = "tavern:poker:changeName";
const LEAVE_SEAT_EVENT = "tavern:poker:leaveSeat";
const formatWagerForMode = (value: number, mode: BlackjackMode) =>
  mode === "simulated" ? Math.round(value).toString() : value.toFixed(2);

type BlackjackViewProps = {
  blackjack: BlackjackHook;
  address: string | null;
  mode: BlackjackMode;
};

function BlackjackTableView({ blackjack, address, mode }: BlackjackViewProps) {
  const [wagerInput, setWagerInput] = useState(() =>
    formatWagerForMode(blackjack.baseWager, mode)
  );
  const [isSeated, setIsSeated] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [tableModal, setTableModal] = useState<"history" | null>(null);
  const [isNameModalOpen, setNameModalOpen] = useState(false);
  const [nameModalMode, setNameModalMode] = useState<"sit" | "rename">("sit");
  const [nameDraft, setNameDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);

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
    if (typeof document === "undefined") return;
    const previous = document.body.dataset.gamePage;
    document.body.dataset.gamePage = "blackjack";
    return () => {
      if (previous) {
        document.body.dataset.gamePage = previous;
      } else {
        delete document.body.dataset.gamePage;
      }
    };
  }, []);

  useEffect(() => {
    if (blackjack.playerHands.length > 0 && !isSeated) {
      setIsSeated(true);
    }
  }, [blackjack.playerHands.length, isSeated]);

  useEffect(() => {
    setWagerInput(formatWagerForMode(blackjack.baseWager, mode));
  }, [blackjack.baseWager, mode]);

  useEffect(() => {
    if (!address && blackjack.playerHands.length === 0 && blackjack.phase === "betting") {
      setIsSeated(false);
      setTableModal(null);
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

  const openNameModal = useCallback(
    (mode: "sit" | "rename") => {
      const baseline = (playerName.trim() || shortAddress).slice(0, 24);
      setNameDraft(baseline);
      setNameModalMode(mode);
      setNameModalOpen(true);
    },
    [playerName, shortAddress]
  );

  const handleRename = useCallback(() => {
    openNameModal("rename");
  }, [openNameModal]);

  const handleSit = useCallback(() => {
    openNameModal("sit");
  }, [openNameModal]);

  const handleNameModalConfirm = useCallback(() => {
    const trimmed = nameDraft.trim().slice(0, 24);
    const finalName = trimmed || shortAddress;
    storePlayerName(finalName);
    setNameModalOpen(false);
    setIsSeated(true);
  }, [nameDraft, shortAddress, storePlayerName]);

  const handleNameModalCancel = useCallback(() => {
    setNameModalOpen(false);
  }, []);

  const handleWagerChange = useCallback((value: string) => {
    setWagerInput(value);
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      blackjack.setWager(parsed);
    }
  }, [blackjack]);

  const handleLeaveTable = useCallback(() => {
    blackjack.nextHand();
    blackjack.resetError();
    setIsSeated(false);
    setWagerInput(formatWagerForMode(blackjack.baseWager, mode));
    setTableModal(null);
  }, [blackjack, mode, setWagerInput]);

  const handleReady = useCallback(() => {
    blackjack.startHand().catch(() => void 0);
  }, [blackjack]);

  const handlePlayAgain = useCallback(() => {
    blackjack.nextHand();
  }, [blackjack]);

  const handleHit = useCallback(() => {
    blackjack.hit().catch(() => void 0);
  }, [blackjack]);

  const handleStand = useCallback(() => {
    blackjack.stand().catch(() => void 0);
  }, [blackjack]);

  const handleDouble = useCallback(() => {
    blackjack.doubleDown().catch(() => void 0);
  }, [blackjack]);

  const handleSplit = useCallback(() => {
    if (typeof blackjack.split === "function") {
      blackjack.split().catch(() => void 0);
    }
  }, [blackjack]);

  const handleInsurance = useCallback(() => {
    if (typeof blackjack.takeInsurance === "function") {
      blackjack.takeInsurance().catch(() => void 0);
    }
  }, [blackjack]);

  const handleSurrender = useCallback(() => {
    if (typeof blackjack.surrender === "function") {
      blackjack.surrender().catch(() => void 0);
    }
  }, [blackjack]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const openHistory = () => setTableModal("history");
    const requestRename = () => handleRename();
    const requestLeave = () => handleLeaveTable();
    window.addEventListener(OPEN_HISTORY_EVENT, openHistory);
    window.addEventListener(CHANGE_NAME_EVENT, requestRename);
    window.addEventListener(LEAVE_SEAT_EVENT, requestLeave);
    return () => {
      window.removeEventListener(OPEN_HISTORY_EVENT, openHistory);
      window.removeEventListener(CHANGE_NAME_EVENT, requestRename);
      window.removeEventListener(LEAVE_SEAT_EVENT, requestLeave);
    };
  }, [handleRename, handleLeaveTable]);

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

  useEffect(() => {
    if (!isNameModalOpen) return;
    const id = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isNameModalOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let disposed = false;
    let button: HTMLButtonElement | null = null;
    let timeoutId: number | null = null;

    const handleClick = (event: Event) => {
      event.preventDefault();
      handleLeaveTable();
    };

    const ensureButton = () => {
      if (disposed) return;
      const pill = document.getElementById("wallet-inline");
      if (!pill) {
        timeoutId = window.setTimeout(ensureButton, 200);
        return;
      }
      button = document.getElementById("wi-leave-table") as HTMLButtonElement | null;
      if (!button) {
        button = document.createElement("button");
        button.id = "wi-leave-table";
        button.type = "button";
      }
      button.className = "wi-leave-table";
      button.dataset.origin = "blackjack";
      button.textContent = "Leave Table";
      button.removeEventListener("click", handleClick);
      button.addEventListener("click", handleClick);
      button.disabled = blackjack.isBusy;
      if (button.parentElement !== pill) {
        pill.appendChild(button);
      }
    };

    ensureButton();

    return () => {
      disposed = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (button && button.dataset.origin === "blackjack") {
        button.removeEventListener("click", handleClick);
        button.remove();
      } else if (button) {
        button.removeEventListener("click", handleClick);
      }
    };
  }, [handleLeaveTable, blackjack.isBusy]);

  const dealerContent = useMemo(() => {
    if (dealerCards.length === 0) {
      return <span className="bj-placeholder">Deal to begin.</span>;
    }
    return dealerCards.map((card, idx) => renderCard(card, !revealHole && idx === 1, idx));
  }, [dealerCards, revealHole]);

  const enableDeal = blackjack.phase === "betting" && !blackjack.isBusy && isSeated;
  const canReady = enableDeal;

  const playerScore = activeHand?.score;
  const playerBestTotal = playerScore?.bestTotal ?? null;
  const playerTotalLabel =
    playerBestTotal != null
      ? `${playerBestTotal}${playerScore?.isSoft ? " (Soft)" : ""}`
      : isSeated
      ? "Awaiting deal"
      : "--";
  const canPlayAgain = blackjack.phase === "payout" && !blackjack.isBusy && isSeated;
  const canDouble = canAct && Boolean(activeHand?.canDouble);
  const canSplit = canAct && Boolean(activeHand?.canSplit);
  const canSurrender = canAct && Boolean(activeHand?.canSurrender);
  const insurancePending = blackjack.insuranceOffered && !blackjack.insuranceResolved;
  const rawInsurance = insurancePending
    ? (blackjack.insuranceBet > 0
      ? blackjack.insuranceBet
      : activeHand
      ? activeHand.wager / 2
      : Number.parseFloat(wagerInput) / 2)
    : 0;
  const insuranceAmount = insurancePending && Number.isFinite(rawInsurance) ? Math.max(0, rawInsurance) : 0;
  const totalHands = blackjack.playerHands.length;
  const wagerNumeric = Number.parseFloat(wagerInput);
  const wagerDisplay = Number.isFinite(wagerNumeric)
    ? formatWagerForMode(wagerNumeric, mode)
    : wagerInput;
  const activeWagerDisplay = activeHand
    ? formatWagerForMode(activeHand.wager, mode)
    : wagerDisplay;
  const activeHandLabel = activeHand
    ? `Hand ${blackjack.activeHandIndex + 1} of ${Math.max(totalHands, 1)}`
    : "Hand";
  const amountUnit = mode === "simulated" ? "chips" : "DCMon";
  const formatAmount = useCallback(
    (value: number) => (mode === "simulated" ? value.toFixed(0) : value.toFixed(2)),
    [mode]
  );
  const formatNet = useCallback(
    (value: number) => (mode === "simulated" ? value.toFixed(0) : value.toFixed(3)),
    [mode]
  );
  const formatPayoutDisplay = useCallback(
    (value: number) => (mode === "simulated" ? value.toFixed(0) : value.toFixed(3)),
    [mode]
  );
  const dockMessage = useMemo(() => {
    if (blackjack.error) return blackjack.error;
    if (blackjack.message) return blackjack.message;
    switch (blackjack.phase) {
      case "betting":
        return isSeated ? "Set your wager and deal the next hand." : "Take a seat to begin.";
      case "player":
        if (insurancePending) {
          return blackjack.insuranceTaken
            ? "Insurance locked in. Continue your hand."
            : "Dealer shows an Ace. Decide on insurance.";
        }
        return canAct ? "Choose your action." : "Waiting for the next card.";
      case "dealer":
        return "Dealer is drawing to 17.";
      case "payout":
        return "Settling wagers.";
      default:
        return "Shuffling the shoe...";
    }
  }, [blackjack.error, blackjack.message, blackjack.phase, isSeated, canAct, insurancePending, blackjack.insuranceTaken]);

  const seatNodes = useMemo(() => {
    return SEAT_POSITIONS.map((pos, idx) => {
      const style = { top: pos.top, left: pos.left };
      if (idx !== PLAYER_SEAT_INDEX) {
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
      }

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

      const seatState =
        blackjack.phase === "player" ? "active" : blackjack.phase === "betting" ? "waiting" : "";
      const payout =
        typeof activeHand?.payout === "number" && blackjack.phase === "payout"
          ? activeHand.payout
          : null;

      return (
        <div key="player-seat" className={`bj-seat me ${seatState}`} style={style}>
          <div className="seat-name">{displayName}</div>
          <div
            className="card-group"
            style={{ flexDirection: "column", alignItems: "center", gap: "12px" }}
          >
            {blackjack.playerHands.length === 0 ? (
              <div className="bj-card-placeholder">
                <span className="bj-placeholder">Ready for the next shoe.</span>
              </div>
            ) : (
              blackjack.playerHands.map((hand, handIdx) => (
                <div
                  key={hand.id}
                  className={`bj-hand-row${handIdx === blackjack.activeHandIndex ? " active" : ""}`}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}
                >
                  <div className="bj-hand-meta" style={{ fontSize: "12px", opacity: 0.85 }}>
                    Hand {handIdx + 1}
                    {hand.isSurrendered
                      ? " — Surrendered"
                      : hand.result
                      ? ` — ${hand.result.toUpperCase()}`
                      : handIdx === blackjack.activeHandIndex
                      ? " — Active"
                      : ""}
                  </div>
                  <div className="card-group">
                    {hand.cards.map((card, i) => renderCard(card, false, `${hand.id}-${i}`))}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="seat-info">
            <span>
              {activeHandLabel}: {activeHand ? activeHand.score.bestTotal : playerTotalLabel}
            </span>
            {mode === "simulated" && (
              <span>
                Chips:{" "}
                <span className="highlight">
                  {Math.max(0, Math.round(blackjack.f2pChips ?? 0))}
                </span>
              </span>
            )}
            {payout != null && (
              <span className={payout >= 0 ? "bj-win" : "bj-loss"}>
                {payout >= 0 ? "+" : ""}
                {formatPayoutDisplay(payout)} {amountUnit}
              </span>
            )}
          </div>
            <div className="seat-console">
              <div className="seat-console-top">
                <div className="seat-hud">
                  <span>
                    Wager {activeWagerDisplay} {amountUnit}
                  </span>
                  {totalHands > 1 && (
                    <span>
                      {blackjack.activeHandIndex + 1}/{totalHands}
                    </span>
                  )}
                </div>
                <div className="seat-prompt">{dockMessage}</div>
                {insurancePending && (
                  <div className="seat-insurance">
                    <button
                      type="button"
                      onClick={handleInsurance}
                      disabled={blackjack.isBusy || blackjack.insuranceTaken}
                    >
                      {blackjack.insuranceTaken
                        ? `Insurance ${formatAmount(insuranceAmount)} ${amountUnit} placed`
                        : `Take Insurance (${formatAmount(insuranceAmount)} ${amountUnit})`}
                    </button>
                  </div>
                )}
              </div>
              <div className="seat-controls">
                <div className="seat-rail seat-rail-left">
                  {canAct && (
                    <>
                    <button type="button" onClick={handleHit} disabled={!canAct}>
                      Hit
                    </button>
                    <button type="button" onClick={handleStand} disabled={!canAct}>
                      Stand
                    </button>
                    <button type="button" onClick={handleSurrender} disabled={!canSurrender}>
                      Surrender
                    </button>
                    {canDouble && (
                      <button type="button" onClick={handleDouble} disabled={!canDouble}>
                        Double
                      </button>
                    )}
                    {canSplit && (
                      <button type="button" onClick={handleSplit} disabled={!canSplit}>
                        Split
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="seat-rail seat-rail-right">
                {blackjack.phase === "betting" && (
                  <div className="bet-input-inline">
                    <input
                      type="number"
                      step={mode === "simulated" ? 1 : 0.1}
                      min={blackjack.minBet}
                      max={blackjack.maxBet}
                      value={wagerInput}
                      onChange={(event) => handleWagerChange(event.target.value)}
                      disabled={!canReady}
                      aria-label={`Wager amount in ${amountUnit}`}
                      className="bet-input"
                    />
                    <button type="button" onClick={handleReady} disabled={!canReady}>
                      Ready
                    </button>
                  </div>
                )}
                {canPlayAgain && (
                  <button type="button" onClick={handlePlayAgain} disabled={!canPlayAgain}>
                    Play Again
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    });
  }, [
    activeHand,
    activeHandLabel,
    activeWagerDisplay,
    blackjack.activeHandIndex,
    blackjack.insuranceTaken,
    blackjack.isBusy,
    blackjack.maxBet,
    blackjack.minBet,
    blackjack.phase,
    blackjack.playerHands,
    canAct,
    canDouble,
    canPlayAgain,
    canReady,
    canSplit,
    canSurrender,
    displayName,
    dockMessage,
    handleDouble,
    handleHit,
    handleInsurance,
    handlePlayAgain,
    handleReady,
    handleSit,
    handleSplit,
    handleStand,
    handleSurrender,
    insuranceAmount,
    insurancePending,
    isSeated,
    playerTotalLabel,
    spectatorAssignments,
    handleWagerChange,
    totalHands,
    wagerInput,
    amountUnit,
    formatPayoutDisplay,
    formatAmount,
    blackjack.f2pChips,
    mode,
  ]);

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
      {tableModal === "history" && (
        <div className="table-panel" role="dialog" aria-modal="true">
          <div className="table-panel-content">
            <div className="table-panel-header">
              <h3>Recent Hands</h3>
              <button
                type="button"
                className="table-panel-close"
                onClick={() => setTableModal(null)}
              >
                Close
              </button>
            </div>
            <div className="table-panel-body">
              {blackjack.history.length === 0 ? (
                <p>No hands yet. Ready when you are.</p>
              ) : (
                <ul>
                  {blackjack.history.map((entry) => {
                    const net = entry.payout - entry.wager;
                    return (
                      <li key={entry.id}>
                        <strong>{entry.result.toUpperCase()}</strong>
                        <span>
                          Wager {formatAmount(entry.wager)} - {net >= 0 ? "+" : ""}
                          {formatNet(net)} {amountUnit}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
      {isNameModalOpen && (
        <div className="poker-modal-backdrop">
          <div className="poker-modal">
            <h3>{nameModalMode === "rename" ? "Update Your Name" : "Choose Your Name"}</h3>
            <p className="muted">Pick the display name shown to other players at this table.</p>
            <input
              ref={nameInputRef}
              type="text"
              maxLength={24}
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Dak & Chog Regular"
            />
            <div className="modal-actions">
              <button type="button" onClick={handleNameModalCancel}>
                Cancel
              </button>
              <button type="button" onClick={handleNameModalConfirm}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function BlackjackOnchainView() {
  usePageBackdrop("blackjack");
  const { address } = useWallet();
  const blackjack = useBlackjackOnchain();
  return <BlackjackTableView blackjack={blackjack} address={address} mode="onchain" />;
}

function BlackjackSimulatedView() {
  usePageBackdrop("blackjack");
  const { address } = useWallet();
  const blackjack = useBlackjackSimulated();
  return <BlackjackTableView blackjack={blackjack} address={address} mode="simulated" />;
}

export default function BlackjackPage() {
  const searchParams = useSearchParams();
  const modeParam = (searchParams?.get("mode") ?? "").toLowerCase();
  if (modeParam === "f2p" || modeParam === "simulated") {
    return <BlackjackSimulatedView />;
  }
  return <BlackjackOnchainView />;
}























