/**
 * 对话行动服务（ConversationActionService）
 *
 * 核心能力：解析 LLM 回复中的行动指令，执行任务创建/提醒创建等操作。
 *
 * 设计原理：
 * - LLM 负责自然对话（确认时间、询问提醒等）
 * - 当所有信息确认后，LLM 在回复末尾输出行动指令
 * - 本服务解析指令并执行数据库操作
 *
 * 行动指令格式（放在 LLM 回复最末尾）：
 * [ACTION:create_task title="开会" date="2026-08-07" time="14:00" reminder="true" reminderMinutes="15"]
 *
 * 支持的行动类型：
 * - create_task: 创建待办任务（可附带提醒）
 * - create_countdown: 创建倒计时（single/important/goal 类型）
 */

import { prisma } from '../lib/prisma.js'

// ============ 类型定义 ============

export interface ParsedAction {
  type: 'create_task' | 'create_countdown' | 'create_reminder' | 'unknown'
  params: Record<string, string>
}

export interface ActionResult {
  success: boolean
  actionType: string
  reply: string
  messageType: string
  metadata?: unknown
  error?: string
}

// ============ 指令解析 ============

/**
 * 从 LLM 回复中解析行动指令
 *
 * 指令格式：[ACTION:type key="value" key="value"]
 * 指令必须出现在回复末尾
 *
 * @returns 解析出的行动，如果没找到返回 null
 */
export function parseAction(llmReply: string): ParsedAction | null {
  // 匹配 [ACTION:type key="value" key="value" ...]
  const match = llmReply.match(/\[ACTION:(\w+)([^\]]*)\]/)
  if (!match) return null

  const type = match[1] as ParsedAction['type']
  const paramsStr = match[2].trim()

  // 解析 key="value" 对
  const params: Record<string, string> = {}
  const paramRegex = /(\w+)="([^"]*)"/g
  let paramMatch: RegExpExecArray | null
  while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
    params[paramMatch[1]] = paramMatch[2]
  }

  return { type, params }
}

/**
 * 从 LLM 回复中移除行动指令（用户不可见）
 */
export function stripActionTag(llmReply: string): string {
  return llmReply.replace(/\s*\[ACTION:[^\]]+\]\s*$/, '').trim()
}

// ============ 行动执行 ============

/**
 * 执行解析出的行动
 *
 * 目前支持：
 * - create_task: 创建任务 + 可选提醒
 */
export async function executeAction(
  action: ParsedAction,
  userId: string,
): Promise<ActionResult> {
  switch (action.type) {
    case 'create_task':
      return executeCreateTask(action.params, userId)
    case 'create_countdown':
      return executeCreateCountdown(action.params, userId)
    default:
      return {
        success: false,
        actionType: action.type,
        reply: '未知的行动类型',
        messageType: 'text',
        error: `Unknown action type: ${action.type}`,
      }
  }
}

/**
 * 执行创建任务行动
 *
 * 参数：
 * - title: 任务标题（必填）
 * - date: 日期 YYYY-MM-DD（必填）
 * - time: 时间 HH:mm（可选，不填则全天任务）
 * - priority: 优先级 low/medium/high/urgent（默认 medium）
 * - category: 分类 work/life/finance（默认 work）
 * - reminder: 是否设置提醒 true/false（默认 false）
 * - reminderMinutes: 提前提醒分钟数（默认 15）
 * - description: 任务描述（可选）
 */
async function executeCreateTask(
  params: Record<string, string>,
  userId: string,
): Promise<ActionResult> {
  const title = params.title?.trim()
  if (!title) {
    return {
      success: false,
      actionType: 'create_task',
      reply: '任务创建失败：缺少标题',
      messageType: 'text',
      error: 'Missing title',
    }
  }

  const dateStr = params.date?.trim()
  const timeStr = params.time?.trim()
  const priority = params.priority?.trim() || 'medium'
  const category = params.category?.trim() || 'work'
  const description = params.description?.trim() || null
  const wantReminder = params.reminder === 'true'
  const reminderMinutes = parseInt(params.reminderMinutes || '15', 10)

  // 构建截止时间
  let dueDate: Date | null = null
  if (dateStr) {
    if (timeStr) {
      // 有日期和时间：YYYY-MM-DD HH:mm
      dueDate = new Date(`${dateStr}T${timeStr}:00`)
    } else {
      // 只有日期：设置为当天 23:59
      dueDate = new Date(`${dateStr}T23:59:59`)
    }
  }

  // 如果日期无效，使用当前时间
  if (dueDate && isNaN(dueDate.getTime())) {
    dueDate = null
  }

  // 创建任务
  const task = await prisma.task.create({
    data: {
      userId,
      title,
      description,
      priority,
      category,
      dueDate: dueDate || undefined,
      status: 'todo',
      important: priority === 'urgent',
    },
  })

  // 出行规划：有路程时间 → 提醒时间 = 出发时间（事开始 - 路程 - 15分钟缓冲）
  const travelMinutes = params.travelMinutes ? parseInt(params.travelMinutes, 10) : 0
  const hasTravel = travelMinutes > 0 && !!timeStr

  // 创建提醒（如果用户需要）
  let reminder = null
  if (wantReminder && dueDate) {
    const remindAt = hasTravel
      ? new Date(dueDate.getTime() - (travelMinutes + 15) * 60_000)
      : new Date(dueDate.getTime() - reminderMinutes * 60_000)
    reminder = await prisma.reminder.create({
      data: {
        userId,
        title: `提醒：${title}`,
        content: hasTravel
          ? `${title} ${timeStr} 开始，路程约 ${travelMinutes} 分钟，建议 ${formatDeparture(dueDate, travelMinutes + 15)} 出发`
          : `${title} 将在 ${timeStr || '即将'} 开始`,
        remindAt,
        level: priority === 'urgent' ? 'urgent' : 'proper',
        repeat: 'once',
        relatedType: 'task',
        relatedId: task.id,
        done: false,
      },
    })
  }

  // 生成确认回复
  const timeLabel = timeStr ? ` ${timeStr}` : ''
  const dateLabel = dateStr ? formatDateLabel(dateStr) : ''
  let reply = `已创建待办：${dateLabel}${timeLabel} ${title} ✅`
  if (hasTravel) {
    reply += `\n🚗 路程约 ${travelMinutes} 分钟，建议 ${formatDeparture(dueDate!, travelMinutes + 15)} 出发`
  }
  if (reminder) {
    reply += `\n⏰ ${hasTravel ? `出发前提醒（${formatDeparture(dueDate!, travelMinutes + 15)}）` : `已设置提前 ${reminderMinutes} 分钟提醒`}`
  }

  return {
    success: true,
    actionType: 'create_task',
    reply,
    messageType: 'task_created_card',
    metadata: {
      task: {
        id: task.id,
        title: task.title,
        priority: task.priority,
        category: task.category,
        dueDate: task.dueDate?.toISOString() || null,
      },
      reminder: reminder ? {
        id: reminder.id,
        remindAt: reminder.remindAt.toISOString(),
        reminderMinutes,
      } : null,
    },
  }
}

