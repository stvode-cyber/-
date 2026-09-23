/**
 * 技能学习追踪 · 数据层
 *
 * - localStorage：技能列表（skills_v1）+ 练习日志（skill_logs_v1）
 * - 累积练习时长 + 自动等级进阶
 * - 连续练习天数、本周统计
 * - 完全本地存储，离线可用
 */

/** 技能分类 */
export type SkillCategory = 'language' | 'music' | 'coding' | 'art' | 'sport' | 'academic' | 'other'

export interface Skill {
  id: string
  /** 名称 */
  name: string
  /** 图标 emoji */
  emoji: string
  /** 分类 */
  category: SkillCategory
  /** 目标小时数（达到即"精通"） */
  targetHours: number
  /** 颜色（hex，用于卡片主题色） */
  color: string
  /** 创建时间戳 */
  createdAt: number
}

export interface PracticeLog {
  id: string
  /** 技能 id */
  skillId: string
  /** 练习时长（分钟） */
  duration: number
  /** 日期 YYYY-MM-DD */
  date: string
  /** 备注 */
  note?: string
  /** 创建时间戳 */
  createdAt: number
}

export interface SkillWithStats extends Skill {
  /** 总练习分钟数 */
  totalMinutes: number
  /** 总练习小时数 */
  totalHours: number
  /** 等级 1-5 */
  level: number
  /** 等级标题 */
  levelTitle: string
  /** 距下一等级还需小时数 */
  toNextLevel: number
  /** 当前等级进度百分比 */
  levelPct: number
  /** 目标进度百分比 */
  targetPct: number
  /** 连续练习天数 */
  streak: number
  /** 本周练习分钟数 */
  weekMinutes: number
  /** 本周练习次数 */
  weekCount: number
  /** 最近 7 天练习记录（用于柱状图） */
  weekBars: { date: string; minutes: number }[]
  /** 练习日志总数 */
  logCount: number
}

export interface SkillStat {
  totalSkills: number
  /** 总练习小时（所有技能） */
  totalHours: number
  /** 本周练习总分钟 */
  weekMinutes: number
  /** 本周练习总次数 */
  weekCount: number
  /** 最长连续天数（所有技能中最大） */
  maxStreak: number
}

/** 分类元数据 */
export const CATEGORY_META: Record<SkillCategory, { label: string; emoji: string }> = {
  language: { label: '语言', emoji: '🌐' },
  music: { label: '音乐', emoji: '🎸' },
  coding: { label: '编程', emoji: '💻' },
  art: { label: '艺术', emoji: '🎨' },
  sport: { label: '运动', emoji: '⚽' },
  academic: { label: '学术', emoji: '📚' },
  other: { label: '其他', emoji: '✨' },
}

/** 等级定义：小时数 → 等级 */
const LEVELS: { hours: number; level: number; title: string }[] = [
  { hours: 0, level: 1, title: '入门' },
  { hours: 10, level: 2, title: '初学' },
  { hours: 50, level: 3, title: '熟练' },
  { hours: 150, level: 4, title: '精通' },
  { hours: 300, level: 5, title: '大师' },
]

/** emoji 选项 */
export const EMOJI_OPTIONS = [
  '🎸', '🎹', '🥁', '🎤', '🎵',
  '💻', '⌨️', '🖱️', '⚙️', '🔧',
  '🎨', '✏️', '🖌️', '📷', '✂️',
  '🌐', '🗣️', '📖', '📚', '✍️',
  '⚽', '🏃', '🏊', '🚴', '🏋️',
  '🧮', '🔬', '📐', '🧪', '✨',
]

/** 颜色选项 */
export const COLOR_OPTIONS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#10B981', '#14B8A6',
  '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#EC4899', '#F43F5E', '#64748B',
]

const SKILLS_KEY = 'skills_v1'
const LOGS_KEY = 'skill_logs_v1'

// ===== 日期工具 =====

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 周一起始的本周 7 天日期 */
function thisWeekDates(): string[] {
  const d = new Date()
  const day = d.getDay() // 0=周日
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday)
    dd.setDate(monday.getDate() + i)
    dates.push(todayStr(dd))
  }
  return dates
}

// ===== 等级计算 =====

function calcLevel(hours: number): { level: number; title: string; toNext: number; pct: number } {
  let cur = LEVELS[0]
  let next = LEVELS[1]
  for (let i = 0; i < LEVELS.length; i++) {
    if (hours >= LEVELS[i].hours) {
      cur = LEVELS[i]
      next = LEVELS[i + 1] || LEVELS[i]
    }
  }
  if (cur.level === 5) {
    return { level: 5, title: cur.title, toNext: 0, pct: 100 }
  }
  const range = next.hours - cur.hours
  const progress = hours - cur.hours
  return {
    level: cur.level,
    title: cur.title,
    toNext: Math.max(0, Math.round((next.hours - hours) * 10) / 10),
    pct: Math.min(100, Math.round((progress / range) * 100)),
  }
}

