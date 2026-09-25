import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authRequired } from '../middleware/auth.js'
import { HttpError } from '../utils/response.js'

const router = Router()
router.use(authRequired)

/* =====================================================
   项目订单账款管理（PM）
   Project / Payment / Receipt / Invoice / Department
   ===================================================== */

// ============ 校验 Schema ============
const createProjectSchema = z.object({
  name:          z.string().min(1, '项目名必填'),
  client:        z.string().min(1, '客户必填'),
  contractNo:    z.string().optional(),
  productType:   z.string().optional(),
  purchaseAmount: z.number().default(0),
  saleAmount:    z.number().default(0),
  note:          z.string().optional(),
  departmentId:  z.string().optional(),
  status:        z.enum(['active', 'done', 'cancelled']).default('active'),
  payments: z.array(z.object({
    date: z.string(), amount: z.number(), note: z.string().optional(),
  })).optional(),
  receipts: z.array(z.object({
    date: z.string(), amount: z.number(), note: z.string().optional(),
  })).optional(),
  invoices: z.array(z.object({
    type: z.enum(['in', 'out']), date: z.string(), amount: z.number(), note: z.string().optional(),
  })).optional(),
})

const updateProjectSchema = createProjectSchema.partial().extend({
  id: z.string(),
})

const recordSchema = z.object({
  date:   z.string(),
  amount: z.number().positive('金额必须大于 0'),
  note:   z.string().optional(),
})

// ============ 工具 ============
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

async function checkProjectOwnership(projectId: string, userId: string) {
  const p = await prisma.project.findUnique({ where: { id: projectId } })
  if (!p) throw new HttpError('项目不存在', 404)
  if (p.userId !== userId) throw new HttpError('无权访问', 403)
  return p
}

// ============ Department（PM 复用） ============
// GET  /api/v1/pm/departments        我的部门
router.get('/departments', async (req, res, next) => {
  try {
    const depts = await prisma.department.findMany({
      where: { leaderId: req.user!.userId },
      orderBy: { name: 'asc' },
    })
    // 再加个"默认部门"兜底
    const fallback = await prisma.department.findFirst({ where: { name: '默认部门' } })
    const list = fallback && !depts.find((d) => d.id === fallback.id)
      ? [fallback, ...depts] : depts
    res.json({ data: list })
  } catch (e) { next(e) }
})

// ============ Project CRUD ============
// GET  /api/v1/pm/projects?departmentId=&status=&search=
router.get('/projects', async (req, res, next) => {
  try {
    const { departmentId, status, search } = req.query as any
    const where: any = { userId: req.user!.userId }
    if (departmentId) where.departmentId = departmentId
    if (status) where.status = status
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { client: { contains: search } },
        { contractNo: { contains: search } },
      ]
    }
    const projects = await prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        payments:  { orderBy: { date: 'asc' } },
        receipts:  { orderBy: { date: 'asc' } },
        invoices:  { orderBy: { date: 'asc' } },
        department: { select: { id: true, name: true } },
      },
    })
    res.json({ data: projects })
  } catch (e) { next(e) }
})

// GET  /api/v1/pm/projects/stats?departmentId=&from=&to=
router.get('/projects/stats', async (req, res, next) => {
  try {
    const { departmentId, from, to } = req.query as any
    const where: any = { userId: req.user!.userId }
    if (departmentId) where.departmentId = departmentId
    const projects = await prisma.project.findMany({ where, include: { payments: true, receipts: true, invoices: true } })

    let totalPurchase = 0, totalSale = 0, totalPaid = 0, totalReceived = 0
    let totalInvIn = 0, totalInvOut = 0
    for (const p of projects) {
      totalPurchase += p.purchaseAmount
      totalSale    += p.saleAmount
      for (const pay of p.payments)    totalPaid      += pay.amount
      for (const rec of p.receipts)    totalReceived  += rec.amount
      for (const inv of p.invoices) {
        if (inv.type === 'in')  totalInvIn  += inv.amount
        if (inv.type === 'out') totalInvOut += inv.amount
      }
    }

    // 按日期区间过滤
    const fromD = from ? new Date(from) : null
    const toD   = to   ? new Date(to)   : null
    let rangePurchase = 0, rangeSale = 0, rangePaid = 0, rangeReceived = 0
    if (fromD || toD) {
      for (const p of projects) {
        const paidIn  = p.payments.filter((x) => (!fromD || x.date >= fromD) && (!toD || x.date <= toD))
        const recvIn  = p.receipts.filter((x) => (!fromD || x.date >= fromD) && (!toD || x.date <= toD))
        rangePaid     += paidIn.reduce((s, x) => s + x.amount, 0)
        rangeReceived += recvIn.reduce((s, x) => s + x.amount, 0)
        // 项目自身金额按 created_at 过滤
        if ((!fromD || p.createdAt >= fromD) && (!toD || p.createdAt <= toD)) {
          rangePurchase += p.purchaseAmount
          rangeSale     += p.saleAmount
        }
      }
    }

    res.json({
      data: {
        projectCount: projects.length,
        totalPurchase: round2(totalPurchase),
        totalSale:     round2(totalSale),
        totalProfit:   round2(totalSale - totalPurchase),
        totalPaid:     round2(totalPaid),       // 采购侧已付款
        totalReceived: round2(totalReceived),   // 销售侧已收款
        totalUnpaid:   round2(totalPurchase - totalPaid),     // 待付
        totalUnrecv:   round2(totalSale     - totalReceived), // 待收
        totalInvIn:    round2(totalInvIn),
        totalInvOut:   round2(totalInvOut),
        range: fromD || toD ? {
          from: fromD?.toISOString() || null,
          to:   toD?.toISOString()   || null,
          purchase: round2(rangePurchase),
          sale:     round2(rangeSale),
          paid:     round2(rangePaid),
          received: round2(rangeReceived),
        } : null,
      },
    })
  } catch (e) { next(e) }
})

