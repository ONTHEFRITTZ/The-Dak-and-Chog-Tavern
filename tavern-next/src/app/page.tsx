'use client';

import Image from "next/image";
import Link from "next/link";
import { AgeGate } from "@/components/AgeGate";
import { usePageBackdrop } from "@/hooks/usePageBackdrop";

const games = [
  {
    title: "Shell Game",
    href: "/games/shell",
    asset: "/assets/images/shell-game-logo.png",
    width: 320,
    height: 150,
  },
  {
    title: "Hazard",
    href: "/games/hazard",
    asset: "/assets/images/hazard-logo.png",
    width: 420,
    height: 240,
  },
  {
    title: "Blackjack",
    href: "/games/blackjack/lobby",
    asset: "/assets/images/blackjack-logo.png",
    width: 320,
    height: 150,
  },
  {
    title: "Poker (Texas Hold'em)",
    href: "/games/poker",
    asset: "/assets/images/texas-holdem-logo.png",
    width: 320,
    height: 150,
  },
  {
    title: "Dak & Chog",
    href: "/games/dakchog",
    asset: "/assets/images/dakandchog-logo.png",
    width: 320,
    height: 150,
  },
];

export default function HomePage() {
  usePageBackdrop("tavern");

  return (
    <main>
      <AgeGate />
      <h1 className="visually-hidden">The Dak &amp; Chog Tavern</h1>
      <div className="hero">
        <Image
          src="/assets/images/sign.png"
          alt="The Dak and Chog Tavern"
          width={540}
          height={220}
          style={{ width: "min(320px, 60vw)", height: "auto" }}
          priority
          unoptimized
        />

        <section>
          <h2>Choose Your Game!</h2>

          <div className="game-logos">
            {games.map((game) => (
              <Link key={game.title} className="game-logo-link" href={game.href}>
                <Image
                  src={game.asset}
                  alt={game.title}
                  width={game.width}
                  height={game.height}
                  sizes="(max-width: 600px) 50vw, 200px"
                />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
