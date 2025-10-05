#!/usr/bin/env bash
set -euo pipefail

# PM2 launcher for Tavern realtime server without ecosystem file.
# Brings over key settings that were previously in ecosystem.config.js.

APP="realtime"
SCRIPT="server/realtime.js"
LOG_DIR="/var/log/tavern"

mkdir -p "$LOG_DIR" || true

# Env defaults (allow override via environment when invoking this script)
: "${NODE_ENV:=production}"
: "${PORT:=3100}"
: "${GAME_TYPES:=FARO,POKER}"
: "${ADMIN_ADDR:=}"
: "${RT_RAKE_BPS:=100}"

# Start or restart the app under PM2 with logging and safety limits
if pm2 describe "$APP" > /dev/null 2>&1; then
  # Restart in-place to avoid downtime
  NODE_ENV="$NODE_ENV" PORT="$PORT" GAME_TYPES="$GAME_TYPES" ADMIN_ADDR="$ADMIN_ADDR" RT_RAKE_BPS="$RT_RAKE_BPS" \
  pm2 restart "$APP" --update-env || true
else
  NODE_ENV="$NODE_ENV" PORT="$PORT" GAME_TYPES="$GAME_TYPES" ADMIN_ADDR="$ADMIN_ADDR" RT_RAKE_BPS="$RT_RAKE_BPS" \
  pm2 start "$SCRIPT" --name "$APP" \
    --node-args "--enable-source-maps" \
    --max-memory-restart "400M" \
    --merge-logs \
    --time \
    --output "$LOG_DIR/$APP.out.log" \
    --error "$LOG_DIR/$APP.err.log"
fi

pm2 save >/dev/null 2>&1 || true
echo "PM2 managed app '$APP' running on PORT=$PORT (GAME_TYPES=$GAME_TYPES)"

