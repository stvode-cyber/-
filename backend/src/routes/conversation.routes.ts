import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { sseManager } from '../lib/sse-manager.js'

/**
 * 会话系统路由（微信式好友 / 群聊 / AI 助理统一会话列表）
 *
 * 设计要点：
 * - 每个用户视角独立拥有一份 Conversation 列表（type=ai/user/group）
 * - AI 助理对话沿用 ChatSession/Message（保留 DG-* 卡片能力），Conversation.sessionId 指向 ChatSession
 * - 用户间私聊与群聊消息走 ConversationMessage 表
 * - 备注名（remark）覆盖对方昵称显示，仅 type=user 时有效
 * - 未读数 unreadCount 由接收方拉取消息时累加，发送方写入消息时不动接收方未读数
 *
 * 路由清单：
 * - GET    /conversations                会话列表（按 lastMessageAt 排序，pinned 置顶）
 * - POST   /conversations/ai             确保 AI 助理会话存在（首次进入时调用）
 * - GET    /conversations/:id/messages   会话消息列表（AI 走 Message 表，user/group 走 ConversationMessage）
 * - POST   /conversations/:id/messages   发送消息（user/group 用，AI 用 /chat/sessions/:id/messages）
 * - PATCH  /conversations/:id/read       标记会话已读（清零 unreadCount）
 * - PATCH  /conversations/:id/remark     设置备注名（仅 type=user）
 * - PATCH  /conversations/:id/pin       置顶/取消置顶
 * - PATCH  /conversations/:id/mute      免打扰/取消免打扰
 *
 * 好友管理：
 * - GET    /friends                      好友列表（已接受）
 * - GET    /friends/pending              待处理好友请求
 * - POST   /friends/request              发起好友请求（按 username 搜索）
 * - POST   /friends/:id/accept           接受好友请求
 * - POST   /friends/:id/reject           拒绝好友请求
 * - DELETE /friends/:id                  删除好友
 * - PATCH  /friends/:id/remark           设置好友备注名
 *
 * 群组管理：
 * - POST   /groups                       创建群组（自动加创建者为 owner）
 * - GET    /groups                       我加入的群列表
 * - POST   /groups/:id/members           邀请用户入群
 * - DELETE /groups/:id/members/:userId   退群（自己）/ 踢人（仅 owner/admin）
 * - PATCH  /groups/:id                   更新群信息（名称/头像，仅 owner/admin）
 */

const router = Router()
router.use(authRequired)

// ============ 校验 Schema ============

const sendMessageSchema = z.object({
  content: z.string().min(1, '消息内容不能为空').max(5000, '消息内容不能超过 5000 字'),
  messageType: z.enum(['text', 'image', 'file', 'location', 'app_share']).default('text'),
  mediaUrl: z.string().max(5 * 1024 * 1024, '附件过大（最大 5MB）').optional(),
})

const friendRequestSchema = z.object({
  username: z.string().min(3).max(20),
  remark: z.string().max(30, '备注名不能超过 30 字').optional(),
})

const setRemarkSchema = z.object({
  remark: z.string().max(30, '备注名不能超过 30 字').nullable(),
})

const createGroupSchema = z.object({
  name: z.string().min(1, '群名不能为空').max(50, '群名不能超过 50 字'),
  avatar: z.string().max(2 * 1024 * 1024).optional(),
  memberIds: z.array(z.string()).default([]),
})

const inviteMembersSchema = z.object({
  userIds: z.array(z.string()).min(1, '至少邀请 1 人'),
})

const updateGroupSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  avatar: z.string().max(2 * 1024 * 1024).nullable().optional(),
})

const toggleSchema = z.object({
  value: z.boolean(),
})

// ============ SSE 实时消息推送 ============

router.get('/events', (req, res) => {
  const cleanup = sseManager.addConnection(req.user!.userId, res)
  req.on('close', cleanup)
  req.on('aborted', cleanup)
})

// ============ 辅助：获取当前用户的 AI 会话（自动创建） ============

