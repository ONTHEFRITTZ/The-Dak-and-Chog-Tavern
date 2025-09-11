#!/usr/bin/env bash
# Minimal, reliable pull-based deploy for EC2
# Usage (from EC2):
#   DOMAIN="thedakandchog.xyz" WEBROOT="/var/www/${DOMAIN}/html" UPLOAD="/var/www/${DOMAIN}/html_upload" bash scripts/deploy-ec2.sh
# Or rely on defaults and just set DOMAIN
#   DOMAIN="thedakandchog.xyz" bash scripts/deploy-ec2.sh

set -euo pipefail

# --- Resolve paths and inputs ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

DOMAIN="${DOMAIN:-thedakandchog.xyz}"
BASE="/var/www/${DOMAIN}"
WEBROOT="${WEBROOT:-${BASE}/html}"
UPLOAD="${UPLOAD:-${BASE}/html_upload}"

echo "DOMAIN       : $DOMAIN"
echo "WEBROOT      : $WEBROOT"
echo "UPLOAD (temp): $UPLOAD"

# --- Generate build metadata ---
commit=$(git rev-parse --short HEAD 2>/dev/null || echo local)
builtAt=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
mkdir -p assets
printf '{"commit":"%s","builtAt":"%s"}\n' "$commit" "$builtAt" > assets/build.json

# --- Prepare upload directory fresh ---
sudo mkdir -p "$UPLOAD" "$WEBROOT"
# Ensure upload dir is writable by current user
sudo chown -R "$(id -u)":"$(id -g)" "$UPLOAD"
sudo rm -rf "${UPLOAD}"/*

# --- Upload root HTML and top-level icons/images ---
rsync -rlt --delete --exclude "*" --include "*.html" ./ "$UPLOAD/"
rsync -rlt --delete --exclude "*" \
  --include "*.ico" --include "*.png" --include "*.jpg" --include "*.jpeg" --include "*.webp" --include "*.svg" \
  ./ "$UPLOAD/"

# --- Upload common site directories ---
for d in css js img images assets fonts media admin games; do
  if [ -d "$d" ]; then
    rsync -rlt --delete "$d" "$UPLOAD/"
  fi
done

# --- Atomic swap into place ---
ts=$(date +%s)
if [ -d "$WEBROOT" ]; then
  sudo mv "$WEBROOT" "${BASE}/html_prev_${ts}" || true
fi
sudo mv "$UPLOAD" "$WEBROOT"

# --- Permissions and deploy marker ---
sudo mkdir -p "$WEBROOT/assets"
printf '%s @ %s\n' "$commit" "$builtAt" | sudo tee "$WEBROOT/assets/deploy_check.txt" >/dev/null
sudo find "$WEBROOT" -type d -exec chmod 755 {} +
sudo find "$WEBROOT" -type f -exec chmod 644 {} +

# --- Summary ---
echo "--- LIVE MARKERS ---"
head -n 1 "$WEBROOT/assets/build.json" || true
cat "$WEBROOT/assets/deploy_check.txt" || true
ls -la "$WEBROOT" | sed -n '1,80p'

echo "Deploy complete to: $WEBROOT"
