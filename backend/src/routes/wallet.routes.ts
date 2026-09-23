import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'
import { rateLimit } from '../middleware/rateLimit.js'

const router = Router()
router.use(authRequired)

/**
 * 钱包主页：余额、冻结状态、支付密码是否设置
 * - 首次访问时懒创建空钱包（隐式写操作，需审计）
 */
router.get('/', async (req, res, next) => {
  try {
    let wallet = await prisma.wallet.findUnique({
      where: { userId: req.user!.userId },
    })
    if (!wallet) {
      // upsert 防止并发懒创建 TOCTOU 竞态（两个并发 GET 都会走到这里，upsert 保证只创建一次）
      wallet = await prisma.wallet.upsert({
        where: { userId: req.user!.userId },
        create: { userId: req.user!.userId },
        update: {},
      })
      // 审计：钱包懒创建（仅在实际创建时记录，upsert 的 update 分支不会触发此分支）
      auditReq(req, res, {
        category: 'wallet',
        action: 'auto_create',
        targetType: 'Wallet',
        targetId: wallet.id,
        summary: `首次访问自动创建钱包`,
      })
    }
    return success(res, {
      id: wallet.id,
      balance: wallet.balance,
      frozen: wallet.frozen,
      hasPaymentPwd: !!wallet.paymentPwd,
      newDeviceUntil: wallet.newDeviceUntil,
    })
  } catch (e) {
    next(e)
  }
})

/** 账单流水（支持按类型过滤） */
router.get('/transactions', async (req, res, next) => {
  try {
    const type = req.query.type as string | undefined
    const txns = await prisma.transaction.findMany({
      where: {
        userId: req.user!.userId,
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return success(res, txns)
  } catch (e) {
    next(e)
  }
})

/** 充值 schema */
const rechargeSchema = z.object({
  // 硬约束：单笔充值不超过 5000 元，前后端双重校验防绕过
  amount: z.number().positive().max(5000, '单笔充值上限 5000 元'),
  channel: z.enum(['wechat', 'alipay']).default('wechat'),
})

/**
 * 充值
 * - 事务保证：余额更新 + 流水写入原子完成
 * - 写入台账：wallet.recharge（自动捕获 ip / userAgent / 耗时）
 * - P1-2 修复：按 userId 限流 10 次/分钟，防止高频刷单
 */
// P1-2 修复：按 userId 限流（10 次/分钟）
const walletRateLimit = rateLimit({
  limit: 10,
  windowMs: 60_000,
  keyFn: (req) => `wallet:${req.user?.userId || req.ip}`,
})
router.post('/recharge', walletRateLimit, async (req, res, next) => {
  try {
    const parsed = rechargeSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { amount } = parsed.data

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.userId } })
    if (!wallet) throw new HttpError('钱包不存在', 404)

    // 原子增量更新：用 increment 代替绝对值，防止并发充值 TOCTOU 双花
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } },
      })
      const balanceAfter = Number(updated.balance.toFixed(2))
      const t = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          userId: req.user!.userId,
          type: 'recharge',
          amount,
          balanceAfter,
          title: `充值 ¥${amount}`,
          status: 'success',
        },
      })
      return { wallet: updated, txn: t, balanceAfter }
    })

    // 台账：充值（关键审计，await 确保落库）
    await auditReqAsync(req, res, {
      category: 'wallet',
      action: 'recharge',
      targetType: 'Transaction',
      targetId: result.txn.id,
      summary: `充值 ¥${amount}，余额 ¥${result.balanceAfter.toFixed(2)}`,
      detail: { amount, channel: parsed.data.channel, balanceAfter: result.balanceAfter },
    })

    return success(res, {
      balance: result.wallet.balance,
      transaction: result.txn,
    }, '充值成功')
  } catch (e) {
    next(e)
  }
})

/** 消费 schema */
// P1-9 修复：消费金额上限 5000（与充值一致），防止一次性清空/超大金额
const consumeSchema = z.object({
  amount: z.number().positive().max(5000, '单笔消费上限 5000 元'),
  title: z.string().min(1),
  category: z.string().optional(),
  paymentPwd: z.string().optional(),
})

/**
 * 消费（支付）
 * - 校验余额、冻结状态
 * - P1-9 修复：所有金额均要求支付密码（未设置时引导设置），不再以 50 元为界
 * - 事务保证：余额扣减 + 流水写入原子完成
 * - 写入台账：wallet.consume（含余额、金额、分类）
 */
router.post('/consume', walletRateLimit, async (req, res, next) => {
  try {
    const parsed = consumeSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { amount, title, category, paymentPwd } = parsed.data

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.userId } })
    if (!wallet) throw new HttpError('钱包不存在', 404)
    if (wallet.frozen) throw new HttpError('钱包已冻结，无法消费', 403)
    if (wallet.balance < amount) throw new HttpError('余额不足，请先充值', 400)

    // P1-9 修复：所有消费均需支付密码；未设置时引导设置（拒绝消费）
    if (!wallet.paymentPwd) {
      throw new HttpError('请先设置支付密码后再消费', 403)
    }
    if (!paymentPwd) throw new HttpError('请输入支付密码', 403)
    const ok = await bcrypt.compare(paymentPwd, wallet.paymentPwd)
    if (!ok) throw new HttpError('支付密码错误', 403)

    // 原子条件更新：updateMany where balance >= amount 防止并发消费双花
    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      })
      if (updateResult.count === 0) {
        throw new HttpError('余额不足，请先充值', 400)
      }
      const updated = await tx.wallet.findUnique({ where: { id: wallet.id } })
      const balanceAfter = Number(updated!.balance.toFixed(2))
      const t = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          userId: req.user!.userId,
          type: 'consume',
          amount,
          balanceAfter,
          title,
          category,
          status: 'success',
        },
      })
      return { wallet: updated!, txn: t, balanceAfter }
    })

    // 台账：消费
    auditReq(req, res, {
      category: 'wallet',
      action: 'consume',
      targetType: 'Transaction',
      targetId: result.txn.id,
      summary: `消费 ¥${amount} (${title})，余额 ¥${result.balanceAfter.toFixed(2)}`,
      detail: { amount, title, category, balanceAfter: result.balanceAfter },
    })

    return success(res, {
      balance: result.wallet.balance,
      transaction: result.txn,
    }, '支付成功')
  } catch (e) {
    next(e)
  }
})

/**
 * 设置支付密码
 * - 密码 6 位数字，bcrypt 加盐哈希
 * - 写入台账：wallet.set_pwd
 */
router.post('/payment-pwd', async (req, res, next) => {
  try {
    const pwd = z.string().length(6).safeParse(req.body.paymentPwd)
    if (!pwd.success) throw new HttpError('支付密码必须为6位', 422)
    const hashed = await bcrypt.hash(pwd.data, 10)
    await prisma.wallet.update({
      where: { userId: req.user!.userId },
      data: { paymentPwd: hashed },
    })
    auditReq(req, res, {
      category: 'wallet',
      action: 'set_pwd',
      summary: '设置支付密码',
    })
    return success(res, null, '支付密码已设置')
  } catch (e) {
    next(e)
  }
})

export default router
