'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Contract, Interface, parseEther } from "ethers";
import { useWallet } from "@/context/WalletContext";
import { useBankroll } from "@/modules/bankroll";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";
import { CONTRACTS } from "@/lib/config";
import { HazardABI } from "@/abi/hazard";
import { usePageBackdrop } from "@/hooks/usePageBackdrop";

const MIN_BET = 0.001;
const MAIN_CHOICES = [5, 6, 7, 8, 9] as const;
type MainChoice = (typeof MAIN_CHOICES)[number];

const hazardInterface = new Interface(HazardABI);

type HistoryEntry = {
  win: boolean;
  sum: number;
  main: number;
  wager: string;
};

const isMainChoice = (value: number): value is MainChoice => {
  return MAIN_CHOICES.includes(value as MainChoice);
};

function clampBet(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_BET) return MIN_BET;
  return Math.floor(parsed * 1000 + 1e-9) / 1000;
}

function deriveDicePair(sum: number): [number, number] {
  if (!Number.isFinite(sum) || sum < 2 || sum > 12) return [3, 4];
  for (let first = Math.min(6, sum - 1); first >= 1; first--) {
    const second = sum - first;
    if (second >= 1 && second <= 6) {
      return [first, second];
    }
  }
  return [3, 4];
}

function explainOutcome(main: number, finalSum: number, chance: number, win: boolean) {
  if (!Number.isFinite(finalSum)) {
    return win ? "WIN: You beat the house." : "LOSS: Dealer wins this round.";
  }

  const prefix = win ? "WIN" : "LOSS";

  if (chance === 0) {
    if (finalSum === main) return `${prefix}: Rolled your main (${finalSum}).`;
    if (main === 7 && (finalSum === 5 || finalSum === 9)) {
      return win
        ? `${prefix}: Rolled ${finalSum}. Special win on main 7.`
        : `${prefix}: Rolled ${finalSum}. House edge on main 7.`;
    }
    return `${prefix}: Rolled ${finalSum}.`;
  }

  if (win) return `${prefix}: Hit point ${finalSum} before main ${main}.`;
  if (finalSum === main) return `${prefix}: Rolled main ${main} before point ${chance}.`;
  return `${prefix}: Rolled ${finalSum}.`;
}

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

const diceImage = (face: number) => `/assets/images/dice/standard/dice${face}.png`;

