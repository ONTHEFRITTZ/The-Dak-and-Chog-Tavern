'use client';

import Link from "next/link";
import { useMemo } from "react";
import { usePageBackdrop } from "@/hooks/usePageBackdrop";

type BlackjackMode = "onchain" | "f2p";

type BlackjackLobbyTable = {
  id: string;
  title: string;
  description: string;
  minBet?: string;
  maxBet?: string;
  mode: BlackjackMode;
  href: string;
  tags: string[];
};

type BlackjackLobbySection = {
  key: BlackjackMode;
  title: string;
  hint: string;
  tables: BlackjackLobbyTable[];
  footnote?: string;
};

const ONCHAIN_TABLES: BlackjackLobbyTable[] = [
  {
    id: "blackjack-onchain-1",
    title: "Dak & Chog Blackjack",
    description: "Play for DCMon with sponsored smart-account transactions.",
    minBet: "0.10 DCMon",
    maxBet: "10 DCMon",
    mode: "onchain",
    href: "/games/blackjack?mode=onchain",
    tags: ["1 seat", "House dealer", "AA enabled"],
  },
];

const F2P_TABLES: BlackjackLobbyTable[] = [
  {
    id: "blackjack-f2p-1",
    title: "Practice Table",
    description: "Free-to-play blackjack with simulated chips.",
    minBet: "Free play",
    mode: "f2p",
    href: "/games/blackjack?mode=f2p",
    tags: ["1 seat", "Simulated stack"],
  },
];

export default function BlackjackLobbyPage() {
  usePageBackdrop("blackjack");

  const sections: BlackjackLobbySection[] = useMemo(
    () => [
      {
        key: "onchain",
        title: "On-Chain Blackjack",
        hint: "Stake DCMon, clear wagers with smart accounts, and take on the house.",
        tables: ONCHAIN_TABLES,
      },
      {
        key: "f2p",
        title: "Free to Play",
        hint: "Practice without DCMon - perfect for learning the table flow.",
        tables: F2P_TABLES,
        footnote: "Free to play tables use simulated chips and do not require a wallet.",
      },
    ],
    []
  );

  return (
    <main className="game poker-lobby blackjack-lobby">
      <div className="lobby-wrap">
        {sections.map((section) => (
          <section key={section.key} className="lobby-card">
            <header className="section-head">
              <h2>{section.title}</h2>
              <span className="muted">{section.hint}</span>
            </header>

            <div className="lobby-list">
              {section.tables.length === 0 && (
                <div className="lobby-empty muted">No tables available yet. Check back soon.</div>
              )}

              {section.tables.map((table) => (
                <article key={table.id} className="lobby-item">
                  <div className="lobby-item-body">
                    <strong>{table.title}</strong>
                    <div className="lobby-tags">
                      {table.tags.map((tag) => (
                        <span key={tag} className="pill">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="muted">{table.description}</p>
                    {table.minBet && (
                      <p className="muted">
                        Minimum bet: <span className="highlight">{table.minBet}</span>
                      </p>
                    )}
                    {table.maxBet && (
                      <p className="muted">
                        Maximum bet: <span className="highlight">{table.maxBet}</span>
                      </p>
                    )}
                  </div>
                  <div className="lobby-item-cta">
                    <Link href={table.href} className="lobby-cta">
                      Enter Table
                    </Link>
                  </div>
                </article>
              ))}
            </div>

            {section.footnote && (
              <p className="muted section-footnote">{section.footnote}</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}

