#!/bin/bash
set -e

echo "=== Step 1: Extract ==="
mkdir -p /opt/aie-app
cd /opt/aie-app
tar xzf /tmp/aie-backend-deploy.tar.gz
mv .env.prod .env
echo "Extracted OK"

echo "=== Step 2: Verify ==="
ls -la dist/ | head -5
echo "Prisma schema:"
head -3 prisma/schema.prisma
echo "ENV (key fields):"
grep -E "^PORT|^DATABASE_URL|^JWT_SECRET|^CONTINUUITY_ADMIN_TOKEN|^MATRIX_BOT" .env

echo "=== Step 3: npm install ==="
npm install --production --no-audit --no-fund 2>&1 | tail -10
echo "npm OK"

echo "=== Step 4: prisma generate ==="
npx prisma generate 2>&1 | tail -5

echo "=== Step 5: prisma db push ==="
npx prisma db push 2>&1 | tail -10

echo "=== Step 6: pm2 start ==="
# Remove old app-backend if exists
pm2 delete app-backend 2>/dev/null || true
pm2 start /opt/aie-app/dist/index.js --name app-backend
sleep 3
pm2 save
echo "pm2 saved"

echo "=== Step 7: Verify ==="
curl -s http://localhost:3101/health
echo
pm2 list app-backend
