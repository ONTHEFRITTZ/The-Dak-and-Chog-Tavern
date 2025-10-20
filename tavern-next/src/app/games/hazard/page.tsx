'use client';

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Contract, Interface, parseEther } from "ethers";
import { useWallet } from "@/context/WalletContext";
import { useLegacyAAOps } from "@/hooks/useLegacyAAOps";
import { useBankroll } from "@/modules/bankroll";
import { CONTRACTS } from "@/lib/config";
import { HazardABI } from "@/abi/hazard";

const MIN_BET = 0.001;
const MAIN_CHOICES: Array<5 | 6 | 7 | 8 | 9> = [5, 6, 7, 8, 9];

function clampBet(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_BET) return MIN_BET;
  return Math.floor(parsed * 1000 + 1e-9) / 1000;
}

function explainOutcome(main: number, finalSum: number, chance: number, win: boolean) {
  if (!Number.isFinite(finalSum)) return win ? "Win" : "Loss";
  const prefix = win ? "WIN" : "LOSS";
  if (chance === 0) {
    if (finalSum === main) return ${prefix}: Rolled your main ().;
    if (main === 7 && [5, 9].includes(finalSum)) {
      return win ? ${prefix}: Rolled . Special win for main 7. : ${prefix}: Rolled .;
    }
    if ([5, 9].includes(main) && finalSum === main) return ${prefix}: Rolled .;
    return win ? ${prefix}: Rolled . : ${prefix}: Rolled .;
  }
  if (win) return ${prefix}: Hit point  before main .;
  if (finalSum === main) return ${prefix}: Rolled main  before point .;
  return ${prefix}: Rolled .;
}

function deriveDicePair(sum: number): [number, number] {
  if (!Number.isFinite(sum) || sum < 2 || sum > 12) return [1, 1];
  for (let first = Math.min(6, sum - 1); first >= 1; first--) {
    const second = sum - first;
    if (second >= 1 && second <= 6) {
      return [first, second];
    }
  }
  return [1, 1];
}

