#!/bin/bash
cd /root/greenrhino

echo "构建 JSON body..."
B64=$(base64 -w0 app-debug.apk)
echo -n '{"base64":"' > /tmp/apk-body.json
echo -n "$B64" >> /tmp/apk-body.json
echo '"}' >> /tmp/apk-body.json
echo "Body size: $(wc -c < /tmp/apk-body.json) bytes"

echo "登录..."
LOGIN_RESP=$(curl -s -X POST http://127.0.0.1:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"cSQuH83lZSy58IQq"}')
TOKEN=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "登录失败: $LOGIN_RESP"
  exit 1
fi
echo "Token OK"

echo "上传 APK..."
RESULT=$(curl -s -X POST http://127.0.0.1:3001/api/v1/app/upload-apk \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @/tmp/apk-body.json)
echo "上传结果: $RESULT"

rm -f /tmp/apk-body.json

echo "验证..."
curl -s http://127.0.0.1:3001/api/v1/app/info
echo ""
echo "DONE"
