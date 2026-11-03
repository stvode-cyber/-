#!/usr/bin/env python3
"""Verify LiveKit public connectivity from OUTSIDE the server."""
import socket
import subprocess
import sys

SERVER = '47.116.59.141'
DNS_HOST = 'livekit.lujax.fun'

# 1. Public TCP ports
print('=== 1. Public TCP ports (from server itself = internal, need external) ===')
ports = {7880: 'LiveKit HTTP', 7881: 'LiveKit RTC TCP', 8081: 'lk-jwt-service'}
for port, name in ports.items():
    s = socket.socket()
    s.settimeout(3)
    try:
        s.connect((SERVER, port))
        print(f'  {port}/tcp OPEN  ✅  ({name})')
    except Exception as e:
        print(f'  {port}/tcp FAIL  ❌  ({name}: {e})')
    finally:
        s.close()

# 2. DNS resolve
print(f'\n=== 2. DNS {DNS_HOST} ===')
try:
    ip = socket.gethostbyname(DNS_HOST)
    expected = '47.116.59.141'
    if ip == expected:
        print(f'  DNS ✅ → {ip} (expected)')
    else:
        print(f'  DNS ❌ → {ip} (expected {expected} — still Cloudflare proxy!)')
except Exception as e:
    print(f'  DNS FAIL ❌ ({e})')

# 3. HTTP test
print(f'\n=== 3. HTTP {DNS_HOST}/healthz ===')
try:
    r = subprocess.run(['curl', '-sI', '--max-time', '5', f'http://{DNS_HOST}/healthz'],
                      capture_output=True, text=True)
    lines = r.stdout.strip().split('\n')
    if lines:
        print(f'  {lines[0]}')
        if '200' in lines[0]:
            print('  ✅ 公网可达!')
        elif '530' in lines[0]:
            print('  ❌ Cloudflare 还在代理 (530 = Cloudflare DNS error)')
        elif '502' in lines[0] or '504' in lines[0]:
            print('  ❌ nginx 可达但后端没通')
except Exception as e:
    print(f'  curl FAIL ❌ ({e})')

print('\nDONE')
