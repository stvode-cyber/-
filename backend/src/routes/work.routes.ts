import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'

const router = Router()
router.use(authRequired)

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  progress: z.number().int().min(0).max(100).default(0),
  dueDate: z.string().optional(),
  remindAt: z.string().optional(),
  category: z.string().default('work'),
  important: z.boolean().default(false),
})

/**
 * 更新任务 schema（partial，仅允许白名单字段）
 * - 基于 taskSchema 的 partial，仅含 title/description/priority/progress/dueDate/remindAt/category/important
 * - 防止批量赋值攻击：userId / id / createdAt / status 等字段不在白名单内，即便客户端传入也会被 zod 丢弃
 * - status 由专门的 /done 接口控制，不允许直接 PATCH
 */
const taskUpdateSchema = taskSchema.partial()

/** 任务列表（支持按状态过滤） */
router.get('/tasks', async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined
    const tasks = await prisma.task.findMany({
      where: {
        userId: req.user!.userId,
        ...(status ? { status } : {}),
      },
      orderBy: [{ important: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    })
    return success(res, tasks)
  } catch (e) {
    next(e)
  }
})

/**
 * 创建任务
 * - 写入台账：task.create（自动捕获 ip / userAgent / 耗时）
 */
router.post('/tasks', async (req, res, next) => {
  try {
    const parsed = taskSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const data = parsed.data
    const task = await prisma.task.create({
      data: {
        userId: req.user!.userId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        progress: data.progress,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        remindAt: data.remindAt ? new Date(data.remindAt) : null,
        category: data.category,
        important: data.important,
      },
    })
    auditReq(req, res, {
      category: 'task',
      action: 'create',
      targetType: 'Task',
      targetId: task.id,
      summary: `创建任务: ${task.title}`,
      detail: { title: task.title, priority: task.priority, dueDate: task.dueDate },
    })
    return success(res, task, '任务已创建', 201)
  } catch (e) {
    next(e)
  }
})

/**
 * 更新任务（支持部分字段）
 * - 使用 taskUpdateSchema 白名单校验，防止批量赋值攻击
 * - 写入台账：task.update
 */
router.patch('/tasks/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.task.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('任务不存在', 404)
    }
    // 白名单校验：仅允许 taskSchema 内字段，userId/id/createdAt 等会被丢弃
    const parsed = taskUpdateSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { dueDate, remindAt, ...rest } = parsed.data
    const task = await prisma.task.update({
      where: { id },
      data: {
        ...rest,
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        ...(remindAt !== undefined ? { remindAt: remindAt ? new Date(remindAt) : null } : {}),
      },
    })
    auditReq(req, res, {
      category: 'task',
      action: 'update',
      targetType: 'Task',
      targetId: task.id,
      summary: `更新任务: ${task.title}`,
      detail: parsed.data,
    })
    return success(res, task, '已更新')
  } catch (e) {
    next(e)
  }
})

/**
 * 标记任务完成
 * - 写入台账：task.done
 */
router.post('/tasks/:id/done', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.task.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('任务不存在', 404)
    }
    const task = await prisma.task.update({
      where: { id },
      data: { status: 'done', progress: 100 },
    })
    auditReq(req, res, {
      category: 'task',
      action: 'done',
      targetType: 'Task',
      targetId: task.id,
      summary: `完成任务: ${task.title}`,
    })
    return success(res, task, '任务完成')
  } catch (e) {
    next(e)
  }
})

/**
 * 删除任务
 * - 写入台账：task.delete
 */
router.delete('/tasks/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.task.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('任务不存在', 404)
    }
    await prisma.task.delete({ where: { id } })
    // 删除属关键审计，await 确保日志落库
    await auditReqAsync(req, res, {
      category: 'task',
      action: 'delete',
      targetType: 'Task',
      targetId: id,
      summary: `删除任务: ${existing.title}`,
    })
    return success(res, null, '已删除')
  } catch (e) {
    next(e)
  }
})

export default router