async function ensureAiConversation(userId: string) {
  // 查找已有 AI 会话
  let conv = await prisma.conversation.findFirst({
    where: { userId, type: 'ai' },
    include: { messages: false },
  })
  if (conv) return conv

  // 没有 AI 会话 → 创建 ChatSession + Conversation
  const session = await prisma.chatSession.create({
    data: { userId, title: 'AI 助理' },
  })
  return prisma.conversation.create({
    data: {
      userId,
      type: 'ai',
      sessionId: session.id,
      pinned: true, // AI 助理默认置顶
    },
  })
}

// ============ 会话列表 ============

/** GET /conversations - 会话列表 */
router.get('/', async (req, res, next) => {
  try {
    // 确保 AI 助理会话存在
    await ensureAiConversation(req.user!.userId)

    const list = await prisma.conversation.findMany({
      where: { userId: req.user!.userId },
      orderBy: [{ pinned: 'desc' }, { lastMessageAt: 'desc' }],
    })

    // 聚合对方信息（type=user 时附带 targetUser 概要）
    const userIds = list
      .filter((c) => c.type === 'user' && c.targetUserId)
      .map((c) => c.targetUserId as string)
    const groupIds = list
      .filter((c) => c.type === 'group' && c.groupId)
      .map((c) => c.groupId as string)

    const [users, groups] = await Promise.all([
      userIds.length
        ? prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true, username: true, nickname: true, avatar: true,
            },
          })
        : Promise.resolve([]),
      groupIds.length
        ? prisma.group.findMany({
            where: { id: { in: groupIds } },
            select: { id: true, name: true, avatar: true },
          })
        : Promise.resolve([]),
    ])

    const userMap = new Map(users.map((u) => [u.id, u]))
    const groupMap = new Map(groups.map((g) => [g.id, g]))

    const result = list.map((c) => {
      const base = {
        id: c.id,
        type: c.type,
        pinned: c.pinned,
        muted: c.muted,
        unreadCount: c.unreadCount,
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview,
        remark: c.remark,
        sessionId: c.sessionId,
        targetUserId: c.targetUserId,
        groupId: c.groupId,
      }
      if (c.type === 'user' && c.targetUserId) {
        const u = userMap.get(c.targetUserId)
        return { ...base, targetUser: u || null }
      }
      if (c.type === 'group' && c.groupId) {
        const g = groupMap.get(c.groupId)
        return { ...base, group: g || null }
      }
      if (c.type === 'ai') {
        return { ...base, targetUser: { id: 'ai', username: 'ai', nickname: 'AI 助理', avatar: '/default-avatar.jpg' } }
      }
      return base
    })

    return success(res, result)
  } catch (e) {
    next(e)
  }
})

/** POST /conversations/ai - 确保 AI 助理会话存在并返回 */
router.post('/ai', async (req, res, next) => {
  try {
    const conv = await ensureAiConversation(req.user!.userId)
    return success(res, conv, 'AI 助理会话已就绪')
  } catch (e) {
    next(e)
  }
})

/** PATCH /conversations/:id/read - 标记已读 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    })
    if (!conv) throw new HttpError('会话不存在', 404)

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { unreadCount: 0 },
    })
    return success(res, { id: conv.id, unreadCount: 0 })
  } catch (e) {
    next(e)
  }
})

/** PATCH /conversations/:id/remark - 设置备注名（仅 type=user 有效） */
router.patch('/:id/remark', async (req, res, next) => {
  try {
    const parsed = setRemarkSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)

    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    })
    if (!conv) throw new HttpError('会话不存在', 404)
    if (conv.type !== 'user') throw new HttpError('仅私聊会话可设置备注名', 400)

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: { remark: parsed.data.remark },
    })

    auditReq(req, res, {
      category: 'chat',
      action: 'set_remark',
      targetType: 'Conversation',
      targetId: conv.id,
      summary: `设置备注名: ${parsed.data.remark || '(清除)'}`,
      detail: { targetUserId: conv.targetUserId, remark: parsed.data.remark },
    })

    return success(res, updated, '备注已更新')
  } catch (e) {
    next(e)
  }
})

