import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'
import { safeParseArray } from '../utils/json.js'

/**
 * 工作交接表路由
 *
 * 用途：用户记录一个时段（白班/夜班/全天/阶段）的工作总结、已完成事项、
 * 待跟进事项、注意事项，便于班次/阶段之间的工作移交与回顾。
 *
 * 状态流转：
 *   draft（草稿）→ submitted（已提交）→ archived（已归档）
 *
 * 审计：所有写操作均通过 auditReq 自动记录台账，category = 'handover'。
 */

const router = Router()
router.use(authRequired)

// ============ 校验 Schema ============

/** 待跟进事项单项结构 */
const pendingItemSchema = z.object({
  text: z.string().min(1, '待跟进事项内容不能为空'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: z.string().optional(), // ISO 字符串
})

/** 创建/更新交接单 Schema（更新时所有字段可选） */
const handoverSchema = z.object({
  title: z.string().min(1, '交接单标题不能为空').max(100, '标题不能超过 100 字'),
  shift: z.enum(['morning', 'afternoon', 'night', 'all-day', 'custom']).default('all-day'),
  handoverDate: z.string().optional(), // ISO 字符串，缺省取当前
  summary: z.string().max(2000, '工作总结不能超过 2000 字').optional(),
  completedItems: z.array(z.string()).default([]), // 已完成事项数组
  pendingItems: z.array(pendingItemSchema).default([]), // 待跟进事项数组
  notes: z.string().max(1000, '注意事项不能超过 1000 字').optional(),
})

// ============ 工具函数 ============

/** 交接单序列化前的最小字段集（与 Prisma 查询结果对应） */
interface HandoverSerializeInput {
  id: string
  title: string
  shift: string
  handoverDate: Date
  summary?: string | null
  // Prisma 中 completedItems / pendingItems 为可空 String（存储 JSON 字符串）
  completedItems: string | null
  pendingItems: string | null
  notes?: string | null
  status: string
  submittedAt?: Date | null
  createdAt: Date
  updatedAt: Date
  [key: string]: unknown
}

/** 将交接单的 JSON 字段解析为对象，便于前端直接使用 */
function serializeHandover(h: HandoverSerializeInput) {
  return {
    ...h,
    completedItems: h.completedItems ? safeParseArray<string>(h.completedItems) : [],
    pendingItems: h.pendingItems ? safeParseArray(h.pendingItems) : [],
  }
}

// safeParseArray 已抽取到 utils/json.ts 共享

// ============ 路由 ============

/**
 * 交接单列表
 * - 支持按状态、日期范围过滤
 * - 默认按交接日期倒序
 */
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined
    const startDate = req.query.startDate as string | undefined
    const endDate = req.query.endDate as string | undefined

    const where: {
      userId: string
      status?: string
      handoverDate?: { gte?: Date; lte?: Date }
    } = { userId: req.user!.userId }
    if (status) where.status = status
    if (startDate || endDate) {
      where.handoverDate = {}
      if (startDate) where.handoverDate.gte = new Date(startDate)
      if (endDate) where.handoverDate.lte = new Date(endDate)
    }

    const list = await prisma.handover.findMany({
      where,
      orderBy: [{ handoverDate: 'desc' }, { createdAt: 'desc' }],
    })

    return success(res, list.map(serializeHandover))
  } catch (e) {
    next(e)
  }
})

/**
 * 交接单详情
 */
router.get('/:id', async (req, res, next) => {
  try {
    const handover = await prisma.handover.findUnique({
      where: { id: req.params.id },
    })
    if (!handover || handover.userId !== req.user!.userId) {
      throw new HttpError('交接单不存在', 404)
    }
    return success(res, serializeHandover(handover))
  } catch (e) {
    next(e)
  }
})

/**
 * 创建交接单
 * - completedItems / pendingItems 序列化为 JSON 字符串存储
 * - 写入台账：handover.create
 */
