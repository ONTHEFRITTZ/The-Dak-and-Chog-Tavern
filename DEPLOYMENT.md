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

Recommended: EC2 pull-based, atomic deploy

Prerequisites (EC2)
- Install tools once:
  - `sudo apt-get update && sudo apt-get install -y git rsync`

Deploy (copy/paste)
```
cd ~/The-Dak-and-Chog-Tavern && git fetch origin && git reset --hard origin/main
DOMAIN="thedakandchog.xyz" WEBROOT="/var/www/${DOMAIN}/html" UPLOAD="/var/www/${DOMAIN}/html_upload" bash scripts/deploy-ec2.sh

```

Admin Panel (WMON/DCMon) Post-Deploy Checklist
- Load https://thedakandchog.xyz/admin/ (or your domain) and connect the owner wallet.
- Confirm WMON/DCMon/Bankroll addresses match the expected deployment (see table below).
- Use the treasury card buttons to fetch stats; inputs clear automatically after a confirmed tx.
- Optional: run a 0.01 MON wrap -> approve -> pool deposit -> pool redeem smoke test to ensure signer permissions.
Monad Testnet Addresses (Oct 2025)
- WMON: 0x7b4E8B2a3E934701D8bF6cFB31C3f3BDaC5e30Ff
- DCMon: 0xF81592Eb0B6811eF655676Ba77625bD3Db7c6C92
- BankrollPool: 0x31574064907cbE75C61Fea28C545264817A9AA4a
- Player reward wallet: 0xCe1C5bb15041361D6Ab22aAFb3887dD28D05a16E
- Faro: 0x953f1Bba2eeEa57482037377BD5103cEbA85C987
- Hazard: 0xb0103807b4B758945331BF6783873Cd776037f89
- Shell: 0x7Ff5A1b0d71eE4C66D24121D2E68D7844704D377
- DakChog: 0xa8F48cccE4968F5bf40f3411B2265cEBDB517ADf
- HoldemPoker: 0x681BADA5D0d012ABEB9f8A8F0E38758396DE0db3



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
# Faro (default)
location = /faro.io { return 301 /faro.io/; }
location /faro.io/ {
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

# Poker (new)
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
- Faro clients can continue using the default path (`/socket.io`) or switch to `/faro.io` if you add the path override.
- Poker clients: change Socket.IO path to `/poker.io` when you cut over.
  - Example in code: `io(origin, { path: '/poker.io/' })`

4) Backend flag
- The server supports `GAME_TYPES` (default `FARO,POKER`). For a unified backend:
  - Run on 3100 with `GAME_TYPES=FARO,POKER`.

Post-deploy verification
```
# Live homepage should link to /games/faro
sudo grep -n "/games/" /var/www/thedakandchog.xyz/html/index.html

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





