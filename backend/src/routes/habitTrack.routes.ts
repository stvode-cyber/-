/**
 * 习惯打卡追踪路由
 *
 * GET    /habits/track              获取习惯列表（含今日打卡状态、连续天数）
 * POST   /habits/track              创建习惯
 * PATCH  /habits/track/:id          更新习惯
 * DELETE /habits/track/:id          删除习惯（归档）
 * POST   /habits/track/:id/checkin  打卡（今日）
 * DELETE /habits/track/:id/checkin  取消打卡（今日）
 * GET    /habits/track/:id/stats    获取单个习惯统计（近30天热力图）
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'

const router = Router()
router.use(authRequired)

// ---- 工具函数 ----

/** 获取今日日期字符串 (YYYY-MM-DD，本地时区) */
function todayStr(): string {
  const now = new Date()
  const tzOffset = now.getTimezoneOffset() * 60000
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10)
}

/** 获取指定偏移天数的日期字符串 */
function dateStr(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const tzOffset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10)
}

/** 计算连续打卡天数（从今日往前连续） */
function calcStreak(logDates: string[]): number {
  if (logDates.length === 0) return 0
  const dateSet = new Set(logDates)
  let streak = 0
  // 从今天往前检查
  for (let i = 0; i < 365; i++) {
    const d = dateStr(-i)
    if (dateSet.has(d)) {
      streak++
    } else if (i === 0) {
      // 今天没打卡，从昨天开始算
      continue
    } else {
      break
    }
  }
  return streak
}

/** 计算最长连续打卡天数 */
function calcLongestStreak(logDates: string[]): number {
  if (logDates.length === 0) return 0
  const sorted = [...logDates].sort()
  let longest = 1
  let current = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000)
    if (diff === 1) {
      current++
      longest = Math.max(longest, current)
    } else {
      current = 1
    }
  }
  return longest
}

// ---- 路由 ----

/** GET /habits/track — 获取习惯列表（含今日打卡状态、连续天数） */
router.get('/', async (req, res, next) => {
  try {
    const today = todayStr()
    const habits = await prisma.trackHabit.findMany({
      where: { userId: req.user!.userId, archived: false },
      orderBy: { sortOrder: 'asc' },
      include: {
        logs: {
          where: { date: { gte: dateStr(-30) } },
          orderBy: { date: 'desc' },
        },
      },
    })

    const result = habits.map((h) => {
      const logDates = h.logs.map((l) => l.date)
      const todayLog = h.logs.find((l) => l.date === today)
      return {
        id: h.id,
        name: h.name,
        icon: h.icon,
        color: h.color,
        frequency: h.frequency,
        targetCount: h.targetCount,
        remindAt: h.remindAt,
        sortOrder: h.sortOrder,
        checkedToday: !!todayLog,
        todayLogId: todayLog?.id || null,
        streak: calcStreak(logDates),
        longestStreak: calcLongestStreak(logDates),
        totalDays: logDates.length,
        // 近30天打卡日期
        recentDates: logDates,
      }
    })

    return success(res, result)
  } catch (e) {
    next(e)
  }
})

const createSchema = z.object({
  name: z.string().min(1).max(50),
  icon: z.string().max(10).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  frequency: z.enum(['daily', 'weekly']).optional(),
  targetCount: z.number().int().min(1).max(7).optional(),
  remindAt: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
})

/** POST /habits/track — 创建习惯 */
router.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.parse(req.body)
    const count = await prisma.trackHabit.count({
      where: { userId: req.user!.userId, archived: false },
    })
    if (count >= 20) throw new HttpError('习惯数量上限为20个', 422)

    const habit = await prisma.trackHabit.create({
      data: {
        userId: req.user!.userId,
        name: parsed.name,
        icon: parsed.icon || '✅',
        color: parsed.color || '#10b981',
        frequency: parsed.frequency || 'daily',
        targetCount: parsed.targetCount || 1,
        remindAt: parsed.remindAt || null,
        sortOrder: count,
      },
    })

    auditReq(req, res, {
      category: 'habit_track',
      action: 'create',
      targetType: 'TrackHabit',
      targetId: habit.id,
      summary: `创建习惯: ${parsed.name}`,
    })

    return success(res, habit, '已创建', 201)
  } catch (e) {
    next(e)
  }
})

const updateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  icon: z.string().max(10).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  remindAt: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  sortOrder: z.number().int().optional(),
})

