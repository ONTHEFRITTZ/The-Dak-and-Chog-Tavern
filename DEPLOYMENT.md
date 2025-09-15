Deploying The Dak & Chog Tavern

Stable Snapshot
- Version tag: `assets/version.txt` contains the current stable label (e.g., `stable-2025-09-11`).
- Build markers:
  - `/assets/build.json` → `{ commit, builtAt }`
  - `/assets/deploy_check.txt` → `<commit> @ <UTC>`

Recommended: EC2 pull-based, atomic deploy

Prerequisites (EC2)
- Install tools once:
  - `sudo apt-get update && sudo apt-get install -y git rsync`

Deploy (copy/paste)
```
cd ~/The-Dak-and-Chog-Tavern && git fetch origin && git reset --hard origin/main
DOMAIN="thedakandchog.xyz" WEBROOT="/var/www/${DOMAIN}/html" UPLOAD="/var/www/${DOMAIN}/html_upload" bash scripts/deploy-ec2.sh
```

Realtime backend (Socket.IO) – restart after server changes
- Uses pm2 with `ecosystem.config.js` (PORT 3100 to match NGINX).
```
cd ~/The-Dak-and-Chog-Tavern
pm2 restart ecosystem.config.js   # or: pm2 restart dakchog-rt

# Quick health check
curl -s http://127.0.0.1:3100/ | cat   # expect: Tavern realtime OK
```

Poker realtime (3101)

- If you run the isolated Poker RT (`server/poker-rt.js` on 3101), restart just that app:
```
cd ~/The-Dak-and-Chog-Tavern
pm2 restart poker-rt

# Quick health check
curl -s http://127.0.0.1:3101/ | cat   # expect: Poker realtime OK
```

Optional: split realtime by game (Faro vs Poker)

- Why: independent scaling/restarts or fault isolation per game.
- How: run a second pm2 app for Poker-only and route a separate Socket.IO path via NGINX.

1) PM2 (already scaffolded in `ecosystem.config.js`)
```
# Start Poker-only realtime on 3101
pm2 start ecosystem.config.js --only dakchog-poker-rt

# Keep Faro+Poker on the main app (3100) or set main to FARO-only:
# pm2 restart dakchog-rt --update-env -- GAME_TYPES=FARO
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

3) Faro remains on `/socket.io` (→ 3100). Poker is on `/poker.io` (→ 3101).


Cloudflare
- If HTML looks stale after a green deploy, purge once (Caching → Configuration → Purge Everything).
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
  - If PM2 logs show an error like `const t = getTable(tableId);\\n try {` at `server/poker-rt.js:89`, the source on the EC2 box contains a literal `\\n` sequence instead of a real newline.
  - Fix on EC2 and restart:
```
sudo perl -0777 -pe "s/const t = getTable\(tableId\);\\n[ \t]*try/const t = getTable(tableId);\ntry/" -i /home/ubuntu/The-Dak-and-Chog-Tavern/server/poker-rt.js
pm2 restart poker-rt && pm2 logs poker-rt
```
  - Best fix is to pull latest `main` which already contains the corrected block.
