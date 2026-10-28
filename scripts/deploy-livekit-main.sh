#!/bin/bash
# ============================================================
# LiveKit + Continuwuity MatrixRTC 一键部署
# ============================================================
set -e

LIVEKIT_DOMAIN="livekit.lujax.fun"
MATRIX_DOMAIN="lujax.fun"
APP_DIR="/opt/livekit"

echo "========================================================"
echo " LiveKit + Continuwuity MatrixRTC Deploy"
echo " Domain: $LIVEKIT_DOMAIN"
echo "========================================================"

# ========== Step 1: 生成 LiveKit API Keys ==========
echo ""
echo "=== Step 1: 生成 LiveKit API Keys ==="
KEYS=$(docker run --rm livekit/livekit-server:latest generate-keys 2>&1)
echo "$KEYS"
LK_KEY=$(echo "$KEYS" | grep "API Key:" | awk '{print $3}')
LK_SECRET=$(echo "$KEYS" | grep "API Secret:" | awk '{print $3}')
echo "LK_KEY=$LK_KEY"

# ========== Step 2: 创建目录 + compose + livekit.yaml ==========
echo ""
echo "=== Step 2: 写入 compose + livekit.yaml ==="
mkdir -p "$APP_DIR"
cd "$APP_DIR"

cat > docker-compose.yaml << ENDCOMPOSE
services:
  lk-jwt-service:
    image: ghcr.io/element-hq/lk-jwt-service:latest
    container_name: lk-jwt-service
    environment:
      - LIVEKIT_JWT_BIND=:8081
      - LIVEKIT_URL=wss://${LIVEKIT_DOMAIN}
      - LIVEKIT_FULL_ACCESS_HOMESERVERS=${MATRIX_DOMAIN}
      - LIVEKIT_KEY=${LK_KEY}
      - LIVEKIT_SECRET=${LK_SECRET}
      - RUST_LOG=info
    restart: unless-stopped
    network_mode: host
    extra_hosts:
      - "${LIVEKIT_DOMAIN}:host-gateway"
      - "${MATRIX_DOMAIN}:host-gateway"

  livekit:
    image: livekit/livekit-server:latest
    container_name: livekit
    command: --config /etc/livekit.yaml
    restart: unless-stopped
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    network_mode: host
ENDCOMPOSE

cat > livekit.yaml << ENDYAML
port: 7880
bind_addresses:
  - ""

rtc:
  tcp_port: 7881
  port_range_start: 50100
  port_range_end: 50200
  use_external_ip: true
  enable_loopback_candidate: false

keys:
  ${LK_KEY}: ${LK_SECRET}

room:
  auto_create: false
ENDYAML

echo "compose + livekit.yaml 已写入 $APP_DIR"

# ========== Step 3: docker compose up ==========
echo ""
echo "=== Step 3: docker compose up -d ==="
cd "$APP_DIR"
docker compose pull 2>&1 | tail -10
docker compose up -d 2>&1
sleep 5
echo "容器状态:"
docker ps --filter "name=livekit" --filter "name=lk-jwt-service" --format "table {{.Names}}\t{{.Status}}"
echo ""
echo "健康检查:"
curl -s --max-time 5 http://127.0.0.1:8081/healthz && echo " ✅ lk-jwt-service healthz OK" || echo " ❌ lk-jwt-service FAIL"
curl -s --max-time 5 http://127.0.0.1:7880 && echo " ✅ livekit OK" || echo " ❌ livekit FAIL"

# ========== Step 4: nginx ==========
echo ""
echo "=== Step 4: nginx server block ==="
mkdir -p /var/www/certbot

cat > /etc/nginx/conf.d/livekit.conf << ENDNGINX
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name ${LIVEKIT_DOMAIN};
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}
ENDNGINX

nginx -t 2>&1 | tail -5

# ========== Step 5: Let's Encrypt ==========
echo ""
echo "=== Step 5: Let's Encrypt HTTPS 证书 ==="
certbot certonly --webroot -w /var/www/certbot -d "$LIVEKIT_DOMAIN" --non-interactive --agree-tos -m admin@lujax.fun 2>&1 | tail -10

cat > /etc/nginx/conf.d/livekit.conf << ENDNGINX2
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name ${LIVEKIT_DOMAIN};
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${LIVEKIT_DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${LIVEKIT_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${LIVEKIT_DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location ~ ^/(sfu/get|healthz|get_token) {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$http_host;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$http_host;
        proxy_buffering off;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
    }
}
ENDNGINX2

nginx -t 2>&1
nginx -s reload 2>&1
echo "✅ nginx reload OK"

# ========== Step 6: Continuwuity config patch (Python script run separately) ==========
# 跳过，由 patch-continuwuity.py 单独执行

# ========== Step 7: 公网验收 ==========
echo ""
echo "========================================================"
echo " 容器状态"
echo "========================================================"
docker ps --filter "name=livekit" --filter "name=lk-jwt-service" --filter "name=continuwuity" --format "table {{.Names}}\t{{.Status}}"

echo ""
echo "公网 lk-jwt-service healthz:"
curl -sk --max-time 10 "https://${LIVEKIT_DOMAIN}/healthz" 2>&1 || echo "(还不通)"

echo ""
echo "公网 livekit (HTTP):"
curl -sI --max-time 10 "http://${LIVEKIT_DOMAIN}/" 2>&1 | head -3 || echo "(还不通)"

echo ""
echo "========================================================"
echo " Docker 日志 (最后 10 行)"
echo "========================================================"
docker logs lk-jwt-service --tail 5 2>&1
docker logs livekit --tail 5 2>&1

echo ""
echo "========================================================"
echo " 下一步: 执行 patch-continuwuity.py + docker restart continuwuity"
echo " 阿里云安全组需开: 7881/tcp + 50100-50200/udp"
echo "========================================================"