/** PATCH /conversations/:id/pin - 置顶切换 */
router.patch('/:id/pin', async (req, res, next) => {
  try {
    const parsed = toggleSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('参数错误', 422)

    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    })
    if (!conv) throw new HttpError('会话不存在', 404)

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: { pinned: parsed.data.value },
    })
    return success(res, updated)
  } catch (e) {
    next(e)
  }
})

/** PATCH /conversations/:id/mute - 免打扰切换 */
router.patch('/:id/mute', async (req, res, next) => {
  try {
    const parsed = toggleSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError('参数错误', 422)

    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    })
    if (!conv) throw new HttpError('会话不存在', 404)

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: { muted: parsed.data.value },
    })
    return success(res, updated)
  } catch (e) {
    next(e)
  }
})

// ============ 会话消息 ============

/** GET /conversations/:id/messages - 消息列表
 * AI 会话：从 Message 表读取（sessionId 关联）
 * user/group 会话：从 ConversationMessage 表读取
 */
router.get('/:id/messages', async (req, res, next) => {
  try {
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    })
    if (!conv) throw new HttpError('会话不存在', 404)

    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const cursor = (req.query.cursor as string) || undefined

    if (conv.type === 'ai' && conv.sessionId) {
      // AI 消息走 Message 表
      const messages = await prisma.message.findMany({
        where: { sessionId: conv.sessionId },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      const hasMore = messages.length > limit
      const items = hasMore ? messages.slice(0, -1) : messages
      return success(res, {
        messages: items.reverse().map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          messageType: m.messageType,
          metadata: m.metadata,
          mediaUrl: m.mediaUrl,
          createdAt: m.createdAt,
        })),
        hasMore,
        nextCursor: hasMore ? items[items.length - 1]?.id : null,
      })
    }

    // user/group 消息走 ConversationMessage 表
    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    const hasMore = messages.length > limit
    const items = hasMore ? messages.slice(0, -1) : messages

    // 群聊时附带发送者概要
    let senderMap: Map<string, { id: string; username: string; nickname: string | null; avatar: string | null }> = new Map()
    if (conv.type === 'group') {
      const senderIds = [...new Set(items.map((m) => m.senderId))]
      if (senderIds.length) {
        const senders = await prisma.user.findMany({
          where: { id: { in: senderIds } },
          select: { id: true, username: true, nickname: true, avatar: true },
        })
        senderMap = new Map(senders.map((u) => [u.id, u]))
      }
    }

    return success(res, {
      messages: items.reverse().map((m) => {
        const sender = conv.type === 'group' ? senderMap.get(m.senderId) : null
        return {
          id: m.id,
          senderId: m.senderId,
          isMe: m.senderId === req.user!.userId,
          sender,
          content: m.content,
          messageType: m.messageType,
          mediaUrl: m.mediaUrl,
          createdAt: m.createdAt,
        }
      }),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    })
  } catch (e) {
    next(e)
  }
})

/** POST /conversations/:id/messages - 发送消息（user/group 用）
 * 注意：AI 会话发消息走 /chat/sessions/:id/messages（保留 DG-* 卡片能力），此处不支持 AI
 */
