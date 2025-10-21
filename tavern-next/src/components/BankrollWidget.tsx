'use client';

import { useMemo } from "react";
import { useWallet } from "@/context/WalletContext";
import { useBankroll } from "@/modules/bankroll/useBankroll";
import { useBankrollState } from "@/modules/bankroll/store";
import { formatDcmon } from "@/modules/bankroll";

export const BankrollWidget = () => {
  const { address } = useWallet();
  const { refresh } = useBankroll();
  const { dcmonBalance, monBalance, loading, lastUpdated } = useBankrollState();

  const dcmonLabel = useMemo(() => formatDcmon(dcmonBalance, 2), [dcmonBalance]);
  const monLabel = useMemo(() => formatDcmon(monBalance, 3), [monBalance]);

  const statusLabel = useMemo(() => {
    if (!address) return "Connect wallet to view bankroll.";
    if (loading) return "Refreshing balances...";
    if (!lastUpdated) return "Balances pending...";
    const delta = Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000));
    return `Updated ${delta}s ago`;
  }, [address, loading, lastUpdated]);

  return (
    <div className="bankroll-widget" role="status" aria-live="polite">
      <div className="bankroll-balances">
        <div>
          <span className="bankroll-label">DCMon</span>
          <span className="bankroll-value">{dcmonLabel}</span>
        </div>
        <div>
          <span className="bankroll-label">MON</span>
          <span className="bankroll-value">{monLabel}</span>
        </div>
      </div>
      <div className="bankroll-actions">
        <span className="bankroll-status">{statusLabel}</span>
        <button type="button" onClick={() => refresh().catch(() => void 0)} disabled={loading}>
          Refresh
        </button>
      </div>
    </div>
  );
};
