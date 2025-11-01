'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, Interface, formatEther, parseEther } from "ethers";
import { BlackjackABI } from "@/abi/blackjack";
import { CONTRACTS } from "@/lib/config";
import { useWallet } from "@/context/WalletContext";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";
import { useBankroll, formatDcmon } from "@/modules/bankroll";
import { scoreHand, type Card, type HandOutcome } from "./engine";
import type {
  BlackjackHand,
  BlackjackHistoryEntry,
  BlackjackHook,
  BlackjackMode,
  BlackjackState,
} from "./types";

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
  6: "surrender",
};

const TABLE_LIMITS = { min: 0.1, max: 10 };
const MAX_ACTIVE_HANDS = 4;

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
  insuranceOffered: false,
  insuranceTaken: false,
  insuranceResolved: true,
  insuranceBet: 0,
  message: "Place your wager to begin.",
  revealDealer: false,
  isBusy: false,
  history: [],
  error: null,
  gameId: null,
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
    case "surrender":
      return "Hand surrendered. Half wager returned.";
    default:
      return "Choose your action.";
  }
};

type ContractHandStruct = {
  cards: readonly bigint[];
  stake: bigint;
  doubled: boolean;
  surrendered: boolean;
  finished: boolean;
  isSplitAces: boolean;
  outcome: bigint;
  payout: bigint;
};

type ContractGameStruct = {
  player: string;
  seed: bigint;
  deckMask: bigint;
  deckIndex: bigint;
  finished: boolean;
  activeHand: bigint;
  baseBet: bigint;
  baseStake: bigint;
  insuranceBet: bigint;
  insuranceAvailable: boolean;
  insuranceResolved: boolean;
  dealerCards: readonly bigint[];
  finalOutcome: bigint;
  totalPayout: bigint;
  hands: readonly ContractHandStruct[];
};

type NormalizedHand = {
  cards: Card[];
  stake: bigint;
  doubled: boolean;
  surrendered: boolean;
  finished: boolean;
  isSplitAces: boolean;
  outcome?: HandOutcome;
  payout: bigint;
};

type NormalizedGame = {
  gameId: bigint;
  finished: boolean;
  activeHand: number;
  baseBet: bigint;
  baseStake: bigint;
  insuranceBet: bigint;
  insuranceAvailable: boolean;
  insuranceResolved: boolean;
  dealerCards: Card[];
  finalOutcome?: HandOutcome;
  totalPayout: bigint;
  hands: NormalizedHand[];
};

const normalizeGame = (gameId: bigint, raw: ContractGameStruct): NormalizedGame => {
  const dealerCards = (raw?.dealerCards ?? []).map((card: bigint) => decodeCard(card));
  const hands = (raw?.hands ?? []).map((hand) => ({
    cards: (hand?.cards ?? []).map((card: bigint) => decodeCard(card)),
    stake: BigInt(hand?.stake ?? 0n),
    doubled: Boolean(hand?.doubled),
    surrendered: Boolean(hand?.surrendered),
    finished: Boolean(hand?.finished),
    isSplitAces: Boolean(hand?.isSplitAces),
    outcome: OUTCOME_MAP[Number(hand?.outcome ?? 0)] ?? undefined,
    payout: BigInt(hand?.payout ?? 0n),
  }));

  return {
    gameId,
    finished: Boolean(raw?.finished),
    activeHand: Number(raw?.activeHand ?? 0n),
    baseBet: BigInt(raw?.baseBet ?? 0n),
    baseStake: BigInt(raw?.baseStake ?? 0n),
    insuranceBet: BigInt(raw?.insuranceBet ?? 0n),
    insuranceAvailable: Boolean(raw?.insuranceAvailable),
    insuranceResolved: Boolean(raw?.insuranceResolved),
    dealerCards,
    finalOutcome: OUTCOME_MAP[Number(raw?.finalOutcome ?? 0)] ?? undefined,
    totalPayout: BigInt(raw?.totalPayout ?? 0n),
    hands,
  };
};

const netDcmon = (payout: bigint, stake: bigint): number => {
  const totalReturned = Number.parseFloat(formatEther(payout));
  const staked = Number.parseFloat(formatEther(stake));
  return totalReturned - staked;
};

