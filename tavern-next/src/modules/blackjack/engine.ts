'use client';

export type Suit = "C" | "D" | "H" | "S";
export type Rank = "A" | "K" | "Q" | "J" | "T" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";
export type Card = `${Rank}${Suit}`;

export type Score = {
  hardTotal: number;
  softTotal: number;
  bestTotal: number;
  isSoft: boolean;
  isBlackjack: boolean;
  isBust: boolean;
};

const RANKS: Rank[] = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS: Suit[] = ["C", "D", "H", "S"];

export const DEFAULT_DECKS = 4;

type ShuffleFn = () => number;

function mulberry32(seed: number): ShuffleFn {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createShuffle(seed?: string | number): ShuffleFn {
  if (seed == null) return Math.random;
  let numericSeed: number;
  if (typeof seed === "number") {
    numericSeed = seed;
  } else {
    numericSeed = 0;
    for (let i = 0; i < seed.length; i += 1) {
      numericSeed = (numericSeed * 31 + seed.charCodeAt(i)) >>> 0;
    }
  }
  return mulberry32(numericSeed || Date.now());
}

export function createDeck(options: { decks?: number; seed?: string | number } = {}): Card[] {
  const { decks = 1, seed } = options;
  const deck: Card[] = [];
  for (let d = 0; d < Math.max(1, decks); d += 1) {
    for (const rank of RANKS) {
      for (const suit of SUITS) {
        deck.push(`${rank}${suit}`);
      }
    }
  }
  return shuffleDeck(deck, seed);
}

export function shuffleDeck(input: Card[], seed?: string | number): Card[] {
  const deck = [...input];
  const random = createShuffle(seed);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function drawCard(deck: Card[]): { card: Card; deck: Card[] } {
  if (deck.length === 0) {
    throw new Error("Deck is empty");
  }
  const [card, ...rest] = deck;
  return { card, deck: rest };
}

export function dealInitialHands(deck: Card[]): {
  deck: Card[];
  player: Card[];
  dealer: Card[];
} {
  let workingDeck = [...deck];
  const player: Card[] = [];
  const dealer: Card[] = [];

  for (let i = 0; i < 2; i += 1) {
    let draw = drawCard(workingDeck);
    player.push(draw.card);
    workingDeck = draw.deck;

    draw = drawCard(workingDeck);
    dealer.push(draw.card);
    workingDeck = draw.deck;
  }

  return { deck: workingDeck, player, dealer };
}

function cardValue(rank: Rank): number {
  switch (rank) {
    case "A":
      return 11;
    case "K":
    case "Q":
    case "J":
    case "T":
      return 10;
    default:
      return Number(rank);
  }
}

export function scoreHand(cards: Card[]): Score {
  let hard = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = card[0] as Rank;
    if (rank === "A") {
      aces += 1;
      hard += 1;
    } else {
      hard += cardValue(rank);
    }
  }

  let soft = hard;
  if (aces > 0 && soft + 10 <= 21) {
    soft += 10;
  }
  const bestTotal = soft <= 21 ? soft : hard;
  const isBlackjack = cards.length === 2 && bestTotal === 21;
  const isBust = hard > 21;
  const isSoft = !isBust && bestTotal !== hard;

  return {
    hardTotal: hard,
    softTotal: soft,
    bestTotal,
    isSoft,
    isBlackjack,
    isBust,
  };
}

export function isPair(cards: Card[]): boolean {
  if (cards.length !== 2) return false;
  const [first, second] = cards;
  return first[0] === second[0];
}

export function shouldDealerHit(hand: Card[]): boolean {
  const score = scoreHand(hand);
  if (score.bestTotal < 17) return true;
  if (score.bestTotal === 17 && score.isSoft) {
    // Hit soft 17 by default
    return true;
  }
  return false;
}

export type HandOutcome = "blackjack" | "win" | "push" | "lose" | "bust";

export function getOutcome(playerCards: Card[], dealerCards: Card[]): HandOutcome {
  const playerScore = scoreHand(playerCards);
  const dealerScore = scoreHand(dealerCards);

  if (playerScore.isBust) return "bust";
  if (dealerScore.isBust) return playerScore.isBlackjack ? "blackjack" : "win";

  if (playerScore.isBlackjack && !dealerScore.isBlackjack) return "blackjack";
  if (playerScore.bestTotal > dealerScore.bestTotal) return "win";
  if (playerScore.bestTotal === dealerScore.bestTotal) {
    if (playerScore.isBlackjack && dealerScore.isBlackjack) return "push";
    if (playerScore.isBlackjack) return "blackjack";
    return "push";
  }
  return "lose";
}
