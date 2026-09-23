/**
 * 远程文件访问服务（手机 → 电脑局域网直连）
 *
 * 架构：
 * - 独立 Express 实例监听 0.0.0.0:PORT（与主后端 127.0.0.1 隔离，默认关闭）
 * - 手机浏览器扫码打开 H5 页面，输访问码换 12h 令牌
 * - 只授权白名单目录（roots，默认桌面/文档/下载/图片），全链路路径穿越校验
 * - AI 找文件：llmGenerateChat 解析意图 → 本地递归搜索 → 返回可下载结果
 *
 * 安全：
 * - 默认关闭，需在 PC 设置页显式开启
 * - 访问码认证失败限流（5 次/分钟/IP）
 * - 上传扩展名黑名单（.html/.svg/.js 等可执行/钓鱼类型）+ 200MB 上限
 * - 删除仅限文件（不递归删目录），必须显式 confirm
 */
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { promises as fsp } from 'fs'
import { llmGenerateChat } from './llmService.js'
import { buildRemotePageHTML } from './remoteFilePage.js'

// ===================== 配置 =====================

export interface RemoteAccessConfig {
  enabled: boolean
  port: number
  code: string
  roots: string[]
}

/** 每次启动随机生成的令牌密钥（重启后所有手机端令牌失效，需重新输码） */
let tokenSecret = crypto.randomBytes(32).toString('hex')
let serverInstance: import('http').Server | null = null

function getDataDir(): string {
  const dbUrl = process.env.DATABASE_URL || ''
  if (dbUrl.startsWith('file:')) {
    return path.dirname(dbUrl.slice('file:'.length))
  }
  return path.join(process.cwd(), 'data')
}

function getConfigPath(): string {
  return path.join(getDataDir(), 'remote-access.json')
}

/** 自动更新源目录：<userData>/updates（与主进程 publish-update.cjs / updater.cjs 一致） */
function getUpdatesDir(): string {
  return path.join(path.dirname(getDataDir()), 'updates')
}

/** 生成 6 位访问码（去掉易混淆字符） */
function genCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[crypto.randomInt(chars.length)]
  return s
}

function defaultRoots(): string[] {
  const home = os.homedir()
  return ['Desktop', 'Documents', 'Downloads', 'Pictures']
    .map((d) => path.join(home, d))
    .filter((p) => fs.existsSync(p))
}

export function loadConfig(): RemoteAccessConfig {
  const defaults: RemoteAccessConfig = {
    enabled: false,
    port: 3900,
    code: genCode(),
    roots: defaultRoots(),
  }
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8')
    const saved = JSON.parse(raw)
    return {
      enabled: saved.enabled === true,
      port: Number.isInteger(saved.port) && saved.port > 1024 && saved.port < 65536 ? saved.port : defaults.port,
      code: typeof saved.code === 'string' && /^[A-Z0-9]{6}$/.test(saved.code) ? saved.code : defaults.code,
      roots: Array.isArray(saved.roots) && saved.roots.every((r: unknown) => typeof r === 'string')
        ? saved.roots.filter((r: string) => fs.existsSync(r))
        : defaults.roots,
    }
  } catch {
    return defaults
  }
}

function saveConfig(cfg: RemoteAccessConfig): void {
  fs.mkdirSync(getDataDir(), { recursive: true })
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

// ===================== 路径安全 =====================

/** 校验用户给的路径是否落在白名单目录内，返回绝对路径；非法返回 null */
function safeResolve(roots: string[], userPath: string): string | null {
  if (!userPath || typeof userPath !== 'string') return null
  const abs = path.resolve(userPath)
  for (const root of roots) {
    const r = path.resolve(root)
    if (abs === r || abs.startsWith(r + path.sep)) {
      // 附加校验：拒绝保留字目录段
      if (/(__proto__|constructor|prototype)/.test(abs)) return null
      return abs
    }
  }
  return null
}

// ===================== 工具 =====================

function getLanIPs(): string[] {
  const result: string[] = []
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const it of list || []) {
      if (it.family === 'IPv4' && !it.internal) result.push(it.address)
    }
  }
  return result
}