router.post('/:id/messages', async (req, res, next) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)

    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    })
    if (!conv) throw new HttpError('会话不存在', 404)
    if (conv.type === 'ai') throw new HttpError('AI 会话请走 /chat/sessions/:id/messages', 400)
    if (conv.type === 'user' && !conv.targetUserId) throw new HttpError('私聊会话缺少对方 ID', 400)
    if (conv.type === 'group' && !conv.groupId) throw new HttpError('群聊会话缺少群 ID', 400)

    // 写入消息
    const message = await prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        senderId: req.user!.userId,
        content: parsed.data.content,
        messageType: parsed.data.messageType,
        mediaUrl: parsed.data.mediaUrl || null,
      },
    })

    // 更新当前用户会话的最近消息
    const preview = parsed.data.content.substring(0, 50)
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: message.createdAt, lastMessagePreview: preview },
    })

    // 双向会话：更新对方视角会话（私聊）
    if (conv.type === 'user' && conv.targetUserId) {
      // 找到对方视角的对私聊会话（无则创建）
      let peerConv = await prisma.conversation.findFirst({
        where: { userId: conv.targetUserId, type: 'user', targetUserId: req.user!.userId },
      })
      if (!peerConv) {
        peerConv = await prisma.conversation.create({
          data: {
            userId: conv.targetUserId,
            type: 'user',
            targetUserId: req.user!.userId,
          },
        })
      }
      await prisma.conversation.update({
        where: { id: peerConv.id },
        data: {
          lastMessageAt: message.createdAt,
          lastMessagePreview: preview,
          unreadCount: { increment: 1 },
        },
      })

      // SSE 推送给接收方
      sseManager.pushToUser(conv.targetUserId, 'message', {
        ...message,
        conversationId: peerConv.id,
      })
    }

    // 群聊：为每个群成员视角的会话更新最近消息 + 未读数
    if (conv.type === 'group' && conv.groupId) {
      const members = await prisma.groupMember.findMany({
        where: { groupId: conv.groupId, userId: { not: req.user!.userId } },
      })
      // 为每个成员确保有会话项
      await Promise.all(
        members.map(async (m) => {
          let memConv = await prisma.conversation.findFirst({
            where: { userId: m.userId, type: 'group', groupId: conv.groupId },
          })
          if (!memConv) {
            memConv = await prisma.conversation.create({
              data: { userId: m.userId, type: 'group', groupId: conv.groupId! },
            })
          }
          await prisma.conversation.update({
            where: { id: memConv.id },
            data: {
              lastMessageAt: message.createdAt,
              lastMessagePreview: preview,
              unreadCount: { increment: 1 },
            },
          })

          // SSE 推送给每个群成员
          sseManager.pushToUser(m.userId, 'message', {
            ...message,
            conversationId: memConv.id,
          })
        }),
      )
    }

    // SSE 推送给发送方其他设备（多端同步）
    sseManager.pushToUser(req.user!.userId, 'message', message)

    auditReq(req, res, {
      category: 'chat',
      action: 'send_message',
      targetType: 'Conversation',
      targetId: conv.id,
      summary: `发送${conv.type === 'group' ? '群聊' : '私聊'}消息: ${preview}`,
      detail: { messageType: parsed.data.messageType, contentLen: parsed.data.content.length },
    })

    return success(res, message, '已发送')
  } catch (e) {
    next(e)
  }
})

// ============ 好友管理 ============

/**
 * GET /users/search - 搜索用户（用于添加好友）
 * 普通用户可用，仅返回公开字段，排除自己，限制结果数量防止枚举
 */
router.get('/users/search', async (req, res, next) => {
  try {
    const q = (req.query.q as string || '').trim()
    if (!q) return success(res, [])
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: req.user!.userId } },
          {
            OR: [
              { username: { contains: q } },
              { nickname: { contains: q } },
            ],
          },
        ],
      },
      select: { id: true, username: true, nickname: true, avatar: true },
      take: 10,
    })
    return success(res, users)
  } catch (e) {
    next(e)
  }
})

/** GET /friends - 好友列表（已接受） */
router.get('/friends', async (req, res, next) => {
  try {
    const list = await prisma.friendship.findMany({
      where: { userId: req.user!.userId, status: 'accepted' },
      include: {
        friend: {
          select: { id: true, username: true, nickname: true, avatar: true },
        },
      },
    })
    return success(res, list)
  } catch (e) {
    next(e)
  }
})

