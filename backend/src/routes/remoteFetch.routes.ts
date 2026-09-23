import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { assertSpaceAccess } from '../lib/spaceAccess.js'
import { sha256, saveAssetFile } from '../lib/storage.js'
import { inferType } from '../lib/asset.js'

const router = Router()

// 实例令牌有效期（天）；绑定/心跳续期时刷新过期时间
const INSTANCE_TOKEN_TTL_DAYS = 30
const tokenExpireFromNow = (): Date => new Date(Date.now() + INSTANCE_TOKEN_TTL_DAYS * 24 * 3600 * 1000)

// 实例侧鉴权上下文
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      instance?: { id: string; ownerId: string }
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET
const STEP_UP_TTL = '5m'

// ===================== 中间件 =====================

// P2-10 修复：实例令牌鉴权路由按 IP 限流（60 次/分钟），防止 token 泄露后高频调用
const instanceRateLimit = rateLimit({ limit: 60, windowMs: 60_000 })

// 实例令牌鉴权（实例拉取/确认/执行任务）
// 校验：令牌有效、未被吊销、实例已绑定且在线、未过期；并异步记录最近使用时间
function instanceAuth(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  const token = req.header('x-instance-token')
  if (!token) return fail(res, '缺少实例令牌', 401)
  prisma.execInstance
    .findFirst({ where: { token } })
    .then((inst) => {
      if (!inst) return fail(res, '实例令牌无效', 401)
      if (inst.revoked) return fail(res, '实例令牌已吊销', 401)
      if (!inst.bound || inst.status !== 'online') return fail(res, '实例未在线或未绑定', 403)
      if (inst.tokenExpireAt && inst.tokenExpireAt.getTime() < Date.now()) {
        return fail(res, '实例令牌已过期，请重新绑定', 401)
      }
      req.instance = { id: inst.id, ownerId: inst.ownerId }
      // 异步记录最近使用时间（不阻塞请求）
      prisma.execInstance.update({ where: { id: inst.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
      next()
    })
    .catch(next)
}

// 二次验证（step-up）：需携带 x-stepup-token（由 POST /step-up 签发，5 分钟有效）
function requireStepUp(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  if (!JWT_SECRET) return fail(res, '服务端未配置 JWT_SECRET', 500)
  const token = req.header('x-stepup-token')
  if (!token) return fail(res, '需要二次验证令牌', 401)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { stepUp?: boolean; userId?: string }
    if (!payload.stepUp || !payload.userId) return fail(res, '二次验证令牌无效', 401)
    // 二次验证令牌的 userId 必须与登录用户一致
    if (req.user && req.user.userId !== payload.userId) return fail(res, '二次验证用户不匹配', 403)
    next()
  } catch {
    return fail(res, '二次验证令牌已过期或无效', 401)
  }
}

// ===================== 二次验证签发 =====================

const stepUpSchema = z.object({ password: z.string().min(1) })

// 重新校验密码 → 签发短期 step-up 令牌（二次验证）
// P1-3 修复：按 userId 限流 5 次/分钟，防止暴力破解登录密码
const stepUpRateLimit = rateLimit({
  limit: 5,
  windowMs: 60_000,
  keyFn: (req) => `stepup:${req.user?.userId || req.ip}`,
})
router.post('/step-up', authRequired, stepUpRateLimit, async (req, res, next) => {
  try {
    if (!JWT_SECRET) throw new HttpError('服务端未配置 JWT_SECRET', 500)
    const parsed = stepUpSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('密码必填', 422)
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { password: true },
    })
    if (!user) throw new HttpError('用户不存在', 404)
    const ok = await import('bcryptjs').then((b) => b.default.compare(parsed.data.password, user.password))
    if (!ok) throw new HttpError('密码错误', 401)
    const token = jwt.sign({ stepUp: true, userId: req.user!.userId }, JWT_SECRET, {
      expiresIn: STEP_UP_TTL,
    } as jwt.SignOptions)
    return success(res, { stepUpToken: token, ttl: STEP_UP_TTL }, '二次验证通过')
  } catch (e) {
    next(e)
  }
})

// ===================== 执行实例（替代桌面版 device） =====================

const bindSchema = z.object({
  name: z.string().min(1).max(60),
  fingerprint: z.string().min(1).max(255),
})

