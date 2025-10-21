Deploying The Dak & Chog Tavern

Contributor Workflow (Codex)
- Always commit and push changes to `main` on GitHub once the work is ready.
- After pushing, share the EC2 deploy snippet below so it can be run from the browser terminal.
- NEVER touch backend/server code unless explicitly instructed; limit updates to the front-end. Do not remove code unless it conflicts with another segment of code that you are working on.

Stable Snapshot
- Version tag: `assets/version.txt` contains the current stable label (e.g., `stable-2025-09-11`).
- Build markers:
  - `/assets/build.json` => { commit, builtAt }
  - `/assets/deploy_check.txt` => <commit> @ <UTC>

Deploying the Next.js app on EC2

Front-end Configuration
- Set `NEXT_PUBLIC_ADMIN_ADDRESS` to the owner wallet that should see the `/admin` tools.
- If the address is omitted the nav link is hidden; the page itself will prompt you to configure the env var before running admin actions.
- `/admin` surfaces DCMon, WMON, and pool management; it reads swap queue data via `server/dcmon/config` so ensure the agent's queue path is accessible to the Next server runtime.
- The Next.js runtime now serves all web traffic from PM2 (`tavern-next` on port 3000); Nginx simply reverse proxies requests instead of reading `/var/www/thedakandchog.xyz/html`.

Prerequisites (EC2)
- Install once:
  - Node.js 20+ and npm (via nvm or distro package manager)
  - PM2 globally (`npm install -g pm2`)
  - git (already available on Amazon Linux)

Deploy (copy/paste)
```
cd ~/The-Dak-and-Chog-Tavern
git fetch origin
git checkout main
git pull --ff-only origin main
bash scripts/deploy-ec2.sh
```

Cutover from legacy static site
- Run `sudo bash scripts/install-nginx-conf.sh` after pulling to copy the updated reverse proxy config (it no longer serves the stale `/var/www/thedakandchog.xyz/html` snapshot).
- The first time you cut over, clear the old static bundle: `sudo rm -rf /var/www/thedakandchog.xyz/html/*` (the directory is no longer used once Nginx is reloaded).
- After Nginx reloads, purge the Cloudflare cache if you still see the legacy landing page.

Admin Panel (WMON/DCMon) Post-Deploy Checklist
- Load https://thedakandchog.xyz/admin/ (or your domain) and connect the owner wallet.
- Confirm WMON/DCMon/Bankroll addresses match the expected deployment (see table below).
- Use the "Refresh Balances" button to re-query both the bankroll hook and pool stats; it now runs automatically after each confirmed tx.
- Queue data auto-polls every ~15s via `/api/dcmon/queue`; an empty list usually indicates the agent has no pending swaps or the queue file is unreachable.
- First-time DCMon deposits will trigger a max WMON approval transaction from the owner wallet; approve it once to avoid repeated prompts.
- Optional: run a 0.01 MON wrap -> approve -> pool deposit -> pool redeem smoke test to ensure signer permissions.
Monad Testnet Addresses (Oct 2025)
- WMON: 0x7b4E8B2a3E934701D8bF6cFB31C3f3BDaC5e30Ff
- DCMon: 0x3AcbbD49603D8140C0acbf13E3471DBF691b2Bd7
- BankrollPool: 0x31574064907cbE75C61Fea28C545264817A9AA4a
- Player reward wallet: 0xCe1C5bb15041361D6Ab22aAFb3887dD28D05a16E
- Hazard: 0xb0103807b4B758945331BF6783873Cd776037f89
- Shell: 0x7Ff5A1b0d71eE4C66D24121D2E68D7844704D377
- DakChog: 0xa8F48cccE4968F5bf40f3411B2265cEBDB517ADf
- HoldemPoker: 0x424F89FE230331df8f656B683812b6394c323f17