/**
 * 执行创建倒计时行动（铁律⑨：指令必落地）
 *
 * 参数：
 * - title: 倒计时标题（必填）
 * - date: 目标日期 YYYY-MM-DD（必填）
 * - time: 目标时间 HH:mm（可选，不填则当天 00:00）
 * - type: 类型 single/important/goal（默认 single）
 * - description: 描述（可选）
 */
async function executeCreateCountdown(
  params: Record<string, string>,
  userId: string,
): Promise<ActionResult> {
  const title = params.title?.trim()
  if (!title) {
    return {
      success: false,
      actionType: 'create_countdown',
      reply: '倒计时创建失败：缺少标题',
      messageType: 'text',
      error: 'Missing title',
    }
  }

  // 兜底：只给钟点没给日期 → 默认今天（配合下方"已过则顺延明天"规则）
  let dateStr = params.date?.trim() || ''
  if (!dateStr) {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    dateStr = `${y}-${m}-${d}`
  }

  const timeStr = params.time?.trim() || '00:00'
  const type = ['single', 'important', 'goal'].includes(params.type?.trim() || '')
    ? params.type!.trim()
    : 'single'
  const description = params.description?.trim() || null

  let targetDate = new Date(`${dateStr}T${timeStr}:00`)
  if (isNaN(targetDate.getTime())) {
    targetDate = new Date(`${dateStr}T00:00:00`)
  }
  if (isNaN(targetDate.getTime())) {
    return {
      success: false,
      actionType: 'create_countdown',
      reply: '倒计时创建失败：日期格式无效',
      messageType: 'text',
      error: 'Invalid date',
    }
  }
  // 兜底：目标时刻已过去 → 顺延到明天同一时刻（倒计时指向过去没有意义）
  if (targetDate.getTime() <= Date.now()) {
    targetDate = new Date(targetDate.getTime() + 86400000)
  }

  const countdown = await prisma.countdown.create({
    data: {
      userId,
      type,
      title,
      description,
      targetDate,
      status: 'active',
    },
  })

  const daysLeft = Math.ceil((targetDate.getTime() - Date.now()) / 86400000)
  const dateLabel = formatDateLabel(dateStr)
  const timeLabel = params.time?.trim() ? ` ${params.time.trim()}` : ''

  return {
    success: true,
    actionType: 'create_countdown',
    reply: `已创建倒计时：${title} · ${dateLabel}${timeLabel}${daysLeft > 0 ? `（还有 ${daysLeft} 天）` : '（就是今天）'} ✅`,
    messageType: 'text',
    metadata: {
      countdown: {
        id: countdown.id,
        title: countdown.title,
        type: countdown.type,
        targetDate: targetDate.toISOString(),
        daysLeft,
      },
    },
  }
}

// ============ 辅助函数 = ============

/**
 * 计算出发时间标签（事件时间倒推 buffer 分钟）
 * 返回 "HH:mm" 或 "昨天/今天/明天 HH:mm"
 */
function formatDeparture(eventDate: Date, bufferMinutes: number): string {
  const dep = new Date(eventDate.getTime() - bufferMinutes * 60_000)
  const hh = String(dep.getHours()).padStart(2, '0')
  const mm = String(dep.getMinutes()).padStart(2, '0')
  // 跨天了（比如早上的事，前晚就要出发）
  const eventDay = new Date(eventDate)
  eventDay.setHours(0, 0, 0, 0)
  const depDay = new Date(dep)
  depDay.setHours(0, 0, 0, 0)
  const diffDays = Math.round((eventDay.getTime() - depDay.getTime()) / 86400000)
  if (diffDays === 1) return `前一天 ${hh}:${mm}`
  if (diffDays > 1) return `提前${diffDays}天 ${hh}:${mm}`
  return `${hh}:${mm}`
}

/**
 * 将日期字符串格式化为友好的中文标签
 * "2026-08-07" → "8月7日"（如果是今天则返回"今天"）
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
