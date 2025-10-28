'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Contract, Interface, parseEther } from "ethers";
import { DakChogABI } from "@/abi/dakChog";
import { CONTRACTS } from "@/lib/config";
import { useWallet } from "@/context/WalletContext";
import { useBankroll } from "@/modules/bankroll";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";
import { usePageBackdrop } from "@/hooks/usePageBackdrop";

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
  const { hasDcmonBalance, ensureAllowance } = useBankroll();
  const delegation = useDelegationToolkitAA();
  usePageBackdrop("dakchog");

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

  const ensureConnected = useCallback(async () => {
    if (address) return true;
    try {
      await connect();
      return true;
    } catch {
      return false;
    }
  }, [address, connect]);

  const playCoin = useCallback(async () => {
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

    let betWei: bigint;
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

    setIsSubmitting(true);
    setIsFlipping(true);
    coinRef.current?.classList.add("spin");
    setStatus("Checking balance...");

    try {
      const enough = await hasDcmonBalance(betWei);
      if (!enough) {
        setStatus("Insufficient DCMon balance for this bet.");
        return;
      }

      const approved = await ensureAllowance(target, betWei, {
        onProgress: setStatus,
      });
      if (!approved) {
        setStatus("DCMon approval declined.");
        return;
      }

      setStatus("Submitting transaction...");
      const data = contract.interface.encodeFunctionData("playCoin", [face, betWei]);

      let receipt: any = null;
      try {
        const hash = await delegation.sendTransaction({
          to: target,
          data,
        });
        if (hash) {
          setStatus(`Tx sent: ${String(hash).slice(0, 10)}... waiting confirmation...`);
          receipt = await provider.waitForTransaction(hash);
        }
      } catch (err) {
        console.warn("[dakchog] AA send failed", err);
      }

      if (!receipt) {
        if ((window as any)?.FORCE_GASLESS) {
          setStatus("Gasless send unavailable. Try again.");
          return;
        }
        const tx = await contract.playCoin(face, betWei);
        setStatus("Tx sent: waiting confirmation...");
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
          if (descr?.name === "CoinPlayed") {
            parsed = descr;
            break;
          }
        } catch {
          continue;
        }
      }

      coinRef.current?.classList.remove("spin");
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
    <main className="game dakchog-page">
      <section className="dakchog-content">
        <div id="coin" ref={coinRef} className={`coin ${isFlipping ? "spin" : ""}`} aria-live="polite" />

        <div className="choice" aria-label="Choose side">
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

        <div className="controls">
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

        <div className="cta">
          <button id="flip" type="button" onClick={playCoin} disabled={isSubmitting}>
            {isSubmitting ? "Flipping..." : "Flip Coin"}
          </button>
        </div>

        <p id="dc-status">{status}</p>

        {!address && (
          <button
            id="connect-wallet"
            type="button"
            onClick={connect}
            disabled={isConnecting}
            className="connect-btn"
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </section>

      <section id="rules-overlay" style={{ display: "none" }} aria-hidden="true" />
    </main>
  );
}

