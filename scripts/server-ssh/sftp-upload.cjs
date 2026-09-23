// sftp 上传脚本：从本机推送文件到服务器静态目录
// 用法: node sftp-upload.cjs <本地路径> <远端路径> [本地路径2 远端路径2]
// 读环境变量 AIDEV_SSH_HOST / AIDEV_SSH_USER / AIDEV_SSH_PASS
const { Client } = require('D:/源码存档/助理项目/助理项目/APP-AIE/scripts/server-ssh/node_modules/ssh2')
const fs = require('fs')
const path = require('path')

const HOST = process.env.AIDEV_SSH_HOST || '47.116.59.141'
const USER = process.env.AIDEV_SSH_USER || 'root'
const PASS = process.env.AIDEV_SSH_PASS

// 参数: (local, remote) 支持多组
const pairs = []
const args = process.argv.slice(2)
for (let i = 0; i + 1 < args.length; i += 2) {
  pairs.push({ local: args[i], remote: args[i + 1] })
}
if (!PASS || pairs.length === 0) {
  console.error('[usage] AIDEV_SSH_PASS=xxx node sftp-upload.cjs <local> <remote> [<local> <remote>...]')
  process.exit(2)
}

const conn = new Client()
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error('sftp err:', err.message); conn.end(); process.exit(3) }
    uploadAll(sftp)
  })
})
conn.on('error', (e) => { console.error('ssh err:', e.message); process.exit(4) })
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 })

async function uploadAll(sftp) {
  try {
    for (const p of pairs) {
      if (!fs.existsSync(p.local)) {
        console.error('本地文件不存在: ' + p.local);
        conn.end();
        process.exit(5);
      }
      await new Promise((resolve, reject) => {
        sftp.fastPut(p.local, p.remote, (e) => {
          if (e) { console.error('上传失败 ' + p.local + ' -> ' + p.remote + ': ' + e.message); return reject(e) }
          const size = fs.statSync(p.local).size
          console.log('已上传 ' + p.local + ' -> ' + p.remote + ' (' + size + ' 字节)')
          resolve()
        })
      })
    }
    conn.end()
    process.exit(0)
  } catch (e) { conn.end(); process.exit(6) }
}