export default function HazardPage() {
  const { address, provider, connect, isConnecting } = useWallet();
  const { ops: legacyAAOps } = useLegacyAAOps();
  const { hasDcmonBalance, ensureAllowance } = useBankroll();

  const [bet, setBet] = useState(() => clampBet(String(MIN_BET)).toFixed(3));
  const [selectedMain, setSelectedMain] = useState<5 | 6 | 7 | 8 | 9>(7);
  const [status, setStatus] = useState("Pick a main and roll the dice!");
  const [history, setHistory] = useState<Array<{ win: boolean; sum: number; main: number; wager: string }>>([]);
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
        if (MAIN_CHOICES.includes(parsed as any)) {
          setSelectedMain(parsed as 5 | 6 | 7 | 8 | 9);
        }
      }
    } catch {}
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

  const hazardAddress = CONTRACTS.hazard || CONTRACTS.tavern;

  const handleRoll = async () => {
    if (!provider) {
      setStatus("Connect wallet to play.");
      return;
    }
    const ok = await ensureConnected();
    if (!ok) {
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
      setStatus("Enter a valid bet amount.");
      return;
    }

    try {
      setIsSubmitting(true);
      setRolling(true);
      setStatus("Preparing wager...");

      const signer = await provider.getSigner();
      const hazardContract = new Contract(hazardAddress, HazardABI, signer);

      const hasBalance = await hasDcmonBalance(wager);
      if (!hasBalance) {
        setStatus("Insufficient DCMon balance for this bet.");
        setRolling(false);
        setIsSubmitting(false);
        return;
      }

      const approved = await ensureAllowance(hazardAddress, wager, {
        onProgress: setStatus,
      });
      if (!approved) {
        setRolling(false);
        setIsSubmitting(false);
        return;
      }

      setStatus("Rolling dice...");

      let receipt: any = null;
      if (
        legacyAAOps &&
        typeof legacyAAOps.encodeFromSignature === "function" &&
        typeof legacyAAOps.sendTxViaAA === "function"
      ) {
        try {
          const data = legacyAAOps.encodeFromSignature("playHazard(uint8,uint256)", [
            selectedMain,
            wager,
          ]);
          if (data) {
            const txHash = await legacyAAOps.sendTxViaAA({ to: hazardAddress, data });
            if (txHash) {
              setStatus(
                Tx sent: ... waiting confirmation...
              );
              receipt = await provider.waitForTransaction(txHash);
            }
          }
        } catch (err) {
          console.warn("[hazard] AA send failed", err);
        }
      }

      if (!receipt) {
        if ((window as any).FORCE_GASLESS) {
          setStatus("Gasless send unavailable. Try again.");
          setRolling(false);
          setIsSubmitting(false);
          return;
        }
        const tx = await hazardContract.playHazard(selectedMain, wager);
        setStatus(Tx sent: ... waiting confirmation...);
        receipt = await tx.wait();
      }

      if (!receipt) {
        setStatus("Transaction sent. Check explorer for result.");
        setRolling(false);
        setIsSubmitting(false);
        return;
      }

      const iface = new Interface(HazardABI as any);
      const addressLower = hazardAddress.toLowerCase();
      let parsed: ReturnType<Interface["parseLog"]> | null = null;
      for (const log of receipt.logs ?? []) {
        const logAddress = String((log as any).address ?? "").toLowerCase();
        if (logAddress !== addressLower) continue;
        try {
          const descr = iface.parseLog(log);
          if (descr?.name === "HazardPlayed") {
            parsed = descr;
            break;
          }
        } catch {}
      }

      if (parsed) {
        const args = parsed.args ?? [];
        const finalSum = Number(args.finalSum ?? args[4] ?? 0);
        const chance = Number(args.chance ?? args[5] ?? 0);
        const win = Boolean(args.win ?? args[2] ?? false);
        const mainValue = Number(args.main ?? args[3] ?? selectedMain);
        const pair = deriveDicePair(finalSum);
        setDiceFaces(pair);
        setRolling(false);
        const explanation = explainOutcome(mainValue, finalSum, chance, win);
        setStatus(explanation);
        setHistory((prev) => [
          { win, sum: finalSum, main: mainValue, wager: betValue.toFixed(3) },
          ...prev,
        ].slice(0, 5));
      } else {
        setRolling(false);
        setStatus("Confirmed on-chain, awaiting event.");
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
      setRolling(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="tavern game" style={{ minHeight: "100vh" }}>
      <div className="game-header">
        <Image
          className="game-logo"
          src="/assets/images/hazard-logo.png"
          alt="Hazard"
          width={260}
          height={120}
        />
        <Link href="/" id="return" className="rules-btn">
          Return to Tavern
        </Link>
      </div>

      <div className="hazard-wrap">
        <div className={dice-area }>
          {diceFaces.map((face, idx) => (
            <Image
              key={idx}
              src={/assets/images/dice/standard/dice.png}
              alt={Die }
              width={96}
              height={96}
            />
          ))}
        </div>

        <div className="hazard-main-selector">
          {MAIN_CHOICES.map((main) => (
            <button
              key={main}
              type="button"
              className={selectedMain === main ? "active" : ""}
              onClick={() => {
                setSelectedMain(main);
                try { localStorage.setItem("hazard.main", String(main)); } catch {}
              }}
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
            onChange={(e) => {
              const clamped = clampBet(e.target.value);
              setBet(clamped.toFixed(3));
              try { localStorage.setItem("hazard.bet", clamped.toString()); } catch {}
            }}
            disabled={isSubmitting}
          />
        </div>

        <button
          id="roll-dice"
          type="button"
          onClick={handleRoll}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Rolling..." : "Roll Dice"}
        </button>

        <p id="hazard-result" className="hazard-status">
          {status}
        </p>

        {!address && (
          <button
            type="button"
            onClick={connect}
            disabled={isConnecting}
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
                <li key={idx}>
                  <span>{row.win ? "Win" : "Loss"}</span>
                  <span>Sum: {row.sum}</span>
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
