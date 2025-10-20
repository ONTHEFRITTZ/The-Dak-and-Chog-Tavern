'use client';

import { useCallback, useMemo } from "react";
import { Contract, Interface, parseUnits } from "ethers";
import { useWallet } from "@/context/WalletContext";
import { useDelegationToolkitAA } from "@/modules/aa/useDelegationToolkitAA";
import { useBankroll } from "@/modules/bankroll";
import { CONTRACTS } from "@/lib/config";
import { HoldemPokerABI } from "@/abi/holdemPoker";

export type HoldemActionOptions = {
  onProgress?: (message: string) => void;
};

export type ContributeChipsParams = HoldemActionOptions & {
  seatId: number;
  chips: number;
  chipValueDcmon: number;
};

export type HoldemSeatParams = HoldemActionOptions & {
  seatId: number;
  duringHand?: boolean;
};

export function useHoldemPokerActions() {
  const { provider, address } = useWallet();
  const delegation = useDelegationToolkitAA();
  const { ensureAllowance, hasDcmonBalance } = useBankroll();

  const contractInterface = useMemo(() => new Interface(HoldemPokerABI as any), []);

  const submitTransaction = useCallback(
    async (
      method: "joinSeat" | "unseat" | "leaveDuringHand" | "contribute",
      args: unknown[],
      opts: HoldemActionOptions = {}
    ) => {
      if (!provider || !address) {
        throw new Error("Connect wallet to continue.");
      }

      const data = contractInterface.encodeFunctionData(method, args);
      let confirmed = false;

      try {
        const hash = await delegation.sendTransaction({
          to: CONTRACTS.pokerTable,
          data,
          value: 0n,
        });
        if (hash) {
          opts.onProgress?.("Waiting for paymaster confirmation...");
          await provider.waitForTransaction(hash);
          confirmed = true;
        }
      } catch (err) {
        console.warn(`[useHoldemPokerActions] ${method} via AA failed`, err);
      }

      if (!confirmed) {
        const signer = await provider.getSigner();
        const fallbackContract = new Contract(CONTRACTS.pokerTable, HoldemPokerABI, signer);
        opts.onProgress?.("Submitting with wallet signer...");
        const tx = await (fallbackContract as any)[method](...args);
        opts.onProgress?.("Waiting for confirmation...");
        await tx.wait();
        confirmed = true;
      }

      return confirmed;
    },
    [provider, address, delegation, contractInterface]
  );

  const joinSeat = useCallback(
    async ({ seatId, onProgress }: HoldemSeatParams) => {
      if (!Number.isInteger(seatId) || seatId < 0) {
        throw new Error("Seat unavailable.");
      }
      onProgress?.("Joining seat...");
      await submitTransaction("joinSeat", [seatId], { onProgress });
    },
    [submitTransaction]
  );

  const leaveSeat = useCallback(
    async ({ seatId, duringHand, onProgress }: HoldemSeatParams) => {
      if (!Number.isInteger(seatId) || seatId < 0) {
        throw new Error("You are not seated.");
      }
      const method = duringHand ? "leaveDuringHand" : "unseat";
      onProgress?.(duringHand ? "Leaving seat during hand..." : "Leaving seat...");
      await submitTransaction(method, [seatId], { onProgress });
    },
    [submitTransaction]
  );

  const contributeChips = useCallback(
    async ({ seatId, chips, chipValueDcmon, onProgress }: ContributeChipsParams) => {
      if (!Number.isFinite(chips) || chips <= 0) return;
      if (!provider) throw new Error("Connect wallet to continue.");
      if (chipValueDcmon <= 0) throw new Error("Invalid chip valuation.");

      const dcmonAmount = chips * chipValueDcmon;
      const formatted = Math.max(dcmonAmount, 0).toFixed(9);
      const amountWei = parseUnits(formatted, 18);

      const enough = await hasDcmonBalance(amountWei);
      if (!enough) {
        throw new Error("Insufficient DCMon balance for this action.");
      }

      const allowanceOk = await ensureAllowance(CONTRACTS.pokerTable, amountWei, {
        onProgress,
      });
      if (!allowanceOk) {
        throw new Error("DCMon approval failed.");
      }

      onProgress?.("Submitting contribution...");
      await submitTransaction("contribute", [seatId, amountWei], { onProgress });
    },
    [ensureAllowance, hasDcmonBalance, provider, submitTransaction]
  );

  return {
    joinSeat,
    leaveSeat,
    contributeChips,
  };
}
