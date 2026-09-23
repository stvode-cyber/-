import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { getAgentCore } from '../services/agentCore.js'
import { auditReq } from '../utils/audit.js'
import { collectUserContext } from '../services/contextCollector.js'
import { analyzeWithContext, generateProactiveInsight } from '../services/contextAnalyzer.js'
import { checkLLMStatus, getLLMConfigSummary } from '../services/llmService.js'
import { extractVaultMemory } from '../services/vaultService.js'
import { sendGreetingToUser } from '../utils/morningGreeting.lib.js'

const router = Router()
router.use(authRequired)

/** DG-02 多模态消息单条数据上限（base64 字符数）：图片 5MB / 文件 5MB / 位置无附件 */
const MAX_MEDIA_BASE64_SIZE = 5 * 1024 * 1024

/** 多模态消息发送速率限制：每用户每分钟最多 10 次（含 base64 上传，防滥用） */
const multimodalRateLimit = rateLimit({
  limit: 10,
  windowMs: 60_000,
  keyFn: (req) => `mm:${req.user!.userId}`,
})

/**
 * DG-02 多模态消息发送 schema
 * - image:    content=描述/caption, mediaUrl=data URL, metadata={width,height}
 * - file:     content=文件名,        mediaUrl=data URL, metadata={fileName,fileSize,fileType}
 * - location: content=地址文本,      mediaUrl=null,      metadata={lat,lng,address}
 */
const multimodalSchema = z.object({
  messageType: z.enum(['image', 'file', 'location']),
  content: z.string().max(500).optional(),
  mediaUrl: z.string().max(MAX_MEDIA_BASE64_SIZE).optional(),
  metadata: z.record(z.unknown()).optional(),
})

/** 会话列表 */
router.get('/sessions', async (req, res, next) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      where: { userId: req.user!.userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { _count: { select: { messages: true } } },
    })
    return success(res, sessions)
  } catch (e) {
    next(e)
  }
})

/**
 * 创建会话
 * - 写入台账：chat.session_create
 */
router.post('/sessions', async (req, res, next) => {
  try {
    const session = await prisma.chatSession.create({
      data: {
        userId: req.user!.userId,
        title: req.body.title || '新对话',
      },
    })
    auditReq(req, res, {
      category: 'chat',
      action: 'session_create',
      targetType: 'ChatSession',
      targetId: session.id,
      summary: `创建对话: ${session.title}`,
    })
    return success(res, session, '已创建', 201)
  } catch (e) {
    next(e)
  }
})

/** 会话消息列表
 * P2 修复：游标分页，防止长会话一次返回数十 MB
 * - limit：单页条数，默认 100，上限 200
 * - cursor：上一页最早消息的 id，加载更早历史
 * - 返回升序数组（兼容前端），X-Has-More 响应头标识是否还有更早消息
 */
router.get('/sessions/:id/messages', async (req, res, next) => {
  try {
    const id = req.params.id
    const session = await prisma.chatSession.findUnique({ where: { id } })
    if (!session || session.userId !== req.user!.userId) {
      throw new HttpError('会话不存在', 404)
    }
    const limit = Math.min(Number(req.query.limit) || 100, 200)
    const cursor = (req.query.cursor as string) || undefined
    const rows = await prisma.message.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    const hasMore = rows.length > limit
    const items = (hasMore ? rows.slice(0, -1) : rows).reverse()
    res.setHeader('X-Has-More', hasMore ? '1' : '0')
    return success(res, items)
  } catch (e) {
    next(e)
  }
})

/**
 * 发送消息（同步返回AI回复）
 * - 保存用户消息
 * - 调用 generateReply 生成 AI 回复（基于规则）
 * - 写入台账：chat.message_send（含 messageType）
 */
