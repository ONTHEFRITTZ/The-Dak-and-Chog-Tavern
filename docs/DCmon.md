# DCmon (Dak & Chog Monad LST)

## Goals
- Create a liquid staking token (DCmon) that the Tavern uses as the unified in-game currency.
- Capture MON staking yield and distribute it 70% to the house and 30% to an incentive pool for top players.
- Keep compatibility with Mission 8 account-abstraction (AA) features: bundler, paymaster, Smart Accounts.
- Support seamless buy-in/cash-out, swapping through Phantom/MetaMask, and programmatic paymaster refills.

## Developer Toolkit

### Hardhat
- Compile/tests: `cd hardhat && npm install` (once) then `npx hardhat test test/DCMon.test.cjs`.
- Deploy: `npx hardhat run scripts/deploy-dcmon.js --network <net>` (requires `DCMON_UNDERLYING_ADDR`, `DCMON_HOUSE_TREASURY`, `DCMON_PLAYER_REWARD_POOL`, optional `DCMON_ADMIN_ADDR`).
- Verify: `npx hardhat run scripts/verify-dcmon.js --network <net>` with `DCMON_TOKEN_ADDR` in `.env`.
- Deployment info written to `hardhat/deployments/dcmon-<network>.json`.

### Server Agent
- `cd server && npm install`
- `.env` variables prefixed `DCMON_...` (see `.env.example`).
- `npm run agent` ? runs the dry-run loop.
- `npm run swap:add` ? append a swap entry for testing queue processing.

## High-Level Architecture

1. **DCmon Token Contract**
   - ERC-20 (via OpenZeppelin) with deposit and withdraw for underlying MON.
   - `recordRewards` function accepts staking rewards (MON) from the operator and splits automatically (70/30).
   - Optional `distributePlayerReward` helper moves funds from the player pool to reward recipients.
   - Contract lives at `Contracts/DCMon.sol` (new file added in this patch).

2. **Agent / Backend Worker**
   - Handles swaps: MON/USDC ↔ DCmon, using Mandelbrot/Monad DEX once available. Initially, we can rely on a liquidity provider or mock swap route.
   - Monitors paymaster balance. When low, converts a portion of DCmon to MON (or native) and funds the paymaster account.
   - Calls `recordRewards` when staking rewards are harvested.
   - Maintains an encrypted audit log of all swaps/payouts. The key is derived from the owner wallet; only the house can decrypt.

3. **On-Chain Games**
   - Update `HoldemPoker.sol` (and other games) to accept DCmon for buy-ins.
   - Chips/tracking: maintain seat balances in DCmon or convert to numeric chips pegged to DCmon price. Future improvement: support dynamic pricing if DCmon deviates from MON.

4. **Frontend**
   - Buy-in modal offers DCmon by default; for on-chain seats, user can buy/convert during the flow.
   - Add swap widget: DCmon ↔ USDC/MON using Phantom or MetaMask.
   - Display staked balance, estimated APY, and reward pool stats.

5. **Wallet/AA Integration**
   - Keep using Mission 8 flows: bundler, paymaster, and wallet selection (Phantom EVM, MetaMask).
   - During buy-in, the AA Smart Account can call the swap contract, deposit DCmon, then sit.
   - Paymaster operations remain the same; the agent simply sources gas tokens from DCmon liquidity.

6. **Reward Pool Distribution**
   - On-chain or off-chain logic to determine “top players” in each epoch.
   - Admin/keeper triggers `distributePlayerReward` for the winners.
   - Rewards can be paid in DCmon or converted to MON/USDC first.

## Immediate Implementation Notes

- `DCMon.sol` currently mints/burns 1:1 with underlying MON. Adjust exchange rate later when a staking contract is integrated (e.g., via shares and total underlying tracking).
- The contract assumes the operator will transfer rewards in MON. Good enough for MVP – swap logic can be refined.
- Logging/encryption: backend needs to persist encrypted JSON entries. Recommend libsodium/TweetNaCl with a key stored offline.
- Swap path: initially stub with a simple swap contract or direct treasury-controlled liquidity; later integrate Monad DEX (when available).
- Ensure paymaster funding logic is unit-tested to avoid runbook surprises.

## Next Steps

1. Update Hardhat config to compile `DCMon.sol`; add tests for deposit/withdraw/rewards.
2. Wire the agent (Node script or server worker) to use the new contract (deposit rewards, handle swaps, paymaster funding).
3. Modify game smart contracts and backend realtime server to track DCmon balances.
4. Extend frontend buy-in flow and wallet swap UI.
5. Define reward distribution cadence (weekly? monthly?) and the logic for identifying top users.

This document serves as the initial blueprint. As we build out the modules, we should capture runbooks (deploy, swap, paymaster refill) in `/docs/ops/DCmon-runbook.md` (to be added).

## Agent Implementation Status

- Added `server/dcmon-agent.js` (dry-run mode by default)
  - Loads env configuration, generates encrypted audit logs, stubs for swaps/paymaster funding.
  - Run locally with `npm install` inside `server/` then `npm run agent`.
- Agent currently records intent only; TODOs remain for actual swap execution and staking reward pulls.

Next: hook the agent into swap / paymaster services and wire realtime server to DCmon balances.
### Agent Usage

1. Copy `server/.env.example` to `.env` and fill in DCmon addresses, paymaster, and RPC URL.
2. Install deps (`cd server && npm install`).
3. Start the agent in dry mode (`npm run agent`). It will:
   - Check paymaster balance and log top-up intent.
   - Check staking rewards (`recordRewards`) and log intent.
   - Process the swap queue file.
4. Use `npm run swap:add` to enqueue a sample swap while testing.

When liquidity routes are ready:
- Implement real swaps in `processSwapQueue`.
- Implement `recordRewards` call in `harvestStakingRewards`.
- Integrate paymaster funding transaction in `ensurePaymasterBalance`.

Logs are stored under `artifacts/dcmon-agent/operations.log`; set `DCMON_LOG_ENC_KEY` to encrypt entries.
