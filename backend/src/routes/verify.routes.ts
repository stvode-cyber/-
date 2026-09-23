import { Router } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { rateLimit } from '../middleware/rateLimit.js'

const router = Router()
router.use(authRequired)

const submitSchema = z.object({
  realName: z.string().min(2, '姓名至少 2 个字符').max(30),
  idCard: z.string().regex(/^\d{17}[\dXx]$/, '身份证号格式无效（应为 18 位）'),
  phone: z.string().optional(),
})

/**
 * #5 修复：身份证号哈希存储
 *
 * 原实现：身份证号明文落库（仅 toUpperCase），DB 泄漏即 PII 泄漏。
 * 现实现：sha256(身份证号 + PEPPER) 哈希存储，不可逆。
 * - P2-11 修复：PEPPER 优先从独立的 ID_CARD_PEPPER 环境变量读取；
 *   未配置时回退到从 JWT_SECRET 派生（保持向后兼容）
 * - 展示层（status 接口、审计日志）仅返回脱敏标记，不暴露哈希值
 * - 唯一性校验：可通过哈希值比对防止同一身份证重复提交
 *
 * 注意：轮换 JWT_SECRET 或 ID_CARD_PEPPER 会导致已存哈希无法比对（去重失效），
 * 需重新提交实名认证。生产环境建议配置独立的 ID_CARD_PEPPER。
 */
const ID_CARD_PEPPER = process.env.ID_CARD_PEPPER || crypto
  .createHash('sha256')
  .update('id-card-pepper:' + (process.env.JWT_SECRET || ''))
  .digest('hex')

function hashIdCard(idCard: string): string {
  return crypto
    .createHash('sha256')
    .update(idCard.toUpperCase() + ':' + ID_CARD_PEPPER)
    .digest('hex')
}

/**
 * 身份证号脱敏：保留前 6 后 4，中间用 * 替换
 * 例：110101199001011234 → 110101********1234
 * 仅用于审计日志对原始输入脱敏（数据库中已存哈希，不再需要脱敏）
 */
function maskIdCard(idCard: string): string {
  if (idCard.length !== 18) return '********'
  return idCard.slice(0, 6) + '********' + idCard.slice(-4)
}

/** 查询当前用户认证状态 + 历史记录 */
router.get('/status', async (req, res, next) => {
  try {
    const [user, records] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { verifyLevel: true, username: true, nickname: true, phone: true, email: true },
      }),
      prisma.realName.findMany({
        where: { userId: req.user!.userId },
        orderBy: { submittedAt: 'desc' },
      }),
    ])

    if (!user) throw new HttpError('用户不存在', 404)

    // #5 修复：DB 中存的是哈希值，展示层返回固定脱敏标记（不暴露哈希）
    const maskedRecords = records.map((r) => ({
      ...r,
      idCard: r.idCard && r.idCard.length === 64 ? '已提交' : r.idCard,
    }))

    return success(res, {
      verifyLevel: user.verifyLevel,
      profile: {
        username: user.username,
        nickname: user.nickname,
        phone: user.phone,
        email: user.email,
      },
      records: maskedRecords,
      // 当前是否有 pending 审核中
      hasPending: records.some((r) => r.status === 'pending'),
    })
  } catch (e) {
    next(e)
  }
})

/**
 * 提交实名认证申请
 * - 同一时间只允许一条 pending，若已有 pending 则提示等待审核
 * - 已通过认证（Lv2+）不允许重复提交
 * - 写入台账：verify.submit
 */
// P3 修复：实名认证 PII 接口加频率限制（每用户每分钟 5 次，防滥用/撞库）
const verifyRateLimit = rateLimit({
  limit: 5,
  windowMs: 60_000,
  keyFn: (req) => `verify:${req.user!.userId}`,
})
router.post('/submit', verifyRateLimit, async (req, res, next) => {
  try {
    const parsed = submitSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const data = parsed.data

    // 检查用户当前认证等级
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { verifyLevel: true },
    })
    if (!user) throw new HttpError('用户不存在', 404)
    if (user.verifyLevel !== 'Lv0') {
      throw new HttpError(`当前已认证（${user.verifyLevel}），无需重复提交`, 400)
    }

    // 检查是否已有 pending
    const pending = await prisma.realName.findFirst({
      where: { userId: req.user!.userId, status: 'pending' },
    })
    if (pending) {
      throw new HttpError('已有审核中的认证申请，请等待审核结果', 400)
    }

    const record = await prisma.realName.create({
      data: {
        userId: req.user!.userId,
        realName: data.realName,
        // #5 修复：存 sha256 哈希值（不可逆），不存原文
        idCard: hashIdCard(data.idCard),
        phone: data.phone,
      },
    })

    auditReq(req, res, {
      category: 'verify',
      action: 'submit',
      targetType: 'RealName',
      targetId: record.id,
      summary: `提交实名认证: ${data.realName} (${maskIdCard(data.idCard)})`,
      detail: { realName: data.realName, idCardMasked: maskIdCard(data.idCard) },
    })

    return success(res, record, '已提交，等待审核', 201)
  } catch (e) {
    next(e)
  }
})

export default router