// ===== 连续天数 =====

function calcStreak(logs: PracticeLog[]): number {
  if (logs.length === 0) return 0
  const dates = new Set(logs.map((l) => l.date))
  let streak = 0
  const d = new Date()
  // 今天有练习从今天开始，否则从昨天开始
  if (!dates.has(todayStr(d))) {
    d.setDate(d.getDate() - 1)
  }
  while (dates.has(todayStr(d))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

// ===== CRUD =====

function listSkills(): Skill[] {
  try {
    return JSON.parse(localStorage.getItem(SKILLS_KEY) || '[]') as Skill[]
  } catch {
    return []
  }
}

function listLogs(): PracticeLog[] {
  try {
    return JSON.parse(localStorage.getItem(LOGS_KEY) || '[]') as PracticeLog[]
  } catch {
    return []
  }
}

function saveSkills(list: Skill[]) {
  localStorage.setItem(SKILLS_KEY, JSON.stringify(list))
}

function saveLogs(list: PracticeLog[]) {
  localStorage.setItem(LOGS_KEY, JSON.stringify(list))
}

function genId(): string {
  return `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 新增技能 */
export function addSkill(data: Omit<Skill, 'id' | 'createdAt'>): Skill {
  const skill: Skill = { ...data, id: genId(), createdAt: Date.now() }
  const all = listSkills()
  all.push(skill)
  saveSkills(all)
  return skill
}

/** 更新技能 */
export function updateSkill(id: string, data: Partial<Omit<Skill, 'id' | 'createdAt'>>) {
  const all = listSkills()
  const idx = all.findIndex((s) => s.id === id)
  if (idx === -1) return
  all[idx] = { ...all[idx], ...data }
  saveSkills(all)
}

/** 删除技能（同时删除其日志） */
export function deleteSkill(id: string) {
  saveSkills(listSkills().filter((s) => s.id !== id))
  saveLogs(listLogs().filter((l) => l.skillId !== id))
}

/** 添加练习日志 */
export function addPractice(skillId: string, duration: number, note?: string) {
  if (duration <= 0) return
  const log: PracticeLog = {
    id: genId(),
    skillId,
    duration,
    date: todayStr(),
    note: note?.trim() || undefined,
    createdAt: Date.now(),
  }
  const all = listLogs()
  all.push(log)
  saveLogs(all)
}

/** 删除练习日志 */
export function deletePractice(logId: string) {
  saveLogs(listLogs().filter((l) => l.id !== logId))
}

// ===== 统计 =====

/** 获取所有技能 + 统计 */
export function listSkillsWithStats(): SkillWithStats[] {
  const skills = listSkills()
  const logs = listLogs()
  const week = thisWeekDates()

  return skills.map((skill) => {
    const skillLogs = logs.filter((l) => l.skillId === skill.id)
    const totalMinutes = skillLogs.reduce((s, l) => s + l.duration, 0)
    const totalHours = totalMinutes / 60
    const levelInfo = calcLevel(totalHours)

    const weekLogs = skillLogs.filter((l) => week.includes(l.date))
    const weekMinutes = weekLogs.reduce((s, l) => s + l.duration, 0)
    const weekCount = weekLogs.length

    const weekBars = week.map((date) => ({
      date,
      minutes: skillLogs.filter((l) => l.date === date).reduce((s, l) => s + l.duration, 0),
    }))

    return {
      ...skill,
      totalMinutes,
      totalHours: Math.round(totalHours * 10) / 10,
      level: levelInfo.level,
      levelTitle: levelInfo.title,
      toNextLevel: levelInfo.toNext,
      levelPct: levelInfo.pct,
      targetPct: Math.min(100, Math.round((totalHours / skill.targetHours) * 100)),
      streak: calcStreak(skillLogs),
      weekMinutes,
      weekCount,
      weekBars,
      logCount: skillLogs.length,
    }
  })
}

/** 获取某技能的练习日志（按时间倒序） */
export function getPracticeLogs(skillId: string, limit = 10): PracticeLog[] {
  return listLogs()
    .filter((l) => l.skillId === skillId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

export function getSkillStat(): SkillStat {
  const skills = listSkillsWithStats()
  const week = thisWeekDates()
  const logs = listLogs().filter((l) => week.includes(l.date))

  return {
    totalSkills: skills.length,
    totalHours: Math.round(skills.reduce((s, sk) => s + sk.totalHours, 0) * 10) / 10,
    weekMinutes: logs.reduce((s, l) => s + l.duration, 0),
    weekCount: logs.length,
    maxStreak: skills.length > 0 ? Math.max(...skills.map((s) => s.streak)) : 0,
  }
}
