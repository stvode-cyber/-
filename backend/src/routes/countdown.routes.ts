import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'
import { rateLimit } from '../middleware/rateLimit.js'
import {
  computeNextTrigger,
  computeProgressByTime,
  syncMilestones,
  calcRemainingDays,
  generateCountdownSuggestions,
  parseJsonField,
  type CountdownType,
  type CountdownStatus,
  type RecurringConfig,
  type ReminderConfig,
  type Milestone,
  type LinkedModules,
  type CountdownRow,
} from '../utils/countdown.lib.js'

/**
 * 倒计时路由
 *
 * 路由清单：
 * - GET    /                       列出当前用户的倒计时（支持 status/type 过滤）
 * - POST   /                       创建倒计时
 * - GET    /suggestions            AI 智能建议（基于用户数据）
 * - GET    /reminders              列出未读倒计时提醒
 * - POST   /reminders/:id/read     标记单条提醒已读
 * - POST   /reminders/read-all     标记全部已读
 * - GET    /:id                    倒计时详情
 * - PATCH  /:id                    更新倒计时（动态字段）
 * - DELETE /:id                    删除倒计时
 * - POST   /:id/complete           手动完成倒计时（触发庆祝）
 * - POST   /:id/pause              暂停倒计时
 * - POST   /:id/resume             恢复倒计时
 * - POST   /:id/milestones         添加里程碑
 * - PATCH  /:id/milestones/:idx    更新里程碑（标记达成/编辑标签）
 * - DELETE /:id/milestones/:idx    删除里程碑
 * - POST   /push/subscribe         Web Push 订阅
 * - DELETE /push/subscribe         取消 Web Push 订阅
 * - GET    /push/subscriptions     列出当前用户的订阅端点
 */

const router = Router()
router.use(authRequired)

// ============ 类型定义 ============

const VALID_TYPES: CountdownType[] = ['single', 'recurring', 'important', 'goal']
const VALID_STATUSES: CountdownStatus[] = ['active', 'paused', 'completed', 'cancelled']
const VALID_PATTERNS = ['daily', 'weekly', 'monthly', 'yearly', 'custom'] as const
const VALID_REMINDER_RULES = ['decreasing', 'fixed', 'custom'] as const
const VALID_REMINDER_LEVELS = ['normal', 'appropriate', 'urgent'] as const
const VALID_CELEBRATION_STYLES = ['confetti', 'fireworks', 'milestone', 'minimal'] as const

function isValidType(s: string): s is CountdownType {
  return VALID_TYPES.includes(s as CountdownType)
}

// ============ DTO ============

/** 倒计时列表/详情 DTO */
interface CountdownDTO {
  id: string
  type: CountdownType
  title: string
  description: string | null
  targetDate: string | null
  createdDate: string
  recurringConfig: RecurringConfig | null
  milestones: Milestone[] | null
  reminderConfig: ReminderConfig | null
  celebrationConfig: {
    enabled: boolean
    style: string
    sound?: string
    message?: string
  } | null
  linkedModules: LinkedModules | null
  status: CountdownStatus
  progress: number
  isPinned: boolean
  isImportant: boolean
  lastNotified: string | null
  completedAt: string | null
  completionSnapshot: Record<string, unknown> | null
  /** 实时计算字段（GET 时返回） */
  remainingDays: number | null
  remainingHours: number | null
  updatedAt: string
}

