'use client';

import { useCallback, useEffect, useState } from "react";
import { Contract, MaxUint256, formatEther } from "ethers";
import { useWallet } from "@/context/WalletContext";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";
import { CONTRACTS } from "@/lib/config";
import { DCMonABI } from "@/abi/dcmon";
import { updateBankrollState } from "./store";

export type EnsureAllowanceOptions = {
  onProgress?: (message: string) => void;
};

export function useBankroll() {
  const { provider, address: eoaAddress } = useWallet();
  const {
    smartAccountAddress,
    ownerAddress: delegationOwner,
    ready: aaReady,
    ensureReady,
    sendTransaction,
  } = useDelegationToolkitAA();
  const [dcmonBalance, setDcmonBalance] = useState<bigint>(0n);
  const [monBalance, setMonBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);

  const ownerAddress = delegationOwner ?? eoaAddress ?? null;
  const activeAddress = smartAccountAddress ?? ownerAddress;

  const refresh = useCallback(async () => {
    if (!provider || !activeAddress) {
      setDcmonBalance(0n);
      setMonBalance(0n);
      updateBankrollState({
        dcmonBalance: 0n,
        monBalance: 0n,
        loading: false,
        activeAddress,
        ownerAddress,
        smartAccountAddress,
      });
      return;
    }
    setLoading(true);
    updateBankrollState({
      loading: true,
      activeAddress,
      ownerAddress,
      smartAccountAddress,
    });
    try {
      const dcmonContract = new Contract(CONTRACTS.dcmon, DCMonABI, provider);
      const [dcBal, nativeBal] = await Promise.all([
        dcmonContract.balanceOf(activeAddress),
        provider.getBalance(activeAddress),
      ]);
      setDcmonBalance(dcBal);
      setMonBalance(nativeBal);
      updateBankrollState({
        dcmonBalance: dcBal,
        monBalance: nativeBal,
        loading: false,
        activeAddress,
        ownerAddress,
        smartAccountAddress,
      });
    } catch (err) {
      console.warn("[useBankroll] refresh failed", err);
      updateBankrollState({
        loading: false,
        activeAddress,
        ownerAddress,
        smartAccountAddress,
      });
    } finally {
      setLoading(false);
      updateBankrollState({
        loading: false,
        activeAddress,
        ownerAddress,
        smartAccountAddress,
      });
    }
  }, [provider, activeAddress, ownerAddress, smartAccountAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!aaReady) return;
    refresh();
  }, [aaReady, refresh]);

  const hasDcmonBalance = useCallback(
    async (required: bigint) => {
      if (!provider || !activeAddress) return false;
      try {
        const dcmonContract = new Contract(CONTRACTS.dcmon, DCMonABI, provider);
        const balance: bigint = await dcmonContract.balanceOf(activeAddress);
        return balance >= required;
      } catch (err) {
        console.warn("[useBankroll] balance check failed", err);
        return false;
      }
    },
    [provider, activeAddress]
  );

  const ensureAllowance = useCallback(
    async (spender: string, amount: bigint, opts: EnsureAllowanceOptions = {}) => {
      if (!provider || !activeAddress) return false;
      try {
        const dcmonContract = new Contract(CONTRACTS.dcmon, DCMonABI, provider);
        const current: bigint = await dcmonContract.allowance(activeAddress, spender);
        if (current >= amount) return true;

        opts.onProgress?.("Approving DCMon...");

        const encoded = dcmonContract.interface.encodeFunctionData("approve", [
          spender,
          MaxUint256,
        ]);

        let approved = false;
        try {
          await ensureReady();
          const hash = await sendTransaction({
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
          if (ownerAddress) {
            const signer = await provider.getSigner();
            const signerAddress = await signer.getAddress();
            if (signerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
              throw new Error("Wallet signer does not match owner account");
            }
            const writeContract = new Contract(CONTRACTS.dcmon, DCMonABI, signer);
            const tx = await writeContract.approve(spender, MaxUint256);
            await tx.wait();
          } else {
            throw new Error("No owner account available for direct approval");
          }
        }

        await refresh();
        return true;
      } catch (err) {
        console.error("[useBankroll] approval failed", err);
        return false;
      }
    },
    [provider, activeAddress, ownerAddress, refresh, ensureReady, sendTransaction]
  );

  return {
    dcmonBalance,
    monBalance,
    loading,
    refresh,
    hasDcmonBalance,
    ensureAllowance,
    activeAddress,
    ownerAddress,
    smartAccountAddress,
    aaReady,
  };
}

export function formatDcmon(balance: bigint, digits = 3) {
  const asNumber = Number(formatEther(balance));
  if (!Number.isFinite(asNumber)) return "0.000";
  return asNumber.toFixed(digits);
}
