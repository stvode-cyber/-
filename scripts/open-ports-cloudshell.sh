#!/bin/bash
# One-liner to open all 4 LiveKit ports on Aliyun security group
# Paste ENTIRE block into Cloud Shell (already configured with aliyun CLI)

SG=sg-uf639nktwpt4rchwvkcc
R=cn-shanghai

echo "Opening LiveKit ports on $SG..."

for port in 7880/tcp 7881/tcp 8081/tcp; do
  p=${port%/*}; proto=${port#*/}
  aliyun ecs AuthorizeSecurityGroup --SecurityGroupId $SG --RegionId $R --Protocol $proto --PortRange $p/$p --SourceCidrIp 0.0.0.0/0 --Policy accept --Priority 1 --Description "LiveKit $p" 2>&1 | grep -E "RequestId|Error|invalid" || echo "$proto $p OK (or dup)"
done

# UDP range
aliyun ecs AuthorizeSecurityGroup --SecurityGroupId $SG --RegionId $R --Protocol udp --PortRange 50100/50200 --SourceCidrIp 0.0.0.0/0 --Policy accept --Priority 1 --Description "LiveKit UDP" 2>&1 | grep -E "RequestId|Error|invalid" || echo "udp 50100-50200 OK (or dup)"

echo ""
echo "Verify rules:"
aliyun ecs DescribeSecurityGroupAttribute --SecurityGroupId $SG --RegionId $R 2>&1 | grep -A1 -E "7880|7881|8081|50100" || echo "(grep miss - check full output above)"

echo ""
echo "DONE - 公网端口验收: curl -sI http://47.116.59.141:7880/"
