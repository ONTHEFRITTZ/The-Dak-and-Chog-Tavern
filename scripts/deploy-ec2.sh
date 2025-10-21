#!/usr/bin/env bash
# Deployment script for EC2 instance (Next.js + PM2)
# Example usage from EC2 browser console:
#   bash scripts/deploy-ec2.sh
#   DOMAIN="thedakandchog.xyz" NODE_ENV=production bash scripts/deploy-ec2.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

DOMAIN="${DOMAIN:-thedakandchog.xyz}"
NODE_ENV="${NODE_ENV:-production}"

CATALOG_DIR="/home/ubuntu/The-Dak-and-Chog-Tavern"
APP_DIR="$CATALOG_DIR/tavern-next"
LOG_DIR="/var/log/tavern"

# Ensure log directory exists
sudo mkdir -p "$LOG_DIR"
sudo chown -R "$(id -u)":"$(id -g)" "$LOG_DIR"

echo "=== Deploying Next.js site ==="
echo "DOMAIN  : $DOMAIN"
echo "NODE_ENV: $NODE_ENV"
echo "REPO    : $CATALOG_DIR"
echo "APP DIR : $APP_DIR"

echo "--- pulling latest main ---"
git fetch origin
git checkout main
git pull --ff-only origin main

if [ ! -d "$APP_DIR" ]; then
  echo "ERROR: $APP_DIR does not exist. Did the repository layout change?" >&2
  exit 1
fi

cd "$APP_DIR"

echo "--- installing dependencies (npm ci) ---"
npm ci --legacy-peer-deps --no-progress --audit=false --fund=false

echo "--- building Next.js app ---"
NODE_ENV="$NODE_ENV" npm run build

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not installed." >&2
  echo "Install with: npm install -g pm2" >&2
  exit 1
fi

echo "--- restarting pm2 processes ---"
for app in tavern-next realtime dcmon-agent; do
  pm2 stop "$app" || true
  pm2 delete "$app" || true
done

NODE_ENV="$NODE_ENV" pm2 start ecosystem.config.js --only tavern-next --env "$NODE_ENV"
NODE_ENV="$NODE_ENV" pm2 start ecosystem.config.js --only realtime --env "$NODE_ENV"
NODE_ENV="$NODE_ENV" pm2 start ecosystem.config.js --only dcmon-agent --env "$NODE_ENV"
pm2 save

echo "--- deployment complete ---"
pm2 status | sed -n '1,20p'

