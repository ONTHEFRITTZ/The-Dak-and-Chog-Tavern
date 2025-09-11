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

Realtime backend (Socket.IO) — restart after server changes
- Uses pm2 with `ecosystem.config.js` (PORT 3100 to match NGINX).
```
cd ~/The-Dak-and-Chog-Tavern
pm2 restart ecosystem.config.js   # or: pm2 restart dakchog-rt

# Quick health check
curl -s http://127.0.0.1:3100/ | cat   # expect: Tavern realtime OK
```

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
