import { prisma } from './prisma.js'
import { classifyBillCategory } from '../utils/classify.js'
import { collectUserContext, type UserContext } from '../services/contextCollector.js'
import { analyzeWithContext, generateProactiveInsight } from '../services/contextAnalyzer.js'
import { llmChatWithContext, llmGenerateChat, type ChatMessage } from '../services/llmService.js'
import { parseAction, stripActionTag, executeAction } from '../services/conversationActionService.js'
import { extractAndSaveHabits } from '../services/habitService.js'
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
interface ReplyResult {
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

// ============ v4: 对话式任务创建检测 ============

/**
 * 不确定性/寻求建议短语
 *
 * 当用户消息包含这些短语时，说明他在"不知道做什么"或"寻求建议"，
 * 而不是在陈述一个确定要做的事项。此时不应触发任务创建，
 * 应该返回 null 让流程走 LLM 闲聊路径，由 AI 先确认用户意图。
 */
const UNCERTAINTY_PATTERNS = [
  /不知道(做|干|玩|去|吃|看|学|写)(什么|啥|嘛)/,
  /不知道怎么(安排|弄|搞|做|写|说)/,
  /不知道(要|该|能)(做|干|去|看|玩)(什么|啥)/,
  /(没事|没什么事|没啥事)(做|干|忙)/,
  /(无聊|好无聊|太无聊|好闲)/,
  /有什么(好|可以)(做|玩|看|去|吃)(的|呢|嘛|吗)?/,
  /(推荐|建议)(一下|几个|点|些)/,
  /去哪(好|呢|啊|呀)/,
  /做(什么|啥)(好|呢|嘛)?$/,
  /有什么事(可以做|做|干)/,
  /(要不要|该不该|能不能|行不行)/,
]

/**
 * 任务动作关键词
 *
 * 注意：移除了单独的"做"和"安排"，因为它们太宽泛，
 * 会匹配"不知道做什么"、"帮我安排"等不确定性表达。
 * 改用更精确的"要做"、"帮安排"等组合词。
 */
const TASK_ACTION_KEYWORDS = /开会|会议|报告|面试|考试|出差|旅行|预约|见面|聚餐|聚会|培训|答辩|汇报|演示|交付|提交|参加|约了|要约|买|交|送|办|有个会|有会|有个会|要开|要做|要去|得去|帮安排|排了|有个|有场|去参加|去面试|去考试|去开会/

/** 时间提取正则 */
const TIME_PATTERN = /(\d{1,2})[点时:：](\d{1,2})?|(上午|下午|晚上|中午|早上)(\d{1,2})[点时:：]?(\d{1,2})?|(\d{1,2})[点时:：](\d{1,2})?/

/** 日期关键词 */
const DATE_TODAY = /今天|今日|本天/
const DATE_TOMORROW = /明天|明日|next day/
const DATE_AFTER = /后天/

/** 提醒关键词 */
const REMINDER_KEYWORDS = /提醒|通知|叫我|别忘了|记得/

/**
 * 检测用户消息是否包含不确定性/寻求建议的表达
 *
 * @returns true 表示用户在表达不确定，应走闲聊路径而非任务创建
 */
function isUncertaintyExpression(text: string): boolean {
  return UNCERTAINTY_PATTERNS.some(p => p.test(text))
}

/**
 * 检测用户消息是否包含任务创建意图
 *
 * 三种情况：
 * 1. 信息完整（有时间+有事项）→ 直接创建任务
 * 2. 信息不完整（有事项但没时间）→ 询问具体时间
 * 3. 补充时间（上一轮在问时间，这轮回复了时间）→ 创建任务
 *
 * v5 增强：先排除不确定性表达（如"不知道做什么"、"无聊"），
 * 这类消息走 LLM 闲聊路径，让 AI 先确认用户意图再决定是否创建任务。
 *
 * @returns ReplyResult 或 null（不匹配时返回 null）
 */
async function detectTaskCreation(
  content: string,
  userId: string,
  sessionId?: string,
): Promise<ReplyResult | null> {
  const text = content.trim()

  // v5: 先排除不确定性表达
  // "不知道做什么好"、"无聊"、"有什么推荐的"等 → 走 LLM 闲聊，先确认意图
  if (isUncertaintyExpression(text)) {
    console.log('[TaskCreation] 跳过：检测到不确定性表达，走闲聊路径:', text.slice(0, 30))
    return null
  }

  // 情况 3：补充时间（用户回复了时间，且最近 AI 消息在问时间）
  const timeOnly = extractTime(text)
  if (timeOnly && sessionId) {
    const followUp = await handleFollowUpTime(text, timeOnly, userId, sessionId)
    if (followUp) return followUp
  }

  // 检查是否包含任务动作关键词
  const hasActionKeyword = TASK_ACTION_KEYWORDS.test(text)
  if (!hasActionKeyword) {
    return null
  }

  // 提取时间
  const timeMatch = extractTime(text)

  // 提取日期
  let dateStr = getDateString(text)

  // 提取任务标题
  const title = extractTaskTitle(text)

  console.log('[TaskCreation]', { text, hasActionKeyword, timeMatch, dateStr, title })

  if (!title) return null

  // 检查是否需要提醒
  const wantReminder = REMINDER_KEYWORDS.test(text)

  // 提取时段信息（上午/下午/晚上等），用于后续补充时间时推断
  const periodMatch = text.match(/上午|下午|晚上|中午|早上|傍晚/)
  const period = periodMatch ? periodMatch[0] : null

  // 有时间但没有日期，默认今天
  if (timeMatch && !dateStr) {
    const today = new Date()
    dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  }

  // 统一流程：无论信息是否完整，都返回交互选项卡片
  // - 有时间 → 预选该时间，用户可直接确认或修改
  // - 无时间 → 用户从时间槽中选择
  // 先存储为碎片
  const fragmentId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  await prisma.$executeRaw`INSERT INTO fragments (id, userId, content, kind, tags, sourceMsgId, digested, note, createdAt) VALUES (${fragmentId}, ${userId}, ${content}, 'todo', ${JSON.stringify(['待办', '任务创建'])}, ${null}, 0, ${'pending task creation'}, datetime('now'))`

  const todayLabel = dateStr ? formatDateLabel(dateStr) : '今天'

  // 智能时间槽：用户已明确给出具体时间时，按事件类型（规则表→缓存→LLM）生成
  // 合理的提前量选项；否则按时段生成默认槽。
  let timeSlots: Array<{ label: string; value: string }>
  let reminderOptions: Array<{ label: string; value: string; icon: string }>
  if (timeMatch) {
    const smartConfig = await getSmartSlotConfig(text)
    timeSlots = buildSlotsFromConfig(timeMatch, smartConfig)
    reminderOptions = buildReminderOptionsFromConfig(smartConfig)
  } else {
    timeSlots = generateTimeSlots(period)
    reminderOptions = buildReminderOptionsFromConfig(SMART_SLOT_DEFAULT)
  }

  // 预选时间：有具体时间时预选"准时"对应槽，无具体时间时由用户自选
  let preSelectedTime: string | undefined
  if (timeMatch) {
    preSelectedTime = timeMatch
  }

  return {
    reply: `好的，${todayLabel}要${title}。帮你安排一下：`,
    messageType: 'task_options_card',
    metadata: {
      pendingTaskCreation: { title, date: dateStr, wantReminder, period },
      options: {
        title,
        dateLabel: todayLabel,
        dateStr,
        period,
        timeSlots,
        preSelectedTime,
        preSelectedReminder: wantReminder ? '15' : undefined,
        reminderOptions,
        priorityOptions: [
          { label: '普通', value: 'medium', icon: '📋', color: 'blue' },
          { label: '重要', value: 'high', icon: '⚠️', color: 'amber' },
          { label: '紧急', value: 'urgent', icon: '🔴', color: 'red' },
        ],
      },
    },
  }
}

/**
 * 根据时段生成时间槽选项
 * 上午 → 09:00, 10:00, 11:00
 * 下午 → 13:00, 15:00, 17:00
 * 晚上 → 18:00, 19:00, 20:00
 * 中午 → 11:30, 12:00, 12:30
 * 早上 → 07:00, 08:00, 09:00
 * 傍晚 → 17:00, 18:00, 19:00
 * 无时段 → 09:00, 14:00, 18:00
 */
function generateTimeSlots(period: string | null): Array<{ label: string; value: string }> {
  const slots: Array<{ label: string; value: string }> = []

  const make = (h: number, m: number = 0) => {
    const hh = String(h).padStart(2, '0')
    const mm = String(m).padStart(2, '0')
    slots.push({ label: `${hh}:${mm}`, value: `${hh}:${mm}` })
  }

  switch (period) {
    case '上午':
      make(9); make(10); make(11)
      break
    case '下午':
      make(13); make(15); make(17)
      break
    case '晚上':
      make(18); make(19); make(20)
      break
    case '中午':
      make(11, 30); make(12); make(12, 30)
      break
    case '早上':
      make(7); make(8); make(9)
      break
    case '傍晚':
      make(17); make(18); make(19)
      break
    default:
      // 无时段：提供全天常用时间
      make(9); make(14); make(18)
      break
  }

  return slots
}

/**
 * 把 "HH:mm" 格式时间向前偏移 deltaMinutes 分钟，返回新的 "HH:mm"
 * 跨天时回绕到前一天的同一时刻（用模 24 小时处理），保证返回值始终在 00:00-23:59 之间。
 */
function shiftTimeBackward(time: string, deltaMinutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = (h * 60 + m - deltaMinutes + 24 * 60) % (24 * 60)
  const hh = String(Math.floor(total / 60)).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

// ============ 智能时间槽判断（规则表 → 缓存 → LLM 兜底） ============

/** 事件类型 → 时间槽/提醒档配置 */
interface SmartSlotConfig {
  /** 事件类别名（用于缓存与展示） */
  category: string
  /** 时间槽偏移（分钟，0=准时，正值=提前量） */
  timeOffsets: number[]
  /** 提醒提前量（分钟，0=不用提醒） */
  reminders: number[]
}

/** 内置规则表：高频事件类型直接命中，零延迟 */
const SMART_SLOT_RULES: Array<{ pattern: RegExp; config: SmartSlotConfig }> = [
  {
    pattern: /开会|会议|汇报|答辩|演示|培训|面试|直播/,
    config: { category: '会议', timeOffsets: [0, 60, 120], reminders: [15, 30, 60] },
  },
  {
    pattern: /飞机|航班|高铁|火车|机场|车站|值机|出差/,
    config: { category: '出行', timeOffsets: [120, 180, 240], reminders: [60, 120] },
  },
  {
    pattern: /考试|考证|四六级|驾考/,
    config: { category: '考试', timeOffsets: [30, 60, 120], reminders: [30, 60] },
  },
  {
    pattern: /聚餐|聚会|饭局|约会|见面|见客户|拜访|接(孩子|人|机)/,
    config: { category: '社交', timeOffsets: [0, 30, 60], reminders: [15, 30] },
  },
  {
    pattern: /截止|交(稿|付|报告|作业)|提交|报名|抢(票|购)/,
    config: { category: '截止类', timeOffsets: [0, 60], reminders: [15, 30, 60] },
  },
]

/** 默认配置：LLM 不可用/判断失败时的兜底 */
const SMART_SLOT_DEFAULT: SmartSlotConfig = {
  category: '默认',
  timeOffsets: [0, 60, 120],
  reminders: [15, 30, 60],
}

/** LLM 允许返回的偏移量白名单（分钟），防幻觉 */
const ALLOWED_OFFSETS = new Set([0, 15, 30, 60, 120, 180, 240])
/** LLM 允许返回的提醒提前量白名单（分钟），防幻觉 */
const ALLOWED_REMINDERS = new Set([0, 15, 30, 60, 120, 180])

/** 缓存文件路径：data/smart-slots-cache.json（随工作目录持久化） */
const SMART_SLOT_CACHE_FILE = path.resolve(process.cwd(), 'data', 'smart-slots-cache.json')

/** 内存缓存：事件关键词 → 配置（启动后从文件懒加载） */
let _smartSlotCache: Record<string, SmartSlotConfig> | null = null

/** 提醒档图标映射 */
const REMINDER_ICONS: Record<number, string> = {
  15: '⏰', 30: '🔔', 60: '📢', 120: '🚨', 180: '🚨',
}

/** 读取缓存文件（懒加载，失败返回空表） */
async function loadSmartSlotCache(): Promise<Record<string, SmartSlotConfig>> {
  if (_smartSlotCache) return _smartSlotCache
  try {
    const raw = await fs.readFile(SMART_SLOT_CACHE_FILE, 'utf-8')
    _smartSlotCache = JSON.parse(raw) as Record<string, SmartSlotConfig>
  } catch {
    _smartSlotCache = {}
  }
  return _smartSlotCache
}

/** 写回缓存文件（失败静默，缓存丢了只影响下次多问一次 LLM） */
async function saveSmartSlotCache(cache: Record<string, SmartSlotConfig>): Promise<void> {
  try {
    await fs.mkdir(path.dirname(SMART_SLOT_CACHE_FILE), { recursive: true })
    await fs.writeFile(SMART_SLOT_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[SmartSlots] 缓存写入失败:', err instanceof Error ? err.message : err)
  }
}

/** 校验并规整 LLM 返回的配置，不合法字段回退默认值 */
function sanitizeSlotConfig(raw: {
  category?: unknown
  timeOffsets?: unknown
  reminders?: unknown
  eventWord?: unknown
}): { config: SmartSlotConfig; eventWord: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const category = typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim().slice(0, 20) : '未分类'
  const timeOffsets = Array.isArray(raw.timeOffsets)
    ? [...new Set(raw.timeOffsets.filter((n): n is number => typeof n === 'number' && ALLOWED_OFFSETS.has(n)))].sort((a, b) => a - b)
    : []
  const reminders = Array.isArray(raw.reminders)
    ? [...new Set(raw.reminders.filter((n): n is number => typeof n === 'number' && ALLOWED_REMINDERS.has(n)))].sort((a, b) => a - b)
    : []
  const eventWord = typeof raw.eventWord === 'string' && raw.eventWord.trim() ? raw.eventWord.trim().slice(0, 12) : ''
  if (!timeOffsets.length || !reminders.length) return null
  return {
    config: { category, timeOffsets, reminders },
    eventWord,
  }
}

/**
 * 智能判断事件类型并返回时间槽/提醒档配置。
 * 三层策略：
 * 1. 内置规则表命中 → 直接返回（零延迟）
 * 2. 缓存命中（之前 LLM 判断过的关键词）→ 直接返回
 * 3. LLM 兜底判断 → 结果写入缓存，下次同类事件不再调 LLM
 * 全部失败 → 返回默认配置
 */
async function getSmartSlotConfig(text: string): Promise<SmartSlotConfig> {
  // 1. 内置规则表
  for (const rule of SMART_SLOT_RULES) {
    if (rule.pattern.test(text)) return rule.config
  }

  // 2. 缓存：提取文本中的事件关键词（去掉时间/日期词后最长的一个名词片段）
  const cache = await loadSmartSlotCache()
  const stripped = text
    .replace(/(今天|明天|后天|下午|上午|晚上|早上|中午|傍晚|\d{1,2}[点时:：]\d{1,2}?|\d{1,4}[-/年]\d{1,2}[-/月]\d{1,2}|周[一二三四五六日天])/g, '')
    .replace(/(要|去|得|帮|安排|个|的|了|我|有)/g, '')
    .trim()
  if (stripped) {
    const hit = cache[stripped]
    if (hit) return hit
  }

  // 3. LLM 兜底（8 秒超时，失败走默认）
  try {
    const llmMessages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是日程助手。根据用户要做的事，判断事件类别并给出合理的时间槽偏移和提醒提前量。' +
          '只输出 JSON，不要任何其他文字。格式：' +
          '{"category":"类别名","eventWord":"事件核心词(2-6字)","timeOffsets":[...],"reminders":[...]}\n' +
          'timeOffsets 从 [0,15,30,60,120,180,240] 中选 2-4 个（分钟，0=准时，正数=提前量）；' +
          'reminders 从 [0,15,30,60,120,180] 中选 2-4 个（分钟，0=不用提醒）。' +
          '判断原则：会议/面试类要准时+提前1-2小时；赶飞机高铁要提前2-4小时；聚餐约会准时或提前半小时；截止类只需准时和提前1小时。',
      },
      { role: 'user', content: `我要做的事：${text}` },
    ]
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))
    const result = await Promise.race([llmGenerateChat(llmMessages), timeout])
    if (result?.text) {
      // 从回复中抽取 JSON（容忍 markdown 代码块包裹）
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = sanitizeSlotConfig(JSON.parse(jsonMatch[0]))
        if (parsed) {
          // 写缓存：核心词 + 类别名双索引，下次同类事件直接命中
          const next = { ...cache }
          if (parsed.eventWord) next[parsed.eventWord] = parsed.config
          next[parsed.config.category] = parsed.config
          _smartSlotCache = next
          void saveSmartSlotCache(next)
          return parsed.config
        }
      }
    }
  } catch (err) {
    console.warn('[SmartSlots] LLM 判断失败，使用默认配置:', err instanceof Error ? err.message : err)
  }

  return SMART_SLOT_DEFAULT
}

