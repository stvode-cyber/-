/**
 * 倒计时核心工具库
 *
 * 设计要点：
 * 1. 4 种循环模式（daily/weekly/monthly/yearly/custom）的 nextTrigger 计算
 * 2. 递减式提醒规则（6 个区间，按剩余时间动态选频率与等级）
 * 3. 进度与里程碑自动更新
 * 4. 内置 setInterval 调度器（每分钟扫描 active 倒计时生成提醒）
 *    - 不引入 node-cron 等外部依赖，保持 MVP 轻量（与 rateLimit 中间件风格一致）
 *
 * 审计与日志：
 * - 生成的提醒仅写入 CountdownReminder 表与 auditLog（category=countdown）
 * - 实际推送（Web Push 协议）需安装 web-push 包，当前版本先做"订阅存储 + 前端轮询"
 */

import { prisma } from '../lib/prisma.js'
import { audit } from './audit.js'

// ============ 类型定义 ============

export type CountdownType = 'single' | 'recurring' | 'important' | 'goal'
export type CountdownStatus = 'active' | 'paused' | 'completed' | 'cancelled'
export type RecurringPattern = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
export type ReminderLevel = 'normal' | 'appropriate' | 'urgent'
export type ReminderRule = 'decreasing' | 'fixed' | 'custom'

/** 循环配置 */
export interface RecurringConfig {
  pattern: RecurringPattern
  customRule?: string
  /** 触发时间（HH:mm），仅 daily/weekly/monthly/yearly 有效；custom 由 customRule 解析 */
  triggerTime?: string
  nextTrigger?: string // ISO
  /** 倒计时显示开始时间（HH:mm），如 "09:00"。
   *  仅影响前端显示：在触发时间前 countdownStartAt 时刻才开始显示倒计时。
   *  未设置时默认一直显示倒计时。 */
  countdownStartAt?: string
}

/** 里程碑节点 */
export interface Milestone {
  label: string
  percentage: number
  reached: boolean
}

/** 提醒强度 */
export type ReminderIntensity = 'light' | 'normal' | 'strong'

/** 提醒配置 */
export interface ReminderConfig {
  enabled: boolean
  rule: ReminderRule
  /** 提醒强度：light=轻度(间隔×2) / normal=标准(默认) / strong=强力(间隔×0.5) */
  intensity?: ReminderIntensity
  /** 递减规则（rule=decreasing 时使用） */
  decreasingRule?: DecreasingRule
  /** 自定义提醒列表（rule=custom 时使用） */
  customReminders?: CustomReminder[]
}

/** 递减规则（按剩余天数区间映射频率与等级） */
export interface DecreasingRule {
  over30days: string // "每周一 09:00"
  '7to30days': string // "每2天 09:00"
  '1to7days': string // "每天 09:00"
  last24hours: string // "每4小时"
  last1hour: string // "每15分钟"
}

/** 自定义提醒项 */
export interface CustomReminder {
  daysBefore: number
  time: string // "09:00"
  level: ReminderLevel
}

/** 庆祝配置 */
export interface CelebrationConfig {
  enabled: boolean
  style: 'confetti' | 'fireworks' | 'milestone' | 'minimal'
  sound?: string
  message?: string
}

/** 关联模块配置 */
export interface LinkedModules {
  wishFund?: string
  goalPlan?: string
  importantDay?: string
}

/** Countdown Prisma 行（含必要字段）
 *
 * 注意：SQLite 不支持 Json 类型，所有结构化字段以 String 存储（JSON 序列化）。
 * - recurringConfig / milestones / reminderConfig / celebrationConfig / linkedModules / completionSnapshot
 * - 读取时需 JSON.parse，写入时需 JSON.stringify
 */
export interface CountdownRow {
  id: string
  userId: string
  type: string
  title: string
  description: string | null
  targetDate: Date | null
  createdDate: Date
  recurringConfig: string | null
  milestones: string | null
  reminderConfig: string | null
  celebrationConfig: string | null
  linkedModules: string | null
  status: string
  progress: number
  isPinned: boolean
  isImportant: boolean
  lastNotified: Date | null
  completedAt: Date | null
  completionSnapshot: string | null
  updatedAt: Date
}

