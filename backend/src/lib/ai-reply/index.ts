import { prisma } from '../prisma.js'
import { classifyBillCategory } from '../../utils/classify.js'
import { collectUserContext, type UserContext } from '../../services/contextCollector.js'
import { analyzeWithContext, generateProactiveInsight } from '../../services/contextAnalyzer.js'
import { llmChatWithContext, llmGenerateChat, type ChatMessage } from '../../services/llmService.js'
import { parseAction, stripActionTag, executeAction } from '../../services/conversationActionService.js'
import { extractAndSaveHabits } from '../../services/habitService.js'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * AI 回复生成（上下文感知 + 规则匹配）
 *
 * v2 增强：自动收集全模块上下文，生成上下文感知的智能回复。
 * 上下文收集在 generateReply 内部自动完成（若未外部传入）。
 *
 * 支持的回复类型：
 * - text：纯文本回复
 * - task_card：任务卡（含今日待办列表，前端可一键完成）
 * - bill_card：账单卡（含本月财务统计，前端可一键入账）
 * - diet_card：饮食卡（含今日饮食摘要，前端可跳转记录页）
 * - handover_card：交接卡（聚合今日任务/账单/饮食，前端可一键创建交接单）
 * - suggestion：建议卡（含 AI 建议文案）
 * - schedule_card：时段规划卡（DG-06 实时规划，含时段块数组）
 * - fragment_card：碎片卡（DG-07，今日碎片列表）
 * - digest_card：隔夜整合卡（DG-08，今日碎片结构化总结）
 * - connections_card：跨信息关联卡（DG-09，碎片间关联发现）
 * - insights_card：跨模块洞察卡（DG-09，碎片↔任务/账单关联检测）
 * - preparation_card：智能准备卡（EV-04，重要事件准备清单）
 * - crisis_card：危机干预卡（DG-16）
 * - context_card：上下文感知卡（v2，含全模块上下文摘要）
 *
 * 匹配规则：
 * - 上下文感知优先：先收集全模块上下文 → 识别意图 → 引用上下文数据回复
 * - 规则匹配兜底：未匹配明确意图时走原有关键词匹配
 * - 碎片存储默认：未匹配任何规则时存储为碎片
 */
export interface ReplyResult {
  reply: string
  messageType: 'text' | 'task_card' | 'bill_card' | 'diet_card' | 'handover_card' | 'suggestion' | 'schedule_card' | 'fragment_card' | 'digest_card' | 'connections_card' | 'insights_card' | 'preparation_card' | 'crisis_card' | 'context_card' | 'task_created_card' | 'task_options_card'
  metadata?: unknown
  /** v2：主动建议（基于上下文状态） */
  proactiveSuggestions?: string[]
  /** v2：上下文摘要（供前端展示） */
  contextSummary?: string
}

/**
 * 清理 LLM 回复中重复的关心语
 *
 * 7B 模型经常在回复末尾加"别太累了""记得休息"等，
 * 去掉这些多余的尾巴让回复更自然。
 * 只处理末尾的关心语，不影响回复正文。
 */
