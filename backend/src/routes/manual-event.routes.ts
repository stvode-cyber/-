import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'

/**
 * 事件手动管理（EV-06）
 *
 * 用户在事件总览中可以：
 * 1. 手动添加自定义事件（聚会/生日/外出等），与 AI 自动采集的事件一起按时间线展示
 * 2. 隐藏不想看到的自动事件（Task/Reminder 等），通过 HiddenEvent 记录覆盖 AI 采集结果
 *
 * 数据模型：
 * - ManualEvent（表 manual_events）：用户手动添加的事件
 *   - scope: work | life | finance（与 home.events.scope 对齐）
 *   - hidden: 用户可在事件总览中隐藏该手动事件本身
 * - HiddenEvent（表 hidden_events）：用户隐藏的自动事件记录
 *   - 通过 sourceType + sourceId 联合标识一条自动事件
 *
 * 路由：
 * - GET    /                       列出用户的手动事件（支持 scope/date 过滤）
 * - POST   /                       创建手动事件
 * - PATCH  /:id                    更新事件（含 hidden 切换）
 * - DELETE /:id                    删除事件
 * - GET    /hidden-auto            列出用户已隐藏的自动事件
 * - POST   /hidden-auto            隐藏一个自动事件
 * - DELETE /hidden-auto/:type/:id  取消隐藏自动事件
 */

const router = Router()
router.use(authRequired)

// ============ 类型定义 ============

/** 手动事件视角类型（与 home.events.scope 对齐） */
type EventScope = 'work' | 'life' | 'finance'

/** ManualEvent Prisma 行（含必要的字段） */
interface ManualEventRow {
  id: string
  userId: string
  title: string
  description: string | null
  startTime: Date
  endTime: Date | null
  scope: string
  location: string | null
  attendees: string | null
  color: string | null
  hidden: boolean
  createdAt: Date
  updatedAt: Date
}

/** 前端返回 DTO（attendees 解析为数组） */
interface ManualEventDTO {
  id: string
  title: string
  description: string | null
  startTime: string
  endTime: string | null
  scope: EventScope
  location: string | null
  attendees: string[]
  color: string
  hidden: boolean
  createdAt: string
  updatedAt: string
}

/** HiddenEvent DTO */
interface HiddenEventDTO {
  id: string
  sourceType: string
  sourceId: string
  createdAt: string
}

// ============ 工具函数 ============

const VALID_SCOPES: EventScope[] = ['work', 'life', 'finance']

function isValidScope(s: string): s is EventScope {
  return VALID_SCOPES.includes(s as EventScope)
}

/** 将 ManualEvent Prisma 行转为前端 DTO */
function toDTO(row: ManualEventRow): ManualEventDTO {
  let attendees: string[] = []
  try {
    const parsed = JSON.parse(row.attendees || '[]')
    if (Array.isArray(parsed)) attendees = parsed.filter((x) => typeof x === 'string')
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startTime: row.startTime instanceof Date ? row.startTime.toISOString() : new Date(row.startTime).toISOString(),
    endTime: row.endTime
      ? row.endTime instanceof Date
        ? row.endTime.toISOString()
        : new Date(row.endTime).toISOString()
      : null,
    scope: isValidScope(row.scope) ? row.scope : 'life',
    location: row.location,
    attendees,
    color: row.color || 'blue',
    hidden: row.hidden,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString(),
  }
}

function toHiddenDTO(row: { id: string; sourceType: string; sourceId: string; createdAt: Date }): HiddenEventDTO {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
  }
}

// ============ Zod 校验 ============

const createSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  startTime: z.string().refine((s) => !isNaN(Date.parse(s)), { message: 'startTime 必须是合法 ISO 时间' }),
  endTime: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), { message: 'endTime 必须是合法 ISO 时间' })
    .optional(),
  scope: z.enum(['work', 'life', 'finance']).default('life'),
  location: z.string().max(200).optional(),
  attendees: z.array(z.string().max(50)).max(20).optional(),
  color: z.string().max(20).optional(),
})

const updateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  startTime: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), { message: 'startTime 必须是合法 ISO 时间' })
    .optional(),
  endTime: z
    .string()
    .nullable()
    .refine((s) => s === null || !isNaN(Date.parse(s)), { message: 'endTime 必须是合法 ISO 时间' })
    .optional(),
  scope: z.enum(['work', 'life', 'finance']).optional(),
  location: z.string().max(200).nullable().optional(),
  attendees: z.array(z.string().max(50)).max(20).nullable().optional(),
  color: z.string().max(20).optional(),
  hidden: z.boolean().optional(),
})

const hideAutoSchema = z.object({
  sourceType: z.string().min(1).max(30),
  sourceId: z.string().min(1).max(50),
})

// ============ 路由：手动事件 CRUD ============