router.post('/sessions/:id/messages', async (req, res, next) => {
  try {
    const id = req.params.id
    const session = await prisma.chatSession.findUnique({ where: { id } })
    if (!session || session.userId !== req.user!.userId) {
      throw new HttpError('会话不存在', 404)
    }
    const content = (req.body.content || '').toString().trim()
    if (!content) throw new HttpError('消息不能为空', 422)

    // v5: 表情包消息 — 用户发送贴纸表情
    const clientMessageType = (req.body.messageType || '').toString().trim()
    const clientMediaUrl = (req.body.mediaUrl || '').toString().trim()

    if (clientMessageType === 'sticker' && clientMediaUrl) {
      // 保存用户贴纸消息
      const userMsg = await prisma.message.create({
        data: {
          sessionId: id,
          userId: req.user!.userId,
          role: 'user',
          content,
          messageType: 'sticker',
          mediaUrl: clientMediaUrl,
        },
      })

      await prisma.chatSession.update({ where: { id }, data: { updatedAt: new Date() } })

      // 台账
      auditReq(req, res, {
        category: 'chat',
        action: 'sticker_send',
        targetType: 'Message',
        targetId: userMsg.id,
        summary: `表情包: ${content}`,
        detail: { sticker: content, mediaUrl: clientMediaUrl },
      })

      // 表情包不需要 AI 回复，直接返回用户消息
      res.json({
        code: 200,
        data: userMsg,
        message: '表情包已发送',
      })
      return
    }

    // 保存用户消息
    await prisma.message.create({
      data: { sessionId: id, userId: req.user!.userId, role: 'user', content },
    })

    // 生成 AI 回复：AgentCore 统一入口
    // （危机检测 / 办公文档 / 记账快路 / 任务对话创建 → fallback generateReply 全能力）
    const agentReply = await getAgentCore().handle({
      userId: req.user!.userId,
      sessionId: id,
      message: { content },
    })
    const reply = agentReply.reply || ''
    const messageType = agentReply.messageType || 'text'
    const metadata = agentReply.metadata
    // AgentCore 模式：proactiveSuggestions/contextSummary 由 AgentCore 内部决定是否合入 metadata，不再单独透传
    const enrichedMetadata = (metadata as Record<string, unknown> | undefined) || {}

    const aiMsg = await prisma.message.create({
      data: {
        sessionId: id,
        userId: req.user!.userId,
        role: 'assistant',
        content: reply,
        messageType,
        metadata: Object.keys(enrichedMetadata).length > 0 ? JSON.stringify(enrichedMetadata) : null,
      },
    })

    await prisma.chatSession.update({ where: { id }, data: { updatedAt: new Date() } })

    // 用户资料库（AI 记忆）：对话后异步提炼值得记住的用户信息（fire-and-forget，不阻塞回复）
    extractVaultMemory(req.user!.userId, content, reply).catch(() => { /* 静默失败 */ })

    // 台账：发送消息
    auditReq(req, res, {
      category: 'chat',
      action: 'message_send',
      targetType: 'Message',
      targetId: aiMsg.id,
      summary: `对话: ${content.slice(0, 30)} → ${messageType}`,
      detail: { userMsg: content, aiMessageType: messageType, hasContext: false /* AgentCore 模式下 context 已合入 metadata */ },
    })

    // 对话式任务创建：审计到 task 类别，记录任务和提醒详情
    if (messageType === 'task_created_card') {
      const taskMeta = (metadata as Record<string, unknown> | undefined)?.actionResult as { task?: { id: string; title: string; priority: string; dueDate: string | null }; reminder?: { id: string; remindAt: string; reminderMinutes: number } | null } | undefined
      const taskInfo = taskMeta?.task
      const reminderInfo = taskMeta?.reminder
      auditReq(req, res, {
        category: 'task',
        action: 'create_via_chat',
        targetType: 'Task',
        targetId: taskInfo?.id || aiMsg.id,
        summary: `对话创建任务: ${taskInfo?.title || '未知'} (${taskInfo?.priority || 'medium'})`,
        detail: {
          taskId: taskInfo?.id,
          taskTitle: taskInfo?.title,
          taskPriority: taskInfo?.priority,
          taskDueDate: taskInfo?.dueDate,
          reminderId: reminderInfo?.id,
          reminderAt: reminderInfo?.remindAt,
          reminderMinutes: reminderInfo?.reminderMinutes,
          userMessage: content.slice(0, 100),
          sessionId: id,
        },
      })
    }

    // 对话式任务创建（选项卡阶段）：审计待创建任务意图
    if (messageType === 'task_options_card') {
      const pendingTask = ((metadata as Record<string, unknown> | undefined)?.pendingTaskCreation) as { title: string; date: string | null; period: string | null } | undefined
      auditReq(req, res, {
        category: 'task',
        action: 'chat_task_intent',
        targetType: 'Message',
        targetId: aiMsg.id,
        summary: `对话任务意图: ${pendingTask?.title || '未知'} (待确认时间)`,
        detail: {
          pendingTitle: pendingTask?.title,
          pendingDate: pendingTask?.date,
          pendingPeriod: pendingTask?.period,
          userMessage: content.slice(0, 100),
          sessionId: id,
        },
      })
    }

    // DG-16 危机干预信号：单独审计到 crisis 类别，标记高优先级
    // 不记录用户原始消息全文（隐私保护），仅记录触发等级和回复卡片类型
    if (messageType === 'crisis_card') {
      const crisisMeta = metadata as { crisis?: { level?: string } } | undefined
      auditReq(req, res, {
        category: 'crisis',
        action: 'intervention_triggered',
        targetType: 'Message',
        targetId: aiMsg.id,
        summary: `危机干预触发: ${crisisMeta?.crisis?.level || 'unknown'}`,
        detail: {
          level: crisisMeta?.crisis?.level || 'unknown',
          contentLen: content.length,
          // 仅记录前 10 字符用于核对，避免完整隐私暴露
          contentPreview: content.slice(0, 10),
        },
      })
    }

    return success(res, aiMsg, 'success', 201)
  } catch (e) {
    next(e)
  }
})

