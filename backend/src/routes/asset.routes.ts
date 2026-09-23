import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { assertSpaceAccess } from '../lib/spaceAccess.js'
import { inferType } from '../lib/asset.js'
import { classifyAsset } from '../lib/classifyAsset.js'
import { loadCategoryRules } from '../lib/categoryRule.js'
import { createRequire } from 'node:module'
import type { Archiver } from 'archiver'
import { sha256, saveAssetFile, saveVersionFile, readAssetFile, deleteAssetFile, pipeAssetFile } from '../lib/storage.js'

// archiver 是 CJS 包；@types/archiver@8 为命名导出、与 ESM 默认导入不兼容，故经 createRequire 加载并显式标注返回类型
const require = createRequire(import.meta.url)
const archiverMod = require('archiver') as any
const ZipArchive = archiverMod.ZipArchive as new (options?: Record<string, unknown>) => Archiver

const router = Router()
router.use(authRequired)

// 解析 base64（支持 data URL 与裸 base64）
function decodeBase64(input: string): Buffer {
  const b64 = input.includes(',') ? input.split(',')[1] : input
  const buf = Buffer.from(b64, 'base64')
  if (!buf.length) throw new HttpError('文件内容为空或格式错误', 422)
  return buf
}

// 解析/创建标签并关联资产
async function linkTags(spaceId: string, assetId: string, tagNames: string[]): Promise<void> {
  for (const name of tagNames) {
    const n = name.trim()
    if (!n) continue
    const tag = await prisma.tag.upsert({
      where: { spaceId_name: { spaceId, name: n } },
      create: { spaceId, name: n },
      update: {},
    })
    await prisma.assetTag.upsert({
      where: { assetId_tagId: { assetId, tagId: tag.id } },
      create: { assetId, tagId: tag.id },
      update: {},
    })
  }
}

// P1-5 修复：上传大小上限 10MB + MIME 白名单（防上传 HTML/SVG 等危险类型）
const ASSET_MAX_BYTES = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME = [
  // 图片
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
  // 音频
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/flac', 'audio/x-m4a',
  // 视频
  'video/mp4', 'video/webm', 'video/ogg', 'video/x-matroska',
  // 文档
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  // 文本
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml',
  // 压缩包
  'application/zip', 'application/x-zip-compressed', 'application/gzip',
]
const uploadSchema = z.object({
  spaceId: z.string().min(1),
  folderId: z.string().nullable().optional(),
  name: z.string().min(1).max(255),
  mime: z.string().max(128).optional(),
  // P1-5 修复：base64 大小上限 10MB（防内存型 DoS）
  base64: z.string().min(1).max(ASSET_MAX_BYTES, '文件过大（最大 10MB）'),
  tags: z.array(z.string().max(40)).max(20).optional(),
  description: z.string().max(2000).optional(),
})