// 绑定执行实例（指纹校验 + 绑定确认）
router.post('/instances/bind', authRequired, async (req, res, next) => {
  try {
    const parsed = bindSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { name, fingerprint } = parsed.data
    const userId = req.user!.userId

    const existing = await prisma.execInstance.findFirst({ where: { ownerId: userId, fingerprint } })
    const token = crypto.randomBytes(24).toString('hex')
    let instance
    if (existing) {
      instance = await prisma.execInstance.update({
        where: { id: existing.id },
        data: { name, bound: true, boundAt: new Date(), token, tokenExpireAt: tokenExpireFromNow(), revoked: false, status: 'online', lastHeartbeat: new Date(), lastUsedAt: null },
      })
    } else {
      instance = await prisma.execInstance.create({
        data: {
          ownerId: userId,
          name,
          fingerprint,
          bound: true,
          boundAt: new Date(),
          token,
          tokenExpireAt: tokenExpireFromNow(),
          status: 'online',
          lastHeartbeat: new Date(),
        },
      })
    }
    auditReq(req, res, {
      category: 'dam',
      action: 'instance_bind',
      targetType: 'ExecInstance',
      targetId: instance.id,
      summary: `绑定执行实例: ${name}`,
      detail: { fingerprint },
    })
    // token 仅返回一次
    return success(res, { id: instance.id, name: instance.name, token: instance.token, bound: true }, '实例已绑定', 201)
  } catch (e) {
    next(e)
  }
})

// 列出我的实例
router.get('/instances', authRequired, async (req, res, next) => {
  try {
    const list = await prisma.execInstance.findMany({
      where: { ownerId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, fingerprint: true, bound: true, status: true, lastHeartbeat: true, createdAt: true },
    })
    return success(res, list)
  } catch (e) {
    next(e)
  }
})

// 实例心跳（实例令牌）
router.post('/instances/:id/unbind', authRequired, async (req, res, next) => {
  try {
    const inst = await prisma.execInstance.findUnique({ where: { id: req.params.id } })
    if (!inst) return fail(res, '实例不存在', 404)
    if (inst.ownerId !== req.user!.userId) throw new HttpError('仅实例所有者可解绑', 403)
    // 吊销令牌：清空 token + 标记 revoked，instanceAuth 立即拒绝后续请求
    await prisma.execInstance.update({
      where: { id: inst.id },
      data: { revoked: true, token: null, bound: false, status: 'offline' },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'instance_unbind',
      targetType: 'ExecInstance',
      targetId: inst.id,
      summary: `解绑并吊销实例令牌: ${inst.name}`,
    })
    return success(res, null, '实例已解绑，令牌已吊销')
  } catch (e) {
    next(e)
  }
})

router.post('/instances/:id/heartbeat', instanceRateLimit, instanceAuth, async (req, res, next) => {
  try {
    if (req.instance!.id !== req.params.id) return fail(res, '实例不匹配', 403)
    await prisma.execInstance.update({
      where: { id: req.params.id },
      // 心跳续期令牌过期时间并记录最近使用
      data: { status: 'online', lastHeartbeat: new Date(), lastUsedAt: new Date(), tokenExpireAt: tokenExpireFromNow() },
    })
    return success(res, { status: 'online' })
  } catch (e) {
    next(e)
  }
})

// ===================== 资源区（替代桌面版 folder_watch） =====================

const zoneSchema = z.object({
  instanceId: z.string().min(1),
  spaceId: z.string().min(1),
  sourcePath: z.string().min(1).max(2000),
  zoneName: z.string().max(60).optional(),
  fetchScope: z.enum(['specified_zone', 'full_instance']).default('specified_zone'),
  rulesJson: z.string().max(4000).optional(),
  remoteFetchable: z.boolean().default(false),
  watchMode: z.enum(['always', 'on_demand']).default('on_demand'),
})

// P2-6 修复：sourcePath 安全校验，禁止系统敏感目录
const FORBIDDEN_PATH_PATTERNS = [
  /^\/etc\b/i, /^\/var\/log\b/i, /^\/root\b/i, /^\/proc\b/i, /^\/sys\b/i,
  /^C:\\Windows\b/i, /^C:\\Program Files\b/i, /^C:\\System Volume Information\b/i,
  /^C:\\Users\\[^\\]+\\AppData\\(Roaming|Local)\\Microsoft\b/i,
]
function isSafeSourcePath(p: string): boolean {
  if (!p || p.length > 2000) return false
  return !FORBIDDEN_PATH_PATTERNS.some((re) => re.test(p))
}

