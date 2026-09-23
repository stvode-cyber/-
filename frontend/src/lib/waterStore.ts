/**
 * 喝水记录 · 数据层
 *
 * - localStorage：设置（water_settings_v1）+ 每日饮水量（water_records_v1）
 * - 每天一条记录（按日期累加），支持撤销最近一次、自定义每日目标
 * - 完全本地存储，离线可用
 */

/** 单条饮水记录 */
export interface WaterEntry {
  /** 记录时间戳 ms */
  at: number
  /** 毫升数 */
  ml: number
}

export interface WaterSettings {
  /** 每日目标（ml），默认 2000 */
  dailyGoal: number
  /** 单次快捷杯容量（ml），默认 250 */
  cupSize: number
}

export interface WaterStat {
  /** 今日已饮（ml） */
  todayMl: number
  /** 今日目标（ml） */
  dailyGoal: number
  /** 达标剩余（ml，0 表示已达标） */
  remaining: number
  /** 今日记录次数 */
  todayCount: number
  /** 近 7 天饮水量（按日期升序，无记录为 0） */
  last7Days: { date: string; ml: number }[]
  /** 近 7 天达标天数 */
  goalDays: number
  /** 近 7 天平均（ml，无记录为 0） */
  average: number
  /** 连续达标天数（今天达标与否不影响已连续的昨天往前） */
  streak: number
}

const SETTINGS_KEY = 'water_settings_v1'
const RECORDS_KEY = 'water_records_v1'

export const DEFAULT_SETTINGS: WaterSettings = {
  dailyGoal: 2000,
  cupSize: 250,
}

/** 快捷记录选项（ml） */
export const QUICK_ADDS = [125, 250, 500]

// ===== 日期工具 =====

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

// ===== 设置 =====

export function loadSettings(): WaterSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: WaterSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

// ===== 记录 CRUD =====

/** 全部记录：{ 'YYYY-MM-DD': WaterEntry[] } */
function listAll(): Record<string, WaterEntry[]> {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}') as Record<string, WaterEntry[]>
  } catch {
    return {}
  }
}

function saveAll(data: Record<string, WaterEntry[]>) {
  // 仅保留最近 60 天，防止无限增长
  const cutoff = dateOffset(-60)
  const filtered: Record<string, WaterEntry[]> = {}
  for (const [date, entries] of Object.entries(data)) {
    if (date >= cutoff) filtered[date] = entries
  }
  localStorage.setItem(RECORDS_KEY, JSON.stringify(filtered))
}

/** 今日记录列表 */
export function listTodayEntries(): WaterEntry[] {
  return listAll()[todayStr()] || []
}

/** 某日总量（ml） */
export function getDayMl(date: string): number {
  const entries = listAll()[date]
  return entries ? entries.reduce((s, e) => s + e.ml, 0) : 0
}

/** 饮水（正数）/ 撤销（负数会移除最近一条不低于该量的记录） */
export function addWater(ml: number) {
  if (ml === 0) return
  const all = listAll()
  const today = todayStr()
  if (!all[today]) all[today] = []

  if (ml > 0) {
    all[today].push({ at: Date.now(), ml })
  } else {
    // 撤销：移除最近一条记录
    if (all[today].length > 0) all[today].pop()
  }
  saveAll(all)
}

/** 清空今日全部记录 */
export function clearToday() {
  const all = listAll()
  delete all[todayStr()]
  saveAll(all)
}

// ===== 统计 =====

export function getWaterStat(): WaterStat {
  const all = listAll()
  const { dailyGoal } = loadSettings()
  const today = todayStr()

  const todayEntries = all[today] || []
  const todayMl = todayEntries.reduce((s, e) => s + e.ml, 0)

  // 近 7 天序列
  const last7Days: { date: string; ml: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = dateOffset(-i)
    const entries = all[d]
    last7Days.push({ date: d, ml: entries ? entries.reduce((s, e) => s + e.ml, 0) : 0 })
  }
  const goalDays = last7Days.filter((d) => d.ml >= dailyGoal).length

  // 有记录的天平均
  const recordedDays = last7Days.filter((d) => d.ml > 0)
  const average = recordedDays.length > 0
    ? Math.round(recordedDays.reduce((s, d) => s + d.ml, 0) / recordedDays.length)
    : 0

  // 连续达标：从今天（或昨天）往前数（今天未达标不断签）
  let streak = 0
  const todayHit = todayMl >= dailyGoal
  let offset = todayHit ? 0 : -1
  while (true) {
    const d = dateOffset(offset)
    const entries = all[d]
    const ml = entries ? entries.reduce((s, e) => s + e.ml, 0) : 0
    if (ml >= dailyGoal) {
      streak++
      offset--
    } else break
  }

  return {
    todayMl,
    dailyGoal,
    remaining: Math.max(0, dailyGoal - todayMl),
    todayCount: todayEntries.length,
    last7Days,
    goalDays,
    average,
    streak,
  }
}
