import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { success, fail, HttpError } from '../utils/response.js'
import { authRequired, adminRequired } from '../middleware/auth.js'
import { auditReq, auditReqAsync } from '../utils/audit.js'
import { safeParseArray, resolveUserIdsByUsername } from '../utils/json.js'
import { describeAgentConfig, writeAgentConfig, reloadAgentConfig } from '../services/agentConfig.js'
import { buildAbStats } from '../services/abStats.js'

// P2-3 修复：统一分页参数解析（pageSize 上限 100，防止全表查询内存耗尽）
function parsePagination(req: { query: Record<string, unknown> }, defaultPageSize = 20) {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || defaultPageSize)))
  if (!Number.isFinite(page) || !Number.isFinite(pageSize) || page < 1 || pageSize < 1) {
    return { page: 1, pageSize: defaultPageSize }
  }
  return { page, pageSize }
}

/**
 * 管理后台路由
 *
 * 鉴权：所有接口都需要登录 + admin 角色（中间件链：authRequired → adminRequired）
 *
 * 路由清单：
 * - GET /admin/dashboard            首页概览（用户数、今日新增、活跃、充值、近7天增长）
 * - GET /admin/users               用户列表（分页 + 搜索）
 * - GET /admin/users/:id           用户详情
 * - PATCH /admin/users/:id         更新用户（角色 / 禁用 / 启用 / 重置密码）
 * - GET /admin/audit-logs          台账列表（用户名/分类/动作/结果/日期范围过滤 + 分页）
 * - GET /admin/audit-logs/stats    台账统计（按分类、动作聚合）
 * - GET /admin/handovers           交接单列表（按用户/状态/日期过滤 + 分页）
 * - GET /admin/community           社区帖子列表（关键词/分类/日期过滤 + 分页）
 * - DELETE /admin/community/:id   删除社区帖子（级联删除评论/点赞/收藏）
 */
const router = Router()
router.use(authRequired, adminRequired)

/**
 * 首页概览
 * - 总用户数、今日新增、今日活跃、今日充值
 * - 最近 7 天每日新增用户趋势
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const sevenDaysAgo = new Date(today)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)

    // 所有统计查询彼此独立，一次性并行执行以减少串行 RTT
    const [
      totalUsers,
      todayNewUsers,
      onlineEstimate,
      transactions,
      recentUsers,
      todayAuditTotal,
      todayAuditFail,
      todayAuditUsers,
      handoverTotal,
      handoverToday,
      handoverDraft,
      handoverSubmitted,
      handoverArchived,
      postTotal,
      postToday,
      commentToday,
      likeToday,
      favoriteToday,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: today } } }),
      prisma.transaction.aggregate({
        where: { type: 'recharge', createdAt: { gte: today } },
        _sum: { amount: true },
      }),
      prisma.user.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { createdAt: true },
      }),
      prisma.auditLog.count({ where: { createdAt: { gte: today } } }),
      prisma.auditLog.count({ where: { createdAt: { gte: today }, result: 'fail' } }),
      prisma.auditLog.findMany({
        where: { createdAt: { gte: today } },
        select: { userId: true },
        distinct: 'userId',
      }),
      prisma.handover.count(),
      prisma.handover.count({ where: { createdAt: { gte: today } } }),
      prisma.handover.count({ where: { status: 'draft' } }),
      prisma.handover.count({ where: { status: 'submitted' } }),
      prisma.handover.count({ where: { status: 'archived' } }),
      prisma.post.count(),
      prisma.post.count({ where: { createdAt: { gte: today } } }),
      prisma.comment.count({ where: { createdAt: { gte: today } } }),
      prisma.postLike.count({ where: { createdAt: { gte: today } } }),
      prisma.postFavorite.count({ where: { createdAt: { gte: today } } }),
    ])

    const todayIncome = transactions._sum.amount || 0

    // 最近7天用户增长
    const dailyNew: { date: string; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const next = new Date(d)
      next.setDate(next.getDate() + 1)
      const count = recentUsers.filter(u => u.createdAt >= d && u.createdAt < next).length
      dailyNew.push({ date: d.toISOString().slice(5, 10), count })
    }

    return success(res, {
      totalUsers,
      todayNewUsers,
      onlineEstimate,
      todayIncome: Number(todayIncome.toFixed(2)),
      dailyNew,
      // 台账统计
      todayAuditTotal,
      todayAuditSuccess: todayAuditTotal - todayAuditFail,
      todayAuditFail,
      todayAuditUsers: todayAuditUsers.filter(u => u.userId).length,
      // 交接单统计
      handoverStats: {
        total: handoverTotal,
        today: handoverToday,
        draft: handoverDraft,
        submitted: handoverSubmitted,
        archived: handoverArchived,
      },
      // 社区统计
      communityStats: {
        postTotal,
        postToday,
        todayInteractions: commentToday + likeToday + favoriteToday,
        commentToday,
        likeToday,
        favoriteToday,
      },
    })
  } catch (e) {
    next(e)
  }
})

/**
 * 用户列表（支持关键词搜索 + 分页）
 */