// 上传/创建资产（MVP：base64 入参，与现有 voice-memo 一致；后续可换 multipart）
router.post('/upload', async (req, res, next) => {
  try {
    const parsed = uploadSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { spaceId, folderId, name, mime, base64, tags, description } = parsed.data
    await assertSpaceAccess(spaceId, req.user!.userId, true)
    if (folderId) {
      const folder = await prisma.folder.findUnique({ where: { id: folderId } })
      if (!folder || folder.spaceId !== spaceId) throw new HttpError('文件夹不存在或不属于该空间', 422)
    }
    // 扩展名黑名单（防 stored XSS）：独立于 mime 校验，即使省略 mime 也拦截。
    // 修复 gap：原 `if (mime && ...)` 省略 mime 即跳过校验，可上传 evil.html →
    //   服务端按文件名推断 Content-Type: text/html → 浏览器执行其中脚本 → 存储型 XSS。
    const DANGEROUS_EXT = ['.html', '.htm', '.xhtml', '.svg', '.js', '.mjs', '.vbs', '.xht']
    const lowerName = name.toLowerCase()
    if (DANGEROUS_EXT.some((ext) => lowerName.endsWith(ext))) {
      throw new HttpError(`禁止上传可执行/内嵌脚本文件类型: ${name}`, 415)
    }
    // P1-5 修复：MIME 白名单校验（拒绝 HTML/SVG/JS 等危险类型）
    if (mime && !ALLOWED_MIME.includes(mime.toLowerCase())) {
      throw new HttpError(`不支持的文件类型: ${mime}`, 415)
    }

    const buf = decodeBase64(base64)
    const checksum = sha256(buf)
    const rules = await loadCategoryRules(spaceId)

    // 去重：同空间内相同 checksum 直接返回已存在资产
    const dup = await prisma.asset.findFirst({ where: { spaceId, checksum, status: 'ready' } })
    if (dup) {
      return success(res, { ...dup, duplicated: true }, '已存在相同内容资产（去重）', 200)
    }

    // 先建资产记录拿到 id，再按真实 id 目录落盘
    const asset = await prisma.asset.create({
      data: {
        spaceId,
        ownerId: req.user!.userId,
        folderId: folderId ?? null,
        type: inferType(name, mime),
        name,
        mime: mime ?? null,
        size: buf.length,
        storageKey: '',
        checksum,
        status: 'ready',
        category: classifyAsset({ name, mime, size: buf.length }, rules),
        metadata: description ? JSON.stringify({ description }) : null,
      },
    })
    const storageKey = await saveAssetFile(spaceId, asset.id, name, buf)
    await prisma.asset.update({ where: { id: asset.id }, data: { storageKey } })
    // 初始版本快照
    await prisma.assetVersion.create({
      data: { assetId: asset.id, storageKey, size: buf.length, note: '初始版本' },
    })

    if (tags?.length) await linkTags(spaceId, asset.id, tags)
    auditReq(req, res, {
      category: 'dam',
      action: 'asset_upload',
      targetType: 'Asset',
      targetId: asset.id,
      summary: `上传资产: ${name}`,
      detail: { spaceId, type: asset.type, size: buf.length },
    })
    const full = await prisma.asset.findUnique({
      where: { id: asset.id },
      include: { tags: { include: { tag: true } } },
    })
    return success(res, full, '上传成功', 201)
  } catch (e) {
    next(e)
  }
})