const UPLOAD_BLOCKED_EXT = /\.(html?|xhtml|xht|svg|js|mjs|vbs)$/i
const MAX_UPLOAD = 200 * 1024 * 1024

// 简易 MIME 表（下载/预览用）
const MIME: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.csv': 'text/csv; charset=utf-8',
}

// ===================== 文件搜索（AI 用） =====================

interface FoundFile {
  name: string
  path: string
  size: number
  mtime: string
}

/** 递归搜索文件名包含任一关键词的文件（限时 3 秒、深度 6、跳过系统目录） */
/** 常见扩展名（去掉点）。命中这些词时做精确扩展名匹配，而非文件名子串匹配 */
const EXT_KEYWORDS = new Set([
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'md', 'csv',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg',
  'zip', 'rar', '7z', 'tar', 'gz',
  'mp3', 'mp4', 'wav', 'mov', 'avi', 'mkv',
  'exe', 'msi', 'apk', 'json', 'html', 'htm', 'xml', 'js', 'ts', 'py',
])

/** 判断文件名是否匹配关键词：扩展名关键词精确匹配扩展名，其余走子串匹配 */
function matchFile(name: string, keyword: string): boolean {
  const lower = name.toLowerCase()
  const kw = keyword.toLowerCase()
  if (EXT_KEYWORDS.has(kw)) {
    return lower.endsWith('.' + kw)
  }
  return lower.includes(kw)
}

async function searchFiles(roots: string[], keywords: string[], baseDir?: string): Promise<FoundFile[]> {
  const results: FoundFile[] = []
  const deadline = Date.now() + 3000
  const SKIP = new Set(['node_modules', '.git', 'AppData', '$RECYCLE.BIN', 'System Volume Information', '.cache'])

  async function walk(dir: string, depth: number): Promise<void> {
    if (Date.now() > deadline || results.length >= 30 || depth > 6) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch { return }
    for (const e of entries) {
      if (Date.now() > deadline || results.length >= 30) return
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full, depth + 1)
      } else if (keywords.some((k) => k && matchFile(e.name, k))) {
        try {
          const st = await fsp.stat(full)
          results.push({ name: e.name, path: full, size: st.size, mtime: st.mtime.toISOString() })
        } catch { /* ignore */ }
      }
    }
  }

  if (baseDir) {
    await walk(baseDir, 0)
  } else {
    for (const r of roots) await walk(r, 0)
  }
  return results
}

// ===================== AI 意图解析 =====================

interface AiIntent {
  action: 'search' | 'list' | 'chat'
  keywords: string[]
  reply?: string
  dir?: string
}

/** 用 LLM 解析手机端自然语言指令；LLM 不可用时降级为关键词直搜 */
async function parseIntent(message: string, rootNames: string[]): Promise<AiIntent> {
  const sys = [
    '你是电脑文件助手。把用户的自然语言指令解析成 JSON（只输出 JSON，不要多余文字）：',
    '{"action":"search","keywords":["关键词1","关键词2"]} —— 用户想找某些文件（如"找一下合同"、"上周的照片"→keywords=["合同"]或按文件名猜["照片","png"]）',
    '{"action":"list","dir":"目录名"} —— 用户想看某个目录（dir 必须从这些里选：' + rootNames.join('/') + '）',
    '{"action":"chat","reply":"..."} —— 其他闲聊或无法理解时，用一句话回答或反问',
    '关键词要用文件名里可能出现的字词，多个候选都放进 keywords。',
  ].join('\n')

  try {
    const res = await llmGenerateChat([
      { role: 'system', content: sys },
      { role: 'user', content: message },
    ])
    if (res?.text) {
      const m = res.text.match(/\{[\s\S]*\}/)
      if (m) {
        const parsed = JSON.parse(m[0]) as AiIntent
        if (parsed && ['search', 'list', 'chat'].includes(parsed.action)) {
          return {
            action: parsed.action,
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5).map(String) : [],
            reply: parsed.reply,
            dir: parsed.dir,
          }
        }
      }
    }
  } catch { /* 降级 */ }

  // 降级：把消息按空格/标点切成关键词直接搜
  const kws = message.split(/[\s,，。？?！!的一下帮我找看看有没有]+/).filter((s) => s.length >= 2).slice(0, 3)
  return { action: kws.length ? 'search' : 'chat', keywords: kws, reply: kws.length ? undefined : '没听懂，试试"找合同"或"看下载目录"这类说法' }
}

