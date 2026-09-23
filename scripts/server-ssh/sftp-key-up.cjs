// SFTP 目录上传器（私钥认证 / 47.116.59.141 / 幂等）
// 用法: node sftp-key-up.cjs <本地目录> <远端目录>
// 仅 fastPut 上传文件，父目录用 mkdir（不强制 recursive，存在即忽略错误）
const { Client } = require('D:/源码存档/助理项目/助理项目/APP-AIE/scripts/server-ssh/node_modules/ssh2')
const fs = require('fs')
const path = require('path')

const HOST = process.env.AIDEV_SSH_HOST || '47.116.59.141'
const USER = process.env.AIDEV_SSH_USER || 'root'
const KEY = process.env.AIDEV_SSH_KEY || 'C:\\Users\\Administrator\\.ssh\\id_ed25519'

const local = process.argv[2]
const remote = process.argv[3]
if (!local || !remote) { console.error('[usage] node sftp-key-up.cjs <localDir> <remoteDir>'); process.exit(2) }

const conn = new Client()
conn.on('ready', () => conn.sftp(onSftp))
conn.on('error', (e) => { console.error('ssh err:', e.message); process.exit(4) })
conn.connect({ host: HOST, port: 22, username: USER, privateKey: fs.readFileSync(KEY, 'utf8'), readyTimeout: 20000 })

function collect(local, base, out) {
  for (const e of fs.readdirSync(local)) {
    const lp = path.join(local, e)
    const rel = (base ? base + '/' : '') + e
    if (fs.statSync(lp).isDirectory()) collect(lp, rel, out)
    else out.push({ lp, rel })
  }
  return out
}

function onSftp(sftp) {
  const files = collect(local, '', [])
  let i = 0, total = 0

  function mkdirNoAuth(dir, cb) {
    if (dir === remote || dir === '.') return cb()
    sftp.mkdir(dir, (e) => {
      // 已存在/任何错误都继续（后续 fastPut 会暴露真实问题）
      cb()
    })
  }

  function ensureParents(rel, cb) {
    const parts = rel.split('/')
    parts.pop() // 去掉文件名
    let cur = remote
    const steps = parts.filter(Boolean)
    if (steps.length === 0) return cb()
    let k = 0
    function nextStep() {
      if (k >= steps.length) return cb()
      cur = cur + '/' + steps[k++]
      sftp.mkdir(cur, () => nextStep()) // 已存在报错也继续
    }
    nextStep()
  }

  function next() {
    if (i >= files.length) { console.log('---- 完成 ' + total + 'B, ' + files.length + ' 文件 ----'); conn.end(); process.exit(0) }
    const f = files[i++]
    const dest = remote + '/' + f.rel
    ensureParents(f.rel, () => {
      sftp.fastPut(f.lp, dest, (e) => {
        if (e) { console.error('上传失败 ' + dest + ': ' + e.message); process.exit(3) }
        total += fs.statSync(f.lp).size
        console.log('  ✓ ' + dest + ' (' + fs.statSync(f.lp).size + 'B)')
        next()
      })
    })
  }
  next()
}