/** 安全解析 JSON 字符串字段 */
export function parseJsonField<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

// ============ 循环触发时间计算 ============

/**
 * 计算循环倒计时的下次触发时间
 *
 * @param pattern 循环模式
 * @param from 基准时间（默认当前）
 * @param customRule 自定义规则描述（仅 pattern=custom 时使用，解析"每周五 18:00"等格式）
 * @param triggerTime 触发时间（HH:mm，如 "18:00"）。仅 daily/weekly/monthly/yearly 有效，会覆盖默认 00:00
 * @returns 下次触发时间（Date）
 */
export function computeNextTrigger(
  pattern: RecurringPattern,
  from: Date = new Date(),
  customRule?: string,
  triggerTime?: string,
): Date {
  const next = new Date(from)
  // 解析 triggerTime（HH:mm → 小时/分钟）
  let hh = 0, mm = 0
  if (triggerTime && pattern !== 'custom') {
    const m = triggerTime.match(/^(\d{1,2}):(\d{2})$/)
    if (m) {
      hh = parseInt(m[1], 10)
      mm = parseInt(m[2], 10)
    }
  }
  switch (pattern) {
    case 'daily':
      // 今天指定时刻（如果今天的时刻还没到，用今天；否则用明天）
      next.setHours(hh, mm, 0, 0)
      if (next <= from) {
        next.setDate(next.getDate() + 1)
      }
      return next
    case 'weekly': {
      // 本周目标日（周一）指定时刻：如果今天就是目标日且时间未过，用今天；否则下周
      const daysUntilMonday = (8 - from.getDay()) % 7 // 0 = 今天是周一
      next.setDate(from.getDate() + daysUntilMonday)
      next.setHours(hh, mm, 0, 0)
      if (next <= from) {
        next.setDate(next.getDate() + 7)
      }
      return next
    }
    case 'monthly': {
      // 本月 1 号指定时刻：如果 1 号还没到或时间未过，用本月；否则下月
      next.setDate(1)
      next.setHours(hh, mm, 0, 0)
      if (next <= from) {
        next.setMonth(next.getMonth() + 1, 1)
        next.setHours(hh, mm, 0, 0)
      }
      return next
    }
    case 'yearly': {
      // 今年同月同日指定时刻：如果今年的还没到，用今年；否则明年
      next.setHours(hh, mm, 0, 0)
      if (next <= from) {
        next.setFullYear(next.getFullYear() + 1)
        next.setHours(hh, mm, 0, 0)
      }
      return next
    }
    case 'custom':
      // 解析自定义规则：支持"每周X HH:mm"、"每日 HH:mm"、"每月X号 HH:mm"
      return parseCustomRule(customRule, from)
    default:
      return next
  }
}

