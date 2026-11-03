import socket

SERVER = '47.116.59.141'
ports = [7880, 7881, 8081]

for port in ports:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(3)
    try:
        s.connect((SERVER, port))
        print(f'  {port}/tcp OPEN  ✅')
    except Exception as e:
        print(f'  {port}/tcp FAIL  ❌  ({e})')
    finally:
        s.close()

print()
print('Also check UDP range 50100-50200 (best effort):')
import subprocess
r = subprocess.run(['ss', '-ulnp'], capture_output=True, text=True)
if '50100' in r.stdout or '50200' in r.stdout:
    print('  UDP 50100-50200 listening ✅ (on server, security group unknown)')
else:
    print('  UDP NOT LISTENING on server')
