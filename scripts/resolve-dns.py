import socket
ip = socket.gethostbyname('livekit.lujax.fun')
print(f'livekit.lujax.fun -> {ip}')
expected = '47.116.59.141'
print(f'Expected: {expected}')
if ip == expected:
    print('DNS ✅ OK (pointing directly)')
else:
    print(f'DNS ❌ WRONG (still going through Cloudflare proxy)')
    print('ACTION NEEDED: In Cloudflare dashboard -> DNS -> Records -> find livekit A record -> toggle orange cloud to GREY (DNS only)')
