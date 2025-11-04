'use client';

import type { Card, HandOutcome, Score } from "./engine";

export type BlackjackPhase = "betting" | "player" | "dealer" | "payout";
export type BlackjackMode = "simulated" | "onchain";

export interface BlackjackHand {
  id: string;
  cards: Card[];
  wager: number;
  originalWager: number;
  canSplit: boolean;
  canDouble: boolean;
  canSurrender: boolean;
  isStanding: boolean;
  isFinished: boolean;
  isDouble: boolean;
  isSplitAces: boolean;
  isSurrendered: boolean;
  result?: HandOutcome;
  payout?: number;
  score: Score;
}

export interface BlackjackHistoryEntry {
  id: string;
  timestamp: number;
  cards: Card[];
  dealer: Card[];
  result: HandOutcome;
  wager: number;
  payout: number;
}

export interface BlackjackState {
  phase: BlackjackPhase;
  mode: BlackjackMode;
  shoe: Card[];
  dealerCards: Card[];
  dealerScore: Score | null;
  playerHands: BlackjackHand[];
  activeHandIndex: number;
  baseWager: number;
  minBet: number;
  maxBet: number;
  insuranceOffered: boolean;
  insuranceTaken: boolean;
  insuranceResolved: boolean;
  insuranceBet: number;
  message: string | null;
  revealDealer: boolean;
  isBusy: boolean;
  history: BlackjackHistoryEntry[];
  error: string | null;
  gameId: bigint | null;
  f2pChips: number | null;
}

export interface BlackjackControls {
  setWager: (value: number) => void;
  startHand: () => Promise<void>;
  hit: () => Promise<void>;
  stand: () => Promise<void>;
  doubleDown: () => Promise<void>;
  split: () => Promise<void>;
  takeInsurance: () => Promise<void>;
  surrender: () => Promise<void>;
  nextHand: () => void;
  setMode: (mode: BlackjackMode) => void;
  resetError: () => void;
}

export type BlackjackHook = BlackjackState & BlackjackControls & {
  formattedBalance: string;
  dcmonBalance: bigint;
};

export const BLACKJACK_STORAGE_KEY = "blackjack:lastWager";