/** GET /friends/pending - 待处理好友请求（我是被加方） */
router.get('/friends/pending', async (req, res, next) => {
  try {
    const list = await prisma.friendship.findMany({
      where: { friendId: req.user!.userId, status: 'pending' },
      include: {
        user: {
          select: { id: true, username: true, nickname: true, avatar: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    return success(res, list)
  } catch (e) {
    next(e)
  }
})

/** POST /friends/request - 发起好友请求（按 username 搜索） */
router.post('/friends/request', async (req, res, next) => {
  try {
    const parsed = friendRequestSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)

    const target = await prisma.user.findUnique({ where: { username: parsed.data.username } })
    if (!target) throw new HttpError('用户不存在', 404)
    if (target.id === req.user!.userId) throw new HttpError('不能添加自己为好友', 400)

    // 检查是否已存在好友关系
    const existing = await prisma.friendship.findUnique({
      where: { userId_friendId: { userId: req.user!.userId, friendId: target.id } },
    })
    if (existing) {
      if (existing.status === 'accepted') throw new HttpError('已经是好友', 400)
      if (existing.status === 'pending') throw new HttpError('已发起过请求，待对方同意', 400)
      if (existing.status === 'blocked') throw new HttpError('已拉黑，无法添加', 400)
    }

    // 双向写入：A→B（pending）+ B→A（pending）
    await prisma.$transaction([
      prisma.friendship.create({
        data: {
          userId: req.user!.userId,
          friendId: target.id,
          remark: parsed.data.remark,
          status: 'pending',
        },
      }),
      prisma.friendship.create({
        data: {
          userId: target.id,
          friendId: req.user!.userId,
          status: 'pending',
        },
      }),
    ])

    auditReq(req, res, {
      category: 'chat',
      action: 'friend_request',
      targetType: 'User',
      targetId: target.id,
      summary: `发起好友请求: ${target.username}`,
      detail: { targetUsername: target.username, remark: parsed.data.remark },
    })

    return success(res, { targetUserId: target.id }, '好友请求已发送')
  } catch (e) {
    next(e)
  }
})

/** POST /friends/:id/accept - 接受好友请求 */
router.post('/friends/:id/accept', async (req, res, next) => {
  try {
    // id 是被加方视角的 Friendship.id（friendId = 当前用户）
    const fs = await prisma.friendship.findFirst({
      where: { id: req.params.id, friendId: req.user!.userId, status: 'pending' },
    })
    if (!fs) throw new HttpError('好友请求不存在或已处理', 404)

    // 双向更新为 accepted
    await prisma.$transaction([
      prisma.friendship.update({ where: { id: fs.id }, data: { status: 'accepted' } }),
      prisma.friendship.updateMany({
        where: { userId: fs.friendId, friendId: fs.userId },
        data: { status: 'accepted' },
      }),
    ])

    auditReq(req, res, {
      category: 'chat',
      action: 'friend_accept',
      targetType: 'User',
      targetId: fs.userId,
      summary: `接受好友请求`,
    })

    return success(res, { friendId: fs.userId }, '已添加为好友')
  } catch (e) {
    next(e)
  }
})

/** POST /friends/:id/reject - 拒绝好友请求 */
router.post('/friends/:id/reject', async (req, res, next) => {
  try {
    const fs = await prisma.friendship.findFirst({
      where: { id: req.params.id, friendId: req.user!.userId, status: 'pending' },
    })
    if (!fs) throw new HttpError('好友请求不存在或已处理', 404)

    // 双向删除
    await prisma.$transaction([
      prisma.friendship.delete({ where: { id: fs.id } }),
      prisma.friendship.deleteMany({
        where: { userId: fs.friendId, friendId: fs.userId },
      }),
    ])

    return success(res, { friendId: fs.userId }, '已拒绝')
  } catch (e) {
    next(e)
  }
})

/** DELETE /friends/:id - 删除好友（id 为对方用户 ID） */
router.delete('/friends/:id', async (req, res, next) => {
  try {
    const friendUserId = req.params.id
    // 双向删除
    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId: req.user!.userId, friendId: friendUserId },
          { userId: friendUserId, friendId: req.user!.userId },
        ],
      },
    })

    // 同时删除双方私聊会话
    await prisma.conversation.deleteMany({
      where: {
        type: 'user',
        OR: [
          { userId: req.user!.userId, targetUserId: friendUserId },
          { userId: friendUserId, targetUserId: req.user!.userId },
        ],
      },
    })

    auditReq(req, res, {
      category: 'chat',
      action: 'friend_delete',
      targetType: 'User',
      targetId: friendUserId,
      summary: '删除好友',
    })

    return success(res, { friendId: friendUserId }, '已删除好友')
  } catch (e) {
    next(e)
  }
})

