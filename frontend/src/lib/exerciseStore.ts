/**
 * 运动记录 · 数据层
 *
 * - localStorage：设置（exercise_settings_v1）+ 运动记录（exercise_records_v1）
 * - 每条记录：类型 + 时长 + 强度，卡路里按 MET 估算（可选联动 weightStore 体重）
 * - 完全本地存储，离线可用
 */

/** 运动类型 */
export type ExerciseType =
  | 'walking' | 'running' | 'cycling' | 'swimming'
  | 'gym' | 'yoga' | 'ball' | 'hiit' | 'other'

/** 强度 */
export type ExerciseIntensity = 'low' | 'med' | 'high'

/** 单条运动记录 */
export interface ExerciseEntry {
  /** 记录时间戳 ms */
  at: number
  /** 运动类型 */
  type: ExerciseType
  /** 时长（分钟） */
  minutes: number
  /** 强度 */
  intensity: ExerciseIntensity
  /** 卡路里估算（kcal，记录时按当时体重算好存入） */
  calories: number
  /** 备注（可选） */
  note?: string
}

export interface ExerciseSettings {
  /** 每周运动目标（分钟），默认 150（WHO 建议成人每周 150 分钟中等强度） */
  weeklyGoalMin: number
}

export interface ExerciseStat {
  /** 今日运动分钟数 */
  todayMinutes: number
  /** 今日卡路里 */
  todayCalories: number
  /** 今日记录数 */
  todayCount: number
  /** 本周（周一起）分钟数 */
  weekMinutes: number
  /** 本周卡路里 */
  weekCalories: number
  /** 周目标完成率（0-100） */
  weekGoalPct: number
  /** 近 7 天逐日分钟数（升序） */
  last7Days: { date: string; minutes: number }[]
  /** 连续运动天数（今天没动不断签，从昨天往前算） */
  streak: number
  /** 本周各类型分钟数汇总（降序） */
  weekByType: { type: ExerciseType; minutes: number; calories: number }[]
  /** 本周运动天数 */
  weekDays: number
  /** 近 30 天总分钟数 */
  total30d: number
}

/** 类型元数据：图标 emoji + 标签 + 颜色 + MET 值 */
export const EXERCISE_META: Record<ExerciseType, { label: string; emoji: string; color: string; met: number }> = {
  walking: { label: '走路', emoji: '🚶', color: '#10B981', met: 3.5 },
  running: { label: '跑步', emoji: '🏃', color: '#0EA5E9', met: 9.8 },
  cycling: { label: '骑行', emoji: '🚴', color: '#F59E0B', met: 7.5 },
  swimming: { label: '游泳', emoji: '🏊', color: '#3B82F6', met: 8.0 },
  gym: { label: '力量训练', emoji: '🏋️', color: '#F43F5E', met: 5.0 },
  yoga: { label: '瑜伽', emoji: '🧘', color: '#8B5CF6', met: 3.0 },
  ball: { label: '球类', emoji: '⚽', color: '#F97316', met: 6.5 },
  hiit: { label: '高强度间歇', emoji: '🔥', color: '#EF4444', met: 10.0 },
  other: { label: '其他', emoji: '🏅', color: '#6B7280', met: 4.0 },
}

/** 强度元数据：标签 + 卡路里系数 */
export const INTENSITY_META: Record<ExerciseIntensity, { label: string; factor: number }> = {
  low: { label: '低强度', factor: 0.8 },
  med: { label: '中等强度', factor: 1.0 },
  high: { label: '高强度', factor: 1.2 },
}

/** 快捷时长选项（分钟） */
export const QUICK_MINUTES = [10, 20, 30, 45, 60]

const SETTINGS_KEY = 'exercise_settings_v1'
const RECORDS_KEY = 'exercise_records_v1'

export const DEFAULT_SETTINGS: ExerciseSettings = {
  weeklyGoalMin: 150,
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

/** 本周周一 0 点对应的日期串 */
function mondayStr(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0=周日
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return todayStr(d)
}

// ===== 设置 =====

export function loadSettings(): ExerciseSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      weeklyGoalMin: typeof raw.weeklyGoalMin === 'number' && raw.weeklyGoalMin > 0 ? raw.weeklyGoalMin : DEFAULT_SETTINGS.weeklyGoalMin,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: ExerciseSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

// ===== 记录 CRUD =====

/** 全部记录：{ 'YYYY-MM-DD': ExerciseEntry[] } */
function listAll(): Record<string, ExerciseEntry[]> {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}') as Record<string, ExerciseEntry[]>
  } catch {
    return {}
  }
}

function saveAll(data: Record<string, ExerciseEntry[]>) {
  // 仅保留最近 90 天，防止无限增长
  const cutoff = dateOffset(-90)
  const filtered: Record<string, ExerciseEntry[]> = {}
  for (const [date, entries] of Object.entries(data)) {
    if (date >= cutoff) filtered[date] = entries
  }
  localStorage.setItem(RECORDS_KEY, JSON.stringify(filtered))
}

