# DCmon Agent Runbook

## Overview
The DCmon agent keeps the Monad bankroll solvent by:
- maintaining DCMon and WMON balances inside `BankrollPool`
- wrapping/approving tokens on the owner wallet
- topping up the AA paymaster with native MON
- harvesting staking rewards via `recordRewards`
- processing queued jobs (`buyin`, `cashout`, `pool_*`, `paymaster`)

All actions are logged to `server/artifacts/dcmon-agent/operations.log`. When `DCMON_LOG_ENC_KEY` is configured, payloads are AES-GCM encrypted (AES-256) with a key derived from the provided hex secret.

## Environment
Copy `server/.env.example` to `server/.env` and fill in:

| Variable | Description |
| --- | --- |
| `DCMON_RPC_URL` | Monad RPC endpoint the agent will use |
| `DCMON_TOKEN_ADDR` / `DCMON_WMON_ADDR` / `DCMON_POOL_ADDR` | DCMon, WMON, BankrollPool addresses |
| `DCMON_OPERATOR_PK` | Private key for the pool owner / DCMon operator (hex) |
| `DCMON_PAYMASTER_ADDR` | Account abstraction paymaster address |
| `DCMON_*THRESHOLD*` | Pool, paymaster, and reward automation knobs |
| `DCMON_WRAP_MAX_CHUNK` | (Optional) cap for a single wrap/deposit transaction |
| `DCMON_LOG_ENC_KEY` | Secret used to encrypt audit log payloads |
| `DCMON_DRY_RUN` | Set to `false` in production |

See `.env.example` for sane defaults.
Monad testnet RPC: https://testnet-rpc.monad.xyz

## Deployment (EC2)
```
cd ~/The-Dak-and-Chog-Tavern
npm install --production --prefix server
pm2 start ecosystem.config.js --only dcmon-agent
pm2 save
```

To reload after configuration changes:
```
pm2 restart dcmon-agent --update-env && pm2 logs dcmon-agent --lines 50
```

## Routine Operations

### Check status
- `pm2 status dcmon-agent`
- Tail encrypted/plain logs: `tail -f artifacts/dcmon-agent/operations.log`
- Inspect queue: `cat artifacts/dcmon-agent/queue.json`

### Queue a manual job
```
cd server
npm run swap:add
# type options: paymaster, buyin, cashout, pool_deposit, pool_redeem
# amount accepts decimal MON or wei
```

### Force a paymaster top-up
Enqueue a `paymaster` job with the desired amount or temporarily lower `DCMON_PAYMASTER_MIN` and restart the agent.

### Manually deposit DCMon
Use the admin panel (`/admin`) or enqueue a `pool_deposit` job with the amount (wei) the agent should wrap/deposit.

## Threshold Guidance
- **Pool**: set `DCMON_POOL_TARGET_DCMON` to the desired baseline DCMon balance. `DCMON_POOL_MIN_DCMON` acts as a floor when redeeming for cash-outs.
- **Underlying buffer**: `DCMON_POOL_TARGET_UNDERLYING` controls how much WMON stays idle in the pool for immediate payouts.
- **Paymaster**: keep `DCMON_PAYMASTER_TARGET` at least 2x the expected AA gas burn between checks. Use `DCMON_PAYMASTER_CHUNK` to limit per-cycle funding.
- **Rewards**: choose a payout cadence via `DCMON_REWARD_MIN` (threshold) and `DCMON_REWARD_TARGET` (max per invocation). `DCMON_REWARD_KEEP_WMON` protects a local WMON reserve for pool deposits.

## Troubleshooting
- **Agent exits immediately**: ensure `DCMON_OPERATOR_PK` and `DCMON_RPC_URL` are set and the wallet owns `BankrollPool` + `OPERATOR_ROLE` on DCMon.
- **Repeated `insufficient WMON` warnings**: wallet lacks native MON. Top up the operator wallet or redeem WMON manually via `/admin`.
- **Paymaster top-up fails**: verify paymaster address is correct and not a contract rejecting transfers.
- **Queue stuck in `processing`**: check `operations.log` for the `swap_failed` entry, resolve cause, then set the job back to `pending` in `queue.json`.
- **Encrypted logs**: to decrypt, use the same `DCMON_LOG_ENC_KEY` hex secret and AES-256-GCM (IV/tag are stored per entry).

## Disaster Recovery
1. Stop the agent: `pm2 stop dcmon-agent`.
2. Use the admin panel to perform emergency manual operations (wrap/unwap, deposit, redeem).
3. Restore from queue snapshot if needed (`queue.json` is idempotent).
4. Re-apply `.env` secrets and restart `pm2`.

## References
- `docs/DCmon.md` - architecture + configuration context
- `docs/deploy.md` - front-end/realtime deployment steps
- `DEPLOYMENT.md` - EC2 pull-based deploy script