// 桌面端自动采集同步：把指定文件夹扫描出的多个文件批量入库（自动分类 + 增量去重）
// - 按 spaceId + localPath 定位已采集资产：内容未变则跳过，内容变化则在位更新（追加版本快照），不存在则新建
// - autoTag=true 时取 localPath 的父文件夹名作为标签，实现离线可用的基础归纳（按来源目录自动归类）
const syncItemSchema = z.object({
  name: z.string().min(1).max(255),
  mime: z.string().max(128).optional(),
  // 安全：与 /upload 一致的 10MB 上限（防内存型 DoS）
  base64: z.string().min(1).max(ASSET_MAX_BYTES, '文件过大（最大 10MB）'),
  localPath: z.string().min(1).max(2000),
  localMtime: z.number().int().min(0).optional(), // 毫秒时间戳
})
const syncSchema = z.object({
  spaceId: z.string().min(1),
  folderId: z.string().nullable().optional(),
  autoTag: z.boolean().optional(),
  items: z.array(syncItemSchema).min(1).max(200),
})
router.post('/sync', async (req, res, next) => {
  try {
    const parsed = syncSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { spaceId, folderId, autoTag, items } = parsed.data
    await assertSpaceAccess(spaceId, req.user!.userId, true)
    const rules = await loadCategoryRules(spaceId)
    if (folderId) {
      const folder = await prisma.folder.findUnique({ where: { id: folderId } })
      if (!folder || folder.spaceId !== spaceId) throw new HttpError('文件夹不存在或不属于该空间', 422)
    }

    let created = 0
    let updated = 0
    let skipped = 0
    for (const item of items) {
      // 扩展名黑名单（防 stored XSS）：与 /upload 一致，即使省略 mime 也拦截
      const DANGEROUS_EXT = ['.html', '.htm', '.xhtml', '.svg', '.js', '.mjs', '.vbs', '.xht']
      const lowerItemName = (item.name || '').toLowerCase()
      if (DANGEROUS_EXT.some((ext) => lowerItemName.endsWith(ext))) {
        throw new HttpError(`禁止上传可执行/内嵌脚本文件类型: ${item.name}`, 415)
      }
      // 安全：与 /upload 一致的 MIME 白名单（防上传 HTML/SVG/JS 等危险类型）
      if (item.mime && !ALLOWED_MIME.includes(item.mime.toLowerCase())) {
        throw new HttpError(`不支持的文件类型: ${item.mime}`, 415)
      }
      const buf = decodeBase64(item.base64)
      const checksum = sha256(buf)
      const mtime = item.localMtime != null ? BigInt(item.localMtime) : null
      const existing = await prisma.asset.findFirst({ where: { spaceId, localPath: item.localPath } })
      if (existing) {
        if (existing.checksum === checksum) {
          // 内容未变：跳过，仅刷新 mtime 以便后续增量判断
          skipped++
          await prisma.asset.update({ where: { id: existing.id }, data: { localMtime: mtime } }).catch(() => {})
          continue
        }
        // 内容变化：更新当前文件并追加版本快照
        const storageKey = await saveAssetFile(spaceId, existing.id, item.name, buf)
        await prisma.assetVersion.create({ data: { assetId: existing.id, storageKey, size: buf.length, note: '同步更新' } })
        await prisma.asset.update({
          where: { id: existing.id },
          data: {
            storageKey, size: buf.length, checksum, localMtime: mtime, mime: item.mime ?? existing.mime,
            name: item.name, status: 'ready',
            type: inferType(item.name, item.mime),
            category: classifyAsset({ name: item.name, mime: item.mime, size: buf.length }, rules),
          },
        })
        updated++
        continue
      }
      // 新建
      const asset = await prisma.asset.create({
        data: {
          spaceId,
          ownerId: req.user!.userId,
          folderId: folderId ?? null,
          type: inferType(item.name, item.mime),
          name: item.name,
          mime: item.mime ?? null,
          size: buf.length,
          storageKey: '',
          checksum,
          status: 'ready',
          category: classifyAsset({ name: item.name, mime: item.mime, size: buf.length }, rules),
          localPath: item.localPath,
          localMtime: mtime,
        },
      })
      const storageKey = await saveAssetFile(spaceId, asset.id, item.name, buf)
      await prisma.asset.update({ where: { id: asset.id }, data: { storageKey } })
      await prisma.assetVersion.create({ data: { assetId: asset.id, storageKey, size: buf.length, note: '初始版本' } })
      // 离线可用的基础归纳：取来源父文件夹名作为标签
      if (autoTag) {
        const parent = item.localPath.split(/[\\/]/).slice(0, -1).pop()
        if (parent && parent.trim()) await linkTags(spaceId, asset.id, [parent.trim()])
      }
      created++
    }

    auditReq(req, res, {
      category: 'dam',
      action: 'asset_sync',
      summary: `批量同步采集: ${created} 新建 / ${updated} 更新 / ${skipped} 跳过`,
      detail: { spaceId, total: items.length },
    })
    return success(res, { created, updated, skipped, total: items.length }, '同步完成')
  } catch (e) {
    next(e)
  }
})

