# Changelog

All notable changes are recorded here so you (and Codex) can quickly pick up where things left off.

## 2025-10-05

- DCmon: Added liquid staking token contract, Hardhat unit tests, and deployment scripts (`deploy-dcmon.js`, `verify-dcmon.js`).
- Agent: Introduced `server/dcmon-agent.js` with encrypted audit logging, swap queue, paymaster/reward scaffolding, and CLI helper (`npm run swap:add`).
- Frontend/Realtime: Guest address fallback for F2P seats (no more “Seating...” stalls without a wallet).
- Docs: Expanded `docs/DCmon.md` with Hardhat/agent usage instructions and runbooks.
- Tooling: Hardhat + server package updates to include OpenZeppelin, ethers, dotenv, and pino dependencies.
## 2025-09-07

- CI/CD: Added rebuilt workflow `.github/workflows/deploy_rebuilt.yml` with stable staging tarball, atomic release, Cloudflare HTML purge, and live verification.
- Local deploy: Added `deploy_quick.ps1` (atomic uploads to common docroots) and hardened `deploy.ps1` error handling.
- Asset versioning: All major pages now load CSS/JS with `?v=<commit>` to bust cache.
- Banner: Network + contract info now shows in the top banner via `renderTavernBanner` updates.
- Pool awareness: Coin Flip and Hazard preflight checks read Pool balance when configured; clearer revert reasons.
- Admin: Added Set Pool controls, shows Pool address, and new Site Health section (build.json, deploy marker, whoami).
- Navigation: Standardized "Return to Tavern" buttons to use root-relative `/index.html`.
- Hazard layout: Increased top padding to avoid logo overlap with main selector.
- Cleanup: Removed obsolete `temp_admin.js`; left future assets in place.
- README: Rewritten to reflect rebuilt deploy flow, Cloudflare purge, Pool admin, and health checks.

## 2025-09-07 (later)

- Whitelist: Deployed address recorded for Monad Testnet (10143) and wired into config: `0xB5e34B3C6c66aE92FC2999413eeb0D7d51122eA3`.
- Landing gate: ensured WhitelistABI loads before gating; wallet + whitelist required past landing.
- Admin: Whitelist card for add/remove/bulk and address override.