DCMon Agent (bankroll/paymaster automation)
- Install deps once: `cd server && npm install --production`
- Start with PM2: `pm2 start server/dcmon-agent.js --name dcmon-agent && pm2 save`
- Logs: `pm2 logs dcmon-agent --lines 100`
- Config: edit `server/.env` (see `docs/ops/DCmon-runbook.md` for thresholds and recovery).

Realtime backend (Socket.IO) - restart/health
- Managed by PM2 as `realtime` (PORT 3100).
```
# From EC2
cd ~/The-Dak-and-Chog-Tavern

# If already running, reload or restart the single app
pm2 reload realtime || pm2 restart realtime

# If not started yet (first boot) create logs dir and start the process as `realtime`
mkdir -p /var/log/tavern && sudo chown "$USER":"$USER" /var/log/tavern
pm2 start server/realtime.js --name realtime
pm2 save   # persist across reboots

# Quick health check (expects exact text)
curl -s http://127.0.0.1:3100/ | grep -q "Tavern realtime OK" && echo OK || (echo FAIL && exit 1)

# View recent logs if needed
pm2 logs realtime --lines 100
```


2) NGINX (inside your 443 server block)
```
# Poker realtime
location = /poker.io { return 301 /poker.io/; }
location /poker.io/ {
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "Upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 600s;
  proxy_send_timeout 600s;
  proxy_pass http://127.0.0.1:3100/socket.io/;
}
```

3) Clients
- Poker clients: change Socket.IO path to `/poker.io` when you cut over.
  - Example in code: `io(origin, { path: '/poker.io/' })`

4) Backend flag
- Ensure `GAME_TYPES` includes poker (e.g., `GAME_TYPES=POKER` or `GAME_TYPES=HAZARD,POKER`) before restarting.

Post-deploy verification
```
# Build markers
curl -s https://thedakandchog.xyz/assets/build.json
  curl -s https://thedakandchog.xyz/assets/deploy_check.txt

# Origin sanity (bypasses CDN)
  curl -s http://127.0.0.1/index.html | grep -n "/games/"
```

Replace NGINX vhost (clean, isolated Socket.IO)

To overwrite a broken/duplicated vhost and install a clean config that isolates Faro and Poker sockets:

1) On EC2, run:
```
cd ~/The-Dak-and-Chog-Tavern
sudo bash scripts/install-nginx-conf.sh
```

2) Verify routes (polling handshake must not return HTML):
```
curl -i "https://thedakandchog.xyz/poker.io/?EIO=4&transport=polling&t=$(date +%s)" | sed -n '1,10p'
# Expect HTTP/2 200 and a short packet starting with 0{, not an HTML page
```

3) Faro remains on `/socket.io` (3100). Poker is on `/poker.io` (3100).


Cloudflare
- If HTML looks stale after a green deploy, purge once (Caching > Configuration > Purge Everything).
- Optional: add a Cache Rule to bypass HTML while continuing to cache CSS/JS/images.

Optional NGINX hard cut for legacy paths
- We removed `/games/table/*`. To return 404 for old bookmarks, include the snippet:
  - `server/nginx/legacy-block.conf`
- Example (inside your 443 server block):
```
include /var/www/thedakandchog.xyz/html/server/nginx/legacy-block.conf;
```

Notes
- Legacy GitHub Actions and PowerShell deploy scripts were removed to avoid multiple, conflicting paths.

Troubleshooting

- SyntaxError: Invalid or unexpected token (poker-rt.js)
  - If PM2 logs show an error like `const t = getTable(tableId);\
 try {` at `server/poker-rt.js:89`, the source on the EC2 box contains a literal `\
` sequence instead of a real newline.
  - Fix on EC2 and restart:
```
sudo perl -0777 -pe "s/const t = getTable\(tableId\);\
[ \t]*try/const t = getTable(tableId);
try/" -i /home/ubuntu/The-Dak-and-Chog-Tavern/server/poker-rt.js
pm2 restart realtime && pm2 logs realtime
```
  - Best fix is to pull latest `main` which already contains the corrected block.