/** 根据配置和基准时间生成时间槽 */
function buildSlotsFromConfig(baseTime: string, config: SmartSlotConfig): Array<{ label: string; value: string }> {
  return config.timeOffsets
    .slice(0, 4)
    .map((offset) => {
      const t = offset === 0 ? baseTime : shiftTimeBackward(baseTime, offset)
      return { label: t, value: t }
    })
}

/** 根据配置生成提醒档选项（始终附带"不用提醒"） */
function buildReminderOptionsFromConfig(config: SmartSlotConfig): Array<{ label: string; value: string; icon: string }> {
  const options = config.reminders
    .filter((m) => m > 0)
    .slice(0, 3)
    .map((m) => ({
      label: m >= 60 ? `提前${m / 60}小时` : `提前${m}分钟`,
      value: String(m),
      icon: REMINDER_ICONS[m] || '🔔',
    }))
  options.push({ label: '不用提醒', value: '0', icon: '✖' })
  return options
}

/**
 * 从文本中提取时间（HH:mm 格式）
 * 支持："3点"、"15:00"、"下午3点"、"下午3点30" 等
 */
function extractTime(text: string): string | null {
  // 下午/上午 + 数字 + 点
  const periodMatch = text.match(/(上午|下午|晚上|中午|早上|傍晚)(\d{1,2})\s*[点时:：](\d{1,2})?/)
  if (periodMatch) {
    let hour = parseInt(periodMatch[2], 10)
    const minute = periodMatch[3] ? parseInt(periodMatch[3], 10) : 0
    if ((periodMatch[1] === '下午' || periodMatch[1] === '晚上' || periodMatch[1] === '傍晚') && hour < 12) {
      hour += 12
    }
    if ((periodMatch[1] === '上午' || periodMatch[1] === '早上') && hour === 12) {
      hour = 0
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  // 纯数字 + 点/时/:：
  const directMatch = text.match(/(?<!\d)(\d{1,2})\s*[点时:：]\s*(\d{1,2})?(?!\d)/)
  if (directMatch) {
    let hour = parseInt(directMatch[1], 10)
    const minute = directMatch[2] ? parseInt(directMatch[2], 10) : 0
    // 24小时制：如果小时 > 23，可能有问题，返回 null
    if (hour > 23) return null
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  return null
}

/**
 * 从文本中提取日期字符串（YYYY-MM-DD）
 */
function getDateString(text: string): string | null {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  if (DATE_TODAY.test(text)) return todayStr

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (DATE_TOMORROW.test(text)) {
    return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  }

  const afterTomorrow = new Date(now)
  afterTomorrow.setDate(afterTomorrow.getDate() + 2)
  if (DATE_AFTER.test(text)) {
    return `${afterTomorrow.getFullYear()}-${pad(afterTomorrow.getMonth() + 1)}-${pad(afterTomorrow.getDate())}`
  }

  // YYYY-MM-DD 格式
  const dateMatch = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (dateMatch) {
    return `${dateMatch[1]}-${pad(parseInt(dateMatch[2], 10))}-${pad(parseInt(dateMatch[3], 10))}`
  }

  // M月D日 格式
  const cnDateMatch = text.match(/(\d{1,2})月(\d{1,2})[日号]/)
  if (cnDateMatch) {
    return `${now.getFullYear()}-${pad(parseInt(cnDateMatch[1], 10))}-${pad(parseInt(cnDateMatch[2], 10))}`
  }

  return null
}

/**
 * 从文本中提取任务标题
 * 去掉时间、日期、提醒等关键词，保留核心事项
 */
function extractTaskTitle(text: string): string | null {
  // v5: 先检测不确定性短语，直接返回 null
  // 如"不知道做什么好"、"有什么好做的"等不是任务标题
  if (isUncertaintyExpression(text)) {
    return null
  }

  let title = text
    .replace(/今天|今日|明天|明日|后天|本天/g, '')
    .replace(/上午|下午|晚上|中午|早上|傍晚/g, '')
    .replace(/\d{1,2}\s*[点时:：]\s*\d{0,2}/g, '')
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, '')
    .replace(/\d{1,2}月\d{1,2}[日号]/g, '')
    .replace(/提醒我|提醒|通知我|叫我|别忘了|记得/g, '')
    .replace(/有个|有场|要去|得去|需要|帮我看一下|帮我记一下|帮我记一下|帮我创建|帮我安排|帮安排/g, '')
    .replace(/^[，,。！!\s]+|[，,。！!\s]+$/g, '')
    .trim()

  // v5: 过滤掉残留的不确定性短语
  const noisePhrases = [
    '不知道做什么', '不知道干啥', '不知道干嘛', '不知道怎么', '不知道',
    '没事做', '没什么事', '有什么好', '有什么可以', '有什么事',
    '无聊', '好无聊', '要不要', '该不该', '推荐一下', '建议一下',
  ]
  for (const phrase of noisePhrases) {
    title = title.replace(new RegExp(phrase, 'g'), '')
  }
  title = title.replace(/^[，,。！!\s]+|[，,。！!\s]+$/g, '').trim()

  // 特殊处理：单独的"会"→"开会"
  if (title === '会') return '开会'
  // 单独的"约"→"约会面"
  if (title === '约') return '约会'

  // 如果标题为空或太短，返回 null
  if (!title || title.length < 2) return null

  // 限制长度
  if (title.length > 30) title = title.slice(0, 30)

  return title
}

/**
 * 处理补充时间的后续消息
 *
 * 当用户上一轮被问到"具体几点"，这轮回复了时间
 */
async function handleFollowUpTime(
  content: string,
  timeStr: string,
  userId: string,
  sessionId: string,
): Promise<ReplyResult | null> {
  // 查询最近的 AI 消息，看是否在问时间
  const recentMessages = await prisma.message.findMany({
    where: { sessionId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: { content: true, metadata: true },
  })

  if (recentMessages.length === 0) return null

  const lastAiMsg = recentMessages[0]
  // 检查 AI 是否在问时间或展示了选项卡片
  const isAskingTime = /具体几点|几点|什么时间|帮你安排/.test(lastAiMsg.content)
  if (!isAskingTime) {
    return null
  }

  // 从 AI 消息的 metadata 中提取待创建任务信息
  let pendingTask: { title?: string; date?: string; wantReminder?: boolean; period?: string } | null = null
  try {
    const meta = lastAiMsg.metadata ? JSON.parse(lastAiMsg.metadata) : null
    pendingTask = meta?.pendingTaskCreation || null
  } catch {
    // ignore
  }

  // 如果没有 pendingTask，从 AI 消息文本中提取标题
  let title = pendingTask?.title
  let dateStr = pendingTask?.date || null
  if (!title) {
    // 尝试从 AI 消息中提取 "要XXX" 格式的标题
    const titleMatch = lastAiMsg.content.match(/要(.+?)。/)
    if (titleMatch) {
      title = titleMatch[1].replace(/[，,。！！？\s]+$/, '').trim()
    }
  }

  if (!title) return null

  // 如果没有日期，默认今天
  if (!dateStr) {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  }

  // 检查用户消息是否也提到了提醒
  // 支持从选项卡片按钮发送的消息中提取：如 "15:00 提前30分钟 重要"
  // 从用户消息中提取提醒分钟数（如 "提前30分钟" → 30, "提前1小时" → 60, "不用提醒" → 0）
  let reminderMinutes = 15
  const reminderMinMatch = content.match(/提前(\d+)\s*分钟/)
  if (reminderMinMatch) {
    reminderMinutes = parseInt(reminderMinMatch[1], 10)
  } else if (/提前1\s*小时|提前一小时/.test(content)) {
    reminderMinutes = 60
  } else if (/不用提醒|不要提醒/.test(content)) {
    reminderMinutes = 0
  }

  // 从用户消息中提取优先级（如 "重要" → high, "紧急" → urgent）
  let priority = 'medium'
  if (/紧急|急/.test(content)) {
    priority = 'urgent'
  } else if (/重要|高优先/.test(content)) {
    priority = 'high'
  } else if (/普通|一般/.test(content)) {
    priority = 'medium'
  }

  // 根据之前保存的时段信息调整时间（如"下午" + "3点" → 15:00）
  let adjustedTime = timeStr
  const period = pendingTask?.period
  if (period) {
    const [h, m] = timeStr.split(':').map(Number)
    let hour = h
    if ((period === '下午' || period === '晚上' || period === '傍晚') && hour < 12) {
      hour += 12
    } else if ((period === '上午' || period === '早上') && hour === 12) {
      hour = 0
    }
    adjustedTime = `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  // 创建任务
  const action = {
    type: 'create_task' as const,
    params: {
      title,
      date: dateStr,
      time: adjustedTime,
      reminder: reminderMinutes > 0 ? 'true' : 'false',
      reminderMinutes: String(reminderMinutes),
      priority,
    },
  }
  const result = await executeAction(action, userId)

  const replyText = reminderMinutes > 0
    ? `好的，已确认 ${formatDateLabel(dateStr)} ${adjustedTime} ${title}，待办已创建并设置提前${reminderMinutes}分钟提醒 ✅\n${result.reply}`
    : `好的，已确认 ${formatDateLabel(dateStr)} ${adjustedTime} ${title}，待办已创建 ✅\n${result.reply}`

  return {
    reply: replyText,
    messageType: 'task_created_card',
    metadata: { actionResult: result.metadata },
  }
}

/**
 * 日期格式化为友好标签
 */
function formatDateLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (date.getTime() === today.getTime()) return '今天'
    if (date.getTime() === tomorrow.getTime()) return '明天'

    return `${date.getMonth() + 1}月${date.getDate()}日`
  } catch {
    return dateStr
  }
}

function guessMealType(): string {
  const h = new Date().getHours()
  if (h < 10) return 'breakfast'
  if (h < 14) return 'lunch'
  if (h < 17) return 'snack'
  return 'dinner'
}

/**
 * DG-07 碎片信息分类器
 * - 检测 URL → link
 * - 检测代码标记 → snippet
 * - 检测待办线索 → todo
 * - 检测灵感关键词 → idea
 * - 默认 → note
 */
function classifyFragment(content: string): { kind: string; tags: string[] } {
  const tags: string[] = []

  if (/https?:\/\/[^\s]+/i.test(content)) {
    tags.push('链接')
    return { kind: 'link', tags }
  }
  if (/```|^\s{4}|function |const |let |import |class /.test(content)) {
    tags.push('代码')
    return { kind: 'snippet', tags }
  }
  if (/应该|需要|记得|待办|要做|得去|别忘了|提醒我/.test(content)) {
    tags.push('待办')
    return { kind: 'todo', tags }
  }
  if (/想法|灵感|idea|如果|能不能|突然觉得|或许可以|不如/.test(content)) {
    tags.push('灵感')
    return { kind: 'idea', tags }
  }
  if (/工作|项目|任务|会议|客户/.test(content)) tags.push('工作')
  if (/生活|家庭|健康|运动|饮食/.test(content)) tags.push('生活')
  if (/钱|消费|收入|支出|理财/.test(content)) tags.push('财务')
  if (/学习|读书|课程|笔记/.test(content)) tags.push('学习')
  return { kind: 'note', tags }
}

/**
 * DG-08 隔夜整合：生成今日碎片的结构化总结
 *
 * 流程：
 * 1. 读取当日未整合碎片（digested=0）
 * 2. 按 kind 分组，每组取前 3 条作为 highlights
 * 3. 聚合所有 tags，按出现频次排序取前 8
 * 4. 提取 todo 类型碎片作为待跟进事项
 * 5. 生成自然语言总结
 * 6. 标记所有碎片为已整合（digested=1）
 *
 * 幂等：若当日已无未整合碎片，返回空摘要
 */
interface DigestHighlight {
  id: string
  content: string
  createdAt: string
}

interface DigestKindGroup {
  kind: string
  label: string
  count: number
  highlights: DigestHighlight[]
}

interface DigestTopTag {
  tag: string
  count: number
}

interface DigestResult {
  date: string
  totalCount: number
  byKind: DigestKindGroup[]
  topTags: DigestTopTag[]
  todoItems: string[]
  summary: string
  generatedAt: string
}

async function generateDigest(userId: string): Promise<DigestResult> {
  const date = new Date().toISOString().slice(0, 10)

  // 读取当日未整合碎片
  const rows = await prisma.$queryRaw<{ id: string; content: string; kind: string; tags: string | null; createdAt: string }[]>`SELECT id, content, kind, tags, createdAt FROM fragments WHERE userId = ${userId} AND date(createdAt) = date(${date}) AND digested = 0 ORDER BY createdAt ASC`

  if (rows.length === 0) {
    return {
      date,
      totalCount: 0,
      byKind: [],
      topTags: [],
      todoItems: [],
      summary: '今日暂无未整合碎片，可继续发送文字/链接/想法收集~',
      generatedAt: new Date().toISOString(),
    }
  }

  // 解析 tags
  const parsed = rows.map((r) => {
    let tags: string[] = []
    try { tags = JSON.parse(r.tags || '[]') } catch { /* ignore */ }
    return { id: r.id, content: r.content, kind: r.kind, tags, createdAt: r.createdAt }
  })

  // 1. 按 kind 分组
  const kindGroups: Record<string, typeof parsed> = {}
  for (const f of parsed) {
    if (!kindGroups[f.kind]) kindGroups[f.kind] = []
    kindGroups[f.kind].push(f)
  }

  const kindLabels: Record<string, string> = {
    note: '笔记',
    link: '链接',
    todo: '待办',
    idea: '灵感',
    snippet: '代码',
  }

  const byKind: DigestKindGroup[] = Object.keys(kindGroups).map((kind) => ({
    kind,
    label: kindLabels[kind] || kind,
    count: kindGroups[kind].length,
    highlights: kindGroups[kind].slice(0, 3).map((f) => ({
      id: f.id,
      content: f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content,
      createdAt: f.createdAt,
    })),
  }))

  // 2. 聚合 tags
  const tagCount: Record<string, number> = {}
  for (const f of parsed) {
    for (const tag of f.tags) {
      tagCount[tag] = (tagCount[tag] || 0) + 1
    }
  }
  const topTags: DigestTopTag[] = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }))

  // 3. 提取 todo 待跟进
  const todoItems: string[] = parsed
    .filter((f) => f.kind === 'todo')
    .map((f) => (f.content.length > 80 ? f.content.slice(0, 80) + '…' : f.content))

  // 4. 生成总结文案
  const summaryParts: string[] = []
  summaryParts.push(`今日共记录 ${parsed.length} 条碎片`)
  if (byKind.length > 0) {
    const breakdown = byKind.map((g) => `${g.label} ${g.count} 条`).join('、')
    summaryParts.push(`分布：${breakdown}`)
  }
  if (topTags.length > 0) {
    summaryParts.push(`高频标签：${topTags.slice(0, 5).map((t) => `#${t.tag}`).join(' ')}`)
  }
  if (todoItems.length > 0) {
    summaryParts.push(`待跟进 ${todoItems.length} 项`)
  }
  const summary = summaryParts.join('。') + '。'

  // 5. 标记为已整合
  await prisma.$executeRaw`UPDATE fragments SET digested = 1 WHERE userId = ${userId} AND date(createdAt) = date(${date}) AND digested = 0`

  return {
    date,
    totalCount: parsed.length,
    byKind,
    topTags,
    todoItems,
    summary,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * DG-09 跨信息关联：发现碎片间的关联，主动提示并建议行动
 *
 * 算法：
 * 1. 读取最近 7 天的碎片
 * 2. 按 tag 聚合，找出有 2+ 碎片的标签
 * 3. 为每个关联组生成建议行动（基于标签语义）
 * 4. 返回关联组列表（最多 10 组）
 *
 * 返回结构对齐 GET /fragment/connections 接口
 */
interface ConnectionSample {
  id: string
  content: string
  kind: string
  createdAt: string
}

interface ConnectionGroup {
  tag: string
  count: number
  icon: string
  suggestedAction: string
  samples: ConnectionSample[]
}

interface ConnectionsResult {
  days: number
  totalCount: number
  connections: ConnectionGroup[]
  summary: string
}

async function generateConnections(userId: string): Promise<ConnectionsResult> {
  const days = 7
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  const rows = await prisma.$queryRaw<{ id: string; content: string; kind: string; tags: string | null; createdAt: string }[]>`SELECT id, content, kind, tags, createdAt FROM fragments WHERE userId = ${userId} AND date(createdAt) >= date(${sinceStr}) ORDER BY createdAt DESC LIMIT 200`

  if (rows.length === 0) {
    return {
      days,
      totalCount: 0,
      connections: [],
      summary: '最近无碎片记录，发送文字/链接/想法即可开始收集。',
    }
  }

  // 解析 tags
  const parsed = rows.map((r) => {
    let tags: string[] = []
    try { tags = JSON.parse(r.tags || '[]') } catch { /* ignore */ }
    return { id: r.id, content: r.content, kind: r.kind, tags, createdAt: r.createdAt }
  })

  // 按 tag 聚合
  const tagGroups: Record<string, typeof parsed> = {}
  for (const f of parsed) {
    for (const tag of f.tags) {
      if (!tagGroups[tag]) tagGroups[tag] = []
      tagGroups[tag].push(f)
    }
  }

  // 建议行动映射
  const actionMap: Record<string, { action: string; icon: string }> = {
    工作: { action: '考虑创建项目任务，统一跟进相关碎片', icon: '📋' },
    项目: { action: '建议汇总为项目笔记，便于回溯', icon: '📁' },
    待办: { action: '建议加入任务清单，逐项落实', icon: '✅' },
    灵感: { action: '建议整理为灵感笔记，触发后续行动', icon: '💡' },
    学习: { action: '建议汇总为学习主题，制定学习计划', icon: '📚' },
    财务: { action: '建议纳入预算规划，关注支出趋势', icon: '💰' },
    生活: { action: '建议回顾关联内容，平衡生活节奏', icon: '🌿' },
    链接: { action: '建议整理为书签清单，分类保存', icon: '🔗' },
    代码: { action: '建议汇总为代码片段集，便于复用', icon: '⌗' },
  }

  // 构建关联组（仅保留 2+ 碎片的标签）
  const connections: ConnectionGroup[] = Object.entries(tagGroups)
    .filter(([, frags]) => frags.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([tag, frags]) => {
      const meta = actionMap[tag] || { action: '建议回顾关联内容，发现潜在行动', icon: '🔍' }
      return {
        tag,
        count: frags.length,
        icon: meta.icon,
        suggestedAction: meta.action,
        samples: frags.slice(0, 3).map((f) => ({
          id: f.id,
          content: f.content.length > 50 ? f.content.slice(0, 50) + '…' : f.content,
          kind: f.kind,
          createdAt: f.createdAt,
        })),
      }
    })

  const summary =
    connections.length > 0
      ? `最近 ${days} 天发现 ${connections.length} 组关联信息`
      : `最近 ${days} 天共 ${parsed.length} 条碎片，暂无明显关联`

  return {
    days,
    totalCount: parsed.length,
    connections,
    summary,
  }
}

/**
 * DG-09 跨模块洞察：检测碎片↔任务/账单之间的未闭环信号
 *
 * 信号类型：
 * 1. orphanTodos：待办碎片未对应任务
 * 2. unactedIdeas：灵感碎片近 3 天未触发任务
 * 3. financeMentions：含金额语义但未入账
 * 4. taskEchoes：任务标题在碎片中重复出现
 *
 * 返回结构对齐 GET /fragment/insights 接口
 */
interface InsightSample {
  fragmentId: string
  content: string
  createdAt: string
  suggestion: string
}

interface InsightTaskEcho {
  taskId: string
  taskTitle: string
  taskStatus: string
  echoCount: number
  samples: InsightSample[]
}

interface InsightsResult {
  days: number
  totalCount: number
  signals: {
    orphanTodos: InsightSample[]
    unactedIdeas: InsightSample[]
    financeMentions: InsightSample[]
    taskEchoes: InsightTaskEcho[]
  }
  signalCount: number
  summary: string
  generatedAt: string
}

async function generateInsights(userId: string): Promise<InsightsResult> {
  const days = 7
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  // 并行查询：碎片 + 近期任务 + 近期账单
  const [fragRows, tasks, bills] = await Promise.all([
    prisma.$queryRaw<{ id: string; content: string; kind: string; tags: string | null; createdAt: string }[]>`SELECT id, content, kind, tags, createdAt FROM fragments WHERE userId = ${userId} AND date(createdAt) >= date(${sinceStr}) ORDER BY createdAt DESC LIMIT 200`,
    prisma.task.findMany({
      where: { userId, updatedAt: { gte: since } },
      select: { id: true, title: true, status: true, priority: true, dueDate: true },
      take: 100,
    }),
    prisma.bill.findMany({
      where: { userId, billDate: { gte: since } },
      select: { id: true, title: true, type: true, amount: true, category: true, billDate: true },
      take: 100,
    }),
  ])

  // 解析碎片
  const fragments = fragRows.map((r) => {
    let tags: string[] = []
    try { tags = JSON.parse(r.tags || '[]') } catch { /* ignore */ }
    return { id: r.id, content: r.content, kind: r.kind, tags, createdAt: r.createdAt }
  })

  // 信号 1：orphanTodos
  const todoFrags = fragments.filter(
    (f) => f.kind === 'todo' || /待办|要做|得去|记得|别忘了|提醒我/.test(f.content),
  )
  const taskTitles = tasks.map((t) => t.title)
  const orphanTodos: InsightSample[] = todoFrags
    .filter((f) => {
      const kw = f.content.replace(/应该|需要|记得|待办|要做|得去|别忘了|提醒我|完成|处理/g, '').trim().slice(0, 5)
      if (!kw) return true
      return !taskTitles.some((t) => t.includes(kw) || kw.includes(t.slice(0, 4)))
    })
    .slice(0, 5)
    .map((f) => ({
      fragmentId: f.id,
      content: f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content,
      createdAt: f.createdAt,
      suggestion: '建议转为任务，纳入待办清单跟踪',
    }))

  // 信号 2：unactedIdeas
  const ideaFrags = fragments.filter((f) => f.kind === 'idea')
  const recent3d = new Date()
  recent3d.setDate(recent3d.getDate() - 3)
  const unactedIdeas: InsightSample[] = ideaFrags
    .filter((f) => new Date(f.createdAt) < recent3d)
    .slice(0, 5)
    .map((f) => ({
      fragmentId: f.id,
      content: f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content,
      createdAt: f.createdAt,
      suggestion: '灵感已搁置 3 天以上，建议整理为笔记或转为任务',
    }))

  // 信号 3：financeMentions
  const financeFrags = fragments.filter(
    (f) => /(\d+(\.\d+)?)\s*(元|块|￥|¥)|花了|收入|支出|消费|入账/.test(f.content),
  )
  const billTitles = bills.map((b) => b.title)
  const financeMentions: InsightSample[] = financeFrags
    .filter((f) => {
      const kw = f.content.replace(/\d+(?:\.\d+)?/g, '').replace(/元|块|￥|¥|花了|收入|支出|消费|入账/g, '').trim().slice(0, 5)
      if (!kw) return true
      return !billTitles.some((t) => t.includes(kw))
    })
    .slice(0, 5)
    .map((f) => ({
      fragmentId: f.id,
      content: f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content,
      createdAt: f.createdAt,
      suggestion: '提及金额但未在账单中找到对应记录，建议核实是否已入账',
    }))

  // 信号 4：taskEchoes
  const taskEchoes: InsightTaskEcho[] = tasks
    .map((t) => {
      const kw = t.title.slice(0, 5)
      const echoes = fragments.filter((f) => f.content.includes(kw)).slice(0, 2)
      return {
        taskId: t.id,
        taskTitle: t.title,
        taskStatus: t.status,
        echoCount: echoes.length,
        samples: echoes.map((f) => ({
          fragmentId: f.id,
          content: f.content.length > 50 ? f.content.slice(0, 50) + '…' : f.content,
          createdAt: f.createdAt,
          suggestion: '该任务在碎片中有相关思考，建议整合沉淀',
        })),
      }
    })
    .filter((e) => e.echoCount > 0)
    .slice(0, 5)

  const signalCount =
    orphanTodos.length + unactedIdeas.length + financeMentions.length + taskEchoes.length

  const summaryParts: string[] = []
  summaryParts.push(`最近 ${days} 天共 ${fragments.length} 条碎片`)
  if (orphanTodos.length > 0) summaryParts.push(`${orphanTodos.length} 项待办未转化`)
  if (unactedIdeas.length > 0) summaryParts.push(`${unactedIdeas.length} 个灵感搁置`)
  if (financeMentions.length > 0) summaryParts.push(`${financeMentions.length} 笔金额未入账`)
  if (taskEchoes.length > 0) summaryParts.push(`${taskEchoes.length} 个任务有相关思考`)
  const summary =
    signalCount === 0
      ? `最近 ${days} 天共 ${fragments.length} 条碎片，跨模块关联已闭环`
      : summaryParts.join('，') + '。'

  return {
    days,
    totalCount: fragments.length,
    signals: { orphanTodos, unactedIdeas, financeMentions, taskEchoes },
    signalCount,
    summary,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * EV-04 智能准备助手：为重要事件自动生成倒计时待办清单
 *
 * 算法：
 * 1. 查询未来 3 天内的重要任务（important=true 或 priority=urgent/high）
 * 2. 按任务标题关键词匹配准备模板：
 *    - 会议/汇报 → 准备资料/确认参会人员/检查设备/演示文稿
 *    - 客户/拜访 → 准备资料/确认行程/准备名片/了解客户背景
 *    - 截止/提交/交付 → 检查完整性/准备备份/确认提交方式
 *    - 考试/面试 → 复习重点/准备证件/调整作息/准备材料
 *    - 旅行/出差/出发 → 确认行程/准备行李/检查证件/预订住宿
 *    - 默认 → 梳理要点/准备材料/确认时间
 * 3. 返回每个重要事件的准备清单
 */
interface PreparationItem {
  text: string
  optional?: boolean
}

interface PreparationEvent {
  taskId: string
  title: string
  dueDate: string
  daysLeft: number
  priority: string
  important: boolean
  category: string | null
  checklist: PreparationItem[]
}

interface PreparationResult {
  events: PreparationEvent[]
  totalChecklistItems: number
  summary: string
  generatedAt: string
}

/**
 * 根据任务标题生成准备清单
 */
function generateChecklist(title: string): PreparationItem[] {
  const items: PreparationItem[] = []

  if (/会议|汇报|演示|分享|讲座/.test(title)) {
    items.push({ text: '准备会议资料和议程' })
    items.push({ text: '确认参会人员并通知' })
    items.push({ text: '检查投影/音响设备' })
    items.push({ text: '准备演示文稿', optional: true })
    return items
  }
  if (/客户|拜访|会见|面谈|接见/.test(title)) {
    items.push({ text: '准备相关资料和方案' })
    items.push({ text: '确认会面时间和地点' })
    items.push({ text: '准备名片和笔记本' })
    items.push({ text: '了解对方背景信息', optional: true })
    return items
  }
  if (/截止|提交|交付|报送|上报/.test(title)) {
    items.push({ text: '检查材料完整性' })
    items.push({ text: '准备备份文件' })
    items.push({ text: '确认提交渠道和格式' })
    return items
  }
  if (/考试|面试|考核|答辩/.test(title)) {
    items.push({ text: '复习重点知识' })
    items.push({ text: '准备证件和文具' })
    items.push({ text: '调整作息保证状态' })
    items.push({ text: '准备自我介绍/简历', optional: true })
    return items
  }
  if (/旅行|出差|出发|启程|航班|高铁|火车/.test(title)) {
    items.push({ text: '确认行程和票据' })
    items.push({ text: '准备行李清单' })
    items.push({ text: '检查证件有效性' })
    items.push({ text: '预订住宿和交通', optional: true })
    return items
  }
  if (/发布|上线|部署|发版|release/.test(title)) {
    items.push({ text: '完成最终测试验证' })
    items.push({ text: '准备发布说明文档' })
    items.push({ text: '确认回滚方案' })
    items.push({ text: '通知相关方', optional: true })
    return items
  }

  // 默认准备清单
  items.push({ text: '梳理任务要点和目标' })
  items.push({ text: '准备所需材料' })
  items.push({ text: '确认时间和资源' })
  return items
}

async function generatePreparation(userId: string): Promise<PreparationResult> {
  const now = new Date()
  const horizon = new Date(now)
  horizon.setDate(horizon.getDate() + 3) // 未来 3 天

  // 查询未来 3 天内未完成的重要/紧急任务
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      status: { not: 'done' },
      dueDate: { gte: now, lte: horizon },
      OR: [
        { important: true },
        { priority: { in: ['urgent', 'high'] } },
      ],
    },
    orderBy: [{ important: 'desc' }, { priority: 'desc' }, { dueDate: 'asc' }],
    take: 5,
  })

  if (tasks.length === 0) {
    return {
      events: [],
      totalChecklistItems: 0,
      summary: '未来 3 天暂无重要事件需要准备。继续保持节奏~',
      generatedAt: now.toISOString(),
    }
  }

  const events: PreparationEvent[] = tasks.map((t) => {
    const dueDate = new Date(t.dueDate!)
    const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000)
    return {
      taskId: t.id,
      title: t.title,
      dueDate: dueDate.toISOString(),
      daysLeft: Math.max(0, daysLeft),
      priority: t.priority,
      important: t.important,
      category: t.category,
      checklist: generateChecklist(t.title),
    }
  })

  const totalChecklistItems = events.reduce((s, e) => s + e.checklist.length, 0)
  const urgentCount = events.filter((e) => e.daysLeft <= 1).length

  const summaryParts: string[] = []
  summaryParts.push(`发现 ${events.length} 个重要事件需要准备`)
  summaryParts.push(`共 ${totalChecklistItems} 项准备事项`)
  if (urgentCount > 0) {
    summaryParts.push(`其中 ${urgentCount} 个事件在 24 小时内`)
  }
  const summary = summaryParts.join('，') + '。'

  return {
    events,
    totalChecklistItems,
    summary,
    generatedAt: now.toISOString(),
  }
}

/**
 * DG-06 实时规划：时段块定义
 * - warmup：热身回顾（梳理待办、列重点）
 * - focus：深度专注（处理重要任务）
 * - break：休息放松
 * - routine：常规事务（次要任务、邮件、回复消息）
 * - review：复盘总结
 */
interface ScheduleBlock {
  time: string
  type: 'warmup' | 'focus' | 'break' | 'routine' | 'review'
  title: string
  reason: string
}

interface ScheduleResult {
  range: { label: string; start: string; end: string }
  blocks: ScheduleBlock[]
  tips: string[]
  summary: string
}

/**
 * 解析规划时段
 * - 支持关键词：上午/下午/晚上/今天/明天/全天
 * - 默认：从当前时间到 18:00
 */
function parsePlanRange(text: string): { label: string; startH: number; endH: number; isTomorrow: boolean } {
  const isTomorrow = /明天|明日|tomorrow/.test(text)
  const isMorning = /上午|早上|早晨/.test(text)
  const isAfternoon = /下午|午后/.test(text)
  const isEvening = /晚上|晚间|夜晚/.test(text)
  const isFullDay = /全天|今天一天|一天/.test(text)

  if (isMorning) return { label: isTomorrow ? '明天上午' : '今天上午', startH: 9, endH: 12, isTomorrow }
  if (isAfternoon) return { label: isTomorrow ? '明天下午' : '今天下午', startH: 14, endH: 18, isTomorrow }
  if (isEvening) return { label: isTomorrow ? '明天晚上' : '今天晚上', startH: 19, endH: 22, isTomorrow }
  if (isFullDay) return { label: isTomorrow ? '明天全天' : '今天全天', startH: 9, endH: 22, isTomorrow }

  // 默认：当前时段到 18:00（或晚上 22:00）
  const now = new Date().getHours()
  if (now < 12) return { label: '今天上午', startH: Math.max(now, 9), endH: 12, isTomorrow }
  if (now < 18) return { label: '今天下午', startH: Math.max(now + 1, 14), endH: 18, isTomorrow }
  return { label: '今天晚上', startH: Math.max(now + 1, 19), endH: 22, isTomorrow }
}

/**
 * 生成时段规划
 *
 * 算法：
 * 1. 解析用户指定的时间范围
 * 2. 查询该时段内的待办任务和提醒
 * 3. 基于任务优先级、睡眠状态、饮食记录，分配时段块
 * 4. 每个时段不超过 90 分钟（深度专注），中间插入 15 分钟休息
 * 5. 优先处理 urgent/important 任务，routine 处理常规事务
 */
async function generateSchedule(content: string, userId: string): Promise<ScheduleResult> {
  const range = parsePlanRange(content)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const targetDate = new Date(today)
  if (range.isTomorrow) targetDate.setDate(targetDate.getDate() + 1)
  const rangeStart = new Date(targetDate)
  rangeStart.setHours(range.startH, 0, 0, 0)
  const rangeEnd = new Date(targetDate)
  rangeEnd.setHours(range.endH, 0, 0, 0)

  // 并行查询：待办任务 + 提醒 + 昨晚睡眠 + 今日饮食
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const [pendingTasks, rangeReminders, lastSleep, todayDiets] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        status: { not: 'done' },
        OR: [
          { dueDate: { gte: rangeStart, lt: rangeEnd } },
          { dueDate: null, important: true },
          { dueDate: null },
        ],
      },
      orderBy: [{ important: 'desc' }, { priority: 'desc' }],
      take: 10,
    }),
    prisma.reminder.findMany({
      where: {
        userId,
        done: false,
        remindAt: { gte: rangeStart, lt: rangeEnd },
      },
      orderBy: { remindAt: 'asc' },
    }),
    prisma.sleep.findFirst({
      where: { userId, sleepDate: { gte: yesterday, lt: today } },
      orderBy: { sleepDate: 'desc' },
    }),
    prisma.diet.findMany({
      where: { userId, eatenAt: { gte: today, lt: tomorrow } },
      select: { mealType: true, calories: true },
    }),
  ])

  // 按 priority 排序任务，urgent > high > medium > low
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
  const sortedTasks = [...pendingTasks].sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 2
    const pb = priorityOrder[b.priority] ?? 2
    if (pa !== pb) return pa - pb
    // important 优先
    if (a.important && !b.important) return -1
    if (!a.important && b.important) return 1
    return 0
  })

  const blocks: ScheduleBlock[] = []
  const tips: string[] = []
  let cursor = range.startH
  // 将小数小时转为 "HH:MM" 格式（如 9.25 → "09:15"）
  const fmtTime = (h: number) => {
    const hh = Math.floor(h)
    const mm = Math.round((h - hh) * 60)
    // 处理 60 分钟进位（如 9.999 → 10:00）
    if (mm === 60) {
      return `${String(hh + 1).padStart(2, '0')}:00`
    }
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  // 将小时+分钟转为 "HH:MM" 格式（用于提醒时间）
  const fmtHM = (h: number, m: number) =>
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

  // 睡眠不足提示
  if (lastSleep && lastSleep.durationMin < 360) {
    tips.push('昨晚睡眠不足 6 小时，建议每专注 60 分钟休息一次')
  } else if (lastSleep && lastSleep.durationMin > 540) {
    tips.push('昨晚睡眠偏多，今天精力应该不错，可适当增加专注时长')
  }

  // 饮食提示
  if (todayDiets.length === 0 && new Date().getHours() >= 12 && !range.isTomorrow) {
    tips.push('今日尚未记录饮食，记得按时吃饭')
  }

  // 1. 开场热身（15 分钟）
  if (cursor < range.endH) {
    blocks.push({
      time: `${fmtTime(cursor)} - ${fmtTime(cursor + 0.25)}`,
      type: 'warmup',
      title: '回顾待办，列出重点',
      reason: '快速过一遍今日任务，明确优先级，避免被琐事带偏',
    })
    cursor = cursor + 0.25 // +15min
  }

  // 2. 分配任务到时段块
  // 每个 focus 块 60-90 分钟，中间穿插 15 分钟 break
  let taskIdx = 0
  while (cursor < range.endH - 1 && taskIdx < sortedTasks.length) {
    const task = sortedTasks[taskIdx]
    const isUrgent = task.priority === 'urgent' || task.important
    // 睡眠不足时缩短专注时长
    const focusDur = lastSleep && lastSleep.durationMin < 360 ? 60 : 90
    const endH = Math.min(cursor + focusDur / 60, range.endH)
    if (endH - cursor < 0.5) break // 剩余时间不足 30 分钟，不再安排

    blocks.push({
      time: `${fmtTime(cursor)} - ${fmtTime(endH)}`,
      type: 'focus',
      title: `${isUrgent ? '🔴 ' : ''}${task.title}`,
      reason: isUrgent
        ? '重要/紧急任务，优先处理'
        : `优先级 ${task.priority}，安排在精力较好的时段`,
    })

    cursor = endH

    // 安排 15 分钟休息（除非是最后一个块）
    if (cursor + 0.5 < range.endH && taskIdx < sortedTasks.length - 1) {
      blocks.push({
        time: `${fmtTime(cursor)} - ${fmtTime(cursor + 0.25)}`,
        type: 'break',
        title: '休息 15 分钟',
        reason: '喝水、活动、远眺，避免久坐疲劳',
      })
      cursor += 0.25
    }

    taskIdx++
  }

  // 3. 插入今日提醒（按时间点）
  rangeReminders.forEach((r) => {
    const rTime = new Date(r.remindAt)
    const rH = rTime.getHours()
    const rM = rTime.getMinutes()
    if (rH >= range.startH && rH < range.endH) {
      blocks.push({
        time: `${fmtHM(rH, rM)} ⏰`,
        type: 'routine',
        title: `提醒：${r.title}`,
        reason: r.level === 'urgent' ? '紧急提醒，请按时处理' : '已安排的提醒事项',
      })
    }
  })

  // 4. 复盘总结（最后 15 分钟）
  if (cursor + 0.25 <= range.endH) {
    blocks.push({
      time: `${fmtTime(range.endH - 0.25)} - ${fmtTime(range.endH)}`,
      type: 'review',
      title: '复盘今日成果，规划明日重点',
      reason: '回顾完成情况，把未完成项挪到明天，保持节奏',
    })
  }

  // 按 type 重新排序：warmup → focus → routine → break → review
  // 但保留 time 顺序，所以按 time 排序（time 字符串前 5 字符可比较）
  blocks.sort((a, b) => a.time.localeCompare(b.time))

  // 默认提示
  if (tips.length === 0) {
    tips.push('建议每专注 90 分钟休息一次')
    if (pendingTasks.length > 5) {
      tips.push(`今日有 ${pendingTasks.length} 项待办，必要时可拒绝或简化低优先级任务`)
    }
  }

  const summary = `📅 已为你规划${range.label}的时段安排，共 ${blocks.filter(b => b.type === 'focus').length} 个专注块。${pendingTasks.length > 0 ? `覆盖 ${Math.min(taskIdx, pendingTasks.length)}/${pendingTasks.length} 项待办。` : '当前没有待办任务，安排了热身和复盘。'}`

  return {
    range: {
      label: range.label,
      start: fmtTime(range.startH),
      end: fmtTime(range.endH),
    },
    blocks,
    tips,
    summary,
  }
}