/**
 * GET /:id/detail
 * 事件详情聚合（EV-03）
 *
 * 根据 eventId + eventType 查询事件完整信息：
 * - type=manual：返回 ManualEvent 完整字段（含 description/attendees/location 等）
 * - type=task：返回 Task 字段（含 priority/progress/tags 等）
 * - type=reminder：返回 Reminder 字段（含 level/repeat 等）
 *
 * 统一返回字段（前端 EventDetailModal 直接消费）：
 * - id / type / title / time / scope
 * - description?: 备注
 * - location?: 地点（仅 manual）
 * - attendees?: 参与人（仅 manual）
 * - color?: 颜色（仅 manual）
 * - priority?: 优先级（task）
 * - important?: 重要标记（task）
 * - progress?: 进度（task）
 * - level?: 提醒等级（reminder）
 * - repeat?: 重复（reminder）
 * - countdown: 距离开始的倒计时（秒；已开始则为 0；已结束则为负数）
 * - relatedPeople: 关联人物（手动事件的 attendees + 任务的 tags 中的人名等）
 * - checklist: 准备清单（仅当任务是"重要+紧急"时通过 generateChecklist 生成）
 */
router.get('/:id/detail', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params
    const eventType = typeof req.query.type === 'string' ? req.query.type : ''

    const now = new Date()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // 公共详情字段
    type EventDetail = {
      id: string
      type: string
      title: string
      time: string
      scope: 'work' | 'life' | 'finance'
      description?: string | null
      location?: string | null
      attendees?: string[]
      color?: string
      priority?: string
      important?: boolean
      progress?: number
      level?: string
      repeat?: string
      countdown: number
      relatedPeople: string[]
      checklist: Array<{ text: string; optional?: boolean }>
    }

    let detail: EventDetail | null = null

    if (eventType === 'manual') {
      const m = await prisma.manualEvent.findFirst({ where: { id, userId } })
      if (!m) {
        throw new HttpError('事件不存在或无权查看', 404)
      }
      let attendees: string[] = []
      try {
        const parsed = JSON.parse(m.attendees || '[]')
        if (Array.isArray(parsed)) attendees = parsed.filter((x) => typeof x === 'string')
      } catch {
        /* ignore */
      }
      const startTime = m.startTime instanceof Date ? m.startTime : new Date(m.startTime)
      const scope: 'work' | 'life' | 'finance' =
        m.scope === 'work' ? 'work' : m.scope === 'finance' ? 'finance' : 'life'
      detail = {
        id: m.id,
        type: 'manual',
        title: m.title,
        time: startTime.toISOString(),
        scope,
        description: m.description,
        location: m.location,
        attendees,
        color: m.color || 'blue',
        countdown: Math.floor((startTime.getTime() - now.getTime()) / 1000),
        relatedPeople: attendees,
        checklist: [],
      }
    } else if (eventType === 'task') {
      const t = await prisma.task.findFirst({ where: { id, userId } })
      if (!t) {
        throw new HttpError('事件不存在或无权查看', 404)
      }
      const dueDate = t.dueDate ? (t.dueDate instanceof Date ? t.dueDate : new Date(t.dueDate)) : null
      const scope: 'work' | 'life' | 'finance' =
        t.category === 'work' ? 'work' : t.category === 'finance' ? 'finance' : 'life'
      // 解析 tags 中可能包含的人名（JSON 数组）
      let relatedPeople: string[] = []
      try {
        const parsed = JSON.parse(t.tags || '[]')
        if (Array.isArray(parsed)) relatedPeople = parsed.filter((x) => typeof x === 'string')
      } catch {
        /* ignore */
      }
      // 重要紧急任务生成准备清单
      const checklist: Array<{ text: string; optional?: boolean }> = []
      if (t.important || t.priority === 'urgent' || t.priority === 'high') {
        checklist.push(...generateSimpleChecklist(t.title))
      }
      detail = {
        id: t.id,
        type: 'task',
        title: t.title,
        time: dueDate ? dueDate.toISOString() : now.toISOString(),
        scope,
        description: t.description,
        priority: t.priority,
        important: t.important,
        progress: t.progress,
        countdown: dueDate ? Math.floor((dueDate.getTime() - now.getTime()) / 1000) : 0,
        relatedPeople,
        checklist,
      }
    } else if (eventType === 'reminder') {
      const r = await prisma.reminder.findFirst({ where: { id, userId } })
      if (!r) {
        throw new HttpError('事件不存在或无权查看', 404)
      }
      const remindAt = r.remindAt instanceof Date ? r.remindAt : new Date(r.remindAt)
      const scope: 'work' | 'life' | 'finance' =
        r.relatedType === 'task' ? 'work' : r.relatedType === 'bill' ? 'finance' : 'life'
      detail = {
        id: r.id,
        type: 'reminder',
        title: r.title,
        time: remindAt.toISOString(),
        scope,
        description: r.content,
        level: r.level,
        repeat: r.repeat,
        countdown: Math.floor((remindAt.getTime() - now.getTime()) / 1000),
        relatedPeople: [],
        checklist: [],
      }
    } else {
      throw new HttpError('未知事件类型，请通过 ?type=manual|task|reminder 指定', 400)
    }

    // 详情查询属于只读操作，但仍记录一条 audit，便于追溯"谁查看了哪个事件详情"
    auditReq(req, res, {
      category: 'manual_event',
      action: 'view_detail',
      targetType: eventType || 'Event',
      targetId: id,
      summary: `查看事件详情: ${detail.title}`,
    })

    success(res, detail)
  } catch (err) {
    next(err)
  }
})

