#!/usr/bin/env bash
set -euo pipefail

# One-time/setup script for the realtime backend on EC2 using PM2 + systemd
# - Installs Node.js LTS (via NodeSource) if missing
# - Installs pm2 globally
# - Installs server deps if package.json exists
# - Starts the app via pm2 on PORT=3000 and enables pm2 boot startup
# Usage: bash scripts/setup-backend-ec2.sh

PORT=${PORT:-3000}
APP_NAME=${APP_NAME:-dakchog-rt}
REPO_DIR=${REPO_DIR:-$(pwd)}

echo "==> Ensuring Node.js is installed"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node: $(node -v)"
echo "npm : $(npm -v)"

echo "==> Installing pm2 (if missing)"
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi
echo "pm2: $(pm2 -v)"

echo "==> Installing server dependencies (if any)"
if [ -f "$REPO_DIR/server/package.json" ]; then
  pushd "$REPO_DIR/server" >/dev/null
  npm ci --omit=dev || npm i --production
  popd >/dev/null
fi

echo "==> Starting backend with pm2"
pushd "$REPO_DIR" >/dev/null
# Prefer ecosystem file if present
if [ -f ecosystem.config.js ]; then
  PORT="$PORT" NODE_ENV=production pm2 start ecosystem.config.js --only "$APP_NAME" || PORT="$PORT" NODE_ENV=production pm2 start ecosystem.config.js
else
  PORT="$PORT" NODE_ENV=production pm2 start server/realtime.js --name "$APP_NAME" --cwd "$REPO_DIR"
fi
pm2 save
sudo pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null
echo "==> Backend managed by pm2"
pm2 status
popd >/dev/null

echo "Done. Service name: $APP_NAME | Port: $PORT"

