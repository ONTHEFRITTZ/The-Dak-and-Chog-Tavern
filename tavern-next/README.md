# Tavern Next

React / Next.js port of the Dak & Chog Tavern experience. The app targets the Monad testnet and relies on the MetaMask Delegation Toolkit for every 4337 user operation. Frontend smart-account calls delegate to the `/api/paymaster/sign` route so the verifying paymaster can attach signatures before the bundler submission.

## Prerequisites

- Node.js 18+
- Monad testnet wallet with DCMon balance for manual fallback transactions
- Paymaster signer (ECDSA private key) that can cover sponsored executions

## Environment

Create a `.env.local` in `tavern-next/` with the following variables:

| Key | Required | Description |
| --- | --- | --- |
| `MONAD_RPC_URL` | ✓ | HTTP RPC used server-side by the paymaster route |
| `VERIFYING_PAYMASTER_SIGNER_PK` | ✓ | Private key for the verifying paymaster signer |
| `VERIFYING_PAYMASTER_ADDR` | ✓ | Paymaster contract address that validates signatures |
| `NEXT_PUBLIC_MONAD_RPC` | ✓ | Client-facing RPC endpoint for viem / ethers |
| `NEXT_PUBLIC_MONAD_WS` | ✓ | WebSocket endpoint for realtime wallet polling |
| `NEXT_PUBLIC_MONAD_BUNDLER_RPC` | ✓ | Bundler RPC used by the Delegation Toolkit |
| `NEXT_PUBLIC_PAYMASTER_ADDRESS` | ✓ | Address echoed back to the aaClient window helpers |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | optional | If using Alchemy for fallback toolkit flows |
| `NEXT_PUBLIC_ALCHEMY_BUNDLER_RPC` | optional | Alchemy Smart Account bundler URL override |
| `NEXT_PUBLIC_ALCHEMY_PAYMASTER_RPC` | optional | Alchemy paymaster URL override |

> The frontend imports `/js/aaClient.js` which reads these `NEXT_PUBLIC_*` values at runtime. The custom hook `useDelegationToolkitAA` always initialises the toolkit with `paymasterUrl = "/api/paymaster/sign"` so 4337 sponsorship runs through the verifying paymaster whenever it is enabled.

## Development

```bash
cd tavern-next
npm install
npm run dev
```

Navigate to [http://localhost:3000](http://localhost:3000). Socket.IO connections proxy through `MONAD_BUNDLER_RPC` and expect the realtime server to be running (see `/server/realtime.js` in the root repo).

### Poker Workflow

- `/games/poker` displays the lobby sourced from realtime `lobby:list` events. Tables with `tableMode === "onchain"` will route buys and seat actions through the Delegation Toolkit + verifying paymaster.  
- `/games/poker/table/[tableId]` mirrors the on-chain table flow. Seat joins/unseats call `HoldemPoker` contract methods, contributions are sent through the shared bankroll helper, and Socket.IO actions (`poker:act`) stay in sync with the legacy server.

### Tooling

- `npm run lint` (ESLint) — legacy static assets still produce warnings; the Next.js source must stay clean before shipping.
- `npm run build` — validates the app router build.

## Paymaster Endpoint

`app/api/paymaster/sign/route.ts` signs a normalized `userOperation` payload using `VERIFYING_PAYMASTER_SIGNER_PK`. The hook `useDelegationToolkitAA` injects the endpoint into the MetaMask Delegation Toolkit so that every `client.sendTransaction` waits for `waitForUserOperationReceipt` before resolving.

## Testing Considerations

- If the paymaster rate-limits or returns errors, the hooks fall back to the connected EOA signer. Ensure the selected account has enough MON for manual confirmation.
- When using gas sponsorship, confirm that the signer wallet holds MON for covering user operations and DCMon for table buy-ins.