/** Prisma 行 → DTO */
function toDTO(row: CountdownRow): CountdownDTO {
  const now = new Date()
  const target = row.targetDate

  // 循环倒计时：重算 nextTrigger（修复旧数据中 computeNextTrigger 的 bug）
  let recurringConfig = parseJsonField<RecurringConfig | null>(row.recurringConfig, null)
  if (row.type === 'recurring' && recurringConfig) {
    const newTrigger = computeNextTrigger(
      recurringConfig.pattern,
      now,
      recurringConfig.customRule,
      recurringConfig.triggerTime,
    )
    const newTriggerISO = newTrigger.toISOString()
    const storedNext = recurringConfig.nextTrigger
    // 仅当存储值与重算值不一致时更新（避免频繁写库）
    if (storedNext !== newTriggerISO) {
      const storedDate = storedNext ? new Date(storedNext) : null
      if (!storedDate || Math.abs(storedDate.getTime() - newTrigger.getTime()) > 60 * 1000) {
        recurringConfig = { ...recurringConfig, nextTrigger: newTriggerISO }
        // fire-and-forget 更新数据库
        prisma.countdown.update({
          where: { id: row.id },
          data: { recurringConfig: JSON.stringify(recurringConfig) },
        }).catch(() => {})
      }
    }
  }

  return {
    id: row.id,
    type: isValidType(row.type) ? row.type : 'single',
    title: row.title,
    description: row.description,
    targetDate: target ? target.toISOString() : null,
    createdDate: row.createdDate instanceof Date ? row.createdDate.toISOString() : new Date(row.createdDate).toISOString(),
    recurringConfig,
    milestones: parseJsonField<Milestone[] | null>(row.milestones, null),
    reminderConfig: parseJsonField<ReminderConfig | null>(row.reminderConfig, null),
    celebrationConfig: parseJsonField<CountdownDTO['celebrationConfig'] | null>(row.celebrationConfig, null),
    linkedModules: parseJsonField<LinkedModules | null>(row.linkedModules, null),
    status: (VALID_STATUSES.includes(row.status as CountdownStatus) ? row.status : 'active') as CountdownStatus,
    progress: row.progress,
    isPinned: row.isPinned,
    isImportant: row.isImportant,
    lastNotified: row.lastNotified ? row.lastNotified.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    completionSnapshot: parseJsonField<Record<string, unknown> | null>(row.completionSnapshot, null),
    remainingDays: calcRemainingDays(target, now),
    remainingHours: target ? Math.floor((target.getTime() - now.getTime()) / (60 * 60 * 1000)) : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
  }
}

// ============ Zod 校验 ============

const milestoneSchema = z.object({
  label: z.string().min(1).max(50),
  percentage: z.number().int().min(0).max(100),
  reached: z.boolean().default(false),
})

const recurringConfigSchema = z.object({
  pattern: z.enum(VALID_PATTERNS),
  customRule: z.string().max(100).optional(),
  /** 触发时间（HH:mm），仅 daily/weekly/monthly/yearly 有效 */
  triggerTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  nextTrigger: z.string().optional(),
  /** 倒计时显示开始时间（HH:mm），如 "09:00"。未设置时默认一直显示倒计时 */
  countdownStartAt: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
})

const reminderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  rule: z.enum(VALID_REMINDER_RULES).default('decreasing'),
  /** 提醒强度：light=轻度 / normal=标准 / strong=强力 */
  intensity: z.enum(['light', 'normal', 'strong']).default('normal'),
  decreasingRule: z
    .object({
      over30days: z.string().default('每周一 09:00'),
      '7to30days': z.string().default('每2天 09:00'),
      '1to7days': z.string().default('每天 09:00'),
      last24hours: z.string().default('每4小时'),
      last1hour: z.string().default('每15分钟'),
    })
    .optional(),
  customReminders: z
    .array(
      z.object({
        daysBefore: z.number().int().min(0).max(365),
        time: z.string().regex(/^\d{1,2}:\d{2}$/),
        level: z.enum(VALID_REMINDER_LEVELS),
      }),
    )
    .max(10)
    .optional(),
})

const celebrationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  style: z.enum(VALID_CELEBRATION_STYLES).default('confetti'),
  sound: z.string().max(100).optional(),
  message: z.string().max(200).optional(),
})

const linkedModulesSchema = z.object({
  wishFund: z.string().optional(),
  goalPlan: z.string().optional(),
  importantDay: z.string().optional(),
})

const createSchema = z.object({
  type: z.enum(['single', 'recurring', 'important', 'goal']),
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  targetDate: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), { message: 'targetDate 必须是合法 ISO 时间' })
    .optional(),
  recurringConfig: recurringConfigSchema.optional(),
  milestones: z.array(milestoneSchema).max(20).optional(),
  reminderConfig: reminderConfigSchema.optional(),
  celebrationConfig: celebrationConfigSchema.optional(),
  linkedModules: linkedModulesSchema.optional(),
  isPinned: z.boolean().default(false),
  isImportant: z.boolean().default(false),
})

const updateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  targetDate: z
    .string()
    .nullable()
    .refine((s) => s === null || !isNaN(Date.parse(s)), { message: 'targetDate 必须是合法 ISO 时间' })
    .optional(),
  recurringConfig: recurringConfigSchema.nullable().optional(),
  milestones: z.array(milestoneSchema).max(20).nullable().optional(),
  reminderConfig: reminderConfigSchema.nullable().optional(),
  celebrationConfig: celebrationConfigSchema.nullable().optional(),
  linkedModules: linkedModulesSchema.nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  isPinned: z.boolean().optional(),
  isImportant: z.boolean().optional(),
  status: z.enum(['active', 'paused', 'completed', 'cancelled']).optional(),
})

const pushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    auth: z.string(),
    p256dh: z.string(),
  }),
})

// ============ 路由：CRUD ============

/**
 * GET /
 * 列出当前用户的倒计时
 * - status: active | paused | completed | cancelled | all（默认 active）
 * - type: single | recurring | important | goal
 * - pinned: 1（只看置顶）
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const status = typeof req.query.status === 'string' ? req.query.status : 'active'
    const type = typeof req.query.type === 'string' ? req.query.type : undefined
    const pinnedOnly = req.query.pinned === '1'

    const where: {
      userId: string
      status?: string
      type?: string
      isPinned?: boolean
    } = { userId }
    if (status !== 'all') where.status = status
    if (type) where.type = type
    if (pinnedOnly) where.isPinned = true

    const rows = await prisma.countdown.findMany({
      where,
      orderBy: [{ isImportant: 'desc' }, { isPinned: 'desc' }, { targetDate: 'asc' }],
    })

    success(res, { items: rows.map((r) => toDTO(r as unknown as CountdownRow)) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /
 * 创建倒计时
 */
router.post('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError('参数校验失败：' + parsed.error.message, 400)
    }
    const body = parsed.data

    // 类型校验：recurring 必填 recurringConfig；其他类型若有 targetDate 必填
    if (body.type === 'recurring' && !body.recurringConfig) {
      throw new HttpError('循环型倒计时必须提供 recurringConfig', 400)
    }
    if (body.type !== 'recurring' && !body.targetDate) {
      throw new HttpError(`${body.type} 类型倒计时必须提供 targetDate`, 400)
    }

    // 计算循环首次触发时间
    let recurringConfig: RecurringConfig | null = null
    if (body.type === 'recurring' && body.recurringConfig) {
      const nextTrigger = body.recurringConfig.nextTrigger
        ? new Date(body.recurringConfig.nextTrigger)
        : computeNextTrigger(
            body.recurringConfig.pattern,
            new Date(),
            body.recurringConfig.customRule,
            body.recurringConfig.triggerTime,
          )
      recurringConfig = {
        ...body.recurringConfig,
        nextTrigger: nextTrigger.toISOString(),
      }
    }

    const created = await prisma.countdown.create({
      data: {
        userId,
        type: body.type,
        title: body.title,
        description: body.description || null,
        targetDate: body.targetDate ? new Date(body.targetDate) : null,
        recurringConfig: recurringConfig ? JSON.stringify(recurringConfig) : null,
        milestones: body.milestones ? JSON.stringify(body.milestones) : null,
        reminderConfig: body.reminderConfig ? JSON.stringify(body.reminderConfig) : null,
        celebrationConfig: body.celebrationConfig ? JSON.stringify(body.celebrationConfig) : null,
        linkedModules: body.linkedModules ? JSON.stringify(body.linkedModules) : null,
        isPinned: body.isPinned,
        isImportant: body.isImportant,
      },
    })

    auditReq(req, res, {
      category: 'countdown',
      action: 'create',
      targetType: 'Countdown',
      targetId: created.id,
      summary: `创建倒计时: ${body.title}`,
      detail: { type: body.type, targetDate: body.targetDate },
    })

    success(res, toDTO(created as unknown as CountdownRow), '创建成功', 201)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /suggestions
 * AI 智能建议：根据用户数据主动推荐创建倒计时
 */
