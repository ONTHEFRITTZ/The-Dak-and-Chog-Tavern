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
