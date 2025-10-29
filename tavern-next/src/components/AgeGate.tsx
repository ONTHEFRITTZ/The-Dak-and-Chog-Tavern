'use client';

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";

const AGE_KEY = "tavern:ageConfirmed";

type Stage = "age" | "wallet";

export const AgeGate = () => {
  const { address, connect, isConnecting, walletType, provider } = useWallet();
  const delegation = useDelegationToolkitAA();
  const [error, setError] = useState<string | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState<boolean | null>(null);
  const announcedAAStatus = useRef<"ready" | "fallback" | null>(null);

  useEffect(() => {
    try {
      const remembered = sessionStorage.getItem(AGE_KEY) === "true";
      setAgeConfirmed(remembered);
    } catch {
      setAgeConfirmed(false);
    }
  }, []);

  const resolvedAgeConfirmed = Boolean(ageConfirmed);
  const stage: Stage = resolvedAgeConfirmed ? "wallet" : "age";
  const shouldShow = ageConfirmed === null ? false : !resolvedAgeConfirmed || !address;

  const confirmAge = () => {
    try {
      sessionStorage.setItem(AGE_KEY, "true");
    } catch {
      // ignore storage issues
    }
    setAgeConfirmed(true);
    setError(null);
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
    } catch (err: any) {
      console.warn("[age-gate] wallet connect failed", err);
      setError(err?.message ?? "Wallet connection failed.");
    }
  };

  useEffect(() => {
    if (walletType !== "metamask" || !address || !provider) {
      announcedAAStatus.current = null;
      return;
    }
    let cancelled = false;

    const announceAA = (status: "ready" | "fallback") => {
      if (announcedAAStatus.current === status) return;
      announcedAAStatus.current = status;
      try {
        const detail =
          status === "ready"
            ? { provider: "metamask", active: true }
            : { provider: "metamask" };
        window.dispatchEvent(new CustomEvent(status === "ready" ? "aa:ready" : "aa:fallback", { detail }));
      } catch {
        // ignore dispatch issues
      }
    };

    const initialiseDelegation = async () => {
      if (typeof delegation?.ensureReady !== "function") {
        announceAA("fallback");
        return;
      }
      try {
        await delegation.ensureReady();
        if (!cancelled) {
          announceAA("ready");
        }
      } catch (err) {
        console.warn("[age-gate] delegation ensureReady failed", err);
        if (!cancelled) {
          announceAA("fallback");
        }
      }
    };

    initialiseDelegation();

    return () => {
      cancelled = true;
    };
  }, [address, walletType, provider, delegation]);

  if (!shouldShow) return null;

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
              <button onClick={confirmAge}>I&apos;m 19+ - let me in!</button>
              <Link href="https://www.responsiblegambling.org/" target="_blank" rel="noreferrer">
                I&apos;m not 19 - learn more
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