const toUserMessage = (reason: unknown, fallback: string): string => {
  const normalize = (input: string) => input.replace(/\s+/g, " ").trim();
  const raw =
    reason instanceof Error
      ? reason.message ?? ""
      : typeof reason === "string"
      ? reason
      : "";
  const normalized = normalize(raw);
  const lower = normalized.toLowerCase();

  if (lower.includes("user rejected")) return "Transaction rejected in wallet.";
  if (lower.includes("not authorized")) return "Not authorized for this action.";
  if (lower.includes("insufficient funds")) return "Insufficient funds for this action.";
  if (lower.includes("smart account") || lower.includes("aa ensure")) {
    return "Smart account unavailable. Using wallet directly.";
  }
  if (lower.includes("execution reverted") && lower.includes("not authorized")) {
    return "Not authorized for this action.";
  }

  const base = normalized || fallback;
  return base.length > 96 ? `${base.slice(0, 93)}...` : base;
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
      const insurancePending = normalized.insuranceAvailable && !normalized.insuranceResolved;
      const activeHandIndex = normalized.finished
        ? 0
        : Math.min(
            normalized.activeHand,
            normalized.hands.length > 0 ? normalized.hands.length - 1 : 0
          );

      const playerHands = normalized.hands.map((hand, index) => {
        const score = scoreHand(hand.cards);
        const stakeNumber = Number.parseFloat(formatEther(hand.stake));
        const payoutNet =
          hand.outcome != null ? netDcmon(hand.payout, hand.stake) : undefined;
        const canAct =
          !normalized.finished &&
          !insurancePending &&
          index === activeHandIndex &&
          !hand.finished &&
          !hand.surrendered;

        return {
          id: `${normalized.gameId.toString()}-${index}`,
          cards: hand.cards,
          wager: stakeNumber,
          originalWager: stakeNumber,
          canSplit:
            canAct &&
            !hand.isSplitAces &&
            hand.cards.length === 2 &&
            normalized.hands.length < MAX_ACTIVE_HANDS,
          canDouble:
            canAct &&
            !hand.doubled &&
            !hand.isSplitAces &&
            hand.cards.length === 2,
          canSurrender: canAct && !hand.doubled && hand.cards.length === 2,
          isStanding: hand.finished && !hand.surrendered && hand.outcome == null,
          isFinished: hand.finished,
          isDouble: hand.doubled,
          isSplitAces: hand.isSplitAces,
          isSurrendered: hand.surrendered,
          result: hand.outcome,
          payout: payoutNet,
          score,
        } satisfies BlackjackHand;
      });

      const dealerScore = normalized.dealerCards.length > 0 ? scoreHand(normalized.dealerCards) : null;

      const totalStake = normalized.hands.reduce((acc, hand) => acc + hand.stake, 0n);
      const totalStakeNumber = Number.parseFloat(formatEther(totalStake));
      const totalPayoutNumber = Number.parseFloat(formatEther(normalized.totalPayout));
      const totalNet = totalPayoutNumber - totalStakeNumber;

      const message = normalized.finished
        ? outcomeMessage(normalized.finalOutcome, totalNet)
        : insurancePending
        ? normalized.insuranceBet > 0n
          ? "Insurance placed. Resolve by revealing the dealer's hand."
          : "Dealer shows an Ace. Take insurance or continue your hand."
        : "Choose your action.";

      setState((prev) => {
        let history = prev.history;
        if (includeHistory && normalized.finished) {
          const entry: BlackjackHistoryEntry = {
            id: `${normalized.gameId.toString()}-${Date.now()}`,
            timestamp: Date.now(),
            cards: playerHands[0]?.cards ?? [],
            dealer: normalized.dealerCards,
            result: normalized.finalOutcome ?? "push",
            wager: totalStakeNumber,
            payout: totalPayoutNumber,
          };
          history = [entry, ...history].slice(0, 12);
        }

        const nextPhase = normalized.finished ? "payout" : "player";

        return {
          ...prev,
          phase: nextPhase,
          dealerCards: normalized.dealerCards,
          dealerScore: normalized.finished || normalized.dealerCards.length > 0 ? dealerScore : null,
          playerHands,
          activeHandIndex: normalized.finished ? 0 : activeHandIndex,
          baseWager: prev.baseWager,
          insuranceOffered: normalized.insuranceAvailable,
          insuranceTaken: normalized.insuranceBet > 0n,
          insuranceResolved: normalized.insuranceResolved,
          insuranceBet: Number.parseFloat(formatEther(normalized.insuranceBet)),
          message,
          revealDealer: normalized.finished || normalized.dealerCards.length > 0,
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

      const aaSender = delegation?.sendTransaction;
      const ensureAA = delegation?.ensureReady;
      let aaReady = false;

      if (typeof aaSender === "function") {
        if (typeof ensureAA === "function") {
          try {
            await ensureAA();
            aaReady = true;
          } catch (err) {
            console.warn("[blackjack] AA ensureReady failed", err);
          }
        } else {
          aaReady = true;
        }
      }

      if (aaReady && typeof aaSender === "function") {
        try {
          const hash = await aaSender({
            to: blackjackAddress,
            data,
            value: 0n,
          });
          if (hash) {
            setState((prev) => ({ ...prev, message: "Waiting for confirmation..." }));
            const receipt = await provider.waitForTransaction(hash);
            if (receipt) {
              return receipt;
            }
          }
        } catch (err) {
          console.warn("[blackjack] AA send failed", err);
        }
      }

      try {
        const tx = await signer.sendTransaction({
          to: blackjackAddress,
          data,
          value: 0n,
        });
        setState((prev) => ({ ...prev, message: "Waiting for confirmation..." }));
        return await tx.wait();
      } catch (err) {
        const friendly = toUserMessage(err, "Transaction failed.");
        setState((prev) => ({ ...prev, isBusy: false, error: friendly }));
        throw new Error(friendly);
      }
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
        error: toUserMessage(err, "Failed to start hand."),
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
    async (
      action: "hit" | "stand" | "doubleDown" | "split" | "takeInsurance" | "surrender",
      label: string
    ) => {
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
          error: toUserMessage(err, "Action failed."),
        }));
      }
    },
    [ensureConnected, state.gameId, sendTransaction, fetchAndApplyGame]
  );

  const hit = useCallback(async () => {
    const hand = state.playerHands[state.activeHandIndex];
    if (!hand || hand.isFinished || hand.isSurrendered) {
      setState((prev) => ({ ...prev, error: "No active hand available." }));
      return;
    }
    await performAction("hit", "Hitting...");
  }, [performAction, state.playerHands, state.activeHandIndex]);

  const stand = useCallback(async () => {
    const hand = state.playerHands[state.activeHandIndex];
    if (!hand || hand.isFinished || hand.isSurrendered) {
      setState((prev) => ({ ...prev, error: "No active hand available." }));
      return;
    }
    await performAction("stand", "Standing...");
  }, [performAction, state.playerHands, state.activeHandIndex]);

  const doubleDown = useCallback(async () => {
    const hand = state.playerHands[state.activeHandIndex];
    if (!hand?.canDouble) {
      setState((prev) => ({ ...prev, error: "Double down not available right now." }));
      return;
    }
    await performAction("doubleDown", "Doubling down...");
  }, [performAction, state.playerHands, state.activeHandIndex]);

  const split = useCallback(async () => {
    const hand = state.playerHands[state.activeHandIndex];
    if (!hand?.canSplit) {
      setState((prev) => ({ ...prev, error: "Split is not available right now." }));
      return;
    }
    await performAction("split", "Splitting hand...");
  }, [performAction, state.playerHands, state.activeHandIndex]);

  const takeInsurance = useCallback(async () => {
    if (!state.insuranceOffered || state.insuranceResolved) {
      setState((prev) => ({ ...prev, error: "Insurance is not available." }));
      return;
    }
    await performAction("takeInsurance", "Placing insurance...");
  }, [performAction, state.insuranceOffered, state.insuranceResolved]);

  const surrender = useCallback(async () => {
    const hand = state.playerHands[state.activeHandIndex];
    if (!hand?.canSurrender) {
      setState((prev) => ({ ...prev, error: "Surrender is not available right now." }));
      return;
    }
    await performAction("surrender", "Surrendering hand...");
  }, [performAction, state.playerHands, state.activeHandIndex]);

  const nextHand = useCallback(() => {
    setState((prev) => ({
      ...prev,
      phase: "betting",
      dealerCards: [],
      dealerScore: null,
      playerHands: [],
      activeHandIndex: 0,
      insuranceOffered: false,
      insuranceTaken: false,
      insuranceResolved: true,
      insuranceBet: 0,
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
    takeInsurance,
    surrender,
    nextHand,
    setMode,
    resetError,
  };
}

