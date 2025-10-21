'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, Interface, formatEther, parseEther } from "ethers";
import { BlackjackABI } from "@/abi/blackjack";
import { CONTRACTS } from "@/lib/config";
import { useWallet } from "@/context/WalletContext";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";
import { useBankroll, formatDcmon } from "@/modules/bankroll";
import { scoreHand, type Card, type HandOutcome } from "./engine";
import type { BlackjackHistoryEntry, BlackjackHook, BlackjackMode, BlackjackState } from "./types";

const blackjackInterface = new Interface(BlackjackABI);

const SUITS: Array<"C" | "D" | "H" | "S"> = ["C", "D", "H", "S"];
const RANKS: Array<"A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K"> = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
];

const OUTCOME_MAP: Record<number, HandOutcome | undefined> = {
  1: "blackjack",
  2: "win",
  3: "push",
  4: "lose",
  5: "bust",
};

const TABLE_LIMITS = { min: 0.1, max: 10 };

const initialState: BlackjackState = {
  phase: "betting",
  mode: "onchain",
  shoe: [],
  dealerCards: [],
  dealerScore: null,
  playerHands: [],
  activeHandIndex: 0,
  baseWager: TABLE_LIMITS.min,
  minBet: TABLE_LIMITS.min,
  maxBet: TABLE_LIMITS.max,
  message: "Place your wager to begin.",
  revealDealer: false,
  isBusy: false,
  history: [],
  error: null,
  gameId: null,
};

