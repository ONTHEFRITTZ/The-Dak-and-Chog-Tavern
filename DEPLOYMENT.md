Deploying The Dak & Chog Tavern

Contributor Workflow (Codex)
- Always commit and push changes to `main` on GitHub once the work is ready.
- After pushing, share the EC2 deploy snippet below so it can be run from the browser terminal.
- NEVER touch backend/server code unless explicitly instructed; limit updates to the front-end. Do not remove code unless it conflicts with another segment of code that you are working on.

Stable Snapshot
- Version tag: `assets/version.txt` contains the current stable label (e.g., `stable-2025-09-11`).
- Build markers:
  - `/assets/build.json` â†’ `{ commit, builtAt }`
  - `/assets/deploy_check.txt` â†’ `<commit> @ <UTC>`

Recommended: EC2 pull-based, atomic deploy

Prerequisites (EC2)
- Install tools once:
  - `sudo apt-get update && sudo apt-get install -y git rsync`

Deploy (copy/paste)
```
cd ~/The-Dak-and-Chog-Tavern && git fetch origin && git reset --hard origin/main
DOMAIN="thedakandchog.xyz" WEBROOT="/var/www/${DOMAIN}/html" UPLOAD="/var/www/${DOMAIN}/html_upload" bash scripts/deploy-ec2.sh

```
Poker used to run on 3101 but now I have a single unified backend on port 3100


Realtime backend (Socket.IO) — restart/health
- Managed by PM2 using `ecosystem.config.js` app `rt-all` (PORT 3100).
```
# From EC2
cd ~/The-Dak-and-Chog-Tavern

# If already running, reload or restart the single app
pm2 reload rt-all || pm2 restart rt-all

# If not started yet (first boot) create logs dir and start
mkdir -p /var/log/tavern && sudo chown "$USER":"$USER" /var/log/tavern
pm2 start ecosystem.config.js --only rt-all
pm2 save   # persist across reboots

# Quick health check (expects exact text)
curl -s http://127.0.0.1:3100/ | grep -q "Tavern realtime OK" && echo OK || (echo FAIL && exit 1)

# View recent logs if needed
pm2 logs rt-all --lines 100
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
  proxy_pass http://127.0.0.1:3101/socket.io/;
}
```

3) Clients
- Faro clients can continue using the default path (`/socket.io`) or switch to `/faro.io` if you add the path override.
- Poker clients: change Socket.IO path to `/poker.io` when you cut over.
  - Example in code: `io(origin, { path: '/poker.io' })`

4) Backend flag
- The server supports `GAME_TYPES` (default `FARO,POKER`). When splitting:
  - Run main on 3100 with `GAME_TYPES=FARO`.
  - Run poker app on 3101 with `GAME_TYPES=POKER`.

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

3) Faro remains on `/socket.io` (â†’ 3100). Poker is on `/poker.io` (â†’ 3101).


Cloudflare
- If HTML looks stale after a green deploy, purge once (Caching â†’ Configuration â†’ Purge Everything).
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
pm2 restart poker-rt && pm2 logs poker-rt
```
  - Best fix is to pull latest `main` which already contains the corrected block.