/**
 * DG-16 危机信号检测
 *
 * 设计原则（合规）：
 * - 仅识别"风险信号"，不生成任何鼓励/指导性内容
 * - 直接引导用户到专业危机干预资源（热线、心理援助机构）
 * - 不替代专业诊断，不分析风险等级细节
 *
 * 三个等级：
 * - critical：明确表达自杀意念或自伤计划（立即干预）
 * - high：情绪极度低落、无望感、想消失（高度关注）
 * - moderate：负面情绪、压力大、疲惫（关怀提示）
 */
type CrisisLevel = 'critical' | 'high' | 'moderate' | null

interface CrisisIntervention {
  level: 'critical' | 'high' | 'moderate'
  hotlines: Array<{ name: string; phone: string; desc: string }>
  message: string
  suggestions: string[]
}

function detectCrisisSignal(content: string): CrisisLevel {
  const text = content.toLowerCase()

  // critical：明确自杀意念/自伤计划
  const criticalPatterns = [
    /不想活/,
    /想死/,
    /自杀/,
    /结束.{0,4}生命/,
    /了结自己/,
    /结束一切/,
    /活不下去/,
    /自杀方法/,
    /怎么死/,
    /跳楼/,
    /割腕/,
    /吃药.{0,6}死|吃.{0,4}药.{0,4}自杀/,
    /上吊/,
    /烧炭/,
    /安乐死/,
    /kill\s*myself/i,
    /end.{0,4}my.{0,4}life/i,
    /想走.{0,2}绝路/,
    /生无可恋/,
  ]
  for (const p of criticalPatterns) {
    if (p.test(text)) return 'critical'
  }

  // high：无望感、消失念头、严重抑郁情绪
  const highPatterns = [
    /想消失/,
    /消失了.{0,4}好/,
    /没有意义/,
    /毫无意义/,
    /活着.{0,4}没意义/,
    /不想面对/,
    /撑不下去/,
    /坚持不下去/,
    /解脱/,
    /一了百了/,
    /生不如死/,
    /想永远睡/,
    /不想醒来/,
  ]
  for (const p of highPatterns) {
    if (p.test(text)) return 'high'
  }

  // moderate：负面情绪、压力大
  const moderatePatterns = [
    /很累.{0,4}不想动/,
    /崩溃/,
    /绝望/,
    /痛苦.{0,4}不堪/,
    /压抑.{0,4}难/,
    /很难受.{0,4}想哭/,
    /抑郁/,
    /焦虑.{0,4}睡不着/,
  ]
  for (const p of moderatePatterns) {
    if (p.test(text)) return 'moderate'
  }

  return null
}