type NormalizedGame = {
  gameId: bigint;
  wager: bigint;
  additionalWager: bigint;
  finished: boolean;
  doubled: boolean;
  playerCards: Card[];
  dealerCards: Card[];
  outcome: HandOutcome | undefined;
  payout: bigint;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const decodeCard = (value: bigint | number): Card => {
  const numeric = Number(value);
  const rankIndex = numeric % 13;
  const suitIndex = Math.floor(numeric / 13);
  return `${RANKS[rankIndex]}${SUITS[suitIndex]}` as Card;
};

const outcomeMessage = (outcome: HandOutcome | undefined, net: number) => {
  switch (outcome) {
    case "blackjack":
      return "Blackjack! You win 3:2.";
    case "win":
      return net > 0 ? `You win ${net.toFixed(3)} DCMon.` : "You win!";
    case "push":
      return "Push. Stake returned.";
    case "lose":
      return "Dealer wins.";
    case "bust":
      return "Busted.";
    default:
      return "Choose your action.";
  }
};

type ContractGameStruct = {
  player: string;
  wager: bigint;
  additionalWager: bigint;
  finished: boolean;
  doubled: boolean;
  playerCards: readonly bigint[];
  dealerCards: readonly bigint[];
  outcome: bigint;
  payout: bigint;
};

const normalizeGame = (gameId: bigint, raw: ContractGameStruct): NormalizedGame => {
  const wager = BigInt(raw?.wager ?? 0n);
  const additionalWager = BigInt(raw?.additionalWager ?? 0n);
  const finished = Boolean(raw?.finished);
  const doubled = Boolean(raw?.doubled);
  const playerCards = (raw?.playerCards ?? []).map((card: bigint) => decodeCard(card));
  const dealerCards = (raw?.dealerCards ?? []).map((card: bigint) => decodeCard(card));
  const outcomeValue = Number(raw?.outcome ?? 0);
  const outcome = OUTCOME_MAP[outcomeValue];
  const payout = BigInt(raw?.payout ?? 0n);

  return {
    gameId,
    wager,
    additionalWager,
    finished,
    doubled,
    playerCards,
    dealerCards,
    outcome,
    payout,
  };
};

const netDcmon = (payout: bigint, wager: bigint): number => {
  const totalReturned = Number.parseFloat(formatEther(payout));
  const stake = Number.parseFloat(formatEther(wager));
  return totalReturned - stake;
};

export function useBlackjack(): BlackjackHook {
  const [state, setState] = useState<BlackjackState>(() => {
    let storedWager = TABLE_LIMITS.min;
    try {
      const stored = localStorage.getItem("blackjack:lastWager");
      if (stored) {
        const parsed = Number(stored);
        if (Number.isFinite(parsed)) {
          storedWager = clamp(parsed, TABLE_LIMITS.min, TABLE_LIMITS.max);
        }
      }
    } catch {
      storedWager = TABLE_LIMITS.min;
    }
    return { ...initialState, baseWager: storedWager };
  });

  const { address, provider } = useWallet();
  const delegation = useDelegationToolkitAA();
  const { dcmonBalance, ensureAllowance, hasDcmonBalance, refresh } = useBankroll();

  const blackjackAddress = CONTRACTS.blackjack;

  const contract = useMemo(() => {
    if (!provider) return null;
    return new Contract(blackjackAddress, BlackjackABI, provider);
  }, [blackjackAddress, provider]);

  const formattedBalance = useMemo(() => formatDcmon(dcmonBalance), [dcmonBalance]);

  const applyGameState = useCallback(
    (normalized: NormalizedGame, includeHistory: boolean) => {
      const playerScore = scoreHand(normalized.playerCards);
      const dealerScore = scoreHand(normalized.dealerCards);
      const hand = {
        id: normalized.gameId.toString(),
        cards: normalized.playerCards,
        wager: Number.parseFloat(formatEther(normalized.wager)),
        originalWager: Number.parseFloat(formatEther(normalized.wager + normalized.additionalWager)),
        canSplit: false,
        canDouble:
          !normalized.finished &&
          !normalized.doubled &&
          normalized.playerCards.length === 2 &&
          normalized.outcome === undefined,
        isStanding: normalized.finished,
        isFinished: normalized.finished,
        isDouble: normalized.doubled,
        result: normalized.outcome,
        payout: normalized.outcome ? netDcmon(normalized.payout, normalized.wager) : undefined,
        score: playerScore,
      };

      setState((prev) => {
        let history: BlackjackHistoryEntry[] = prev.history;
        if (includeHistory && normalized.finished && normalized.outcome) {
          const entry: BlackjackHistoryEntry = {
            id: `${normalized.gameId.toString()}-${Date.now()}`,
            timestamp: Date.now(),
            cards: normalized.playerCards,
            dealer: normalized.dealerCards,
            result: normalized.outcome,
            wager: Number.parseFloat(formatEther(normalized.wager)),
            payout: Number.parseFloat(formatEther(normalized.payout)),
          };
          history = [entry, ...history].slice(0, 12);
        }

        const nextPhase = normalized.finished ? "payout" : "player";
        const message = normalized.finished
          ? outcomeMessage(normalized.outcome, hand.payout ?? 0)
          : "Choose your action.";

        return {
          ...prev,
          phase: nextPhase,
          dealerCards: normalized.dealerCards,
          dealerScore: normalized.finished ? dealerScore : null,
          playerHands: [hand],
          activeHandIndex: 0,
          message,
          revealDealer: normalized.finished,
          isBusy: false,
          error: null,
          history,
          gameId: normalized.finished ? null : normalized.gameId,
        };
      });

      if (normalized.finished) {
        refresh().catch(() => void 0);
      }
    },
    [refresh]
  );

  const fetchAndApplyGame = useCallback(
    async (gameId: bigint, includeHistory: boolean) => {
      if (!contract) return;
      const raw = (await contract.getGame(gameId)) as ContractGameStruct;
      const normalized = normalizeGame(gameId, raw);
      applyGameState(normalized, includeHistory);
    },
    [contract, applyGameState]
  );

  useEffect(() => {
    if (!contract || !address) return;
    let cancelled = false;
    (async () => {
      const active = await contract.activeGame(address);
      if (cancelled) return;
      if (active && active > 0n) {
        await fetchAndApplyGame(active, false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contract, address, fetchAndApplyGame]);

  const setWager = useCallback((value: number) => {
    setState((prev) => {
      const wager = clamp(Number.isFinite(value) ? value : prev.baseWager, prev.minBet, prev.maxBet);
      try {
        localStorage.setItem("blackjack:lastWager", wager.toFixed(3));
      } catch {
        // ignore storage errors
      }
      return {
        ...prev,
        baseWager: wager,
        message: prev.phase === "betting" ? "Ready to deal." : prev.message,
        error: null,
      };
    });
  }, []);

  const ensureConnected = useCallback(async () => {
    if (address && provider) return true;
    return false;
  }, [address, provider]);

  const sendTransaction = useCallback(
    async (data: string, label: string) => {
      if (!provider) throw new Error("Wallet provider unavailable.");
      setState((prev) => ({ ...prev, isBusy: true, message: label, error: null }));

      const signer = await provider.getSigner();

      try {
        const hash = await delegation.sendTransaction({
          to: blackjackAddress,
          data,
          value: 0n,
        });
        if (hash) {
          const receipt = await provider.waitForTransaction(hash);
          if (receipt) return receipt;
        }
      } catch (err) {
        console.warn("[blackjack] AA send failed", err);
      }

      const tx = await signer.sendTransaction({
        to: blackjackAddress,
        data,
        value: 0n,
      });
      return await tx.wait();
    },
    [delegation, provider, blackjackAddress]
  );

  const startHand = useCallback(async () => {
    if (!(await ensureConnected())) {
      setState((prev) => ({ ...prev, error: "Connect wallet to play." }));
      return;
    }
    if (!provider || !contract || !address) return;

    const wager = clamp(state.baseWager, state.minBet, state.maxBet);
    const wagerWei = parseEther(wager.toFixed(6));

    const hasBalance = await hasDcmonBalance(wagerWei);
    if (!hasBalance) {
      setState((prev) => ({ ...prev, error: "Insufficient DCMon balance for this wager." }));
      return;
    }

    const approved = await ensureAllowance(blackjackAddress, wagerWei, {
      onProgress: (message) => setState((prev) => ({ ...prev, message })),
    });
    if (!approved) return;

    try {
      const encoded = blackjackInterface.encodeFunctionData("startHand", [wagerWei]);
      const receipt = await sendTransaction(encoded, "Dealing cards...");

      let gameId: bigint | null = null;
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = blackjackInterface.parseLog(log);
          if (parsed && parsed.name === "HandStarted" && parsed.args?.player === address) {
            gameId = parsed.args.gameId as bigint;
            break;
          }
        } catch {
          // ignore parse errors
        }
      }

      if (!gameId) {
        const active = await contract.activeGame(address);
        if (active && active > 0n) {
          gameId = active;
        }
      }

      if (!gameId) {
        setState((prev) => ({
          ...prev,
          phase: "betting",
          isBusy: false,
          message: "Unable to locate new hand.",
        }));
        return;
      }

      await fetchAndApplyGame(gameId, true);
    } catch (err) {
      console.error("[blackjack] startHand failed", err);
      setState((prev) => ({
        ...prev,
        isBusy: false,
        error: err instanceof Error ? err.message : "Failed to start hand.",
      }));
    }
  }, [
    ensureConnected,
    provider,
    contract,
    address,
    state.baseWager,
    state.minBet,
    state.maxBet,
    hasDcmonBalance,
    ensureAllowance,
    blackjackAddress,
    sendTransaction,
    fetchAndApplyGame,
  ]);

  const performAction = useCallback(
    async (action: "hit" | "stand" | "doubleDown", label: string) => {
      if (!(await ensureConnected())) {
        setState((prev) => ({ ...prev, error: "Connect wallet to play." }));
        return;
      }
      const gameId = state.gameId;
      if (!gameId) return;
      const encoded = blackjackInterface.encodeFunctionData(action, [gameId]);
      try {
        await sendTransaction(encoded, label);
        await fetchAndApplyGame(gameId, true);
      } catch (err) {
        console.error(`[blackjack] ${action} failed`, err);
        setState((prev) => ({
          ...prev,
          isBusy: false,
          error: err instanceof Error ? err.message : "Action failed.",
        }));
      }
    },
    [ensureConnected, state.gameId, sendTransaction, fetchAndApplyGame]
  );

  const hit = useCallback(async () => {
    await performAction("hit", "Hitting...");
  }, [performAction]);

  const stand = useCallback(async () => {
    await performAction("stand", "Standing...");
  }, [performAction]);

  const doubleDown = useCallback(async () => {
    const hand = state.playerHands[0];
    if (!hand?.canDouble) {
      setState((prev) => ({ ...prev, error: "Double down not available right now." }));
      return;
    }
    await performAction("doubleDown", "Doubling down...");
  }, [performAction, state.playerHands]);

  const split = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      error: "Split is not available in this build.",
    }));
  }, []);

  const nextHand = useCallback(() => {
    setState((prev) => ({
      ...prev,
      phase: "betting",
      dealerCards: [],
      dealerScore: null,
      playerHands: [],
      activeHandIndex: 0,
      message: "Place your wager to begin.",
      revealDealer: false,
      isBusy: false,
      error: null,
      gameId: null,
    }));
  }, []);

  const resetError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const setMode = useCallback((mode: BlackjackMode) => {
    if (mode !== "onchain") {
      console.warn("[blackjack] Only on-chain mode is available right now.");
    }
  }, []);

  return {
    ...state,
    formattedBalance,
    dcmonBalance,
    setWager,
    startHand,
    hit,
    stand,
    doubleDown,
    split,
    nextHand,
    setMode,
    resetError,
  };
}