// 登记资源区
router.post('/resource-zones', authRequired, async (req, res, next) => {
  try {
    const parsed = zoneSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { instanceId, spaceId, sourcePath, zoneName, fetchScope, rulesJson, remoteFetchable, watchMode } = parsed.data

    // P2-6 修复：校验 sourcePath 非系统敏感目录
    if (!isSafeSourcePath(sourcePath)) {
      throw new HttpError('源路径不合法：禁止扫描系统敏感目录', 422)
    }

    // 实例必须属于当前用户
    const inst = await prisma.execInstance.findUnique({ where: { id: instanceId } })
    if (!inst || inst.ownerId !== req.user!.userId) throw new HttpError('实例不存在或无权限', 404)
    // 空间写入权限
    await assertSpaceAccess(spaceId, req.user!.userId, true)

    const zone = await prisma.resourceZone.create({
      data: {
        instanceId,
        spaceId,
        sourcePath,
        zoneName: zoneName ?? null,
        fetchScope,
        rulesJson: rulesJson ?? null,
        remoteFetchable,
        watchMode,
        enabled: true,
      },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'zone_register',
      targetType: 'ResourceZone',
      targetId: zone.id,
      summary: `登记资源区: ${zoneName || sourcePath}（${fetchScope}）`,
      detail: { fetchScope, remoteFetchable, instanceId },
    })
    return success(res, zone, '资源区已登记', 201)
  } catch (e) {
    next(e)
  }
})

// 列出名下资源区（含权限等级标识）
router.get('/resource-zones', authRequired, async (req, res, next) => {
  try {
    const list = await prisma.resourceZone.findMany({
      where: { instance: { ownerId: req.user!.userId } },
      orderBy: { id: 'desc' },
      include: { instance: { select: { id: true, name: true, status: true } } },
    })
    return success(res, list)
  } catch (e) {
    next(e)
  }
})

// ===================== 触发远程提取（分级 + 认证） =====================

// 触发提取某资源区（须二次验证 + 校验 remote_fetchable + fetch_scope 边界）
router.post('/resource-zones/:id/fetch', authRequired, requireStepUp, async (req, res, next) => {
  try {
    const zone = await prisma.resourceZone.findUnique({ where: { id: req.params.id } })
    if (!zone) throw new HttpError('资源区不存在', 404)
    // 实例归属校验
    const inst = await prisma.execInstance.findUnique({ where: { id: zone.instanceId } })
    if (!inst || inst.ownerId !== req.user!.userId) throw new HttpError('无权限操作该资源区', 403)
    if (!zone.remoteFetchable || !zone.enabled) {
      throw new HttpError('该资源区未开放远程提取', 400)
    }

    // 分级授权：
    // - specified_zone：需在实例侧确认（requireConfirm），触发者对该空间有写入权限即可。
    // - full_instance：涉及整实例文件系统，风险更高——除实例侧确认外，强制要求触发者为空间所有者(owner)。
    const requireConfirm = true
    if (zone.fetchScope === 'full_instance') {
      const access = await assertSpaceAccess(zone.spaceId, req.user!.userId, true)
      if (!access.isOwner) throw new HttpError('全实例提取为高危操作，仅空间所有者可发起', 403)
    } else {
      await assertSpaceAccess(zone.spaceId, req.user!.userId, true)
    }
    const job = await prisma.fetchJob.create({
      data: {
        instanceId: zone.instanceId,
        resourceZoneId: zone.id,
        spaceId: zone.spaceId,
        requesterId: req.user!.userId,
        status: 'pending',
        requireConfirm,
        stepUpVerified: true,
      },
    })
    auditReq(req, res, {
      category: 'dam',
      action: 'fetch_trigger',
      targetType: 'FetchJob',
      targetId: job.id,
      summary: `触发远程提取: ${zone.zoneName || zone.sourcePath}（${zone.fetchScope}）`,
      detail: { fetchScope: zone.fetchScope, requireConfirm, instanceId: zone.instanceId },
    })
    return success(res, job, '提取任务已创建，等待实例执行', 201)
  } catch (e) {
    next(e)
  }
})

// ===================== 实例侧：拉取 / 确认 / 执行 =====================

// 实例拉取待处理任务（实例令牌）
router.get('/fetch-jobs/pending', instanceRateLimit, instanceAuth, async (req, res, next) => {
  try {
    const instanceId = req.query.instanceId as string
    if (instanceId && instanceId !== req.instance!.id) return fail(res, '实例不匹配', 403)
    const jobs = await prisma.fetchJob.findMany({
      where: { instanceId: req.instance!.id, status: { in: ['pending', 'dispatched'] } },
      orderBy: { requestedAt: 'asc' },
      include: { resourceZone: { select: { sourcePath: true, fetchScope: true, rulesJson: true, zoneName: true } } },
    })
    return success(res, jobs)
  } catch (e) {
    next(e)
  }
})

