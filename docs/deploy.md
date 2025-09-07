Deployment (CI/CD)

Overview
- Builds and deploys the static site to your server, then atomically swaps into the live web root.
- Generates `assets/build.json` with commit and build time for cache busting and the footer badge.
- Supports optional PM2 restart for the realtime server and optional Cloudflare cache purge.
- Manual deploy remains available via `deploy.ps1`.

Triggers
- Typical: run on push to `main` via GitHub Actions.
- Optional: gate deploys by commit intent (e.g., include `[deploy]` or `deploy: yes` in the commit message) or use manual workflow dispatch. Configure this in your workflow if desired.

Secrets (GitHub → Settings → Secrets and variables → Actions)
- `SSH_HOST`: server host
- `SSH_USER`: SSH user with permissions to write the web root
- `SSH_KEY`: private key content (PEM). Use a dedicated deploy key
- `SSH_PORT` (optional): defaults to `22`
- `DEPLOY_BASE` (optional): defaults to `/var/www`
- `DEPLOY_DOMAIN` (optional): defaults to `thedakandchog.xyz`
- `REMOTE_PATH` (optional): exact web root; if set, overrides `DEPLOY_BASE/DEPLOY_DOMAIN/html`
- `CF_ZONE_ID` (optional): Cloudflare Zone ID (enables purge)
- `CF_API_TOKEN` (optional): Cloudflare API token with cache purge scope

Server layout
- Base: `/var/www/<DOMAIN>`
- Active site: `/var/www/<DOMAIN>/html`
- Temp upload: `/var/www/<DOMAIN>/html_upload` (created automatically)

How it works (CI)
- The workflow (e.g., `.github/workflows/deploy.yml`):
  - Creates `assets/build.json` with commit + UTC timestamp
  - Packages or uploads the site to the server under a temp path (e.g., `/var/www/<DOMAIN>/html_upload` or `/tmp/tavern_upload`)
  - Resolves final web root (use `REMOTE_PATH` if provided; otherwise `DEPLOY_BASE/DEPLOY_DOMAIN/html`)
  - Atomically swaps upload into place and sets permissions (dirs 755, files 644)
  - Keeps timestamped backups and prunes older ones
  - Optionally restarts PM2 app (e.g., `pm2 restart dakchog-rt`)
  - Optionally purges Cloudflare cache
  - Verifies key files and best-effort fetch of `https://<DOMAIN>/assets/build.json`

Manual deploy (PowerShell)
- From repo root:
  - Ensure `ssh -V` and `scp -V` work (install OpenSSH Client if needed)
  - Run: `./deploy.ps1 -Host your.server.com -User ubuntu -IdentityFile "C:\\Users\\you\\.ssh\\id_ed25519" -Port 22 -Domain thedakandchog.xyz -RemoteRoot /var/www`
  - The script generates `assets/build.json`, uploads to a temp dir, swaps atomically, and verifies files

Rollback
- On the server, list backups next to your web root:
  - `ls -ld /var/www/<DOMAIN>/html_prev_*`
- Swap back to a previous one:
  - `mv /var/www/<DOMAIN>/html /var/www/<DOMAIN>/html_bad_$(date +%s)`
  - `mv /var/www/<DOMAIN>/html_prev_<TS> /var/www/<DOMAIN>/html`

Notes
- Game pages dynamically import JS with a `?v=<commit>` tag to avoid stale browser/CDN caches.
- If your server uses a non-standard web root, set `REMOTE_PATH` to the exact directory served by Nginx/Apache.
- If HTML is aggressively cached, enable the Cloudflare purge step in your workflow.
