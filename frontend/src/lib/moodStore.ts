/**
 * 心情记录 · 数据层
 *
 * - localStorage：心情记录（mood_records_v1）
 * - 每天一条记录（按日期覆盖更新），支持心情等级 + 标签 + 备注
 * - 完全本地存储，离线可用
 */

/** 心情等级 1-5：糟糕 / 一般 / 平静 / 开心 / 超棒 */
export type MoodLevel = 1 | 2 | 3 | 4 | 5

export interface MoodRecord {
  /** 日期 YYYY-MM-DD（每天一条，作为唯一键） */
  date: string
  /** 心情等级 1-5 */
  level: MoodLevel
  /** 情绪标签（多选） */
  tags: string[]
  /** 备注 */
  note: string
  /** 记录时间戳 */
  updatedAt: number
}

export interface MoodStat {
  /** 今日心情（未记录为 null） */
  today: MoodRecord | null
  /** 当前连续记录天数 */
  streak: number
  /** 总记录数 */
  total: number
  /** 平均心情（保留 1 位小数，无记录为 0） */
  average: number
  /** 近 30 天等级序列（用于趋势图，按日期升序） */
  last30Days: { date: string; level: number | null }[]
  /** 等级分布（近 30 天，索引 0 对应等级 1） */
  distribution: number[]
  /** 最常出现的标签（近 30 天，前 5 个） */
  topTags: { tag: string; count: number }[]
}

const RECORDS_KEY = 'mood_records_v1'

/** 心情等级元数据：emoji + 名称 + 颜色 */
export const MOOD_META: Record<MoodLevel, { emoji: string; label: string; color: string }> = {
  1: { emoji: '😖', label: '糟糕', color: '#EF4444' },
  2: { emoji: '🙁', label: '一般', color: '#F97316' },
  3: { emoji: '😐', label: '平静', color: '#F59E0B' },
  4: { emoji: '🙂', label: '开心', color: '#10B981' },
  5: { emoji: '🤩', label: '超棒', color: '#3B82F6' },
}

/** 可选情绪标签 */
export const MOOD_TAGS = [
  '工作', '学习', '运动', '社交', '独处',
  '家庭', '恋爱', '旅行', '游戏', '音乐',
  '生病', '疲惫', '焦虑', '充实', '无聊',
] as const

// ===== 日期工具 =====

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

// ===== 记录 CRUD =====

function listAll(): Record<string, MoodRecord> {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}') as Record<string, MoodRecord>
  } catch {
    return {}
  }
}

function saveAll(data: Record<string, MoodRecord>) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(data))
}

/** 获取某日记录 */
export function getRecord(date: string): MoodRecord | null {
  return listAll()[date] || null
}

/** 保存某日记录（同一天覆盖更新） */
export function saveRecord(date: string, level: MoodLevel, tags: string[], note: string): MoodRecord {
  const all = listAll()
  const record: MoodRecord = { date, level, tags, note, updatedAt: Date.now() }
  all[date] = record
  saveAll(all)
  return record
}

/** 删除某日记录 */
export function deleteRecord(date: string) {
  const all = listAll()
  delete all[date]
  saveAll(all)
}

/** 获取全部记录（按日期降序，用于历史列表） */
export function listRecordsDesc(limit?: number): MoodRecord[] {
  const all = listAll()
  const arr = Object.values(all).sort((a, b) => (a.date < b.date ? 1 : -1))
  return limit ? arr.slice(0, limit) : arr
}

// ===== 统计 =====

export function getMoodStat(): MoodStat {
  const all = listAll()
  const dates = Object.keys(all).sort()
  const today = todayStr()

  // 连续记录天数：从今天（或昨天）往前数
  let streak = 0
  let offset = all[today] ? 0 : -1
  while (all[dateOffset(offset)]) {
    streak++
    offset--
  }

  // 近 30 天序列 + 分布 + 标签统计
  const last30Days: { date: string; level: number | null }[] = []
  const distribution = [0, 0, 0, 0, 0]
  const tagCount = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    const d = dateOffset(-i)
    const rec = all[d]
    last30Days.push({ date: d, level: rec ? rec.level : null })
    if (rec) {
      distribution[rec.level - 1]++
      for (const t of rec.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1)
    }
  }

  // 近 30 天平均
  let sum = 0
  let count = 0
  for (let i = 0; i < 30; i++) {
    const rec = all[dateOffset(-i)]
    if (rec) {
      sum += rec.level
      count++
    }
  }

  const topTags = Array.from(tagCount.entries())
    .map(([tag, c]) => ({ tag, count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    today: all[today] || null,
    streak,
    total: dates.length,
    average: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
    last30Days,
    distribution,
    topTags,
  }
}

/** 获取某月的心情日历数据（用于热力图） */
export function getMonthCalendar(year: number, month: number): {
  weeks: { date: string; level: number | null; inMonth: boolean }[][]
  /** 本月平均心情（无记录为 0） */
  monthAverage: number
  /** 本月记录天数 */
  recordedDays: number
} {
  const all = listAll()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startWeekday = firstDay.getDay()

  const weeks: { date: string; level: number | null; inMonth: boolean }[][] = []
  let week: { date: string; level: number | null; inMonth: boolean }[] = []

  // 前置空白（上月末尾）
  for (let i = 0; i < startWeekday; i++) {
    const d = new Date(year, month, -startWeekday + i + 1)
    const ds = todayStr(d)
    week.push({ date: ds, level: all[ds] ? all[ds].level : null, inMonth: false })
  }

  const current = new Date(firstDay)
  while (current <= lastDay) {
    const ds = todayStr(current)
    week.push({ date: ds, level: all[ds] ? all[ds].level : null, inMonth: true })
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
    current.setDate(current.getDate() + 1)
  }
  if (week.length > 0) {
    while (week.length < 7) {
      const d = new Date(current)
      const ds = todayStr(d)
      week.push({ date: ds, level: all[ds] ? all[ds].level : null, inMonth: false })
      current.setDate(current.getDate() + 1)
    }
    weeks.push(week)
  }

  // 本月统计
  let sum = 0
  let recordedDays = 0
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
  for (const [date, rec] of Object.entries(all)) {
    if (date.startsWith(prefix)) {
      sum += rec.level
      recordedDays++
    }
  }

  return {
    weeks,
    monthAverage: recordedDays > 0 ? Math.round((sum / recordedDays) * 10) / 10 : 0,
    recordedDays,
  }
}
