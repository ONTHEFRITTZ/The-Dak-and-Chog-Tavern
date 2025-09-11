Deploying The Dak & Chog Tavern

Recommended method: EC2 pull-based, atomic deploy. No SSH keys or Actions UI required.

Prerequisites (EC2)
- Install tools once:
  - `sudo apt-get update && sudo apt-get install -y git rsync`

Deploy Command (copy/paste)
```
cd ~/The-Dak-and-Chog-Tavern && git fetch origin && git reset --hard origin/main
DOMAIN="thedakandchog.xyz" WEBROOT="/var/www/${DOMAIN}/html" UPLOAD="/var/www/${DOMAIN}/html_upload" bash scripts/deploy-ec2.sh
```

Notes
- If `DOMAIN` is `thedakandchog.xyz`, defaults resolve to `/var/www/thedakandchog.xyz/html`.
- The script writes `/assets/build.json` and `/assets/deploy_check.txt` in the live docroot.
- If HTML looks stale after deploy (Cloudflare), do a one-time “Purge Everything” or add a Cache Rule to bypass `*.html`.

What was removed
- Legacy GitHub Actions workflows and PowerShell deploy scripts were removed to avoid multiple, conflicting paths.

