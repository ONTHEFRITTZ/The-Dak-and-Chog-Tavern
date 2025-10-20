'use client';

import { useCallback, useEffect, useState } from "react";
import { Contract, MaxUint256, formatEther } from "ethers";
import { useWallet } from "@/context/WalletContext";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";
import { CONTRACTS } from "@/lib/config";
import { DCMonABI } from "@/abi/dcmon";

export type EnsureAllowanceOptions = {
  onProgress?: (message: string) => void;
};

export function useBankroll() {
  const { provider, address } = useWallet();
  const delegation = useDelegationToolkitAA();
  const [dcmonBalance, setDcmonBalance] = useState<bigint>(0n);
  const [monBalance, setMonBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!provider || !address) {
      setDcmonBalance(0n);
      setMonBalance(0n);
      return;
    }
    setLoading(true);
    try {
      const dcmonContract = new Contract(CONTRACTS.dcmon, DCMonABI, provider);
      const [dcBal, nativeBal] = await Promise.all([
        dcmonContract.balanceOf(address),
        provider.getBalance(address),
      ]);
      setDcmonBalance(dcBal);
      setMonBalance(nativeBal);
    } catch (err) {
      console.warn("[useBankroll] refresh failed", err);
    } finally {
      setLoading(false);
    }
  }, [provider, address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasDcmonBalance = useCallback(
    async (required: bigint) => {
      if (!provider || !address) return false;
      try {
        const dcmonContract = new Contract(CONTRACTS.dcmon, DCMonABI, provider);
        const balance: bigint = await dcmonContract.balanceOf(address);
        return balance >= required;
      } catch (err) {
        console.warn("[useBankroll] balance check failed", err);
        return false;
      }
    },
    [provider, address]
  );

  const ensureAllowance = useCallback(
    async (spender: string, amount: bigint, opts: EnsureAllowanceOptions = {}) => {
      if (!provider || !address) return false;
      try {
        const dcmonContract = new Contract(CONTRACTS.dcmon, DCMonABI, provider);
        const current: bigint = await dcmonContract.allowance(address, spender);
        if (current >= amount) return true;

        opts.onProgress?.("Approving DCMon...");

        const encoded = dcmonContract.interface.encodeFunctionData("approve", [
          spender,
          MaxUint256,
        ]);

        let approved = false;
        try {
          const hash = await delegation.sendTransaction({
            to: CONTRACTS.dcmon,
            data: encoded,
            value: 0n,
          });
          if (hash) {
            await provider.waitForTransaction(hash);
            approved = true;
          }
        } catch (err) {
          console.warn("[useBankroll] paymaster approval attempt failed", err);
        }

        if (!approved) {
          const signer = await provider.getSigner();
          const writeContract = new Contract(CONTRACTS.dcmon, DCMonABI, signer);
          const tx = await writeContract.approve(spender, MaxUint256);
          await tx.wait();
        }

        await refresh();
        return true;
      } catch (err) {
        console.error("[useBankroll] approval failed", err);
        return false;
      }
    },
    [provider, address, delegation, refresh]
  );

  return {
    dcmonBalance,
    monBalance,
    loading,
    refresh,
    hasDcmonBalance,
    ensureAllowance,
  };
}

export function formatDcmon(balance: bigint, digits = 3) {
  const asNumber = Number(formatEther(balance));
  if (!Number.isFinite(asNumber)) return "0.000";
  return asNumber.toFixed(digits);
}