const listQuery = z.object({
  spaceId: z.string().min(1),
  folderId: z.string().optional(),
  type: z.enum(['document', 'image', 'audio', 'video']).optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// 列出资产（多维筛选 + 分页）
router.get('/', async (req, res, next) => {
  try {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { spaceId, folderId, type, category, tag, q, page, pageSize } = parsed.data
    await assertSpaceAccess(spaceId, req.user!.userId)

    const where: Record<string, unknown> = { spaceId }
    if (folderId) where.folderId = folderId
    if (type) where.type = type
    if (category) where.category = category
    if (q) where.OR = [{ name: { contains: q } }, { metadata: { contains: q } }]
    if (tag) where.tags = { some: { tag: { name: tag } } }

    const [list, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        include: { tags: { include: { tag: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.asset.count({ where }),
    ])
    return success(res, { list, total, page, pageSize })
  } catch (e) {
    next(e)
  }
})

// 按分类 / 类型的统计看板（DAM 归纳概览）
router.get('/stats', async (req, res, next) => {
  try {
    const spaceId = String(req.query.spaceId || '')
    if (!spaceId) throw new HttpError('spaceId 必填', 422)
    await assertSpaceAccess(spaceId, req.user!.userId)

    const days = 30
    const since = new Date()
    since.setDate(since.getDate() - (days - 1))
    since.setHours(0, 0, 0, 0)
    const [total, byCategory, byType, recent] = await Promise.all([
      prisma.asset.count({ where: { spaceId } }),
      prisma.asset.groupBy({ by: ['category'], where: { spaceId }, _count: { _all: true } }),
      prisma.asset.groupBy({ by: ['type'], where: { spaceId }, _count: { _all: true } }),
      prisma.asset.findMany({ where: { spaceId, createdAt: { gte: since } }, select: { createdAt: true } }),
    ])
    const catMap: Record<string, number> = {}
    for (const row of byCategory) catMap[row.category] = row._count._all
    const typeMap: Record<string, number> = {}
    for (const row of byType) typeMap[row.type] = row._count._all

    // 时间序列：最近 days 天每日新增资产数（含 0 天，便于前端画趋势折线）
    const buckets: Record<string, number> = {}
    for (const a of recent) {
      const d = a.createdAt
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      buckets[key] = (buckets[key] || 0) + 1
    }
    const trend: { date: string; count: number }[] = []
    for (let i = 0; i < days; i++) {
      const d = new Date(since)
      d.setDate(since.getDate() + i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      trend.push({ date: key, count: buckets[key] || 0 })
    }
    return success(res, { total, byCategory: catMap, byType: typeMap, trend })
  } catch (e) {
    next(e)
  }
})

// 资产详情
router.get('/:id', async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({
      where: { id: req.params.id },
      include: {
        tags: { include: { tag: true } },
        versions: true,
        // 分享链接含 bcrypt 密码哈希，绝不向任意空间成员暴露；返回时排除 password 字段
        shareLinks: { select: { id: true, token: true, permission: true, expireAt: true, createdAt: true } },
        folder: true,
      },
    })
    if (!asset) return fail(res, '资产不存在', 404)
    await assertSpaceAccess(asset.spaceId, req.user!.userId)
    return success(res, asset)
  } catch (e) {
    next(e)
  }
})

// 删除资产（空间 owner 或资产 owner）
router.delete('/:id', async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } })
    if (!asset) return fail(res, '资产不存在', 404)
    const access = await assertSpaceAccess(asset.spaceId, req.user!.userId)
    if (!access.isOwner && asset.ownerId !== req.user!.userId) {
      throw new HttpError('权限不足：仅空间所有者或资产拥有者可删除', 403)
    }
    await deleteAssetFile(asset.storageKey)
    await prisma.asset.delete({ where: { id: asset.id } })
    auditReq(req, res, {
      category: 'dam',
      action: 'asset_delete',
      targetType: 'Asset',
      targetId: asset.id,
      summary: `删除资产: ${asset.name}`,
    })
    return success(res, null, '资产已删除')
  } catch (e) {
    next(e)
  }
})

