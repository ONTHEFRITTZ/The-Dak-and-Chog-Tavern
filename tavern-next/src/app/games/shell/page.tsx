'use client';

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Contract, Interface, parseEther } from "ethers";
import { CONTRACTS } from "@/lib/config";
import { useWallet } from "@/context/WalletContext";
import { useBankroll } from "@/modules/bankroll";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";
import { DakChogABI } from "@/abi/dakChog";

const MIN_BET = 0.001;
const BALL_IMAGES = [
  "/assets/images/shell/ball-left.png",
  "/assets/images/shell/ball-center.png",
  "/assets/images/shell/ball-right.png",
];

type ShellChoice = 0 | 1 | 2;

const clampBet = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_BET) return MIN_BET;
  return Math.floor(parsed * 1000 + 1e-9) / 1000;
};

export default function ShellGamePage() {
  const { address, provider, connect, isConnecting } = useWallet();
  const delegation = useDelegationToolkitAA();
  const { hasDcmonBalance, ensureAllowance } = useBankroll();

  const [bet, setBet] = useState(() => clampBet(String(MIN_BET)).toFixed(3));
  const [status, setStatus] = useState("Pick a shell and place your bet!");
  const [choice, setChoice] = useState<ShellChoice>(1);
  const [revealedIndex, setRevealedIndex] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formattedBet = useMemo(() => {
    const num = Number(bet);
    return Number.isFinite(num) ? num.toFixed(3) : "0.000";
  }, [bet]);

  const ensureConnected = async () => {
    if (address) return true;
    try {
      await connect();
      return true;
    } catch {
      return false;
    }
  };

  const play = async () => {
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

    try {
      setIsSubmitting(true);
      setStatus("Preparing wager...");
      setRevealedIndex(null);

      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACTS.shell, DakChogABI, signer);

      const enough = await hasDcmonBalance(betWei);
      if (!enough) {
        setStatus("Insufficient DCMon balance for this bet.");
        setIsSubmitting(false);
        return;
      }

      const approved = await ensureAllowance(CONTRACTS.shell, betWei, {
        onProgress: setStatus,
      });
      if (!approved) {
        setIsSubmitting(false);
        return;
      }

      setStatus("Submitting wager...");

      let receipt: any = null;
      const data = contract.interface.encodeFunctionData("playCoin", [choice === 1, betWei]);

      try {
        const hash = await delegation.sendTransaction({
          to: CONTRACTS.shell,
          data,
        });
        if (hash) {
          setStatus(`Tx sent: ${String(hash).slice(0, 10)}... waiting confirmation...`);
          receipt = await provider.waitForTransaction(hash);
        }
      } catch (err) {
        console.warn("[shell] AA send failed", err);
      }

      if (!receipt) {
        if ((window as any)?.FORCE_GASLESS) {
          setStatus("Gasless send unavailable. Try again.");
          setIsSubmitting(false);
          return;
        }
        const tx = await contract.playCoin(choice === 1, betWei, { gasLimit: 300000 });
        setStatus("Tx sent: waiting confirmation...");
        receipt = await tx.wait();
      }

      setStatus("Revealing shells...");

      if (!receipt) {
        setStatus("Transaction sent. Check explorer for result.");
        setIsSubmitting(false);
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

      if (parsed) {
        const resultChog = Boolean(parsed.args?.resultChog);
        const won = Boolean(parsed.args?.won);
        const index = resultChog ? 1 : choice === 1 ? 0 : 2;
        setRevealedIndex(index);
        setStatus(won ? "You found Keddle! You won!" : "The shell was empty. Better luck next time.");
      } else {
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
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    setRevealedIndex(null);
  }, [choice]);

  return (
    <main className="tavern game" style={{ minHeight: "100vh" }}>
      <div className="game-header">
        <Image
          className="game-logo"
          src="/assets/images/shell-game-logo.png"
          alt="Shell Game"
          width={260}
          height={120}
        />
        <Link href="/" id="return" className="rules-btn">
          Return to Tavern
        </Link>
      </div>

      <div className="coin-wrap">
        <div className="shell-grid">
          {[0, 1, 2].map((idx) => (
            <button
              key={idx}
              className={shell }
              onClick={() => setChoice(idx as ShellChoice)}
              type="button"
              disabled={isSubmitting}
            >
              <Image
                src={BALL_IMAGES[idx]}
                alt={Shell }
                width={120}
                height={120}
                className={revealedIndex === idx ? "revealed" : ""}
              />
            </button>
          ))}
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
            disabled={isSubmitting}
          />
        </div>

        <button id="flip" type="button" onClick={play} disabled={isSubmitting}>
          {isSubmitting ? "Shuffling..." : "Reveal Shell"}
        </button>

        <p id="shell-result">{status}</p>

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
    </main>
  );
}