/**
 * 简易准备清单生成（EV-03 task 详情用）
 * 基于 generateChecklist 的简化版，避免引入 ai-reply.ts 的循环依赖
 */
function generateSimpleChecklist(title: string): Array<{ text: string; optional?: boolean }> {
  const items: Array<{ text: string; optional?: boolean }> = []
  if (/会议|开会|meeting|评审/.test(title)) {
    items.push({ text: '准备会议资料' })
    items.push({ text: '确认参会人员' })
    items.push({ text: '检查演示设备' })
    items.push({ text: '准备演示文稿', optional: true })
  } else if (/客户|拜访|见面|会见/.test(title)) {
    items.push({ text: '准备相关资料' })
    items.push({ text: '确认行程安排' })
    items.push({ text: '准备名片' })
    items.push({ text: '了解对方背景', optional: true })
  } else if (/截止|提交|交付|上线/.test(title)) {
    items.push({ text: '检查交付物完整性' })
    items.push({ text: '准备备份方案' })
    items.push({ text: '确认提交方式' })
  } else if (/考试|面试|答辩/.test(title)) {
    items.push({ text: '复习重点' })
    items.push({ text: '准备证件' })
    items.push({ text: '调整状态' })
  } else if (/旅行|出差|出发/.test(title)) {
    items.push({ text: '确认行程' })
    items.push({ text: '准备行李' })
    items.push({ text: '检查证件' })
  } else {
    items.push({ text: '梳理要点' })
    items.push({ text: '准备材料' })
    items.push({ text: '确认时间' })
  }
  return items
}

// ============ 路由：手动事件 CRUD（原有） ============

/**
 * GET /
 * 列出用户的手动事件
 * 查询参数：
 * - scope: work | life | finance（可选）
 * - date: YYYY-MM-DD（可选，过滤 startTime 在当天的）
 * - includeHidden: 1 / 0（默认 0，不返回 hidden=true 的事件）
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const scope = typeof req.query.scope === 'string' && isValidScope(req.query.scope) ? req.query.scope : undefined
    const dateStr = typeof req.query.date === 'string' ? req.query.date : undefined
    const includeHidden = req.query.includeHidden === '1'

    const where: { userId: string; scope?: string; hidden?: boolean; startTime?: { gte?: Date; lt?: Date } } = { userId }
    if (scope) where.scope = scope
    if (!includeHidden) where.hidden = false
    if (dateStr) {
      const d = new Date(dateStr)
      if (!isNaN(d.getTime())) {
        const start = new Date(d)
        start.setHours(0, 0, 0, 0)
        const end = new Date(start)
        end.setDate(end.getDate() + 1)
        where.startTime = { gte: start, lt: end }
      }
    }

    const rows = await prisma.manualEvent.findMany({
      where,
      orderBy: [{ startTime: 'asc' }, { createdAt: 'desc' }],
    })

    success(res, { items: rows.map(toDTO) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /
 * 创建手动事件
 */
