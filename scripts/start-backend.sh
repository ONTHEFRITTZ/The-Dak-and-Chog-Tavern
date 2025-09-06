#!/usr/bin/env bash
set -euo pipefail

# Simple helper to start or restart the realtime backend under pm2
# Usage:
#   bash scripts/start-backend.sh
# Optional env:
#   PORT=3000 APP_NAME=dakchog-rt ADMIN_ADDR=0xyourowner

PORT=${PORT:-3000}
APP_NAME=${APP_NAME:-dakchog-rt}
ADMIN_ADDR=${ADMIN_ADDR:-}
REPO_DIR=${REPO_DIR:-$(pwd)}

echo "==> Ensuring Node.js and pm2 are installed"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

echo "==> Installing server dependencies (if needed)"
if [ -f "$REPO_DIR/server/package.json" ]; then
  pushd "$REPO_DIR/server" >/dev/null
  npm ci --omit=dev || npm i --production
  popd >/dev/null
fi

echo "==> Starting or restarting pm2 app: $APP_NAME on port $PORT"
pushd "$REPO_DIR" >/dev/null
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  PORT="$PORT" ADMIN_ADDR="$ADMIN_ADDR" NODE_ENV=production pm2 restart "$APP_NAME"
else
  if [ -f ecosystem.config.js ]; then
    PORT="$PORT" ADMIN_ADDR="$ADMIN_ADDR" NODE_ENV=production pm2 start ecosystem.config.js --only "$APP_NAME" || \
    PORT="$PORT" ADMIN_ADDR="$ADMIN_ADDR" NODE_ENV=production pm2 start ecosystem.config.js
  else
    PORT="$PORT" ADMIN_ADDR="$ADMIN_ADDR" NODE_ENV=production pm2 start server/realtime.js --name "$APP_NAME" --cwd "$REPO_DIR"
  fi
fi
pm2 save
sudo pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null || true
popd >/dev/null

echo "Done. Use scripts/manage-backend-ec2.sh for status/logs."

