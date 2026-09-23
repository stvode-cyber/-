import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'

/**
 * 社区路由
 *
 * 用途：用户发帖、评论、点赞、收藏，构成社区互动闭环。
 *
 * 帖子分类：life | work | finance，与前端 Tab 一一对应。
 *
 * 审计：所有写操作均通过 auditReq 自动记录台账，category = 'community'。
 *
 * 路由清单：
 * - GET    /community/posts              帖子列表（分页 + tab 过滤 + 分类）
 * - POST   /community/posts              创建帖子
 * - GET    /community/posts/:id          帖子详情
 * - POST   /community/posts/:id/like     点赞
 * - DELETE /community/posts/:id/like     取消点赞
 * - POST   /community/posts/:id/favorite 收藏
 * - DELETE /community/posts/:id/favorite 取消收藏
 * - GET    /community/posts/:id/comments 评论列表
 * - POST   /community/posts/:id/comments 发表评论
 */

const router = Router()
router.use(authRequired)

// ============ 校验 Schema ============

/** 创建帖子 Schema */
const createPostSchema = z.object({
  content: z.string().min(1, '帖子内容不能为空').max(2000, '帖子内容不能超过 2000 字'),
  // QQ空间说说九宫格：最多 9 张 data URL 图片（前端已压缩；单张上限 5MB base64 字符）
  images: z.array(z.string().min(1).max(5 * 1024 * 1024)).max(9).optional(),
  category: z.enum(['life', 'work', 'finance']).default('life'),
  aiSource: z
    .object({
      name: z.string(),
      confidence: z.number().min(0).max(100),
    })
    .optional(),
})

/** 发表评论 Schema */
const createCommentSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(500, '评论内容不能超过 500 字'),
})

// ============ 类型定义 ============

/** 帖子序列化前的最小字段集（与 Prisma include 结果对应） */
interface PostSerializeInput {
  id: string
  content: string
  category: string
  images?: string | null
  aiSource?: string | null
  likesCount: number
  commentsCount: number
  favoritesCount: number
  createdAt: Date
  user: {
    id: string
    username: string
    nickname: string | null
    avatar: string | null
  } | null
  likes?: { userId: string }[]
  favorites?: { userId: string }[]
}

/** 评论序列化前的最小字段集 */
interface CommentSerializeInput {
  id: string
  content: string
  createdAt: Date
  user: {
    id: string
    username: string
    nickname: string | null
    avatar: string | null
  } | null
}

// ============ 工具函数 ============

/**
 * 序列化帖子：解析 aiSource JSON，附带当前用户的点赞/收藏状态
 */
function serializePost(post: PostSerializeInput, currentUserId: string) {
  let aiSource: { name: string; confidence: number } | null = null
  try {
    aiSource = post.aiSource ? JSON.parse(post.aiSource) : null
  } catch {
    aiSource = null
  }
  // 配图九宫格：images 存 JSON 数组字符串
  let images: string[] = []
  try {
    const parsed = post.images ? JSON.parse(post.images) : null
    if (Array.isArray(parsed)) images = parsed.filter((x) => typeof x === 'string')
  } catch {
    images = []
  }
  // 当前用户是否已点赞 / 已收藏
  const liked = (post.likes || []).some((l) => l.userId === currentUserId)
  const favorited = (post.favorites || []).some((f) => f.userId === currentUserId)
  return {
    id: post.id,
    content: post.content,
    category: post.category,
    images,
    aiSource,
    likesCount: post.likesCount,
    commentsCount: post.commentsCount,
    favoritesCount: post.favoritesCount,
    liked,
    favorited,
    createdAt: post.createdAt,
    // 作者信息
    user: post.user
      ? {
          id: post.user.id,
          username: post.user.username,
          nickname: post.user.nickname,
          avatar: post.user.avatar,
        }
      : null,
  }
}

/** 序列化评论 */
function serializeComment(comment: CommentSerializeInput) {
  return {
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt,
    user: comment.user
      ? {
          id: comment.user.id,
          username: comment.user.username,
          nickname: comment.user.nickname,
          avatar: comment.user.avatar,
        }
      : null,
  }
}