// ===================== HTTP 服务 =====================

// 访问码失败计数（IP → {count, resetAt}）
const authFails = new Map<string, { count: number; resetAt: number }>()

function authRateLimited(ip: string): boolean {
  const now = Date.now()
  const rec = authFails.get(ip)
  if (!rec || rec.resetAt < now) {
    authFails.set(ip, { count: 0, resetAt: now + 60_000 })
    return false
  }
  return rec.count >= 5
}

function recordAuthFail(ip: string): void {
  const now = Date.now()
  const rec = authFails.get(ip)
  if (!rec || rec.resetAt < now) {
    authFails.set(ip, { count: 1, resetAt: now + 60_000 })
  } else {
    rec.count++
  }
}

/** 远程端令牌校验中间件 */
function remoteAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const token = (req.header('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  try {
    jwt.verify(token, tokenSecret, { algorithms: ['HS256'] })
    next()
  } catch {
    res.status(401).json({ ok: false, error: '令牌失效，请重新输入访问码' })
  }
}

function buildApp(cfg: RemoteAccessConfig): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  // 手机 H5 页面（无需令牌即可加载，数据接口全部要令牌）
  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(buildRemotePageHTML(cfg.code))
  })
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'remote-file' }))

  // ---- 自动更新源（公开只读，无需令牌）：应用启动时拉取 manifest.json + 更新包 ----
  // 载体：publish-update.cjs 把更新变更包发布到 <userData>/updates，经本端口/frp 公网链路分发
  const UPDATES_WHITELIST = /^(frontend-dist\.zip|backend-dist\.zip|schema\.prisma)$/
  app.get('/updates/manifest.json', (_req, res) => {
    const p = path.join(getUpdatesDir(), 'manifest.json')
    if (!fs.existsSync(p)) {
      res.status(404).json({ ok: false, error: '暂无更新' })
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.sendFile(p)
  })
  app.get('/updates/:file', (req, res) => {
    const name = String(req.params.file || '')
    if (!UPDATES_WHITELIST.test(name)) {
      res.status(404).end()
      return
    }
    const p = path.join(getUpdatesDir(), name)
    if (!fs.existsSync(p)) {
      res.status(404).end()
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(p)
  })

  // ---- 访问码换令牌 ----
  app.post('/auth', (req, res) => {
    const ip = req.ip || 'unknown'
    if (authRateLimited(ip)) {
      res.status(429).json({ ok: false, error: '尝试太频繁，一分钟后再来' })
      return
    }
    const code = String((req.body as any)?.code || '').trim().toUpperCase()
    if (!code || code !== cfg.code) {
      recordAuthFail(ip)
      res.status(401).json({ ok: false, error: '访问码不对' })
      return
    }
    const token = jwt.sign({ scope: 'remote-file' }, tokenSecret, { expiresIn: '12h', algorithm: 'HS256' })
    res.json({ ok: true, token })
  })

  // ---- 以下全部需要令牌 ----
  app.use('/api', remoteAuth)

  // 授权目录列表
  app.get('/api/roots', (_req, res) => {
    res.json({ ok: true, roots: cfg.roots.map((r) => ({ name: path.basename(r), path: r })) })
  })

  // 目录浏览
  app.get('/api/list', async (req, res) => {
    const dir = safeResolve(cfg.roots, String(req.query.path || ''))
    if (!dir) {
      res.status(400).json({ ok: false, error: '路径不在授权范围内' })
      return
    }
    try {
      const st = await fsp.stat(dir)
      if (!st.isDirectory()) {
        res.status(400).json({ ok: false, error: '不是目录' })
        return
      }
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      const items = []
      for (const e of entries) {
        if (e.name.startsWith('$') || e.name === 'System Volume Information') continue
        try {
          const est = await fsp.stat(path.join(dir, e.name))
          items.push({
            name: e.name,
            isDir: e.isDirectory(),
            size: e.isDirectory() ? 0 : est.size,
            mtime: est.mtime.toISOString(),
            path: path.join(dir, e.name),
          })
        } catch { /* 无权限读取的条目跳过 */ }
      }
      items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-CN') : a.isDir ? -1 : 1))
      res.json({ ok: true, dir, items: items.slice(0, 500) })
    } catch {
      res.status(404).json({ ok: false, error: '目录不存在或不可读' })
    }
  })

  // 文件下载/预览（sendFile 自带 Range 支持，手机可在线看视频/图片）
  app.get('/api/file', (req, res) => {
    const filePath = safeResolve(cfg.roots, String(req.query.path || ''))
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.status(404).json({ ok: false, error: '文件不存在' })
      return
    }
    const mode = req.query.mode === 'inline' ? 'inline' : 'download'
    const filename = encodeURIComponent(path.basename(filePath))
    res.setHeader('Content-Disposition', `${mode}; filename*=UTF-8''${filename}`)
    const mime = MIME[path.extname(filePath).toLowerCase()]
    if (mime) res.setHeader('Content-Type', mime)
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(500).json({ ok: false, error: '读取失败' })
    })
  })

  // 上传（raw body + x-filename 头）
  app.post('/api/upload', express.raw({ type: 'application/octet-stream', limit: MAX_UPLOAD }), async (req, res) => {
    const dir = safeResolve(cfg.roots, String(req.query.dir || ''))
    if (!dir) {
      res.status(400).json({ ok: false, error: '目标目录不在授权范围内' })
      return
    }
    const rawName = path.basename(String(req.header('x-filename') || ''))
    if (!rawName || rawName === '.' || rawName === '..') {
      res.status(400).json({ ok: false, error: '文件名不合法' })
      return
    }
    if (UPLOAD_BLOCKED_EXT.test(rawName)) {
      res.status(400).json({ ok: false, error: '不允许上传该类型文件' })
      return
    }
    const buf = req.body as Buffer
    if (!buf || !buf.length) {
      res.status(400).json({ ok: false, error: '空文件' })
      return
    }
    try {
      // 重名自动加 (1) (2)…
      let target = path.join(dir, rawName)
      let i = 1
      while (fs.existsSync(target)) {
        const ext = path.extname(rawName)
        const stem = path.basename(rawName, ext)
        target = path.join(dir, `${stem}(${i})${ext}`)
        i++
      }
      await fsp.writeFile(target, buf)
      res.json({ ok: true, saved: path.basename(target), path: target })
    } catch {
      res.status(500).json({ ok: false, error: '写入失败' })
    }
  })

  // 删除（仅文件，需显式确认）
  app.post('/api/delete', async (req, res) => {
    const { path: p, confirm } = (req.body || {}) as { path?: string; confirm?: boolean }
    const filePath = safeResolve(cfg.roots, String(p || ''))
    if (!filePath) {
      res.status(400).json({ ok: false, error: '路径不在授权范围内' })
      return
    }
    if (confirm !== true) {
      res.status(400).json({ ok: false, error: '需要确认' })
      return
    }
    try {
      const st = await fsp.stat(filePath)
      if (!st.isFile()) {
        res.status(400).json({ ok: false, error: '只能删除单个文件' })
        return
      }
      await fsp.unlink(filePath)
      res.json({ ok: true })
    } catch {
      res.status(500).json({ ok: false, error: '删除失败' })
    }
  })

  // AI 找文件
  app.post('/api/ai', async (req, res) => {
    const message = String((req.body as any)?.message || '').trim()
    if (!message || message.length > 200) {
      res.status(400).json({ ok: false, error: '说点什么吧（200 字以内）' })
      return
    }
    const rootNames = cfg.roots.map((r) => path.basename(r))
    const intent = await parseIntent(message, rootNames)

    if (intent.action === 'chat') {
      res.json({ ok: true, reply: intent.reply || '我只会找文件哦，试试"找合同"这类说法', files: [] })
      return
    }
    if (intent.action === 'list') {
      const dirKeyword = (intent.dir || intent.keywords[0] || '').toLowerCase()
      const target = cfg.roots.find((r) => path.basename(r).toLowerCase() === dirKeyword)
      if (target) {
        res.json({ ok: true, reply: `这是「${path.basename(target)}」的内容：`, dir: target, files: [] })
        return
      }
      res.json({ ok: true, reply: '没找到这个目录，可选：' + rootNames.join('、'), files: [] })
      return
    }

    // search
    const files = await searchFiles(cfg.roots, intent.keywords)
    res.json({
      ok: true,
      reply: files.length
        ? `帮你找到 ${files.length} 个文件${files.length >= 30 ? '（最多显示 30 个）' : ''}：`
        : `「${intent.keywords.join('、')}」没搜到，换个说法试试`,
      files,
    })
  })

  return app
}