export default function HazardPage() {
  usePageBackdrop("hazard");

  const { address, provider, connect, isConnecting } = useWallet();
  const delegation = useDelegationToolkitAA();
  const { hasDcmonBalance, ensureAllowance } = useBankroll();

  const [bet, setBet] = useState(() => clampBet(String(MIN_BET)).toFixed(3));
  const [selectedMain, setSelectedMain] = useState<MainChoice>(() => MAIN_CHOICES[2]);
  const [status, setStatus] = useState("Pick a main and roll the dice!");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [diceFaces, setDiceFaces] = useState<[number, number]>([3, 4]);
  const [rolling, setRolling] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    try {
      const storedBet = localStorage.getItem("hazard.bet");
      if (storedBet) {
        const clamped = clampBet(storedBet);
        setBet(clamped.toFixed(3));
      }
      const storedMain = localStorage.getItem("hazard.main");
      if (storedMain) {
        const parsed = Number(storedMain);
        if (isMainChoice(parsed)) {
          setSelectedMain(parsed);
        }
      }
    } catch {
      /* ignore storage issues */
    }
  }, []);

  useEffect(() => {
    if (!rolling) return;
    const interval = setInterval(() => {
      setDiceFaces([
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
      ]);
    }, 120);
    return () => clearInterval(interval);
  }, [rolling]);

  useEffect(() => {
    try {
      localStorage.setItem("hazard.bet", bet);
    } catch {
      /* ignore */
    }
  }, [bet]);

  useEffect(() => {
    try {
      localStorage.setItem("hazard.main", String(selectedMain));
    } catch {
      /* ignore */
    }
  }, [selectedMain]);

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

  const hazardAddress = CONTRACTS.hazard;

  const handleRoll = useCallback(async () => {
    if (!provider) {
      setStatus("Connect wallet to play.");
      return;
    }
    if (!(await ensureConnected())) {
      setStatus("Wallet connection failed. Try again.");
      return;
    }

    const betValue = clampBet(bet);
    setBet(betValue.toFixed(3));

    if (!MAIN_CHOICES.includes(selectedMain)) {
      setStatus("Choose a main between 5 and 9.");
      return;
    }

    let wager: bigint;
    try {
      wager = parseEther(betValue.toString());
    } catch {
      setStatus("Invalid bet amount.");
      return;
    }

    const signer = await provider.getSigner();
    const contract = new Contract(hazardAddress, HazardABI, signer);

    setIsSubmitting(true);
    setRolling(true);
    setStatus("Checking bankroll...");

    try {
      const enough = await hasDcmonBalance(wager);
      if (!enough) {
        setStatus("Insufficient DCMon balance for this bet.");
        return;
      }

      const approved = await ensureAllowance(hazardAddress, wager, {
        onProgress: setStatus,
      });
      if (!approved) {
        setStatus("DCMon approval declined.");
        return;
      }

      setStatus("Submitting dice roll...");
      const data = hazardInterface.encodeFunctionData("play", [selectedMain, wager]);

      let receipt: any = null;
      let hash: string | null = null;
      try {
        hash = await delegation.sendTransaction({
          to: hazardAddress,
          data,
        });
        if (hash) {
          setStatus(`Tx sent: ${hash.slice(0, 10)}… waiting confirmation...`);
          receipt = await provider.waitForTransaction(hash);
        }
      } catch (error) {
        console.warn("[hazard] AA send failed", error);
      }

      if (!receipt) {
        const response = await contract.play(selectedMain, wager);
        hash = response.hash ?? null;
        if (hash) {
          setStatus(`Tx sent: ${hash.slice(0, 10)}… waiting confirmation...`);
        } else {
          setStatus("Tx sent. Waiting for confirmation...");
        }
        receipt = await response.wait();
      }

      if (!receipt) {
        setStatus("Transaction pending. Check explorer.");
        return;
      }

      let finalSum = Number.isFinite(receipt?.events?.length) ? NaN : NaN;
      let chance = 0;
      let win = false;

      for (const log of receipt.logs ?? []) {
        try {
          const parsedLog = hazardInterface.parseLog(log);
          if (!parsedLog) continue;
          if (parsedLog.name === "HazardResult") {
            win = Boolean(parsedLog.args?.won ?? parsedLog.args?.[0]);
            finalSum = Number(parsedLog.args?.sum ?? parsedLog.args?.[4]);
            chance = Number(parsedLog.args?.chance ?? parsedLog.args?.[5]);
            break;
          }
        } catch {
          /* ignore parse errors */
        }
      }

      const [first, second] = deriveDicePair(finalSum);
      setDiceFaces([first, second]);
      setStatus(explainOutcome(selectedMain, finalSum, chance, win));
      setHistory((prev) => [
        { win, sum: finalSum, main: selectedMain, wager: betValue.toFixed(3) },
        ...prev,
      ].slice(0, 5));
    } catch (error) {
      console.error("[hazard] play failed", error);
      setStatus(extractErrorMessage(error));
    } finally {
      setRolling(false);
      setIsSubmitting(false);
    }
  }, [
    provider,
    ensureConnected,
    bet,
    selectedMain,
    hasDcmonBalance,
    ensureAllowance,
    delegation,
    hazardAddress,
  ]);

  return (
    <main className="tavern game">
      <div className="game-header">
        <Image
          className="game-logo"
          src="/assets/images/hazard-logo.png"
          alt="Hazard"
          width={260}
          height={120}
          priority
        />
        <Link href="/" id="return" className="rules-btn">
          Return to Tavern
        </Link>
      </div>

      <div className="hazard-wrap">
        <div className="dice-area" aria-live="polite">
          {diceFaces.map((face, idx) => (
            <Image
              key={`die-${idx}`}
              src={diceImage(face)}
              alt={`Die showing ${face}`}
              width={96}
              height={96}
              className={rolling ? "rolling" : undefined}
            />
          ))}
        </div>

        <div className="hazard-main-selector" role="group" aria-label="Select your main">
          {MAIN_CHOICES.map((main) => (
            <button
              key={main}
              type="button"
              className={selectedMain === main ? "active" : undefined}
              onClick={() => setSelectedMain(main)}
              disabled={isSubmitting}
            >
              Main {main}
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
            onChange={(event) => setBet(event.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <button id="roll-dice" type="button" onClick={handleRoll} disabled={isSubmitting}>
          {isSubmitting ? "Rolling..." : "Roll Dice"}
        </button>

        <p id="hazard-result" className="hazard-status">
          {status}
        </p>

        {!address && (
          <button
            type="button"
            onClick={connect}
            disabled={isConnecting || isSubmitting}
            className="connect-btn"
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}

        {history.length > 0 && (
          <div className="hazard-history">
            <h3>Recent Rolls</h3>
            <ul>
              {history.map((row, idx) => (
                <li key={`${row.sum}-${idx}`}>
                  <span>{row.win ? "Win" : "Loss"}</span>
                  <span>Sum: {Number.isFinite(row.sum) ? row.sum : "-"}</span>
                  <span>Main: {row.main}</span>
                  <span>Bet: {row.wager} DCMon</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
