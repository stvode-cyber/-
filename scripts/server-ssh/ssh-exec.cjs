/**
 * SSH 远程执行器（密码认证）
 * 用法：node ssh-exec.cjs <"远程命令">  或  cat command.sh | node ssh-exec.cjs
 * 读环境变量：AIDEV_SSH_HOST / AIDEV_SSH_USER / AIDEV_SSH_PASS
 * 输出：stdout/stderr + exit code
 */
const { Client } = require('ssh2')

const HOST = process.env.AIDEV_SSH_HOST || '47.116.59.141'
const USER = process.env.AIDEV_SSH_USER || 'root'
const PASS = process.env.AIDEV_SSH_PASS
let CMD = process.argv[2]

if (!PASS) {
  console.error('[usage] AIDEV_SSH_PASS=xxx [cmd |] node ssh-exec.cjs')
  process.exit(2)
}
// 若没有 argv[2]，读 stdin 完整命令
if (!CMD) {
  let buf = ''
  process.stdin.on('data', d => buf += d.toString())
  process.stdin.on('end', () => {
    CMD = buf.trim()
    doExec()
  })
} else {
  doExec()
}

function doExec() {

const conn = new Client()
conn
  .on('ready', () => {
    conn.exec(CMD, { pty: true }, (err, stream) => {
      if (err) {
        console.error('exec error:', err.message)
        conn.end()
        process.exit(3)
      }
      let out = ''
      stream
        .on('close', (code, signal) => {
          console.log('\n__SSH_EXIT__' + code)
          conn.end()
          process.exit(code ?? 0)
        })
        // 只吞掉假密码输入行的回显，保留其它输出
        .on('data', (d) => {
          const t = d.toString('utf8')
          process.stdout.write(t)
        })
        .stderr.on('data', (d) => {
          process.stderr.write(d.toString('utf8'))
        })
    })
  })
  .on('error', (err) => {
    console.error('ssh error:', err.message)
    process.exit(4)
  })
  .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 })
}