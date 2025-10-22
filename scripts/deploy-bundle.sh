#!/usr/bin/env bash
# Build locally, ship the bundle to the EC2 box, and restart PM2.
# Usage:
#   DEPLOY_HOST=ubuntu@your-server bash scripts/deploy-bundle.sh
# Optional env vars:
#   DEPLOY_PATH=/home/ubuntu/The-Dak-and-Chog-Tavern   (default)
#   NODE_ENV=production                                (default)
#   NODE_OPTIONS=--max-old-space-size=4096             (default)

set -euo pipefail

if [ "${DEPLOY_HOST:-}" = "" ]; then
  echo "ERROR: set DEPLOY_HOST (e.g. ubuntu@ip-172-31-46-204)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$PROJECT_ROOT/tavern-next"
ARTIFACT_DIR="$PROJECT_ROOT/artifacts"
TAR_PATH="$ARTIFACT_DIR/next-build.tgz"
REMOTE_PATH="${DEPLOY_PATH:-/home/ubuntu/The-Dak-and-Chog-Tavern}"
REMOTE_ENV="${NODE_ENV:-production}"

mkdir -p "$ARTIFACT_DIR"
rm -f "$TAR_PATH"

echo "=== Building Next.js bundle locally ==="
cd "$APP_DIR"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
npm run build

echo "=== Packaging bundle ($TAR_PATH) ==="
tar -czf "$TAR_PATH" .next package.json package-lock.json public

echo "=== Uploading bundle to $DEPLOY_HOST ==="
scp "$TAR_PATH" "$DEPLOY_HOST:/tmp/next-build.tgz"

read -r -d '' SSH_SCRIPT <<EOF || true
set -euo pipefail
cd '$REMOTE_PATH/tavern-next'
rm -rf .next
tar -xzf /tmp/next-build.tgz -C .
rm /tmp/next-build.tgz
sudo lsof -ti :3000 | xargs -r sudo kill -9 || true
for app in tavern-next realtime dcmon-agent; do
  pm2 stop "\$app" || true
  pm2 delete "\$app" || true
done
NODE_ENV='$REMOTE_ENV' pm2 start ecosystem.config.js --only tavern-next --env '$REMOTE_ENV'
NODE_ENV='$REMOTE_ENV' pm2 start ecosystem.config.js --only realtime --env '$REMOTE_ENV'
NODE_ENV='$REMOTE_ENV' pm2 start ecosystem.config.js --only dcmon-agent --env '$REMOTE_ENV'
pm2 save
EOF

echo "=== Applying bundle and restarting PM2 on $DEPLOY_HOST ==="
ssh "$DEPLOY_HOST" "$SSH_SCRIPT"

echo "=== Deploy complete ==="
ssh "$DEPLOY_HOST" "pm2 status | sed -n '1,20p'"