const confirmSchema = z.object({ decision: z.enum(['confirm', 'reject']) })

// 实例侧二次确认（高危等级强制；仅 pending 可确认/拒绝）
router.post('/fetch-jobs/:id/confirm', instanceRateLimit, instanceAuth, async (req, res, next) => {
  try {
    const parsed = confirmSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('参数错误', 422)
    const job = await prisma.fetchJob.findUnique({ where: { id: req.params.id } })
    if (!job || job.instanceId !== req.instance!.id) throw new HttpError('任务不存在或无权限', 404)
    if (job.status !== 'pending') throw new HttpError('任务已不在待确认状态', 409)

    if (parsed.data.decision === 'reject') {
      const updated = await prisma.fetchJob.update({
        where: { id: job.id },
        data: { status: 'rejected', finishedAt: new Date(), errorMsg: '实例拒绝执行' },
      })
      await auditReqAsync(req, res, {
        category: 'dam',
        action: 'fetch_reject',
        targetType: 'FetchJob',
        targetId: job.id,
        summary: `实例拒绝提取任务 ${job.id}`,
      })
      return success(res, updated, '已拒绝')
    }
    const updated = await prisma.fetchJob.update({
      where: { id: job.id },
      data: { status: 'dispatched', dispatchedAt: new Date() },
    })
    return success(res, updated, '已确认，可开始执行')
  } catch (e) {
    next(e)
  }
})

// 实例侧执行提取：双模式
//   1. worker 跨机模式：worker 已调 /assets/sync 批量上传，body 带 resultCount → 直接关 job
//   2. 同机模式：不传 body → 服务端 runFetch 扫描本地 sourcePath 入库
router.post('/fetch-jobs/:id/execute', instanceRateLimit, instanceAuth, async (req, res, next) => {
  try {
    const job = await prisma.fetchJob.findUnique({ where: { id: req.params.id } })
    if (!job || job.instanceId !== req.instance!.id) throw new HttpError('任务不存在或无权限', 404)
    if (job.status === 'done' || job.status === 'failed') throw new HttpError('任务已结束', 409)
    if (job.requireConfirm && job.status !== 'dispatched') {
      throw new HttpError('需先确认任务（requireConfirm）', 409)
    }

    const zone = await prisma.resourceZone.findUnique({ where: { id: job.resourceZoneId } })
    if (!zone) throw new HttpError('资源区不存在', 404)

    // 跨机模式：worker 已独立调 /assets/sync 完成上传
    const workerResultCount = req.body?.resultCount
    let resultCount: number
    if (typeof workerResultCount === 'number' && workerResultCount >= 0) {
      resultCount = workerResultCount
    } else {
      resultCount = await runFetch(zone, job)
    }

    const updated = await prisma.fetchJob.update({
      where: { id: job.id },
      data: { status: 'done', finishedAt: new Date(), resultCount },
    })
    await auditReqAsync(req, res, {
      category: 'dam',
      action: 'fetch_done',
      targetType: 'FetchJob',
      targetId: job.id,
      summary: `远程提取完成: ${resultCount} 个文件`,
      detail: { resultCount, fetchScope: zone.fetchScope, mode: typeof workerResultCount === 'number' ? 'worker-synced' : 'server-scan' },
    })
    return success(res, { resultCount, status: 'done' }, '提取完成')
  } catch (e) {
    next(e)
  }
})

// 列出用户发起/拥有的所有 FetchJob（历史 + 进行中）
router.get('/fetch-jobs', authRequired, async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const jobs = await prisma.fetchJob.findMany({
      where: {
        OR: [
          { requesterId: userId },
          { instance: { ownerId: userId } },
        ],
      },
      orderBy: { requestedAt: 'desc' },
      take: 50,
      include: {
        resourceZone: { select: { sourcePath: true, zoneName: true } },
        instance: { select: { name: true, fingerprint: true } },
      },
    })
    return success(res, jobs)
  } catch (e) {
    next(e)
  }
})

