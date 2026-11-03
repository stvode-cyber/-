#!/usr/bin/env python3
import socket
import sys

host = 'livekit.lujax.fun'
print('=== DNS resolve %s ===' % host)
try:
    # Get all A records
    results = socket.getaddrinfo(host, 80, socket.AF_INET, socket.SOCK_STREAM)
    ips = list(set([r[4][0] for r in results]))
    print('A records (v4): %s' % ips)
except Exception as e:
    print('A record fail: %s' % e)

try:
    results6 = socket.getaddrinfo(host, 80, socket.AF_INET6, socket.SOCK_STREAM)
    ips6 = list(set([r[4][0] for r in results6]))
    print('AAAA records (v6): %s' % ips6)
except Exception as e:
    print('AAAA fail: %s' % e)

expected_v4 = '47.116.59.141'
try:
    v4 = socket.gethostbyname(host)
    print('\ngethostbyname → %s (expected %s)' % (v4, expected_v4))
    if v4 == expected_v4:
        print('✅ DNS-only confirmed! A record points to Alibaba Cloud')
    elif v4.startswith('104.') or v4.startswith('172.') or v4.startswith('198.') or v4.startswith('2606:'):
        print('❌ Still Cloudflare proxying! (Cloudflare IP detected)')
    else:
        print('⚠️ Unknown IP: %s' % v4)
except Exception as e:
    print('resolve fail: %s' % e)