/** PATCH /friends/:id/remark - 设置好友备注名（id 为对方用户 ID） */
router.patch('/friends/:id/remark', async (req, res, next) => {
  try {
    const parsed = setRemarkSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)

    const friendUserId = req.params.id
    const fs = await prisma.friendship.findUnique({
      where: { userId_friendId: { userId: req.user!.userId, friendId: friendUserId } },
    })
    if (!fs) throw new HttpError('非好友关系', 404)

    await prisma.friendship.update({
      where: { id: fs.id },
      data: { remark: parsed.data.remark },
    })

    // 同步更新 Conversation.remark（如果存在私聊会话）
    await prisma.conversation.updateMany({
      where: { userId: req.user!.userId, type: 'user', targetUserId: friendUserId },
      data: { remark: parsed.data.remark },
    })

    return success(res, { friendId: friendUserId, remark: parsed.data.remark }, '备注已更新')
  } catch (e) {
    next(e)
  }
})

/** POST /friends/conversation - 与好友开启私聊会话（id 为好友用户 ID，自动创建会话项） */
router.post('/friends/:id/conversation', async (req, res, next) => {
  try {
    const friendUserId = req.params.id

    // 校验是好友
    const fs = await prisma.friendship.findUnique({
      where: { userId_friendId: { userId: req.user!.userId, friendId: friendUserId } },
    })
    if (!fs || fs.status !== 'accepted') throw new HttpError('非好友关系，无法发起私聊', 400)

    // 找到或创建会话
    let conv = await prisma.conversation.findFirst({
      where: { userId: req.user!.userId, type: 'user', targetUserId: friendUserId },
    })
    if (!conv) {
      conv = await prisma.conversation.create({
        data: {
          userId: req.user!.userId,
          type: 'user',
          targetUserId: friendUserId,
          remark: fs.remark,
        },
      })
    }

    return success(res, conv)
  } catch (e) {
    next(e)
  }
})

// ============ 群组管理 ============

/** POST /groups - 创建群组 */
router.post('/groups', async (req, res, next) => {
  try {
    const parsed = createGroupSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)

    const { name, avatar, memberIds } = parsed.data
    // 创建者 + 至少邀请的成员
    const allMemberIds = [...new Set([req.user!.userId, ...memberIds])]

    const group = await prisma.$transaction(async (tx) => {
      const g = await tx.group.create({
        data: { name, avatar, ownerId: req.user!.userId },
      })
      // 创建群成员
      await tx.groupMember.createMany({
        data: allMemberIds.map((uid) => ({
          groupId: g.id,
          userId: uid,
          role: uid === req.user!.userId ? 'owner' : 'member',
        })),
      })
      // 为每个成员创建会话项
      await tx.conversation.createMany({
        data: allMemberIds.map((uid) => ({
          userId: uid,
          type: 'group',
          groupId: g.id,
        })),
      })
      return g
    })

    auditReq(req, res, {
      category: 'chat',
      action: 'group_create',
      targetType: 'Group',
      targetId: group.id,
      summary: `创建群组: ${name}`,
      detail: { name, memberCount: allMemberIds.length },
    })

    return success(res, group, '群组已创建')
  } catch (e) {
    next(e)
  }
})

/** GET /groups - 我加入的群列表 */
router.get('/groups', async (req, res, next) => {
  try {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user!.userId },
      include: {
        group: {
          select: { id: true, name: true, avatar: true, ownerId: true, createdAt: true },
        },
      },
      orderBy: { joinedAt: 'desc' },
    })
    const result = memberships.map((m) => ({
      id: m.group.id,
      name: m.group.name,
      avatar: m.group.avatar,
      ownerId: m.group.ownerId,
      role: m.role,
      joinedAt: m.joinedAt,
      createdAt: m.group.createdAt,
    }))
    return success(res, result)
  } catch (e) {
    next(e)
  }
})

