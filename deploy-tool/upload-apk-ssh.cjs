const { Client } = require('ssh2')
const fs = require('fs')
const path = require('path')

const HOST = '121.40.145.206'
const PASS = 'trnepwq0101A'
const REMOTE_DIR = '/root/greenrhino'

const apkPath = path.resolve(__dirname, '..', 'frontend/android/app/build/outputs/apk/debug/app-debug.apk')
const apkSize = fs.existsSync(apkPath) ? (fs.statSync(apkPath).length / 1024 / 1024).toFixed(2) : 'NOT FOUND'
console.log('APK:', apkSize, 'MB')

const scriptPath = path.join(__dirname, 'upload-apk-remote.sh')

const conn = new Client()
conn.on('ready', () => {
  console.log('SSH 连接成功')

  conn.sftp((err, sftp) => {
    if (err) { console.error(err); conn.end(); return }

    // 上传 APK
    console.log('上传 APK 文件...')
    const rs1 = fs.createReadStream(apkPath)
    const ws1 = sftp.createWriteStream(REMOTE_DIR + '/app-debug.apk')
    ws1.on('close', () => {
      console.log('APK 文件上传完成')

      // 上传脚本
      console.log('上传执行脚本...')
      const rs2 = fs.createReadStream(scriptPath)
      const ws2 = sftp.createWriteStream(REMOTE_DIR + '/upload-apk.sh')
      ws2.on('close', () => {
        console.log('脚本上传完成，执行...\n')
        sftp.end()

        conn.exec('chmod +x ' + REMOTE_DIR + '/upload-apk.sh && bash ' + REMOTE_DIR + '/upload-apk.sh', (err, stream) => {
          if (err) { console.error(err); conn.end(); return }
          let out = ''
          stream.on('data', d => { out += d; process.stdout.write(d) })
          stream.stderr.on('data', d => { out += d; process.stderr.write(d) })
          stream.on('close', () => {
            console.log('\n=== 完成 ===')
            conn.end()
          })
        })
      })
      rs2.pipe(ws2)
    })
    rs1.pipe(ws1)
  })
})

conn.on('error', err => console.error('SSH error:', err.message))
conn.connect({ host: HOST, port: 22, username: 'root', password: PASS, readyTimeout: 15000 })
