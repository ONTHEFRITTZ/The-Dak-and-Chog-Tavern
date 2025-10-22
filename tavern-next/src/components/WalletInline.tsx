'use client';

import Image from "next/image";
import { useCallback, useMemo } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { formatDcmon, useBankrollState } from "@/modules/bankroll";

type WalletTypeIconMap = {
  [key: string]: string;
};

const ICON_MAP: WalletTypeIconMap = {
  metamask: "/assets/images/logos/metamask.png",
  phantom: "/assets/images/logos/phantom.png",
  unknown: "/assets/images/logos/metamask.png",
};

declare global {
  interface Window {
    ethers?: typeof ethers;
    openWalletChipsModal?: () => void;
  }
}

if (typeof window !== "undefined" && !window.ethers) {
  window.ethers = ethers;
}

function truncateAddress(addr: string | null): string {
  if (!addr) return "Connect Wallet";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export const WalletInline = () => {
  const { address, connect, disconnect, isConnecting, walletType } = useWallet();
  const { dcmonBalance, loading: bankrollLoading } = useBankrollState();

  const label = useMemo(() => truncateAddress(address), [address]);
  const balanceLabel = useMemo(() => {
    if (!address) return "DCMon: --";
    if (bankrollLoading) return "DCMon: ...";
    return `DCMon: ${formatDcmon(dcmonBalance, 2)}`;
  }, [address, bankrollLoading, dcmonBalance]);

  const walletIcon = useMemo(() => {
    if (!address) return null;
    if (!walletType) return null;
    const src = ICON_MAP[walletType] ?? ICON_MAP.unknown;
    return (
      <Image
        src={src}
        alt={`${walletType} icon`}
        width={24}
        height={24}
      />
    );
  }, [address, walletType]);

  const handleWalletClick = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!address) return;
    try {
      window.openWalletChipsModal?.();
    } catch (error) {
      console.error("[wallet] open modal failed", error);
    }
  }, [address]);

  return (
    <div id="wallet-inline">
      {walletIcon && (
        <div className="wallet-icon" aria-hidden="true">
          {walletIcon}
        </div>
      )}
      <span id="wi-address">{label}</span>
      <span className="wi-balance-badge">{balanceLabel}</span>
      <button
        id="wi-wallet-btn"
        type="button"
        onClick={handleWalletClick}
        disabled={!address}
        aria-haspopup="dialog"
        aria-expanded="false"
      >
        Wallet
      </button>
      {address ? (
        <button id="wi-disconnect" type="button" onClick={disconnect}>
          Disconnect
        </button>
      ) : (
        <button
          id="wi-connect"
          type="button"
          onClick={() => connect().catch(() => void 0)}
          disabled={isConnecting}
        >
          {isConnecting ? "Connecting..." : "Connect"}
        </button>
      )}
    </div>
  );
};
