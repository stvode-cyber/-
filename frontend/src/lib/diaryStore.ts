/**
 * 日记 · 数据层
 *
 * - localStorage：日记（diary_entries_v1），每天一篇（按日期覆盖更新）
 * - 支持标题 + 正文 + 当时心情快照（可选同步到心情记录）
 * - 搜索（标题+正文关键词）、月历打卡、连续写作天数统计
 * - 完全本地存储，离线可用
 */

import { saveRecord, type MoodLevel } from './moodStore'

/** 一篇日记（date 为唯一键，每天一篇） */
export interface DiaryEntry {
  /** 日期 YYYY-MM-DD */
  date: string
  /** 标题（可空） */
  title: string
  /** 正文 */
  content: string
  /** 当时心情快照（1-5，未评为 null） */
  mood: MoodLevel | null
  /** 创建时间戳 ms */
  createdAt: number
  /** 最后更新时间戳 ms */
  updatedAt: number
}

export interface DiaryStat {
  /** 总篇数 */
  total: number
  /** 连续写作天数（今天没写不断签，从昨天往前算） */
  streak: number
  /** 累计字数（中文按字计） */
  totalWords: number
  /** 本月篇数 */
  monthCount: number
  /** 今日是否已写 */
  writtenToday: boolean
}

const ENTRIES_KEY = 'diary_entries_v1'

/** 单篇字数统计：去空白后按字符计 */
export function countWords(text: string): number {
  return text.replace(/\s/g, '').length
}

// ===== 日期工具 =====

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

// ===== CRUD =====

function listAll(): Record<string, DiaryEntry> {
  try {
    return JSON.parse(localStorage.getItem(ENTRIES_KEY) || '{}') as Record<string, DiaryEntry>
  } catch {
    return {}
  }
}

function saveAll(data: Record<string, DiaryEntry>) {
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(data))
}

/** 获取某日日记 */
export function getEntry(date: string): DiaryEntry | null {
  return listAll()[date] || null
}

/**
 * 保存某日日记（同一天覆盖更新）
 * @param syncMood 是否同步当时心情到心情记录（仅在勾选且心情已评时生效）
 */
export function saveEntry(date: string, title: string, content: string, mood: MoodLevel | null, syncMood = false): DiaryEntry {
  const all = listAll()
  const prev = all[date]
  const entry: DiaryEntry = {
    date,
    title: title.trim().slice(0, 50),
    content,
    mood,
    createdAt: prev?.createdAt || Date.now(),
    updatedAt: Date.now(),
  }
  all[date] = entry
  saveAll(all)

  // 心情联动：写入当天心情（覆盖式，与心情记录"每日一条"语义一致）
  if (syncMood && mood !== null) {
    saveRecord(date, mood, [], title.trim() || '来自日记')
  }
  return entry
}

/** 删除某日日记 */
export function deleteEntry(date: string) {
  const all = listAll()
  delete all[date]
  saveAll(all)
}

/** 全部日记（按日期降序） */
export function listEntriesDesc(): DiaryEntry[] {
  return Object.values(listAll()).sort((a, b) => (a.date < b.date ? 1 : -1))
}

/** 关键词搜索（标题 + 正文，不区分大小写） */
export function searchEntries(keyword: string): DiaryEntry[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return listEntriesDesc()
  return listEntriesDesc().filter(
    (e) => e.title.toLowerCase().includes(kw) || e.content.toLowerCase().includes(kw),
  )
}

// ===== 统计 =====

export function getDiaryStat(): DiaryStat {
  const all = listAll()
  const dates = new Set(Object.keys(all))
  const today = todayStr()

  // 连续写作：今天没写不断签，从昨天往前数
  let streak = 0
  let offset = dates.has(today) ? 0 : -1
  while (dates.has(dateOffset(offset))) {
    streak++
    offset--
  }

  const totalWords = Object.values(all).reduce((s, e) => s + countWords(e.content) + countWords(e.title), 0)
  const monthPrefix = today.slice(0, 7)
  const monthCount = Array.from(dates).filter((d) => d.startsWith(monthPrefix)).length

  return {
    total: dates.size,
    streak,
    totalWords,
    monthCount,
    writtenToday: dates.has(today),
  }
}

/** 某月哪些天写了日记（供日历打卡点） */
export function getMonthDates(year: number, month: number): Set<string> {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
  return new Set(Object.keys(listAll()).filter((d) => d.startsWith(prefix)))
}

/** 某日期范围内写日记的日期集合（供每周回顾） */
export function getDatesInRange(start: string, end: string): Map<string, { words: number; mood: MoodLevel | null }> {
  const result = new Map<string, { words: number; mood: MoodLevel | null }>()
  for (const e of Object.values(listAll())) {
    if (e.date >= start && e.date <= end) {
      result.set(e.date, { words: countWords(e.content), mood: e.mood })
    }
  }
  return result
}
