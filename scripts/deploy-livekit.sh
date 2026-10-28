#!/bin/bash
# ============================================================
# LiveKit + Continuwuity MatrixRTC 一键部署
# 服务器: 47.116.59.141 | 目录: /opt/livekit
# 域名: livekit.lujax.fun | Homeserver: lujax.fun
# ============================================================
set -e

SERVER_IP="47.116.59.141"
LIVEKIT_DOMAIN="livekit.lujax.fun"
MATRIX_DOMAIN="lujax.fun"
APP_DIR="/opt/livekit"
CONDUWITIY_CONFIG="/root/continuwuity-config/config-v26.toml"

echo "========================================================"
echo " LiveKit + Continuwuity MatrixRTC Deploy"
echo "========================================================"

# ========== Step 0: DNS 验证 ==========
echo ""
echo "=== Step 0: DNS 验证 ==="
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "$SERVER_IP")
echo "服务器公网 IP: $PUBLIC_IP"
curl -sI --max-time 10 "http://$LIVEKIT_DOMAIN" 2>&1 | head -3 || echo "(DNS 未生效但继续部署)"

# ========== Step 1: 生成 LiveKit API Keys ==========
echo ""
echo "=== Step 1: 生成 LiveKit API Keys ==="
KEYS=$(docker run --rm livekit/livekit-server:latest generate-keys 2>&1)
echo "$KEYS"
LK_KEY=$(echo "$KEYS" | grep "API Key:" | awk '{print $3}')
LK_SECRET=$(echo "$KEYS" | grep "API Secret:" | awk '{print $3}')
echo "LK_KEY=$LK_KEY"
echo "LK_SECRET=$LK_SECRET"

# ========== Step 2: 创建目录 + 文件 ==========
echo ""
echo "=== Step 2: 配置 LiveKit 两容器 ==="
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# docker-compose.yaml
cat > docker-compose.yaml << EOF
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
EOF

# livekit.yaml
cat > livekit.yaml << EOF
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
EOF

echo "compose + livekit.yaml 已写入 $APP_DIR"
echo "--- compose ---"
cat docker-compose.yaml
echo "--- livekit.yaml ---"
cat livekit.yaml

# ========== Step 3: Docker compose up ==========
echo ""
echo "=== Step 3: docker compose up -d ==="
cd "$APP_DIR"
docker compose pull
docker compose up -d

echo ""
echo "=== Step 3a: 检查容器状态 ==="
docker ps --filter "name=livekit" --filter "name=lk-jwt-service" --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"

echo ""
echo "=== Step 3b: 健康检查 ==="
sleep 3
curl -s --max-time 5 http://127.0.0.1:8081/healthz && echo " ✅ lk-jwt-service healthz OK" || echo " ❌ lk-jwt-service FAIL"
curl -s --max-time 5 http://127.0.0.1:7880 && echo " ✅ livekit OK" || echo " ❌ livekit FAIL"

# ========== Step 4: nginx server block ==========
echo ""
echo "=== Step 4: nginx livekit.lujax.fun server block ==="
NGINX_CONF="/etc/nginx/conf.d/livekit.conf"

# 先备份
[ -f "$NGINX_CONF" ] && cp "$NGINX_CONF" "${NGINX_CONF}.bak-$(date +%Y%m%d-%H%M%S)"

cat > "$NGINX_CONF" << NGINXEOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name ${LIVEKIT_DOMAIN};
    # Let's Encrypt 验证 + WebRTC UDP 中继也走 443 (TLS)
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}
NGINXEOF

nginx -t 2>&1
echo "✅ nginx config OK"

# ========== Step 5: Let's Encrypt 证书 ==========
echo ""
echo "=== Step 5: Let's Encrypt HTTPS ==="
mkdir -p /var/www/certbot
certbot certonly --webroot -w /var/www/certbot -d "$LIVEKIT_DOMAIN" --non-interactive --agree-tos -m admin@lujax.fun 2>&1 | tail -10

# 更新 nginx conf 加 HTTPS server block
cat > "$NGINX_CONF" << NGINXEOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