/** 解析自定义循环规则 */
function parseCustomRule(rule: string | undefined, from: Date): Date {
  if (!rule) return computeNextTrigger('daily', from)
  const next = new Date(from)
  const now = new Date(from)

  // 每周X HH:mm
  const weeklyMatch = rule.match(/每周([一二三四五六日天])(?:\s+(\d{1,2}):(\d{2}))?/)
  if (weeklyMatch) {
    const dayMap: Record<string, number> = {
      一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
    }
    const targetDay = dayMap[weeklyMatch[1]]
    const hh = weeklyMatch[2] ? parseInt(weeklyMatch[2], 10) : 0
    const mm = weeklyMatch[3] ? parseInt(weeklyMatch[3], 10) : 0
    const curDay = now.getDay()
    let diff = (targetDay - curDay + 7) % 7
    if (diff === 0) {
      // 当天：若时间已过则推到下周
      if (hh < now.getHours() || (hh === now.getHours() && mm <= now.getMinutes())) {
        diff = 7
      }
    }
    next.setDate(now.getDate() + diff)
    next.setHours(hh, mm, 0, 0)
    return next
  }

  // 每日 HH:mm
  const dailyMatch = rule.match(/每日(?:\s+(\d{1,2}):(\d{2}))?/)
  if (dailyMatch) {
    const hh = dailyMatch[1] ? parseInt(dailyMatch[1], 10) : 0
    const mm = dailyMatch[2] ? parseInt(dailyMatch[2], 10) : 0
    next.setHours(hh, mm, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    return next
  }

  // 每月X号 HH:mm
  const monthlyMatch = rule.match(/每月(\d+)号(?:\s+(\d{1,2}):(\d{2}))?/)
  if (monthlyMatch) {
    const day = parseInt(monthlyMatch[1], 10)
    const hh = monthlyMatch[2] ? parseInt(monthlyMatch[2], 10) : 0
    const mm = monthlyMatch[3] ? parseInt(monthlyMatch[3], 10) : 0
    let targetMonth = now.getMonth()
    let targetYear = now.getFullYear()
    if (day < now.getDate() || (day === now.getDate() && (hh < now.getHours() || (hh === now.getHours() && mm <= now.getMinutes())))) {
      targetMonth += 1
      if (targetMonth > 11) {
        targetMonth = 0
        targetYear += 1
      }
    }
    return new Date(targetYear, targetMonth, day, hh, mm, 0, 0)
  }

  // 兜底：次日 00:00
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  return next
}

// ============ 递减式提醒规则 ============

/** 6 个递减区间定义：根据剩余时间返回应通知的等级与最小间隔（分钟） */
export interface DecreasingZone {
  zone: 'over30days' | '7to30days' | '1to7days' | 'last24hours' | 'last1hour' | 'deadline' | 'overdue'
  level: ReminderLevel
  /** 同区间内最小通知间隔（分钟） */
  intervalMin: number
  /** 该区间匹配的提示文案 */
  hint: string
}

/** 根据剩余毫秒数选定递减区间 */
export function pickDecreasingZone(remainingMs: number): DecreasingZone {
  if (remainingMs < -30 * 60 * 1000) {
    // 超期 30 分钟以上
    return { zone: 'overdue', level: 'urgent', intervalMin: 30, hint: '已超期' }
  }
  if (remainingMs <= 0) {
    // 截止时刻
    return { zone: 'deadline', level: 'urgent', intervalMin: 0, hint: '截止' }
  }
  if (remainingMs < 60 * 60 * 1000) {
    // 最后 1 小时：每 15 分钟
    return { zone: 'last1hour', level: 'urgent', intervalMin: 15, hint: '最后 1 小时' }
  }
  if (remainingMs < 24 * 60 * 60 * 1000) {
    // 最后 24 小时：每 4 小时
    return { zone: 'last24hours', level: 'appropriate', intervalMin: 240, hint: '最后 24 小时' }
  }
  if (remainingMs < 7 * 24 * 60 * 60 * 1000) {
    // 1-7 天：每天
    return { zone: '1to7days', level: 'appropriate', intervalMin: 1440, hint: '1 周内' }
  }
  if (remainingMs < 30 * 24 * 60 * 60 * 1000) {
    // 7-30 天：每 2 天
    return { zone: '7to30days', level: 'normal', intervalMin: 2880, hint: '1 个月内' }
  }
  // >30 天：每周
  return { zone: 'over30days', level: 'normal', intervalMin: 10080, hint: '1 个月外' }
}

/** 生成提醒内容文案 */
export function buildReminderContent(
  countdown: { id: string; title: string; type: string; targetDate: Date | null },
  zone: DecreasingZone,
  now: Date = new Date(),
): string {
  const target = countdown.targetDate
  if (!target) return `⏰ ${countdown.title} 提醒`

  const remainingMs = target.getTime() - now.getTime()
  if (zone.zone === 'overdue') {
    const overdueDays = Math.floor(-remainingMs / (24 * 60 * 60 * 1000))
    return `‼️ ${countdown.title} 已超期 ${overdueDays} 天，请尽快处理`
  }
  if (zone.zone === 'deadline') {
    return `🔴 ${countdown.title} 截止时刻已到！`
  }
  if (zone.zone === 'last1hour') {
    const minutes = Math.max(1, Math.floor(remainingMs / (60 * 1000)))
    return `🔴 ${countdown.title} 仅剩 ${minutes} 分钟`
  }
  if (zone.zone === 'last24hours') {
    const hours = Math.max(1, Math.floor(remainingMs / (60 * 60 * 1000)))
    return `⚠️ ${countdown.title} 仅剩 ${hours} 小时`
  }
  if (zone.zone === '1to7days') {
    const days = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
    return `⚠️ ${countdown.title} 还剩 ${days} 天`
  }
  const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
  return `⏰ ${countdown.title} 还有 ${days} 天`
}

// ============ 进度与里程碑 ============

/**
 * 根据剩余时间自动计算进度（0-100）
 * - 仅当 progress 字段未手动维护时使用
 * - 起点为 createdDate，终点为 targetDate
 */
export function computeProgressByTime(
  createdDate: Date,
  targetDate: Date | null,
  now: Date = new Date(),
): number {
  if (!targetDate) return 0
  const total = targetDate.getTime() - createdDate.getTime()
  if (total <= 0) return 100
  const used = now.getTime() - createdDate.getTime()
  if (used <= 0) return 0
  if (used >= total) return 100
  return Math.floor((used / total) * 100)
}

/**
 * 更新里程碑 reached 状态
 * - 自动标记已达到的里程碑（percentage <= progress）
 * - 返回是否发生变化（用于判断是否需要审计）
 */
export function syncMilestones(
  milestones: Milestone[] | null,
  progress: number,
): { milestones: Milestone[] | null; changed: boolean } {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return { milestones, changed: false }
  }
  let changed = false
  const updated = milestones.map((m) => {
    const shouldReached = m.percentage <= progress
    if (m.reached !== shouldReached) changed = true
    return { ...m, reached: shouldReached }
  })
  return { milestones: updated, changed }
}