// ============ 路由 ============

/**
 * 帖子列表
 * - tab=recommend：按点赞数降序展示全部
 * - tab=companion：按时间降序展示全部（同行者动态）
 * - tab=life|work|finance：按分类过滤，按时间降序
 * - 分页：page + pageSize
 */
router.get('/posts', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(Math.max(1, Number(req.query.pageSize) || 10), 50)
    const tab = (req.query.tab as string) || 'recommend'
    const currentUserId = req.user!.userId

    // 构造查询条件
    const where: { category?: string } = {}
    if (['life', 'work', 'finance'].includes(tab)) {
      where.category = tab
    }

    // 排序：推荐按点赞数降序，其他按时间降序
    const orderBy =
      tab === 'recommend'
        ? [{ likesCount: 'desc' as const }, { createdAt: 'desc' as const }]
        : [{ createdAt: 'desc' as const }]

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          user: { select: { id: true, username: true, nickname: true, avatar: true } },
          likes: { where: { userId: currentUserId }, select: { userId: true } },
          favorites: { where: { userId: currentUserId }, select: { userId: true } },
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.post.count({ where }),
    ])

    return success(res, {
      list: posts.map((p) => serializePost(p, currentUserId)),
      total,
      page,
      pageSize,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * 创建帖子
 */
router.post('/posts', async (req, res, next) => {
  try {
    const parsed = createPostSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)
    const data = parsed.data

    const post = await prisma.post.create({
      data: {
        userId: req.user!.userId,
        content: data.content,
        category: data.category,
        images: data.images?.length ? JSON.stringify(data.images) : null,
        aiSource: data.aiSource ? JSON.stringify(data.aiSource) : null,
      },
      include: {
        user: { select: { id: true, username: true, nickname: true, avatar: true } },
        likes: { where: { userId: req.user!.userId }, select: { userId: true } },
        favorites: { where: { userId: req.user!.userId }, select: { userId: true } },
      },
    })

    auditReq(req, res, {
      category: 'community',
      action: 'create',
      targetType: 'Post',
      targetId: post.id,
      summary: `发布社区帖子: ${data.content.slice(0, 50)}`,
      detail: { category: data.category, contentLength: data.content.length, imageCount: data.images?.length || 0 },
    })

    return success(res, serializePost(post, req.user!.userId), '帖子已发布', 201)
  } catch (e) {
    next(e)
  }
})

/**
 * 帖子详情
 */
router.get('/posts/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const currentUserId = req.user!.userId

    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, nickname: true, avatar: true } },
        likes: { where: { userId: currentUserId }, select: { userId: true } },
        favorites: { where: { userId: currentUserId }, select: { userId: true } },
      },
    })
    if (!post) throw new HttpError('帖子不存在', 404)

    return success(res, serializePost(post, currentUserId))
  } catch (e) {
    next(e)
  }
})

/**
 * 点赞（幂等：已点赞则不重复加）
 */
router.post('/posts/:id/like', async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user!.userId

    // 帖子存在性校验 + 幂等检查 彼此独立，并行执行
    const [post, existing] = await Promise.all([
      prisma.post.findUnique({ where: { id }, select: { id: true } }),
      prisma.postLike.findUnique({
        where: { postId_userId: { postId: id, userId } },
      }),
    ])
    if (!post) throw new HttpError('帖子不存在', 404)

    if (!existing) {
      // 事务保证：like 记录创建 + 计数递增原子完成
      await prisma.$transaction([
        prisma.postLike.create({ data: { postId: id, userId } }),
        prisma.post.update({
          where: { id },
          data: { likesCount: { increment: 1 } },
        }),
      ])
    }

    auditReq(req, res, {
      category: 'community',
      action: 'like',
      targetType: 'Post',
      targetId: id,
      summary: `点赞帖子: ${id}`,
    })

    return success(res, { liked: true }, '已点赞')
  } catch (e) {
    next(e)
  }
})

/**
 * 取消点赞（幂等：未点赞则不报错）
 */
