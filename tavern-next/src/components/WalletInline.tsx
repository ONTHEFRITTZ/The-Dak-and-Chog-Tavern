'use client';

import Image from "next/image";
import { useMemo } from "react";
import { useWallet } from "../context/WalletContext";
import { formatDcmon, useBankrollState } from "@/modules/bankroll";

function truncateAddress(addr: string | null): string {
  if (!addr) return "Connect Wallet";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export const WalletInline = () => {
  const { address, connect, disconnect, isConnecting } = useWallet();
  const { dcmonBalance, loading: bankrollLoading } = useBankrollState();

  const label = useMemo(() => truncateAddress(address), [address]);
  const balanceLabel = useMemo(() => {
    if (!address) return "DCMon: --";
    if (bankrollLoading) return "DCMon: ...";
    return `DCMon: ${formatDcmon(dcmonBalance, 2)}`;
  }, [address, bankrollLoading, dcmonBalance]);

  return (
    <div id="wallet-inline">
      <div className="wallet-providers" aria-hidden="true">
        <Image src="/assets/images/logos/metamask.png" alt="" width={24} height={24} />
        <Image src="/assets/images/logos/phantom.png" alt="" width={24} height={24} />
      </div>
      <span id="wi-address">{label}</span>
      <span className="wi-balance-badge">{balanceLabel}</span>
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
