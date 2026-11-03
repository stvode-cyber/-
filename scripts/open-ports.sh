#!/bin/bash
# Open LiveKit ports via aliyun CLI or fallback
SG="sg-uf639nktwpt4rchwvkcc"
REGION="cn-shanghai"

echo "=== 1. Try RAM role STS ==="
ROLE=$(curl -s --max-time 3 http://100.100.100.200/latest/meta-data/ram/security-credentials/ 2>/dev/null || true)
echo "RAM roles: $ROLE"
if [ -n "$ROLE" ]; then
    CREDS=$(curl -s --max-time 3 "http://100.100.100.200/latest/meta-data/ram/security-credentials/$ROLE" 2>/dev/null || true)
    if echo "$CREDS" | grep -q AccessKeyId; then
        AK=$(echo "$CREDS" | grep -o '"AccessKeyId":"[^"]*"' | cut -d'"' -f4)
        SK=$(echo "$CREDS" | grep -o '"AccessKeySecret":"[^"]*"' | cut -d'"' -f4)
        TK=$(echo "$CREDS" | grep -o '"SecurityToken":"[^"]*"' | cut -d'"' -f4)
        echo "STS AK: ${AK:0:8}..."
        export ALIBABA_CLOUD_ACCESS_KEY_ID="$AK"
        export ALIBABA_CLOUD_ACCESS_KEY_SECRET="$SK"
        export ALIBABA_CLOUD_SESSION_TOKEN="$TK"
        USE_STS=1
    fi
fi

echo ""
echo "=== 2. Try existing aliyun config ==="
if aliyun configure list 2>/dev/null | grep -q "AccessKey"; then
    echo "Config exists, will use it"
    USE_EXISTING=1
fi

echo ""
echo "=== 3. Check existing rules ==="
aliyun ecs DescribeSecurityGroupAttribute --SecurityGroupId "$SG" --RegionId "$REGION" 2>&1 | head -40

echo ""
echo "=== 4. Add rules ==="

add_rule() {
    local proto=$1 port=$2 desc=$3
    echo "--- $proto $port ---"
    aliyun ecs AuthorizeSecurityGroup \
        --SecurityGroupId "$SG" \
        --RegionId "$REGION" \
        --Protocol "$proto" \
        --PortRange "$port/$port" \
        --SourceCidrIp 0.0.0.0/0 \
        --Policy accept \
        --Priority 1 \
        --Description "$desc" 2>&1
}

add_rule tcp 7880 "LiveKit HTTP" || echo "(may already exist)"
add_rule tcp 7881 "LiveKit RTC TCP" || echo "(may already exist)"
add_rule tcp 8081 "lk-jwt-service" || echo "(may already exist)"

# UDP range
echo "--- udp 50100-50200 ---"
aliyun ecs AuthorizeSecurityGroup \
    --SecurityGroupId "$SG" \
    --RegionId "$REGION" \
    --Protocol udp \
    --PortRange 50100/50200 \
    --SourceCidrIp 0.0.0.0/0 \
    --Policy accept \
    --Priority 1 \
    --Description "LiveKit UDP" 2>&1

echo ""
echo "=== 5. Verify ==="
aliyun ecs DescribeSecurityGroupAttribute --SecurityGroupId "$SG" --RegionId "$REGION" 2>&1 | grep -E "7880|7881|8081|50100" | head -10

echo ""
echo "DONE"