// 分享链接默认有效期（天）：创建时未显式指定 expireAt 则按此兜底，
// 避免直连 API / 第三方集成绕过前端默认、生成永久有效的公开外链。
const SHARE_DEFAULT_TTL_DAYS = 7

const shareSchema = z.object({
  expireAt: z.string().datetime().optional(),
  password: z.string().min(4).max(64).optional(),
  permission: z.enum(['view', 'download']).default('view'),
})

// 创建外链分享（有效期/密码）
router.post('/:id/share', async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } })
    if (!asset) return fail(res, '资产不存在', 404)
    await assertSpaceAccess(asset.spaceId, req.user!.userId, true)
    const parsed = shareSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { expireAt, password, permission } = parsed.data

    const token = crypto.randomBytes(16).toString('hex')
    const link = await prisma.shareLink.create({
      data: {
        assetId: asset.id,
        token,
        // 未显式指定过期时间时兜底为默认有效期，避免生成永久有效的公开外链
        expireAt: expireAt ? new Date(expireAt) : new Date(Date.now() + SHARE_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000),
        password: password ? await bcrypt.hash(password, 10) : null,
        permission,
      },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'asset_share',
      targetType: 'Asset',
      targetId: asset.id,
      summary: `创建分享链接: ${asset.name}`,
    })
    return success(res, { token: link.token, expireAt: link.expireAt, permission }, '分享链接已创建', 201)
  } catch (e) {
    next(e)
  }
})

// 下载资产原文件（空间访问权限校验 + 路径穿越防护由 storage.readAssetFile 保证）
router.get('/:id/file', async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } })
    if (!asset) return fail(res, '资产不存在', 404)
    await assertSpaceAccess(asset.spaceId, req.user!.userId)
    if (!asset.storageKey) return fail(res, '该资产无关联文件', 404)
    await pipeAssetFile(res, asset.storageKey, {
      contentType: 'application/octet-stream',
      disposition: 'attachment',
      name: asset.name,
    })
  } catch (e) {
    next(e)
  }
})

// 批量下载（选择性下载一部分）：将一个空间内有权限的多个资产打包为 zip 流式返回
const batchDownloadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
})
router.post('/batch-download', async (req, res, next) => {
  try {
    const parsed = batchDownloadSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const userId = req.user!.userId
    const assets = await prisma.asset.findMany({
      where: { id: { in: parsed.data.ids }, status: 'ready' },
    })
    // 逐项校验空间访问权限：任一越权即 403（防御批量越权遍历）
    for (const a of assets) {
      await assertSpaceAccess(a.spaceId, userId)
    }
    if (!assets.length) return fail(res, '没有可下载的资产', 404)
    // 按 storageKey 去重，避免同一文件重复打包
    const byKey = new Map<string, (typeof assets)[number]>()
    for (const a of assets) {
      if (a.storageKey && !byKey.has(a.storageKey)) byKey.set(a.storageKey, a)
    }
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Disposition', `attachment; filename="assets-${byKey.size}-${Date.now()}.zip"`)
    const archive = new ZipArchive({ zlib: { level: 6 } })
    archive.on('warning', (e: any) => { if (e?.code !== 'ENOENT') console.warn('[batch-download]', e) })
    archive.on('error', (err: any) => {
      console.error('[batch-download] archive error', err)
      if (!res.headersSent) res.status(500).end()
      else res.end()
    })
    archive.pipe(res)
    for (const a of byKey.values()) {
      try {
        const buf = await readAssetFile(a.storageKey)
        const safeName = a.name.replace(/[\\/:*?"<>|]/g, '_')
        archive.append(buf, { name: `${a.id}_${safeName}` })
      } catch {
        // 单文件读取失败跳过，不影响整体打包
      }
    }
    await archive.finalize()
    auditReq(req, res, {
      category: 'dam',
      action: 'asset_batch_download',
      summary: '批量下载资产',
      detail: `count=${byKey.size}`,
    })
  } catch (e) {
    next(e)
  }
})

// 资产版本列表（历史）
router.get('/:id/versions', async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } })
    if (!asset) return fail(res, '资产不存在', 404)
    await assertSpaceAccess(asset.spaceId, req.user!.userId)
    const versions = await prisma.assetVersion.findMany({
      where: { assetId: asset.id },
      orderBy: { createdAt: 'desc' },
    })
    return success(res, versions)
  } catch (e) {
    next(e)
  }
})

