const fs = require('fs')
const http = require('http')
const path = require('path')

const SERVER = '121.40.145.206'
const PORT = 3001

// Read admin credentials from .env
const envContent = fs.readFileSync(path.join(__dirname, 'backend/.env'), 'utf8')
const username = (envContent.match(/ADMIN_USERNAME="(.+?)"/) || [,'admin'])[1]
const password = (envContent.match(/ADMIN_PASSWORD="(.+?)"/) || [,''])[1]

console.log(`上传 APK 到 ${SERVER}:${PORT}`)
console.log('登录账号:', username)

const loginBody = JSON.stringify({ username, password })
const loginReq = http.request({
  hostname: SERVER, port: PORT, path: '/api/v1/auth/login', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
}, (res) => {
  let data = ''
  res.on('data', c => data += c)
  res.on('end', () => {
    const json = JSON.parse(data)
    if (json.code !== 200) { console.error('登录失败:', json.message); process.exit(1) }
    const token = json.data.token
    console.log('登录成功，上传 APK...')

    const apkPath = path.join(__dirname, 'frontend/android/app/build/outputs/apk/debug/app-debug.apk')
    const apkBuf = fs.readFileSync(apkPath)
    const base64 = apkBuf.toString('base64')
    console.log(`APK: ${(apkBuf.length / 1024 / 1024).toFixed(2)} MB | base64: ${(base64.length / 1024 / 1024).toFixed(2)} MB`)

    const uploadBody = JSON.stringify({ base64 })
    const uploadReq = http.request({
      hostname: SERVER, port: PORT, path: '/api/v1/app/upload-apk', method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'Content-Length': Buffer.byteLength(uploadBody) },
    }, (res2) => {
      let d2 = ''
      res2.on('data', c => d2 += c)
      res2.on('end', () => {
        const j2 = JSON.parse(d2)
        if (j2.code >= 200 && j2.code < 300) {
          console.log('上传成功! 大小:', j2.data.sizeFormatted)
          console.log(`\n下载地址: http://${SERVER}:${PORT}/api/v1/app/android-apk`)
          console.log(`应用信息: http://${SERVER}:${PORT}/api/v1/app/info`)

          // 验证
          http.get(`http://${SERVER}:${PORT}/api/v1/app/info`, (r) => {
            let d = ''
            r.on('data', c => d += c)
            r.on('end', () => console.log('验证:', d))
          })
        } else { console.error('上传失败:', j2.message || d2) }
      })
    })
    uploadReq.on('error', e => console.error('上传错误:', e.message))
    uploadReq.write(uploadBody)
    uploadReq.end()
  })
})
loginReq.on('error', e => console.error('登录错误:', e.message))
loginReq.write(loginBody)
loginReq.end()
