'use client';

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@/context/WalletContext";

const AGE_KEY = "tavern:ageConfirmed";

type Stage = "age" | "wallet";

export const AgeGate = () => {
  const { address, connect, isConnecting } = useWallet();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("age");
  const [error, setError] = useState<string | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState<boolean>(false);

  useEffect(() => {
    try {
      const remembered = sessionStorage.getItem(AGE_KEY) === "true";
      setAgeConfirmed(remembered);
    } catch {
      setAgeConfirmed(false);
    }
  }, []);

  useEffect(() => {
    if (!ageConfirmed) {
      setStage("age");
      setOpen(true);
      return;
    }
    if (!address) {
      setStage("wallet");
      setOpen(true);
      return;
    }
    setOpen(false);
  }, [ageConfirmed, address]);

  const confirmAge = () => {
    try {
      sessionStorage.setItem(AGE_KEY, "true");
    } catch {
      // ignore storage issues
    }
    setAgeConfirmed(true);
    setStage("wallet");
    setError(null);
    setOpen(true);
  };

  const connectWithProvider = async (providerKey: "metamask" | "phantom") => {
    if (typeof window === "undefined") return;
    setError(null);
    try {
      const provider =
        providerKey === "metamask"
          ? window.ethereum
          : window.phantom?.ethereum;
      if (!provider) {
        setError(
          providerKey === "metamask"
            ? "MetaMask not detected."
            : "Phantom (EVM) wallet not detected."
        );
        return;
      }
      window.__walletProvider = provider;
      await connect();
      setOpen(false);
    } catch (err: any) {
      console.warn("[age-gate] wallet connect failed", err);
      setError(err?.message ?? "Wallet connection failed.");
    }
  };

  if (!open) return null;

  return (
    <div
      className="age-gate"
      role="dialog"
      aria-modal
      aria-labelledby="age-gate-title"
    >
      <div className="age-card">
        <h2 id="age-gate-title">Welcome to the Tavern</h2>
        {stage === "age" ? (
          <>
            <p className="age-copy">
              There&apos;s gambling beyond these doors. You must be 19 or older
              to enter.
            </p>
            <div className="age-actions">
              <button onClick={confirmAge}>
                I&apos;m 19+ — let me in!
              </button>
              <Link
                href="https://www.responsiblegambling.org/"
                target="_blank"
                rel="noreferrer"
              >
                I&apos;m not 19 — learn more
              </Link>
            </div>
            <p className="age-sub">
              Play responsibly. Monitor your bankroll and set personal limits.
            </p>
          </>
        ) : (
          <>
            <p className="age-copy">Choose a wallet to enter the tavern.</p>
            <div className="wallet-grid">
              <button
                onClick={() => connectWithProvider("metamask")}
                disabled={isConnecting}
              >
                <Image
                  src="/assets/images/logos/metamask.png"
                  alt="MetaMask"
                  width={64}
                  height={64}
                />
                <span>MetaMask</span>
              </button>
              <button
                onClick={() => connectWithProvider("phantom")}
                disabled={isConnecting}
              >
                <Image
                  src="/assets/images/logos/phantom.png"
                  alt="Phantom EVM"
                  width={64}
                  height={64}
                />
                <span>Phantom</span>
              </button>
            </div>
            {error && <p className="age-error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
};
