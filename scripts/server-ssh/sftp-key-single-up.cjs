// 单文件上传器（覆盖模式 / 私钥认证 / 47.116.59.141）——含正确 SFTP 回调处理与大小校验
// 用法: node sftp-key-single-up.cjs <本地文件> <远端文件>
const { Client } = require('D:/源码存档/助理项目/助理项目/APP-AIE/scripts/server-ssh/node_modules/ssh2')
const fs = require('fs')

const HOST = process.env.AIDEV_SSH_HOST || '47.116.59.141'
const USER = process.env.AIDEV_SSH_USER || 'root'
const KEY = process.env.AIDEV_SSH_KEY || 'C:\\Users\\Administrator\\.ssh\\id_ed25519'

const local = process.argv[2]
const remote = process.argv[3]
if (!local || !remote) { console.error('[usage] node sftp-key-single-up.cjs <localFile> <remoteFile>'); process.exit(2) }

const conn = new Client()
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error('sftp 子系统建立失败:', err.message); conn.end(); process.exit(7) }
    const size = fs.statSync(local).size
    console.log('[upload]', local, '(', Math.round(size / 1048576), 'MB ) ->', remote)
    sftp.fastPut(local, remote, (uErr) => {
      if (uErr) { console.error('[upload] 失败:', uErr.message); conn.end(); process.exit(5) }
      sftp.stat(remote, (sErr, st) => {
        if (sErr) { console.log('[upload] 成功（stat 失败, 忽略）:', sErr.message); conn.end(); process.exit(0) }
        const ok = st.size === size
        console.log('[upload] 成功，远端', st.size, '本地', size, '一致 =', ok)
        conn.end()
        process.exit(ok ? 0 : 6)
      })
    })
  })
})
conn.on('error', (e) => { console.error('ssh err:', e.message); process.exit(4) })
conn.connect({ host: HOST, port: 22, username: USER, privateKey: fs.readFileSync(KEY, 'utf8'), readyTimeout: 30000 })