'use client';

import Link from "next/link";
import Image from "next/image";
import { useWallet } from "@/context/WalletContext";

export default function BlackjackPage() {
  const { address, connect, isConnecting } = useWallet();

  return (
    <main className="tavern game" style={{ minHeight: "100vh" }}>
      <div className="game-header">
        <Image
          className="game-logo"
          src="/assets/images/games-table.png"
          alt="Blackjack"
          width={260}
          height={120}
        />
        <Link href="/" className="rules-btn">
          Return to Tavern
        </Link>
      </div>

      <div className="hazard-wrap" style={{ textAlign: "center" }}>
        <h2>Blackjack is coming soon!</h2>
        <p>
          We&apos;re shuffling the decks to bring multiplayer Blackjack to the Tavern.
          Stay tuned for the upcoming release.
        </p>
        {!address && (
          <button
            type="button"
            onClick={connect}
            disabled={isConnecting}
            className="connect-btn"
            style={{ alignSelf: "center" }}
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </div>
    </main>
  );
}
