/**
 * 番茄钟专注计时器 · 数据层
 *
 * - localStorage：设置（pomodoro_settings_v1）+ 历史（pomodoro_history_v1）
 * - 完全本地存储，支持离线使用
 * - 单次专注时长用于今日统计 + 近 7 天柱状图
 */

export interface PomodoroSettings {
  /** 专注时长（分钟） */
  focusMin: number
  /** 短休时长（分钟） */
  shortBreakMin: number
  /** 长休时长（分钟） */
  longBreakMin: number
  /** 长休间隔：完成几个番茄后进入长休 */
  longBreakInterval: number
  /** 是否自动开始休息 */
  autoStartBreak: boolean
  /** 是否自动开始下一个专注 */
  autoStartFocus: boolean
  /** 是否开启声音提醒 */
  soundEnabled: boolean
}

export interface PomodoroSession {
  /** 开始时间戳 ms */
  startedAt: number
  /** 持续分钟数 */
  minutes: number
  /** 是否完成（true）或中断（false） */
  completed: boolean
}

export interface PomodoroDailyStat {
  date: string // YYYY-MM-DD
  sessions: number
  focusMinutes: number
}

const SETTINGS_KEY = 'pomodoro_settings_v1'
const HISTORY_KEY = 'pomodoro_history_v1'

export const DEFAULT_SETTINGS: PomodoroSettings = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakInterval: 4,
  autoStartBreak: false,
  autoStartFocus: false,
  soundEnabled: true,
}

export function loadPomodoroSettings(): PomodoroSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function savePomodoroSettings(s: PomodoroSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

function listHistory(): PomodoroSession[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as PomodoroSession[]
  } catch {
    return []
  }
}

function saveHistory(h: PomodoroSession[]) {
  // 仅保留最近 30 天数据
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const filtered = h.filter((s) => s.startedAt >= cutoff)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered))
}

/** 记录一次专注会话（无论是否完成都记录） */
export function recordSession(minutes: number, completed: boolean) {
  if (minutes <= 0) return
  const h = listHistory()
  h.push({ startedAt: Date.now(), minutes, completed })
  saveHistory(h)
}

function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 今日统计 */
export function getTodayStat(): PomodoroDailyStat {
  const today = todayStr()
  return aggregateByDate(listHistory())[today] || { date: today, sessions: 0, focusMinutes: 0 }
}

/** 近 N 天统计（含今天，按日期升序） */
export function getRecentStats(days = 7): PomodoroDailyStat[] {
  const agg = aggregateByDate(listHistory())
  const out: PomodoroDailyStat[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const ds = todayStr(d)
    out.push(agg[ds] || { date: ds, sessions: 0, focusMinutes: 0 })
  }
  return out
}

function aggregateByDate(history: PomodoroSession[]): Record<string, PomodoroDailyStat> {
  const out: Record<string, PomodoroDailyStat> = {}
  for (const s of history) {
    if (!s.completed) continue
    const ds = todayStr(new Date(s.startedAt))
    if (!out[ds]) out[ds] = { date: ds, sessions: 0, focusMinutes: 0 }
    out[ds].sessions++
    out[ds].focusMinutes += s.minutes
  }
  return out
}

/** 累计统计：总专注时长、总番茄数、连续天数 */
export function getOverview() {
  const history = listHistory().filter((s) => s.completed)
  const totalMinutes = history.reduce((s, x) => s + x.minutes, 0)
  const totalSessions = history.length
  // 连续天数
  const agg = aggregateByDate(history)
  let streak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const ds = todayStr(d)
    if (agg[ds] && agg[ds].sessions > 0) streak++
    else if (i === 0) continue
    else break
  }
  return { totalMinutes, totalSessions, streak }
}

export function formatMin(min: number): string {
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest > 0 ? `${h}小时${rest}分` : `${h}小时`
}
