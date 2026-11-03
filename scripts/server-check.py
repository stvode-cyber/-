#!/usr/bin/env python3
"""Server-side checks + try IMDSv2 RAM role. Python 3.6 compat."""
import subprocess
import json
import sys

def sh(cmd):
    p = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        out, err = p.communicate(timeout=10)
        return type('R', (), {'stdout': out.decode(), 'stderr': err.decode(), 'returncode': p.returncode})()
    except:
        p.kill()
        return type('R', (), {'stdout': '', 'stderr': 'timeout', 'returncode': -1})()

print('=== 1. Internal service health ===')
for port, name in [(7880, 'LiveKit'), (8081, 'lk-jwt-service')]:
    r = sh('curl -sS --max-time 3 http://127.0.0.1:%d/healthz' % port)
    if r.returncode == 0:
        print('  %s :%d ✅ → %s' % (name, port, r.stdout.strip()[:80]))
    else:
        print('  %s :%d ❌ → %s' % (name, port, r.stderr.strip()[:80]))

print('\n=== 2. IMDSv2 RAM role token ===')
r = sh('curl -s -X PUT "http://100.100.100.200/latest/api/token" -H "X-aliyun-ecs-metadata-token-ttl-seconds: 21600" --max-time 3')
token = r.stdout.strip()
if token and len(token) > 20:
    print('  Token got ✅ (%d chars)' % len(token))
    r2 = sh('curl -s -H "X-aliyun-ecs-metadata-token: %s" http://100.100.100.200/latest/meta-data/ram/security-credentials/ --max-time 3' % token)
    roles = r2.stdout.strip()
    print('  RAM roles: %s' % roles)
    if roles and roles != '404 Not Found' and '<' not in roles:
        r3 = sh('curl -s -H "X-aliyun-ecs-metadata-token: %s" "http://100.100.100.200/latest/meta-data/ram/security-credentials/%s" --max-time 3' % (token, roles))
        try:
            creds = json.loads(r3.stdout)
            ak = creds.get('AccessKeyId', '')
            sk = creds.get('AccessKeySecret', '')
            tk = creds.get('SecurityToken', '')
            print('  AK: %s...' % ak[:12])
            print('  ✅ IMDSv2 creds available!')
            with open('/tmp/aliyun-creds.env', 'w') as f:
                f.write('export ALIBABA_CLOUD_ACCESS_KEY_ID=%s\n' % ak)
                f.write('export ALIBABA_CLOUD_ACCESS_KEY_SECRET=%s\n' % sk)
                f.write('export ALIBABA_CLOUD_SESSION_TOKEN=%s\n' % tk)
        except Exception as e:
            print('  Parse fail: %s, raw: %s' % (e, r3.stdout[:200]))
else:
    print('  IMDSv2 FAIL: %s' % (token[:80] if token else 'empty'))

print('\n=== 3. aliyun CLI ===')
r = sh('which aliyun')
if r.returncode == 0:
    print('  aliyun at %s ✅' % r.stdout.strip())
else:
    print('  aliyun NOT installed ❌ → installing...')
    r = sh('curl -sL https://raw.githubusercontent.com/aliyun/aliyun-cli/master/install.sh | bash 2>&1 | tail -5')
    print('  install: %s' % r.stdout.strip()[-300:])
    r2 = sh('which aliyun')
    if r2.returncode == 0:
        print('  now at %s ✅' % r2.stdout.strip())
