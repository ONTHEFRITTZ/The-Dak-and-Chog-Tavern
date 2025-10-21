# Launch Plan - Next.js Tavern Upgrade

## Environments & Access

- **Production target**: Vercel (preferred) or self-hosted Node runtime behind Coroutine.
- **Secrets**: provision `NEXT_PUBLIC_*` client variables plus server-only keys (`VERIFYING_PAYMASTER_SIGNER_PK`, `MONAD_RPC_URL`, `MONAD_PAYER_PK`, `ALCHEMY_API_KEY`, `ALCHEMY_POLICY_ID`).
- **Smart account infra**: ensure Alchemy Paymaster + Bundler endpoints are live and whitelisted for the Tavern domain.
- **Socket services**: confirm poker realtime service + bankroll indexer reachable from the chosen hosting environment.

## Preflight Checklist

- [ ] Polish responsive QA on physical devices (iOS Safari, Android Chrome, iPad) for: home, blackjack, hazard, shell, poker lobby/table, bankroll overlays.
- [ ] Resolve lint blockers (`any` usage in AA hooks, WalletContext, realtime hooks) and trim unused vendor code.
- [ ] Fix Turbopack build errors:
  - Normalise `src/app/globals.css` formatting so comments and selectors parse cleanly.
  - Replace CDN imports in `src/vendor/metamask-delegation-toolkit.mjs` with npm sources (`@metamask/delegation-toolkit`) or local bundles; ensure `viem/account-abstraction` dependency installed.
- [ ] Run `npm run lint` and `npm run build` cleanly.
- [ ] Execute on-chain smoke tests on Monad testnet: bankroll refresh, hazard roll, shell reveal, blackjack hand (AA and fallback).
- [ ] Verify `/api/paymaster/sign` signatures with the production signer key.
- [ ] Snapshot env files and config docs in 1Password / secrets manager.

## Cutover Steps

1. Tag the repository (branch nextjs-migration -> tag release/<date>), produce release notes.
2. Trigger GitHub Actions CI (or manual `npm ci && npm run build`) to generate production bundle.
3. Deploy to staging (Vercel preview or staging server) with production-like env vars.
4. Run regression walkthrough (wallet connect/disconnect, bankroll refresh, each game bet).
5. Flip DNS or promote deployment.
6. Announce downtime window on Tavern Discord/twitter if any on-chain migrations required.

## Post-Launch Monitoring

- Setup Logflare / Vercel Analytics for API error rates (focus on `/api/paymaster/sign`, `/api/socket`).
- Track AA sponsorship success rate and fallbacks in Alchemy dashboard.
- Watch bankroll widget polling for throttling or stale data (consider exponential backoff telemetry).
- Monitor CDN asset cache warm-up (hero images, poker table art).
- Maintain incident runbook with quick rollback steps (redeploy static legacy site if needed).

## Follow-up Tasks

- Integrate Blackjack assets once art delivered.
- Add automated E2E smoke tests (Playwright) for key flows.
- Document paymaster signer rotation and bundler failover procedures.
- Coordinate marketing launch (blog post, hackathon submission updates).
