Deployment (CI/CD)

Overview
- Deploys on every push to the `main` branch via GitHub Actions.
- Uploads the site as a tarball over SSH, unpacks to a temp dir, and atomically swaps to `html/`.
- Generates `assets/build.json` with commit + build time for cache busting in dynamic imports and footer.
- Optionally restarts the realtime server (`pm2 restart dakchog-rt`) if PM2 is installed on the host.
- Optional Cloudflare cache purge after deploy.

Setup
1) Server layout (matches existing deploy.ps1):
   - Base: `/var/www/<DOMAIN>`
   - Active site: `/var/www/<DOMAIN>/html`
   - Temp upload: `/var/www/<DOMAIN>/html_upload` (created automatically)

2) Add repository secrets (Settings → Secrets and variables → Actions):
   - `SSH_HOST`: your server host
   - `SSH_USER`: SSH user with permissions to write `/var/www/<DOMAIN>`
   - `SSH_KEY`: private key content (PEM); use a dedicated deploy key
   - `SSH_PORT` (optional): defaults to `22`
   - `DEPLOY_BASE` (optional): defaults to `/var/www`
   - `DEPLOY_DOMAIN` (optional): defaults to `thedakandchog.xyz`
   - `CF_ZONE_ID` (optional): Cloudflare Zone ID (enables purge)
   - `CF_API_TOKEN` (optional): Cloudflare API token with cache purge scope

3) PM2 (optional realtime server):
   - Place `server/realtime.js` on the same host; ensure `pm2` is installed
   - `pm2 start ecosystem.config.js` from repo root (or `pm2 start server/realtime.js --name dakchog-rt`)

How it works
- On push to main, `.github/workflows/deploy.yml`:
  - Checks out code
  - Creates `assets/build.json` with commit + UTC timestamp
  - Tars the repo (excluding VCS and CI dirs)
  - Copies `site.tgz` to the server under `/tmp/tavern_upload`
  - Unpacks to `html_upload`, fixes permissions, atomic swap to `html` with timestamped rollback
  - Optionally restarts PM2 app and purges Cloudflare cache

Rollback
- On the server: `ls -ld /var/www/<DOMAIN>/html_prev_*`
- Choose a previous dir and swap back: `mv /var/www/<DOMAIN>/html /var/www/<DOMAIN>/html_bad_$(date +%s); mv /var/www/<DOMAIN>/html_prev_<TS> /var/www/<DOMAIN>/html`

Local deploy (optional)
- You can still use `deploy.ps1` for manual uploads:
  `./deploy.ps1 -Host <HOST> -User <USER> [-IdentityFile <KEY>]`

Notes
- Game pages now dynamically import their JS with `?v=<commit>` to avoid stale cached bundles.
- If you keep aggressive CDN/browser caching for HTML, enable Cloudflare purge step.

