#!/usr/bin/env bash
set -euo pipefail

# Install a clean vhost for thedakandchog.xyz with isolated Socket.IO routes.
# - Copies server/nginx/thedakandchog.xyz.conf to /etc/nginx/sites-available/
# - Enables it in /etc/nginx/sites-enabled/
# - Removes other enabled vhosts for the same domain to avoid duplication
# - Tests and reloads nginx

DOMAIN=${DOMAIN:-thedakandchog.xyz}
NAME="${DOMAIN}.conf"
SRC_REL="server/nginx/${DOMAIN}.conf"
SRC_ABS="$(cd "$(dirname "$0")/.." && pwd)/${SRC_REL}"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo bash $0" >&2
  exit 1
fi

if [[ ! -f "$SRC_ABS" ]]; then
  echo "Missing source vhost file: $SRC_ABS" >&2
  exit 1
fi

echo "Installing vhost for $DOMAIN"
cp -a "$SRC_ABS" "/etc/nginx/sites-available/${NAME}"

mkdir -p /root/nginx-backups || true
cp -a /etc/nginx/sites-enabled/* "/root/nginx-backups/" 2>/dev/null || true

# Remove existing enabled files for this domain to avoid duplicates
for f in /etc/nginx/sites-enabled/*${DOMAIN}*; do
  [[ -e "$f" ]] || continue
  rm -f "$f"
done

ln -sf "/etc/nginx/sites-available/${NAME}" "/etc/nginx/sites-enabled/${NAME}"

nginx -t
systemctl reload nginx
echo "Nginx reloaded with ${NAME}"