// ============ 调度器 ============

/** 调度器状态：避免重复启动 */
let schedulerHandle: ReturnType<typeof setInterval> | null = null

/**
 * 启动倒计时扫描调度器
 *
 * 设计要点：
 * - 每分钟扫描所有 active 状态的倒计时
 * - 按递减规则判断是否需要生成提醒
 * - 自动检测目标日期到达 → status=completed
 * - 自动推进循环倒计时的 nextTrigger
 * - 不引入 node-cron，使用 setInterval（与 rateLimit 风格一致）
 *
 * @param intervalMs 扫描间隔（默认 60_000，即每分钟）
 */
export function startCountdownScheduler(intervalMs: number = 60_000): void {
  if (schedulerHandle) return
  // 立即跑一次，便于启动时立即检测
  runCountdownScan().catch((err) => {
    console.error('[CountdownScheduler] 启动扫描失败:', err)
  })
  schedulerHandle = setInterval(() => {
    runCountdownScan().catch((err) => {
      console.error('[CountdownScheduler] 扫描失败:', err)
    })
  }, intervalMs)
  // 不阻塞进程退出
  schedulerHandle.unref?.()
  console.log(`[CountdownScheduler] 已启动，间隔 ${Math.floor(intervalMs / 1000)}s`)
}

/** 停止调度器（仅测试用） */
export function stopCountdownScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle)
    schedulerHandle = null
  }
}

/**
 * 单次扫描：扫描所有 active 倒计时
 *
 * 1. 检测 targetDate 已到达 → 标记 completed，触发庆祝
 * 2. 递减式提醒：根据剩余时间判断是否生成提醒
 * 3. 循环倒计时：nextTrigger 到达后推进到下一周期
 */
export async function runCountdownScan(now: Date = new Date()): Promise<void> {
  const actives = await prisma.countdown.findMany({
    where: { status: 'active' },
    take: 500, // 单次扫描上限，避免大用户量下耗时过长
  })

  for (const c of actives) {
    try {
      await scanSingle(c, now)
    } catch (err) {
      console.error(`[CountdownScheduler] 扫描 ${c.id} 失败:`, (err as Error).message)
    }
  }
}

