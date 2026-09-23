/**
 * 每周回顾 · 聚合数据层
 *
 * 汇总四个本地模块的一周表现，生成个人周报：
 * - 习惯打卡（habitStore）
 * - 心情记录（moodStore）
 * - 番茄钟专注（pomodoroStore，仅保留 30 天）
 * - 小说阅读（novelStore）
 *
 * 纯只读聚合，不写入任何数据；全部本地计算，离线可用。
 */

import { listHabits, getCheckinDates } from './habitStore'
import { getRecord, MOOD_META, type MoodLevel } from './moodStore'
import { getRecentStats } from './pomodoroStore'
import { getStatsInRange } from './novelStore'
import { getDayMl, loadSettings as loadWaterSettings } from './waterStore'
import { getDatesInRange as getDiaryDates } from './diaryStore'

/** 周内某天概览 */
export interface DayOverview {
  /** 日期 YYYY-MM-DD */
  date: string
  /** 星期标签（一~日） */
  weekday: string
  /** 习惯打卡数 / 当日应有习惯数 */
  habitChecked: number
  habitTotal: number
  /** 心情等级（未记录为 null） */
  mood: MoodLevel | null
  /** 专注分钟数 */
  focusMinutes: number
  /** 番茄钟完成数 */
  pomodoros: number
  /** 阅读分钟数（秒取整） */
  readMinutes: number
  /** 饮水量（ml） */
  waterMl: number
}

/** 习惯周表现 */
export interface HabitWeekly {
  habitId: string
  name: string
  color: string
  /** 本周打卡天数 */
  days: number
  /** 7 天打卡明细（周一→周日） */
  daily: boolean[]
}

/** 周报数据 */
export interface WeekReview {
  /** 周一日期 YYYY-MM-DD */
  weekStart: string
  /** 周日日期 YYYY-MM-DD */
  weekEnd: string
  /** 是否当前周 */
  isCurrent: boolean
  /** 每日概览（周一→周日） */
  days: DayOverview[]
  /** 活跃天数（任一模块有记录的天数） */
  activeDays: number
  // ===== 习惯 =====
  habitWeekly: HabitWeekly[]
  habitTotalCheckins: number
  habitBestName: string | null
  // ===== 心情 =====
  moodRecordedDays: number
  moodAverage: number
  moodBestDay: DayOverview | null
  moodWorstDay: DayOverview | null
  // ===== 番茄钟 =====
  focusMinutes: number
  pomodoros: number
  focusBestDay: DayOverview | null
  // ===== 阅读 =====
  readMinutes: number
  readDays: number
  // ===== 饮水 =====
  waterMl: number
  waterGoalDays: number
  waterAverage: number
  // ===== 日记 =====
  diaryDays: number
  diaryWords: number
  // ===== 综合评分（0-100）与建议 =====
  score: number
  scoreLabel: string
  insights: string[]
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 获取某日期所在周的周一 0 点 */
export function getMonday(offsetWeeks = 0, ref = new Date()): Date {
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0=周日
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff + offsetWeeks * 7)
  return d
}