/** POST /groups/:id/members - 邀请用户入群 */
router.post('/groups/:id/members', async (req, res, next) => {
  try {
    const parsed = inviteMembersSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)

    const groupId = req.params.id
    // 校验当前用户是群成员
    const me = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.user!.userId } },
    })
    if (!me) throw new HttpError('你不是群成员', 403)

    // 校验被邀请用户都是好友（可选：群聊允许非好友，这里允许）
    const newMembers = [...new Set(parsed.data.userIds)].filter((uid) => uid !== req.user!.userId)

    await prisma.$transaction(async (tx) => {
      // 批量加入
      const existing = await tx.groupMember.findMany({
        where: { groupId, userId: { in: newMembers } },
        select: { userId: true },
      })
      const existingSet = new Set(existing.map((m) => m.userId))
      const toAdd = newMembers.filter((uid) => !existingSet.has(uid))

      if (toAdd.length) {
        await tx.groupMember.createMany({
          data: toAdd.map((uid) => ({ groupId, userId: uid, role: 'member' })),
        })
        // 为新成员创建会话项
        await tx.conversation.createMany({
          data: toAdd.map((uid) => ({ userId: uid, type: 'group', groupId })),
        })
      }
    })

    auditReq(req, res, {
      category: 'chat',
      action: 'group_invite',
      targetType: 'Group',
      targetId: groupId,
      summary: `邀请 ${newMembers.length} 人入群`,
      detail: { invitedUserIds: newMembers },
    })

    return success(res, { invitedCount: newMembers.length }, '已邀请入群')
  } catch (e) {
    next(e)
  }
})

/** DELETE /groups/:id/members/:userId - 退群（自己）/ 踢人（仅 owner/admin） */
router.delete('/groups/:id/members/:userId', async (req, res, next) => {
  try {
    const groupId = req.params.id
    const targetUserId = req.params.userId
    const isSelf = targetUserId === req.user!.userId

    // 校验操作权限
    if (!isSelf) {
      const me = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: req.user!.userId } },
      })
      if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
        throw new HttpError('无权踢人（需群主或管理员）', 403)
      }
    }

    // 移除成员
    await prisma.groupMember.deleteMany({
      where: { groupId, userId: targetUserId },
    })
    // 删除该成员的会话项
    await prisma.conversation.deleteMany({
      where: { userId: targetUserId, type: 'group', groupId },
    })

    // 群主退群 → 转让给最早入群的人；若无人则解散群
    if (isSelf) {
      const me = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: req.user!.userId } },
      })
      if (me?.role === 'owner') {
        const earliest = await prisma.groupMember.findFirst({
          where: { groupId },
          orderBy: { joinedAt: 'asc' },
        })
        if (earliest) {
          await prisma.group.update({ where: { id: groupId }, data: { ownerId: earliest.userId } })
          await prisma.groupMember.update({
            where: { id: earliest.id },
            data: { role: 'owner' },
          })
        } else {
          // 无人 → 解散群
          await prisma.group.delete({ where: { id: groupId } })
        }
      }
    }

    auditReq(req, res, {
      category: 'chat',
      action: isSelf ? 'group_leave' : 'group_kick',
      targetType: 'Group',
      targetId: groupId,
      summary: isSelf ? '退出群组' : `移除成员: ${targetUserId}`,
      detail: { targetUserId },
    })

    return success(res, { groupId, targetUserId }, isSelf ? '已退群' : '已移除成员')
  } catch (e) {
    next(e)
  }
})

/** PATCH /groups/:id - 更新群信息（仅 owner/admin） */
router.patch('/groups/:id', async (req, res, next) => {
  try {
    const parsed = updateGroupSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(parsed.error.issues[0]?.message || '参数错误', 422)

    const groupId = req.params.id
    const me = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.user!.userId } },
    })
    if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
      throw new HttpError('无权修改群信息（需群主或管理员）', 403)
    }

    const data: Record<string, unknown> = {}
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.avatar !== undefined) data.avatar = parsed.data.avatar

    if (Object.keys(data).length === 0) throw new HttpError('没有可更新的字段', 422)

    const updated = await prisma.group.update({ where: { id: groupId }, data })

    auditReq(req, res, {
      category: 'chat',
      action: 'group_update',
      targetType: 'Group',
      targetId: groupId,
      summary: `更新群信息: ${Object.keys(data).join(', ')}`,
      detail: data,
    })

    return success(res, updated, '群信息已更新')
  } catch (e) {
    next(e)
  }
})

export default router
