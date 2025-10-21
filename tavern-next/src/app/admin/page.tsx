'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, MaxUint256, formatEther, parseEther } from "ethers";
import { useWallet } from "@/context/WalletContext";
import { ADMIN_ADDRESS, CONTRACTS } from "@/lib/config";
import { DCMonABI } from "@/abi/dcmon";
import { PoolABI } from "@/abi/pool";
import { WMON_ABI } from "@/abi/wmon";

type QueueEntry = {
  id: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  amount?: string;
  description?: string;
};

type QueuePayload = {
  swaps?: QueueEntry[];
};

const shortAddress = (value?: string | null) => {
  if (!value) return "-";
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
};

const formatAmount = (value?: bigint | null, digits = 4) => {
  if (value == null) return "-";
  try {
    return Number(formatEther(value)).toFixed(digits);
  } catch {
    return value.toString();
  }
};

export default function AdminPage() {
  const { provider, address, connect, isConnecting } = useWallet();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [wrapAmount, setWrapAmount] = useState("");
  const [unwrapAmount, setUnwrapAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [rewardAmount, setRewardAmount] = useState("");
  const [poolAuthAddress, setPoolAuthAddress] = useState("");
  const [metrics, setMetrics] = useState({
    wmonWallet: "-",
    dcmonWallet: "-",
    poolUnderlying: "-",
    poolDcmon: "-",
    poolOwner: "-",
    rewardPool: "-",
    houseTreasury: "-",
    lastUpdated: "",
  });

  const normalizedAdmin = useMemo(
    () => ADMIN_ADDRESS?.toLowerCase() ?? null,
    []
  );
  const normalizedAddress = address?.toLowerCase() ?? null;
  const isOwner =
    normalizedAdmin && normalizedAddress
      ? normalizedAdmin === normalizedAddress
      : false;

  const ensureConnected = useCallback(async () => {
    if (provider) return true;
    if (!connect) return false;
    try {
      await connect();
      return true;
    } catch {
      return false;
    }
  }, [provider, connect]);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const response = await fetch("/api/dcmon/queue", { cache: "no-store" });
      if (!response.ok) throw new Error(`Queue read failed (${response.status})`);
      const payload: QueuePayload = await response.json();
      setQueue(payload?.swaps ?? []);
    } catch (err) {
      console.error("[admin] queue load failed", err);
      setQueue([]);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  const refreshMetrics = useCallback(async () => {
    if (!provider || !address) return;
    try {
      const [wmonBal, dcmonBal, dcmonHouse, dcmonRewards] = await Promise.all([
        new Contract(CONTRACTS.wmon, WMON_ABI, provider).balanceOf(address),
        new Contract(CONTRACTS.dcmon, DCMonABI, provider).balanceOf(address),
        new Contract(CONTRACTS.dcmon, DCMonABI, provider).houseTreasury(),
        new Contract(CONTRACTS.dcmon, DCMonABI, provider).playerRewardPool(),
      ]);

      const poolContract = new Contract(CONTRACTS.pool, PoolABI, provider);
      const [poolUnderlying, poolDcmon, ownerAddress] = await Promise.all([
        poolContract.poolUnderlyingBalance(),
        poolContract.poolDcmonBalance(),
        poolContract.owner(),
      ]);

      setMetrics({
        wmonWallet: formatAmount(wmonBal),
        dcmonWallet: formatAmount(dcmonBal),
        poolUnderlying: formatAmount(poolUnderlying),
        poolDcmon: formatAmount(poolDcmon),
        poolOwner: ownerAddress,
        rewardPool: dcmonRewards,
        houseTreasury: dcmonHouse,
        lastUpdated: new Date().toLocaleTimeString(),
      });
    } catch (err) {
      console.error("[admin] metric refresh failed", err);
    }
  }, [provider, address]);

  useEffect(() => {
    loadQueue();
    const timer = setInterval(loadQueue, 20_000);
    return () => clearInterval(timer);
  }, [loadQueue]);

  useEffect(() => {
    refreshMetrics();
  }, [refreshMetrics]);

  const handleWrap = useCallback(async () => {
    if (!(await ensureConnected())) return;
    if (!provider || !address) return;
    try {
      setError(null);
      setStatus("Wrapping MON into WMON…");
      const signer = await provider.getSigner();
      const value = parseEther(String(wrapAmount || "0"));
      if (value === 0n) {
        setStatus(null);
        setError("Enter an amount to wrap.");
        return;
      }
      const wmon = new Contract(CONTRACTS.wmon, WMON_ABI, signer);
      const tx = await wmon.deposit({ value });
      await tx.wait();
      setWrapAmount("");
      setStatus("Wrap complete.");
      refreshMetrics();
    } catch (err: any) {
      console.error("[admin] wrap failed", err);
      setError(err?.message ?? "Wrap failed.");
      setStatus(null);
    }
  }, [ensureConnected, provider, address, wrapAmount, refreshMetrics]);

  const handleUnwrap = useCallback(async () => {
    if (!(await ensureConnected())) return;
    if (!provider || !address) return;
    try {
      setError(null);
      setStatus("Unwrapping WMON…");
      const signer = await provider.getSigner();
      const value = parseEther(String(unwrapAmount || "0"));
      if (value === 0n) {
        setStatus(null);
        setError("Enter an amount to unwrap.");
        return;
      }
      const wmon = new Contract(CONTRACTS.wmon, WMON_ABI, signer);
      const tx = await wmon.withdraw(value);
      await tx.wait();
      setUnwrapAmount("");
      setStatus("Unwrap complete.");
      refreshMetrics();
    } catch (err: any) {
      console.error("[admin] unwrap failed", err);
      setError(err?.message ?? "Unwrap failed.");
      setStatus(null);
    }
  }, [ensureConnected, provider, address, unwrapAmount, refreshMetrics]);

  const ensureAllowance = useCallback(
    async (spender: string, required: bigint) => {
      if (!provider || !address) return false;
      const readContract = new Contract(CONTRACTS.wmon, WMON_ABI, provider);
      const allowance = await readContract.allowance(address, spender);
      if (allowance >= required) return true;
      const signer = await provider.getSigner();
      const writeContract = readContract.connect(signer);
      const tx = await writeContract.approve(spender, MaxUint256);
      await tx.wait();
      return true;
    },
    [provider, address]
  );

  const handleDeposit = useCallback(async () => {
    if (!(await ensureConnected())) return;
    if (!provider || !address) return;
    try {
      setError(null);
      setStatus("Depositing into DCMon…");
      const amount = parseEther(String(depositAmount || "0"));
      if (amount === 0n) {
        setStatus(null);
        setError("Enter an amount to deposit.");
        return;
      }
      const allowanceOk = await ensureAllowance(CONTRACTS.dcmon, amount);
      if (!allowanceOk) throw new Error("Failed to approve WMON for DCMon.");
      const signer = await provider.getSigner();
      const dcmon = new Contract(CONTRACTS.dcmon, DCMonABI, signer);
      const tx = await dcmon.deposit(amount, address);
      await tx.wait();
      setDepositAmount("");
      setStatus("Deposit complete.");
      refreshMetrics();
    } catch (err: any) {
      console.error("[admin] deposit failed", err);
      setError(err?.message ?? "Deposit failed.");
      setStatus(null);
    }
  }, [ensureConnected, provider, address, depositAmount, ensureAllowance, refreshMetrics]);

  const handleRedeem = useCallback(async () => {
    if (!(await ensureConnected())) return;
    if (!provider || !address) return;
    try {
      setError(null);
      setStatus("Redeeming DCMon…");
      const amount = parseEther(String(redeemAmount || "0"));
      if (amount === 0n) {
        setStatus(null);
        setError("Enter an amount to redeem.");
        return;
      }
      const signer = await provider.getSigner();
      const dcmon = new Contract(CONTRACTS.dcmon, DCMonABI, signer);
      const tx = await dcmon.redeem(amount, address);
      await tx.wait();
      setRedeemAmount("");
      setStatus("Redeem complete.");
      refreshMetrics();
    } catch (err: any) {
      console.error("[admin] redeem failed", err);
      setError(err?.message ?? "Redeem failed.");
      setStatus(null);
    }
  }, [ensureConnected, provider, address, redeemAmount, refreshMetrics]);

  const handleRecordRewards = useCallback(async () => {
    if (!(await ensureConnected())) return;
    if (!provider) return;
    try {
      setError(null);
      setStatus("Recording rewards…");
      const amount = parseEther(String(rewardAmount || "0"));
      if (amount === 0n) {
        setStatus(null);
        setError("Enter a reward amount.");
        return;
      }
      const signer = await provider.getSigner();
      const dcmon = new Contract(CONTRACTS.dcmon, DCMonABI, signer);
      const tx = await dcmon.recordRewards(amount);
      await tx.wait();
      setRewardAmount("");
      setStatus("Rewards recorded.");
      refreshMetrics();
    } catch (err: any) {
      console.error("[admin] record rewards failed", err);
      setError(err?.message ?? "Record rewards failed.");
      setStatus(null);
    }
  }, [ensureConnected, provider, rewardAmount, refreshMetrics]);

  const handleAuthorization = useCallback(
    async (allow: boolean) => {
      if (!(await ensureConnected())) return;
      if (!provider) return;
      const target = poolAuthAddress.trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(target)) {
        setError("Enter a valid game address.");
        return;
      }
      try {
        setError(null);
        setStatus(`${allow ? "Authorizing" : "Revoking"} game…`);
        const signer = await provider.getSigner();
        const pool = new Contract(CONTRACTS.pool, PoolABI, signer);
        const tx = await pool.setAuthorized(target, allow);
        await tx.wait();
        setStatus(`Game ${allow ? "authorized" : "revoked"}.`);
        setPoolAuthAddress("");
      } catch (err: any) {
        console.error("[admin] authorization failed", err);
        setError(err?.message ?? "Authorization failed.");
        setStatus(null);
      }
    },
    [ensureConnected, provider, poolAuthAddress]
  );

  if (!address) {
    return (
      <main className="admin-page">
        <h1>Admin Console</h1>
        <p>Please connect with the owner wallet to continue.</p>
      </main>
    );
  }

  if (!isOwner) {
    return (
      <main className="admin-page">
        <h1>Admin Console</h1>
        <p>Connected wallet is not authorized for admin operations.</p>
        {normalizedAdmin && (
          <p>
            Owner required: <code>{normalizedAdmin}</code>
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="admin-page">
      <h1>Admin Console</h1>
      <p className="admin-intro">
        Manage DCMon liquidity, WMON wraps, pool authorizations, and review the
        DCMon agent swap queue. All actions execute directly on-chain through
        your connected owner wallet.
      </p>

      {(status || error) && (
        <div className="admin-status">
          {status && <span className="status-ok">{status}</span>}
          {error && <span className="status-error">{error}</span>}
        </div>
      )}

      <section className="admin-section">
        <h2>Current Balances</h2>
        <div className="admin-metrics">
          <div>
            <strong>WMON (wallet)</strong>
            <span>{metrics.wmonWallet}</span>
          </div>
          <div>
            <strong>DCMon (wallet)</strong>
            <span>{metrics.dcmonWallet}</span>
          </div>
          <div>
            <strong>Pool Underlying</strong>
            <span>{metrics.poolUnderlying}</span>
          </div>
          <div>
            <strong>Pool DCMon</strong>
            <span>{metrics.poolDcmon}</span>
          </div>
          <div>
            <strong>Pool Owner</strong>
            <span>{shortAddress(metrics.poolOwner)}</span>
          </div>
          <div>
            <strong>House Treasury</strong>
            <span>{shortAddress(metrics.houseTreasury)}</span>
          </div>
          <div>
            <strong>Reward Pool</strong>
            <span>{shortAddress(metrics.rewardPool)}</span>
          </div>
        </div>
        <button onClick={refreshMetrics}>Refresh Balances</button>
        {metrics.lastUpdated && (
          <p className="admin-muted">Last updated: {metrics.lastUpdated}</p>
        )}
      </section>

      <section className="admin-section">
        <h2>Wrap / Unwrap WMON</h2>
        <div className="admin-grid">
          <label>
            Amount (MON)
            <input
              type="number"
              value={wrapAmount}
              onChange={(e) => setWrapAmount(e.target.value)}
              placeholder="0.0"
            />
          </label>
          <button onClick={handleWrap} disabled={isConnecting}>
            Wrap → WMON
          </button>
        </div>
        <div className="admin-grid">
          <label>
            Amount (WMON)
            <input
              type="number"
              value={unwrapAmount}
              onChange={(e) => setUnwrapAmount(e.target.value)}
              placeholder="0.0"
            />
          </label>
          <button onClick={handleUnwrap} disabled={isConnecting}>
            Unwrap → MON
          </button>
        </div>
      </section>

      <section className="admin-section">
        <h2>DCMon Liquidity</h2>
        <div className="admin-grid">
          <label>
            Deposit (WMON →
            DCMon)
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="0.0"
            />
          </label>
          <button onClick={handleDeposit} disabled={isConnecting}>
            Deposit
          </button>
        </div>
        <div className="admin-grid">
          <label>
            Redeem (DCMon →
            WMON)
            <input
              type="number"
              value={redeemAmount}
              onChange={(e) => setRedeemAmount(e.target.value)}
              placeholder="0.0"
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
              onChange={(e) => setRewardAmount(e.target.value)}
              placeholder="0.0"
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
              onChange={(e) => setPoolAuthAddress(e.target.value)}
              placeholder="0x…"
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
          Ensure the target game contract implements the expected bankroll hooks
          before authorizing.
        </p>
      </section>

      <section className="admin-section">
        <h2>DCMon Swap Queue</h2>
        <div className="admin-row">
          <button onClick={loadQueue} disabled={queueLoading}>
            Refresh Queue
          </button>
          {queueLoading && <span className="admin-muted">Loading…</span>}
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
                    {entry.createdAt && <>Created: {entry.createdAt}</>}
                    {entry.updatedAt && <> · Updated: {entry.updatedAt}</>}
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
