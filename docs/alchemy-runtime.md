# Alchemy Smart Account Runtime

This app targets the Alchemy AA SDK (`@alchemy/aa-alchemy`) with a verifying paymaster on Monad. Make sure these environment variables are defined before running `npm run dev` or `npm run build` inside `tavern-next/`:

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_MONAD_BUNDLER_RPC` | HTTPS bundler URL (Alchemy, or your own). Used for the Toolkit + AA client. |
| `NEXT_PUBLIC_ALCHEMY_PAYMASTER_RPC` | HTTPS paymaster URL (optional — omit to fall back to user-funded mode). |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Required when using Alchemy’s bundler/paymaster endpoints. |
| `NEXT_PUBLIC_ALCHEMY_POLICY_ID` | Policy id returned by the Alchemy Gas Manager (omit if not using sponsored gas). |
| `NEXT_PUBLIC_MONAD_RPC` | Fallback RPC used by the realtime/Bankroll modules (defaults to the public testnet RPC). |

The Delegation Toolkit bootstraps with MetaMask’s delegation bundle and instantiates the Alchemy client via `useDelegationToolkitAA`. When sponsorship is disabled, the hook falls back to the signer returned by the connected wallet.

## Local smoke test

1. Copy `.env.example` → `.env.local` (or export vars in your shell) with the values above.
2. Install dependencies if needed: `npm install` (inside `tavern-next/`).
3. Run the dev server: `npm run dev` and open `http://localhost:3000`.
4. Connect a wallet in the header, then:
   - Visit `/games/poker`, buy in, and take a seat.
   - Visit `/games/hazard` and place a wager.
   - Visit `/games/shell` and place a wager.
   Each transaction should go through the paymaster if the Gas Manager policy has a sufficient allowance; otherwise the hook will automatically fall back to the wallet signer.

## Production checklist

- Provide the same environment variables on your hosting platform (`NEXT_PUBLIC_*` are safe to expose to the client).
- Ensure the verifying paymaster private key (`VERIFYING_PAYMASTER_SIGNER_PK`) is set on the Node runtime serving `/api/paymaster/sign`.
- Fund the signer with enough MON to cover reimbursed gas if your Gas Manager policy is inactive.
- Update `DEPLOYMENT.md` / release notes with the commit hash, bundler URL, and policy id used for the deploy.
