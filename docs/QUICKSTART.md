Quick Start – The Dak & Chog Tavern

Goal: get the site live with wallet connect, profiles, multiplayer tables, and admin tools.

1) Local Preview (no server)
- Open `landing.html` in your browser.
- Click “I’m 19+, Let me in!” to go to `index.html`.
- Click `Connect Wallet` (MetaMask or similar) and you’ll see a small banner showing the current network and contract address.
- Optional: Open `games/table/index.html` to see the multiplayer UI (it needs the realtime backend to be running to fully work).

2) Addresses (where the UI points on-chain)
- Default addresses live in `js/config.js` under `DEFAULT_ADDRESSES` and `ADDRESS_BOOK`.
- You can temporarily override in the browser console:
  localStorage.setItem('contract.tavern','0x...')
  localStorage.setItem('contract.faro','0x...')
  location.reload()

3) Realtime Backend (Socket.IO) on your server
- SSH to your EC2 instance and run:
  bash scripts/setup-backend-ec2.sh
  This installs Node + pm2 and starts `server/realtime.js` on port 3000.
- Our Nginx config proxies `/socket.io/` to that service. The bootstrap script writes it for you.
 If you ran it earlier, re-run: sudo bash scripts/bootstrap-ubuntu.sh yourdomain.xyz you@example.com

4) Deploy the Static Site
- Option A – GitHub Actions (recommended): push to `main`. The workflow `.github/workflows/deploy.yml` uploads the site to your server and atomically swaps it into place.
  Required repo secrets: SSH_HOST, SSH_USER, SSH_KEY, (optional) SSH_PORT, and REMOTE_PATH (e.g. `/var/www/thedakandchog.xyz/html`).
- Option B – Manual from Windows PowerShell:
  .\deploy.ps1 -Host ELASTIC_IP -User ubuntu -IdentityFile C:\path\to\aws.pem
  This uploads `landing.html`, `index.html`, `admin/**`, `games/**`, `js/**`, `css/**`, `assets/**`, etc., then swaps into place.

5) Smoke Test (production)
- https://yourdomain.xyz loads the age gate (landing). Click through to Tavern.
- Press `Connect Wallet`. The banner shows the network and address. The `Profile` button opens your profile modal.
- Profiles: Save/Load an X handle. This talks to the realtime backend over `/socket.io`.
- Multiplayer: Open `games/table/`. Click `Join`, then choose a seat. Toggle `Ready`, place a bet, and `Deal`.
- Admin: https://yourdomain.xyz/admin/ – connect the owner wallet to enable Pause/Resume and Faro settings.

If you see “No such file or directory” on EC2
- It means the script path doesn’t exist on that machine. Copy the script up, then run it from /tmp:
  scp -i C:\path\to\aws.pem scripts/bootstrap-ubuntu.sh ubuntu@ELASTIC_IP:/tmp/
  ssh -i C:\path\to\aws.pem ubuntu@ELASTIC_IP
  sudo bash /tmp/bootstrap-ubuntu.sh yourdomain.xyz you@example.com
  Optional staging: add --with-staging --staging-subdomain staging

Troubleshooting
- If the banner shows “Using default address”, you may be on an unexpected network; switch networks in your wallet.
- If `games/table/` doesn’t react, ensure pm2 shows the app running: `bash scripts/manage-backend-ec2.sh status`.
- If `/socket.io` doesn’t connect, verify Nginx has the `/socket.io/` location and reload it.