const versionSchema = z.object({
  base64: z.string().min(1),
  note: z.string().max(200).optional(),
})

// 上传新版本（更新当前文件，并追加版本快照）
router.post('/:id/versions', async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } })
    if (!asset) return fail(res, '资产不存在', 404)
    await assertSpaceAccess(asset.spaceId, req.user!.userId, true)
    const parsed = versionSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const buf = decodeBase64(parsed.data.base64)
    const version = await prisma.assetVersion.create({
      data: { assetId: asset.id, storageKey: '', size: buf.length, note: parsed.data.note || null },
    })
    const storageKey = await saveVersionFile(asset.spaceId, asset.id, version.id, asset.name, buf)
    await prisma.assetVersion.update({ where: { id: version.id }, data: { storageKey } })
    const checksum = sha256(buf)
    await prisma.asset.update({
      where: { id: asset.id },
      data: { storageKey, size: buf.length, checksum, status: 'ready' },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'asset_new_version',
      targetType: 'Asset',
      targetId: asset.id,
      summary: `新增版本: ${asset.name}`,
      detail: { versionId: version.id },
    })
    return success(res, version, '新版本已保存', 201)
  } catch (e) {
    next(e)
  }
})

// 恢复到指定版本
router.post('/:id/versions/:vid/restore', async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } })
    if (!asset) return fail(res, '资产不存在', 404)
    await assertSpaceAccess(asset.spaceId, req.user!.userId, true)
    const version = await prisma.assetVersion.findUnique({ where: { id: req.params.vid } })
    if (!version || version.assetId !== asset.id) return fail(res, '版本不存在', 404)
    const buf = await readAssetFile(version.storageKey)
    const checksum = sha256(buf)
    await prisma.asset.update({
      where: { id: asset.id },
      data: { storageKey: version.storageKey, size: version.size, checksum, status: 'ready' },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'asset_restore',
      targetType: 'Asset',
      targetId: asset.id,
      summary: `恢复版本: ${asset.name}`,
      detail: { versionId: version.id },
    })
    return success(res, { storageKey: version.storageKey, size: version.size }, '已恢复到该版本')
  } catch (e) {
    next(e)
  }
})

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
})

// 编辑资产元数据（标题/描述）
router.patch('/:id', async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } })
    if (!asset) return fail(res, '资产不存在', 404)
    // 与 DELETE 对齐：仅空间所有者或资产拥有者可编辑元数据/重命名（普通成员/操作员无此权限）
    const access = await assertSpaceAccess(asset.spaceId, req.user!.userId, true)
    if (!access.isOwner && asset.ownerId !== req.user!.userId) {
      throw new HttpError('权限不足：仅空间所有者或资产拥有者可编辑资产', 403)
    }
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const data: Record<string, unknown> = {}
    if (parsed.data.name) data.name = parsed.data.name
    if (parsed.data.description !== undefined) {
      const meta = asset.metadata ? JSON.parse(asset.metadata) : {}
      meta.description = parsed.data.description
      data.metadata = JSON.stringify(meta)
    }
    const updated = await prisma.asset.update({
      where: { id: asset.id },
      data,
      include: { tags: { include: { tag: true } } },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'asset_edit',
      targetType: 'Asset',
      targetId: asset.id,
      summary: `编辑资产: ${asset.name}`,
    })
    return success(res, updated)
  } catch (e) {
    next(e)
  }
})

export default router