/** 单个倒计时扫描逻辑 */
async function scanSingle(c: CountdownRow, now: Date): Promise<void> {
  // 1. 循环倒计时推进 nextTrigger
  if (c.type === 'recurring' && c.recurringConfig) {
    const cfg = parseJsonField<RecurringConfig>(c.recurringConfig, {} as RecurringConfig)
    if (cfg.nextTrigger) {
      const next = new Date(cfg.nextTrigger)
      if (next.getTime() <= now.getTime()) {
        // 触发点已过：推进到下一周期
        const newTrigger = computeNextTrigger(cfg.pattern, now, cfg.customRule, cfg.triggerTime)
        await prisma.countdown.update({
          where: { id: c.id },
          data: {
            recurringConfig: JSON.stringify({ ...cfg, nextTrigger: newTrigger.toISOString() }),
            lastNotified: now,
          },
        })
        // 推送一次触发提醒
        await createReminder(
          c,
          { zone: 'deadline', level: 'appropriate', intervalMin: 0, hint: '循环触发' },
          now,
        )
        return
      }
    }
  }

  // 2. 单次/重要日/目标型：检测 targetDate 到达
  if (c.targetDate && (c.type === 'single' || c.type === 'important' || c.type === 'goal')) {
    const remainingMs = c.targetDate.getTime() - now.getTime()
    // 已超过目标日期 1 分钟：自动完成
    if (remainingMs <= -60 * 1000) {
      await markAsCompleted(c, now)
      return
    }
  }

  // 3. 递减式提醒
  const reminderConfig = parseJsonField<ReminderConfig | null>(c.reminderConfig, null)
  if (reminderConfig && reminderConfig.enabled) {
    await maybeNotify(c, reminderConfig, now)
  }
}

/** 根据递减规则判断是否需要发送提醒 */
async function maybeNotify(c: CountdownRow, cfg: ReminderConfig, now: Date): Promise<void> {
  if (!c.targetDate) return
  const remainingMs = c.targetDate.getTime() - now.getTime()
  const zone = pickDecreasingZone(remainingMs)

  // 自定义提醒：按 daysBefore 触发
  if (cfg.rule === 'custom' && Array.isArray(cfg.customReminders)) {
    for (const cr of cfg.customReminders) {
      const triggerAt = new Date(c.targetDate.getTime() - cr.daysBefore * 24 * 60 * 60 * 1000)
      // 触发点已到（前后 60 秒内）且未发过
      if (Math.abs(triggerAt.getTime() - now.getTime()) < 60 * 1000) {
        await createReminder(
          c,
          { zone: 'deadline', level: cr.level, intervalMin: 0, hint: '自定义提醒' },
          now,
        )
      }
    }
    return
  }

  // 递减规则：检查是否在 intervalMin 内已通知
  if (cfg.rule === 'decreasing' || !cfg.rule) {
    const lastNotified = c.lastNotified ? c.lastNotified.getTime() : 0
    const elapsedMin = (now.getTime() - lastNotified) / (60 * 1000)
    // 提醒强度调整间隔倍率：light=×2(更少通知) / normal=×1 / strong=×0.5(更多通知)
    const intensityMultiplier = cfg.intensity === 'light' ? 2 : cfg.intensity === 'strong' ? 0.5 : 1
    const adjustedIntervalMin = Math.max(1, Math.floor(zone.intervalMin * intensityMultiplier))
    if (elapsedMin < adjustedIntervalMin) return

    await createReminder(c, zone, now)
  }
}

/** 创建提醒并更新 lastNotified */
async function createReminder(
  c: CountdownRow,
  zone: DecreasingZone,
  now: Date,
): Promise<void> {
  const content = buildReminderContent(
    { id: c.id, title: c.title, type: c.type, targetDate: c.targetDate },
    zone,
    now,
  )
  await prisma.countdownReminder.create({
    data: {
      countdownId: c.id,
      userId: c.userId,
      triggerAt: now,
      level: zone.level,
      content,
      isRead: false,
    },
  })
  await prisma.countdown.update({
    where: { id: c.id },
    data: { lastNotified: now },
  })
  // 审计：fire-and-forget
  audit({
    userId: c.userId,
    category: 'countdown',
    action: 'reminder_sent',
    targetType: 'Countdown',
    targetId: c.id,
    summary: `倒计时提醒: ${c.title} (${zone.hint})`,
    detail: { level: zone.level, zone: zone.zone, content },
  })
}