// ===================== 对外控制接口 =====================

export interface RemoteStatus {
  enabled: boolean
  running: boolean
  port: number
  code: string
  roots: string[]
  urls: string[]
}

export function getRemoteStatus(): RemoteStatus {
  const cfg = loadConfig()
  const urls = getLanIPs().map((ip) => `http://${ip}:${cfg.port}`)
  return {
    enabled: cfg.enabled,
    running: serverInstance !== null,
    port: cfg.port,
    code: cfg.code,
    roots: cfg.roots,
    urls,
  }
}

/** 应用配置变更并按需启停服务，返回最新状态 */
export function updateRemoteConfig(patch: Partial<Pick<RemoteAccessConfig, 'enabled' | 'port' | 'code' | 'roots'>>): RemoteStatus {
  const cfg = loadConfig()
  if (patch.enabled !== undefined) cfg.enabled = patch.enabled === true
  if (patch.port !== undefined) {
    const p = Number(patch.port)
    if (Number.isInteger(p) && p > 1024 && p < 65536) cfg.port = p
  }
  if (patch.code !== undefined) {
    const c = String(patch.code).trim().toUpperCase()
    if (/^[A-Z0-9]{6}$/.test(c)) cfg.code = c
  }
  if (patch.roots !== undefined) {
    const valid = (Array.isArray(patch.roots) ? patch.roots : [])
      .map((r) => path.resolve(String(r)))
      .filter((r) => fs.existsSync(r) && fs.statSync(r).isDirectory())
    if (valid.length > 0) cfg.roots = valid
  }
  saveConfig(cfg)
  applyRuntime(cfg)
  return getRemoteStatus()
}

