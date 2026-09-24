import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'

/**
 * 团队任务路由（方案 A）
 *
 * 用途：在现有 Task 表基础上扩展 assigneeId（归属人），支持团队内派活、
 * 状态跟踪、逾期自动标记、通知归属人+上级主管。
 *
 * status 流转（5 种，固定不可自定义）：
 *   pending（待开始）→ in_progress（进行中）→ completed（已完成·自动写 completedAt）
 *                      ↘ paused（已暂停）
 *   overdue（已逾期·系统自动标，不可手动改）
 */

const router = Router()
router.use(authRequired)

// ============ 校验 Schema ============

const createTaskSchema = z.object({
  title: z.string().min(1, '任务标题不能为空').max(200),
  description: z.string().max(5000).optional(),
  dueDate: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  assigneeId: z.string().optional(),
  origin: z.enum(['personal', 'team']).default('team'),
  remark: z.string().max(1000).optional(),
})

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'paused']),
  remark: z.string().max(1000).optional(),
})

const reassignSchema = z.object({
  assigneeId: z.string().min(1, '必须指定新的归属人'),
  remark: z.string().max(1000).optional(),
})

// ============ 工具函数 ============

async function canWrite(taskId: string, userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeRole: true } })
  if (!user) return false
  if (user.employeeRole === 'boss' || user.employeeRole === 'supervisor') return true
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { userId: true, assigneeId: true } })
  return !!task && (task.userId === userId || task.assigneeId === userId)
}

// ============ 路由 ============

/** 创建团队任务 */
router.post('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = createTaskSchema.parse(req.body)
    const targetAssignee = body.assigneeId || userId

    if (body.assigneeId && body.assigneeId !== userId) {
      const exists = await prisma.user.findUnique({ where: { id: body.assigneeId } })
      if (!exists) throw new HttpError('指定的归属人不存在', 400)
    }

    const task = await prisma.task.create({
      data: {
        userId,
        title: body.title,
        description: body.description,
        status: 'pending',
        priority: body.priority,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        assigneeId: targetAssignee,
        origin: body.origin,
        remark: body.remark || null,
        category: body.origin === 'team' ? 'team' : undefined,
      },
    })

    auditReq(req, res, { category: 'task-team', action: 'create', targetType: 'task', targetId: task.id, summary: `创建团队任务: ${task.title}` })
    success(res, task, '任务创建成功')
  } catch (err) { next(err) }
})

/** 任务列表（支持筛选 + 分组） */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeRole: true, departmentId: true } })
    if (!user) throw new HttpError('未登录', 401)

    const assigneeId = typeof req.query.assigneeId === 'string' ? req.query.assigneeId : undefined
    const statusFilter = Array.isArray(req.query.status) ? req.query.status as string[] : typeof req.query.status === 'string' ? [req.query.status] : undefined
    const priorityFilter = Array.isArray(req.query.priority) ? req.query.priority as string[] : typeof req.query.priority === 'string' ? [req.query.priority] : undefined
    const dueFrom = typeof req.query.dueFrom === 'string' ? req.query.dueFrom : undefined
    const dueTo = typeof req.query.dueTo === 'string' ? req.query.dueTo : undefined
    const overdueOnly = req.query.overdueOnly === 'true'
    const grouped = req.query.grouped === 'assignee'
    const origin = typeof req.query.origin === 'string' ? req.query.origin : 'team'

    const where: any = {}
    if (user.employeeRole === 'user') {
      where.OR = [{ userId }, { assigneeId: userId }]
    } else if (user.employeeRole === 'supervisor' && user.departmentId) {
      const deptUsers = await prisma.user.findMany({ where: { departmentId: user.departmentId }, select: { id: true } })
      const deptUserIds = deptUsers.map((u) => u.id)
      where.OR = [{ userId: { in: deptUserIds } }, { assigneeId: { in: deptUserIds } }]
    }
    if (origin !== 'all') where.origin = origin
    if (assigneeId) where.assigneeId = assigneeId
    if (statusFilter && statusFilter.length) where.status = { in: statusFilter }
    if (priorityFilter && priorityFilter.length) where.priority = { in: priorityFilter }
    if (dueFrom || dueTo) where.dueDate = {}
    if (dueFrom) where.dueDate.gte = new Date(dueFrom)
    if (dueTo) where.dueDate.lte = new Date(dueTo)
    if (overdueOnly) {
      where.dueDate = { ...(where.dueDate || {}), lt: new Date() }
      where.status = { ...(where.status || {}), not: 'completed' }
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        user: { select: { id: true, nickname: true, avatar: true } },
        assignee: { select: { id: true, nickname: true, avatar: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    })

    if (grouped) {
      const groups: Record<string, { assignee: any; tasks: any[] }> = {}
      for (const t of tasks) {
        const key = t.assigneeId || t.userId
        if (!groups[key]) groups[key] = { assignee: t.assignee || t.user, tasks: [] }
        groups[key].tasks.push(t)
      }
      success(res, { grouped: true, groups })
    } else {
      success(res, { grouped: false, tasks })
    }
  } catch (err) { next(err) }
})