# HTTP → HTTPS
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

# HTTPS
server {
    listen 443 ssl http2;
    server_name ${LIVEKIT_DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${LIVEKIT_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${LIVEKIT_DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # lk-jwt-service: /sfu/get* /healthz* /get_token* → 8081
    location ~ ^/(sfu/get|healthz|get_token) {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$http_host;
        proxy_buffering off;
    }

    # LiveKit: 其余全走 7880
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
NGINXEOF

nginx -t 2>&1
nginx -s reload 2>&1
echo "✅ nginx reload OK"

# ========== Step 6: Continuwuity config patch ==========
echo ""
echo "=== Step 6: Continuwuity config patch ==="
cp "$CONDUWITIY_CONFIG" "${CONDUWITIY_CONFIG}.bak.$(date +%Y%m%d-%H%M%S)"

python3 << PYEOF
CONF = "${CONDUWITIY_CONFIG}"

with open(CONF, 'r') as f:
    content = f.read()

# 1. allow_federation = false → true
if 'allow_federation = false' in content:
    content = content.replace('allow_federation = false', 'allow_federation = true')
    print('✅ allow_federation: false → true')

# 2. 加 forbidden_remote_server_names
if 'forbidden_remote_server_names' not in content:
    # 在 allow_federation 那行后面加
    content = content.replace(
        'allow_federation = true',
        'allow_federation = true\nforbidden_remote_server_names = [".*"]'
    )
    print('✅ 加 forbidden_remote_server_names = [".*"]')

# 3. 加 [global.matrix_rtc] foci
if '[global.matrix_rtc]' not in content:
    content += f'\n[global.matrix_rtc]\nfoci = [\n  {{ type = "livekit", livekit_service_url = "https://${LIVEKIT_DOMAIN}" }},\n]\n'
    print('✅ 加 [global.matrix_rtc] foci')

with open(CONF, 'w') as f:
    f.write(content)
print('Continuwuity config patched OK')
PYEOF

echo ""
echo "Config diff:"
grep -E "allow_federation|forbidden_remote|matrix_rtc|livekit_service" "$CONDUWITIY_CONFIG"

# Restart Continuwuity
echo ""
echo "=== Step 7: Restart Continuwuity ==="
docker restart continuwuity 2>&1
sleep 10
echo "Continuwuity restarted. 检查日志..."
docker logs continuwuity --tail 20 2>&1 | grep -i 'matrix_rtc\|livekit\|federation\|error' || echo "(无匹配日志)"

# ========== Step 8: 公网验收 ==========
echo ""
echo "========================================================"
echo " 公网验收"
echo "========================================================"

echo ""
echo "1. LiveKit lk-jwt-service healthz (公网):"
curl -sk --max-time 10 "https://${LIVEKIT_DOMAIN}/healthz" 2>&1 || echo "(还不通，等 DNS 生效)"

echo ""
echo "2. LiveKit 主服务 (公网):"
curl -skI --max-time 10 "https://${LIVEKIT_DOMAIN}/" 2>&1 | head -3 || echo "(还不通)"

echo ""
echo "3. Continuwuity MSC4143 RTC transports (需要 auth token):"
echo "   curl -H 'Authorization: Bearer <token>' https://${MATRIX_DOMAIN}/_matrix/client/unstable/org.matrix.msc4143/rtc/transports"

echo ""
echo "4. Docker 容器最终状态:"
docker ps --filter "name=livekit" --filter "name=lk-jwt-service" --filter "name=continuwuity" --format "table {{.Names}}\t{{.Status}}"

echo ""
echo "========================================================"
echo "部署完成！"
echo "LiveKit: https://${LIVEKIT_DOMAIN}"
echo "Docker compose 文件: $APP_DIR/docker-compose.yaml"
echo "nginx conf: $NGINX_CONF"
echo "Continuwuity config: $CONDUWITIY_CONFIG"
echo ""
echo "阿里云安全组需开:"
echo "  7881/tcp  (LiveKit WebRTC TCP)"
echo "  50100-50200/udp  (LiveKit WebRTC UDP range)"
echo "========================================================"