router.get('/users', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req, 20)
    const keyword = req.query.keyword as string | undefined

    const where = keyword ? {
      OR: [
        { username: { contains: keyword } },
        { nickname: { contains: keyword } },
      ],
    } : {}

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, username: true, nickname: true, role: true,
          onboarded: true, lastLoginAt: true, createdAt: true,
          aiEnabled: true, aiPlan: true, aiExpiresAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ])

    return success(res, { list: users, total, page, pageSize })
  } catch (e) {
    next(e)
  }
})

/**
 * 用户详情
 * - 基础信息 + 业务统计（任务数、账单数、钱包余额）
 */
router.get('/users/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    // user 与 stats 查询彼此独立，并行执行以减少 RTT
    const [user, taskCount, billCount, wallet] = await Promise.all([
      prisma.user.findUnique({
        where: { id },
        select: {
          id: true, username: true, nickname: true, role: true,
          email: true, phone: true, onboarded: true, preferredTone: true,
          primaryGoal: true, lastLoginAt: true, createdAt: true,
          aiEnabled: true, aiPlan: true, aiExpiresAt: true,
        },
      }),
      prisma.task.count({ where: { userId: id } }),
      prisma.bill.count({ where: { userId: id } }),
      prisma.wallet.findUnique({ where: { userId: id } }),
    ])
    if (!user) return fail(res, '用户不存在', 404)

    return success(res, {
      ...user,
      stats: { taskCount, billCount, walletBalance: wallet?.balance || 0 },
    })
  } catch (e) {
    next(e)
  }
})

/** PATCH /users/:id 入参 schema */
const patchUserSchema = z.object({
  role: z.enum(['user', 'admin']).optional(),
  nickname: z.string().min(1).max(30).optional(),
  // 重置密码：明文传入，后端加盐哈希
  // P1-6 修复：与注册一致，至少 8 位且需包含字母+数字
  newPassword: z.string()
    .min(8, '密码至少 8 位')
    .max(32)
    .regex(/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/, '密码需包含字母和数字')
    .optional(),
})

/**
 * 更新用户（管理员操作）
 * - 支持修改角色、昵称、重置密码
 * - 写入台账：admin.user_update（含操作前后字段对比）
 */
router.patch('/users/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const parsed = patchUserSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    }

    const before = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, nickname: true, role: true },
    })
    if (!before) return fail(res, '用户不存在', 404)

    // 防止管理员降级自己（避免失去权限后无人可管）
    if (id === req.user!.userId && parsed.data.role && parsed.data.role !== 'admin') {
      throw new HttpError('不能降级自己的管理员角色', 422)
    }

    const data: { role?: string; nickname?: string; password?: string } = {}
    if (parsed.data.role) data.role = parsed.data.role
    if (parsed.data.nickname) data.nickname = parsed.data.nickname
    if (parsed.data.newPassword) data.password = await bcrypt.hash(parsed.data.newPassword, 10)

    if (Object.keys(data).length === 0) {
      throw new HttpError('未提供任何更新字段', 422)
    }

    const after = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, username: true, nickname: true, role: true },
    })

    // 台账：记录变更前后对比
    auditReq(req, res, {
      category: 'admin',
      action: 'user_update',
      targetType: 'User',
      targetId: id,
      summary: `更新用户 ${before.username}：${Object.keys(data).join(', ')}`,
      detail: {
        before: { nickname: before.nickname, role: before.role },
        after: { nickname: after.nickname, role: after.role },
        resetPassword: !!parsed.data.newPassword,
      },
    })

    return success(res, after, '已更新')
  } catch (e) {
    next(e)
  }
})

/** PATCH /users/:id/ai 入参 schema（订阅控权） */
const patchUserAiSchema = z.object({
  aiEnabled: z.boolean(),
  aiPlan: z.enum(['none', 'basic', 'pro']).optional(),
  aiExpiresAt: z.string().datetime().optional().nullable(),
})

/**
 * 订阅控权（上架激活：控制台手动开通/停用用户的 AI）
 * - 云端 AI 网关按 User.aiEnabled 判权；开通后网关放行，停用后网关 403。
 * - aiPlan / aiExpiresAt 可选，返回中会带出当前值供前端展示。
 * - 写入台账：admin.user_ai_control
 */
