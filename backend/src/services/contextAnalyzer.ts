/**
 * 上下文分析器（ContextAnalyzer）
 *
 * 核心能力：基于 ContextCollector 收集的全模块上下文 + 用户消息，
 * 分析用户意图并生成上下文感知的智能回复。
 *
 * 分析流程：
 * 1. 意图识别：从用户消息中提取意图（查询任务/记账/规划/闲聊等）
 * 2. 上下文匹配：从收集的上下文中提取与意图相关的数据
 * 3. 生成回复：结合上下文数据生成个性化回复
 * 4. 主动洞察：基于上下文状态评分提供主动建议
 * 5. 默认路径：未匹配明确意图时，结合上下文生成"上下文感知"的默认回复
 *
 * 与 ai-reply.ts 的关系：
 * - ai-reply.ts 的 generateReply 会在调用前先 collectUserContext
 * - 然后调用 analyzeWithContext 生成增强回复
 * - 如果 analyzeWithContext 返回 null，则回退到原有规则匹配
 */

import type { UserContext } from './contextCollector.js'

// ============ 类型定义 ============

export type IntentType =
  | 'query_tasks'       // 查询任务/待办
  | 'query_finance'     // 查询财务/余额
  | 'record_expense'   // 记账
  | 'query_diet'       // 查询饮食
  | 'query_sleep'      // 查询睡眠
  | 'query_countdown'  // 查询倒计时
  | 'query_fragments'  // 查询碎片
  | 'plan_schedule'    // 规划日程
  | 'generate_handover' // 生成交接
  | 'greeting'         // 问候
  | 'help'             // 帮助
  | 'chitchat'         // 闲聊（情感/感谢/确认/提问/无聊等）
  | 'crisis'           // 危机信号
  | 'context_aware'    // 上下文感知默认
  | 'fragment_store'   // 存储碎片

export interface AnalysisResult {
  /** 识别到的意图 */
  intent: IntentType
  /** 置信度 0-1 */
  confidence: number
  /** 回复文本 */
  reply: string
  /** 消息类型（与 ai-reply.ts 对齐） */
  messageType: 'text' | 'task_card' | 'bill_card' | 'diet_card' | 'handover_card' | 'suggestion' | 'schedule_card' | 'fragment_card' | 'digest_card' | 'connections_card' | 'insights_card' | 'preparation_card' | 'crisis_card' | 'context_card'
  /** 元数据 */
  metadata?: unknown
  /** 主动建议（基于上下文） */
  proactiveSuggestions?: string[]
  /** 引用的上下文数据摘要 */
  contextRefs?: string[]
}

// ============ 意图识别 ============

/**
 * 从用户消息中识别意图
 *
 * 使用关键词匹配 + 上下文增强：
 * - 基础关键词匹配确定主要意图
 * - 上下文数据增强置信度（如用户问"今天怎样"且有任务，则意图偏向 query_tasks）
 */
