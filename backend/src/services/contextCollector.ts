/**
 * 上下文自动收集器（ContextCollector）
 *
 * 核心能力：给定 userId，自动从所有业务模块并行收集用户当前状态数据，
 * 供 ContextAnalyzer 生成上下文感知的 AI 回复。
 *
 * 收集维度：
 * 1. 任务模块：今日待办、重要任务、近期待完成
 * 2. 财务模块：今日账单、本月收支、钱包余额
 * 3. 健康模块：今日饮食、热量摄入、昨晚睡眠
 * 4. 碎片模块：今日碎片、近期碎片
 * 5. 提醒模块：今日待提醒
 * 6. 倒计时模块：活跃倒计时
 * 7. 事件模块：今日事件、时间冲突
 * 8. 对话历史：最近 10 条消息
 * 9. 用户画像：等级、语气偏好
 * 10. 交接模块：草稿/待跟进
 *
 * 性能：所有查询并行执行，单次收集 < 100ms（SQLite 本地）
 */

import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { getHabitSummary, getUserHabits } from './habitService.js'
import { searchVaultNotes, formatVaultBlock } from './vaultService.js'

// ============ 类型定义 ============

export interface UserContext {
  /** 收集时间戳 */
  collectedAt: string
  /** 当前小时（0-23），用于时段判断 */
  hour: number
  /** 今日日期 ISO */
  today: string

  // --- 用户资料库（AI 记忆）---
  vault: {
    /** 按当前消息检索到的相关笔记（格式化后的注入文本，null 表示无） */
    block: string | null
  }

  // --- 用户画像 ---
  profile: {
    userId: string
    nickname: string | null
    preferredTone: string | null
    primaryGoal: string | null
    totalOnlineMinutes: number
    verifyLevel: string
  }

  // --- 任务模块 ---
  tasks: {
    todayPending: Array<{
      id: string
      title: string
      priority: string
      important: boolean
      dueDate: string | null
      category: string | null
    }>
    todayPendingCount: number
    totalPendingCount: number
    todayDoneCount: number
    importantPending: Array<{
      id: string
      title: string
      priority: string
      dueDate: string | null
    }>
    upcomingDeadlines: Array<{
      id: string
      title: string
      dueDate: string
      daysLeft: number
    }>
  }

  // --- 财务模块 ---
  finance: {
    todayExpense: number
    todayIncome: number
    monthExpense: number
    monthIncome: number
    walletBalance: number | null
    walletFrozen: boolean
    recentBills: Array<{
      id: string
      title: string
      amount: number
      type: string
      category: string
      billDate: string
    }>
  }

  // --- 健康模块 ---
  health: {
    todayMeals: number
    totalCalories: number
    meals: Array<{ mealType: string; foodName: string; calories: number | null }>
    lastSleep: {
      durationMin: number
      quality: number | null
      sleepDate: string
    } | null
    sleepHint: string | null
  }

  // --- 碎片模块 ---
  fragments: {
    todayCount: number
    todayItems: Array<{
      id: string
      content: string
      kind: string
      tags: string[]
      createdAt: string
    }>
    recentCount: number
    undigestedCount: number
  }

  // --- 提醒模块 ---
  reminders: {
    todayCount: number
    items: Array<{
      id: string
      title: string
      remindAt: string
      level: string
    }>
  }

  // --- 倒计时模块 ---
  countdowns: {
    activeCount: number
    items: Array<{
      id: string
      type: string
      title: string
      targetDate: string | null
      daysLeft: number | null
      isImportant: boolean
      isPinned: boolean
    }>
  }

  // --- 事件模块 ---
  events: {
    todayCount: number
    conflicts: number
    nextEvent: { title: string; time: string } | null
  }

  // --- 交接模块 ---
  handover: {
    draftCount: number
    pendingItemCount: number
  }

  // --- 对话历史 ---
  chatHistory: Array<{
    role: string
    content: string
    messageType: string
    createdAt: string
  }>

  // --- 用户习惯档案 ---
  habits: {
    summary: string
    count: number
    items: Array<{
      category: string
      content: string
      hitCount: number
    }>
  }

