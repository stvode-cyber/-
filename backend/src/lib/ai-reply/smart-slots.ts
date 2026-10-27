import logger from '../../lib/logger.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { llmGenerateChat, type ChatMessage } from '../../services/llmService.js'
export function generateTimeSlots(period: string | null): Array<{ label: string; value: string }> {
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
export function shiftTimeBackward(time: string, deltaMinutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = (h * 60 + m - deltaMinutes + 24 * 60) % (24 * 60)
  const hh = String(Math.floor(total / 60)).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

// ============ 智能时间槽判断（规则表 → 缓存 → LLM 兜底） ============

/** 事件类型 → 时间槽/提醒档配置 */
export interface SmartSlotConfig {
  /** 事件类别名（用于缓存与展示） */
  category: string
  /** 时间槽偏移（分钟，0=准时，正值=提前量） */
  timeOffsets: number[]
  /** 提醒提前量（分钟，0=不用提醒） */
  reminders: number[]
}

/** 内置规则表：高频事件类型直接命中，零延迟 */
export const SMART_SLOT_RULES: Array<{ pattern: RegExp; config: SmartSlotConfig }> = [
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
export const SMART_SLOT_DEFAULT: SmartSlotConfig = {
  category: '默认',
  timeOffsets: [0, 60, 120],
  reminders: [15, 30, 60],
}

/** LLM 允许返回的偏移量白名单（分钟），防幻觉 */
export const ALLOWED_OFFSETS = new Set([0, 15, 30, 60, 120, 180, 240])
/** LLM 允许返回的提醒提前量白名单（分钟），防幻觉 */
export const ALLOWED_REMINDERS = new Set([0, 15, 30, 60, 120, 180])

/** 缓存文件路径：data/smart-slots-cache.json（随工作目录持久化） */
export const SMART_SLOT_CACHE_FILE = path.resolve(process.cwd(), 'data', 'smart-slots-cache.json')

/** 内存缓存：事件关键词 → 配置（启动后从文件懒加载） */
let _smartSlotCache: Record<string, SmartSlotConfig> | null = null

/** 提醒档图标映射 */
export const REMINDER_ICONS: Record<number, string> = {
  15: '⏰', 30: '🔔', 60: '📢', 120: '🚨', 180: '🚨',
}

/** 读取缓存文件（懒加载，失败返回空表） */
export async function loadSmartSlotCache(): Promise<Record<string, SmartSlotConfig>> {
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
export async function saveSmartSlotCache(cache: Record<string, SmartSlotConfig>): Promise<void> {
  try {
    await fs.mkdir(path.dirname(SMART_SLOT_CACHE_FILE), { recursive: true })
    await fs.writeFile(SMART_SLOT_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')
  } catch (err) {
    logger.warn({ err }, '[SmartSlots] 缓存写入失败')
  }
}

/** 校验并规整 LLM 返回的配置，不合法字段回退默认值 */
export function sanitizeSlotConfig(raw: {
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
export async function getSmartSlotConfig(text: string): Promise<SmartSlotConfig> {
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
    logger.warn({ err }, '[SmartSlots] LLM 判断失败，使用默认配置')
  }

  return SMART_SLOT_DEFAULT
}

/** 根据配置和基准时间生成时间槽 */
export function buildSlotsFromConfig(baseTime: string, config: SmartSlotConfig): Array<{ label: string; value: string }> {
  return config.timeOffsets
    .slice(0, 4)
    .map((offset) => {
      const t = offset === 0 ? baseTime : shiftTimeBackward(baseTime, offset)
      return { label: t, value: t }
    })
}

/** 根据配置生成提醒档选项（始终附带"不用提醒"） */
export function buildReminderOptionsFromConfig(config: SmartSlotConfig): Array<{ label: string; value: string; icon: string }> {
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