// 查询任务进度/结果
router.get('/fetch-jobs/:id', authRequired, async (req, res, next) => {
  try {
    const job = await prisma.fetchJob.findUnique({ where: { id: req.params.id } })
    if (!job) return fail(res, '任务不存在', 404)
    const inst = await prisma.execInstance.findUnique({ where: { id: job.instanceId } })
    if (job.requesterId !== req.user!.userId && inst?.ownerId !== req.user!.userId) {
      throw new HttpError('无权限查看该任务', 403)
    }
    return success(res, job)
  } catch (e) {
    next(e)
  }
})

// ===================== 服务端扫描 + 入库实现 =====================

interface FetchRules {
  includeExt?: string[]
  excludeExt?: string[]
  includeRegex?: string
  excludeRegex?: string
  minSize?: number
  maxSize?: number
}

function parseRules(json?: string | null): FetchRules {
  if (!json) return {}
  try {
    const r = JSON.parse(json)
    return typeof r === 'object' && r ? r : {}
  } catch {
    return {}
  }
}

const DEFAULT_IGNORE = [/^~\$/, /\.tmp$/i, /^\.DS_Store$/i, /Thumbs\.db$/i]

function acceptFile(name: string, size: number, rules: FetchRules): boolean {
  if (DEFAULT_IGNORE.some((re) => re.test(name))) return false
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (rules.includeExt?.length && !rules.includeExt.map((e) => e.toLowerCase()).includes(ext)) return false
  if (rules.excludeExt?.length && rules.excludeExt.map((e) => e.toLowerCase()).includes(ext)) return false
  if (rules.minSize != null && size < rules.minSize) return false
  if (rules.maxSize != null && size > rules.maxSize) return false
  if (rules.includeRegex) {
    try {
      if (!new RegExp(rules.includeRegex).test(name)) return false
    } catch {
      /* 非法正则忽略该条件 */
    }
  }
  if (rules.excludeRegex) {
    try {
      if (new RegExp(rules.excludeRegex).test(name)) return false
    } catch {
      /* 忽略 */
    }
  }
  return true
}

const MAX_FILES = 500
const MAX_DEPTH = 8

async function runFetch(
  zone: { id: string; spaceId: string; instanceId: string; zoneName: string | null; sourcePath: string; rulesJson: string | null },
  job: { id: string; requesterId: string },
): Promise<number> {
  const root = zone.sourcePath
  const st = await fs.stat(root).catch(() => null)
  if (!st || !st.isDirectory()) {
    await prisma.fetchJob.update({ where: { id: job.id }, data: { status: 'failed', errorMsg: '资源区路径不存在或不是目录' } })
    throw new HttpError('资源区路径不存在或不是目录: ' + root, 400)
  }
  const rules = parseRules(zone.rulesJson)
  let count = 0

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (count >= MAX_FILES || depth > MAX_DEPTH) return
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (count >= MAX_FILES) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!e.isFile()) continue
      try {
        const fstat = await fs.stat(full)
        if (!acceptFile(e.name, fstat.size, rules)) continue
        const buf = await fs.readFile(full)
        const checksum = sha256(buf)
        // 去重：同空间相同 checksum（仅已就绪资产）直接关联，不重复建资产
        const existing = await prisma.asset.findFirst({ where: { spaceId: zone.spaceId, checksum, status: 'ready' } })
        if (existing) {
          await prisma.assetSource.create({
            data: {
              assetId: existing.id,
              instanceId: zone.instanceId,
              resourceZoneId: zone.id,
              localPath: full,
              syncState: 'synced',
              localChecksum: checksum,
              localMtime: BigInt(Math.floor(fstat.mtimeMs)),
            },
          })
          count++
          continue
        }
        const asset = await prisma.asset.create({
          data: {
            spaceId: zone.spaceId,
            ownerId: job.requesterId,
            type: inferType(e.name),
            name: e.name,
            size: buf.length,
            storageKey: '',
            checksum,
            status: 'ready',
            metadata: JSON.stringify({ source: 'remote-fetch', zone: zone.zoneName, instanceId: zone.instanceId }),
          },
        })
        const storageKey = await saveAssetFile(zone.spaceId, asset.id, e.name, buf)
        await prisma.asset.update({ where: { id: asset.id }, data: { storageKey } })
        await prisma.assetSource.create({
          data: {
            assetId: asset.id,
            instanceId: zone.instanceId,
            resourceZoneId: zone.id,
            localPath: full,
            syncState: 'synced',
            localChecksum: checksum,
            localMtime: BigInt(Math.floor(fstat.mtimeMs)),
          },
        })
        count++
      } catch {
        // 单文件失败不影响整体
      }
    }
  }

  await walk(root, 0)
  return count
}

export default router
