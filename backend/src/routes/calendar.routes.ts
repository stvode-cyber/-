import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'

/**
 * 日历聚合路由
 *
 * 用途：按月聚合用户所有时间相关数据，用于前端日历视图展示。
 *
 * 路由清单：
 * - GET /calendar?year=2026&month=8  获取指定月份的日历事件
 * - GET /calendar/day?date=2026-08-13  获取指定日期的详情
 */

const router = Router()
router.use(authRequired)

/** 事件类型 → 中文标签 + 颜色 */
const EVENT_META: Record<string, { label: string; color: string }> = {
  task: { label: '任务', color: '#8b5cf6' },
  bill: { label: '账单', color: '#10b981' },
  diet: { label: '饮食', color: '#f97316' },
  sleep: { label: '睡眠', color: '#6366f1' },
  reminder: { label: '提醒', color: '#ec4899' },
  handover: { label: '交接', color: '#14b8a6' },
  manualEvent: { label: '事件', color: '#eab308' },
}

/**
 * 获取指定月份的日历事件
 * - year/month 为数字，month 范围 1-12
 * - 返回按日期分组的事件列表
 */
router.get('/', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year as string, 10)
    const month = parseInt(req.query.month as string, 10)
    if (!year || !month || month < 1 || month > 12) {
      throw new HttpError('请提供有效的 year 和 month 参数', 422)
    }
    const userId = req.user!.userId

    // 构建月份范围（本地时区）
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 1) // 下月1号

    // 并行查询 7 大模块
    const [tasks, bills, diets, sleeps, reminders, handovers, manualEvents] = await Promise.all([
      // 1. 任务：按到期时间或提醒时间过滤
      prisma.task.findMany({
        where: {
          userId,
          OR: [
            { dueDate: { gte: startDate, lt: endDate } },
            { remindAt: { gte: startDate, lt: endDate } },
          ],
        },
        select: { id: true, title: true, status: true, priority: true, dueDate: true, remindAt: true },
      }),
      // 2. 账单：按账单日期过滤
      prisma.bill.findMany({
        where: { userId, billDate: { gte: startDate, lt: endDate } },
        select: { id: true, title: true, type: true, amount: true, category: true, billDate: true },
      }),
      // 3. 饮食：按进食时间过滤
      prisma.diet.findMany({
        where: { userId, eatenAt: { gte: startDate, lt: endDate } },
        select: { id: true, foodName: true, mealType: true, calories: true, eatenAt: true },
      }),
      // 4. 睡眠：按睡眠日期过滤
      prisma.sleep.findMany({
        where: { userId, sleepDate: { gte: startDate, lt: endDate } },
        select: { id: true, sleepDate: true, durationMin: true, quality: true },
      }),
      // 5. 提醒：按提醒时间过滤
      prisma.reminder.findMany({
        where: { userId, remindAt: { gte: startDate, lt: endDate } },
        select: { id: true, title: true, remindAt: true, done: true, level: true },
      }),
      // 6. 交接单：按交接日期过滤
      prisma.handover.findMany({
        where: { userId, handoverDate: { gte: startDate, lt: endDate } },
        select: { id: true, title: true, shift: true, handoverDate: true, status: true },
      }),
      // 7. 手动事件：按开始时间过滤
      prisma.manualEvent.findMany({
        where: {
          userId,
          OR: [
            { startTime: { gte: startDate, lt: endDate } },
            { endTime: { gte: startDate, lt: endDate } },
          ],
        },
        select: { id: true, title: true, scope: true, startTime: true, endTime: true, location: true },
      }),
    ])

    // 提取日期 key（YYYY-MM-DD）
    const dateKey = (d: Date): string => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    // 按日期分组
    const days: Record<string, Array<Record<string, unknown>>> = {}

    const addToDay = (date: Date | null | undefined, event: Record<string, unknown>) => {
      if (!date) return
      const key = dateKey(date instanceof Date ? date : new Date(date))
      if (!days[key]) days[key] = []
      days[key].push(event)
    }

    // 填充事件
    tasks.forEach((t) => {
      const date = t.dueDate || t.remindAt
      if (date) {
        addToDay(date, {
          id: t.id, type: 'task', title: t.title,
          subtitle: t.status === 'done' ? '已完成' : priorityLabel(t.priority),
          time: date, status: t.status,
        })
      }
    })
    bills.forEach((b) => {
      addToDay(b.billDate, {
        id: b.id, type: 'bill', title: b.title,
        subtitle: `${b.type === 'income' ? '+' : '-'}¥${b.amount}`,
        time: b.billDate, amount: b.amount, billType: b.type,
      })
    })
    diets.forEach((d) => {
      addToDay(d.eatenAt, {
        id: d.id, type: 'diet', title: d.foodName,
        subtitle: `${mealTypeLabel(d.mealType)} · ${d.calories || 0}kcal`,
        time: d.eatenAt,
      })
    })
    sleeps.forEach((s) => {
      addToDay(s.sleepDate, {
        id: s.id, type: 'sleep', title: '睡眠记录',
        subtitle: `${Math.floor(s.durationMin / 60)}h${s.durationMin % 60}m${s.quality ? ' · 质量' + '⭐'.repeat(s.quality) : ''}`,
        time: s.sleepDate,
      })
    })
    reminders.forEach((r) => {
      addToDay(r.remindAt, {
        id: r.id, type: 'reminder', title: r.title,
        subtitle: r.done ? '已完成' : '待提醒',
        time: r.remindAt, done: r.done,
      })
    })
    handovers.forEach((h) => {
      addToDay(h.handoverDate, {
        id: h.id, type: 'handover', title: h.title,
        subtitle: `${shiftLabel(h.shift)} · ${handoverStatusLabel(h.status)}`,
        time: h.handoverDate,
      })
    })
    manualEvents.forEach((e) => {
      addToDay(e.startTime, {
        id: e.id, type: 'manualEvent', title: e.title,
        subtitle: `${scopeLabel(e.scope)}${e.location ? ' · ' + e.location : ''}`,
        time: e.startTime, endTime: e.endTime,
      })
    })

    // 统计
    const totalEvents = Object.values(days).reduce((sum, events) => sum + events.length, 0)

    return success(res, {
      year, month,
      days,
      totalEvents,
      eventTypes: EVENT_META,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * 获取指定日期的详情
 * - date 格式 YYYY-MM-DD
 * - 返回该日期的所有事件
 */
router.get('/day', async (req, res, next) => {
  try {
    const dateStr = req.query.date as string
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new HttpError('请提供有效的 date 参数（格式 YYYY-MM-DD）', 422)
    }
    const userId = req.user!.userId

    // 构建日期范围
    const dateParts = dateStr.split('-').map(Number)
    const startDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2])
    const endDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2] + 1)

    // 复用月查询逻辑，但范围缩小到一天
    const [tasks, bills, diets, sleeps, reminders, handovers, manualEvents] = await Promise.all([
      prisma.task.findMany({
        where: { userId, OR: [{ dueDate: { gte: startDate, lt: endDate } }, { remindAt: { gte: startDate, lt: endDate } }] },
        select: { id: true, title: true, description: true, status: true, priority: true, dueDate: true, remindAt: true },
      }),
      prisma.bill.findMany({
        where: { userId, billDate: { gte: startDate, lt: endDate } },
        select: { id: true, title: true, type: true, amount: true, category: true, billDate: true, note: true },
      }),
      prisma.diet.findMany({
        where: { userId, eatenAt: { gte: startDate, lt: endDate } },
        select: { id: true, foodName: true, mealType: true, calories: true, protein: true, carbs: true, fat: true, note: true, eatenAt: true },
      }),
      prisma.sleep.findMany({
        where: { userId, sleepDate: { gte: startDate, lt: endDate } },
        select: { id: true, sleepDate: true, bedtime: true, wakeTime: true, durationMin: true, quality: true, note: true },
      }),
      prisma.reminder.findMany({
        where: { userId, remindAt: { gte: startDate, lt: endDate } },
        select: { id: true, title: true, content: true, remindAt: true, done: true, level: true, repeat: true },
      }),
      prisma.handover.findMany({
        where: { userId, handoverDate: { gte: startDate, lt: endDate } },
        select: { id: true, title: true, shift: true, handoverDate: true, status: true, summary: true },
      }),
      prisma.manualEvent.findMany({
        where: { userId, OR: [{ startTime: { gte: startDate, lt: endDate } }, { endTime: { gte: startDate, lt: endDate } }] },
        select: { id: true, title: true, description: true, scope: true, startTime: true, endTime: true, location: true },
      }),
    ])

    return success(res, {
      date: dateStr,
      events: { tasks, bills, diets, sleeps, reminders, handovers, manualEvents },
      total: tasks.length + bills.length + diets.length + sleeps.length + reminders.length + handovers.length + manualEvents.length,
    })
  } catch (e) {
    next(e)
  }
})

/** 优先级 → 中文标签 */
function priorityLabel(p: string): string {
  return { low: '低', medium: '中', high: '高', urgent: '紧急' }[p] || '中'
}

/** 餐次 → 中文标签 */
function mealTypeLabel(m: string): string {
  return { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }[m] || '加餐'
}

/** 班次 → 中文标签 */
function shiftLabel(s: string): string {
  return { morning: '早班', afternoon: '午班', night: '夜班', 'all-day': '全天', custom: '自定义' }[s] || '全天'
}

/** 交接单状态 → 中文标签 */
function handoverStatusLabel(s: string): string {
  return { draft: '草稿', submitted: '已提交', archived: '已归档' }[s] || '草稿'
}

/** 事件范围 → 中文标签 */
function scopeLabel(s: string): string {
  return { work: '工作', life: '生活', finance: '财务' }[s] || '生活'
}

export default router
