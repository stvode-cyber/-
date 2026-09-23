const fs = require('fs')
const http = require('http')
const path = require('path')

const envContent = fs.readFileSync(path.join(__dirname, 'backend/.env'), 'utf8')
const usernameMatch = envContent.match(/ADMIN_USERNAME="(.+?)"/)
const passwordMatch = envContent.match(/ADMIN_PASSWORD="(.+?)"/)
const username = usernameMatch ? usernameMatch[1] : 'admin'
const password = passwordMatch ? passwordMatch[1] : ''

console.log('Logging in as:', username)

const loginBody = JSON.stringify({ username, password })
const loginReq = http.request({
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/v1/auth/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
}, (res) => {
  let data = ''
  res.on('data', (c) => (data += c))
  res.on('end', () => {
    const json = JSON.parse(data)
    if (json.code !== 200) {
      console.error('Login failed:', json.message)
      process.exit(1)
    }
    const token = json.data.token
    console.log('Login OK, uploading APK...')

    const apkPath = path.join(__dirname, 'frontend/android/app/build/outputs/apk/debug/app-debug.apk')
    const apkBuf = fs.readFileSync(apkPath)
    const base64 = apkBuf.toString('base64')
    console.log(`APK: ${(apkBuf.length / 1024 / 1024).toFixed(2)} MB | base64: ${(base64.length / 1024 / 1024).toFixed(2)} MB`)

    const uploadBody = JSON.stringify({ base64 })
    const uploadReq = http.request({
      hostname: '127.0.0.1',
      port: 3001,
      path: '/api/v1/app/upload-apk',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        'Content-Length': Buffer.byteLength(uploadBody),
      },
    }, (res2) => {
      let d2 = ''
      res2.on('data', (c) => (d2 += c))
      res2.on('end', () => {
        const j2 = JSON.parse(d2)
        if (j2.code >= 200 && j2.code < 300) {
          console.log('Upload OK! Size:', j2.data.sizeFormatted)
          console.log('Download URL: http://127.0.0.1:3001/api/v1/app/android-apk')
        } else {
          console.error('Upload failed:', j2.message || d2)
        }
      })
    })
    uploadReq.on('error', (e) => console.error('Upload error:', e.message))
    uploadReq.write(uploadBody)
    uploadReq.end()
  })
})
loginReq.on('error', (e) => console.error('Login error:', e.message))
loginReq.write(loginBody)
loginReq.end()