/**
 * 反馈（like / dislike）
 * - 写入台账：chat.feedback
 */
router.post('/messages/:id/feedback', async (req, res, next) => {
  try {
    const id = req.params.id
    const feedback = req.body.feedback
    if (!['like', 'dislike'].includes(feedback)) {
      throw new HttpError('反馈类型错误', 422)
    }
    const msg = await prisma.message.findUnique({ where: { id } })
    if (!msg || msg.userId !== req.user!.userId) {
      throw new HttpError('消息不存在', 404)
    }
    await prisma.message.update({ where: { id }, data: { feedback } })
    auditReq(req, res, {
      category: 'chat',
      action: 'feedback',
      targetType: 'Message',
      targetId: id,
      summary: `消息反馈: ${feedback}`,
    })
    return success(res, null, '已反馈')
  } catch (e) {
    next(e)
  }
})

/**
 * DG-02 多模态消息发送（图片/文件/位置）
 *
 * 与文本消息端点的差异：
 * - 不走 generateReply（多模态内容超出文本规则匹配能力）
 * - AI 回复固定为"已收到附件"的确认 + 触发后续动作建议
 * - 多模态消息同样审计，category=chat，action=multimodal_send
 *
 * 字段约束：
 * - image:    mediaUrl 必填（data URL），content 可选（描述），metadata 含 width/height
 * - file:     mediaUrl 必填（data URL），content=文件名，metadata 含 fileName/fileSize/fileType
 * - location: mediaUrl 留空，content=地址文本，metadata 含 lat/lng/address
 */
