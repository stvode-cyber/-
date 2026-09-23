const { Client } = require('ssh2')
const conn = new Client()
conn.on('ready', () => {
  const cmd = 'curl -s http://127.0.0.1:3001/health; echo "---"; firewall-cmd --list-all 2>/dev/null || iptables -L -n 2>/dev/null | head -15'
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); return }
    let out = ''
    stream.on('data', d => out += d)
    stream.stderr.on('data', d => out += d)
    stream.on('close', () => { console.log(out); conn.end() })
  })
})
conn.on('error', err => console.error('SSH error:', err.message))
conn.connect({ host: '121.40.145.206', port: 22, username: 'root', password: 'trnepwq0101A', readyTimeout: 15000 })
