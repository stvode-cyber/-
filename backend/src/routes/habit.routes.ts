/**
 * 用户习惯档案路由
 *
 * GET    /habits          获取当前用户的习惯档案（按分类分组）
 * POST   /habits          手动添加习惯
 * PATCH  /habits/:id      更新习惯内容
 * DELETE /habits/:id       删除习惯
 */

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { getUserHabits, extractAndSaveHabits, extractHabitsFromMessage } from '../services/habitService.js'

const router = Router()
router.use(authRequired)

/** GET /habits — 获取习惯档案 */
router.get('/', async (req, res, next) => {
  try {
    const habits = await getUserHabits(req.user!.userId)
    return success(res, habits)
  } catch (e) {
    next(e)
  }
})

const createSchema = z.object({
  category: z.enum(['interest', 'routine', 'preference', 'personality', 'work', 'other']).default('other'),
  content: z.string().min(1).max(200),
  tags: z.array(z.string()).optional(),
})

/** POST /habits — 手动添加习惯 */
router.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.parse(req.body)
    const habit = await prisma.userHabit.create({
      data: {
        userId: req.user!.userId,
        category: parsed.category,
        content: parsed.content,
        source: 'manual',
        tags: parsed.tags ? JSON.stringify(parsed.tags) : null,
        confidence: 1.0,
        hitCount: 1,
        lastMentionedAt: new Date(),
      },
    })

    auditReq(req, res, {
      category: 'habit',
      action: 'create',
      targetType: 'UserHabit',
      targetId: habit.id,
      summary: `添加习惯: ${parsed.category}/${parsed.content.slice(0, 30)}`,
    })

    return success(res, habit, '已添加', 201)
  } catch (e) {
    next(e)
  }
})

/** POST /habits/extract — 手动触发从消息中提取习惯（测试用） */
router.post('/extract', async (req, res, next) => {
  try {
    const message = (req.body.message || '').toString().trim()
    if (!message) throw new HttpError('消息不能为空', 422)

    const extracted = extractHabitsFromMessage(message)
    const newCount = await extractAndSaveHabits(req.user!.userId, message)

    auditReq(req, res, {
      category: 'habit',
      action: 'extract',
      targetType: 'User',
      targetId: req.user!.userId,
      summary: `提取习惯: 检测到${extracted.length}个, 新增${newCount}个`,
    })

    return success(res, { extracted, newCount })
  } catch (e) {
    next(e)
  }
})

const updateSchema = z.object({
  content: z.string().min(1).max(200).optional(),
  category: z.enum(['interest', 'routine', 'preference', 'personality', 'work', 'other']).optional(),
})

/** PATCH /habits/:id — 更新习惯 */
router.patch('/:id', async (req, res, next) => {
  try {
    const parsed = updateSchema.parse(req.body)
    const id = req.params.id
    const habit = await prisma.userHabit.findUnique({ where: { id } })
    if (!habit || habit.userId !== req.user!.userId) {
      throw new HttpError('习惯不存在', 404)
    }

    const updated = await prisma.userHabit.update({
      where: { id },
      data: {
        ...(parsed.content ? { content: parsed.content } : {}),
        ...(parsed.category ? { category: parsed.category } : {}),
      },
    })

    auditReq(req, res, {
      category: 'habit',
      action: 'update',
      targetType: 'UserHabit',
      targetId: id,
      summary: `更新习惯: ${updated.content.slice(0, 30)}`,
    })

    return success(res, updated)
  } catch (e) {
    next(e)
  }
})

/** DELETE /habits/:id — 删除习惯 */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const habit = await prisma.userHabit.findUnique({ where: { id } })
    if (!habit || habit.userId !== req.user!.userId) {
      throw new HttpError('习惯不存在', 404)
    }

    await prisma.userHabit.delete({ where: { id } })

    auditReq(req, res, {
      category: 'habit',
      action: 'delete',
      targetType: 'UserHabit',
      targetId: id,
      summary: `删除习惯: ${habit.content.slice(0, 30)}`,
    })

    return success(res, null, '已删除')
  } catch (e) {
    next(e)
  }
})

export default router
