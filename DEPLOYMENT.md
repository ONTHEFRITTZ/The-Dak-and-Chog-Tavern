# COMPLETE REPLACEMENT FILE
# Path: The Dak and Chog Tavern/server/nginx/thedakandchog.xyz.conf
#
# Single file. No helper files. No http2 on 443.
# Public path /poker.io/ → upstream http://127.0.0.1:3100/socket.io/
# Conditional Upgrade/Connection headers WITHOUT using 'map'.

server {
  # Keep CF→origin on HTTP/1.1 (no http2 here)
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name thedakandchog.xyz www.thedakandchog.xyz;

  root /var/www/thedakandchog.xyz/html;
  index index.html landing.html;

  access_log /var/log/nginx/thedakandchog.access.log;
  error_log  /var/log/nginx/thedakandchog.error.log warn;

  # ================= Socket.IO over pretty path: /poker.io/ =================
  location ^~ /poker.io/ {
    proxy_http_version 1.1;

    # --- Conditional WS upgrade WITHOUT 'map' ---
    # Default: no upgrade headers (keeps polling happy behind Cloudflare)
    proxy_set_header Upgrade   "";
    proxy_set_header Connection "";

    # If client sent Upgrade (websocket), set correct headers
    if ($http_upgrade) {
      proxy_set_header Upgrade   $http_upgrade;  # usually "websocket"
      proxy_set_header Connection "upgrade";
    }

    # Standard forward headers
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Long-polling / WS stability
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_buffering off;

    # Debug/verification
    add_header X-WS-Proxy "poker.io" always;

    # Upstream Engine.IO/Socket.IO (Node on :3100 mounted at /socket.io/)
    proxy_pass http://127.0.0.1:3100/socket.io/;
  }

  # (Optional) also allow direct /socket.io/
  location ^~ /socket.io/ {
    proxy_http_version 1.1;

    # Same conditional upgrade logic
    proxy_set_header Upgrade   "";
    proxy_set_header Connection "";
    if ($http_upgrade) {
      proxy_set_header Upgrade   $http_upgrade;
      proxy_set_header Connection "upgrade";
    }

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_buffering off;

    add_header X-WS-Proxy "socket.io" always;

    proxy_pass http://127.0.0.1:3100/socket.io/;
  }

  # ================= SPA niceties =================
  # Exact-match redirect when no trailing slash
  location = /games/faro  { return 301 /games/faro/; }
  location = /games/poker { return 301 /games/poker/; }

  # FARO SPA
  location ^~ /games/faro/ {
    sub_filter_types text/html;
    sub_filter 'href="/' 'href="/games/faro/';
    sub_filter 'src="/'  'src="/games/faro/';
    sub_filter_once off;

    add_header Cache-Control "no-store, no-cache, must-revalidate" always;

    try_files $uri $uri/ /games/faro/index.html;
  }

  # POKER SPA
  location ^~ /games/poker/ {
    sub_filter_types text/html;
    sub_filter 'href="/' 'href="/games/poker/';
    sub_filter 'src="/'  'src="/games/poker/';
    sub_filter_once off;

    add_header Cache-Control "no-store, no-cache, must-revalidate" always;

    try_files $uri $uri/ /games/poker/index.html;
  }

  # Default SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
  }

  # ================= TLS (Let’s Encrypt) =================
  ssl_certificate     /etc/letsencrypt/live/thedakandchog.xyz/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/thedakandchog.xyz/privkey.pem;
  include             /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;
}

# HTTP → HTTPS redirect
server {
  listen 80;
  listen [::]:80;
  server_name thedakandchog.xyz www.thedakandchog.xyz;
  return 301 https://$host$request_uri;
}
