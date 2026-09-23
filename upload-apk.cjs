#!/usr/bin/env node
/**
 * APK 上传脚本
 * 用法: node upload-apk.cjs <apk-path> <server-url> <admin-token>
 * 示例: node upload-apk.cjs ./app-debug.apk http://127.0.0.1:3001/api/v1 eyJhb...
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const [,, apkPath, serverUrl, token] = process.argv

if (!apkPath || !serverUrl || !token) {
  console.error('用法: node upload-apk.cjs <apk路径> <服务器地址> <管理员token>')
  console.error('示例: node upload-apk.cjs ./app-debug.apk http://127.0.0.1:3001/api/v1 eyJhb...')
  process.exit(1)
}

if (!fs.existsSync(apkPath)) {
  console.error(`错误: APK 文件不存在: ${apkPath}`)
  process.exit(1)
}

const fileSize = fs.statSync(apkPath).size
console.log(`📦 APK 文件: ${apkPath} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`)

const buf = fs.readFileSync(apkPath)
const base64 = buf.toString('base64')
console.log(`🔄 Base64 编码完成 (${(base64.length / 1024 / 1024).toFixed(2)} MB)`)

const body = JSON.stringify({ base64 })
const url = new URL(serverUrl.replace(/\/$/, '') + '/app/upload-apk')

const options = {
  method: 'POST',
  hostname: url.hostname,
  port: url.port,
  path: url.pathname,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Content-Length': Buffer.byteLength(body),
  },
}

const client = url.protocol === 'https:' ? https : http

console.log(`⬆️  正在上传到 ${url.href} ...`)

const req = client.request(options, (res) => {
  let data = ''
  res.on('data', (chunk) => (data += chunk))
  res.on('end', () => {
    try {
      const json = JSON.parse(data)
      if (json.code >= 200 && json.code < 300) {
        console.log(`✅ 上传成功!`)
        console.log(`   大小: ${json.data.sizeFormatted}`)
        console.log(`   更新时间: ${json.data.updatedAt}`)
        console.log(`\n   下载地址: ${serverUrl.replace(/\/$/, '')}/app/android-apk`)
      } else {
        console.error(`❌ 上传失败: ${json.message || data}`)
        process.exit(1)
      }
    } catch {
      console.error(`❌ 解析响应失败: ${data}`)
      process.exit(1)
    }
  })
})

req.on('error', (e) => {
  console.error(`❌ 请求失败: ${e.message}`)
  process.exit(1)
})

req.write(body)
req.end()