function detectIntent(message: string, ctx: UserContext): { intent: IntentType; confidence: number } {
  const text = message.toLowerCase().trim()

  // 危机信号检测（最高优先级）
  if (/不想活|想死|自杀|结束生命|活不下去|了结自己/.test(text)) {
    return { intent: 'crisis', confidence: 1.0 }
  }

  // 记账
  if (/记账|花了|消费|支出|多少钱|收入/.test(text)) {
    return { intent: 'record_expense', confidence: 0.9 }
  }

  // 告别（在问候之前检测，因为"晚安"既可能是问候也可能是告别）
  if (/拜拜|再见|byebye|bye|晚安|回见|下次见/.test(text)) {
    return { intent: 'chitchat', confidence: 0.85 }
  }

  // 问候
  if (/^(早安|早上好|中午好|下午好|晚上好|你好|嗨|hi|hello|hey)/.test(text)) {
    return { intent: 'greeting', confidence: 0.95 }
  }

  // 帮助
  if (/帮助|help|能干啥|功能|怎么用|你能做什么/.test(text)) {
    return { intent: 'help', confidence: 0.9 }
  }

  // 查询任务
  if (/今日|今天|待办|任务|要做|要做啥|有什么事/.test(text) && /查看|看|列表|有啥|有什么|怎么样|怎样|状态/.test(text)) {
    return { intent: 'query_tasks', confidence: 0.85 }
  }
  // "今天怎样" 且有任务
  if (/今天(怎么样|怎样|咋样|如何)/.test(text) && ctx.tasks.todayPendingCount > 0) {
    return { intent: 'query_tasks', confidence: 0.7 }
  }

  // 查询财务
  if (/余额|多少钱|钱包|还有多少/.test(text)) {
    return { intent: 'query_finance', confidence: 0.85 }
  }

  // 查询饮食
  if (/吃了|吃了啥|饮食|热量|卡路里/.test(text)) {
    return { intent: 'query_diet', confidence: 0.8 }
  }

  // 查询睡眠
  if (/睡了|睡眠|昨晚|睡得好/.test(text)) {
    return { intent: 'query_sleep', confidence: 0.8 }
  }

  // 查询倒计时
  if (/倒计时|还有多久|还有多少天|几天后/.test(text)) {
    return { intent: 'query_countdown', confidence: 0.85 }
  }

  // 查询碎片（需要查询上下文，避免"我有个想法"误触发）
  if (/碎片|记录的信息|收藏的|笔记/.test(text) || (/想法/.test(text) && /查看|看|我的|有什么|哪些/.test(text))) {
    return { intent: 'query_fragments', confidence: 0.8 }
  }

  // 规划日程
  if (/规划|安排|计划|日程|时间表/.test(text)) {
    return { intent: 'plan_schedule', confidence: 0.85 }
  }

  // 生成交接
  if (/交接|交班|移交|工作总结|交接单/.test(text)) {
    return { intent: 'generate_handover', confidence: 0.9 }
  }

  // ---- 闲聊模式识别（在所有功能意图之后、默认之前） ----

  // 含 URL 的消息优先走碎片存储（不闲聊）
  if (/https?:\/\//.test(text)) {
    return { intent: 'context_aware', confidence: 0.4 }
  }

  // 感谢
  if (/谢谢|感谢|多谢|谢啦|辛苦了|thanks|thank/.test(text)) {
    return { intent: 'chitchat', confidence: 0.85 }
  }

  // 确认/应答
  if (/^(好的|好|嗯|行|ok|可以|没问题|收到|了解|明白|知道啦|懂了|嗯嗯|好滴)$/.test(text)) {
    return { intent: 'chitchat', confidence: 0.8 }
  }

  // 否定/拒绝
  if (/^(不用|不用了|没事|算了|不要|不行|没有|没|不用啦|先不用)$/.test(text)) {
    return { intent: 'chitchat', confidence: 0.8 }
  }

  // 夸赞 AI（在正面情绪之前检测，避免"你真棒"被误判为情绪表达）
  if (/你真棒|你好厉害|你真聪明|你真好|爱你|喜欢你|你真有用|真厉害/.test(text)) {
    return { intent: 'chitchat', confidence: 0.8 }
  }

  // 情绪表达 - 正面
  if (/开心|高兴|快乐|哈哈|嘿嘿|嘻嘻|太好了|不错|棒|牛|厉害|爽|美滋滋/.test(text)) {
    return { intent: 'chitchat', confidence: 0.75 }
  }
  // 情绪表达 - 负面
  if (/累|困|疲惫|心力交瘁|撑不住|压力|焦虑|烦躁|烦|郁闷|低落|难过|不开心|孤独|无聊|没意思|没动力|丧/.test(text)) {
    return { intent: 'chitchat', confidence: 0.8 }
  }

  // 询问 AI 自身
  if (/你是谁|你叫什么|你是什么|你是ai|你是机器人|你会什么|你能做什么|你怎么工作的/.test(text)) {
    return { intent: 'chitchat', confidence: 0.75 }
  }

  // 在吗/打招呼
  if (/^(在吗|在不在|有人吗|你在吗)/.test(text)) {
    return { intent: 'chitchat', confidence: 0.8 }
  }

  // 随意提问（带问号或疑问词，但不匹配其他意图）
  if (/[？?]$/.test(text) || /怎么样|好不好|可以吗|对吗|是吗|什么|为什么|怎么|哪里|哪个/.test(text)) {
    return { intent: 'chitchat', confidence: 0.6 }
  }

  // 短句陈述（<15字且不含功能关键词，视为闲聊）
  if (text.length <= 15 && !/记账|花了|待办|任务|余额|倒计时|碎片|规划|交接|帮助/.test(text)) {
    return { intent: 'chitchat', confidence: 0.55 }
  }

  // 上下文感知默认
  return { intent: 'context_aware', confidence: 0.4 }
}

// ============ 上下文感知回复生成 ============

/**
 * 基于上下文生成智能回复
 *
 * 与传统规则匹配的区别：
 * - 传统：匹配关键词 → 查库 → 返回卡片
 * - 上下文感知：先收集全量上下文 → 识别意图 → 引用上下文数据生成回复
 *
 * 返回 null 表示该消息应由 ai-reply.ts 的原有规则处理（如碎片存储默认路径）
 */
