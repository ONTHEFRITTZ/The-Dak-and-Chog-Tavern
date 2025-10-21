'use client';

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Game Rules – The Dak & Chog Tavern",
};

const sections = [
  {
    id: "poker",
    title: "Poker (No-Limit Texas Hold'em)",
    bullets: [
      "Seats: Up to 8 players. Dealer button rotates clockwise each hand.",
      "Blinds: Small blind (SB) and big blind (BB) auto-post to the two seats left of the button.",
      "Deal: Each active player receives two private hole cards.",
      "Betting rounds: Preflop → Flop (three community cards) → Turn (one) → River (one).",
      "Actions: Fold, check, call, bet/raise (min bet = big blind, min raise = previous raise size). All-in and side pots supported.",
      "Showdown: Best five-card hand using any combination of hole/community cards wins. Ties split the pot.",
      "Hand ranking (high → low): Royal flush, straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, one pair, high card.",
      "Timing: Expired action timers auto-check or auto-fold depending on the state.",
      "Buy-in/cash-out: Uses DCMon. Approvals wrap/unwrap MON as needed.",
      "Rake: Displayed in-game when applicable.",
    ],
  },
  {
    id: "hazard",
    title: "Hazard (Dice)",
    bullets: [
      "Choose a main between 5–9 (default is 7).",
      "Come-out roll outcomes: main = win; 2/3 = loss; 11/12 = win if main 5 or 9, loss if main 7, otherwise loss.",
      "If the roll is 4,5,6,8,9,10 it becomes the point. Continue rolling: hit the point before the main to win; roll the main first to lose.",
      "All wagers pay even money and settle on the same sequence of rolls.",
    ],
  },
  {
    id: "shell",
    title: "Shell Game",
    bullets: [
      "Three shells, one hidden token. Pick a shell; the contract reveals the result.",
      "Correct guesses pay 2× (stake returned plus winnings), capped by bankroll limits.",
    ],
  },
  {
    id: "dakchog",
    title: "Dak & Chog (Coin Flip)",
    bullets: [
      "Pick Dak or Chog, then place a wager.",
      "Correct call pays 2× (stake returned plus winnings), capped by bankroll limits.",
    ],
  },
];

export default function RulesPage() {
  return (
    <main className="rules-page">
      <div className="rules-card">
        <h1>Game Rules</h1>
        <nav aria-label="Rule sections">
          <ul>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ul>
        </nav>

        {sections.map((section) => (
          <section key={section.id} id={section.id}>
            <h2>{section.title}</h2>
            <ul>
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
