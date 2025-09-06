#!/usr/bin/env bash
set -euo pipefail

# Helper to manage the pm2 backend service
# Usage:
#   bash scripts/manage-backend-ec2.sh status
#   bash scripts/manage-backend-ec2.sh restart
#   bash scripts/manage-backend-ec2.sh logs [--follow]
# Env:
#   APP_NAME (default: dakchog-rt)

APP_NAME=${APP_NAME:-dakchog-rt}
cmd=${1:-help}

case "$cmd" in
  status)
    pm2 status "$APP_NAME" || true
    ;;
  restart)
    pm2 restart "$APP_NAME" || pm2 start ecosystem.config.js --only "$APP_NAME"
    pm2 save
    ;;
  logs)
    shift || true
    pm2 logs "$APP_NAME" "$@"
    ;;
  *)
    echo "Usage: $0 {status|restart|logs [--follow]}" >&2
    exit 1
    ;;
esac