router.patch('/users/:id/ai', async (req, res, next) => {
  try {
    const id = req.params.id
    const parsed = patchUserAiSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, aiEnabled: true, aiPlan: true, aiExpiresAt: true },
    })
    if (!user) return fail(res, '用户不存在', 404)

    const data: { aiEnabled: boolean; aiPlan?: string; aiExpiresAt?: Date | null } = {
      aiEnabled: parsed.data.aiEnabled,
    }
    if (parsed.data.aiPlan !== undefined) data.aiPlan = parsed.data.aiPlan
    if (parsed.data.aiExpiresAt !== undefined) {
      data.aiExpiresAt = parsed.data.aiExpiresAt ? new Date(parsed.data.aiExpiresAt) : null
    }

    const after = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, username: true, aiEnabled: true, aiPlan: true, aiExpiresAt: true },
    })

    auditReq(req, res, {
      category: 'admin',
      action: 'user_ai_control',
      targetType: 'User',
      targetId: id,
      summary: `${user.username} AI 权限：${user.aiEnabled ? '开通' : '停用'} → ${parsed.data.aiEnabled ? '开通' : '停用'}`,
      detail: {
        before: { aiEnabled: user.aiEnabled, aiPlan: user.aiPlan, aiExpiresAt: user.aiExpiresAt },
        after: { aiEnabled: after.aiEnabled, aiPlan: after.aiPlan, aiExpiresAt: after.aiExpiresAt },
      },
    })

    return success(res, after, parsed.data.aiEnabled ? '已开通 AI 服务' : '已停用 AI 服务')
  } catch (e) {
    next(e)
  }
})

/**
 * 台账 / 操作日志列表
 * - 支持按 用户ID、用户名（模糊）、分类、动作、结果 过滤
 * - 支持按 日期范围 过滤（startDate / endDate，ISO 字符串）
 * - 支持分页
 */
router.get('/audit-logs', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req, 50)
    const userId = req.query.userId as string | undefined
    const username = req.query.username as string | undefined
    const category = req.query.category as string | undefined
    const action = req.query.action as string | undefined
    const result = req.query.result as string | undefined
    const startDate = req.query.startDate as string | undefined
    const endDate = req.query.endDate as string | undefined

    const where: {
      userId?: string
      username?: { contains: string }
      category?: string
      action?: string
      result?: string
      createdAt?: { gte?: Date; lte?: Date }
    } = {}
    if (userId) where.userId = userId
    if (username) where.username = { contains: username }
    if (category) where.category = category
    if (action) where.action = action
    if (result) where.result = result
    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) where.createdAt.gte = new Date(startDate)
      if (endDate) where.createdAt.lte = new Date(endDate)
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ])

    return success(res, { list: logs, total, page, pageSize })
  } catch (e) {
    next(e)
  }
})

/**
 * 台账统计：按分类 + 动作聚合
 * - 用于审计看板的饼图/柱状图
 */
