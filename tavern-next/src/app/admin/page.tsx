'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, MaxUint256, formatEther, parseEther } from "ethers";
import { useWallet } from "@/context/WalletContext";
import { useBankroll } from "@/modules/bankroll";
import { ADMIN_ADDRESS, CONTRACTS } from "@/lib/config";
import { DCMonABI } from "@/abi/dcmon";
import { PoolABI } from "@/abi/pool";
import { WMON_ABI } from "@/abi/wmon";

type QueueEntry = {
  id: string;
  status?: string;
  amount?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
};

type QueuePayload = {
  swaps?: QueueEntry[];
};

type PoolStats = {
  wmonBalance: bigint;
  poolUnderlying: bigint;
  poolDcmon: bigint;
  poolOwner: string;
  houseTreasury: string;
  rewardPool: string;
  updatedAt: number | null;
};

const QUEUE_POLL_INTERVAL = 15000;

const shortAddress = (value: string | null | undefined) => {
  if (!value) return "-";
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

const formatTokenAmount = (value?: bigint | null, digits = 4) => {
  if (value == null) return "-";
  try {
    return Number(formatEther(value)).toFixed(digits);
  } catch {
    return value.toString();
  }
};

const parseAmountInput = (raw: string) => {
  const value = raw.trim();
  if (!value) return null;
  try {
    return parseEther(value);
  } catch {
    return null;
  }
};

export default function AdminPage() {
  const { provider, address, connect, isConnecting } = useWallet();
  const { dcmonBalance, monBalance, loading: bankrollLoading, refresh: refreshBankroll } =
    useBankroll();

  const [poolStats, setPoolStats] = useState<PoolStats | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueUpdatedAt, setQueueUpdatedAt] = useState<number | null>(null);

  const [wrapAmount, setWrapAmount] = useState("");
  const [unwrapAmount, setUnwrapAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [rewardAmount, setRewardAmount] = useState("");
  const [poolAuthAddress, setPoolAuthAddress] = useState("");

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const normalizedAdmin = useMemo(() => ADMIN_ADDRESS?.toLowerCase() ?? null, []);
  const normalizedAddress = address?.toLowerCase() ?? null;
  const isOwner = normalizedAdmin
    ? normalizedAddress === normalizedAdmin
    : Boolean(normalizedAddress);

  const requireWalletConnection = useCallback(async () => {
    if (provider) return true;
    if (!connect) return false;
    try {
      await connect();
      return true;
    } catch (err) {
      console.warn("[admin] wallet connect failed", err);
      return false;
    }
  }, [provider, connect]);

  const refreshPoolStats = useCallback(async () => {
    if (!provider || !address) return;
    try {
      const wmon = new Contract(CONTRACTS.wmon, WMON_ABI, provider);
      const dcmon = new Contract(CONTRACTS.dcmon, DCMonABI, provider);
      const pool = new Contract(CONTRACTS.pool, PoolABI, provider);

      const [wmonBalance, poolUnderlying, poolDcmon, poolOwner, houseTreasury, rewardPool] =
        await Promise.all([
          wmon.balanceOf(address),
          pool.poolUnderlyingBalance(),
          pool.poolDcmonBalance(),
          pool.owner(),
          dcmon.houseTreasury(),
          dcmon.playerRewardPool(),
        ]);

      setPoolStats({
        wmonBalance,
        poolUnderlying,
        poolDcmon,
        poolOwner,
        houseTreasury,
        rewardPool,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error("[admin] refreshPoolStats failed", err);
    }
  }, [provider, address]);

  const loadQueue = useCallback(async () => {
    if (!isOwner) return;
    setQueueLoading(true);
    try {
      const response = await fetch("/api/dcmon/queue", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Queue request failed (${response.status})`);
      }
      const payload: QueuePayload = await response.json();
      setQueue(payload?.swaps ?? []);
      setQueueUpdatedAt(Date.now());
    } catch (err) {
      console.error("[admin] queue load failed", err);
      setQueue([]);
    } finally {
      setQueueLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    if (!isOwner) return;
    refreshBankroll();
    refreshPoolStats();
  }, [isOwner, refreshBankroll, refreshPoolStats]);

  useEffect(() => {
    if (!isOwner) return;
    loadQueue();
    const timer = window.setInterval(loadQueue, QUEUE_POLL_INTERVAL);
    return () => window.clearInterval(timer);
  }, [isOwner, loadQueue]);

  const ensureWmonAllowance = useCallback(
    async (spender: string, required: bigint) => {
      if (!provider || !address) return false;
      try {
        const wmonRead = new Contract(CONTRACTS.wmon, WMON_ABI, provider);
        const current: bigint = await wmonRead.allowance(address, spender);
        if (current >= required) return true;

        setStatusMessage("Approving WMON spend...");
        setErrorMessage(null);

        const signer = await provider.getSigner();
        const wmonWrite = new Contract(CONTRACTS.wmon, WMON_ABI, signer);
        const tx = await wmonWrite.approve(spender, MaxUint256);
        await tx.wait();
        return true;
      } catch (err: any) {
        console.error("[admin] WMON approval failed", err);
        setErrorMessage(err?.message ?? "WMON approval failed.");
        setStatusMessage(null);
        return false;
      }
    },
    [provider, address]
  );

  const handleWrap = useCallback(async () => {
    if (!(await requireWalletConnection())) return;
    if (!provider) return;

    const amount = parseAmountInput(wrapAmount);
    if (!amount || amount === 0n) {
      setErrorMessage("Enter a wrap amount.");
      setStatusMessage(null);
      return;
    }

    try {
      setErrorMessage(null);
      setStatusMessage("Submitting wrap transaction...");
      const signer = await provider.getSigner();
      const wmon = new Contract(CONTRACTS.wmon, WMON_ABI, signer);
      const tx = await wmon.deposit({ value: amount });
      await tx.wait();
      setWrapAmount("");
      setStatusMessage("Wrap complete.");
      await Promise.all([refreshBankroll(), refreshPoolStats()]);
    } catch (err: any) {
      console.error("[admin] wrap failed", err);
      setErrorMessage(err?.message ?? "Wrap failed.");
      setStatusMessage(null);
    }
  }, [requireWalletConnection, provider, wrapAmount, refreshBankroll, refreshPoolStats]);

  const handleUnwrap = useCallback(async () => {
    if (!(await requireWalletConnection())) return;
    if (!provider) return;

    const amount = parseAmountInput(unwrapAmount);
    if (!amount || amount === 0n) {
      setErrorMessage("Enter an unwrap amount.");
      setStatusMessage(null);
      return;
    }

    try {
      setErrorMessage(null);
      setStatusMessage("Submitting unwrap transaction...");
      const signer = await provider.getSigner();
      const wmon = new Contract(CONTRACTS.wmon, WMON_ABI, signer);
      const tx = await wmon.withdraw(amount);
      await tx.wait();
      setUnwrapAmount("");
      setStatusMessage("Unwrap complete.");
      await Promise.all([refreshBankroll(), refreshPoolStats()]);
    } catch (err: any) {
      console.error("[admin] unwrap failed", err);
      setErrorMessage(err?.message ?? "Unwrap failed.");
      setStatusMessage(null);
    }
  }, [requireWalletConnection, provider, unwrapAmount, refreshBankroll, refreshPoolStats]);

  const handleDeposit = useCallback(async () => {
    if (!(await requireWalletConnection())) return;
    if (!provider || !address) return;

    const amount = parseAmountInput(depositAmount);
    if (!amount || amount === 0n) {
      setErrorMessage("Enter a deposit amount.");
      setStatusMessage(null);
      return;
    }

    try {
      setErrorMessage(null);
      setStatusMessage("Preparing DCMon deposit...");
      const allowanceOk = await ensureWmonAllowance(CONTRACTS.dcmon, amount);
      if (!allowanceOk) return;

      setStatusMessage("Submitting DCMon deposit...");
      const signer = await provider.getSigner();
      const dcmon = new Contract(CONTRACTS.dcmon, DCMonABI, signer);
      const tx = await dcmon.deposit(amount, address);
      await tx.wait();
      setDepositAmount("");
      setStatusMessage("Deposit complete.");
      await Promise.all([refreshBankroll(), refreshPoolStats()]);
    } catch (err: any) {
      console.error("[admin] deposit failed", err);
      setErrorMessage(err?.message ?? "Deposit failed.");
      setStatusMessage(null);
    }
  }, [
    requireWalletConnection,
    provider,
    address,
    depositAmount,
    ensureWmonAllowance,
    refreshBankroll,
    refreshPoolStats,
  ]);

  const handleRedeem = useCallback(async () => {
    if (!(await requireWalletConnection())) return;
    if (!provider || !address) return;

    const amount = parseAmountInput(redeemAmount);
    if (!amount || amount === 0n) {
      setErrorMessage("Enter a redeem amount.");
      setStatusMessage(null);
      return;
    }

    try {
      setErrorMessage(null);
      setStatusMessage("Submitting DCMon redeem...");
      const signer = await provider.getSigner();
      const dcmon = new Contract(CONTRACTS.dcmon, DCMonABI, signer);
      const tx = await dcmon.redeem(amount, address);
      await tx.wait();
      setRedeemAmount("");
      setStatusMessage("Redeem complete.");
      await Promise.all([refreshBankroll(), refreshPoolStats()]);
    } catch (err: any) {
      console.error("[admin] redeem failed", err);
      setErrorMessage(err?.message ?? "Redeem failed.");
      setStatusMessage(null);
    }
  }, [requireWalletConnection, provider, address, redeemAmount, refreshBankroll, refreshPoolStats]);

  const handleRecordRewards = useCallback(async () => {
    if (!(await requireWalletConnection())) return;
    if (!provider) return;

    const amount = parseAmountInput(rewardAmount);
    if (!amount || amount === 0n) {
      setErrorMessage("Enter a reward amount.");
      setStatusMessage(null);
      return;
    }

    try {
      setErrorMessage(null);
      setStatusMessage("Submitting reward record...");
      const signer = await provider.getSigner();
      const dcmon = new Contract(CONTRACTS.dcmon, DCMonABI, signer);
      const tx = await dcmon.recordRewards(amount);
      await tx.wait();
      setRewardAmount("");
      setStatusMessage("Rewards recorded.");
      await Promise.all([refreshBankroll(), refreshPoolStats()]);
    } catch (err: any) {
      console.error("[admin] record rewards failed", err);
      setErrorMessage(err?.message ?? "Record rewards failed.");
      setStatusMessage(null);
    }
  }, [requireWalletConnection, provider, rewardAmount, refreshBankroll, refreshPoolStats]);

  const handleAuthorization = useCallback(
    async (allow: boolean) => {
      if (!(await requireWalletConnection())) return;
      if (!provider) return;

      const target = poolAuthAddress.trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(target)) {
        setErrorMessage("Enter a valid 0x address.");
        setStatusMessage(null);
        return;
      }

      try {
        setErrorMessage(null);
        setStatusMessage(`${allow ? "Authorizing" : "Revoking"} game...`);
        const signer = await provider.getSigner();
        const pool = new Contract(CONTRACTS.pool, PoolABI, signer);
        const tx = await pool.setAuthorized(target, allow);
        await tx.wait();
        setPoolAuthAddress("");
        setStatusMessage(`Game ${allow ? "authorized" : "revoked"}.`);
      } catch (err: any) {
        console.error("[admin] authorization failed", err);
        setErrorMessage(err?.message ?? "Authorization failed.");
        setStatusMessage(null);
      }
    },
    [requireWalletConnection, provider, poolAuthAddress]
  );

  const renderConnectGate = () => (
    <main className="admin-page">
      <h1>Admin Console</h1>
      <p>Connect the owner wallet to manage WMON, DCMon, and pool settings.</p>
      <button onClick={() => connect?.()} disabled={isConnecting}>
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
    </main>
  );

  const renderUnauthorized = () => (
    <main className="admin-page">
      <h1>Admin Console</h1>
      <p>Connected wallet is not authorized for admin operations.</p>
      {normalizedAdmin && (
        <p>
          Owner required: <code>{normalizedAdmin}</code>
        </p>
      )}
      {!normalizedAdmin && (
        <p>
          Set <code>NEXT_PUBLIC_ADMIN_ADDRESS</code> to limit access to the owner wallet.
        </p>
      )}
    </main>
  );

  if (!address) {
    return renderConnectGate();
  }

  if (!isOwner) {
    return renderUnauthorized();
  }

  const queueLastUpdated =
    queueUpdatedAt != null ? new Date(queueUpdatedAt).toLocaleTimeString() : null;
  const poolStatsUpdated =
    poolStats?.updatedAt != null ? new Date(poolStats.updatedAt).toLocaleTimeString() : null;

  return (
    <main className="admin-page">
      <h1>Admin Console</h1>
      <p className="admin-intro">
        Execute DCMon swaps, manage the bankroll pool, and monitor the on-chain swap queue. All
        transactions are sent directly from the connected owner wallet.
      </p>

      {(statusMessage || errorMessage) && (
        <div className="admin-status">
          {statusMessage && <span className="status-ok">{statusMessage}</span>}
          {errorMessage && <span className="status-error">{errorMessage}</span>}
        </div>
      )}

      <section className="admin-section">
        <h2>Current Balances</h2>
        <div className="admin-metrics">
          <div>
            <strong>MON (wallet)</strong>
            <span>{formatTokenAmount(monBalance)}</span>
          </div>
          <div>
            <strong>WMON (wallet)</strong>
            <span>{formatTokenAmount(poolStats?.wmonBalance ?? 0n)}</span>
          </div>
          <div>
            <strong>DCMon (wallet)</strong>
            <span>{formatTokenAmount(dcmonBalance)}</span>
          </div>
          <div>
            <strong>Pool Underlying</strong>
            <span>{formatTokenAmount(poolStats?.poolUnderlying ?? 0n)}</span>
          </div>
          <div>
            <strong>Pool DCMon</strong>
            <span>{formatTokenAmount(poolStats?.poolDcmon ?? 0n)}</span>
          </div>
          <div>
            <strong>Pool Owner</strong>
            <span>{shortAddress(poolStats?.poolOwner)}</span>
          </div>
          <div>
            <strong>House Treasury</strong>
            <span>{shortAddress(poolStats?.houseTreasury)}</span>
          </div>
          <div>
            <strong>Player Reward Pool</strong>
            <span>{shortAddress(poolStats?.rewardPool)}</span>
          </div>
        </div>
        <button
          onClick={async () => {
            setStatusMessage("Refreshing balances...");
            setErrorMessage(null);
            await Promise.all([refreshBankroll(), refreshPoolStats()]);
            setStatusMessage("Balances refreshed.");
          }}
          disabled={bankrollLoading}
        >
          Refresh Balances
        </button>
        {poolStatsUpdated && <p className="admin-muted">Last updated: {poolStatsUpdated}</p>}
      </section>

      <section className="admin-section">
        <h2>Wrap / Unwrap WMON</h2>
        <div className="admin-grid">
          <label>
            Amount (MON)
            <input
              type="number"
              value={wrapAmount}
              onChange={(event) => setWrapAmount(event.target.value)}
              placeholder="0.0"
              min="0"
            />
          </label>
          <button onClick={handleWrap} disabled={isConnecting}>
            Wrap to WMON
          </button>
        </div>
        <div className="admin-grid">
          <label>
            Amount (WMON)
            <input
              type="number"
              value={unwrapAmount}
              onChange={(event) => setUnwrapAmount(event.target.value)}
              placeholder="0.0"
              min="0"
            />
          </label>
          <button onClick={handleUnwrap} disabled={isConnecting}>
            Unwrap to MON
          </button>
        </div>
      </section>

      <section className="admin-section">
        <h2>DCMon Liquidity</h2>
        <div className="admin-grid">
          <label>
            Deposit (WMON to DCMon)
            <input
              type="number"
              value={depositAmount}
              onChange={(event) => setDepositAmount(event.target.value)}
              placeholder="0.0"
              min="0"
            />
          </label>
          <button onClick={handleDeposit} disabled={isConnecting}>
            Deposit
          </button>
        </div>
        <div className="admin-grid">
          <label>
            Redeem (DCMon to WMON)
            <input
              type="number"
              value={redeemAmount}
              onChange={(event) => setRedeemAmount(event.target.value)}
              placeholder="0.0"
              min="0"
            />
          </label>
          <button onClick={handleRedeem} disabled={isConnecting}>
            Redeem
          </button>
        </div>
        <div className="admin-grid">
          <label>
            Record Rewards (WMON)
            <input
              type="number"
              value={rewardAmount}
              onChange={(event) => setRewardAmount(event.target.value)}
              placeholder="0.0"
              min="0"
            />
          </label>
          <button onClick={handleRecordRewards} disabled={isConnecting}>
            Record Rewards
          </button>
        </div>
      </section>

      <section className="admin-section">
        <h2>Pool Authorizations</h2>
        <div className="admin-grid">
          <label>
            Game Address
            <input
              type="text"
              value={poolAuthAddress}
              onChange={(event) => setPoolAuthAddress(event.target.value)}
              placeholder="0x..."
            />
          </label>
          <div className="admin-row">
            <button onClick={() => handleAuthorization(true)} disabled={isConnecting}>
              Authorize Game
            </button>
            <button onClick={() => handleAuthorization(false)} disabled={isConnecting}>
              Revoke Game
            </button>
          </div>
        </div>
        <p className="admin-muted">
          Only authorize game contracts that call the bankroll hooks correctly. Use revoke to block
          stale or compromised deployments.
        </p>
      </section>

      <section className="admin-section">
        <h2>DCMon Swap Queue</h2>
        <div className="admin-row">
          <button onClick={loadQueue} disabled={queueLoading}>
            Refresh Queue
          </button>
          {queueLoading && <span className="admin-muted">Loading...</span>}
          {queueLastUpdated && !queueLoading && (
            <span className="admin-muted">Updated: {queueLastUpdated}</span>
          )}
        </div>
        {queue.length === 0 ? (
          <p className="admin-muted">Swap queue is empty.</p>
        ) : (
          <ul className="admin-queue">
            {queue.map((entry) => (
              <li key={entry.id}>
                <div className="queue-head">
                  <span className="queue-id">{entry.id}</span>
                  <span className={`queue-status queue-${entry.status ?? "pending"}`}>
                    {entry.status ?? "pending"}
                  </span>
                </div>
                {entry.amount && <div>Amount: {entry.amount}</div>}
                {entry.description && <div>{entry.description}</div>}
                {(entry.createdAt || entry.updatedAt) && (
                  <div className="queue-timestamps">
                    {entry.createdAt && <span>Created: {entry.createdAt}</span>}
                    {entry.updatedAt && <span>Updated: {entry.updatedAt}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
