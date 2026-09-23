// SSH 远程执行器（私钥认证 / 47.116.59.141）
// 用法：Get-Content script.txt | node ssh-key.cjs   或   node ssh-key.cjs "<cmd>"
const { Client } = require('D:/源码存档/助理项目/助理项目/APP-AIE/scripts/server-ssh/node_modules/ssh2')
const fs = require('fs')

const HOST = process.env.AIDEV_SSH_HOST || '47.116.59.141'
const USER = process.env.AIDEV_SSH_USER || 'root'
const KEY = process.env.AIDEV_SSH_KEY || 'C:\\Users\\Administrator\\.ssh\\id_ed25519'

function connect() {
  const c = new Client()
  return new Promise((resolve, reject) => {
    c.on('ready', () => resolve(c))
    c.on('error', (e) => { console.error('ssh err:', e.message); reject(e) })
    c.connect({ host: HOST, port: 22, username: USER, privateKey: fs.readFileSync(KEY, 'utf8'), readyTimeout: 20000 })
  })
}

function exec(c, cmd) {
  return new Promise((resolve) => {
    c.exec(cmd, (err, stream) => {
      if (err) { console.error('exec err:', err.message); resolve(3); return }
      let code = 0
      stream.on('close', (c_) => { code = c_ ?? 0 })
      stream.on('data', (d) => process.stdout.write(d))
      stream.stderr.on('data', (d) => process.stderr.write(d))
      stream.on('close', (c_) => { resolve(c_ ?? 0) })
    })
  })
}

async function main() {
  const cmd = process.argv[2] || fs.readFileSync(0, 'utf8').trim()
  if (!cmd) { console.error('[usage] node ssh-key.cjs <cmd>'); process.exit(2) }
  const c = await connect()
  await exec(c, cmd)
  c.end()
}

main().catch((e) => { console.error(e.message); process.exit(4) })