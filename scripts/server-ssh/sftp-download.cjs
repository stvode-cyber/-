// sftp 下载脚本：从服务器拉取文件到本机存档
// 用法: node sftp-download.cjs <远端路径> <本地路径> [本地路径2 =远端]
const { Client } = require('D:/源码存档/助理项目/助理项目/APP-AIE/scripts/server-ssh/node_modules/ssh2')
const fs = require('fs')
const path = require('path')

const HOST = process.env.AIDEV_SSH_HOST || '47.116.59.141'
const USER = process.env.AIDEV_SSH_USER || 'root'
const PASS = process.env.AIDEV_SSH_PASS

// 参数: (remote, local) 支持多组
const pairs = []
const args = process.argv.slice(2)
for (let i = 0; i + 1 < args.length; i += 2) {
  pairs.push({ remote: args[i], local: args[i + 1] })
}
if (!PASS || pairs.length === 0) {
  console.error('[usage] AIDEV_SSH_PASS=xxx node sftp-download.cjs <remote> <local> [<remote> <local>...]')
  process.exit(2)
}

const conn = new Client()
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error('sftp err:', err.message); conn.end(); process.exit(3) }
    downloadAll(sftp)
  })
})
conn.on('error', (e) => { console.error('ssh err:', e.message); process.exit(4) })
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 })

async function downloadAll(sftp) {
  try {
    for (const p of pairs) {
      fs.mkdirSync(path.dirname(path.resolve(p.local)), { recursive: true })
      await new Promise((resolve, reject) => {
        sftp.fastGet(p.remote, p.local, (e) => {
          if (e) { console.error('下载失败 ' + p.remote + ': ' + e.message); return reject(e) }
          const size = fs.statSync(p.local).size
          console.log('已下载 ' + p.remote + ' -> ' + p.local + ' (' + size + ' 字节)')
          resolve()
        })
      })
    }
    conn.end()
    process.exit(0)
  } catch (e) { conn.end(); process.exit(5) }
}