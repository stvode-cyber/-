#!/bin/bash
# Patch nginx HTTPS server block: add /api/v1/app/ -> Express 3101
# Location: right after /api/v1/auth/ block

set -e
NGINX_CONF="/etc/nginx/conf.d/continuwuity.conf"
BACKUP="/etc/nginx/conf.d/continuwuity.conf.bak.$(date +%Y%m%d-%H%M%S)"

echo "=== Backup ==="
cp "$NGINX_CONF" "$BACKUP"
echo "Backup: $BACKUP"

echo "=== Find /api/v1/auth/ block ==="
grep -n "/api/v1/auth/" "$NGINX_CONF"

# Find line with "location ~ ^/api/v1/auth/" and insert after the closing brace
# The auth block ends with "}" on its own line, followed by the admin block
# We want to insert a new location block right after auth's closing brace

python3 << PYEOF
import re

NGINX_CONF = "$NGINX_CONF"

with open(NGINX_CONF, 'r') as f:
    content = f.read()

# New block to insert (mirrors the /api/v1/auth/ pattern)
new_block = """
    # 绿角犀 Express app（Android 自动更新 / Windows 版本检查）
    location ~ ^/api/v1/app/ {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
"""

# Find the /api/v1/auth/ block and insert after its closing brace
# Pattern: match the /api/v1/auth/ location block, capture until its closing }
pattern = r'(location ~ \^/api/v1/auth/ \{[^}]*\n\s*\})'
replacement = r'\1' + new_block

new_content = re.sub(pattern, replacement, content, count=1)

if new_content == content:
    print("ERROR: Could not find /api/v1/auth/ block!")
    exit(1)

with open(NGINX_CONF, 'w') as f:
    f.write(new_content)

print("Patched OK")
PYEOF

echo "=== Test nginx ==="
nginx -t

echo "=== Reload ==="
nginx -s reload

echo "=== Verify ==="
echo "HTTPS API:"
curl -sk --max-time 10 "https://lujax.fun/api/v1/app/android-version?current=1.0.2"
echo
echo "HTTPS APK:"
curl -skI --max-time 10 "https://lujax.fun/apk/aie-mobile-1.0.4.apk" | head -3