/** 标记倒计时为已完成 */
async function markAsCompleted(c: CountdownRow, now: Date): Promise<void> {
  const progress = 100
  const ms = parseJsonField<Milestone[] | null>(c.milestones, null)
  const milestones = syncMilestones(ms, progress).milestones
  // 完成快照：用于庆祝回顾
  const snapshot = {
    title: c.title,
    type: c.type,
    targetDate: c.targetDate?.toISOString() || null,
    createdDate: c.createdDate.toISOString(),
    completedAt: now.toISOString(),
    durationDays: c.targetDate
      ? Math.floor((now.getTime() - c.createdDate.getTime()) / (24 * 60 * 60 * 1000))
      : null,
    milestones,
  }
  await prisma.countdown.update({
    where: { id: c.id },
    data: {
      status: 'completed',
      progress,
      milestones: milestones ? JSON.stringify(milestones) : null,
      completedAt: now,
      completionSnapshot: JSON.stringify(snapshot),
    },
  })
  audit({
    userId: c.userId,
    category: 'countdown',
    action: 'auto_complete',
    targetType: 'Countdown',
    targetId: c.id,
    summary: `倒计时自动完成: ${c.title}`,
    detail: { snapshot },
  })
}

// ============ 跨模块联动 ============

/**
 * 关联愿望基金进度 → 自动更新倒计时 progress
 * - 当 wishFund 进度变更时调用，同步更新所有关联此 wishFund 的 active 倒计时
 * - 异常场景：进度 >= 100 时提前达成，自动触发 markAsCompleted（提前庆祝）
 */
export async function syncCountdownByWishFund(wishFundId: string, progress: number): Promise<void> {
  const countdowns = await prisma.countdown.findMany({
    where: { status: 'active', type: 'goal' },
  })
  for (const c of countdowns) {
    const linked = parseJsonField<LinkedModules | null>(c.linkedModules, null)
    if (linked?.wishFund !== wishFundId) continue
    const clamped = Math.min(100, Math.max(0, progress))
    // 提前达成（progress >= 100）：自动完成
    if (clamped >= 100) {
      await markAsCompleted(c as CountdownRow, new Date())
      continue
    }
    const ms = parseJsonField<Milestone[] | null>(c.milestones, null)
    const milestones = syncMilestones(ms, clamped).milestones
    await prisma.countdown.update({
      where: { id: c.id },
      data: { progress: clamped, milestones: milestones ? JSON.stringify(milestones) : null },
    })
  }
}

/**
 * 关联目标计划进度 → 自动更新倒计时 progress
 * - 异常场景：进度 >= 100 时提前达成，自动触发 markAsCompleted（提前庆祝）
 */
export async function syncCountdownByGoalPlan(goalPlanId: string, progress: number): Promise<void> {
  const countdowns = await prisma.countdown.findMany({
    where: { status: 'active', type: 'goal' },
  })
  for (const c of countdowns) {
    const linked = parseJsonField<LinkedModules | null>(c.linkedModules, null)
    if (linked?.goalPlan !== goalPlanId) continue
    const clamped = Math.min(100, Math.max(0, progress))
    // 提前达成（progress >= 100）：自动完成
    if (clamped >= 100) {
      await markAsCompleted(c as CountdownRow, new Date())
      continue
    }
    const ms = parseJsonField<Milestone[] | null>(c.milestones, null)
    const milestones = syncMilestones(ms, clamped).milestones
    await prisma.countdown.update({
      where: { id: c.id },
      data: { progress: clamped, milestones: milestones ? JSON.stringify(milestones) : null },
    })
  }
}

/**
 * 异常场景处理：检测超期倒计时并标记为已完成
 *
 * - 服务器时间作为倒计时基准，避免用户修改系统时间导致误判
 * - 超期 1 分钟以上的 single/important/goal 类型倒计时自动完成
 * - 循环型不适用（循环倒计时按 nextTrigger 推进，无超期概念）
 *
 * 由调度器（runCountdownScan）每分钟调用一次。
 */
export async function detectOverdueAndComplete(now: Date = new Date()): Promise<number> {
  const overdue = await prisma.countdown.findMany({
    where: {
      status: 'active',
      type: { in: ['single', 'important', 'goal'] },
      targetDate: { lt: new Date(now.getTime() - 60 * 1000) }, // 超期 1 分钟以上
    },
    take: 100,
  })
  for (const c of overdue) {
    await markAsCompleted(c as CountdownRow, now)
  }
  return overdue.length
}

// ============ 智能建议 ============