/** 某日记录列表 */
export function listDayEntries(date: string): ExerciseEntry[] {
  return listAll()[date] || []
}

/** 卡路里估算：MET × 强度系数 × 体重 × 小时（体重联动 weightStore，缺省 65kg） */
export function estimateCalories(type: ExerciseType, minutes: number, intensity: ExerciseIntensity): number {
  // 延迟导入避免循环依赖；weightStore 无依赖 exerciseStore，安全
  let weightKg = 65
  try {
    const records = JSON.parse(localStorage.getItem('weight_records_v1') || '[]') as { date: string; kg: number }[]
    if (Array.isArray(records) && records.length > 0) {
      const sorted = records.filter((e) => e && typeof e.kg === 'number').sort((a, b) => a.date.localeCompare(b.date))
      if (sorted.length > 0) weightKg = sorted[sorted.length - 1].kg
    }
  } catch {
    // 保持默认体重
  }
  const kcal = EXERCISE_META[type].met * INTENSITY_META[intensity].factor * weightKg * (minutes / 60)
  return Math.round(kcal)
}

/** 添加运动记录 */
export function addExercise(type: ExerciseType, minutes: number, intensity: ExerciseIntensity, note?: string) {
  if (minutes <= 0 || minutes > 600) return false
  const all = listAll()
  const today = todayStr()
  if (!all[today]) all[today] = []
  all[today].push({
    at: Date.now(),
    type,
    minutes: Math.round(minutes),
    intensity,
    calories: estimateCalories(type, minutes, intensity),
    note: note?.trim() || undefined,
  })
  saveAll(all)
  return true
}

/** 删除今日某条记录（按时间戳） */
export function deleteExercise(at: number) {
  const all = listAll()
  const today = todayStr()
  if (!all[today]) return
  all[today] = all[today].filter((e) => e.at !== at)
  if (all[today].length === 0) delete all[today]
  saveAll(all)
}

// ===== 统计 =====

/** 类型安全的日期键分组 */
function byDateEntries(): { date: string; entries: ExerciseEntry[] }[] {
  return Object.entries(listAll())
    .map(([date, entries]) => ({ date, entries: entries || [] }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function getExerciseStat(): ExerciseStat {
  const grouped = byDateEntries()
  const { weeklyGoalMin } = loadSettings()
  const today = todayStr()
  const monday = mondayStr()

  const todayEntries = grouped.find((g) => g.date === today)?.entries || []
  const todayMinutes = todayEntries.reduce((s, e) => s + e.minutes, 0)
  const todayCalories = todayEntries.reduce((s, e) => s + e.calories, 0)

  // 本周（周一起，含今天）
  const weekGroups = grouped.filter((g) => g.date >= monday && g.date <= today)
  const weekMinutes = weekGroups.reduce((s, g) => s + g.entries.reduce((x, e) => x + e.minutes, 0), 0)
  const weekCalories = weekGroups.reduce((s, g) => s + g.entries.reduce((x, e) => x + e.calories, 0), 0)

  // 近 7 天逐日
  const last7Days: { date: string; minutes: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = dateOffset(-i)
    const entries = grouped.find((g) => g.date === d)?.entries || []
    last7Days.push({ date: d, minutes: entries.reduce((s, e) => s + e.minutes, 0) })
  }

  // 连续天数：今天没动不断签，从最近有运动的日子往前数
  const activeDates = new Set(grouped.filter((g) => g.entries.length > 0).map((g) => g.date))
  let streak = 0
  let offset = activeDates.has(today) ? 0 : -1
  while (activeDates.has(dateOffset(offset))) {
    streak++
    offset--
  }

  // 本周类型分布
  const typeMap = new Map<ExerciseType, { minutes: number; calories: number }>()
  weekGroups.forEach((g) => {
    g.entries.forEach((e) => {
      const cur = typeMap.get(e.type) || { minutes: 0, calories: 0 }
      cur.minutes += e.minutes
      cur.calories += e.calories
      typeMap.set(e.type, cur)
    })
  })
  const weekByType = Array.from(typeMap.entries())
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.minutes - a.minutes)

  // 近 30 天总量
  const cutoff30 = dateOffset(-30)
  const total30d = grouped
    .filter((g) => g.date >= cutoff30)
    .reduce((s, g) => s + g.entries.reduce((x, e) => x + e.minutes, 0), 0)

  return {
    todayMinutes,
    todayCalories,
    todayCount: todayEntries.length,
    weekMinutes,
    weekCalories,
    weekGoalPct: Math.min(100, Math.round((weekMinutes / weeklyGoalMin) * 100)),
    last7Days,
    streak,
    weekByType,
    weekDays: weekGroups.filter((g) => g.entries.length > 0).length,
    total30d,
  }
}
