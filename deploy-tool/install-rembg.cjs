const { Client } = require('ssh2')
const conn = new Client()

conn.on('ready', () => {
  console.log('SSH connected, installing rembg...')

  const cmds = [
    ['检查 Python', 'python3 --version 2>&1'],
    ['安装 pip', 'yum install -y python3-pip 2>&1 | tail -3'],
    ['安装 rembg', 'pip3 install rembg onnxruntime 2>&1 | tail -5'],
    ['验证 rembg', 'rembg --version 2>&1 || python3 -m rembg --help 2>&1 | head -3'],
  ]

  function run(i) {
    if (i >= cmds.length) {
      console.log('\n=== rembg 安装完成 ===')
      conn.end()
      return
    }
    console.log(`\n${i + 1}. ${cmds[i][0]}...`)
    conn.exec(cmds[i][1], (err, stream) => {
      if (err) { console.error(err); run(i + 1); return }
      let out = ''
      stream.on('data', d => out += d)
      stream.stderr.on('data', d => out += d)
      stream.on('close', () => {
        console.log('   ' + out.trim().split('\n').slice(-3).join('\n   '))
        run(i + 1)
      })
    })
  }
  run(0)
})

conn.on('error', err => console.error('SSH error:', err.message))
conn.connect({ host: '121.40.145.206', port: 22, username: 'root', password: 'trnepwq0101A', readyTimeout: 30000 })
