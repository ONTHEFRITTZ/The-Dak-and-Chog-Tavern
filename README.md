The Dak & Chog Tavern — v1.1 Stable Online Multiplayer

Overview
- Version: 1.1 — Stable Online Multiplayer
- On-chain games: Tavern router (Shell, Hazard, Dak & Chog) + Faro (with rake)

Architecture
- Static site hosted on Ubuntu (AWS EC2) with NGINX
- Games call a unified Tavern router (pooled) and/or Faro directly
- Liquidity held in BankrollPool; Tavern pays winners via Pool.pay()
- Admin page (/admin/) can Set Pool on Tavern, Authorize games in Pool, and shows Site Health

Deployment
1) CI/CD (recommended)
   - Workflow: .github/workflows/deploy_rebuilt.yml
   - Required repo secrets:
     - SSH_HOST, SSH_USER, SSH_KEY, SSH_PORT (optional)
     - REMOTE_PATH=/var/www/thedakandchog.xyz/html  (confirmed live docroot)
     - DEPLOY_DOMAIN=thedakandchog.xyz
   - Optional (Cloudflare purge of HTML after each deploy):
     - CF_ZONE_ID (from domain Overview)
     - CF_API_TOKEN (custom token: Zone → Cache Purge=Purged, Zone → Read)
   - Triggers: push to main, or Run workflow manually
   - What it does: builds a staged tarball, uploads to server, atomic release into REMOTE_PATH, writes /assets/deploy_check.txt, purges HTML at the edge (if configured), verifies live

2) Local quick deploy (PowerShell)
   - One-shot script (atomic) to common webroots:
     .\deploy_quick.ps1 -Server ELASTIC_IP -User ubuntu -IdentityFile C:\\keys\\The-Dak-and-Chog.pem
     - Use -Paths to target a single docroot once you’ve confirmed it
   - Verifies via /assets/deploy_check.txt

3) Classic script (PowerShell)
   - .\deploy.ps1 -Host ELASTIC_IP -User ubuntu -IdentityFile C:\\keys\\The-Dak-and-Chog.pem
   - Uploads directories then atomically swaps into place

Post-deploy verification
- https://thedakandchog.xyz/assets/deploy_check.txt → shows “<commit> @ <UTC time>”
- https://thedakandchog.xyz/assets/build.json → shows latest commit/time
- Hard refresh pages (Shift + Reload)

Cloudflare (optional but recommended)
- Add A records (orange clouds) for @ and www to your EC2 IP in Cloudflare DNS
- SSL/TLS: start with “Full”; later upgrade to “Full (strict)” with an origin cert
- Cache Rules: optionally bypass HTML caching (keep JS/CSS/image caching)

Pool & Admin
- BankrollPool.sol holds house funds and only pays if the caller (game) is authorized
- Authorize games in the Pool: Admin → Liquidity Pool → Authorize Game
- Link Tavern router to the Pool: Admin → Tavern → Set Pool Address on Tavern (owner only)
- Fund the Pool: Admin → Liquidity Pool → Fund (or send native coin to the Pool address)
- Site Health (Admin): shows build.json, deploy marker, and whoami

Address configuration
- js/config.js resolves per-chain addresses via ADDRESS_BOOK
- Temporary overrides for testing:
  localStorage.setItem('contract.tavern','0x...')
  localStorage.setItem('contract.faro','0x...')
  localStorage.setItem('contract.pool','0x...')
  location.reload()

Frontend
- ABI files: js/TavernABI.js, js/FaroV3ABI.js, js/PoolABI.js
- Versioned loaders on all pages ensure fresh CSS/JS after deploys
- Return to Tavern buttons use root-relative navigation (/index.html)
- Hazard uses the “standard” dice set (assets/images/dice/standard)

Notes & tips
- If a game shows “Rejected: not authorized”, authorize its router/contract in the Pool and ensure Tavern is linked to the Pool
- If a game shows “Bankroll too low”, fund the Pool (pooled games require ≥ 2× wager in Pool)
- If HTML looks stale after a green deploy, verify the live marker; if it’s fresh, purge CDN HTML once or enable the purge step in CI

