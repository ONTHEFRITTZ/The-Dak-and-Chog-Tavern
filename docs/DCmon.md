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

### Wrapped Monad (WMON)
- Contract: `Contracts/WMON.sol` (WETH9-style wrapper).
- Users or the agent call `deposit()` with native MON to mint WMON 1:1; `withdraw(amount)` unwraps back to native MON.
- Deploy WMON first, then pass its address to the DCMon and BankrollPool constructors.

### Admin Panel Treasury Card
- Available at `/admin` once the front-end is deployed; connect the owner signer.
- Displays wallet/pool balances for WMON and DCMon plus active allowances to the pool and DCMon contract.
- Owner controls: wrap/unwrap MON, approve pool/DCMon, deposit underlying, redeem DCMon, deposit/redeem to the owner wallet, and record rewards.
- Every successful tx clears its input and triggers a refresh, making the panel safe for manual interventions between automation runs.

### Current Monad Testnet Deployment
- WMON: 0x7b4E8B2a3E934701D8bF6cFB31C3f3BDaC5e30Ff
- DCMon: 0xF81592Eb0B6811eF655676Ba77625bD3Db7c6C92
- BankrollPool: 0x31574064907cbE75C61Fea28C545264817A9AA4a
- Player reward wallet: 0xCe1C5bb15041361D6Ab22aAFb3887dD28D05a16E
- Faro: 0x953f1Bba2eeEa57482037377BD5103cEbA85C987
- Hazard: 0xb0103807b4B758945331BF6783873Cd776037f89
- Shell: 0x7Ff5A1b0d71eE4C66D24121D2E68D7844704D377
- DakChog: 0xa8F48cccE4968F5bf40f3411B2265cEBDB517ADf
- HoldemPoker: 0x681BADA5D0d012ABEB9f8A8F0E38758396DE0db3

### Server Agent
- `cd server && npm install`
- Copy `.env.example` to `.env` and fill in WMON/DCMon/Pool/Paymaster details (see new automation knobs).
- `npm run agent` starts the automation loop locally. On EC2 use PM2: `pm2 start server/dcmon-agent.js --name dcmon-agent` (see runbook).
- `npm run swap:add` opens an interactive prompt to enqueue buy-in, cash-out, pool, or paymaster jobs for the queue processor.

## High-Level Architecture

1. **DCmon Token Contract**
   - ERC-20 (via OpenZeppelin) with deposit and withdraw for underlying WMON (wrapped Monad native).
   - `recordRewards` accepts staking rewards (WMON) from the operator and splits automatically (70/30) to the configured treasuries.
   - Optional `distributePlayerReward` helper moves funds from the player pool to reward recipients.

2. **Agent / Backend Worker**
   - Automates pool funding: wraps native MON as needed, maintains approvals, and deposits WMON into the BankrollPool when DCMon liquidity drops below targets.
   - Maintains a WMON buffer in the pool for cash-outs by redeeming DCmon back to WMON when thresholds are breached.
   - Tops up the AA paymaster by withdrawing or unwrapping WMON and sending native MON whenever balance falls below the configured minimum (supports chunking to limit spend).
   - Records staking rewards by calling `recordRewards` once the operator wallet accumulates the minimum payout threshold.
   - Processes a swap queue (buy-in, cash-out, pool_deposit/pool_redeem, paymaster) with encrypted audit logging for every action.

3. **On-Chain Games**
   - `BankrollPool` authorises games to request DCmon payouts; games interact with the pool rather than holding treasury balances directly.
   - Chips/tracking: maintain seat balances in DCmon or convert to numeric chips pegged to DCmon price. Future improvement: support dynamic pricing if DCmon deviates from MON.

4. **Frontend**
   - Buy-in modal offers DCmon by default; for on-chain seats, user can buy/convert during the flow.
   - Add swap widget: DCmon <-> USDC/MON using Phantom or MetaMask.
   - Display staked balance, estimated APY, and reward pool stats.

5. **Wallet/AA Integration**
   - Keep using Mission 8 flows: bundler, paymaster, and wallet selection (Phantom EVM, MetaMask).
   - During buy-in, the AA Smart Account can call the swap contract, deposit DCmon, then sit.
   - Paymaster operations remain the same; the agent simply sources gas tokens from DCmon liquidity.

6. **Reward Pool Distribution**
   - On-chain or off-chain logic to determine "top players" in each epoch.
   - Admin/keeper triggers `distributePlayerReward` for the winners.
   - Rewards can be paid in DCmon or converted to MON/USDC first.

## Immediate Implementation Notes
- The agent requires the operator wallet to be the owner of `BankrollPool` and to hold the DCMon operator role.
- Configure automation thresholds via `.env` (see `.env.example`). Defaults keep a small native reserve, avoid infinite approvals when `DCMON_APPROVE_MAX=false`, and chunk large wraps if `DCMON_WRAP_MAX_CHUNK` is set.
- All actions are logged to `artifacts/dcmon-agent/operations.log`. Provide `DCMON_LOG_ENC_KEY` (32+ chars) to enable AES-GCM encrypted log payloads.
- Queue jobs persist to `artifacts/dcmon-agent/queue.json`. This survives restarts; PM2 will resume pending jobs automatically.

## Agent Automation Details
- **Pool liquidity**: checks DCMon and underlying WMON balances every `DCMON_POOL_INTERVAL_MS` (10 minutes by default) and wraps/approves/deposits to reach `DCMON_POOL_TARGET_DCMON`. Also redeems to maintain a WMON buffer (`DCMON_POOL_TARGET_UNDERLYING`).
- **Paymaster**: runs every `DCMON_PAYMASTER_INTERVAL_MS` (5 minutes). If balance < `DCMON_PAYMASTER_MIN`, withdraws or wraps up to `DCMON_PAYMASTER_TARGET` (bounded by `DCMON_PAYMASTER_CHUNK`) and sends native MON.
- **Reward harvesting**: when operator WMON balance minus `DCMON_REWARD_KEEP_WMON` exceeds `DCMON_REWARD_MIN`, the agent approves and calls `recordRewards` with up to `DCMON_REWARD_TARGET`.
- **Swap queue**: processed every `DCMON_SWAP_INTERVAL_MS` (60 seconds). Supported types:
  - `buyin`: wrap + mint DCMon to the supplied address (defaults to operator wallet).
  - `cashout`: redeem liquidity and send native MON to the supplied address.
  - `pool_deposit` / `pool_redeem`: manual overrides for liquidity maintenance.
  - `paymaster`: forces a paymaster top-up with the queued amount.

For operational steps (PM2, log rotation, manual overrides) see `docs/ops/DCmon-runbook.md`.

## Next Steps
1. Integrate on-chain swap routes (MON/USDC -> DCmon) once Monad DEX liquidity is available; map new job types in the agent.
2. Extend the front-end buy-in modal to surface agent-driven buy-in/cashout requests (feed swap queue via admin controls).
3. Add monitoring/alerting (CloudWatch or Grafana) for paymaster and pool thresholds using the log stream.
4. Define the reward distribution cadence and implement automated calls to `distributePlayerReward`.

