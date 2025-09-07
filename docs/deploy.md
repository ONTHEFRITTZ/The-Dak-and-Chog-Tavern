Deployment (CI/CD)

Overview
- Deploys on push to `main` with an explicit deploy intent (commit message contains `deploy: yes` or `[deploy]`), or via manual workflow dispatch.
- Uploads the site to the server, then atomically swaps into the web root.
- Generates `assets/build.json` with commit + build time for cache busting in dynamic imports and footer.
- Keeps timestamped backups of previous deploys.

Secrets to set (GitHub → Settings → Secrets and variables → Actions)
- `SSH_HOST`: your server host
- `SSH_USER`: SSH user with permissions to write the webroot
- `SSH_KEY`: private key content (PEM). Use a dedicated deploy key
- `SSH_PORT` (optional): defaults to `22`
- `DEPLOY_DOMAIN` (optional): defaults to `thedakandchog.xyz`
- `DEPLOY_BASE` (optional): defaults to `/var/www`
- `REMOTE_PATH` (optional): full web root path. If set, overrides `DEPLOY_BASE/DEPLOY_DOMAIN/html`
- `CF_ZONE_ID` (optional): Cloudflare Zone ID (enables purge)
- `CF_API_TOKEN` (optional): Cloudflare API token with cache purge scope

How it works
- The workflow `.github/workflows/deploy.yml`:
  - Creates `assets/build.json` with commit + UTC timestamp
  - Uploads the site contents to `/tmp/tavern_upload` on the server
  - Resolves the final web root:
    - If `REMOTE_PATH` is set, uses that
    - Else uses `DEPLOY_BASE/DEPLOY_DOMAIN/html` (default `/var/www/thedakandchog.xyz/html`)
  - Atomically swaps upload into place and sets perms (dirs 755, files 644)
  - Prunes older backups, keeping the last three
  - Verifies key files exist
  - Best-effort fetch of `https://<DOMAIN>/assets/build.json` to confirm live

Manual deploy (PowerShell)
- From repo root:
  - `ssh -V` and `scp -V` should work (install OpenSSH Client if needed)
  - Run: `./deploy.ps1 -Host your.server.com -User ubuntu -IdentityFile "C:\\Users\\you\\.ssh\\id_ed25519" -Port 22 -Domain thedakandchog.xyz -RemoteRoot /var/www`
  - The script generates `assets/build.json`, uploads everything to a temp dir, atomically swaps into place, and verifies files.

Rollback
- SSH to the server and list backups next to your web root:
  - `ls -ld /var/www/<DOMAIN>/html_prev_*`
- Swap back to a previous one:
  - `mv /var/www/<DOMAIN>/html /var/www/<DOMAIN>/html_bad_$(date +%s)`
  - `mv /var/www/<DOMAIN>/html_prev_<TS> /var/www/<DOMAIN>/html`

Notes
- Game pages dynamically import their JS with a `?v=<commit>` tag to avoid stale browser/CDN caches. You still may need to purge CDN caches for HTML (workflow can be extended to purge Cloudflare).
- If your server uses a non-standard web root, set `REMOTE_PATH` to the exact directory served by Nginx/Apache.

