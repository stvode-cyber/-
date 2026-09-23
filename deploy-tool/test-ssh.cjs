const { Client } = require('ssh2')

const HOST = '172.19.199.107'
const USER = 'root'
const PASS = 'trnepwq0101A'

const conn = new Client()

conn.on('ready', () => {
  console.log('SSH connected!')
  conn.exec('node -v && npm -v && which pm2 2>/dev/null || echo "no-pm2" && free -h | head -2 && df -h / | tail -1', (err, stream) => {
    if (err) { console.error('Exec error:', err); conn.end(); return }
    let output = ''
    stream.on('data', (d) => { output += d.toString() })
    stream.stderr.on('data', (d) => { output += d.toString() })
    stream.on('close', () => {
      console.log('Server info:\n' + output)
      conn.end()
    })
  })
})

conn.on('error', (err) => {
  console.error('SSH error:', err.message)
})

conn.connect({
  host: HOST,
  port: 22,
  username: USER,
  password: PASS,
  readyTimeout: 10000,
})