/** PATCH /habits/track/:id — 更新习惯 */
router.patch('/:id', async (req, res, next) => {
  try {
    const parsed = updateSchema.parse(req.body)
    const id = req.params.id
    const habit = await prisma.trackHabit.findUnique({ where: { id } })
    if (!habit || habit.userId !== req.user!.userId) {
      throw new HttpError('习惯不存在', 404)
    }

    const updated = await prisma.trackHabit.update({
      where: { id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.icon !== undefined ? { icon: parsed.icon } : {}),
        ...(parsed.color !== undefined ? { color: parsed.color } : {}),
        ...(parsed.remindAt !== undefined ? { remindAt: parsed.remindAt } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
      },
    })

    return success(res, updated)
  } catch (e) {
    next(e)
  }
})

/** DELETE /habits/track/:id — 删除习惯（归档） */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const habit = await prisma.trackHabit.findUnique({ where: { id } })
    if (!habit || habit.userId !== req.user!.userId) {
      throw new HttpError('习惯不存在', 404)
    }

    await prisma.trackHabit.update({
      where: { id },
      data: { archived: true },
    })

    auditReq(req, res, {
      category: 'habit_track',
      action: 'delete',
      targetType: 'TrackHabit',
      targetId: id,
      summary: `删除习惯: ${habit.name}`,
    })

    return success(res, null, '已删除')
  } catch (e) {
    next(e)
  }
})

/** POST /habits/track/:id/checkin — 打卡（今日） */
router.post('/:id/checkin', async (req, res, next) => {
  try {
    const id = req.params.id
    const habit = await prisma.trackHabit.findUnique({ where: { id } })
    if (!habit || habit.userId !== req.user!.userId || habit.archived) {
      throw new HttpError('习惯不存在', 404)
    }

    const today = todayStr()
    // 检查今日是否已打卡
    const existing = await prisma.trackHabitLog.findUnique({
      where: { habitId_date: { habitId: id, date: today } },
    })
    if (existing) {
      return success(res, existing, '今日已打卡')
    }

    const note = (req.body.note || '').toString().trim().slice(0, 200) || null
    const log = await prisma.trackHabitLog.create({
      data: {
        habitId: id,
        userId: req.user!.userId,
        date: today,
        note,
      },
    })

    return success(res, log, '打卡成功', 201)
  } catch (e) {
    next(e)
  }
})

/** DELETE /habits/track/:id/checkin — 取消今日打卡 */
router.delete('/:id/checkin', async (req, res, next) => {
  try {
    const id = req.params.id
    const today = todayStr()
    const log = await prisma.trackHabitLog.findUnique({
      where: { habitId_date: { habitId: id, date: today } },
    })
    if (!log || log.userId !== req.user!.userId) {
      throw new HttpError('今日未打卡', 404)
    }

    await prisma.trackHabitLog.delete({ where: { id: log.id } })
    return success(res, null, '已取消打卡')
  } catch (e) {
    next(e)
  }
})

/** GET /habits/track/:id/stats — 获取单个习惯统计（近90天热力图） */
router.get('/:id/stats', async (req, res, next) => {
  try {
    const id = req.params.id
    const habit = await prisma.trackHabit.findUnique({ where: { id } })
    if (!habit || habit.userId !== req.user!.userId) {
      throw new HttpError('习惯不存在', 404)
    }

    const logs = await prisma.trackHabitLog.findMany({
      where: { habitId: id, date: { gte: dateStr(-90) } },
      orderBy: { date: 'asc' },
    })

    const logDates = logs.map((l) => l.date)
    const today = todayStr()
    const todayLog = logs.find((l) => l.date === today)

    // 本周完成天数
    const now = new Date()
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1 // 周一=0
    const monday = dateStr(-dayOfWeek)
    const thisWeek = logDates.filter((d) => d >= monday)

    return success(res, {
      habit: { id: habit.id, name: habit.name, icon: habit.icon, color: habit.color },
      streak: calcStreak(logDates),
      longestStreak: calcLongestStreak(logDates),
      totalDays: logDates.length,
      checkedToday: !!todayLog,
      thisWeekCount: thisWeek.length,
      targetCount: habit.targetCount,
      frequency: habit.frequency,
      recentDates: logDates, // 近90天
    })
  } catch (e) {
    next(e)
  }
})

export default router
