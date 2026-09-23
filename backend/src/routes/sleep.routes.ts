import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'

const router = Router()
router.use(authRequired)

const sleepSchema = z.object({
  // 入睡时间（ISO 字符串）
  bedtime: z.string(),
  // 起床时间（ISO 字符串）
  wakeTime: z.string(),
  // 质量评分 1-5，可选
  quality: z.number().int().min(1).max(5).optional(),
  note: z.string().optional(),
})

/**
 * 计算睡眠时长（分钟）
 * - 处理跨天场景：入睡 23:00 → 起床 07:00，wakeTime < bedtime 时加一天
 */
function calcDurationMin(bedtime: Date, wakeTime: Date): number {
  let wake = wakeTime
  if (wake < bedtime) {
    // 跨天：起床时间早于入睡时间，加 24 小时
    wake = new Date(wake.getTime() + 24 * 60 * 60 * 1000)
  }
  return Math.max(0, Math.round((wake.getTime() - bedtime.getTime()) / 60000))
}

/**
 * 根据时长自动推断质量评分（1-5）
 * - <300min（5h）：2（不足）
 * - 300-360min（5-6h）：3（偏少）
 * - 360-480min（6-8h）：5（理想）
 * - 480-540min（8-9h）：4（充足）
 * - >540min（9h+）：3（偏多）
 */
function autoQuality(durationMin: number): number {
  if (durationMin < 300) return 2
  if (durationMin < 360) return 3
  if (durationMin < 480) return 5
  if (durationMin < 540) return 4
  return 3
}

/** 睡眠列表（按日期过滤，默认查最近 30 天） */
router.get('/', async (req, res, next) => {
  try {
    const date = req.query.date as string | undefined
    const from = req.query.from as string | undefined
    const to = req.query.to as string | undefined

    let where: {
      userId: string
      sleepDate?: { gte?: Date; lt?: Date }
    } = { userId: req.user!.userId }

    if (date) {
      // 单日查询：date 当天 00:00 ~ 次日 00:00
      const d = new Date(date)
      d.setHours(0, 0, 0, 0)
      const next = new Date(d)
      next.setDate(d.getDate() + 1)
      where.sleepDate = { gte: d, lt: next }
    } else if (from || to) {
      // 区间查询
      where.sleepDate = {}
      if (from) where.sleepDate.gte = new Date(from)
      if (to) {
        const t = new Date(to)
        t.setDate(t.getDate() + 1)
        where.sleepDate.lt = t
      }
    }

    const sleeps = await prisma.sleep.findMany({
      where,
      orderBy: { sleepDate: 'desc' },
      take: 100,
    })
    return success(res, sleeps)
  } catch (e) {
    next(e)
  }
})

/**
 * 记录睡眠
 * - 后端自动计算 durationMin
 * - 未传 quality 时根据时长自动推断
 * - 写入台账：sleep.create
 */
router.post('/', async (req, res, next) => {
  try {
    const parsed = sleepSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const data = parsed.data

    const bedtime = new Date(data.bedtime)
    const wakeTime = new Date(data.wakeTime)
    if (isNaN(bedtime.getTime()) || isNaN(wakeTime.getTime())) {
      throw new HttpError('时间格式无效', 422)
    }

    const durationMin = calcDurationMin(bedtime, wakeTime)
    if (durationMin === 0) {
      throw new HttpError('入睡时间和起床时间相同', 422)
    }

    // sleepDate 取入睡所在的自然日
    const sleepDate = new Date(bedtime)
    sleepDate.setHours(0, 0, 0, 0)

    // 同一天只允许一条记录（幂等覆盖）
    const existing = await prisma.sleep.findFirst({
      where: { userId: req.user!.userId, sleepDate },
    })

    const quality = data.quality ?? autoQuality(durationMin)

    let sleep
    if (existing) {
      sleep = await prisma.sleep.update({
        where: { id: existing.id },
        data: { bedtime, wakeTime, durationMin, quality, note: data.note },
      })
      auditReq(req, res, {
        category: 'sleep',
        action: 'update',
        targetType: 'Sleep',
        targetId: sleep.id,
        summary: `更新睡眠记录: ${sleepDate.toISOString().slice(0, 10)} (${durationMin}min, Q${quality})`,
        detail: { sleepDate: sleepDate.toISOString(), durationMin, quality },
      })
      return success(res, sleep, '已更新')
    }

    sleep = await prisma.sleep.create({
      data: {
        userId: req.user!.userId,
        sleepDate,
        bedtime,
        wakeTime,
        durationMin,
        quality,
        note: data.note,
      },
    })
    auditReq(req, res, {
      category: 'sleep',
      action: 'create',
      targetType: 'Sleep',
      targetId: sleep.id,
      summary: `记录睡眠: ${sleepDate.toISOString().slice(0, 10)} (${durationMin}min, Q${quality})`,
      detail: { sleepDate: sleepDate.toISOString(), durationMin, quality },
    })
    return success(res, sleep, '已记录', 201)
  } catch (e) {
    next(e)
  }
})

/**
 * 删除睡眠记录
 * - 写入台账：sleep.delete（await 确保落库）
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.sleep.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('记录不存在', 404)
    }
    await prisma.sleep.delete({ where: { id } })
    await auditReqAsync(req, res, {
      category: 'sleep',
      action: 'delete',
      targetType: 'Sleep',
      targetId: id,
      summary: `删除睡眠记录: ${existing.sleepDate.toISOString().slice(0, 10)}`,
    })
    return success(res, null, '已删除')
  } catch (e) {
    next(e)
  }
})

/** 睡眠周报：最近 7 天平均睡眠时长与质量 */
router.get('/weekly', async (req, res, next) => {
  try {
    const now = new Date()
    const start = new Date(now)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)

    const sleeps = await prisma.sleep.findMany({
      where: {
        userId: req.user!.userId,
        sleepDate: { gte: start },
      },
      orderBy: { sleepDate: 'asc' },
    })

    const avgDuration = sleeps.length
      ? Math.round(sleeps.reduce((s, x) => s + x.durationMin, 0) / sleeps.length)
      : 0
    const avgQuality = sleeps.length
      ? Number((sleeps.reduce((s, x) => s + (x.quality || 3), 0) / sleeps.length).toFixed(1))
      : 0

    return success(res, {
      range: { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
      count: sleeps.length,
      avgDurationMin: avgDuration,
      avgQuality,
      // 睡眠债务：若平均 < 360min（6h），累计缺觉分钟数
      sleepDebtMin: sleeps.length
        ? sleeps.reduce((s, x) => s + Math.max(0, 360 - x.durationMin), 0)
        : 0,
      records: sleeps,
    })
  } catch (e) {
    next(e)
  }
})

export default router