router.get('/audit-logs/stats', async (req, res, next) => {
  try {
    // P2 修复：days 上限 90，防止拉取过多数据
    const days = Math.min(Number(req.query.days) || 7, 90)
    const since = new Date()
    since.setDate(since.getDate() - days)

    // P2 修复：库侧 groupBy 聚合，替代 findMany 全量拉取应用层聚合
    const groups = await prisma.auditLog.groupBy({
      by: ['category', 'action', 'result'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    })

    // 按分类聚合
    const byCategory: Record<string, number> = {}
    const byAction: Record<string, number> = {}
    let okCount = 0
    let failCount = 0
    let total = 0
    for (const g of groups) {
      const n = g._count._all
      total += n
      byCategory[g.category] = (byCategory[g.category] || 0) + n
      byAction[`${g.category}.${g.action}`] = (byAction[`${g.category}.${g.action}`] || 0) + n
      if (g.result === 'success') okCount += n
      else failCount += n
    }

    return success(res, {
      days,
      total,
      success: okCount,
      fail: failCount,
      byCategory,
      byAction,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * 交接单列表（管理员视角）
 * - 支持按 用户ID、用户名（模糊）、状态、日期范围 过滤
 * - 支持分页
 * - 仅查询，不提供写入（管理员不应代用户编辑交接单）
 */
router.get('/handovers', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req, 20)
    const userId = req.query.userId as string | undefined
    const username = req.query.username as string | undefined
    const status = req.query.status as string | undefined
    const startDate = req.query.startDate as string | undefined
    const endDate = req.query.endDate as string | undefined

    // username 模糊匹配：先查 User 表得到 userId 列表（抽取到 utils/json.ts 共享）
    const usernameFilter = await resolveUserIdsByUsername(username)

    // 拼装最终 where：
    // - userId 优先（精确匹配）；否则用 username 匹配到的 userId 列表
    // - 状态、日期范围为附加过滤条件
    const finalWhere: {
      userId?: string | { in: string[] }
      status?: string
      handoverDate?: { gte?: Date; lte?: Date }
    } = {}
    if (userId) finalWhere.userId = userId
    else if (usernameFilter) finalWhere.userId = { in: usernameFilter }
    if (status) finalWhere.status = status
    if (startDate || endDate) {
      finalWhere.handoverDate = {}
      if (startDate) finalWhere.handoverDate.gte = new Date(startDate)
      if (endDate) finalWhere.handoverDate.lte = new Date(endDate)
    }

    const [list, total] = await Promise.all([
      prisma.handover.findMany({
        where: finalWhere,
        include: {
          user: {
            select: { id: true, username: true, nickname: true },
          },
        },
        orderBy: [{ handoverDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.handover.count({ where: finalWhere }),
    ])

    // 反序列化 JSON 字段，便于前端直接使用
    const parsed = list.map((h) => ({
      ...h,
      completedItems: h.completedItems ? safeParseArray(h.completedItems) : [],
      pendingItems: h.pendingItems ? safeParseArray(h.pendingItems) : [],
    }))

    return success(res, { list: parsed, total, page, pageSize })
  } catch (e) {
    next(e)
  }
})

/**
 * 社区帖子列表（管理员视角）
 * - 支持按 关键词（内容模糊）、用户名（模糊）、分类、日期范围 过滤
 * - 支持分页
 * - 附带作者信息与互动统计，便于内容审核
 */
router.get('/community', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req, 20)
    const keyword = req.query.keyword as string | undefined
    const username = req.query.username as string | undefined
    const category = req.query.category as string | undefined
    const startDate = req.query.startDate as string | undefined
    const endDate = req.query.endDate as string | undefined

    // username 模糊匹配：抽取到 utils/json.ts 共享
    const userIds = await resolveUserIdsByUsername(username)

    const where: {
      content?: { contains: string }
      userId?: { in: string[] }
      category?: string
      createdAt?: { gte?: Date; lte?: Date }
    } = {}
    if (keyword) where.content = { contains: keyword }
    if (userIds) where.userId = { in: userIds }
    if (category) where.category = category
    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) where.createdAt.gte = new Date(startDate)
      if (endDate) where.createdAt.lte = new Date(endDate)
    }

    const [list, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          user: {
            select: { id: true, username: true, nickname: true, avatar: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.post.count({ where }),
    ])

    return success(res, { list, total, page, pageSize })
  } catch (e) {
    next(e)
  }
})

/**
 * 删除社区帖子（管理员内容审核操作）
 * - Prisma 关系均配置 onDelete: Cascade，删除帖子将级联清理评论/点赞/收藏
 * - 写入台账：admin.community_delete
 */
router.delete('/community/:id', async (req, res, next) => {
  try {
    const id = req.params.id

    const post = await prisma.post.findUnique({
      where: { id },
      select: {
        id: true,
        content: true,
        category: true,
        userId: true,
        likesCount: true,
        commentsCount: true,
        favoritesCount: true,
      },
    })
    if (!post) return fail(res, '帖子不存在', 404)

    await prisma.post.delete({ where: { id } })

    // 管理员删除帖子属关键审计，await 确保日志落库
    await auditReqAsync(req, res, {
      category: 'admin',
      action: 'community_delete',
      targetType: 'Post',
      targetId: id,
      summary: `删除社区帖子: ${post.content.slice(0, 50)}`,
      detail: {
        postUserId: post.userId,
        category: post.category,
        stats: {
          likes: post.likesCount,
          comments: post.commentsCount,
          favorites: post.favoritesCount,
        },
      },
    })

    return success(res, null, '帖子已删除')
  } catch (e) {
    next(e)
  }
})

/**
 * 实名认证审核列表（AD-07）
 * - 支持 status 筛选：pending | approved | rejected | all
 * - 写入台账：admin.verify_list
 */
router.get('/verifications', async (req, res, next) => {
  try {
    const status = (req.query.status as string) || 'pending'
    const where: { status?: string } = {}
    if (status !== 'all') where.status = status

    const records = await prisma.realName.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: 100,
      include: {
        user: {
          select: { id: true, username: true, nickname: true, avatar: true },
        },
      },
    })

    // 脱敏身份证号
    const masked = records.map((r) => ({
      ...r,
      idCard: r.idCard.length === 18 ? r.idCard.slice(0, 6) + '********' + r.idCard.slice(-4) : r.idCard,
    }))

    return success(res, masked)
  } catch (e) {
    next(e)
  }
})

const reviewSchema = z.object({
  // approved | rejected
  decision: z.enum(['approved', 'rejected']),
  rejectReason: z.string().optional(),
})

/**
 * 审核实名认证（AD-07）
 * - approved：将 RealName.status 置为 approved，User.verifyLevel 提升至 Lv2
 * - rejected：将 RealName.status 置为 rejected，记录驳回原因
 * - 写入台账：admin.verify_review
 */
router.patch('/verifications/:id', async (req, res, next) => {
  try {
    const parsed = reviewSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const { decision, rejectReason } = parsed.data
    const id = req.params.id

    const record = await prisma.realName.findUnique({ where: { id } })
    if (!record) throw new HttpError('认证记录不存在', 404)
    if (record.status !== 'pending') {
      throw new HttpError(`该申请已处理（${record.status}），无法重复审核`, 400)
    }

    const reviewedAt = new Date()
    if (decision === 'approved') {
      // 并行：更新认证记录 + 提升用户等级
      const [updated] = await Promise.all([
        prisma.realName.update({
          where: { id },
          data: {
            status: 'approved',
            reviewerId: req.user!.userId,
            reviewedAt,
          },
        }),
        prisma.user.update({
          where: { id: record.userId },
          data: { verifyLevel: 'Lv2' },
        }),
      ])
      await auditReqAsync(req, res, {
        category: 'admin',
        action: 'verify_review',
        targetType: 'RealName',
        targetId: id,
        summary: `通过实名认证: ${record.realName}`,
        detail: { decision, userId: record.userId, reviewerId: req.user!.userId },
      })
      return success(res, updated, '已通过，用户等级提升至 Lv2')
    } else {
      // rejected
      const updated = await prisma.realName.update({
        where: { id },
        data: {
          status: 'rejected',
          reviewerId: req.user!.userId,
          reviewedAt,
          rejectReason: rejectReason || '未提供',
        },
      })
      await auditReqAsync(req, res, {
        category: 'admin',
        action: 'verify_review',
        targetType: 'RealName',
        targetId: id,
        summary: `驳回实名认证: ${record.realName}`,
        detail: { decision, userId: record.userId, reviewerId: req.user!.userId, rejectReason },
      })
      return success(res, updated, '已驳回')
    }
  } catch (e) {
    next(e)
  }
})

// ============================================================
// Agent 运营配置（P4）
// - GET  /admin/agent-config   获取当前配置 + 文件信息
// - PUT  /admin/agent-config   更新配置（校验 → 原子写入 → 热更）
// - POST /admin/agent-config/reload  强制重读文件
// ============================================================

router.get('/agent-config', (req, res, next) => {
  try {
    const info = describeAgentConfig()
    return success(res, info, 'Agent 配置')
  } catch (e) {
    next(e)
  }
})

router.put('/agent-config', (req, res, next) => {
  try {
    const updated = writeAgentConfig(req.body)
    // 注：dist 既有调用形式为 auditReq(req, 'action', detail)——res 位传 action 串。
    // 运行时 buildInput 仅读 res.locals?.startTime，字符串安全；保留以维持 dist 等价
    ;(auditReq as unknown as (...a: unknown[]) => void)(req, 'admin.agent-config.update', { personaPromptLength: (updated.personaPrompt || '').length })
    return success(res, updated, '配置已更新')
  } catch (e) {
    return fail(res, (e as Error).message || '配置更新失败', 400)
  }
})

router.post('/agent-config/reload', (req, res, next) => {
  try {
    const result = reloadAgentConfig()
    // 注：dist 既有调用形式 auditReq(req, 'action', result)——res 位传 action 串。保留以维持等价
    ;(auditReq as unknown as (...a: unknown[]) => void)(req, 'admin.agent-config.reload', result)
    return success(res, result, '配置已重载')
  } catch (e) {
    next(e)
  }
})

/**
 * GET /admin/ab-stats
 * A/B 语料池效果统计（P4+）：返回近 N 天双桶曝光/回复率/活跃/记账/待办完成指标
 * - query days：统计窗口天数，默认 14，上限 90
 */
router.get('/ab-stats', async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, Math.floor(Number(req.query.days) || 14)))
    const stats = await buildAbStats(days)
    return success(res, stats)
  } catch (e) {
    next(e)
  }
})

export default router
