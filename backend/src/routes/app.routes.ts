import { Router } from 'express'
import { authRequired, adminRequired } from '../middleware/auth.js'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'

const router = Router()

const APP_DIR = path.resolve(process.cwd(), 'data')
const APK_PATH = path.join(APP_DIR, 'app-release.apk')

const RATE_MAP = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 30
const RATE_WINDOW = 60_000

function rateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = RATE_MAP.get(ip)
  if (!entry || now > entry.resetAt) {
    RATE_MAP.set(ip, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

// 获取应用信息（版本、大小等）
router.get('/info', (req, res) => {
  if (!fs.existsSync(APK_PATH)) {
    return res.json({ code: 404, message: 'APK 尚未上传', data: null })
  }
  const stat = fs.statSync(APK_PATH)
  const hash = crypto.createHash('md5').update(fs.readFileSync(APK_PATH)).digest('hex')
  res.json({
    code: 200,
    data: {
      appName: '绿角犀',
      version: '1.0.0',
      size: stat.size,
      sizeFormatted: `${(stat.size / 1024 / 1024).toFixed(2)} MB`,
      md5: hash,
      updatedAt: stat.mtime,
      downloadUrl: '/api/v1/app/android-apk',
    },
  })
})

// 下载 APK（免登录，限流防滥用）
router.get('/android-apk', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  if (!rateLimit(ip)) {
    return res.status(429).json({ code: 429, message: '下载过于频繁，请稍后再试' })
  }
  if (!fs.existsSync(APK_PATH)) {
    return res.status(404).json({ code: 404, message: 'APK 尚未上传' })
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive')
  res.setHeader('Content-Disposition', 'attachment; filename="greenrhino.apk"')
  fs.createReadStream(APK_PATH).pipe(res)
})

// 上传 APK（仅管理员）
router.post('/upload-apk', authRequired, adminRequired, (req, res) => {
  const { base64 } = req.body as { base64?: string }
  if (!base64) {
    return res.status(400).json({ code: 400, message: '缺少 base64 字段' })
  }

  const buf = Buffer.from(base64, 'base64')
  if (buf.length > 100 * 1024 * 1024) {
    return res.status(413).json({ code: 413, message: 'APK 不能超过 100MB' })
  }

  if (!fs.existsSync(APP_DIR)) {
    fs.mkdirSync(APP_DIR, { recursive: true })
  }
  fs.writeFileSync(APK_PATH, buf)
  const stat = fs.statSync(APK_PATH)

  res.json({
    code: 200,
    message: 'APK 上传成功',
    data: {
      size: stat.size,
      sizeFormatted: `${(stat.size / 1024 / 1024).toFixed(2)} MB`,
      updatedAt: stat.mtime,
    },
  })
})


// ============ Windows 桌面端在线更新检查 ============
// 客户端传入当前版本，返回是否有新版本 + 下载信息
// GET /api/v1/app/windows-version?current=1.0.5
router.get('/windows-version', async (req, res) => {
  try {
    const current = (req.query.current as string) || '0.0.0'
    const latest = await prisma.windowsRelease.findFirst({
      where: { isLatest: true },
      orderBy: { publishedAt: 'desc' },
    })
    if (!latest) {
      return res.json({ code: 404, message: '无发布记录', data: null })
    }
    // semver compare
    const cur = current.split('.').map(n => parseInt(n) || 0)
    const lat = latest.version.split('.').map(n => parseInt(n) || 0)
    let hasUpdate = false
    for (let i = 0; i < 3; i++) {
      if ((lat[i] || 0) > (cur[i] || 0)) { hasUpdate = true; break }
      if ((lat[i] || 0) < (cur[i] || 0)) break
    }
    // 调用日志：追踪有多少客户端在检查更新
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || 'unknown'
    console.log(`[windows-version] ip=${ip} current=${current} latest=${latest.version} hasUpdate=${hasUpdate}`)
    res.json({
      code: 200,
      data: {
        version: latest.version,
        current,
        hasUpdate,
        forceUpdate: latest.forceUpdate,
        sizeMB: latest.sizeMB,
        setupUrl: latest.setupUrl,
        portableUrl: latest.portableUrl,
        setupSha256: latest.setupSha256,
        notes: latest.notes,
        publishedAt: latest.publishedAt,
      },
    })
  } catch (err) {
    console.error('windows-version error:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

export default router
