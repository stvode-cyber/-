import type { ReplyResult } from './index.js'
import { prisma } from '../prisma.js'
import { formatDateLabel } from './generators.js'
import { executeAction } from '../../services/conversationActionService.js'
import { SmartSlotConfig, getSmartSlotConfig, generateTimeSlots, buildSlotsFromConfig, buildReminderOptionsFromConfig, SMART_SLOT_DEFAULT } from './smart-slots.js'
export const UNCERTAINTY_PATTERNS = [
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
export const TASK_ACTION_KEYWORDS = /开会|会议|报告|面试|考试|出差|旅行|预约|见面|聚餐|聚会|培训|答辩|汇报|演示|交付|提交|参加|约了|要约|买|交|送|办|有个会|有会|有个会|要开|要做|要去|得去|帮安排|排了|有个|有场|去参加|去面试|去考试|去开会/

/** 时间提取正则 */
export const TIME_PATTERN = /(\d{1,2})[点时:：](\d{1,2})?|(上午|下午|晚上|中午|早上)(\d{1,2})[点时:：]?(\d{1,2})?|(\d{1,2})[点时:：](\d{1,2})?/

/** 日期关键词 */
export const DATE_TODAY = /今天|今日|本天/
export const DATE_TOMORROW = /明天|明日|next day/
export const DATE_AFTER = /后天/

/** 提醒关键词 */
export const REMINDER_KEYWORDS = /提醒|通知|叫我|别忘了|记得/

/**
 * 检测用户消息是否包含不确定性/寻求建议的表达
 *
 * @returns true 表示用户在表达不确定，应走闲聊路径而非任务创建
 */
export function isUncertaintyExpression(text: string): boolean {
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
export async function detectTaskCreation(
  content: string,
  userId: string,
  sessionId?: string,
): Promise<ReplyResult | null> {
  const text = content.trim()

  // v5: 先排除不确定性表达
  // "不知道做什么好"、"无聊"、"有什么推荐的"等 → 走 LLM 闲聊，先确认意图
  if (isUncertaintyExpression(text)) {
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

export function extractTime(text: string): string | null {
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
export function getDateString(text: string): string | null {
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
export function extractTaskTitle(text: string): string | null {
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
export async function handleFollowUpTime(
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