/** 重新生成访问码（令牌密钥一并轮换，所有手机端立即下线） */
export function regenerateCode(): RemoteStatus {
  const cfg = loadConfig()
  cfg.code = genCode()
  tokenSecret = crypto.randomBytes(32).toString('hex') // 轮换密钥 → 旧令牌全部失效
  saveConfig(cfg)
  applyRuntime(cfg)
  return getRemoteStatus()
}

/** 按配置启停服务（端口/开关变化时先停再起） */
function applyRuntime(cfg: RemoteAccessConfig): void {
  // 已在跑且开关+端口没变 → 不动
  if (serverInstance && cfg.enabled) {
    const addr = serverInstance.address()
    const curPort = typeof addr === 'object' && addr ? addr.port : null
    if (curPort === cfg.port) return
  }
  stopRemoteFileServer()
  if (cfg.enabled) {
    startRemoteFileServer(cfg)
  }
}

export function startRemoteFileServer(cfg: RemoteAccessConfig = loadConfig()): void {
  if (serverInstance || !cfg.enabled) return
  const app = buildApp(cfg)
  serverInstance = app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`\n📡 远程文件访问已开启: http://0.0.0.0:${cfg.port}（授权目录 ${cfg.roots.length} 个）\n`)
  })
  serverInstance.on('error', (err: Error) => {
    console.error('❌ 远程文件服务启动失败:', err.message)
    serverInstance = null
  })
}

export function stopRemoteFileServer(): void {
  if (!serverInstance) return
  serverInstance.close()
  serverInstance = null
  console.log('📡 远程文件访问已关闭')
}

/** 应用启动时调用：读取配置，enabled 则拉起服务 */
export function initRemoteFileServer(): void {
  const cfg = loadConfig()
  // 首次运行把默认配置落盘（让用户能在设置页看到访问码）
  if (!fs.existsSync(getConfigPath())) saveConfig(cfg)
  if (cfg.enabled) startRemoteFileServer(cfg)
}
