import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'
import { classifyBillCategory } from '../utils/classify.js'

const router = Router()
router.use(authRequired)

const billSchema = z.object({
  type: z.enum(['income', 'expense']),
  // P2-4 修复：金额上限 1 亿，防止 Float 精度丢失/前端渲染异常
  amount: z.number().positive().max(100000000, '金额超出上限'),
  // category 可选：未传或传 'auto' 时后端根据标题自动分类（阶段二功能）
  category: z.string().optional(),
  account: z.string().optional(),
  title: z.string().min(1),
  note: z.string().optional(),
  billDate: z.string().optional(),
})

/**
 * 账单列表（按类型/分类/月份过滤）
 * - month 格式：YYYY-MM（如 2026-08），传入后只返回该月账单
 */
router.get('/bills', async (req, res, next) => {
  try {
    const type = req.query.type as string | undefined
    const category = req.query.category as string | undefined
    const month = req.query.month as string | undefined

    const where: {
      userId: string
      type?: string
      category?: string
      billDate?: { gte: Date; lt: Date }
    } = {
      userId: req.user!.userId,
      ...(type ? { type } : {}),
      ...(category ? { category } : {}),
    }

    // 月份过滤：YYYY-MM → [月初, 下月初)
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const start = new Date(`${month}-01T00:00:00`)
      const end = new Date(start)
      end.setMonth(end.getMonth() + 1)
      where.billDate = { gte: start, lt: end }
    }

    const bills = await prisma.bill.findMany({
      where,
      orderBy: { billDate: 'desc' },
      take: 200,
    })
    return success(res, bills)
  } catch (e) {
    next(e)
  }
})

/**
 * 记账
 * - 写入台账：bill.create（自动捕获 ip / userAgent / 耗时）
 */
router.post('/bills', async (req, res, next) => {
  try {
    const parsed = billSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const data = parsed.data
    // 自动分类：用户未传 category 或传 'auto' 时，根据标题推断分类
    const category = data.category && data.category !== 'auto'
      ? data.category
      : classifyBillCategory(data.title, data.type)
    const bill = await prisma.bill.create({
      data: {
        userId: req.user!.userId,
        type: data.type,
        amount: data.amount,
        category,
        account: data.account,
        title: data.title,
        note: data.note,
        billDate: data.billDate ? new Date(data.billDate) : new Date(),
      },
    })
    auditReq(req, res, {
      category: 'bill',
      action: 'create',
      targetType: 'Bill',
      targetId: bill.id,
      summary: `记账: ${data.type === 'expense' ? '-' : '+'}¥${data.amount} (${bill.title})`,
      detail: { type: data.type, amount: data.amount, category, title: data.title, autoClassified: !data.category || data.category === 'auto' },
    })
    return success(res, bill, '已记录', 201)
  } catch (e) {
    next(e)
  }
})

/**
 * 删除账单
 * - 写入台账：bill.delete
 */
router.delete('/bills/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const existing = await prisma.bill.findUnique({ where: { id } })
    if (!existing || existing.userId !== req.user!.userId) {
      throw new HttpError('账单不存在', 404)
    }
    await prisma.bill.delete({ where: { id } })
    // 删除属关键审计，await 确保日志落库
    await auditReqAsync(req, res, {
      category: 'bill',
      action: 'delete',
      targetType: 'Bill',
      targetId: id,
      summary: `删除账单: ${existing.title}`,
    })
    return success(res, null, '已删除')
  } catch (e) {
    next(e)
  }
})

/** 月度统计：收入/支出/结余/分类聚合 */
router.get('/summary/monthly', async (req, res, next) => {
  try {
    const month = req.query.month as string || new Date().toISOString().slice(0, 7)
    const start = new Date(`${month}-01T00:00:00`)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)

    const bills = await prisma.bill.findMany({
      where: {
        userId: req.user!.userId,
        billDate: { gte: start, lt: end },
      },
    })

    const income = bills.filter(b => b.type === 'income').reduce((s, b) => s + b.amount, 0)
    const expense = bills.filter(b => b.type === 'expense').reduce((s, b) => s + b.amount, 0)

    // 按类别聚合
    const byCategory: Record<string, number> = {}
    bills.filter(b => b.type === 'expense').forEach(b => {
      byCategory[b.category] = (byCategory[b.category] || 0) + b.amount
    })

    return success(res, {
      month,
      income: Number(income.toFixed(2)),
      expense: Number(expense.toFixed(2)),
      balance: Number((income - expense).toFixed(2)),
      byCategory,
      count: bills.length,
    })
  } catch (e) {
    next(e)
  }
})

export default router