function cleanRepetitiveCare(text: string): string {
  // 匹配末尾常见的关心语（含前导标点）
  const carePatterns = [
    /[。，,.\s]*别忘了?太累了[。.]?$/,
    /[。，,.\s]*记得休息一下[。.]?$/,
    /[。，,.\s]*注意休息[。.]?$/,
    /[。，,.\s]*别太累了[，,。.]?\s*记得休息.*$/,
    /[。，,.\s]*写的时候别太累了.*$/,
    /[。，,.\s]*别太拼了[。.]?$/,
  ]
  let cleaned = text
  for (const p of carePatterns) {
    cleaned = cleaned.replace(p, '')
  }
  // 去掉末尾多余的标点和空格
  cleaned = cleaned.replace(/[。，,.\s]+$/, '')
  return cleaned || text
}
// —— 子模块引用（拆文件后新增）——
import { detectCrisisSignal, generateCrisisReply } from './crisis.js'
import { detectTaskCreation } from './task-detect.js'
import {
  generateDigest, generateConnections, generateInsights,
  generatePreparation, generateChecklist, generateSchedule,
  guessMealType, classifyFragment,
} from './generators.js'
export async function generateReply(content: string, userId: string, sessionId?: string): Promise<ReplyResult> {
  const text = content.toLowerCase().trim()

  // 自动提取用户习惯（非阻塞，后台执行，不影响回复速度）
  extractAndSaveHabits(userId, content).catch(err => {
    console.error('[AI-Reply] Habit extraction failed:', err)
  })

  // DG-16 危机信号检测（优先级最高，先于所有匹配）
  const crisisLevel = detectCrisisSignal(content)
  if (crisisLevel) {
    return generateCrisisReply(crisisLevel)
  }

  // v4: 对话式任务创建检测（在上下文收集之前，快速响应）
  try {
    const taskCreation = await detectTaskCreation(content, userId, sessionId)
    if (taskCreation) {
      return taskCreation
    }
  } catch (err) {
    console.error('[AI-Reply] Task creation detection failed:', err)
  }

  // v2/v3：自动收集上下文 → 上下文感知分析 → LLM 增强
  let ctxSummary: string | undefined
  let ctxAnalysis: ReturnType<typeof analyzeWithContext> | undefined
  let ctxData: UserContext | undefined
  try {
    ctxData = await collectUserContext(userId, sessionId, content)
    ctxSummary = ctxData.summary
    ctxAnalysis = analyzeWithContext(content, ctxData)

    // v3：自然对话意图优先走 LLM，生成灵活自然的回复
    // 扩展自然意图范围：查询类/规划类也走 LLM，让回复更个性化（含习惯档案）
    // 仅保留 crisis/record_expense/generate_handover 走规则系统（需要结构化处理）
    const naturalIntents = [
      'chitchat', 'greeting', 'context_aware',
      'query_tasks', 'query_finance', 'query_diet', 'query_sleep',
      'query_countdown', 'query_fragments', 'plan_schedule', 'help',
    ]
    if (naturalIntents.includes(ctxAnalysis.intent)) {
      const history: ChatMessage[] = ctxData.chatHistory.map(m => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      }))
      const llmResult = await llmChatWithContext(content, ctxData, history, ctxData.profile.nickname)
      if (llmResult && llmResult.text) {
        // v4: 解析 LLM 回复中的行动指令（如创建任务）
        const action = parseAction(llmResult.text)
        if (action) {
          try {
            const actionResult = await executeAction(action, userId)
            // 移除行动指令标签，只保留给用户看的自然语言部分
            const userFacingText = cleanRepetitiveCare(stripActionTag(llmResult.text))
            // 合并 LLM 自然语言回复 + 行动执行结果
            const combinedReply = userFacingText
              ? `${userFacingText}\n\n${actionResult.reply}`
              : actionResult.reply

            return {
              reply: combinedReply,
              messageType: actionResult.messageType as ReplyResult['messageType'],
              metadata: {
                llmProvider: llmResult.provider,
                llmModel: llmResult.model,
                actionResult: actionResult.metadata,
              },
              proactiveSuggestions: ctxAnalysis.proactiveSuggestions,
              contextSummary: ctxSummary,
            }
          } catch (err) {
            console.error('[AI-Reply] Action execution failed:', err)
            // 行动执行失败，返回 LLM 文本（去掉指令标签）
            return {
              reply: cleanRepetitiveCare(stripActionTag(llmResult.text)),
              messageType: 'text',
              metadata: { llmProvider: llmResult.provider, llmModel: llmResult.model, actionError: true },
              proactiveSuggestions: ctxAnalysis.proactiveSuggestions,
              contextSummary: ctxSummary,
            }
          }
        }

        // 无行动指令，正常返回 LLM 回复
        return {
          reply: cleanRepetitiveCare(llmResult.text),
          messageType: 'text',
          metadata: { llmProvider: llmResult.provider, llmModel: llmResult.model },
          proactiveSuggestions: ctxAnalysis.proactiveSuggestions,
          contextSummary: ctxSummary,
        }
      }
      // LLM 不可用 → 降级到规则回复（如果有）
      if (ctxAnalysis.confidence >= 0.5 && ctxAnalysis.reply) {
        return {
          reply: ctxAnalysis.reply,
          messageType: ctxAnalysis.messageType,
          metadata: ctxAnalysis.metadata,
          proactiveSuggestions: ctxAnalysis.proactiveSuggestions,
          contextSummary: ctxSummary,
        }
      }
    }

    // 结构化意图（高置信度）→ 直接使用规则回复（任务卡/账单卡等）
    if (ctxAnalysis.confidence >= 0.5 && ctxAnalysis.reply) {
      return {
        reply: ctxAnalysis.reply,
        messageType: ctxAnalysis.messageType,
        metadata: ctxAnalysis.metadata,
        proactiveSuggestions: ctxAnalysis.proactiveSuggestions,
        contextSummary: ctxSummary,
      }
    }
    // 低置信度（context_aware/fragment_store）→ 走原有规则匹配
    // 但携带上下文摘要，增强后续回复
  } catch {
    // 上下文收集失败，不阻塞回复生成，走原有规则匹配
  }

  // 今日待办
  if (/今日|今天|待办|任务/.test(text) && /查看|看|列表|有啥|有什么/.test(text)) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const tasks = await prisma.task.findMany({
      where: {
        userId,
        status: { not: 'done' },
        OR: [
          { dueDate: { gte: today, lt: tomorrow } },
          { dueDate: null },
        ],
      },
      orderBy: [{ important: 'desc' }, { priority: 'desc' }],
      take: 5,
    })

    if (tasks.length === 0) {
      return {
        reply: '今天没有待办任务，可以放松一下~ 要不要一起规划下明天？',
        messageType: 'text',
      }
    }

    return {
      reply: `📋 今日待办 ${tasks.length}项`,
      messageType: 'task_card',
      metadata: { tasks },
    }
  }

  // 记账
  if (/记账|花了|消费|花了多少|支出/.test(text)) {
    const match = text.match(/(\d+(?:\.\d+)?)/)
    if (match) {
      const amount = Number(match[1])
      // 从消息中提取标题（去掉"花了""元"等关键词），用于自动分类推断
      const rawTitle = text
        .replace(/记账|花了|消费|花了多少|支出|多少钱|元|块/g, '')
        .replace(/\d+(?:\.\d+)?/g, '')
        .trim() || '日常支出'
      const autoCategory = classifyBillCategory(rawTitle, 'expense')
      return {
        reply: `已识别到一笔 ¥${amount} 的支出。已为你智能分类为「${autoCategory}」，如不准确可修改。`,
        messageType: 'bill_card',
        metadata: { amount, type: 'expense', title: rawTitle, autoCategory },
      }
    }
    return {
      reply: '可以直接告诉我"花了XX元"，我会帮你记录~',
      messageType: 'text',
    }
  }

  // 饮食
  if (/吃了|吃了啥|早餐|午餐|晚餐|加餐/.test(text)) {
    return {
      reply: '记下来啦~ 你吃了什么？可以告诉我食物名称、分量，我会帮你算营养',
      messageType: 'diet_card',
      metadata: { mealType: guessMealType() },
    }
  }

  // 生成交接单：聚合今日已完成任务 + 今日账单 + 今日饮食 + 待办任务
  // 前端拿到 metadata 后，可一键跳转到 /handover?new=1 并预填这些数据
  if (/交接|交班|移交|生成交接|工作总结/.test(text)) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const [doneTasks, pendingTasks, todayBills, todayDiets] = await Promise.all([
      prisma.task.findMany({
        where: { userId, status: 'done', updatedAt: { gte: today, lt: tomorrow } },
        select: { title: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      prisma.task.findMany({
        where: { userId, status: { not: 'done' } },
        select: { id: true, title: true, priority: true, dueDate: true },
        orderBy: [{ important: 'desc' }, { priority: 'desc' }],
        take: 10,
      }),
      prisma.bill.findMany({
        where: { userId, billDate: { gte: today, lt: tomorrow } },
        select: { type: true, amount: true, title: true, category: true },
        orderBy: { billDate: 'desc' },
        take: 20,
      }),
      prisma.diet.findMany({
        where: { userId, eatenAt: { gte: today, lt: tomorrow } },
        select: { mealType: true, foodName: true, calories: true },
        orderBy: { eatenAt: 'desc' },
        take: 10,
      }),
    ])

    const monthExpense = todayBills
      .filter((b) => b.type === 'expense')
      .reduce((s, b) => s + b.amount, 0)

    return {
      reply: `📋 已为你汇总今日数据：已完成 ${doneTasks.length} 项任务，待办 ${pendingTasks.length} 项，今日消费 ¥${monthExpense.toFixed(2)}，记录 ${todayDiets.length} 餐饮食。点击下方按钮即可生成交接单。`,
      messageType: 'handover_card',
      metadata: {
        // 已完成事项：从任务标题转字符串数组，与 handoverSchema.completedItems 对齐
        completedItems: doneTasks.map((t) => t.title),
        // 待跟进事项：从待办任务转 { text, priority, dueDate? }
        pendingItems: pendingTasks.map((t) => ({
          text: t.title,
          priority: t.priority,
          dueDate: t.dueDate || undefined,
        })),
        // 今日账单摘要：供前端预填注意事项
        billsSummary: {
          expense: monthExpense,
          income: todayBills.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0),
          count: todayBills.length,
        },
        // 今日饮食摘要
        dietsSummary: {
          meals: todayDiets.length,
          totalCalories: todayDiets.reduce((s, d) => s + (d.calories || 0), 0),
        },
      },
    }
  }

  // 余额查询
  if (/余额|多少钱|钱包/.test(text)) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } })
    const balance = wallet?.balance || 0
    return {
      reply: `💰 你的钱包余额为 ¥${balance.toFixed(2)}${balance < 50 ? '，建议补充一些哦' : ''}`,
      messageType: 'text',
    }
  }

  // 倒计时
  if (/倒计时|还有多久|还有多少天/.test(text)) {
    const tasks = await prisma.task.findMany({
      where: { userId, dueDate: { gte: new Date() }, status: { not: 'done' } },
      orderBy: { dueDate: 'asc' },
      take: 3,
    })
    if (tasks.length === 0) {
      return { reply: '目前没有进行中的倒计时任务', messageType: 'text' }
    }
    const list = tasks.map(t => {
      const days = Math.ceil((new Date(t.dueDate!).getTime() - Date.now()) / 86400000)
      return `🎯 ${t.title} · ${days}天`
    }).join('\n')
    return { reply: `⏰ 倒计时：\n${list}`, messageType: 'text' }
  }

  // DG-09 跨模块洞察：跨表关联检测（碎片↔任务/账单的未闭环信号）
  if (/跨模块|跨信息|洞察|未闭环|insights?/.test(text)) {
    const insights = await generateInsights(userId)
    return {
      reply: insights.summary,
      messageType: 'insights_card',
      metadata: { insights },
    }
  }

  // DG-09 跨信息关联：发现碎片间的关联，主动提示并建议行动
  if (/发现关联|关联发现|碎片关联|信息关联|碎片关联|关联分析/.test(text)) {
    const connections = await generateConnections(userId)
    return {
      reply: connections.summary,
      messageType: 'connections_card',
      metadata: { connections },
    }
  }

  // EV-04 智能准备助手：为重要事件自动生成倒计时待办清单
  if (/准备|准备清单|准备工作|准备事项|准备下|帮我准备/.test(text)) {
    const preparation = await generatePreparation(userId)
    return {
      reply: preparation.summary,
      messageType: 'preparation_card',
      metadata: { preparation },
    }
  }

  // DG-08 隔夜整合：整合今日碎片，生成结构化总结
  if (/整合碎片|隔夜整合|今日总结|碎片总结|整合今日/.test(text)) {
    const digest = await generateDigest(userId)
    return {
      reply: digest.summary,
      messageType: 'digest_card',
      metadata: { digest },
    }
  }

  // DG-07 碎片信息查看
  if (/碎片|fragment|记录的信息|收藏的/.test(text)) {
    const today = new Date().toISOString().slice(0, 10)
    const rows = await prisma.$queryRaw<{ id: string; content: string; kind: string; tags: string | null; createdAt: string }[]>`SELECT id, content, kind, tags, createdAt FROM fragments WHERE userId = ${userId} AND date(createdAt) = date(${today}) ORDER BY createdAt DESC LIMIT 20`
    const fragments = rows.map((r) => {
      let tags: string[] = []
      try { tags = JSON.parse(r.tags || '[]') } catch { /* ignore */ }
      return { id: r.id, content: r.content, kind: r.kind, tags, createdAt: r.createdAt }
    })
    if (fragments.length === 0) {
      return {
        reply: '今天还没有碎片记录。发送任何文字、链接或想法，我会自动帮你分类存储~',
        messageType: 'text',
      }
    }
    return {
      reply: `🧩 今日已记录 ${fragments.length} 条碎片。发送任何文字我都会自动帮你分类存储。`,
      messageType: 'fragment_card',
      metadata: { fragments },
    }
  }

  // 规划（DG-06 实时规划）：基于当日数据生成时段建议
  if (/规划|安排|计划/.test(text)) {
    const schedule = await generateSchedule(content, userId)
    return {
      reply: schedule.summary,
      messageType: 'schedule_card',
      metadata: schedule,
    }
  }

  // 问候
  if (/早安|早上好|晚安|晚上好|你好|嗨|hi|hello|还好吗|怎么样/.test(text)) {
    const hour = new Date().getHours()
    let greeting = '你好'
    let careMsg = ''
    if (hour < 6) {
      greeting = '深夜好'
      careMsg = '这么晚了还没睡？注意休息哦 🌙'
    } else if (hour < 11) {
      greeting = '早安'
      careMsg = '吃早饭了吗？一天之计在于晨 🌅'
    } else if (hour < 13) {
      greeting = '中午好'
      careMsg = '午饭吃了什么？别饿着肚子哦 🍱'
    } else if (hour < 18) {
      greeting = '下午好'
      careMsg = '工作间隙记得活动一下身体 💪'
    } else if (hour < 22) {
      greeting = '晚上好'
      careMsg = '今天辛苦啦，晚餐记得好好吃 🍽️'
    } else {
      greeting = '晚上好'
      careMsg = '早点休息吧，别熬夜哦 🌟'
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const taskCount = await prisma.task.count({
      where: { userId, status: { not: 'done' }, dueDate: { gte: today, lt: tomorrow } },
    })

    // 查询今日饮食记录
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const mealCount = await prisma.diet.count({
      where: {
        userId,
        createdAt: {
          gte: new Date(`${todayStr}T00:00:00`),
          lt: new Date(`${todayStr}T23:59:59`),
        },
      },
    })

    // 根据时间和饮食状态增加关心信息
    let dietCare = ''
    if (hour >= 12 && hour < 14 && mealCount === 0) {
      dietCare = '中午了还没记录饮食，记得好好吃午饭哦 🍱'
    } else if (hour >= 18 && mealCount < 2) {
      dietCare = '今天饮食记录有点少，别忘了按时吃饭 🍽️'
    }

    let taskMsg = ''
    if (taskCount > 0) {
      taskMsg = taskCount > 3
        ? `今天有 ${taskCount} 项待办，节奏比较紧，需要的话我帮你梳理优先级。`
        : `今天有 ${taskCount} 项待办，节奏不错，加油！`
    }

    const replyParts = [`${greeting}！`, careMsg, taskMsg, dietCare].filter(Boolean)
    return {
      reply: replyParts.join(' '),
      messageType: 'text',
    }
  }

  // 帮助
  if (/帮助|help|能干啥|功能|怎么用/.test(text)) {
    return {
      reply: '我可以帮你：\n📋 管理任务和日程（说"查看待办"）\n💰 记账（说"花了XX元"）\n🍱 记录饮食（说"吃了XX"）\n⏰ 设置提醒\n👤 查看余额\n🎯 倒计时\n\n试试这些指令吧~',
      messageType: 'text',
    }
  }

  // 默认（DG-07 碎片信息收集）：未匹配任何指令时存储为碎片
  const fragmentId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const { kind, tags } = classifyFragment(content)
  await prisma.$executeRaw`INSERT INTO fragments (id, userId, content, kind, tags, sourceMsgId, digested, note, createdAt) VALUES (${fragmentId}, ${userId}, ${content}, ${kind}, ${JSON.stringify(tags)}, ${null}, 0, ${null}, datetime('now'))`

  // v3: 尝试用 LLM 生成自然的确认回复（碎片已存储，回复更自然）
  if (ctxData) {
    const fragHistory: ChatMessage[] = ctxData.chatHistory.map(m => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }))
    const fragLlmResult = await llmChatWithContext(content, ctxData, fragHistory, ctxData.profile.nickname)
    if (fragLlmResult && fragLlmResult.text) {
      // v4: 碎片路径也检查行动指令
      const action = parseAction(fragLlmResult.text)
      if (action) {
        try {
          const actionResult = await executeAction(action, userId)
          const userFacingText = cleanRepetitiveCare(stripActionTag(fragLlmResult.text))
          const combinedReply = userFacingText
            ? `${userFacingText}\n\n${actionResult.reply}`
            : actionResult.reply
          return {
            reply: combinedReply,
            messageType: actionResult.messageType as ReplyResult['messageType'],
            metadata: {
              llmProvider: fragLlmResult.provider,
              llmModel: fragLlmResult.model,
              fragmentStored: true,
              actionResult: actionResult.metadata,
            },
            proactiveSuggestions: ctxAnalysis?.proactiveSuggestions,
            contextSummary: ctxSummary,
          }
        } catch (err) {
          console.error('[AI-Reply] Fragment path action execution failed:', err)
        }
      }

      return {
        reply: cleanRepetitiveCare(fragLlmResult.text),
        messageType: 'text',
        metadata: { llmProvider: fragLlmResult.provider, llmModel: fragLlmResult.model, fragmentStored: true },
        proactiveSuggestions: ctxAnalysis?.proactiveSuggestions,
        contextSummary: ctxSummary,
      }
    }
  }

  // v2: 优先使用上下文感知回复，否则用默认回复
  if (ctxAnalysis?.reply) {
    return {
      reply: ctxAnalysis.reply,
      messageType: 'text',
      proactiveSuggestions: ctxAnalysis.proactiveSuggestions,
      contextSummary: ctxSummary,
    }
  }

  return {
    reply: `已记录这条信息 ✅\n分类：${kind} ${tags.length > 0 ? `· 标签：${tags.join('、')}` : ''}\n\n说"帮助"查看更多功能~`,
    messageType: 'text',
    contextSummary: ctxSummary,
  }
}