router.post('/sessions/:id/messages/multimodal', multimodalRateLimit, async (req, res, next) => {
  try {
    const id = req.params.id
    const session = await prisma.chatSession.findUnique({ where: { id } })
    if (!session || session.userId !== req.user!.userId) {
      throw new HttpError('会话不存在', 404)
    }

    const body = multimodalSchema.parse(req.body)
    const { messageType, mediaUrl, metadata } = body

    // 各类型校验
    if (messageType === 'image' || messageType === 'file') {
      if (!mediaUrl) throw new HttpError(`${messageType} 消息必须包含 mediaUrl`, 422)
      if (mediaUrl.length > MAX_MEDIA_BASE64_SIZE) {
        throw new HttpError(
          `附件过大（上限 ${Math.floor(MAX_MEDIA_BASE64_SIZE / 1024 / 1024)}MB）`,
          413,
        )
      }
    }
    if (messageType === 'location' && !metadata?.lat && metadata?.lat !== 0) {
      throw new HttpError('位置消息必须包含 lat/lng', 422)
    }

    const content = body.content?.trim() || (messageType === 'image' ? '[图片]' : messageType === 'file' ? '[文件]' : '[位置]')

    // 保存用户多模态消息
    await prisma.message.create({
      data: {
        sessionId: id,
        userId: req.user!.userId,
        role: 'user',
        content,
        messageType,
        mediaUrl: mediaUrl || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    })

    // AI 确认回复（基于类型给出差异化建议）
    const replyMap: Record<string, string> = {
      image: '📷 收到你的图片。你可以告诉我图片内容，我会帮你整理为笔记或转为碎片记录。',
      file: '📎 收到文件。如果需要归档，可以告诉我文件用途，我会建议归档分类或转为碎片。',
      location: '📍 收到你的位置。如果需要在此安排事项，可以让我创建提醒或任务。',
    }
    const reply = replyMap[messageType]
    const aiMsg = await prisma.message.create({
      data: {
        sessionId: id,
        userId: req.user!.userId,
        role: 'assistant',
        content: reply,
        messageType: 'text',
      },
    })

    await prisma.chatSession.update({ where: { id }, data: { updatedAt: new Date() } })

    auditReq(req, res, {
      category: 'chat',
      action: 'multimodal_send',
      targetType: 'Message',
      targetId: aiMsg.id,
      summary: `多模态消息: ${messageType} · ${content.slice(0, 30)}`,
      detail: {
        messageType,
        contentLen: content.length,
        hasMedia: !!mediaUrl,
        mediaSize: mediaUrl ? mediaUrl.length : 0,
      },
    })

    return success(res, aiMsg, '已发送', 201)
  } catch (e) {
    next(e)
  }
})

// ============ v2：上下文感知 API ============

/**
 * GET /chat/context
 * 获取当前用户的自动收集上下文
 *
 * 前端在进入 AI 助理页面时调用，获取全模块状态摘要。
 * 可用于：
 * - 显示上下文状态栏（今日待办/财务/健康概况）
 * - 触发主动洞察建议
 */
router.get('/context', async (req, res, next) => {
  try {
    const sessionId = (req.query.sessionId as string) || undefined
    const ctx = await collectUserContext(req.user!.userId, sessionId)

    auditReq(req, res, {
      category: 'chat',
      action: 'context_collect',
      targetType: 'User',
      targetId: req.user!.userId,
      summary: `上下文收集: ${ctx.summary.slice(0, 50)}`,
      detail: {
        taskPressure: ctx.statusScore.taskPressure,
        overallEnergy: ctx.statusScore.overallEnergy,
        todayPendingCount: ctx.tasks.todayPendingCount,
      },
    })

    return success(res, ctx)
  } catch (e) {
    next(e)
  }
})

/**
 * GET /chat/proactive
 * 获取主动洞察建议
 *
 * 基于当前上下文状态，生成一个"主动问候"或"主动建议"。
 * 前端在用户打开 AI 助理但还没发消息时调用。
 *
 * 返回 null 表示当前状态正常，无需主动干预。
 */
router.get('/proactive', async (req, res, next) => {
  try {
    const sessionId = (req.query.sessionId as string) || undefined
    const ctx = await collectUserContext(req.user!.userId, sessionId)
    const insight = generateProactiveInsight(ctx)

    return success(res, {
      insight,
      contextSummary: ctx.summary,
      statusScore: ctx.statusScore,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /chat/smart-reply
 * 智能回复（上下文感知）
 *
 * 与 POST /sessions/:id/messages 的区别：
 * - smart-reply 不保存消息到数据库，仅返回分析结果
 * - 前端可先调用 smart-reply 预览 AI 回复，再决定是否正式发送
 * - 适用于"输入时实时建议"场景
 *
 * 请求体：
 * - content: 用户输入文本
 * - sessionId: 可选，传入时收集对话历史
 */
const smartReplySchema = z.object({
  content: z.string().min(1).max(5000),
  sessionId: z.string().optional(),
})

router.post('/smart-reply', async (req, res, next) => {
  try {
    const parsed = smartReplySchema.safeParse(req.body)
    if (!parsed.success) {
      throw new HttpError('参数错误', 422)
    }
    const { content, sessionId } = parsed.data

    const ctx = await collectUserContext(req.user!.userId, sessionId)
    const analysis = analyzeWithContext(content, ctx)

    return success(res, {
      intent: analysis.intent,
      confidence: analysis.confidence,
      reply: analysis.reply,
      messageType: analysis.messageType,
      metadata: analysis.metadata,
      proactiveSuggestions: analysis.proactiveSuggestions || [],
      contextSummary: ctx.summary,
      statusScore: ctx.statusScore,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /chat/llm-status
 * 检查 LLM 服务状态
 *
 * 返回当前 LLM 配置和连通性检测结果。
 * 前端可据此显示"AI 模型已连接"或"使用规则模式"标识。
 */
router.get('/llm-status', async (req, res, next) => {
  try {
    const status = await checkLLMStatus()
    const configSummary = getLLMConfigSummary()
    return success(res, { ...status, config: configSummary })
  } catch (e) {
    next(e)
  }
})

/**
 * POST /chat/report-issue
 * 前端检测到 AI 异常时上报（写入审计日志，便于后台排查）
 */
router.post('/report-issue', authRequired, async (req, res, next) => {
  try {
    const { issue, detail, timestamp } = req.body
    // 注：dist 既有调用形式为 auditReq(req, 'action', detail)——res 位传 action 串。
    // 运行时 buildInput 仅读 res.locals?.startTime，字符串安全；保留以维持 dist 等价
    ;(auditReq as unknown as (...a: unknown[]) => void)(req, 'chat.report_issue', {
      issue: issue || 'unknown',
      detail: detail || '',
      timestamp: timestamp || new Date().toISOString(),
    })
    return success(res, { reported: true }, '已收到异常报告')
  } catch (e) {
    next(e)
  }
})

/**
 * POST /chat/morning-greeting
 * 手动触发早安问候（测试用）
 *
 * 立即向当前用户发送一条早安问候消息，用于验证功能无需等到 9:00。
 * 复用 morningGreeting.lib.ts 的 sendGreetingToUser，保证手动/自动逻辑一致。
 */
router.post('/morning-greeting', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true, username: true, preferredTone: true },
    })

    const displayName = user?.nickname || user?.username || '你好'
    const result = await sendGreetingToUser(userId, displayName, user?.preferredTone || 'gentle')

    // 查询今日待办数用于审计摘要
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const todayPendingCount = await prisma.task.count({
      where: {
        userId,
        status: 'todo',
        dueDate: {
          gte: new Date(`${todayStr}T00:00:00`),
          lt: new Date(`${todayStr}T23:59:59`),
        },
      },
    })

    auditReq(req, res, {
      category: 'chat',
      action: 'morning_greeting_manual',
      targetType: 'Message',
      targetId: result.id,
      summary: `手动触发早安问候 (待办${todayPendingCount}项)`,
    })

    return success(res, { id: result.id, content: result.content, sessionId: result.sessionId }, '早安问候已发送', 201)
  } catch (e) {
    next(e)
  }
})

export default router