/** 根据危机等级生成干预回复（不分析、不指导，只引导到专业资源） */
function generateCrisisReply(level: 'critical' | 'high' | 'moderate'): ReplyResult {
  const intervention: CrisisIntervention = {
    level,
    hotlines: [
      {
        name: '全国心理援助热线',
        phone: '400-161-9995',
        desc: '24 小时免费心理危机干预热线，由专业心理咨询师接听',
      },
      {
        name: '北京心理危机研究与干预中心',
        phone: '010-82951332',
        desc: '24 小时热线，专注于自杀危机干预',
      },
      {
        name: '生命热线',
        phone: '400-821-1215',
        desc: '24 小时情绪支持与危机干预',
      },
    ],
    message: '',
    suggestions: [],
  }

  if (level === 'critical') {
    intervention.message =
      '我听到你正在经历非常艰难的时刻，你的感受很重要。请现在就拨打下方任一热线，会有专业的人陪伴你度过这一刻。你不是一个人。'
    intervention.suggestions = [
      '立即拨打 400-161-9995（全国心理援助热线，24 小时）',
      '联系你信任的亲友或家人，告诉他们你现在的感受',
      '如情况紧急请直接拨打 120 或前往最近的医院急诊',
      '暂时远离可能伤害自己的物品',
    ]
  } else if (level === 'high') {
    intervention.message =
      '你愿意说出这些感受已经非常勇敢。这样的时刻你不是一个人在面对，请试试拨打下方热线，让专业的人陪你聊聊。'
    intervention.suggestions = [
      '拨打心理援助热线 400-161-9995，与专业咨询师聊聊',
      '告诉身边信任的人你现在的感受，不要独自承受',
      '尝试做一些让你感到安全的小事：喝杯温水、深呼吸',
      '如果情绪持续恶化，请尽快寻求精神科医生帮助',
    ]
  } else {
    intervention.message =
      '听起来你最近压力很大。情绪低落是会过去的，给自己一些喘息的时间。如果需要聊聊，下方热线随时可以拨打。'
    intervention.suggestions = [
      '若需要倾诉可拨打 400-161-9995',
      '给自己安排一个短暂的休息，做点喜欢的事',
      '与朋友或家人聊一聊近况',
      '规律作息、适当运动有助于缓解情绪',
    ]
  }

  return {
    reply: intervention.message,
    messageType: 'crisis_card',
    metadata: { crisis: intervention },
  }
}