router.post('/', async (req, res, next) => {
  try {
    const parsed = handoverSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    }
    const data = parsed.data

    const handover = await prisma.handover.create({
      data: {
        userId: req.user!.userId,
        title: data.title,
        shift: data.shift,
        handoverDate: data.handoverDate ? new Date(data.handoverDate) : new Date(),
        summary: data.summary || null,
        completedItems: JSON.stringify(data.completedItems || []),
        pendingItems: JSON.stringify(data.pendingItems || []),
        notes: data.notes || null,
        status: 'draft',
      },
    })

    auditReq(req, res, {
      category: 'handover',
      action: 'create',
      targetType: 'Handover',
      targetId: handover.id,
      summary: `创建交接单: ${handover.title}`,
      detail: {
        shift: handover.shift,
        handoverDate: handover.handoverDate,
        completedCount: data.completedItems.length,
        pendingCount: data.pendingItems.length,
      },
    })

    return success(res, serializeHandover(handover), '交接单已创建', 201)
  } catch (e) {
    next(e)
  }
})

/**
 * 更新交接单（仅 draft 状态可改）
 * - 写入台账：handover.update
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.handover.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('交接单不存在', 404)
    }
    // 已提交 / 已归档不允许编辑，避免覆盖已确认的交接内容
    if (existing.status !== 'draft') {
      throw new HttpError(`当前状态(${existing.status})不可编辑，仅草稿可修改`, 400)
    }

    const parsed = handoverSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    }
    const data = parsed.data

    const handover = await prisma.handover.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.shift !== undefined ? { shift: data.shift } : {}),
        ...(data.handoverDate !== undefined
          ? { handoverDate: new Date(data.handoverDate) }
          : {}),
        ...(data.summary !== undefined ? { summary: data.summary || null } : {}),
        ...(data.completedItems !== undefined
          ? { completedItems: JSON.stringify(data.completedItems) }
          : {}),
        ...(data.pendingItems !== undefined
          ? { pendingItems: JSON.stringify(data.pendingItems) }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      },
    })

    auditReq(req, res, {
      category: 'handover',
      action: 'update',
      targetType: 'Handover',
      targetId: handover.id,
      summary: `更新交接单: ${handover.title}`,
      detail: {
        updatedFields: Object.keys(data),
      },
    })

    return success(res, serializeHandover(handover), '已更新')
  } catch (e) {
    next(e)
  }
})

/**
 * 提交交接单（draft → submitted）
 * - 提交后内容不可修改，但可归档
 * - 写入台账：handover.submit
 */
router.post('/:id/submit', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.handover.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('交接单不存在', 404)
    }
    if (existing.status !== 'draft') {
      throw new HttpError(`当前状态(${existing.status})不可提交，仅草稿可提交`, 400)
    }

    const handover = await prisma.handover.update({
      where: { id },
      data: { status: 'submitted', submittedAt: new Date() },
    })

    auditReq(req, res, {
      category: 'handover',
      action: 'submit',
      targetType: 'Handover',
      targetId: handover.id,
      summary: `提交交接单: ${handover.title}`,
    })

    return success(res, serializeHandover(handover), '交接单已提交')
  } catch (e) {
    next(e)
  }
})

/**
 * 归档交接单（submitted → archived）
 * - 归档后进入历史归档区，不可再修改或重新提交
 * - 写入台账：handover.archive
 */
router.post('/:id/archive', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.handover.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('交接单不存在', 404)
    }
    if (existing.status !== 'submitted') {
      throw new HttpError(`当前状态(${existing.status})不可归档，仅已提交可归档`, 400)
    }

    const handover = await prisma.handover.update({
      where: { id },
      data: { status: 'archived' },
    })

    auditReq(req, res, {
      category: 'handover',
      action: 'archive',
      targetType: 'Handover',
      targetId: handover.id,
      summary: `归档交接单: ${handover.title}`,
    })

    return success(res, serializeHandover(handover), '交接单已归档')
  } catch (e) {
    next(e)
  }
})

/**
 * 删除交接单
 * - 草稿可直接删除；已提交 / 已归档也允许删除（用户自主管理）
 * - 写入台账：handover.delete
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.handover.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('交接单不存在', 404)
    }

    await prisma.handover.delete({ where: { id } })

    // 删除属关键审计，await 确保日志落库
    await auditReqAsync(req, res, {
      category: 'handover',
      action: 'delete',
      targetType: 'Handover',
      targetId: id,
      summary: `删除交接单: ${existing.title}`,
      detail: { beforeStatus: existing.status },
    })

    return success(res, null, '已删除')
  } catch (e) {
    next(e)
  }
})

export default router
