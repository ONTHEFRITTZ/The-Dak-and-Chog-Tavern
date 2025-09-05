The Dak & Chog Tavern — Deploy Guide

Overview
- Static site hosted on Ubuntu (AWS EC2) with Nginx and Let’s Encrypt.
- Local deploy via PowerShell script.
- CI/CD via GitHub Actions: staging (auto), production (approval).
- On-chain: Tavern (Shell, Hazard, Coin). New: Faro with rake per round.

Prereqs
- Domain DNS (GoDaddy):
  - A: @ → Elastic IP
  - CNAME: www → thedakandchog.xyz
  - Optional staging: CNAME staging → thedakandchog.xyz (or A → Elastic IP)
- EC2: Ubuntu 22.04/24.04, security group allows 22, 80, 443.
- SSH key (.pem) for EC2.

Bootstrap Server (run once on EC2)
1) Copy script: scp -i C:\path\to\aws.pem scripts/bootstrap-ubuntu.sh ubuntu@ELASTIC_IP:/tmp/
2) Production only:
   ssh -i C:\path\to\aws.pem ubuntu@ELASTIC_IP "sudo bash /tmp/bootstrap-ubuntu.sh thedakandchog.xyz you@example.com"
3) Production + staging:
   ssh -i C:\path\to\aws.pem ubuntu@ELASTIC_IP "sudo bash /tmp/bootstrap-ubuntu.sh thedakandchog.xyz you@example.com --with-staging --staging-subdomain staging"

Local Deploy
- Production:
  .\deploy.ps1 -Host ELASTIC_IP -User ubuntu -IdentityFile C:\path\to\aws.pem
- Staging:
  .\deploy.ps1 -Host ELASTIC_IP -User ubuntu -IdentityFile C:\path\to\aws.pem -Domain staging.thedakandchog.xyz
- Behavior: Uploads to temp dir and atomically swaps into place.

GitHub Actions (CI/CD)
- Production workflow: .github/workflows/deploy.yml
  - Secrets: SSH_HOST, SSH_USER, SSH_KEY, SSH_PORT (opt), REMOTE_PATH=/var/www/thedakandchog.xyz/html
  - Environment: production (requires approval). URL set to https://thedakandchog.xyz
  - Triggers: push to main (web assets only) or manual dispatch
- Staging workflow: .github/workflows/deploy-staging.yml
  - Secrets: STAGING_SSH_HOST, STAGING_SSH_USER, STAGING_SSH_KEY, STAGING_SSH_PORT (opt), STAGING_REMOTE_PATH=/var/www/staging.thedakandchog.xyz/html
  - Triggers: push to staging (web assets only) or manual dispatch

Notes
- Ensure DNS propagates before running Certbot (bootstrap) or visiting the site.
- To rotate keys, update repo secrets and your EC2 authorized_keys.
- For dynamic backends later, keep Nginx as reverse proxy and add a systemd/pm2 service for the app.

On-Chain Contracts
- Contracts/Tavern.sol: Shell, Hazard, Dak & Chog (coin) — dev randomness.
- Contracts/Faro.sol: Simplified Faro with rake (feeBps). Rules:
  - Player bets rank 1..13. Two ranks are drawn: bankRank then playerRank.
  - If bet == bankRank: lose. If bet == playerRank: win 1:1 on (wager - rake).
  - If bankRank == playerRank (doublet): push — refund (wager - rake). Rake is kept by house.
  - Rake: feeBps (basis points, default 100 = 1%). Owner can set up to 1000 (10%).
  - Events: FaroPlayed(player,wager,fee,win,push,bankRank,playerRank,betRank).

Deploy (Hardhat)
- cd hardhat && npm install
- Copy .env.example → .env and set ALCHEMY_URL/INFURA_URL and PRIVATE_KEY
- Deploy Tavern: npx hardhat run scripts/deploy.js --network sepolia
- Deploy Faro: npx hardhat run scripts/deploy_faro.js --network sepolia
- Fund contracts (send ETH) to enable payouts.

Frontend Wiring
- ABI files: js/TavernABI.js and js/FaroABI.js
- Contract addresses: js/config.js uses ADDRESS_BOOK or overrides via localStorage
  - Example override in browser console:
    localStorage.setItem('contract.tavern','0x...');
    localStorage.setItem('contract.faro','0x...');
  - Refresh the page.
