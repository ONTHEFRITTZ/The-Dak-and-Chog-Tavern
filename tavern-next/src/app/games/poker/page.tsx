'use client';

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRealtimePokerLobby } from "@/hooks/useRealtimePokerLobby";
import { useWallet } from "@/context/WalletContext";
import { usePageBackdrop } from "@/hooks/usePageBackdrop";

type LobbySectionKey = "limit" | "noLimit" | "freePlay";

type LobbySection = {
  key: LobbySectionKey;
  title: string;
  hint: string;
  tables: ReturnType<typeof useRealtimePokerLobby>["tables"];
};

const MIN_BUYIN_FALLBACK = "6 DCMon";

function formatOccupancy(current: number, capacity: number) {
  return `${Math.max(0, current)}/${Math.max(1, capacity)}`;
}

function resolveMinBuy(meta?: { minBuy?: { amount?: string; unit?: string } } | null) {
  if (!meta?.minBuy?.amount) return MIN_BUYIN_FALLBACK;
  const unit = meta.minBuy.unit ?? "DCMon";
  return `${meta.minBuy.amount} ${unit}`;
}

function resolveBlinds(meta?: { blinds?: { sb?: string; bb?: string } } | null) {
  if (!meta?.blinds) return null;
  const sb = meta.blinds.sb ?? "-";
  const bb = meta.blinds.bb ?? "-";
  return `${sb} / ${bb}`;
}

function shortAddress(addr: string | null | undefined) {
  if (!addr) return "-";
  const value = addr.toLowerCase();
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function categorizeTables(
  tables: ReturnType<typeof useRealtimePokerLobby>["tables"]
): Record<LobbySectionKey, ReturnType<typeof useRealtimePokerLobby>["tables"]> {
  const buckets: Record<LobbySectionKey, ReturnType<typeof useRealtimePokerLobby>["tables"]> = {
    limit: [],
    noLimit: [],
    freePlay: [],
  };

  for (const table of tables) {
    if (table.tableMode === "f2p" || table.simulated) {
      buckets.freePlay.push(table);
      continue;
    }
    const limitCode = table.limit?.toUpperCase();
    const typeKey = table.meta?.typeKey?.toLowerCase();
    if (limitCode === "FL" || typeKey === "onchain-fl") {
      buckets.limit.push(table);
      continue;
    }
    buckets.noLimit.push(table);
  }
  return buckets;
}

export default function PokerLobbyPage() {
  usePageBackdrop("poker-floor");

  const { address, connect, disconnect, isConnecting } = useWallet();
  const lobby = useRealtimePokerLobby();

  useEffect(() => {
    lobby.identify(address);
  }, [address, lobby]);

  const sections: LobbySection[] = useMemo(() => {
    const grouped = categorizeTables(lobby.tables);
    return [
      {
        key: "limit",
        title: "Texas Holdem - Limit (3 DCMon / 6 DCMon)",
        hint:
          grouped.limit.length > 0
            ? "Fixed-limit DCMon with delegated AA rake settlement."
            : "Setting up tables...",
        tables: grouped.limit,
      },
      {
        key: "noLimit",
        title: "Texas Holdem - No-Limit",
        hint:
          grouped.noLimit.length > 0
            ? "Bring DCMon, sit down, and play with AA-backed buy-in."
            : "Waiting for dealers...",
        tables: grouped.noLimit,
      },
      {
        key: "freePlay",
        title: "Free to Play",
        hint:
          grouped.freePlay.length > 0
            ? "Simulated chips, zero DCMon required."
            : "Spinning up practice tables...",
        tables: grouped.freePlay,
      },
    ];
  }, [lobby.tables]);

  return (
    <main className="game poker-lobby">
      <div className="lobby-hero">
        <Image
          src="/assets/images/texas-holdem-logo.png"
          alt="Dak & Chog Poker"
          width={360}
          height={180}
          priority
        />
        <div className="wallet-chip">
          <span>{shortAddress(address)}</span>
          {address ? (
            <button type="button" onClick={disconnect}>
              Disconnect
            </button>
          ) : (
            <button type="button" onClick={() => connect().catch(() => void 0)} disabled={isConnecting}>
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>

      <div className="lobby-wrap">
        <div className="lobby-header">
          <h1>Poker Lobby</h1>
          <div className="lobby-actions">
                        {lobby.status && <span className="lobby-status">{lobby.status}</span>}
            {lobby.error && <span className="lobby-error">{lobby.error}</span>}
          </div>
        </div>

        {sections.map((section) => (
          <section key={section.key} className="lobby-card">
            <header className="section-head">
              <h2>{section.title}</h2>
              <span className="muted">{section.hint}</span>
            </header>

            <div className="lobby-list">
              {section.tables.length === 0 && (
                <div className="lobby-empty muted">No active tables yet. Check back soon.</div>
              )}

              {section.tables.map((table) => {
                const occupancy = formatOccupancy(table.seated, table.capacity);
                const minBuy = resolveMinBuy(table.meta);
                const blinds = resolveBlinds(table.meta);
                const href = `/games/poker/table/${encodeURIComponent(table.id)}`;

                return (
                  <article key={table.id} className="lobby-item">
                    <div className="lobby-item-body">
                      <strong>{table.id}</strong>
                      <div className="lobby-tags">
                        <span className="pill">{occupancy} seated</span>
                        {table.started && <span className="pill">Hand in progress</span>}
                        {table.tableMode === "onchain" && !table.dealerSigner && (
                          <span className="pill warning">Dealer offline</span>
                        )}
                      </div>
                      {table.stakes && (
                        <p className="muted">
                          Stakes: <span className="highlight">{table.stakes}</span>
                        </p>
                      )}
                      {blinds && (
                        <p className="muted">
                          Blinds: <span className="highlight">{blinds}</span>
                        </p>
                      )}
                      <p className="muted">
                        Minimum buy-in: <span className="highlight">{minBuy}</span>
                      </p>
                    </div>
                    <div className="lobby-item-cta">
                      <Link href={href} className="lobby-cta">
                        Enter Table
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>

            {section.key === "freePlay" && (
              <p className="muted section-footnote">Free to play tables use simulated chips.</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