  // --- 综合状态评分 ---
  statusScore: {
    /** 任务压力 0-100（越高越紧张） */
    taskPressure: number
    /** 财务健康 0-100（越高越好） */
    financialHealth: number
    /** 生活规律 0-100（越高越规律） */
    lifestyleRegularity: number
    /** 整体精力 0-100（越高越好） */
    overallEnergy: number
  }

  // --- 智能摘要（自然语言） ---
  summary: string
}

// ============ 收集器 ============

/**
 * 自动收集用户全模块上下文
 *
 * @param userId 用户 ID
 * @param sessionId 可选，传入时收集该会话最近消息
 * @returns 结构化上下文对象
 */
export async function collectUserContext(
  userId: string,
  sessionId?: string,
  message?: string,
): Promise<UserContext> {
  const now = new Date()
  const hour = now.getHours()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000)

  // 并行查询所有模块
  const [
    user,
    todayTasks,
    totalPendingCount,
    todayDoneCount,
    importantPending,
    upcomingDeadlines,
    todayBills,
    monthBills,
    wallet,
    todayDiets,
    lastSleep,
    todayFragments,
    recentFragments,
    undigestedFragments,
    todayReminders,
    activeCountdowns,
    todayManualEvents,
    hiddenAutoEvents,
    draftHandovers,
    activeHandovers,
    chatHistory,
  ] = await Promise.all([
    // 用户画像
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nickname: true,
        preferredTone: true,
        primaryGoal: true,
        totalOnlineMinutes: true,
        verifyLevel: true,
      },
    }),
    // 今日待办
    prisma.task.findMany({
      where: {
        userId,
        status: { not: 'done' },
        OR: [
          { dueDate: { gte: today, lt: tomorrow } },
          { dueDate: null, important: true },
        ],
      },
      orderBy: [{ important: 'desc' }, { priority: 'desc' }],
      take: 10,
      select: {
        id: true, title: true, priority: true, important: true,
        dueDate: true, category: true,
      },
    }),
    // 总待办数
    prisma.task.count({
      where: { userId, status: { not: 'done' } },
    }),
    // 今日已完成数
    prisma.task.count({
      where: {
        userId, status: 'done',
        updatedAt: { gte: today, lt: tomorrow },
      },
    }),
    // 重要未完成
    prisma.task.findMany({
      where: {
        userId, status: { not: 'done' }, important: true,
      },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
      take: 5,
      select: { id: true, title: true, priority: true, dueDate: true },
    }),
    // 近期截止任务（未来 7 天）
    prisma.task.findMany({
      where: {
        userId, status: { not: 'done' },
        dueDate: { gte: now, lte: new Date(now.getTime() + 7 * 86400000) },
      },
      orderBy: { dueDate: 'asc' },
      take: 5,
      select: { id: true, title: true, dueDate: true },
    }),
    // 今日账单
    prisma.bill.findMany({
      where: { userId, billDate: { gte: today, lt: tomorrow } },
      orderBy: { billDate: 'desc' },
      take: 10,
      select: { id: true, title: true, amount: true, type: true, category: true, billDate: true },
    }),
    // 本月账单
    prisma.bill.findMany({
      where: { userId, billDate: { gte: monthStart } },
      select: { type: true, amount: true },
    }),
    // 钱包
    prisma.wallet.findUnique({ where: { userId } }),
    // 今日饮食
    prisma.diet.findMany({
      where: { userId, eatenAt: { gte: today, lt: tomorrow } },
      orderBy: { eatenAt: 'desc' },
      select: { mealType: true, foodName: true, calories: true },
    }),
    // 昨晚睡眠
    prisma.sleep.findFirst({
      where: { userId, sleepDate: { gte: yesterday, lt: today } },
      orderBy: { sleepDate: 'desc' },
    }),
    // 今日碎片
    // P2-1 修复：迁移到 $queryRaw tagged template（Prisma 自动参数化，防 SQL 注入）
    prisma.$queryRaw<Array<{ id: string; content: string; kind: string; tags: string | null; createdAt: string }>>(
      Prisma.sql`SELECT id, content, kind, tags, createdAt FROM fragments WHERE userId = ${userId} AND date(createdAt) = date(${today.toISOString().slice(0, 10)}) ORDER BY createdAt DESC LIMIT 20`
    ),
    // 近 7 天碎片数
    prisma.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT COUNT(*) as count FROM fragments WHERE userId = ${userId} AND date(createdAt) >= date(${sevenDaysAgo.toISOString().slice(0, 10)})`
    ),
    // 未整合碎片数
    prisma.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT COUNT(*) as count FROM fragments WHERE userId = ${userId} AND digested = 0 AND date(createdAt) = date(${today.toISOString().slice(0, 10)})`
    ),
    // 今日提醒
    prisma.reminder.findMany({
      where: {
        userId, done: false,
        remindAt: { gte: today, lt: tomorrow },
      },
      orderBy: { remindAt: 'asc' },
      select: { id: true, title: true, remindAt: true, level: true },
    }),
    // 活跃倒计时
    prisma.countdown.findMany({
      where: { userId, status: 'active' },
      orderBy: [{ isImportant: 'desc' }, { isPinned: 'desc' }, { targetDate: 'asc' }],
      take: 5,
      select: { id: true, type: true, title: true, targetDate: true, isImportant: true, isPinned: true },
    }),
    // 今日手动事件
    prisma.manualEvent.findMany({
      where: { userId, hidden: false, startTime: { gte: today, lt: tomorrow } },
      orderBy: { startTime: 'asc' },
      select: { id: true, title: true, startTime: true },
    }),
    // 已隐藏事件
    prisma.hiddenEvent.findMany({
      where: { userId },
      select: { sourceType: true, sourceId: true },
    }),
    // 草稿交接单
    prisma.handover.findMany({
      where: { userId, status: 'draft' },
      select: { id: true, pendingItems: true },
    }),
    // 待跟进交接单
    prisma.handover.findMany({
      where: { userId, status: { in: ['draft', 'submitted'] } },
      select: { pendingItems: true },
    }),
    // 对话历史（最近 10 条）
    sessionId
      ? prisma.message.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { role: true, content: true, messageType: true, createdAt: true },
        })
      : Promise.resolve([]),
  ])

  // ============ 聚合计算 ============

  // 今日账单
  const todayExpense = todayBills
    .filter((b) => b.type === 'expense')
    .reduce((s, b) => s + b.amount, 0)
  const todayIncome = todayBills
    .filter((b) => b.type === 'income')
    .reduce((s, b) => s + b.amount, 0)

  // 本月收支
  const monthExpense = monthBills
    .filter((b) => b.type === 'expense')
    .reduce((s, b) => s + b.amount, 0)
  const monthIncome = monthBills
    .filter((b) => b.type === 'income')
    .reduce((s, b) => s + b.amount, 0)

  // 饮食
  const totalCalories = todayDiets.reduce((s, d) => s + (d.calories || 0), 0)

  // 睡眠提示
  let sleepHint: string | null = null
  if (lastSleep) {
    if (lastSleep.durationMin < 360) sleepHint = '睡眠不足，注意休息'
    else if (lastSleep.durationMin > 540) sleepHint = '睡眠偏多，注意规律'
    else sleepHint = '睡眠时长合理'
  }

  // 碎片解析
  const todayFragmentItems = todayFragments.map((r) => {
    let tags: string[] = []
    try { tags = JSON.parse(r.tags || '[]') } catch { /* ignore */ }
    return { id: r.id, content: r.content, kind: r.kind, tags, createdAt: r.createdAt }
  })
  const recentFragmentCount = recentFragments[0]?.count || 0
  const undigestedCount = undigestedFragments[0]?.count || 0

  // 倒计时计算
  const countdownItems = activeCountdowns.map((c) => {
    const target = c.targetDate ? new Date(c.targetDate) : null
    const daysLeft = target ? Math.ceil((target.getTime() - now.getTime()) / 86400000) : null
    return {
      id: c.id, type: c.type, title: c.title,
      targetDate: target ? target.toISOString() : null,
      daysLeft, isImportant: c.isImportant, isPinned: c.isPinned,
    }
  })

  // 事件聚合
  const hiddenKeySet = new Set(hiddenAutoEvents.map((h) => `${h.sourceType}/${h.sourceId}`))
  const todayEvents: Array<{ id: string; title: string; time: Date }> = []
  todayTasks.forEach((t) => {
    if (t.dueDate && !hiddenKeySet.has(`task/${t.id}`)) {
      todayEvents.push({ id: t.id, title: t.title, time: t.dueDate })
    }
  })
  todayReminders.forEach((r) => {
    if (!hiddenKeySet.has(`reminder/${r.id}`)) {
      todayEvents.push({ id: r.id, title: r.title, time: r.remindAt })
    }
  })
  todayManualEvents.forEach((m) => {
    todayEvents.push({ id: m.id, title: m.title, time: m.startTime })
  })
  todayEvents.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  // 事件冲突检测
  let conflicts = 0
  for (let i = 0; i < todayEvents.length - 1; i++) {
    const gap = (new Date(todayEvents[i + 1].time).getTime() - new Date(todayEvents[i].time).getTime()) / 60000
    if (gap >= 0 && gap < 15) conflicts++
  }

  // 下一个事件
  const upcomingEvents = todayEvents.filter((e) => new Date(e.time).getTime() > now.getTime())
  const nextEvent = upcomingEvents.length > 0
    ? { title: upcomingEvents[0].title, time: upcomingEvents[0].time instanceof Date ? upcomingEvents[0].time.toISOString() : String(upcomingEvents[0].time) }
    : null

  // 交接待跟进数
  const pendingItemCount = activeHandovers.reduce((sum, h) => {
    try {
      const arr = JSON.parse(h.pendingItems || '[]')
      return sum + (Array.isArray(arr) ? arr.length : 0)
    } catch { return sum }
  }, 0)

  // ============ 状态评分 ============

  const taskPressure = Math.min(100, totalPendingCount * 8 + todayTasks.filter(t => t.important).length * 10)
  const financialHealth = monthIncome > 0
    ? Math.max(0, Math.min(100, Math.round(((monthIncome - monthExpense) / monthIncome) * 100)))
    : monthExpense > 0 ? 30 : 70
  const lifestyleRegularity = Math.min(100,
    (todayDiets.length > 0 ? 25 : 0) +
    (lastSleep ? 25 : 0) +
    (todayDoneCount > 0 ? 25 : 0) +
    (todayFragmentItems.length > 0 ? 25 : 0)
  )
  const overallEnergy = Math.max(20, Math.min(100,
    Math.round((100 - taskPressure * 0.3) * 0.4 + financialHealth * 0.2 + lifestyleRegularity * 0.4)
  ))

  // ============ 智能摘要 ============

  const summaryParts: string[] = []
  // 时段感知
  const period = hour < 6 ? '深夜' : hour < 11 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜'
  summaryParts.push(`当前${period}`)
  // 任务状态
  if (todayTasks.length > 0) {
    summaryParts.push(`今日待办 ${todayTasks.length} 项`)
    if (todayTasks.filter(t => t.important).length > 0) {
      summaryParts.push(`其中 ${todayTasks.filter(t => t.important).length} 项重要`)
    }
  } else {
    summaryParts.push('今日无待办')
  }
  if (todayDoneCount > 0) summaryParts.push(`已完成 ${todayDoneCount} 项`)
  // 财务
  if (todayExpense > 0) summaryParts.push(`今日消费 ¥${todayExpense.toFixed(0)}`)
  if (monthExpense > monthIncome && monthIncome > 0) summaryParts.push('本月支出超收入')
  // 健康
  if (todayDiets.length === 0 && hour >= 12) summaryParts.push('今日未记录饮食')
  if (sleepHint) summaryParts.push(sleepHint)
  // 碎片
  if (todayFragmentItems.length > 0) summaryParts.push(`今日碎片 ${todayFragmentItems.length} 条`)
  // 倒计时
  const urgentCountdowns = countdownItems.filter(c => c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= 3)
  if (urgentCountdowns.length > 0) summaryParts.push(`${urgentCountdowns.length} 个倒计时临近`)
  // 冲突
  if (conflicts > 0) summaryParts.push(`${conflicts} 个事件时间冲突`)

  const summary = summaryParts.join('，') + '。'

  // 习惯档案
  const habitSummary = await getHabitSummary(userId)
  const habitGrouped = await getUserHabits(userId)
  const habitItems: Array<{ category: string; content: string; hitCount: number }> = []
  for (const [category, items] of Object.entries(habitGrouped)) {
    for (const item of items.slice(0, 3)) {
      habitItems.push({ category, content: item.content, hitCount: item.hitCount })
    }
  }

  // 用户资料库检索（AI 记忆注入）：按当前消息关键词取相关笔记，失败不影响主链路
  let vaultBlock: string | null = null
  try {
    const vaultNotes = await searchVaultNotes(userId, message || '', 8)
    vaultBlock = formatVaultBlock(vaultNotes)
  } catch (err) {
    console.error('[ContextCollector] Vault search failed:', err instanceof Error ? err.message : err)
  }

  return {
    collectedAt: now.toISOString(),
    hour,
    today: today.toISOString().slice(0, 10),

    vault: {
      block: vaultBlock,
    },

    profile: {
      userId,
      nickname: user?.nickname || null,
      preferredTone: user?.preferredTone || 'gentle',
      primaryGoal: user?.primaryGoal || null,
      totalOnlineMinutes: user?.totalOnlineMinutes || 0,
      verifyLevel: user?.verifyLevel || 'Lv0',
    },

    tasks: {
      todayPending: todayTasks.map(t => ({
        id: t.id, title: t.title, priority: t.priority,
        important: t.important, dueDate: t.dueDate?.toISOString() || null,
        category: t.category,
      })),
      todayPendingCount: todayTasks.length,
      totalPendingCount,
      todayDoneCount,
      importantPending: importantPending.map(t => ({
        id: t.id, title: t.title, priority: t.priority,
        dueDate: t.dueDate?.toISOString() || null,
      })),
      upcomingDeadlines: upcomingDeadlines.map(t => ({
        id: t.id, title: t.title,
        dueDate: t.dueDate!.toISOString(),
        daysLeft: Math.ceil((new Date(t.dueDate!).getTime() - now.getTime()) / 86400000),
      })),
    },

    finance: {
      todayExpense: Number(todayExpense.toFixed(2)),
      todayIncome: Number(todayIncome.toFixed(2)),
      monthExpense: Number(monthExpense.toFixed(2)),
      monthIncome: Number(monthIncome.toFixed(2)),
      walletBalance: wallet?.balance || null,
      walletFrozen: wallet?.frozen || false,
      recentBills: todayBills.map(b => ({
        id: b.id, title: b.title, amount: b.amount, type: b.type,
        category: b.category, billDate: b.billDate.toISOString(),
      })),
    },

    health: {
      todayMeals: todayDiets.length,
      totalCalories,
      meals: todayDiets.map(d => ({
        mealType: d.mealType, foodName: d.foodName, calories: d.calories,
      })),
      lastSleep: lastSleep
        ? {
            durationMin: lastSleep.durationMin,
            quality: lastSleep.quality,
            sleepDate: lastSleep.sleepDate.toISOString(),
          }
        : null,
      sleepHint,
    },

    fragments: {
      todayCount: todayFragmentItems.length,
      todayItems: todayFragmentItems,
      recentCount: recentFragmentCount,
      undigestedCount,
    },

    reminders: {
      todayCount: todayReminders.length,
      items: todayReminders.map(r => ({
        id: r.id, title: r.title,
        remindAt: r.remindAt.toISOString(), level: r.level,
      })),
    },

    countdowns: {
      activeCount: activeCountdowns.length,
      items: countdownItems,
    },

    events: {
      todayCount: todayEvents.length,
      conflicts,
      nextEvent,
    },

    handover: {
      draftCount: draftHandovers.length,
      pendingItemCount,
    },

    chatHistory: chatHistory.reverse().map(m => ({
      role: m.role, content: m.content, messageType: m.messageType,
      createdAt: m.createdAt.toISOString(),
    })),

    habits: {
      summary: habitSummary,
      count: habitItems.length,
      items: habitItems,
    },

    statusScore: {
      taskPressure,
      financialHealth,
      lifestyleRegularity,
      overallEnergy,
    },

    summary,
  }
}
