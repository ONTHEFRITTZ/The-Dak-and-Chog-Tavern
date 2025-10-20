'use client';

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { Contract, Interface, parseEther } from "ethers";
import { DakChogABI } from "@/abi/dakChog";
import { CONTRACTS } from "@/lib/config";
import { useWallet } from "@/context/WalletContext";
import { useLegacyAAOps } from "@/hooks/useLegacyAAOps";

const MIN_BET = 0.001;
const IMG_DAK = "/assets/images/coin-dak.png";
const IMG_CHOG = "/assets/images/coin-chog.png";

type CoinSide = "dak" | "chog";

const clampBet = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_BET) return MIN_BET;
  return Math.floor(parsed * 1000 + 1e-9) / 1000;
};

export default function DakChogPage() {
  const { address, provider, connect, isConnecting } = useWallet();
  const { ops: legacyAAOps } = useLegacyAAOps();
  const [bet, setBet] = useState(() => clampBet(String(MIN_BET)).toFixed(3));
  const [choice, setChoice] = useState<CoinSide>("dak");
  const [coinFace, setCoinFace] = useState<CoinSide>("dak");
  const [status, setStatus] = useState("Flip the coin to begin!");
  const [isFlipping, setIsFlipping] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const coinRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = coinRef.current;
    if (!el) return;
    el.style.backgroundImage = `url(${coinFace === "chog" ? IMG_CHOG : IMG_DAK})`;
  }, [coinFace]);

  const formattedBet = useMemo(() => {
    const num = Number(bet);
    return Number.isFinite(num) ? num.toFixed(3) : "0.000";
  }, [bet]);

  const handleChoice = (side: CoinSide) => {
    setChoice(side);
    setCoinFace(side);
  };

  const ensureConnected = async () => {
    if (address) return true;
    try {
      await connect();
      return true;
    } catch {
      return false;
    }
  };

  const playCoin = async () => {
    if (!provider) {
      setStatus("Connect wallet to play.");
      return;
    }
    const ok = await ensureConnected();
    if (!ok) {
      setStatus("Wallet connection failed. Try again.");
      return;
    }

    const wager = clampBet(bet);
    setBet(wager.toFixed(3));

    let betWei;
    try {
      betWei = parseEther(wager.toString());
    } catch {
      setStatus("Invalid bet amount.");
      return;
    }

    const signer = await provider.getSigner();
    const target = CONTRACTS.dakchog;
    const contract = new Contract(target, DakChogABI, signer);
    const face = choice === "chog";

    setIsFlipping(true);
    setIsSubmitting(true);
    setStatus("Submitting transaction...");
    coinRef.current?.classList.add("spin");

    try {
      let receipt: any = null;
      if (
        legacyAAOps &&
        typeof legacyAAOps.encodeFromSignature === "function" &&
        typeof legacyAAOps.sendTxViaAA === "function"
      ) {
        try {
          const data = legacyAAOps.encodeFromSignature("playCoin(bool,uint256)", [
            face,
            betWei,
          ]);
          if (data) {
            const txHash = await legacyAAOps.sendTxViaAA({ to: target, data });
            if (txHash) {
              setStatus(
                `Tx sent: ${String(txHash).slice(
                  0,
                  10
                )}... waiting confirmation...`
              );
              receipt = await provider.waitForTransaction(txHash);
            }
          }
        } catch (err) {
          console.warn("[dakchog] AA send failed", err);
        }
      }

      if (!receipt) {
        if (window.FORCE_GASLESS) {
          setStatus("Gasless send unavailable. Try again.");
          return;
        }
        const tx = await contract.playCoin(face, betWei);
        setStatus(
          `Tx sent: ${tx.hash.slice(0, 10)}... waiting confirmation...`
        );
        receipt = await tx.wait();
      }

      if (!receipt) {
        setStatus("Transaction sent. Check explorer for result.");
        return;
      }

      const iface = new Interface(DakChogABI as any);
      let parsed: ReturnType<Interface["parseLog"]> | null = null;
      for (const log of receipt.logs) {
        try {
          const descr = iface.parseLog(log);
          if (descr.name === "CoinPlayed") {
            parsed = descr;
            break;
          }
        } catch {
          continue;
        }
      }

      coinRef.current?.classList.remove("spin");
      setIsFlipping(false);
      if (parsed) {
        const resultChog = Boolean(parsed.args?.resultChog);
        const won = Boolean(parsed.args?.won);
        setCoinFace(resultChog ? "chog" : "dak");
        coinRef.current?.classList.add("flip");
        setTimeout(() => coinRef.current?.classList.remove("flip"), 900);
        setStatus(
          won
            ? `On-chain: ${resultChog ? "CHOG" : "DAK"} - you won!`
            : `On-chain: ${resultChog ? "CHOG" : "DAK"} - you lost.`
        );
      } else {
        setCoinFace(choice);
        setStatus("Confirmed. Check wallet or explorer for result.");
      }
    } catch (err: any) {
      console.error(err);
      const msg =
        err?.error?.message ||
        err?.data?.message ||
        err?.reason ||
        err?.message ||
        "Transaction failed.";
      setStatus(msg);
    } finally {
      coinRef.current?.classList.remove("spin");
      setIsFlipping(false);
      setIsSubmitting(false);
    }
  };

  return (
    <main className="tavern game" style={{ minHeight: "100vh" }}>
      <div className="game-header">
        <Image
          className="game-logo"
          src="/assets/images/dakandchog-logo.png"
          alt="Dak & Chog"
          width={280}
          height={120}
          priority
        />
        <Link href="/" id="return" className="rules-btn">
          Return to Tavern
        </Link>
      </div>

      <div className="coin-wrap">
        <div
          id="coin"
          ref={coinRef}
          className={`coin ${isFlipping ? "spin" : ""}`}
          aria-live="polite"
        />

        <div className="choose-wrap">
          <button
            id="choose-dak"
            className={choice === "dak" ? "active" : ""}
            onClick={() => handleChoice("dak")}
            type="button"
          >
            Dak
          </button>
          <button
            id="choose-chog"
            className={choice === "chog" ? "active" : ""}
            onClick={() => handleChoice("chog")}
            type="button"
          >
            Chog
          </button>
        </div>

        <div className="bet-wrap">
          <label htmlFor="bet">Bet (DCMon)</label>
          <input
            id="bet"
            type="number"
            min={MIN_BET}
            step="0.001"
            value={formattedBet}
            onChange={(e) => setBet(e.target.value)}
          />
        </div>

        <button
          id="flip"
          type="button"
          onClick={playCoin}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Flipping..." : "Flip Coin"}
        </button>

        <p id="dc-status">{status}</p>

        {!address && (
          <button
            id="connect-wallet"
            type="button"
            onClick={connect}
            disabled={isConnecting}
            style={{ marginTop: "12px" }}
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </div>

      <section
        id="rules-overlay"
        style={{ display: "none" }}
        aria-hidden="true"
      />
    </main>
  );
}
