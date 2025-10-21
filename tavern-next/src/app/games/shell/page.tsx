'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Contract, Interface, parseEther } from "ethers";
import { CONTRACTS } from "@/lib/config";
import { useWallet } from "@/context/WalletContext";
import { useBankroll } from "@/modules/bankroll";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";
import { ShellABI } from "@/abi/shell";

const MIN_BET = 0.001;
const SHELL_IMAGES = [
  "/assets/images/cup.png",
  "/assets/images/cup2.png",
  "/assets/images/cup.png",
] as const;

type ShellChoice = 0 | 1 | 2;

type HistoryEntry = {
  won: boolean;
  guess: ShellChoice;
  winningCup: ShellChoice;
  wager: string;
};

type StatusVariant = "win" | "loss" | null;

const shellInterface = new Interface(ShellABI);

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const nestedError = record.error;
    if (nestedError && typeof nestedError === "object" && "message" in nestedError) {
      const nestedMessage = (nestedError as Record<string, unknown>).message;
      if (typeof nestedMessage === "string") return nestedMessage;
    }
    const nestedData = record.data;
    if (nestedData && typeof nestedData === "object" && "message" in nestedData) {
      const nestedMessage = (nestedData as Record<string, unknown>).message;
      if (typeof nestedMessage === "string") return nestedMessage;
    }
    if (typeof record.reason === "string") return record.reason;
    if (typeof record.message === "string") return record.message;
  }
  return "Transaction failed.";
};

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
  const [statusVariant, setStatusVariant] = useState<StatusVariant>(null);
  const [choice, setChoice] = useState<ShellChoice>(1);
  const [revealedIndex, setRevealedIndex] = useState<ShellChoice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    try {
      const storedBet = localStorage.getItem("shell.bet");
      if (storedBet) {
        const clamped = clampBet(storedBet);
        setBet(clamped.toFixed(3));
      }
      const storedChoice = localStorage.getItem("shell.choice");
      if (storedChoice) {
        const parsed = Number(storedChoice);
        if (parsed >= 0 && parsed <= 2) {
          setChoice(parsed as ShellChoice);
        }
      }
    } catch {
      /* ignore storage issues */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("shell.bet", bet);
    } catch {
      /* ignore */
    }
  }, [bet]);

  useEffect(() => {
    try {
      localStorage.setItem("shell.choice", String(choice));
    } catch {
      /* ignore */
    }
  }, [choice]);

  const formattedBet = useMemo(() => {
    const num = Number(bet);
    return Number.isFinite(num) ? num.toFixed(3) : "0.000";
  }, [bet]);

  const ensureConnected = useCallback(async () => {
    if (address) return true;
    try {
      await connect();
      return true;
    } catch {
      return false;
    }
  }, [address, connect]);

  const play = useCallback(async () => {
    if (!provider) {
      setStatus("Connect wallet to play.");
      return;
    }
    if (!(await ensureConnected())) {
      setStatus("Wallet connection failed. Try again.");
      return;
    }

    const wagerValue = clampBet(bet);
    setBet(wagerValue.toFixed(3));

    let betWei: bigint;
    try {
      betWei = parseEther(wagerValue.toString());
    } catch {
      setStatus("Invalid bet amount.");
      return;
    }

    const signer = await provider.getSigner();
    const contract = new Contract(CONTRACTS.shell, ShellABI, signer);

    setIsSubmitting(true);
    setStatus("Checking bankroll...");
    setStatusVariant(null);
    setRevealedIndex(null);

    try {
      const enough = await hasDcmonBalance(betWei);
      if (!enough) {
        setStatus("Insufficient DCMon balance for this bet.");
        return;
      }

      const approved = await ensureAllowance(CONTRACTS.shell, betWei, {
        onProgress: setStatus,
      });
      if (!approved) {
        setStatus("DCMon approval declined.");
        return;
      }

      setStatus("Submitting wager...");
      const data = shellInterface.encodeFunctionData("playShell", [choice, betWei]);

      let receipt: Awaited<ReturnType<typeof provider.waitForTransaction>> | null = null;
      try {
        const userOpHash = await delegation.sendTransaction({
          to: CONTRACTS.shell,
          data,
        });
        if (userOpHash) {
          setStatus("Waiting for confirmation...");
          receipt = await provider.waitForTransaction(userOpHash);
        }
      } catch (aaErr) {
        console.warn("[shell] AA send failed", aaErr);
      }

      if (!receipt) {
        const tx = await contract.playShell(choice, betWei, { gasLimit: 250_000 });
        setStatus("Waiting for confirmation...");
        receipt = await tx.wait();
      }

      if (!receipt) {
        setStatus("Transaction sent. Awaiting confirmation...");
        return;
      }

      let won = false;
      let winningCup: ShellChoice | null = null;
      let guess: ShellChoice | null = null;

      for (const log of receipt.logs ?? []) {
        try {
          const parsed = shellInterface.parseLog(log);
          if (parsed.name === "ShellPlayed") {
            const winCup = Number(parsed.args?.winningCup ?? parsed.args?.[4]);
            const guessed = Number(parsed.args?.guess ?? parsed.args?.[5]);
            winningCup = (winCup >= 0 && winCup <= 2 ? winCup : choice) as ShellChoice;
            guess = (guessed >= 0 && guessed <= 2 ? guessed : choice) as ShellChoice;
            won = Boolean(parsed.args?.won ?? parsed.args?.[3]);
            break;
          }
        } catch {
          /* ignore parse errors */
        }
      }

      if (winningCup == null) {
        setStatus("Confirmed on-chain. Check explorer for final result.");
        return;
      }

      setRevealedIndex(winningCup);
      const message = won
        ? `You won! Cup ${winningCup + 1} hid the prize.`
        : `House wins. Cup ${winningCup + 1} held the prize.`;
      setStatus(message);
      setStatusVariant(won ? "win" : "loss");
      setHistory((prev) => [
        {
          won,
          guess: (guess ?? choice) as ShellChoice,
          winningCup,
          wager: wagerValue.toFixed(3),
        },
        ...prev,
      ].slice(0, 5));
    } catch (error) {
      console.error("[shell] play failed", error);
      setStatus(extractErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    provider,
    ensureConnected,
    bet,
    choice,
    hasDcmonBalance,
    ensureAllowance,
    delegation,
  ]);

  return (
    <main className="tavern game" style={{ minHeight: "100vh" }}>
      <div className="game-header">
        <Image
          className="game-logo"
          src="/assets/images/shell-game-logo.png"
          alt="Shell Game"
          width={260}
          height={120}
          priority
        />
        <Link href="/" id="return" className="rules-btn">
          Return to Tavern
        </Link>
      </div>

      <div className="coin-wrap">
        <div
          id="shell-result"
          className={`shell-status${statusVariant ? ` ${statusVariant}` : ""}`}
          aria-live="polite"
        >
          {status}
        </div>

        <div className="shell-grid" role="group" aria-label="Choose a shell">
          {(SHELL_IMAGES as ReadonlyArray<string>).map((src, idx) => {
            const shellIndex = idx as ShellChoice;
            const isActive = choice === shellIndex;
            const isRevealed = revealedIndex === shellIndex;
            return (
              <button
                key={src}
                type="button"
                className={isActive ? "shell active" : "shell"}
                onClick={() => setChoice(shellIndex)}
                disabled={isSubmitting}
                aria-pressed={isActive}
              >
                <Image
                  src={src}
                  alt={`Shell ${idx + 1}`}
                  width={220}
                  height={220}
                  className={isRevealed ? "revealed" : undefined}
                  priority={idx === 1}
                />
              </button>
            );
          })}
        </div>

        <div className="bet-wrap">
          <label htmlFor="bet">Bet (DCMon)</label>
          <input
            id="bet"
            type="number"
            min={MIN_BET}
            step="0.001"
            value={formattedBet}
            onChange={(event) => setBet(event.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <button id="flip" type="button" onClick={play} disabled={isSubmitting}>
          {isSubmitting ? "Shuffling..." : "Reveal Shell"}
        </button>

        {!address && (
          <button
            id="connect-wallet"
            type="button"
            onClick={connect}
            disabled={isConnecting || isSubmitting}
            style={{ marginTop: "12px" }}
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}

        {history.length > 0 && (
          <div className="hazard-history">
            <h3>Recent Plays</h3>
            <ul>
              {history.map((entry, idx) => (
                <li key={`${entry.guess}-${idx}`}>
                  <span>{entry.won ? "Win" : "Loss"}</span>
                  <span>Guess: {entry.guess + 1}</span>
                  <span>Winning Cup: {entry.winningCup + 1}</span>
                  <span>Bet: {entry.wager} DCMon</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
