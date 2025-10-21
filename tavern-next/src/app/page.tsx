import Image from "next/image";
import Link from "next/link";

const games = [
  {
    title: "Shell Game",
    href: "/games/shell",
    asset: "/assets/images/shell-game-logo.png",
  },
  {
    title: "Hazard",
    href: "/games/hazard",
    asset: "/assets/images/hazard-logo.png",
  },
  {
    title: "Blackjack",
    href: "/games/blackjack",
    asset: "/assets/images/blackjack-logo.png",
  },
  {
    title: "Poker (Texas Hold'em)",
    href: "/games/poker",
    asset: "/assets/images/texas-holdem-logo.png",
  },
  {
    title: "Dak & Chog",
    href: "/games/dakchog",
    asset: "/assets/images/dakandchog-logo.png",
  },
];

export default function HomePage() {
  return (
    <main>
      <h1 className="visually-hidden">The Dak &amp; Chog Tavern</h1>
      <div className="hero">
        <Image
          src="/assets/images/sign.png"
          alt="The Dak and Chog Tavern"
          width={540}
          height={220}
          style={{ width: "min(320px, 60vw)", height: "auto" }}
          priority
        />

        <section>
          <h2>Choose Your Game!</h2>

          <div className="game-logos">
            {games.map((game) => (
              <Link
                key={game.title}
                className="game-logo-link"
                href={game.href}
              >
                <Image
                  src={game.asset}
                  alt={game.title}
                  width={260}
                  height={160}
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
