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

# --- Upload site (single rsync pass: root files + directories) ---
rsync -rlt --delete --prune-empty-dirs \
  --include '*/' \
  --include '*.html' \
  --include '*.ico' --include '*.png' --include '*.jpg' --include '*.jpeg' --include '*.webp' --include '*.svg' \
  --include 'css/***' --include 'js/***' --include 'assets/***' --include 'admin/***' --include 'games/***' --include 'server/***' \
  --include 'images/***' --include 'img/***' --include 'fonts/***' --include 'media/***' \
  --exclude '*' \
  ./ "$UPLOAD/"

# --- Atomic swap into place ---
ts=$(date +%s)
if [ -d "$WEBROOT" ]; then
  sudo mv "$WEBROOT" "${BASE}/html_prev_${ts}" || true
fi
sudo mv "$UPLOAD" "$WEBROOT"

# --- Restore runtime-only secrets (never in git) ---
SECRET_CONFIG_DIR="${BASE}/secrets"
PAYMASTER_SECRET="${SECRET_CONFIG_DIR}/paymaster-key.js"
if [ -f "$PAYMASTER_SECRET" ]; then
  sudo mkdir -p "$WEBROOT/config"
  sudo install -m 600 "$PAYMASTER_SECRET" "$WEBROOT/config/paymaster-key.js"
else
  echo "WARNING: ${PAYMASTER_SECRET} not found; keeping repository paymaster-key.js (likely blank)." >&2
fi

# --- Guard: ensure delegation guard is present in live JS ---
if ! grep -q "delegate_mm_signer_required" "$WEBROOT/js/aa/delegation.js" 2>/dev/null; then
  echo "ERROR: delegation guard not found in js/aa/delegation.js (delegate_mm_signer_required)." >&2
  echo "Aborting to avoid serving stale JS. Ensure latest main is deployed." >&2
  exit 1
fi

# --- Permissions and deploy marker ---
sudo mkdir -p "$WEBROOT/assets"
printf '%s @ %s\n' "$commit" "$builtAt" | sudo tee "$WEBROOT/assets/deploy_check.txt" >/dev/null
sudo find "$WEBROOT" -type d -exec chmod 755 {} +
sudo find "$WEBROOT" -type f -exec chmod 644 {} +
if [ -f "$WEBROOT/config/paymaster-key.js" ]; then
  sudo chmod 600 "$WEBROOT/config/paymaster-key.js"
fi

# --- Summary ---
echo "--- LIVE MARKERS ---"
head -n 1 "$WEBROOT/assets/build.json" || true
cat "$WEBROOT/assets/deploy_check.txt" || true
ls -la "$WEBROOT" | sed -n '1,80p'

echo "Deploy complete to: $WEBROOT"
