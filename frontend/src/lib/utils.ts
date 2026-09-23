import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'
import { handoverStatusMeta, handoverShiftMeta } from './constants'

// 全局中文本地化 + 启用相对时间插件
dayjs.locale('zh-cn')
dayjs.extend(relativeTime)

export { dayjs }

/** 时分格式（HH:mm），用于聊天时间、提醒时间 */
export function formatTime(date?: string | Date | null): string {
  if (!date) return ''
  return dayjs(date).format('HH:mm')
}

/** 日期格式（YYYY-MM-DD），用于账单、饮食日期 */
export function formatDate(date?: string | Date | null): string {
  if (!date) return ''
  return dayjs(date).format('YYYY-MM-DD')
}

/** 完整日期时间（YYYY-MM-DD HH:mm），用于台账、审计日志 */
export function formatDateTime(date?: string | Date | null): string {
  if (!date) return ''
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

/** 相对时间（如 "3 分钟前"），用于消息列表 */
export function fromNow(date?: string | Date | null): string {
  if (!date) return ''
  return dayjs(date).fromNow()
}

/** 计算剩余天数（可为负，表示已超期） */
export function daysLeft(target?: string | Date | null): number {
  if (!target) return 0
  const diff = dayjs(target).startOf('day').diff(dayjs().startOf('day'), 'day')
  return diff
}

/** 货币格式化：固定 2 位小数 + ¥ 前缀 */
export function formatMoney(n: number): string {
  return `¥${n.toFixed(2)}`
}

/** 任务优先级 → 标签 + 配色映射 */
export const priorityMeta: Record<string, { label: string; color: string; bg: string }> = {
  urgent: { label: '紧急', color: 'text-red-600', bg: 'bg-red-100' },
  high: { label: '高', color: 'text-orange-600', bg: 'bg-orange-100' },
  medium: { label: '中', color: 'text-blue-600', bg: 'bg-blue-100' },
  low: { label: '低', color: 'text-gray-600', bg: 'bg-gray-100' },
}

/** 餐次 → 标签 + emoji 映射 */
export const mealTypeMeta: Record<string, { label: string; icon: string }> = {
  breakfast: { label: '早餐', icon: '🍳' },
  lunch: { label: '午餐', icon: '🥗' },
  dinner: { label: '晚餐', icon: '🍲' },
  snack: { label: '加餐', icon: '🍎' },
}

/** AI 对话语气模式（9 种）→ 标签 + emoji + 配色 */
export const toneMeta: Record<string, { label: string; emoji: string; color: string }> = {
  professional: { label: '严谨专业', emoji: '💼', color: 'bg-blue-500' },
  gentle: { label: '温柔关怀', emoji: '🌸', color: 'bg-pink-400' },
  cute: { label: '撒娇可爱', emoji: '🥺', color: 'bg-purple-400' },
  direct: { label: '强硬直接', emoji: '⚡', color: 'bg-red-500' },
  humorous: { label: '幽默风趣', emoji: '😄', color: 'bg-yellow-400' },
  concise: { label: '极简冷漠', emoji: '🧊', color: 'bg-gray-500' },
  energetic: { label: '元气鼓励', emoji: '🔥', color: 'bg-orange-500' },
  coach: { label: '教练式', emoji: '🏋️', color: 'bg-green-500' },
  friend: { label: '朋友对话', emoji: '🤝', color: 'bg-teal-500' },
}

/**
 * 交接单 → Markdown 转换所需的最小字段集合
 *
 * 用于 handoverToMarkdown，用户端 Handover 与管理员端 AdminHandover
 * 均满足该结构，便于跨页面复用导出能力。
 */
export interface HandoverMarkdownInput {
  title: string
  shift: string
  handoverDate: string
  status: string
  submittedAt?: string | null
  summary?: string | null
  completedItems: string[]
  pendingItems: { text: string; priority: string; dueDate?: string }[]
  notes?: string | null
}

/** 交接单状态 → 中文标签（从 constants.ts 复用，避免重复定义） */
const handoverStatusLabel: Record<string, string> = Object.fromEntries(
  Object.entries(handoverStatusMeta).map(([k, v]) => [k, v.label]),
)

/** 班次 → 中文标签 + emoji（从 constants.ts 复用，避免重复定义） */
const handoverShiftLabel = handoverShiftMeta

/**
 * 将交接单转换为 Markdown 文本
 *
 * 用于"复制为 Markdown"导出能力，方便粘贴到飞书 / 钉钉 / 邮件 / 文档。
 *
 * 输出结构：
 *   # {标题}
 *   - 班次：xxx
 *   - 日期：xxx
 *   - 状态：xxx
 *
 *   ## 工作总结
 *   {summary}
 *
 *   ## 已完成事项
 *   - [x] xxx
 *
 *   ## 待跟进事项
 *   - [ ] [优先级] xxx (截止：xxx)
 *
 *   ## 注意事项
 *   {notes}
 */
export function handoverToMarkdown(h: HandoverMarkdownInput): string {
  const lines: string[] = []
  const statusLabel = handoverStatusLabel[h.status] || h.status
  const shift = handoverShiftLabel[h.shift] || { label: h.shift, icon: '📋' }

  lines.push(`# ${h.title}`)
  lines.push('')
  lines.push(`- 班次：${shift.icon} ${shift.label}`)
  lines.push(`- 日期：${formatDate(h.handoverDate)}`)
  lines.push(`- 状态：${statusLabel}`)
  if (h.submittedAt) {
    lines.push(`- 提交时间：${formatDateTime(h.submittedAt)}`)
  }
  lines.push('')

  // 工作总结
  if (h.summary) {
    lines.push('## 工作总结')
    lines.push('')
    lines.push(h.summary)
    lines.push('')
  }

  // 已完成事项
  if (h.completedItems.length > 0) {
    lines.push('## 已完成事项')
    lines.push('')
    h.completedItems.forEach((item) => {
      lines.push(`- [x] ${item}`)
    })
    lines.push('')
  }

  // 待跟进事项
  if (h.pendingItems.length > 0) {
    lines.push('## 待跟进事项')
    lines.push('')
    h.pendingItems.forEach((item) => {
      const pMeta = priorityMeta[item.priority] || priorityMeta.medium
      const due = item.dueDate ? ` (截止：${formatDate(item.dueDate)})` : ''
      lines.push(`- [ ] [${pMeta.label}] ${item.text}${due}`)
    })
    lines.push('')
  }

  // 注意事项
  if (h.notes) {
    lines.push('## 注意事项')
    lines.push('')
    lines.push(h.notes)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 将文本复制到剪贴板
 *
 * 优先使用现代 Clipboard API，失败时回退到 execCommand 兜底，
 * 保证在非 HTTPS / 旧浏览器环境也能工作。
 *
 * @returns true 表示复制成功，false 表示失败
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 走 fallback
  }
  // Fallback：临时 textarea + execCommand
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch {
    return false
  }
}
