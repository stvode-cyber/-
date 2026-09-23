/**
 * 习惯追踪 · 数据层
 *
 * - localStorage：习惯列表（habit_habits_v1）+ 打卡记录（habit_checkins_v1）
 * - 完全本地存储，支持离线使用
 * - 打卡记录以 habitId:YYYY-MM-DD 为键，方便快速查询
 */

export type HabitFrequency = 'daily' | 'weekly'

export interface Habit {
  id: string
  name: string
  /** 图标标识（对应 lucide 图标名） */
  icon: string
  /** 主题色（hex） */
  color: string
  /** 频率：daily=每天 / weekly=每周 */
  frequency: HabitFrequency
  /** 每周目标天数（frequency=weekly 时使用，1-7） */
  weeklyTarget: number
  /** 创建时间戳 */
  createdAt: number
  /** 是否归档（软删除） */
  archived: boolean
}

export interface HabitStat {
  /** 当前连续天数（截至今天） */
  currentStreak: number
  /** 最长连续天数 */
  longestStreak: number
  /** 总打卡次数 */
  totalCheckins: number
  /** 近 30 天完成率（百分比） */
  completionRate: number
  /** 近 7 天打卡情况 */
  last7Days: { date: string; checked: boolean }[]
}

const HABITS_KEY = 'habit_habits_v1'
const CHECKINS_KEY = 'habit_checkins_v1'

/** 可选图标列表 */
export const HABIT_ICONS = [
  'Dumbbell', 'BookOpen', 'Code', 'Droplet', 'Apple', 'Footprints',
  'Moon', 'Sun', 'Pencil', 'Music', 'PawPrint', 'Heart',
  'Coffee', 'Cigarette', 'Smartphone', 'Gamepad2',
] as const

/** 可选颜色列表 */
export const HABIT_COLORS = [
  '#10B981', '#3B82F6', '#8B5CF6', '#EC4899',
  '#F59E0B', '#EF4444', '#06B6D4', '#84CC16',
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

/** 获取两个日期之间的天数差（b - a） */
function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00')
  const db = new Date(b + 'T00:00:00')
  return Math.round((db.getTime() - da.getTime()) / (24 * 60 * 60 * 1000))
}

// ===== 习惯 CRUD =====

export function listHabits(): Habit[] {
  try {
    return (JSON.parse(localStorage.getItem(HABITS_KEY) || '[]') as Habit[]).filter((h) => !h.archived)
  } catch {
    return []
  }
}

function saveHabits(habits: Habit[]) {
  localStorage.setItem(HABITS_KEY, JSON.stringify(habits))
}

export function getHabit(id: string): Habit | null {
  try {
    const all = JSON.parse(localStorage.getItem(HABITS_KEY) || '[]') as Habit[]
    return all.find((h) => h.id === id) || null
  } catch {
    return null
  }
}

export function addHabit(data: Omit<Habit, 'id' | 'createdAt' | 'archived'>): Habit {
  const habit: Habit = {
    ...data,
    id: `hb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    archived: false,
  }
  const all = listAllHabits()
  all.push(habit)
  saveHabits(all)
  return habit
}

export function updateHabit(id: string, patch: Partial<Habit>) {
  const all = listAllHabits()
  const idx = all.findIndex((h) => h.id === id)
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...patch }
    saveHabits(all)
  }
}

export function deleteHabit(id: string) {
  const all = listAllHabits().filter((h) => h.id !== id)
  saveHabits(all)
  // 清除该习惯的所有打卡记录
  const checkins = listAllCheckins()
  delete checkins[id]
  saveCheckins(checkins)
}

function listAllHabits(): Habit[] {
  try {
    return JSON.parse(localStorage.getItem(HABITS_KEY) || '[]') as Habit[]
  } catch {
    return []
  }
}

// ===== 打卡记录 =====

interface CheckinData {
  [habitId: string]: string[] // 日期数组 YYYY-MM-DD
}

function listAllCheckins(): CheckinData {
  try {
    return JSON.parse(localStorage.getItem(CHECKINS_KEY) || '{}') as CheckinData
  } catch {
    return {}
  }
}

function saveCheckins(data: CheckinData) {
  localStorage.setItem(CHECKINS_KEY, JSON.stringify(data))
}

/** 检查某习惯在某日是否已打卡 */
export function isChecked(habitId: string, date: string): boolean {
  const data = listAllCheckins()
  return (data[habitId] || []).includes(date)
}

/** 切换打卡状态（已打卡→取消，未打卡→打卡） */
export function toggleCheckin(habitId: string, date: string): boolean {
  const data = listAllCheckins()
  if (!data[habitId]) data[habitId] = []
  const idx = data[habitId].indexOf(date)
  if (idx >= 0) {
    data[habitId].splice(idx, 1)
    saveCheckins(data)
    return false
  } else {
    data[habitId].push(date)
    data[habitId].sort()
    saveCheckins(data)
    return true
  }
}

/** 获取某习惯的所有打卡日期（升序） */
export function getCheckinDates(habitId: string): string[] {
  const data = listAllCheckins()
  return (data[habitId] || []).slice().sort()
}

// ===== 统计 =====

export function getHabitStat(habitId: string): HabitStat {
  const dates = getCheckinDates(habitId)
  const today = todayStr()
  const dateSet = new Set(dates)

  // 当前连续天数：从今天往前数
  let currentStreak = 0
  // 如果今天没打卡，从昨天开始算（允许今天还没打卡）
  let checkDate = dateSet.has(today) ? 0 : -1
  while (dateSet.has(dateOffset(checkDate))) {
    currentStreak++
    checkDate--
  }

  // 最长连续天数
  let longestStreak = 0
  let tempStreak = 0
  let prevDate: string | null = null
  for (const d of dates) {
    if (prevDate && daysBetween(prevDate, d) === 1) {
      tempStreak++
    } else {
      tempStreak = 1
    }
    longestStreak = Math.max(longestStreak, tempStreak)
    prevDate = d
  }

  // 近 7 天
  const last7Days: { date: string; checked: boolean }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = dateOffset(-i)
    last7Days.push({ date: d, checked: dateSet.has(d) })
  }

  // 近 30 天完成率
  let completed30 = 0
  for (let i = 0; i < 30; i++) {
    if (dateSet.has(dateOffset(-i))) completed30++
  }

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    totalCheckins: dates.length,
    completionRate: Math.round((completed30 / 30) * 100),
    last7Days,
  }
}

/** 获取今日需打卡的习惯数 */
export function getTodayProgress(): { total: number; completed: number } {
  const habits = listHabits()
  const today = todayStr()
  let completed = 0
  for (const h of habits) {
    if (isChecked(h.id, today)) completed++
  }
  return { total: habits.length, completed }
}
