#!/usr/bin/env bash
set -euo pipefail

# Simple EC2 deploy script for Nginx static site
# Usage:
#   bash scripts/deploy-ec2.sh
# Optional env overrides:
#   WEBROOT=/var/www/thedakandchog.xyz/html UPLOAD=/var/www/thedakandchog.xyz/html_upload bash scripts/deploy-ec2.sh

WEBROOT=${WEBROOT:-/var/www/thedakandchog.xyz/html}
UPLOAD=${UPLOAD:-/var/www/thedakandchog.xyz/html_upload}

echo "Deploying to $WEBROOT (temp: $UPLOAD)"

sudo mkdir -p "$UPLOAD" "$WEBROOT"
sudo rm -rf "$UPLOAD"/*

# Sync repo → temp upload, excluding dev-only files/dirs
sudo rsync -a --delete \
  --exclude='.git/' \
  --exclude='.github/' \
  --exclude='.vscode/' \
  --exclude='scripts/' \
  --exclude='server/' \
  --exclude='hardhat/' \
  --exclude='archive/' \
  --exclude='artifacts/' \
  --exclude='Contracts/' \
  ./ "$UPLOAD"/

# Atomic swap into place, preserving previous as html_prev_<ts>
sudo bash -c "set -e; ts=\$(date +%s); if [ -d '$WEBROOT' ]; then mv '$WEBROOT' '/var/www/thedakandchog.xyz/html_prev_'\$ts; fi; mv '$UPLOAD' '$WEBROOT'"

echo "Deployment complete. Active path: $WEBROOT"

