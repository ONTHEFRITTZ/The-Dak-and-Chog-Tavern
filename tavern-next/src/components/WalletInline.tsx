'use client';

import { useWallet } from "../context/WalletContext";
import { useMemo } from "react";

function truncateAddress(addr: string | null): string {
  if (!addr) return "Connect Wallet";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export const WalletInline = () => {
  const { address, connect, disconnect, isConnecting } = useWallet();

  const label = useMemo(() => truncateAddress(address), [address]);

  return (
    <div id="wallet-inline">
      <span id="wi-address">{label}</span>
      {address ? (
        <button
          id="wi-disconnect"
          type="button"
          onClick={disconnect}
        >
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