/** 生成周报（weekOffset：0=本周，-1=上周，…） */
export function getWeekReview(weekOffset = 0): WeekReview {
  const monday = getMonday(weekOffset)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)

  const weekStart = dateStr(monday)
  const weekEnd = dateStr(sunday)
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    dates.push(dateStr(d))
  }

  // ===== 习惯：每个习惯一周内的打卡明细 =====
  const habits = listHabits()
  const habitWeekly: HabitWeekly[] = habits.map((h) => {
    const checkins = new Set(getCheckinDates(h.id))
    const daily = dates.map((ds) => checkins.has(ds))
    return {
      habitId: h.id,
      name: h.name,
      color: h.color,
      days: daily.filter(Boolean).length,
      daily,
    }
  })
  const habitTotalCheckins = habitWeekly.reduce((s, h) => s + h.days, 0)
  const habitBest = habitWeekly.reduce<HabitWeekly | null>(
    (best, h) => (h.days > 0 && (!best || h.days > best.days) ? h : best),
    null,
  )

  // ===== 番茄钟：近 30 天统计中筛出本周 =====
  const pomodoroStats = getRecentStats(30)
  const pomoMap = new Map(pomodoroStats.map((s) => [s.date, s]))

  // ===== 阅读：按周范围查询 =====
  const novelStats = getStatsInRange(weekStart, weekEnd)
  const novelMap = new Map(novelStats.map((s) => [s.date, s]))

  // ===== 每日概览 =====
  const now = new Date()
  const todayDs = dateStr(now)
  const days: DayOverview[] = dates.map((ds, i) => {
    const moodRec = getRecord(ds)
    const pomo = pomoMap.get(ds)
    const novel = novelMap.get(ds)
    const habitChecked = habitWeekly.reduce(
      (s, h) => s + (h.daily[i] ? 1 : 0),
      0,
    )
    return {
      date: ds,
      weekday: WEEKDAY_LABELS[i],
      habitChecked,
      habitTotal: habits.length,
      mood: moodRec ? moodRec.level : null,
      focusMinutes: pomo?.focusMinutes || 0,
      pomodoros: pomo?.sessions || 0,
      readMinutes: Math.round((novel?.seconds || 0) / 60),
      waterMl: getDayMl(ds),
    }
  })

  // 只统计到今天（本周未来几天不算）
  const counted = days.filter((d) => d.date <= todayDs)
  const activeDays = counted.filter(
    (d) => d.habitChecked > 0 || d.mood !== null || d.focusMinutes > 0 || d.readMinutes > 0 || d.waterMl > 0,
  ).length

  // ===== 心情聚合 =====
  const moodDays = counted.filter((d) => d.mood !== null)
  const moodRecordedDays = moodDays.length
  const moodAverage = moodRecordedDays > 0
    ? Math.round((moodDays.reduce((s, d) => s + (d.mood as number), 0) / moodRecordedDays) * 10) / 10
    : 0
  const moodBestDay = moodRecordedDays > 0
    ? moodDays.reduce((a, b) => ((a.mood as number) >= (b.mood as number) ? a : b))
    : null
  const moodWorstDay = moodRecordedDays > 0
    ? moodDays.reduce((a, b) => ((a.mood as number) <= (b.mood as number) ? a : b))
    : null

  // ===== 番茄钟聚合 =====
  const focusMinutes = counted.reduce((s, d) => s + d.focusMinutes, 0)
  const pomodoros = counted.reduce((s, d) => s + d.pomodoros, 0)
  const focusBestDay = counted.reduce<DayOverview | null>(
    (best, d) => (d.focusMinutes > 0 && (!best || d.focusMinutes > best.focusMinutes) ? d : best),
    null,
  )

  // ===== 阅读聚合 =====
  const readMinutes = counted.reduce((s, d) => s + d.readMinutes, 0)
  const readDays = counted.filter((d) => d.readMinutes > 0).length

  // ===== 饮水聚合 =====
  const waterGoal = loadWaterSettings().dailyGoal
  const waterMl = counted.reduce((s, d) => s + d.waterMl, 0)
  const waterGoalDays = counted.filter((d) => d.waterMl >= waterGoal).length
  const waterRecordedDays = counted.filter((d) => d.waterMl > 0)
  const waterAverage = waterRecordedDays.length > 0
    ? Math.round(waterMl / waterRecordedDays.length)
    : 0

  // ===== 日记聚合（只统计到今天） =====
  const diaryMap = getDiaryDates(weekStart, todayDs < weekEnd ? todayDs : weekEnd)
  const diaryDays = diaryMap.size
  const diaryWords = Array.from(diaryMap.values()).reduce((s, v) => s + v.words, 0)

  // ===== 综合评分 =====
  // 维度归一化（0-1）后加权：习惯 32% + 心情 23% + 专注 22% + 阅读 13% + 饮水 10%
  const elapsedDays = Math.max(1, counted.length)
  const habitRate = habits.length > 0
    ? Math.min(1, habitTotalCheckins / (habits.length * elapsedDays))
    : 0
  const moodScore = moodRecordedDays > 0 ? Math.min(1, moodAverage / 5) : 0
  const focusScore = Math.min(1, focusMinutes / (elapsedDays * 100)) // 每天 100 分钟满分
  const readScore = Math.min(1, readMinutes / (elapsedDays * 30)) // 每天 30 分钟满分
  const waterScore = Math.min(1, waterMl / (elapsedDays * waterGoal)) // 每天达标满分
  const score = Math.round(
    (habits.length > 0 ? habitRate * 32 : 0) +
    (moodRecordedDays > 0 ? moodScore * 23 : 0) +
    (focusMinutes > 0 ? focusScore * 22 : 0) +
    (readMinutes > 0 ? readScore * 13 : 0) +
    (waterMl > 0 ? waterScore * 10 : 0),
  )
  const scoreLabel = score >= 80 ? '卓越一周' : score >= 60 ? '表现不错' : score >= 40 ? '稳中有进' : score > 0 ? '还需加油' : '暂无数据'

  // ===== 生成建议 =====
  const insights: string[] = []
  if (habitTotalCheckins > 0 && habitBest) {
    insights.push(`「${habitBest.name}」本周打卡 ${habitBest.days} 天，坚持得很棒！`)
  } else if (habits.length > 0) {
    insights.push('本周还没有习惯打卡记录，从一个小习惯开始吧。')
  }
  if (moodRecordedDays >= 3) {
    insights.push(`本周平均心情 ${moodAverage} 分${moodBestDay ? `，状态最好的一天是周${moodBestDay.weekday}` : ''}。`)
    if (moodAverage <= 2.5) insights.push('本周心情偏低，记得照顾好自己，多做一些让自己开心的事。')
    if (moodAverage >= 4) insights.push('整周心情都不错，保持这份好状态！')
  } else if (moodRecordedDays > 0) {
    insights.push('心情记录只有零星几天，每天花 10 秒记录，月底能看到情绪变化。')
  }
  if (focusMinutes > 0 && focusBestDay) {
    const h = Math.floor(focusMinutes / 60)
    const m = focusMinutes % 60
    insights.push(`本周累计专注 ${h > 0 ? `${h} 小时 ` : ''}${m} 分钟，最高效的是周${focusBestDay.weekday}（${focusBestDay.focusMinutes} 分钟）。`)
  }
  if (readMinutes > 0) {
    insights.push(`阅读了 ${readMinutes} 分钟${readDays >= 3 ? `，覆盖 ${readDays} 天，习惯性阅读正在养成` : ''}。`)
  }
  if (waterMl > 0) {
    insights.push(`本周共饮水 ${(waterMl / 1000).toFixed(1)}L，${waterGoalDays} 天达标（目标 ${waterGoal / 1000}L/天）${waterAverage > 0 ? `，日均 ${waterAverage}ml` : ''}。`)
    if (waterRecordedDays.length >= 3 && waterGoalDays === 0) {
      insights.push('饮水一直未达标，试试在水杯贴个提醒，或每次专注后喝一杯。')
    }
  }
  if (diaryDays > 0) {
    insights.push(`本周写了 ${diaryDays} 篇日记（共 ${diaryWords} 字）${diaryDays >= 4 ? '，记录已成为习惯' : ''}。`)
  }
  if (insights.length === 0) {
    insights.push('本周暂无活动记录，去记个心情、打个卡或专注一会儿吧。')
  }

  return {
    weekStart,
    weekEnd,
    isCurrent: weekOffset === 0,
    days,
    activeDays,
    habitWeekly,
    habitTotalCheckins,
    habitBestName: habitBest?.name || null,
    moodRecordedDays,
    moodAverage,
    moodBestDay,
    moodWorstDay,
    focusMinutes,
    pomodoros,
    focusBestDay,
    readMinutes,
    readDays,
    waterMl,
    waterGoalDays,
    waterAverage,
    diaryDays,
    diaryWords,
    score,
    scoreLabel,
    insights,
  }
}

/** 心情等级 → 颜色（页面渲染用） */
export function moodColor(level: number): string {
  return MOOD_META[level as MoodLevel]?.color || '#D1D5DB'
}

/** 格式化周区间显示（如 8.11 - 8.17） */
export function formatWeekRange(review: WeekReview): string {
  const [, sm, sd] = review.weekStart.split('-')
  const [, em, ed] = review.weekEnd.split('-')
  return `${parseInt(sm, 10)}.${parseInt(sd, 10)} - ${parseInt(em, 10)}.${parseInt(ed, 10)}`
}