router.post('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError('参数校验失败：' + parsed.error.message, 400)
    }
    const body = parsed.data

    // 校验：endTime 不能早于 startTime
    const start = new Date(body.startTime)
    if (body.endTime && new Date(body.endTime).getTime() < start.getTime()) {
      throw new HttpError('结束时间不能早于开始时间', 400)
    }

    const created = await prisma.manualEvent.create({
      data: {
        userId,
        title: body.title,
        description: body.description || null,
        startTime: start,
        endTime: body.endTime ? new Date(body.endTime) : null,
        scope: body.scope,
        location: body.location || null,
        attendees: body.attendees ? JSON.stringify(body.attendees) : null,
        color: body.color || 'blue',
        hidden: false,
      },
    })

    auditReq(req, res, {
      category: 'manual_event',
      action: 'create',
      targetType: 'ManualEvent',
      targetId: created.id,
      summary: `创建手动事件: ${body.title}`,
      detail: { title: body.title, scope: body.scope, startTime: body.startTime },
    })

    res.status(201).json(success(res, toDTO(created as unknown as ManualEventRow)))
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /:id
 * 更新手动事件（动态 SET 子句：仅更新 body 中出现的字段）
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

    // 查询并校验所有权
    const existing = await prisma.manualEvent.findFirst({ where: { id, userId } })
    if (!existing) {
      throw new HttpError('事件不存在或无权操作', 404)
    }

    // 动态构造更新字段
    const updateData: Record<string, unknown> = {}
    if (body.title !== undefined) updateData.title = body.title
    if (body.description !== undefined) updateData.description = body.description
    if (body.startTime !== undefined) updateData.startTime = new Date(body.startTime)
    if (body.endTime !== undefined) updateData.endTime = body.endTime ? new Date(body.endTime) : null
    if (body.scope !== undefined) updateData.scope = body.scope
    if (body.location !== undefined) updateData.location = body.location
    if (body.attendees !== undefined) updateData.attendees = body.attendees ? JSON.stringify(body.attendees) : null
    if (body.color !== undefined) updateData.color = body.color
    if (body.hidden !== undefined) updateData.hidden = body.hidden

    // 校验：endTime 不能早于 startTime
    const finalStart = updateData.startTime ? (updateData.startTime as Date) : existing.startTime
    const finalEnd = updateData.endTime !== undefined ? (updateData.endTime as Date | null) : existing.endTime
    if (finalEnd && finalEnd.getTime() < finalStart.getTime()) {
      throw new HttpError('结束时间不能早于开始时间', 400)
    }

    const updated = await prisma.manualEvent.update({
      where: { id },
      data: updateData,
    })

    auditReq(req, res, {
      category: 'manual_event',
      action: 'update',
      targetType: 'ManualEvent',
      targetId: id,
      summary: `更新手动事件: ${existing.title}`,
      detail: { updatedFields: Object.keys(updateData) },
    })

    success(res, toDTO(updated as unknown as ManualEventRow))
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /:id
 * 删除手动事件
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { id } = req.params

    const existing = await prisma.manualEvent.findFirst({ where: { id, userId } })
    if (!existing) {
      throw new HttpError('事件不存在或无权操作', 404)
    }

    await prisma.manualEvent.delete({ where: { id } })

    // 删除属于关键审计：等待日志落库
    await auditReqAsync(req, res, {
      category: 'manual_event',
      action: 'delete',
      targetType: 'ManualEvent',
      targetId: id,
      summary: `删除手动事件: ${existing.title}`,
    })

    success(res, { id })
  } catch (err) {
    next(err)
  }
})

// ============ 路由：自动事件隐藏管理 ============

/**
 * GET /hidden-auto
 * 列出用户已隐藏的自动事件记录
 */
router.get('/hidden-auto', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const rows = await prisma.hiddenEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    success(res, { items: rows.map(toHiddenDTO) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /hidden-auto
 * 隐藏一个自动事件（sourceType + sourceId）
 * 幂等：重复隐藏不会报错，已存在则直接返回原记录
 */
router.post('/hidden-auto', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const parsed = hideAutoSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError('参数校验失败：' + parsed.error.message, 400)
    }
    const { sourceType, sourceId } = parsed.data

    // 幂等：upsert 处理已存在情况
    const record = await prisma.hiddenEvent.upsert({
      where: { userId_sourceType_sourceId: { userId, sourceType, sourceId } },
      update: {},
      create: { userId, sourceType, sourceId },
    })

    auditReq(req, res, {
      category: 'manual_event',
      action: 'hide_auto',
      targetType: sourceType,
      targetId: sourceId,
      summary: `隐藏自动事件: ${sourceType}/${sourceId}`,
    })

    success(res, toHiddenDTO(record), undefined, 201)
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /hidden-auto/:sourceType/:sourceId
 * 取消隐藏一个自动事件
 */
router.delete('/hidden-auto/:sourceType/:sourceId', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const { sourceType, sourceId } = req.params

    const existing = await prisma.hiddenEvent.findUnique({
      where: { userId_sourceType_sourceId: { userId, sourceType, sourceId } },
    })
    if (!existing) {
      // 幂等：不存在视为已取消
      success(res, { sourceType, sourceId, cancelled: true })
      return
    }

    await prisma.hiddenEvent.delete({
      where: { userId_sourceType_sourceId: { userId, sourceType, sourceId } },
    })

    auditReq(req, res, {
      category: 'manual_event',
      action: 'unhide_auto',
      targetType: sourceType,
      targetId: sourceId,
      summary: `取消隐藏自动事件: ${sourceType}/${sourceId}`,
    })

    success(res, { sourceType, sourceId, cancelled: true })
  } catch (err) {
    next(err)
  }
})

export default router
