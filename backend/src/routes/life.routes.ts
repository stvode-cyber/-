import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'

const router = Router()
router.use(authRequired)

const dietSchema = z.object({
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  foodName: z.string().min(1),
  portion: z.string().optional(),
  calories: z.number().optional(),
  protein: z.number().optional(),
  carbs: z.number().optional(),
  fat: z.number().optional(),
  note: z.string().optional(),
  eatenAt: z.string().optional(),
})

/** 饮食列表（按日期过滤） */
router.get('/diets', async (req, res, next) => {
  try {
    const date = req.query.date as string | undefined
    let where: { userId: string; eatenAt?: { gte: Date; lt: Date } } = { userId: req.user!.userId }
    if (date) {
      const d = new Date(date)
      const next = new Date(d)
      next.setDate(d.getDate() + 1)
      where.eatenAt = { gte: d, lt: next }
    }
    const diets = await prisma.diet.findMany({
      where,
      orderBy: { eatenAt: 'desc' },
    })
    return success(res, diets)
  } catch (e) {
    next(e)
  }
})

/**
 * 记录饮食
 * - 写入台账：diet.create（自动捕获 ip / userAgent / 耗时）
 */
router.post('/diets', async (req, res, next) => {
  try {
    const parsed = dietSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const data = parsed.data
    const diet = await prisma.diet.create({
      data: {
        userId: req.user!.userId,
        mealType: data.mealType,
        foodName: data.foodName,
        portion: data.portion,
        calories: data.calories,
        protein: data.protein,
        carbs: data.carbs,
        fat: data.fat,
        note: data.note,
        eatenAt: data.eatenAt ? new Date(data.eatenAt) : new Date(),
      },
    })
    auditReq(req, res, {
      category: 'diet',
      action: 'create',
      targetType: 'Diet',
      targetId: diet.id,
      summary: `记录饮食: ${data.mealType} ${data.foodName} (${data.calories || '?'}kcal)`,
      detail: { mealType: data.mealType, foodName: data.foodName, calories: data.calories },
    })
    return success(res, diet, '已记录', 201)
  } catch (e) {
    next(e)
  }
})

/**
 * 删除饮食记录
 * - 写入台账：diet.delete
 */
router.delete('/diets/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.diet.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('记录不存在', 404)
    }
    await prisma.diet.delete({ where: { id } })
    // 删除属关键审计，await 确保日志落库
    await auditReqAsync(req, res, {
      category: 'diet',
      action: 'delete',
      targetType: 'Diet',
      targetId: id,
      summary: `删除饮食记录: ${existing.foodName}`,
    })
    return success(res, null, '已删除')
  } catch (e) {
    next(e)
  }
})

/** 今日健康摘要（基于饮食数据简化） */
router.get('/health/summary', async (req, res, next) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const diets = await prisma.diet.findMany({
      where: { userId: req.user!.userId, eatenAt: { gte: today, lt: tomorrow } },
    })

    const totalCalories = diets.reduce((s, d) => s + (d.calories || 0), 0)
    const totalProtein = diets.reduce((s, d) => s + (d.protein || 0), 0)

    return success(res, {
      date: today.toISOString().slice(0, 10),
      meals: diets.length,
      totalCalories,
      totalProtein: Number(totalProtein.toFixed(1)),
      suggestion: totalCalories < 800 ? '今日摄入偏低，建议补充营养' : '摄入合理',
    })
  } catch (e) {
    next(e)
  }
})

export default router
