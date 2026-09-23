import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'

const router = Router()
router.use(authRequired)

const reminderSchema = z.object({
  title: z.string().min(1),
  content: z.string().optional(),
  level: z.enum(['urgent', 'proper', 'normal', 'silent']).default('proper'),
  remindAt: z.string(),
  repeat: z.enum(['once', 'daily', 'weekly', 'monthly']).default('once'),
  relatedType: z.string().optional(),
  relatedId: z.string().optional(),
})

/** 提醒列表（可仅查未完成） */
router.get('/', async (req, res, next) => {
  try {
    const onlyPending = req.query.pending === '1'
    const reminders = await prisma.reminder.findMany({
      where: {
        userId: req.user!.userId,
        ...(onlyPending ? { done: false } : {}),
      },
      orderBy: { remindAt: 'asc' },
      take: 100,
    })
    return success(res, reminders)
  } catch (e) {
    next(e)
  }
})

/**
 * 创建提醒
 * - 写入台账：reminder.create（自动捕获 ip / userAgent / 耗时）
 */
router.post('/', async (req, res, next) => {
  try {
    const parsed = reminderSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const data = parsed.data
    const reminder = await prisma.reminder.create({
      data: {
        userId: req.user!.userId,
        title: data.title,
        content: data.content,
        level: data.level,
        remindAt: new Date(data.remindAt),
        repeat: data.repeat,
        relatedType: data.relatedType,
        relatedId: data.relatedId,
      },
    })
    auditReq(req, res, {
      category: 'reminder',
      action: 'create',
      targetType: 'Reminder',
      targetId: reminder.id,
      summary: `创建提醒: ${data.title} (${data.level})`,
      detail: { title: data.title, level: data.level, remindAt: data.remindAt, repeat: data.repeat },
    })
    return success(res, reminder, '已创建', 201)
  } catch (e) {
    next(e)
  }
})

/**
 * 标记提醒完成
 * - 写入台账：reminder.done
 */
router.post('/:id/done', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.reminder.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('提醒不存在', 404)
    }
    await prisma.reminder.update({
      where: { id },
      data: { done: true, doneAt: new Date() },
    })
    auditReq(req, res, {
      category: 'reminder',
      action: 'done',
      targetType: 'Reminder',
      targetId: id,
      summary: `完成提醒: ${existing.title}`,
    })
    return success(res, null, '已完成')
  } catch (e) {
    next(e)
  }
})

/**
 * 删除提醒
 * - 写入台账：reminder.delete
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.reminder.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('提醒不存在', 404)
    }
    await prisma.reminder.delete({ where: { id } })
    // 删除属关键审计，await 确保日志落库
    await auditReqAsync(req, res, {
      category: 'reminder',
      action: 'delete',
      targetType: 'Reminder',
      targetId: id,
      summary: `删除提醒: ${existing.title}`,
    })
    return success(res, null, '已删除')
  } catch (e) {
    next(e)
  }
})

export default router