// POST /api/v1/pm/projects          新建（含快速收付款/发票行）
router.post('/projects', async (req, res, next) => {
  try {
    const body = createProjectSchema.parse(req.body)
    const { payments, receipts, invoices, ...proj } = body
    const project = await prisma.project.create({
      data: {
        ...proj,
        userId: req.user!.userId,
        payments: payments?.length ? { create: payments.map((p) => ({ date: new Date(p.date), amount: p.amount, note: p.note })) } : undefined,
        receipts: receipts?.length ? { create: receipts.map((r) => ({ date: new Date(r.date), amount: r.amount, note: r.note })) } : undefined,
        invoices: invoices?.length ? { create: invoices.map((i) => ({ type: i.type, date: new Date(i.date), amount: i.amount, note: i.note })) } : undefined,
      },
      include: { payments: true, receipts: true, invoices: true, department: { select: { id: true, name: true } } },
    })
    res.json({ data: project, message: '项目已创建' })
  } catch (e) { next(e) }
})

// GET  /api/v1/pm/projects/:id
router.get('/projects/:id', async (req, res, next) => {
  try {
    await checkProjectOwnership(req.params.id, req.user!.userId)
    const p = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        payments:  { orderBy: { date: 'desc' } },
        receipts:  { orderBy: { date: 'desc' } },
        invoices:  { orderBy: { date: 'desc' } },
        department: { select: { id: true, name: true } },
      },
    })
    res.json({ data: p })
  } catch (e) { next(e) }
})

// PATCH /api/v1/pm/projects/:id
router.patch('/projects/:id', async (req, res, next) => {
  try {
    await checkProjectOwnership(req.params.id, req.user!.userId)
    const { payments, receipts, invoices, ...rest } = updateProjectSchema.parse({ ...req.body, id: req.params.id })
    const p = await prisma.project.update({ where: { id: req.params.id }, data: rest })
    res.json({ data: p, message: '项目已更新' })
  } catch (e) { next(e) }
})

// DELETE /api/v1/pm/projects/:id    级联删 payments/receipts/invoices
router.delete('/projects/:id', async (req, res, next) => {
  try {
    await checkProjectOwnership(req.params.id, req.user!.userId)
    await prisma.project.delete({ where: { id: req.params.id } })
    res.json({ data: null, message: '项目已删除' })
  } catch (e) { next(e) }
})

// DELETE /api/v1/pm/projects/bulk
router.post('/projects/bulk-delete', async (req, res, next) => {
  try {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body)
    await prisma.project.deleteMany({ where: { id: { in: ids }, userId: req.user!.userId } })
    res.json({ data: null, message: `已删除 ${ids.length} 个项目` })
  } catch (e) { next(e) }
})

// ============ Payment / Receipt / Invoice 子资源 ============
// POST /api/v1/pm/projects/:id/payments
router.post('/projects/:id/payments', async (req, res, next) => {
  try {
    await checkProjectOwnership(req.params.id, req.user!.userId)
    const body = recordSchema.parse(req.body)
    const rec = await prisma.payment.create({
      data: { projectId: req.params.id, date: new Date(body.date), amount: body.amount, note: body.note },
    })
    res.json({ data: rec, message: '付款已记录' })
  } catch (e) { next(e) }
})
router.delete('/payments/:rid', async (req, res, next) => {
  try {
    const p = await prisma.payment.findUnique({ where: { id: req.params.rid }, include: { project: true } })
    if (!p) throw new HttpError('记录不存在', 404)
    if (p.project.userId !== req.user!.userId) throw new HttpError('无权访问', 403)
    await prisma.payment.delete({ where: { id: req.params.rid } })
    res.json({ data: null })
  } catch (e) { next(e) }
})

router.post('/projects/:id/receipts', async (req, res, next) => {
  try {
    await checkProjectOwnership(req.params.id, req.user!.userId)
    const body = recordSchema.parse(req.body)
    const rec = await prisma.receipt.create({
      data: { projectId: req.params.id, date: new Date(body.date), amount: body.amount, note: body.note },
    })
    res.json({ data: rec, message: '收款已记录' })
  } catch (e) { next(e) }
})
router.delete('/receipts/:rid', async (req, res, next) => {
  try {
    const p = await prisma.receipt.findUnique({ where: { id: req.params.rid }, include: { project: true } })
    if (!p) throw new HttpError('记录不存在', 404)
    if (p.project.userId !== req.user!.userId) throw new HttpError('无权访问', 403)
    await prisma.receipt.delete({ where: { id: req.params.rid } })
    res.json({ data: null })
  } catch (e) { next(e) }
})

const invoiceSchema = recordSchema.extend({ type: z.enum(['in', 'out']) })
router.post('/projects/:id/invoices', async (req, res, next) => {
  try {
    await checkProjectOwnership(req.params.id, req.user!.userId)
    const body = invoiceSchema.parse(req.body)
    const rec = await prisma.invoice.create({
      data: { projectId: req.params.id, type: body.type, date: new Date(body.date), amount: body.amount, note: body.note },
    })
    res.json({ data: rec, message: '发票已记录' })
  } catch (e) { next(e) }
})
router.delete('/invoices/:rid', async (req, res, next) => {
  try {
    const p = await prisma.invoice.findUnique({ where: { id: req.params.rid }, include: { project: true } })
    if (!p) throw new HttpError('记录不存在', 404)
    if (p.project.userId !== req.user!.userId) throw new HttpError('无权访问', 403)
    await prisma.invoice.delete({ where: { id: req.params.rid } })
    res.json({ data: null })
  } catch (e) { next(e) }
})

export default router