export function analyzeWithContext(
  message: string,
  ctx: UserContext,
): AnalysisResult {
  const { intent, confidence } = detectIntent(message, ctx)
  const hour = ctx.hour
  const period = hour < 6 ? '深夜' : hour < 11 ? '早上' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜'

  // 主动建议列表
  const proactiveSuggestions: string[] = []
  const contextRefs: string[] = []

  // 根据状态评分生成主动建议
  if (ctx.statusScore.taskPressure > 60) {
    proactiveSuggestions.push('任务压力较大，建议优先处理重要事项')
  }
  if (ctx.statusScore.financialHealth < 40 && ctx.finance.monthExpense > 0) {
    proactiveSuggestions.push('本月支出偏高，建议复盘消费')
  }
  if (ctx.health.todayMeals === 0 && hour >= 12) {
    proactiveSuggestions.push('今日尚未记录饮食，记得吃饭')
  }
  if (ctx.health.sleepHint === '睡眠不足，注意休息') {
    proactiveSuggestions.push('昨晚睡眠不足，今天注意节奏')
  }
  if (ctx.events.conflicts > 0) {
    proactiveSuggestions.push(`今日有 ${ctx.events.conflicts} 个事件时间冲突`)
  }

  // ============ 按意图生成回复 ============

  switch (intent) {
    // ---- 问候：结合上下文生成个性化问候 ----
    case 'greeting': {
      const parts: string[] = []
      // 时段问候
      let greeting = period
      if (hour < 11 && ctx.health.lastSleep) {
        if (ctx.health.lastSleep.durationMin >= 480) greeting = `${period}，昨晚睡得很充足`
        else if (ctx.health.lastSleep.durationMin < 360) greeting = `${period}，昨晚睡得有点少`
      }
      parts.push(greeting)

      // 任务概况
      if (ctx.tasks.todayPendingCount > 0) {
        const importantCount = ctx.tasks.todayPending.filter(t => t.important).length
        if (importantCount > 0) {
          parts.push(`今天有 ${importantCount} 件重要事项待处理`)
        } else {
          parts.push(`今天有 ${ctx.tasks.todayPendingCount} 个待办`)
        }
      } else {
        parts.push('今天没有待办，可以放松一下')
      }

      // 已完成
      if (ctx.tasks.todayDoneCount > 0) {
        parts.push(`已完成 ${ctx.tasks.todayDoneCount} 项`)
      }

      // 下一个事件
      if (ctx.events.nextEvent) {
        const eventTime = new Date(ctx.events.nextEvent.time)
        const minsToEvent = Math.round((eventTime.getTime() - Date.now()) / 60000)
        if (minsToEvent > 0 && minsToEvent < 180) {
          parts.push(`下一个事项：${ctx.events.nextEvent.title}（${minsToEvent < 60 ? `${minsToEvent} 分钟后` : `${Math.floor(minsToEvent / 60)} 小时后`}）`)
          contextRefs.push(`nextEvent: ${ctx.events.nextEvent.title}`)
        }
      }

      // 财务提示
      if (ctx.finance.todayExpense > 0) {
        parts.push(`今日已消费 ¥${ctx.finance.todayExpense.toFixed(0)}`)
      }

      // 碎片提示
      if (ctx.fragments.undigestedCount > 0) {
        parts.push(`有 ${ctx.fragments.undigestedCount} 条碎片待整合`)
      }

      // 倒计时临近
      const urgentCountdowns = ctx.countdowns.items.filter(c => c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= 3)
      if (urgentCountdowns.length > 0) {
        parts.push(`${urgentCountdowns[0].title} 还有 ${urgentCountdowns[0].daysLeft} 天`)
      }

      return {
        intent,
        confidence,
        reply: parts.join('，') + '。',
        messageType: 'text',
        proactiveSuggestions: proactiveSuggestions.slice(0, 2),
        contextRefs,
      }
    }

    // ---- 查询任务：返回任务卡片 + 上下文分析 ----
    case 'query_tasks': {
      if (ctx.tasks.todayPendingCount === 0) {
        return {
          intent,
          confidence,
          reply: '今天没有待办任务，节奏不错！' + (ctx.tasks.todayDoneCount > 0 ? `已完成 ${ctx.tasks.todayDoneCount} 项，做得很好。` : ''),
          messageType: 'text',
          proactiveSuggestions: proactiveSuggestions.slice(0, 2),
        }
      }

      // 生成上下文分析
      const analysisParts: string[] = []
      analysisParts.push(`今日待办 ${ctx.tasks.todayPendingCount} 项`)
      if (ctx.tasks.importantPending.length > 0) {
        analysisParts.push(`其中 ${ctx.tasks.importantPending.length} 项重要`)
      }
      if (ctx.tasks.upcomingDeadlines.length > 0) {
        const nearest = ctx.tasks.upcomingDeadlines[0]
        analysisParts.push(`最近截止：${nearest.title}（${nearest.daysLeft} 天后）`)
        contextRefs.push(`nearestDeadline: ${nearest.title}`)
      }
      if (ctx.events.conflicts > 0) {
        analysisParts.push(`有 ${ctx.events.conflicts} 个事件时间冲突`)
      }

      return {
        intent,
        confidence,
        reply: `📋 ${analysisParts.join('，')}。`,
        messageType: 'task_card',
        metadata: {
          tasks: ctx.tasks.todayPending,
          contextAnalysis: {
            totalPending: ctx.tasks.totalPendingCount,
            todayDone: ctx.tasks.todayDoneCount,
            importantCount: ctx.tasks.importantPending.length,
            upcomingDeadlines: ctx.tasks.upcomingDeadlines,
            taskPressure: ctx.statusScore.taskPressure,
          },
        },
        proactiveSuggestions: proactiveSuggestions.slice(0, 3),
        contextRefs,
      }
    }

    // ---- 查询财务 ----
    case 'query_finance': {
      const parts: string[] = []
      if (ctx.finance.walletBalance !== null) {
        parts.push(`💰 钱包余额 ¥${ctx.finance.walletBalance.toFixed(2)}`)
        if (ctx.finance.walletFrozen) parts.push('（钱包已冻结）')
      }
      if (ctx.finance.todayExpense > 0) {
        parts.push(`今日消费 ¥${ctx.finance.todayExpense.toFixed(2)}`)
      }
      if (ctx.finance.monthExpense > 0) {
        parts.push(`本月支出 ¥${ctx.finance.monthExpense.toFixed(2)}`)
      }
      if (ctx.finance.monthIncome > 0) {
        parts.push(`本月收入 ¥${ctx.finance.monthIncome.toFixed(2)}`)
        const balance = ctx.finance.monthIncome - ctx.finance.monthExpense
        if (balance < 0) {
          parts.push(`本月超支 ¥${(-balance).toFixed(2)}`)
        } else {
          parts.push(`本月结余 ¥${balance.toFixed(2)}`)
        }
      }
      return {
        intent,
        confidence,
        reply: parts.length > 0 ? parts.join('，') + '。' : '暂无财务数据',
        messageType: 'text',
        proactiveSuggestions: proactiveSuggestions.slice(0, 2),
        contextRefs,
      }
    }

    // ---- 查询饮食 ----
    case 'query_diet': {
      if (ctx.health.todayMeals === 0) {
        return {
          intent,
          confidence,
          reply: '今天还没有记录饮食。可以告诉我"吃了XX"，我帮你记录。',
          messageType: 'text',
          proactiveSuggestions: ['及时记录饮食，便于营养分析'],
        }
      }
      const parts: string[] = [`今日已记录 ${ctx.health.todayMeals} 餐`]
      parts.push(`总热量 ${ctx.health.totalCalories} 大卡`)
      if (ctx.health.totalCalories < 500 && hour >= 18) {
        parts.push('摄入偏低，建议补充')
      } else if (ctx.health.totalCalories > 2500) {
        parts.push('摄入偏高，注意控制')
      }
      return {
        intent,
        confidence,
        reply: '🍱 ' + parts.join('，') + '。',
        messageType: 'diet_card',
        metadata: {
          mealType: hour < 10 ? 'breakfast' : hour < 14 ? 'lunch' : hour < 17 ? 'snack' : 'dinner',
          meals: ctx.health.meals,
          totalCalories: ctx.health.totalCalories,
        },
        proactiveSuggestions: [],
        contextRefs,
      }
    }

    // ---- 查询睡眠 ----
    case 'query_sleep': {
      if (!ctx.health.lastSleep) {
        return {
          intent,
          confidence,
          reply: '最近没有睡眠记录。可以在"生活"页面记录昨晚的睡眠。',
          messageType: 'text',
        }
      }
      const sleep = ctx.health.lastSleep
      const hours = Math.floor(sleep.durationMin / 60)
      const mins = sleep.durationMin % 60
      const parts: string[] = [`昨晚睡眠 ${hours} 小时${mins > 0 ? ` ${mins} 分钟` : ''}`]
      if (ctx.health.sleepHint) parts.push(ctx.health.sleepHint)
      if (sleep.quality) {
        const qualityText = sleep.quality >= 4 ? '睡眠质量很好' : sleep.quality >= 3 ? '睡眠质量一般' : '睡眠质量不佳'
        parts.push(qualityText)
      }
      return {
        intent,
        confidence,
        reply: '😴 ' + parts.join('，') + '。',
        messageType: 'text',
        proactiveSuggestions: ctx.health.sleepHint === '睡眠不足，注意休息' ? ['今晚早点休息，保证 7-8 小时睡眠'] : [],
        contextRefs,
      }
    }

    // ---- 查询倒计时 ----
    case 'query_countdown': {
      if (ctx.countdowns.activeCount === 0) {
        return {
          intent,
          confidence,
          reply: '目前没有活跃的倒计时。可以在倒计时页面创建。',
          messageType: 'text',
        }
      }
      const items = ctx.countdowns.items.map(c => {
        const label = c.daysLeft !== null
          ? c.daysLeft < 0 ? `已超期 ${-c.daysLeft} 天`
            : c.daysLeft === 0 ? '今天'
            : `还剩 ${c.daysLeft} 天`
          : '无截止日期'
        return `${c.isImportant ? '⭐' : '⏰'} ${c.title} · ${label}`
      })
      return {
        intent,
        confidence,
        reply: `⏰ 活跃倒计时 ${ctx.countdowns.activeCount} 个：\n${items.join('\n')}`,
        messageType: 'text',
        metadata: { countdowns: ctx.countdowns.items },
        proactiveSuggestions: items.length > 0 ? [`最近的：${ctx.countdowns.items[0].title}`] : [],
        contextRefs,
      }
    }

    // ---- 查询碎片 ----
    case 'query_fragments': {
      if (ctx.fragments.todayCount === 0) {
        return {
          intent,
          confidence,
          reply: '今天还没有碎片记录。发送任何文字、链接或想法，我会自动帮你分类存储。',
          messageType: 'text',
        }
      }
      return {
        intent,
        confidence,
        reply: `🧩 今日已记录 ${ctx.fragments.todayCount} 条碎片${ctx.fragments.undigestedCount > 0 ? `，其中 ${ctx.fragments.undigestedCount} 条待整合` : ''}。`,
        messageType: 'fragment_card',
        metadata: { fragments: ctx.fragments.todayItems },
        proactiveSuggestions: ctx.fragments.undigestedCount > 0 ? ['说"整合碎片"可以生成今日总结'] : [],
        contextRefs,
      }
    }

    // ---- 帮助 ----
    case 'help': {
      const helpText = [
        '我可以帮你：',
        '📋 查看任务（说"今天待办"）',
        '💰 查余额（说"余额"）',
        '🍱 记饮食（说"吃了XX"）',
        '😴 查睡眠（说"昨晚睡怎样"）',
        '⏰ 查倒计时（说"还有多久"）',
        '🧩 查碎片（说"今日碎片"）',
        '📅 规划日程（说"帮我规划下午"）',
        '📝 生成交接（说"生成交接单"）',
        '',
        '你也可以直接发任何文字，我会自动记录和分析~',
      ].join('\n')
      return {
        intent,
        confidence,
        reply: helpText,
        messageType: 'text',
      }
    }

    // ---- 危机信号 ----
    case 'crisis': {
      return {
        intent,
        confidence,
        reply: '我听到你正在经历非常艰难的时刻，你的感受很重要。请现在就拨打下方任一热线，会有专业的人陪伴你度过这一刻。你不是一个人。',
        messageType: 'crisis_card',
        metadata: {
          crisis: {
            level: 'critical',
            hotlines: [
              { name: '全国心理援助热线', phone: '400-161-9995', desc: '24 小时免费心理危机干预热线' },
              { name: '北京心理危机研究与干预中心', phone: '010-82951332', desc: '24 小时热线' },
            ],
            message: '我听到你正在经历非常艰难的时刻，你的感受很重要。请现在就拨打下方任一热线。',
            suggestions: [
              '立即拨打 400-161-9995（全国心理援助热线，24 小时）',
              '联系你信任的亲友或家人',
              '如情况紧急请直接拨打 120',
            ],
          },
        },
      }
    }

    // ---- 闲聊：上下文感知的自然对话 ----
    case 'chitchat': {
      const reply = generateChitchatReply(message, ctx, hour, period, proactiveSuggestions)
      return {
        intent,
        confidence,
        reply: reply.text,
        messageType: 'text',
        proactiveSuggestions: reply.suggestions,
        contextRefs: [],
      }
    }

    // ---- 上下文感知默认回复 ----
    case 'context_aware':
    default: {
      // 长文本默认存储为碎片，但给出上下文感知的确认回复
      const fragmentHint = classifyChitchatContent(message)
      const replyParts: string[] = []

      if (fragmentHint === 'idea') {
        replyParts.push('这个想法挺有意思的，我已经帮你记下来了')
      } else if (fragmentHint === 'todo') {
        replyParts.push('收到，这看起来是个待办事项，已帮你记录')
        proactiveSuggestions.push('查看今日待办')
      } else if (fragmentHint === 'link') {
        replyParts.push('链接已收藏，方便你之后查看')
      } else if (fragmentHint === 'note') {
        replyParts.push('已帮你记下这段内容')
      } else {
        replyParts.push('已记录这条信息')
      }

      // 附加上下文感知的后续建议
      if (ctx.tasks.todayPendingCount > 0) {
        replyParts.push(`对了，今天还有 ${ctx.tasks.todayPendingCount} 个待办`)
      } else if (ctx.health.todayMeals === 0 && hour >= 12) {
        replyParts.push('记得吃饭哦')
      }

      return {
        intent: 'fragment_store',
        confidence: 0.3,
        reply: replyParts.join('，') + '。',
        messageType: 'text',
        proactiveSuggestions: proactiveSuggestions.slice(0, 2),
      }
    }
  }
}