/** 任务详情 */
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, nickname: true, avatar: true } },
        assignee: { select: { id: true, nickname: true, avatar: true } },
      },
    })
    if (!task) throw new HttpError('任务不存在', 404)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeRole: true } })
    if (user?.employeeRole === 'user' && task.userId !== userId && task.assigneeId !== userId) {
      throw new HttpError('无权查看', 403)
    }
    success(res, task)
  } catch (err) { next(err) }
})

/** 改状态 */
router.patch('/:id/status', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    if (!(await canWrite(req.params.id, userId))) throw new HttpError('无权修改此任务', 403)
    const body = updateStatusSchema.parse(req.body)
    const updateData: any = { status: body.status }
    if (body.remark) updateData.remark = body.remark
    if (body.status === 'completed') updateData.completedAt = new Date()
    const task = await prisma.task.update({ where: { id: req.params.id }, data: updateData })
    auditReq(req, res, { category: 'task-team', action: 'update-status', targetType: 'task', targetId: task.id, summary: `更新任务状态: ${task.title} → ${body.status}` })
    success(res, task, '状态已更新')
  } catch (err) { next(err) }
})

/** 重新分配归属人 */
router.patch('/:id/reassign', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = reassignSchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeRole: true } })
    if (!user) throw new HttpError('未登录', 401)
    const task = await prisma.task.findUnique({ where: { id: req.params.id } })
    if (!task) throw new HttpError('任务不存在', 404)
    if (user.employeeRole === 'user' && task.userId !== userId) throw new HttpError('只有创建人可以重新分配', 403)
    const newAssignee = await prisma.user.findUnique({ where: { id: body.assigneeId } })
    if (!newAssignee) throw new HttpError('归属人不存在', 400)
    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: { assigneeId: body.assigneeId, remark: body.remark || undefined },
    })
    auditReq(req, res, { category: 'task-team', action: 'reassign', targetType: 'task', targetId: task.id, summary: `重新分配: ${task.title} → ${newAssignee.nickname || newAssignee.username}` })
    success(res, updated, '归属人已更新')
  } catch (err) { next(err) }
})

/** 删除任务 */
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeRole: true } })
    const task = await prisma.task.findUnique({ where: { id: req.params.id } })
    if (!task) throw new HttpError('任务不存在', 404)
    if (user?.employeeRole !== 'boss' && task.userId !== userId) throw new HttpError('无权删除', 403)
    await prisma.task.delete({ where: { id: req.params.id } })
    auditReq(req, res, { category: 'task-team', action: 'delete', targetType: 'task', targetId: task.id, summary: `删除任务: ${task.title}` })
    success(res, null, '已删除')
  } catch (err) { next(err) }
})

export default router