router.delete('/posts/:id/like', async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user!.userId

    const existing = await prisma.postLike.findUnique({
      where: { postId_userId: { postId: id, userId } },
    })
    if (existing) {
      // 事务保证：like 记录删除 + 计数递减原子完成，下界保护防止负数
      await prisma.$transaction([
        prisma.postLike.delete({ where: { id: existing.id } }),
        prisma.post.updateMany({
          where: { id, likesCount: { gt: 0 } },
          data: { likesCount: { decrement: 1 } },
        }),
      ])
    }

    auditReq(req, res, {
      category: 'community',
      action: 'unlike',
      targetType: 'Post',
      targetId: id,
      summary: `取消点赞帖子: ${id}`,
    })

    return success(res, { liked: false }, '已取消点赞')
  } catch (e) {
    next(e)
  }
})

/**
 * 收藏（幂等：已收藏则不重复加）
 */
router.post('/posts/:id/favorite', async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user!.userId

    // 帖子存在性校验 + 幂等检查 彼此独立，并行执行
    const [post, existing] = await Promise.all([
      prisma.post.findUnique({ where: { id }, select: { id: true } }),
      prisma.postFavorite.findUnique({
        where: { postId_userId: { postId: id, userId } },
      }),
    ])
    if (!post) throw new HttpError('帖子不存在', 404)

    if (!existing) {
      // 事务保证：favorite 记录创建 + 计数递增原子完成
      await prisma.$transaction([
        prisma.postFavorite.create({ data: { postId: id, userId } }),
        prisma.post.update({
          where: { id },
          data: { favoritesCount: { increment: 1 } },
        }),
      ])
    }

    auditReq(req, res, {
      category: 'community',
      action: 'favorite',
      targetType: 'Post',
      targetId: id,
      summary: `收藏帖子: ${id}`,
    })

    return success(res, { favorited: true }, '已收藏')
  } catch (e) {
    next(e)
  }
})

/**
 * 取消收藏（幂等）
 */
router.delete('/posts/:id/favorite', async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user!.userId

    const existing = await prisma.postFavorite.findUnique({
      where: { postId_userId: { postId: id, userId } },
    })
    if (existing) {
      // 事务保证：favorite 记录删除 + 计数递减原子完成，下界保护防止负数
      await prisma.$transaction([
        prisma.postFavorite.delete({ where: { id: existing.id } }),
        prisma.post.updateMany({
          where: { id, favoritesCount: { gt: 0 } },
          data: { favoritesCount: { decrement: 1 } },
        }),
      ])
    }

    auditReq(req, res, {
      category: 'community',
      action: 'unfavorite',
      targetType: 'Post',
      targetId: id,
      summary: `取消收藏帖子: ${id}`,
    })

    return success(res, { favorited: false }, '已取消收藏')
  } catch (e) {
    next(e)
  }
})

/**
 * 评论列表（分页）
 */
router.get('/posts/:id/comments', async (req, res, next) => {
  try {
    const { id } = req.params
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(Math.max(1, Number(req.query.pageSize) || 20), 50)

    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where: { postId: id },
        include: {
          user: { select: { id: true, username: true, nickname: true, avatar: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.comment.count({ where: { postId: id } }),
    ])

    return success(res, {
      list: comments.map(serializeComment),
      total,
      page,
      pageSize,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * 发表评论
 */
router.post('/posts/:id/comments', async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user!.userId

    const parsed = createCommentSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)

    // 帖子是否存在
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true } })
    if (!post) throw new HttpError('帖子不存在', 404)

    const comment = await prisma.comment.create({
      data: {
        postId: id,
        userId,
        content: parsed.data.content,
      },
      include: {
        user: { select: { id: true, username: true, nickname: true, avatar: true } },
      },
    })

    // 评论数 +1
    await prisma.post.update({
      where: { id },
      data: { commentsCount: { increment: 1 } },
    })

    auditReq(req, res, {
      category: 'community',
      action: 'comment',
      targetType: 'Post',
      targetId: id,
      summary: `评论帖子: ${parsed.data.content.slice(0, 50)}`,
      detail: { commentId: comment.id, contentLength: parsed.data.content.length },
    })

    return success(res, serializeComment(comment), '评论已发表', 201)
  } catch (e) {
    next(e)
  }
})

export default router