// ============ 闲聊回复生成 ============

/**
 * 碎片内容分类（用于 context_aware 默认路径的提示文案）
 */
function classifyChitchatContent(message: string): string {
  const text = message.toLowerCase().trim()
  if (/https?:\/\//.test(text)) return 'link'
  if (/应该|需要|记得|待办|要做|得去|别忘了|提醒我/.test(text)) return 'todo'
  if (/想法|灵感|idea|如果|能不能|突然觉得|或许可以|不如/.test(text)) return 'idea'
  return 'note'
}

/**
 * 从数组中随机选一个（用于回复多样化）
 */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

interface ChitchatResult {
  text: string
  suggestions: string[]
}

/**
 * 生成上下文感知的闲聊回复
 *
 * 设计原则：
 * 1. 回复多样化：同类消息有多个候选回复，随机选取
 * 2. 上下文关联：引用用户的任务/健康/财务状态
 * 3. 情感共鸣：对情绪表达给出共情回应
 * 4. 自然引导：适时建议相关功能，但不强制
 */
function generateChitchatReply(
  message: string,
  ctx: UserContext,
  hour: number,
  period: string,
  proactiveSuggestions: string[],
): ChitchatResult {
  const text = message.toLowerCase().trim()
  const suggestions: string[] = []

  // ---- 感谢 ----
  if (/谢谢|感谢|多谢|谢啦|辛苦了|thanks|thank/.test(text)) {
    const replies = [
      '不客气~ 能帮到你就好。',
      '应该的，随时找我。',
      '哈哈不谢，我一直在的。',
    ]
    // 附加上下文建议
    if (ctx.tasks.todayPendingCount > 0) {
      suggestions.push('查看今日待办')
    }
    if (ctx.fragments.undigestedCount > 0) {
      suggestions.push('整合碎片')
    }
    return { text: pick(replies), suggestions: suggestions.slice(0, 2) }
  }

  // ---- 告别 ----
  if (/拜拜|再见|byebye|bye|晚安|回见|下次见/.test(text)) {
    const replies: string[] = []
    if (/晚安/.test(text) || hour >= 22) {
      replies.push('晚安~ 好好休息，明天见。')
      if (ctx.tasks.todayPendingCount > 0) {
        replies.push(`晚安！今天还有 ${ctx.tasks.todayPendingCount} 个待办没完成，明天继续加油。`)
      } else {
        replies.push('晚安~ 今天的事情都处理完了，安心休息吧。')
      }
    } else {
      replies.push('回头见~ 有事随时找我。')
      if (ctx.tasks.todayPendingCount > 0) {
        replies.push(`拜拜~ 对了今天还有 ${ctx.tasks.todayPendingCount} 个待办，别忘了哦。`)
      }
    }
    return { text: pick(replies), suggestions: [] }
  }

  // ---- 确认/应答 ----
  if (/^(好的|好|嗯|行|ok|可以|没问题|收到|了解|明白|知道啦|懂了|嗯嗯|好滴)$/.test(text)) {
    const replies = [
      '好的~ 需要什么随时说。',
      '嗯嗯，我在这。',
      '收到~ 还有什么需要帮忙的吗？',
    ]
    if (ctx.tasks.todayPendingCount > 0) {
      suggestions.push('查看今日待办')
    }
    if (ctx.health.todayMeals === 0 && hour >= 12) {
      suggestions.push('我吃了午餐')
    }
    return { text: pick(replies), suggestions: suggestions.slice(0, 2) }
  }

  // ---- 否定/拒绝 ----
  if (/^(不用|不用了|没事|算了|不要|不行|没有|没|不用啦|先不用)$/.test(text)) {
    const replies = [
      '好的，那先这样~ 有需要随时叫我。',
      '没问题，不急。',
      '嗯嗯，了解~ 随时找我。',
    ]
    return { text: pick(replies), suggestions: [] }
  }

  // ---- 夸赞 AI（在正面情绪之前检测） ----
  if (/你真棒|你好厉害|你真聪明|你真好|爱你|喜欢你|你真有用|真厉害/.test(text)) {
    const replies = [
      '哈哈过奖了~ 能帮到你就是我的价值。',
      '谢谢夸奖！我会继续努力的。',
      '你这么说我很开心~ 还有什么需要我做的吗？',
    ]
    return { text: pick(replies), suggestions: [] }
  }

  // ---- 正面情绪 ----
  if (/开心|高兴|快乐|哈哈|嘿嘿|嘻嘻|太好了|不错|棒|牛|厉害|爽|美滋滋/.test(text)) {
    const replies = [
      `看到你心情不错，我也跟着开心了~ ${period}好心情要保持哦。`,
      '哈哈，不错不错！心情好的时候效率也会更高。',
      '太好了！趁状态好，要不要把待办也处理一下？',
    ]
    if (ctx.tasks.todayPendingCount > 0) {
      suggestions.push('查看今日待办')
      suggestions.push('帮我规划时间')
    }
    return { text: pick(replies), suggestions: suggestions.slice(0, 2) }
  }

  // ---- 负面情绪 ----
  if (/累|困|疲惫|心力交瘁|撑不住/.test(text)) {
    const replies = [
      `${period}确实容易累。适当休息一下，别硬撑。`,
      '累了就歇会儿，磨刀不误砍柴工。',
      '辛苦了。要不要我帮你看看接下来的安排，简化一下？',
    ]
    if (ctx.tasks.todayPendingCount > 3) {
      suggestions.push('帮我规划时间')
      suggestions.push('查看今日待办')
    } else {
      suggestions.push('帮我规划下午')
    }
    return { text: pick(replies), suggestions: suggestions.slice(0, 2) }
  }
  if (/压力|焦虑|烦躁|烦|郁闷/.test(text)) {
    const replies = [
      '深呼吸~ 一步一步来，事情总会处理完的。',
      '理解你的感受。要不要我帮你梳理一下待办，分出轻重缓急？',
      '别给自己太大压力，今天能做多少做多少。',
    ]
    if (ctx.tasks.todayPendingCount > 0) {
      suggestions.push('查看今日待办')
      suggestions.push('帮我规划时间')
    }
    return { text: pick(replies), suggestions: suggestions.slice(0, 2) }
  }
  if (/低落|难过|不开心|孤独|丧|没动力/.test(text)) {
    const replies = [
      '我一直在的。有什么想聊的都可以跟我说。',
      '没关系，状态不好的时候就允许自己慢一点。',
      '陪你待会儿~ 不用急着做什么，想聊什么都可以。',
    ]
    return { text: pick(replies), suggestions: [] }
  }
  if (/无聊|没意思|没事干/.test(text)) {
    const replies: string[] = []
    if (ctx.tasks.todayPendingCount > 0) {
      replies.push(`正好有 ${ctx.tasks.todayPendingCount} 个待办可以处理一下~`)
      suggestions.push('查看今日待办')
    } else {
      replies.push('无聊的话，不如规划一下明天？或者跟我聊聊天也行。')
      suggestions.push('帮我规划明天')
    }
    if (ctx.fragments.undigestedCount > 0) {
      replies.push('你今天记录了一些碎片，要不要整合看看？')
      suggestions.push('整合碎片')
    }
    if (replies.length === 0) {
      replies.push('没事干也挺好的，难得清闲~ 想聊点什么？')
    }
    return { text: pick(replies), suggestions: suggestions.slice(0, 2) }
  }

  // ---- 询问 AI 自身 ----
  if (/你是谁|你叫什么|你是什么|你是ai|你是机器人|你会什么|你能做什么|你怎么工作的/.test(text)) {
    const replies = [
      '我是你的 AI 小助，可以帮你管理任务、记账、记饮食、设提醒、查倒计时，还能陪你聊天~',
      '我是 AI 小助，你的私人助理。说"帮助"可以看完整功能列表。',
      '我是个 AI 助理，平时帮你打理日常事务。有什么需要尽管说~',
    ]
    suggestions.push('帮助')
    return { text: pick(replies), suggestions }
  }

  // ---- "在吗" ----
  if (/^(在吗|在不在|有人吗|你在吗)/.test(text)) {
    const replies = [
      `在的~ ${period}好，有什么事？`,
      '我一直在~ 说吧，需要什么帮忙？',
      '在呢！随时可以开始。',
    ]
    if (ctx.tasks.todayPendingCount > 0) {
      suggestions.push('查看今日待办')
    }
    return { text: pick(replies), suggestions: suggestions.slice(0, 1) }
  }

  // ---- 随意提问 ----
  if (/[？?]$/.test(text) || /怎么样|好不好|可以吗|对吗|是吗|什么|为什么|怎么|哪里|哪个/.test(text)) {
    // 尝试基于上下文回答
    const parts: string[] = []
    if (/今天|现在|目前/.test(text)) {
      if (ctx.tasks.todayPendingCount > 0) {
        parts.push(`目前有 ${ctx.tasks.todayPendingCount} 个待办`)
        if (ctx.tasks.importantPending.length > 0) {
          parts.push(`其中 ${ctx.tasks.importantPending.length} 个重要`)
        }
      } else {
        parts.push('今天没有待办')
      }
      if (ctx.health.todayMeals > 0) {
        parts.push(`已记录 ${ctx.health.todayMeals} 餐饮食`)
      }
      if (ctx.finance.todayExpense > 0) {
        parts.push(`今日消费 ¥${ctx.finance.todayExpense.toFixed(0)}`)
      }
      if (parts.length > 0) {
        return { text: '现在的状态：' + parts.join('，') + '。还需要什么？', suggestions: [] }
      }
    }
    // 无法回答的问题，友好引导
    const replies = [
      '这个问题我也不太确定，不过我可以帮你查任务、记账、看倒计时之类的。',
      '嗯…这个超出了我的能力范围。不过日常的事情我都能帮忙，说"帮助"看看？',
      '我可能回答不了这个，但你可以试试问我待办、余额、饮食相关的~',
    ]
    suggestions.push('帮助')
    return { text: pick(replies), suggestions }
  }

  // ---- 短句陈述 ----
  // 引导性回复：用户提到想法/灵感但没展开
  if (/我有个想法|有个想法|想到一个|突然想到|灵感/.test(text)) {
    return {
      text: '说说看，什么想法？我帮你记下来。',
      suggestions: [],
    }
  }

  // 通用闲聊回复 + 上下文关联
  const replies: string[] = []
  if (hour < 6) {
    replies.push('这么晚了还没睡？注意休息呀。')
  } else if (hour >= 22) {
    replies.push('夜深了，该休息了~ 有事明天再说。')
  } else if (hour >= 11 && hour < 14 && ctx.health.todayMeals === 0) {
    replies.push('中午了，吃饭了吗？可以告诉我"吃了XX"帮你记录。')
    suggestions.push('我吃了午餐')
  } else if (ctx.statusScore.overallEnergy > 70) {
    replies.push('看你状态不错~ 有什么想做的吗？')
  } else if (ctx.statusScore.taskPressure > 50) {
    replies.push('感觉你最近事情挺多的，注意节奏。有什么我能帮忙的？')
    suggestions.push('查看今日待办')
  } else {
    replies.push('嗯嗯，我在听~ 有什么需要随时说。')
    replies.push('收到~ 还有什么想聊的吗？')
    replies.push('好的~ 需要什么帮忙尽管开口。')
  }

  if (ctx.tasks.todayPendingCount > 0 && suggestions.length === 0) {
    suggestions.push('查看今日待办')
  }

  return { text: pick(replies), suggestions: suggestions.slice(0, 2) }
}

// ============ 主动洞察生成 ============

/**
 * 基于上下文生成主动洞察
 *
 * 当用户打开 AI 助理但还没发消息时，可以调用此函数生成"主动问候"
 */
export function generateProactiveInsight(ctx: UserContext): {
  title: string
  message: string
  suggestions: string[]
} | null {
  const hour = ctx.hour
  const suggestions: string[] = []

  // 高压力 + 任务积压
  if (ctx.statusScore.taskPressure > 60 && ctx.tasks.todayPendingCount > 3) {
    suggestions.push('查看今日待办')
    suggestions.push('帮我规划时间')
    return {
      title: '今天事情有点多',
      message: `你有 ${ctx.tasks.todayPendingCount} 个待办${ctx.tasks.importantPending.length > 0 ? `，其中 ${ctx.tasks.importantPending.length} 个重要` : ''}。需要我帮你梳理优先级吗？`,
      suggestions,
    }
  }

  // 睡眠不足
  if (ctx.health.sleepHint === '睡眠不足，注意休息' && hour < 12) {
    suggestions.push('查看今日待办')
    suggestions.push('帮我规划上午')
    return {
      title: '昨晚没睡够',
      message: '睡眠不足时，建议先处理常规事项，避免高强度决策。今天有什么需要我帮忙的吗？',
      suggestions,
    }
  }

  // 未记录饮食
  if (ctx.health.todayMeals === 0 && hour >= 13) {
    suggestions.push('我吃了午餐')
    return {
      title: '记得吃饭',
      message: '已经中午了还没记录饮食。可以告诉我"吃了XX"，我帮你记录。',
      suggestions,
    }
  }

  // 碎片待整合
  if (ctx.fragments.undigestedCount >= 5) {
    suggestions.push('整合碎片')
    return {
      title: '碎片待整合',
      message: `今天已记录 ${ctx.fragments.undigestedCount} 条碎片未整合，需要我帮你生成总结吗？`,
      suggestions,
    }
  }

  // 倒计时临近
  const urgentCountdowns = ctx.countdowns.items.filter(c => c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= 3)
  if (urgentCountdowns.length > 0) {
    suggestions.push('查看倒计时')
    suggestions.push('帮我准备')
    return {
      title: '倒计时临近',
      message: `${urgentCountdowns[0].title} 还有 ${urgentCountdowns[0].daysLeft} 天${urgentCountdowns.length > 1 ? `（共 ${urgentCountdowns.length} 个临近）` : ''}。需要帮你准备吗？`,
      suggestions,
    }
  }

  // 财务超支
  if (ctx.finance.monthIncome > 0 && ctx.finance.monthExpense > ctx.finance.monthIncome) {
    suggestions.push('查看财务')
    suggestions.push('帮我分析支出')
    return {
      title: '本月支出超收入',
      message: `本月支出 ¥${ctx.finance.monthExpense.toFixed(0)}，收入 ¥${ctx.finance.monthIncome.toFixed(0)}。需要帮你分析消费结构吗？`,
      suggestions,
    }
  }

  // 事件冲突
  if (ctx.events.conflicts > 0) {
    suggestions.push('查看今日事件')
    return {
      title: '事件时间冲突',
      message: `今日有 ${ctx.events.conflicts} 个事件时间冲突，建议提前调整日程。`,
      suggestions,
    }
  }

  // 交接待跟进
  if (ctx.handover.pendingItemCount > 0) {
    suggestions.push('查看交接')
    return {
      title: '有待跟进事项',
      message: `当前有 ${ctx.handover.pendingItemCount} 项待跟进的交接事项，需要处理吗？`,
      suggestions,
    }
  }

  // 默认：正常状态
  if (ctx.tasks.todayPendingCount === 0 && ctx.tasks.todayDoneCount > 0) {
    return {
      title: '今天做得不错',
      message: `已完成 ${ctx.tasks.todayDoneCount} 项任务，节奏很好。有什么想聊的吗？`,
      suggestions: ['帮我规划明天', '整合今日碎片'],
    }
  }

  return null
}
