#!/usr/bin/env bash
set -euo pipefail

# One-time fixer to make Faro/Poker Socket.IO routing consistent by
# ensuring the repo-managed include is present exactly once and
# removing any duplicate includes or inline location blocks.

VHOST="/etc/nginx/sites-enabled/thedakandchog.xyz-http.conf"
INCLUDE_LINE="include /var/www/thedakandchog.xyz/html/server/nginx/legacy-block.conf;"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo bash $0" >&2
  exit 1
fi

if [[ ! -f "$VHOST" ]]; then
  echo "Vhost not found: $VHOST" >&2
  exit 1
fi

cp -a "$VHOST" "${VHOST}.bak.$(date +%s)"

# 1) Remove any inline duplicates of the include (keep first)
awk -v pat="$INCLUDE_LINE" '
  BEGIN{kept=0}
  {
    if ($0 ~ pat) {
      kept++
      if (kept>1) next
    }
    print
  }
' "$VHOST" >"${VHOST}.tmp1"

# 2) Ensure exactly one include exists; if none, insert after the index line
if ! grep -qF "$INCLUDE_LINE" "${VHOST}.tmp1"; then
  awk -v ins="$INCLUDE_LINE" '
    {print}
    /index landing\.html index\.html;/ && !done { print "    " ins; done=1 }
  ' "${VHOST}.tmp1" >"${VHOST}.tmp2"
else
  cp "${VHOST}.tmp1" "${VHOST}.tmp2"
fi

# 3) Remove any inline location blocks for /faro.io or /poker.io (managed via include)
sed -E \
  -e '/location\s*=\s*\/faro\.io\b/,/}/d' \
  -e '/location\s*\/faro\.io\//,/}/d' \
  -e '/location\s*=\s*\/poker\.io\b/,/}/d' \
  -e '/location\s*\/poker\.io\//,/}/d' \
  "${VHOST}.tmp2" >"${VHOST}.fixed"

mv "${VHOST}.fixed" "$VHOST"
rm -f "${VHOST}.tmp1" "${VHOST}.tmp2"

echo "Updated: $VHOST"
nginx -t
systemctl reload nginx
echo "Nginx reloaded."