/** 智能建议项 */
export interface CountdownSuggestion {
  type: 'wish_fund' | 'task_deadline' | 'manual_event' | 'bill_day' | 'goal_plan'
  title: string
  suggestedTitle: string
  suggestedTargetDate?: string
  suggestedType: CountdownType
  reason: string
  /** 关联到现有数据的 ID（如 wishFund/task/manualEvent） */
  linkedId?: string
  linkedModules?: LinkedModules
}

/**
 * 根据用户数据生成倒计时建议
 * - 检测有截止日期但未关联倒计时的任务
 * - 检测未来手动事件
 * - 检测本月账单日（用于设置循环提醒）
 */
export async function generateCountdownSuggestions(userId: string): Promise<CountdownSuggestion[]> {
  const now = new Date()
  const future = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000) // 未来 90 天

  const [tasks, manualEvents, bills, existing] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        status: { not: 'done' },
        dueDate: { gte: now, lte: future },
      },
      take: 5,
      orderBy: { dueDate: 'asc' },
    }),
    prisma.manualEvent.findMany({
      where: {
        userId,
        startTime: { gte: now, lte: future },
      },
      take: 5,
      orderBy: { startTime: 'asc' },
    }),
    prisma.bill.findMany({
      where: { userId, billDate: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
      take: 20,
      orderBy: { billDate: 'desc' },
    }),
    prisma.countdown.findMany({
      where: { userId, status: { in: ['active', 'paused'] } },
      select: { linkedModules: true, title: true },
    }),
  ])

  const existingLinks = new Set<string>()
  for (const e of existing) {
    const linked = parseJsonField<LinkedModules>(e.linkedModules as string | null, {} as LinkedModules)
    if (linked.wishFund) existingLinks.add(`wish:${linked.wishFund}`)
    if (linked.goalPlan) existingLinks.add(`goal:${linked.goalPlan}`)
    if (linked.importantDay) existingLinks.add(`event:${linked.importantDay}`)
  }

  const suggestions: CountdownSuggestion[] = []

  // 1. 任务截止日期
  for (const t of tasks) {
    if (!t.dueDate) continue
    const taskKey = `task:${t.id}`
    if (existingLinks.has(taskKey)) continue
    suggestions.push({
      type: 'task_deadline',
      title: t.title,
      suggestedTitle: `任务截止: ${t.title}`,
      suggestedTargetDate: t.dueDate.toISOString(),
      suggestedType: 'single',
      reason: '该任务有截止日期但未关联倒计时',
      linkedId: t.id,
    })
  }

  // 2. 未来手动事件
  for (const m of manualEvents) {
    const eventKey = `event:${m.id}`
    if (existingLinks.has(eventKey)) continue
    suggestions.push({
      type: 'manual_event',
      title: m.title,
      suggestedTitle: `${m.title} 倒计时`,
      suggestedTargetDate: m.startTime.toISOString(),
      suggestedType: 'important',
      reason: '即将到来的重要事件',
      linkedId: m.id,
      linkedModules: { importantDay: m.id },
    })
  }

  // 3. 账单日（本月有支出 → 建议设置下月还款日循环）
  if (bills.length > 0) {
    const expenseTotal = bills.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0)
    if (expenseTotal > 100) {
      // 取下月 10 号作为默认还款日
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 10, 9, 0, 0, 0)
      suggestions.push({
        type: 'bill_day',
        title: '月度还款日',
        suggestedTitle: '每月还款日提醒',
        suggestedTargetDate: next.toISOString(),
        suggestedType: 'recurring',
        reason: `本月支出 ¥${expenseTotal.toFixed(2)}，建议设置还款日循环提醒`,
      })
    }
  }

  // 最多返回 5 条
  return suggestions.slice(0, 5)
}

// ============ 工具函数 ============

/** 计算剩余天数（向上取整，可为负数表示超期） */
export function calcRemainingDays(targetDate: Date | null, now: Date = new Date()): number | null {
  if (!targetDate) return null
  const diff = targetDate.getTime() - now.getTime()
  return Math.ceil(diff / (24 * 60 * 60 * 1000))
}

/** 计算剩余小时数 */
export function calcRemainingHours(targetDate: Date | null, now: Date = new Date()): number | null {
  if (!targetDate) return null
  const diff = targetDate.getTime() - now.getTime()
  return Math.floor(diff / (60 * 60 * 1000))
}
