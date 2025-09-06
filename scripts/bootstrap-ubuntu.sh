#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   sudo bash scripts/bootstrap-ubuntu.sh thedakandchog.xyz you@example.com [--with-staging] [--staging-subdomain staging]

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <domain> <email-for-lets-encrypt> [--with-staging] [--staging-subdomain staging]" >&2
  exit 1
fi

DOMAIN="$1"; shift
EMAIL="$1"; shift

WITH_STAGING=false
STAGING_SUBDOMAIN="staging"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-staging)
      WITH_STAGING=true; shift ;;
    --staging-subdomain)
      STAGING_SUBDOMAIN="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

WWW_DOMAIN="www.${DOMAIN}"

# Try to use invoking user (when using sudo), fallback to current user
DEPLOY_USER="${SUDO_USER:-$USER}"

echo "==> Updating packages"
apt-get update -y
apt-get upgrade -y

echo "==> Installing Nginx and Certbot"
apt-get install -y nginx certbot python3-certbot-nginx ufw

echo "==> Configuring UFW (firewall)"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
yes | ufw enable || true

WEBROOT="/var/www/${DOMAIN}/html"

echo "==> Creating web root at ${WEBROOT}"
mkdir -p "${WEBROOT}"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/var/www/${DOMAIN}"

NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"

echo "==> Writing Nginx server block: ${NGINX_SITE}"
cat > "${NGINX_SITE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW_DOMAIN};

    root ${WEBROOT};
    # Serve the age gate first. If missing, fall back to index.html
    index landing.html index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    # Realtime (Socket.IO) proxy
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 600s;
    }
}
EOF

echo "==> Enabling site and reloading Nginx"
ln -sf "${NGINX_SITE}" "/etc/nginx/sites-enabled/${DOMAIN}"
if [[ -e /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl reload nginx

echo "==> Requesting Let’s Encrypt certificate"
certbot --nginx \
  -d "${DOMAIN}" -d "${WWW_DOMAIN}" \
  -m "${EMAIL}" --agree-tos --no-eff-email --redirect -n || {
    echo "Certbot could not issue a certificate. Ensure DNS A record for ${DOMAIN} points to this server and try again." >&2
  }

if [[ "${WITH_STAGING}" == "true" ]]; then
  STAGING_DOMAIN="${STAGING_SUBDOMAIN}.${DOMAIN}"
  STAGING_WEBROOT="/var/www/${STAGING_DOMAIN}/html"
  STAGING_SITE="/etc/nginx/sites-available/${STAGING_DOMAIN}"

  echo "==> Creating staging web root at ${STAGING_WEBROOT}"
  mkdir -p "${STAGING_WEBROOT}"
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/var/www/${STAGING_DOMAIN}"

  echo "==> Writing Nginx server block: ${STAGING_SITE}"
  cat > "${STAGING_SITE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${STAGING_DOMAIN};

    root ${STAGING_WEBROOT};
    index landing.html index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    # Realtime (Socket.IO) proxy
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 600s;
    }
}
EOF

  echo "==> Enabling staging site and reloading Nginx"
  ln -sf "${STAGING_SITE}" "/etc/nginx/sites-enabled/${STAGING_DOMAIN}"
  nginx -t
  systemctl reload nginx

  echo "==> Requesting Let’s Encrypt certificate for staging"
  certbot --nginx \
    -d "${STAGING_DOMAIN}" \
    -m "${EMAIL}" --agree-tos --no-eff-email --redirect -n || {
      echo "Certbot could not issue a certificate. Ensure DNS record for ${STAGING_DOMAIN} points to this server and try again." >&2
    }
fi

echo "==> Bootstrap complete"
echo "Web root: ${WEBROOT}"
if [[ "${WITH_STAGING}" == "true" ]]; then
  echo "Staging web root: ${STAGING_WEBROOT}"
fi
echo "If you haven't uploaded files yet, deploy from your machine:"
echo "  PowerShell> .\\deploy.ps1 -Host <ELASTIC_IP> -User ubuntu -IdentityFile C:\\path\\to\\aws.pem"