router.get('/suggestions', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const suggestions = await generateCountdownSuggestions(userId)
    success(res, { items: suggestions })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /reminders
 * 列出倒计时提醒（默认未读，最近 50 条）
 */
router.get('/reminders', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const onlyUnread = req.query.unread !== '0'

    const rows = await prisma.countdownReminder.findMany({
      where: onlyUnread ? { userId, isRead: false } : { userId },
      orderBy: { triggerAt: 'desc' },
      take: 50,
      include: {
        countdown: {
          select: { id: true, title: true, type: true, targetDate: true },
        },
      },
    })

    success(res, {
      items: rows.map((r) => ({
        id: r.id,
        countdownId: r.countdownId,
        countdownTitle: r.countdown?.title || null,
        countdownType: r.countdown?.type || null,
        triggerAt: r.triggerAt instanceof Date ? r.triggerAt.toISOString() : new Date(r.triggerAt).toISOString(),
        level: r.level,
        content: r.content,
        isRead: r.isRead,
      })),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /reminders/:id/read
 * 标记单条提醒已读
 */
router.post('/reminders/:id/read', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params
    const existing = await prisma.countdownReminder.findFirst({ where: { id, userId } })
    if (!existing) throw new HttpError('提醒不存在或无权操作', 404)

    await prisma.countdownReminder.update({ where: { id }, data: { isRead: true } })
    success(res, { id, isRead: true })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /reminders/read-all
 * 标记当前用户所有未读提醒为已读
 */
router.post('/reminders/read-all', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const result = await prisma.countdownReminder.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    })
    success(res, { updated: result.count })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /:id
 * 倒计时详情
 */
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params

    const row = await prisma.countdown.findFirst({ where: { id, userId } })
    if (!row) throw new HttpError('倒计时不存在或无权查看', 404)

    // 同步进度（基于剩余时间）+ 里程碑 reached
    if (row.status === 'active' && row.targetDate) {
      const autoProgress = computeProgressByTime(row.createdDate, row.targetDate)
      if (autoProgress > row.progress) {
        const ms = parseJsonField<Milestone[] | null>(row.milestones, null)
        const milestonesSynced = syncMilestones(ms, autoProgress)
        if (milestonesSynced.changed || autoProgress > row.progress) {
          await prisma.countdown.update({
            where: { id },
            data: {
              progress: autoProgress,
              milestones: milestonesSynced.milestones ? JSON.stringify(milestonesSynced.milestones) : null,
            },
          })
          row.progress = autoProgress
          row.milestones = milestonesSynced.milestones ? JSON.stringify(milestonesSynced.milestones) : null
        }
      }
    }

    success(res, toDTO(row as unknown as CountdownRow))
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /:id
 * 更新倒计时（动态字段：仅更新 body 中出现的字段）
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError('参数校验失败：' + parsed.error.message, 400)
    }
    const body = parsed.data

    const existing = await prisma.countdown.findFirst({ where: { id, userId } })
    if (!existing) throw new HttpError('倒计时不存在或无权操作', 404)

    const updateData: Record<string, unknown> = {}
    if (body.title !== undefined) updateData.title = body.title
    if (body.description !== undefined) updateData.description = body.description
    if (body.targetDate !== undefined) updateData.targetDate = body.targetDate ? new Date(body.targetDate) : null
    if (body.recurringConfig !== undefined) {
      // 若改为循环型且 nextTrigger 缺失，自动计算
      if (body.recurringConfig && !body.recurringConfig.nextTrigger) {
        const nextTrigger = computeNextTrigger(
          body.recurringConfig.pattern,
          new Date(),
          body.recurringConfig.customRule,
          body.recurringConfig.triggerTime,
        )
        updateData.recurringConfig = JSON.stringify({
          ...body.recurringConfig,
          nextTrigger: nextTrigger.toISOString(),
        })
      } else {
        updateData.recurringConfig = body.recurringConfig ? JSON.stringify(body.recurringConfig) : null
      }
    }
    if (body.milestones !== undefined) updateData.milestones = body.milestones ? JSON.stringify(body.milestones) : null
    if (body.reminderConfig !== undefined) updateData.reminderConfig = body.reminderConfig ? JSON.stringify(body.reminderConfig) : null
    if (body.celebrationConfig !== undefined) updateData.celebrationConfig = body.celebrationConfig ? JSON.stringify(body.celebrationConfig) : null
    if (body.linkedModules !== undefined) updateData.linkedModules = body.linkedModules ? JSON.stringify(body.linkedModules) : null
    if (body.progress !== undefined) {
      updateData.progress = body.progress
      // 同步里程碑 reached 状态
      const ms = parseJsonField<Milestone[] | null>(existing.milestones, null)
      const synced = syncMilestones(ms, body.progress)
      updateData.milestones = synced.milestones ? JSON.stringify(synced.milestones) : null
    }
    if (body.isPinned !== undefined) updateData.isPinned = body.isPinned
    if (body.isImportant !== undefined) updateData.isImportant = body.isImportant
    if (body.status !== undefined) updateData.status = body.status

    const updated = await prisma.countdown.update({ where: { id }, data: updateData })

    auditReq(req, res, {
      category: 'countdown',
      action: 'update',
      targetType: 'Countdown',
      targetId: id,
      summary: `更新倒计时: ${existing.title}`,
      detail: { updatedFields: Object.keys(updateData) },
    })

    success(res, toDTO(updated as unknown as CountdownRow))
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /:id
 * 删除倒计时（级联删除关联的提醒）
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params

    const existing = await prisma.countdown.findFirst({ where: { id, userId } })
    if (!existing) throw new HttpError('倒计时不存在或无权操作', 404)

    await prisma.countdown.delete({ where: { id } })

    await auditReqAsync(req, res, {
      category: 'countdown',
      action: 'delete',
      targetType: 'Countdown',
      targetId: id,
      summary: `删除倒计时: ${existing.title}`,
    })

    success(res, { id })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /:id/complete
 * 手动完成倒计时（触发庆祝动画）
 */
router.post('/:id/complete', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params

    const existing = await prisma.countdown.findFirst({ where: { id, userId } })
    if (!existing) throw new HttpError('倒计时不存在或无权操作', 404)
    if (existing.status === 'completed') throw new HttpError('倒计时已完成，无法重复操作', 400)

    const now = new Date()
    const progress = 100
    const ms = parseJsonField<Milestone[] | null>(existing.milestones, null)
    const milestones = syncMilestones(ms, progress).milestones
    const snapshot = {
      title: existing.title,
      type: existing.type,
      targetDate: existing.targetDate?.toISOString() || null,
      createdDate: existing.createdDate.toISOString(),
      completedAt: now.toISOString(),
      durationDays: existing.targetDate
        ? Math.floor((now.getTime() - existing.createdDate.getTime()) / (24 * 60 * 60 * 1000))
        : null,
      milestones,
    }

    const updated = await prisma.countdown.update({
      where: { id },
      data: {
        status: 'completed',
        progress,
        milestones: milestones ? JSON.stringify(milestones) : null,
        completedAt: now,
        completionSnapshot: JSON.stringify(snapshot),
      },
    })

    auditReq(req, res, {
      category: 'countdown',
      action: 'manual_complete',
      targetType: 'Countdown',
      targetId: id,
      summary: `手动完成倒计时: ${existing.title}`,
      detail: { snapshot },
    })

    success(res, toDTO(updated as unknown as CountdownRow))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /:id/pause
 * 暂停倒计时
 */
router.post('/:id/pause', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params

    const existing = await prisma.countdown.findFirst({ where: { id, userId } })
    if (!existing) throw new HttpError('倒计时不存在或无权操作', 404)
    if (existing.status !== 'active') throw new HttpError('仅进行中状态可暂停', 400)

    const updated = await prisma.countdown.update({ where: { id }, data: { status: 'paused' } })

    auditReq(req, res, {
      category: 'countdown',
      action: 'pause',
      targetType: 'Countdown',
      targetId: id,
      summary: `暂停倒计时: ${existing.title}`,
    })

    success(res, toDTO(updated as unknown as CountdownRow))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /:id/resume
 * 恢复倒计时
 */
router.post('/:id/resume', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params

    const existing = await prisma.countdown.findFirst({ where: { id, userId } })
    if (!existing) throw new HttpError('倒计时不存在或无权操作', 404)
    if (existing.status !== 'paused') throw new HttpError('仅暂停状态可恢复', 400)

    const updated = await prisma.countdown.update({ where: { id }, data: { status: 'active' } })

    auditReq(req, res, {
      category: 'countdown',
      action: 'resume',
      targetType: 'Countdown',
      targetId: id,
      summary: `恢复倒计时: ${existing.title}`,
    })

    success(res, toDTO(updated as unknown as CountdownRow))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /:id/milestones
 * 添加里程碑
 */
router.post('/:id/milestones', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params
    const parsed = milestoneSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('参数校验失败：' + parsed.error.message, 400)

    const existing = await prisma.countdown.findFirst({ where: { id, userId } })
    if (!existing) throw new HttpError('倒计时不存在或无权操作', 404)

    const arr = parseJsonField<Milestone[]>(existing.milestones, [])
    arr.push(parsed.data)
    // 按 percentage 升序
    arr.sort((a, b) => a.percentage - b.percentage)

    const updated = await prisma.countdown.update({ where: { id }, data: { milestones: JSON.stringify(arr) } })

    auditReq(req, res, {
      category: 'countdown',
      action: 'milestone_add',
      targetType: 'Countdown',
      targetId: id,
      summary: `添加里程碑: ${existing.title} / ${parsed.data.label} (${parsed.data.percentage}%)`,
    })

    res.status(201).json(success(res, parseJsonField<Milestone[]>(updated.milestones, []), '添加成功', 201))
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /:id/milestones/:idx
 * 更新里程碑（标记达成/编辑标签）
 */
router.patch('/:id/milestones/:idx', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id, idx } = req.params
    const idxNum = parseInt(idx, 10)
    if (isNaN(idxNum)) throw new HttpError('里程碑序号必须为数字', 400)

    const patchSchema = z.object({
      label: z.string().min(1).max(50).optional(),
      percentage: z.number().int().min(0).max(100).optional(),
      reached: z.boolean().optional(),
    })
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('参数校验失败：' + parsed.error.message, 400)

    const existing = await prisma.countdown.findFirst({ where: { id, userId } })
    if (!existing) throw new HttpError('倒计时不存在或无权操作', 404)

    const arr = parseJsonField<Milestone[]>(existing.milestones, [])
    if (idxNum < 0 || idxNum >= arr.length) throw new HttpError('里程碑序号超出范围', 400)

    arr[idxNum] = { ...arr[idxNum], ...parsed.data }
    arr.sort((a, b) => a.percentage - b.percentage)

    await prisma.countdown.update({ where: { id }, data: { milestones: JSON.stringify(arr) } })

    auditReq(req, res, {
      category: 'countdown',
      action: 'milestone_update',
      targetType: 'Countdown',
      targetId: id,
      summary: `更新里程碑 #${idx}: ${existing.title}`,
      detail: { updatedFields: Object.keys(parsed.data) },
    })

    success(res, arr)
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /:id/milestones/:idx
 * 删除里程碑
 */
router.delete('/:id/milestones/:idx', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id, idx } = req.params
    const idxNum = parseInt(idx, 10)
    if (isNaN(idxNum)) throw new HttpError('里程碑序号必须为数字', 400)

    const existing = await prisma.countdown.findFirst({ where: { id, userId } })
    if (!existing) throw new HttpError('倒计时不存在或无权操作', 404)

    const arr = parseJsonField<Milestone[]>(existing.milestones, [])
    if (idxNum < 0 || idxNum >= arr.length) throw new HttpError('里程碑序号超出范围', 400)

    const removed = arr.splice(idxNum, 1)[0]
    await prisma.countdown.update({ where: { id }, data: { milestones: JSON.stringify(arr) } })

    auditReq(req, res, {
      category: 'countdown',
      action: 'milestone_delete',
      targetType: 'Countdown',
      targetId: id,
      summary: `删除里程碑: ${existing.title} / ${removed.label}`,
    })

    success(res, arr)
  } catch (err) {
    next(err)
  }
})

// ============ 路由：Web Push 推送订阅 ============

/**
 * POST /push/subscribe
 * 注册 Web Push 订阅
 *
 * 设计说明：
 * - 当前版本仅做订阅存储 + 前端轮询（GET /reminders）
 * - 实际 Web Push 协议推送需安装 web-push 包后启用 sendPushNotification()
 * - endpoint 唯一约束：同一浏览器订阅多次不会重复（upsert）
 *
 * 频率限制：每用户每分钟 5 次（避免重复订阅轰炸）
 */
router.post(
  '/push/subscribe',
  rateLimit({ limit: 5, windowMs: 60_000, keyFn: (req) => req.user?.userId || 'unknown' }),
  async (req, res, next) => {
    try {
      const userId = req.user!.userId
      const parsed = pushSubscribeSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError('参数校验失败：' + parsed.error.message, 400)

      const { endpoint, keys } = parsed.data
      const subscription = { endpoint, keys }
      const userAgent = req.headers['user-agent'] || null

      const record = await prisma.pushSubscription.upsert({
        where: { endpoint },
        update: { subscription: JSON.stringify(subscription), userAgent },
        create: { userId, endpoint, subscription: JSON.stringify(subscription), userAgent },
      })

      auditReq(req, res, {
        category: 'countdown',
        action: 'push_subscribe',
        targetType: 'PushSubscription',
        targetId: record.id,
        summary: `Web Push 订阅: ${endpoint.slice(0, 60)}...`,
      })

      res.status(201).json(
        success(res, { id: record.id, endpoint: record.endpoint }, '订阅成功', 201),
      )
    } catch (err) {
      next(err)
    }
  },
)

/**
 * DELETE /push/subscribe
 * 取消 Web Push 订阅（按 endpoint）
 * body: { endpoint }
 */
router.delete('/push/subscribe', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const endpoint =
      typeof req.body?.endpoint === 'string'
        ? req.body.endpoint
        : typeof req.query.endpoint === 'string'
          ? req.query.endpoint
          : ''
    if (!endpoint) throw new HttpError('必须提供 endpoint', 400)

    const existing = await prisma.pushSubscription.findFirst({ where: { endpoint, userId } })
    if (!existing) {
      // 幂等：已不存在视为已取消
      success(res, { endpoint, cancelled: true })
      return
    }

    await prisma.pushSubscription.delete({ where: { endpoint } })

    auditReq(req, res, {
      category: 'countdown',
      action: 'push_unsubscribe',
      targetType: 'PushSubscription',
      targetId: existing.id,
      summary: `取消 Web Push 订阅: ${endpoint.slice(0, 60)}...`,
    })

    success(res, { endpoint, cancelled: true })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /push/subscriptions
 * 列出当前用户的订阅端点（多端管理）
 */
router.get('/push/subscriptions', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const rows = await prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, endpoint: true, userAgent: true, createdAt: true },
    })
    success(res, {
      items: rows.map((r) => ({
        id: r.id,
        endpoint: r.endpoint,
        // 仅展示前 80 字符，避免响应过大
        endpointPreview: r.endpoint.slice(0, 80),
        userAgent: r.userAgent,
        deviceLabel: r.userAgent ? guessDeviceLabel(r.userAgent) : null,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : new Date(r.createdAt).toISOString(),
      })),
    })
  } catch (err) {
    next(err)
  }
})

/** 从 UserAgent 推断设备标签（仅展示用） */
function guessDeviceLabel(ua: string): string {
  if (/iphone|ipad|ios/i.test(ua)) return 'iOS 设备'
  if (/android/i.test(ua)) return 'Android 设备'
  if (/windows/i.test(ua)) return /edg/i.test(ua) ? 'Edge on Windows' : 'Chrome on Windows'
  if (/mac/i.test(ua)) return 'macOS 设备'
  if (/linux/i.test(ua)) return 'Linux 设备'
  return 'Web 浏览器'
}

export default router
