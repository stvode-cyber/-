#!/bin/bash
echo "=== Ports (internal) ==="
for port in 7880 7881 8081; do
  timeout 1 bash -c "echo > /dev/tcp/127.0.0.1/$port" 2>/dev/null && echo "$port/tcp OPEN ✅" || echo "$port/tcp FAIL ❌"
done

echo ""
echo "=== Public HTTP test (from server) ==="
curl -sS --max-time 3 http://127.0.0.1:7880/healthz 2>&1
echo ""
curl -sS --max-time 3 http://127.0.0.1:8081/healthz 2>&1

echo ""
echo "=== Let's Encrypt attempt ==="
# Try certbot (DNS must resolve to our IP now)
curl -sI --max-time 5 http://livekit.lujax.fun/healthz 2>&1 | head -5

echo ""
echo "=== livekit.lujax.fun DNS ==="
dig +short livekit.lujax.fun 2>&1 || nslookup livekit.lujax.fun 2>&1 | head -3
