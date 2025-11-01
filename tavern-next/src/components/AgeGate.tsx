'use client';

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWalletClient } from "wagmi";
import { useWallet } from "@/context/WalletContext";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";

const AGE_KEY = "tavern:ageConfirmed";

type Stage = "age" | "wallet";

export const AgeGate = () => {
  const { address, connect, disconnect, isConnecting, walletType, rawProvider } = useWallet();
  const { data: wagmiWalletClient } = useWalletClient();
  const delegation = useDelegationToolkitAA();
  const [error, setError] = useState<string | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState<boolean | null>(null);
  const [forceWalletSelect, setForceWalletSelect] = useState(false);
  const primeMetaMaskRef = useRef(false);
  const [primeTick, setPrimeTick] = useState(0);
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
  const shouldShow =
    ageConfirmed === null
      ? false
      : !resolvedAgeConfirmed || forceWalletSelect || !address;

  const confirmAge = async () => {
    try {
      sessionStorage.setItem(AGE_KEY, "true");
    } catch {
      // ignore storage issues
    }
    setAgeConfirmed(true);
    setError(null);
    setForceWalletSelect(true);
    if (address) {
      try {
        await disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
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
      setForceWalletSelect(false);
      if (providerKey === "metamask") {
        primeMetaMaskRef.current = true;
        setPrimeTick((tick) => tick + 1);
      } else {
        primeMetaMaskRef.current = false;
      }
    } catch (err: any) {
      console.warn("[age-gate] wallet connect failed", err);
      setError(err?.message ?? "Wallet connection failed.");
    }
  };

  useEffect(() => {
    if (!primeMetaMaskRef.current) return;
    if (walletType !== "metamask" || !address || !rawProvider || !(wagmiWalletClient?.account?.address)) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        await delegation.ensureReady({
          ownerAddress: address,
          provider: rawProvider,
          walletClient: wagmiWalletClient as any,
        });
        if (!cancelled) {
          primeMetaMaskRef.current = false;
        }
      } catch {
        if (cancelled) return;
        setTimeout(() => {
          if (!cancelled) {
            setPrimeTick((tick) => tick + 1);
          }
        }, 250);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [walletType, address, rawProvider, wagmiWalletClient, delegation, primeTick]);

  useEffect(() => {
    if (walletType !== "metamask" || !address) {
      if (announcedAAStatus.current !== null) {
        announcedAAStatus.current = null;
        try {
          window.dispatchEvent(new CustomEvent("aa:sponsored", { detail: { active: false } }));
        } catch {
          // ignore dispatch issues
        }
        try {
          window.dispatchEvent(new CustomEvent("aa:fallback", { detail: { provider: "metamask" } }));
        } catch {
          // ignore dispatch issues
        }
      }
      return;
    }
    if (delegation.ready) {
      if (announcedAAStatus.current !== "ready") {
        announcedAAStatus.current = "ready";
        try {
          window.dispatchEvent(new CustomEvent("aa:ready", { detail: { provider: "metamask", active: true } }));
        } catch {
          // ignore dispatch issues
        }
        try {
          window.dispatchEvent(new CustomEvent("aa:sponsored", { detail: { active: true } }));
        } catch {
          // ignore dispatch issues
        }
      }
    } else if (announcedAAStatus.current !== "fallback") {
      announcedAAStatus.current = "fallback";
      try {
        window.dispatchEvent(new CustomEvent("aa:fallback", { detail: { provider: "metamask" } }));
      } catch {
        // ignore dispatch issues
      }
      try {
        window.dispatchEvent(new CustomEvent("aa:sponsored", { detail: { active: false } }));
      } catch {
        // ignore dispatch issues
      }
    }
  }, [walletType, address, delegation.ready]);

  useEffect(() => {
    if (address) {
      setForceWalletSelect(false);
    }
  }, [address]);

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

