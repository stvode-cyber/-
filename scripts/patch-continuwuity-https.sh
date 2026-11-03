#!/bin/bash
# Patch Continuwuity config: foci URL http://47.116.59.141:8081 → https://livekit.lujax.fun
# Run this AFTER: certbot success + nginx HTTPS reload
set -e

CFG=/root/continuwuity-config/config-v26.toml
BACKUP=${CFG}.bak-$(date +%Y%m%d%H%M%S)

echo "=== Backup ==="
cp "$CFG" "$BACKUP"
echo "Backed up → $BACKUP"

echo ""
echo "=== Current foci ==="
grep -A5 'matrix_rtc' "$CFG"

echo ""
echo "=== Patch: HTTP IP → HTTPS domain ==="
# Replace hardcoded HTTP IP with HTTPS domain
sed -i 's|http://47\.116\.59\.141:8081|https://livekit.lujax.fun|g' "$CFG"
sed -i 's|livekit_service_url = "http://|livekit_service_url = "https://|g' "$CFG"

echo ""
echo "=== After patch ==="
grep -A5 'matrix_rtc' "$CFG"

echo ""
echo "=== Restart Continuwuity ==="
systemctl restart continuwuity-gateway 2>&1 || service continuwuity-gateway restart 2>&1 || echo "(no systemctl/service - check manually)"

echo ""
echo "DONE ✅"
