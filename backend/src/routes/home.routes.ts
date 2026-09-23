import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { success, fail } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'

/**
 * DG-05 每日一问生成器
 *
 * 基于当日数据状态，生成一个启发式问题，引导用户反思或行动。
 * 优先级：睡眠异常 > 财务压力 > 任务积压 > 饮食异常 > 默认励志
 *
 * 返回 { question, hint, action }：
 * - question：展示给用户的启发性问题
 * - hint：简短说明为何问这个
 * - action：点击后跳转对话页时自动发送的文本
 */
function generateDailyQuestion(data: {
  pendingTaskCount: number
  todayMeals: number
  totalCalories: number
  sleepDurationMin: number | null
  monthExpense: number
  monthIncome: number
}): { question: string; hint: string; action: string } {
  const { pendingTaskCount, todayMeals, totalCalories, sleepDurationMin, monthExpense, monthIncome } = data

  // 1. 睡眠异常
  if (sleepDurationMin !== null && sleepDurationMin < 360) {
    return {
      question: '昨晚睡眠不足 6 小时，今天哪件事最需要清醒的头脑？',
      hint: '睡眠不足时，优先安排重要决策事项',
      action: '我今天哪件事最重要，需要精力充沛地完成？',
    }
  }

  // 2. 财务压力（本月支出 > 收入）
  if (monthIncome > 0 && monthExpense > monthIncome) {
    return {
      question: '本月支出已超过收入，有哪些可以削减的非必要开支？',
      hint: '审视消费，找出可优化的支出项',
      action: '帮我分析本月支出，找出可削减的非必要开支',
    }
  }

  // 3. 任务积压
  if (pendingTaskCount >= 5) {
    return {
      question: `你还有 ${pendingTaskCount} 个待办任务，今天最重要的 3 件是什么？`,
      hint: '聚焦关键任务，避免被琐事淹没',
      action: '帮我列出今天最重要的 3 件任务',
    }
  }

  // 4. 饮食异常（未记录或热量过低）
  const hour = new Date().getHours()
  if (hour >= 12 && todayMeals === 0) {
    return {
      question: '已经中午了，今天还没记录饮食，最近的一餐吃了什么？',
      hint: '及时记录饮食，便于营养分析',
      action: '我刚吃了午餐',
    }
  }
  if (todayMeals > 0 && totalCalories < 300 && hour >= 18) {
    return {
      question: '今天摄入热量偏低，晚餐打算吃点什么补充能量？',
      hint: '合理摄入，避免能量不足影响状态',
      action: '我打算吃晚餐',
    }
  }

  // 5. 默认：励志启发
  const defaultQuestions = [
    { question: '今天最想完成的一件事是什么？', hint: '聚焦核心目标，让今天更有意义', action: '我今天最想完成什么事' },
    { question: '有什么一直想做的事，今天可以开始第一步？', hint: '万事开头难，迈出第一步最重要', action: '帮我规划今天下午的时间' },
    { question: '今天有什么值得感恩的小事？', hint: '记录感恩，提升幸福感', action: '帮我记录一件感恩的事' },
  ]
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)
  return defaultQuestions[dayOfYear % defaultQuestions.length]
}

/**
 * 主页路由
 *
 * 鉴权：所有接口需要登录
 *
 * 路由清单：
 * - GET /home/today  今日全景聚合接口
 * 聚合内容：
 * 1. 问候语 + 精力评分 + AI 提示
 * 2. 倒计时（最近 3 个未完成且有截止日期的任务）
 * 3. 今日待办（最多 5 条）
 * 4. 财务速览（本月支出 / 收入 / 钱包余额）
 * 5. 健康摘要（今日餐数 / 总热量 / 建议）
 * 6. 事件总汇（今日待办 + 今日提醒按时间排序）
 * 7. 交接提示（最近 1 条草稿交接单 + 待跟进事项总数）
 */
const router = Router()
router.use(authRequired)

// 今日全景：聚合倒计时/待办/财务速览/健康摘要/事件总汇
router.get('/today', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const now = new Date()
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

    // 性能优化：16 个独立查询并行执行（原串行约 16 次 RTT，现 1 次）
    const [
      todayTasks,
      pendingTaskCount,
      todayDiets,
      bills,
      wallet,
      todayReminders,
      countdowns,
      draftHandover,
      activeHandovers,
      lastSleep,
      tomorrowTasks,
      upcomingEvent,
      todayDoneCount,
      todayTotalCount,
      dietDates,
      sleepDates,
      taskDoneDates,
      // EV-06 当日手动事件（hidden=false 的）
      manualEvents,
      // EV-06 用户已隐藏的自动事件记录（用于在 events 聚合时过滤）
      hiddenAutoEvents,
      // 倒计时：用户主动创建的 active 倒计时（与 task-based countdowns 分离）
      activeCountdowns,
    ] = await Promise.all([
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
        take: 5,
      }),
      // 最近所有未完成任务数
      prisma.task.count({
        where: { userId, status: { not: 'done' } },
      }),
      // 今日饮食
      prisma.diet.findMany({
        where: { userId, eatenAt: { gte: today, lt: tomorrow } },
      }),
      // 本月账单
      prisma.bill.findMany({
        where: { userId, billDate: { gte: monthStart } },
      }),
      // 钱包
      prisma.wallet.findUnique({ where: { userId } }),
      // 所有未完成提醒（含过期 + 今日 + 未来，按时间升序）
      prisma.reminder.findMany({
        where: {
          userId,
          done: false,
        },
        orderBy: { remindAt: 'asc' },
        take: 20,
      }),
      // 倒计时（取最近的目标日期）
      prisma.task.findMany({
        where: {
          userId,
          dueDate: { gte: now },
          status: { not: 'done' },
        },
        orderBy: { dueDate: 'asc' },
        take: 3,
      }),
      // 交接提示：最近 1 条草稿
      prisma.handover.findFirst({
        where: { userId, status: 'draft' },
        orderBy: { updatedAt: 'desc' },
      }),
      // 交接提示：待跟进事项统计（draft + submitted）
      prisma.handover.findMany({
        where: { userId, status: { in: ['draft', 'submitted'] } },
        select: { pendingItems: true },
      }),
      // 昨晚睡眠（sleepDate 为昨天，供今日健康摘要展示）
      prisma.sleep.findFirst({
        where: { userId, sleepDate: { gte: yesterday, lt: today } },
        orderBy: { sleepDate: 'desc' },
      }),
      // DG-12 场景化问候：明日任务数（用于晚间/睡前预告）
      prisma.task.count({
        where: {
          userId,
          status: { not: 'done' },
          dueDate: { gte: tomorrow, lt: new Date(tomorrow.getTime() + 86400000) },
        },
      }),
      // DG-12 场景化问候：当前时间之后的下一个今日事件（任务/提醒）
      prisma.task.findFirst({
        where: {
          userId,
          status: { not: 'done' },
          dueDate: { gte: now, lt: tomorrow },
        },
        orderBy: { dueDate: 'asc' },
        select: { title: true },
      }),
      // DG-14 成就激励：今日已完成任务数（updatedAt 在今日 + status=done）
      prisma.task.count({
        where: {
          userId,
          status: 'done',
          updatedAt: { gte: today, lt: tomorrow },
        },
      }),
      // DG-14 成就激励：今日任务总数（已完成 + 待办，用于完成率）
      prisma.task.count({
        where: {
          userId,
          OR: [
            { status: 'done', updatedAt: { gte: today, lt: tomorrow } },
            { status: { not: 'done' }, OR: [{ dueDate: { gte: today, lt: tomorrow } }, { dueDate: null, important: true }] },
          ],
        },
      }),
      // DG-14 成就激励：近 14 天有饮食记录的日期（用于计算 streak）
      // P2-1 修复：迁移到 $queryRaw tagged template
      prisma.$queryRaw<{ d: string }[]>(
        Prisma.sql`SELECT DISTINCT date(eatenAt) as d FROM diets WHERE userId = ${userId} AND date(eatenAt) >= date(${today.toISOString().slice(0, 10)}, '-14 days') ORDER BY d DESC`
      ),
      // DG-14 成就激励：近 14 天有睡眠记录的日期
      prisma.$queryRaw<{ d: string }[]>(
        Prisma.sql`SELECT DISTINCT date(sleepDate) as d FROM sleeps WHERE userId = ${userId} AND date(sleepDate) >= date(${today.toISOString().slice(0, 10)}, '-14 days') ORDER BY d DESC`
      ),
      // DG-14 成就激励：近 14 天有任务完成的日期
      prisma.$queryRaw<{ d: string; cnt: number }[]>(
        Prisma.sql`SELECT date(updatedAt) as d, COUNT(*) as cnt FROM tasks WHERE userId = ${userId} AND status = 'done' AND date(updatedAt) >= date(${today.toISOString().slice(0, 10)}, '-14 days') GROUP BY date(updatedAt) ORDER BY d DESC`
      ),
      // EV-06 当日手动事件（hidden=false 的）
      prisma.manualEvent.findMany({
        where: {
          userId,
          hidden: false,
          startTime: { gte: today, lt: tomorrow },
        },
        orderBy: [{ startTime: 'asc' }, { createdAt: 'desc' }],
      }),
      // EV-06 用户已隐藏的自动事件记录（用于过滤自动采集的事件）
      prisma.hiddenEvent.findMany({
        where: { userId },
        select: { sourceType: true, sourceId: true },
      }),
      // 倒计时：用户主动创建的 active 倒计时（主页倒计时卡片用，取最近 3 条）
      // 排序优先级：isImportant desc, isPinned desc, targetDate asc
      prisma.countdown.findMany({
        where: { userId, status: 'active' },
        orderBy: [
          { isImportant: 'desc' },
          { isPinned: 'desc' },
          { targetDate: 'asc' },
        ],
        take: 3,
      }),
    ])

    // 同步聚合计算
    const totalCalories = todayDiets.reduce((s, d) => s + (d.calories || 0), 0)
    const monthExpense = bills
      .filter(b => b.type === 'expense')
      .reduce((s, b) => s + b.amount, 0)
    const monthIncome = bills
      .filter(b => b.type === 'income')
      .reduce((s, b) => s + b.amount, 0)

    // 事件总汇（今日所有时间敏感事项）
    // - type: task | reminder | bill | diet | manual（事件来源类型）
    // - scope: work | life | finance（情境视角分类，用于 EV-05 视角切换筛选）
    // - manual: 是否为手动添加事件（EV-06），手动事件可在前端显示不同图标/操作
    const events: Array<{
      id: string
      type: string
      title: string
      time: Date
      priority?: string
      important?: boolean
      level?: string
      scope: 'work' | 'life' | 'finance'
      manual?: boolean
      location?: string | null
      attendees?: string[]
      color?: string
    }> = []
    // EV-06 构造已隐藏自动事件的 Set，便于 O(1) 过滤
    // 键格式：`${sourceType}/${sourceId}`
    const hiddenKeySet = new Set<string>()
    hiddenAutoEvents.forEach(h => {
      hiddenKeySet.add(`${h.sourceType}/${h.sourceId}`)
    })
    todayTasks.forEach(t => {
      if (t.dueDate) {
        // EV-06 跳过被用户隐藏的自动事件
        if (hiddenKeySet.has(`task/${t.id}`)) return
        // 任务 category 映射到 scope：work → work, finance → finance, 其他默认 life
        const scope: 'work' | 'life' | 'finance' =
          t.category === 'work' ? 'work' : t.category === 'finance' ? 'finance' : 'life'
        events.push({
          id: t.id,
          type: 'task',
          title: t.title,
          time: t.dueDate,
          priority: t.priority,
          important: t.important,
          scope,
        })
      }
    })
    todayReminders.forEach(r => {
      // EV-06 跳过被用户隐藏的自动事件
      if (hiddenKeySet.has(`reminder/${r.id}`)) return
      // 提醒 relatedType 映射到 scope：task/bill 各自归入 work/finance，其他归入 life
      const scope: 'work' | 'life' | 'finance' =
        r.relatedType === 'task' ? 'work' : r.relatedType === 'bill' ? 'finance' : 'life'
      events.push({
        id: r.id,
        type: 'reminder',
        title: r.title,
        time: r.remindAt,
        level: r.level,
        scope,
      })
    })
    // EV-06 合并手动事件
    manualEvents.forEach(m => {
      let attendees: string[] = []
      try {
        const parsed = JSON.parse(m.attendees || '[]')
        if (Array.isArray(parsed)) attendees = parsed.filter((x) => typeof x === 'string')
      } catch {
        /* ignore */
      }
      const scope: 'work' | 'life' | 'finance' =
        m.scope === 'work' ? 'work' : m.scope === 'finance' ? 'finance' : 'life'
      events.push({
        id: m.id,
        type: 'manual',
        title: m.title,
        time: m.startTime,
        scope,
        manual: true,
        location: m.location,
        attendees,
        color: m.color || 'blue',
      })
    })
    events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

    // 事件冲突检测（EV-02）：相邻事件时间间隔 < 15 分钟视为冲突
    // 任务默认占用 60min，提醒瞬时；冲突时提示用户重排
    const CONFLICT_THRESHOLD_MIN = 15
    const conflicts: Array<{
      a: { id: string; type: string; title: string; time: string }
      b: { id: string; type: string; title: string; time: string }
      gapMin: number
      suggestion: string
    }> = []
    for (let i = 0; i < events.length - 1; i++) {
      const t1 = new Date(events[i].time).getTime()
      const t2 = new Date(events[i + 1].time).getTime()
      const gapMin = Math.round((t2 - t1) / 60000)
      if (gapMin >= 0 && gapMin < CONFLICT_THRESHOLD_MIN) {
        conflicts.push({
          a: { id: events[i].id, type: events[i].type, title: events[i].title, time: events[i].time instanceof Date ? events[i].time.toISOString() : String(events[i].time) },
          b: { id: events[i + 1].id, type: events[i + 1].type, title: events[i + 1].title, time: events[i + 1].time instanceof Date ? events[i + 1].time.toISOString() : String(events[i + 1].time) },
          gapMin,
          suggestion: gapMin < 5
            ? '时间几乎重叠，建议改期其中一个'
            : `仅间隔 ${gapMin} 分钟，建议预留缓冲`,
        })
      }
    }

    // 精力评分（简化：基于睡眠/任务量）
    const energyScore = Math.max(40, 95 - pendingTaskCount * 3)

    // 待跟进事项数量（来自 draft + submitted 状态，archived 不再计入待办）
    const pendingHandoverCount = activeHandovers.reduce((sum, h) => {
      try {
        const arr = JSON.parse(h.pendingItems || '[]')
        return sum + (Array.isArray(arr) ? arr.length : 0)
      } catch {
        return sum
      }
    }, 0)

    return success(res, {
      date: today.toISOString().slice(0, 10),
      greeting: getGreeting(today),
      // DG-12 场景化问候：按时段+当日数据生成个性化问候
      sceneGreeting: getSceneGreeting(today, {
        sleepDurationMin: lastSleep?.durationMin ?? null,
        sleepQuality: lastSleep?.quality ?? null,
        pendingTaskCount,
        todayTasksCount: todayTasks.length,
        importantTaskCount: todayTasks.filter(t => t.important).length,
        monthExpense: Number(monthExpense.toFixed(2)),
        monthIncome: Number(monthIncome.toFixed(2)),
        walletBalance: wallet?.balance || 0,
        todayMeals: todayDiets.length,
        totalCalories,
        conflictCount: conflicts.length,
        nextEventTitle: upcomingEvent?.title || null,
        tomorrowEventCount: tomorrowTasks,
      }),
      energy: energyScore,
      mood: '😊',
      todayTip: generateTip(todayTasks.length, totalCalories, monthExpense),
      countdowns: countdowns.map(t => ({
        id: t.id,
        title: t.title,
        targetDate: t.dueDate,
        days: Math.ceil((new Date(t.dueDate!).getTime() - today.getTime()) / 86400000),
        icon: t.category === 'work' ? '🎯' : '📱',
      })),
      // 倒计时卡片：用户主动创建的 active 倒计时（最多 3 条）
      activeCountdowns: activeCountdowns.map(c => {
        const target = c.targetDate ? new Date(c.targetDate) : null
        const days = target ? Math.ceil((target.getTime() - today.getTime()) / 86400000) : null
        const hours = target ? Math.floor((target.getTime() - now.getTime()) / (60 * 60 * 1000)) : null
        // 文案：剩余天数 / 已超期 / 已完成
        let label = ''
        let style: 'normal' | 'warning' | 'urgent' | 'overdue' | 'completed' = 'normal'
        if (c.status === 'completed') {
          label = '已完成'
          style = 'completed'
        } else if (target && days !== null && days < 0) {
          label = `已超期 ${-days} 天`
          style = 'overdue'
        } else if (target && hours !== null && hours < 24) {
          label = `仅剩 ${Math.max(1, hours)} 小时`
          style = 'urgent'
        } else if (days !== null && days <= 7) {
          label = `还剩 ${days} 天`
          style = 'warning'
        } else if (days !== null) {
          label = `还剩 ${days} 天`
        }
        return {
          id: c.id,
          type: c.type,
          title: c.title,
          targetDate: target ? target.toISOString() : null,
          days,
          hours,
          label,
          style,
          progress: c.progress,
          isPinned: c.isPinned,
          isImportant: c.isImportant,
          recurring: c.type === 'recurring',
          icon: c.type === 'recurring' ? '🔁' : c.type === 'important' ? '⭐' : c.type === 'goal' ? '🎯' : '⏰',
        }
      }),
      todayTasks: todayTasks.map(t => ({
        ...t,
        dueDate: t.dueDate?.toISOString(),
      })),
      pendingTaskCount,
      finance: {
        monthExpense: Number(monthExpense.toFixed(2)),
        monthIncome: Number(monthIncome.toFixed(2)),
        walletBalance: wallet?.balance || 0,
      },
      health: {
        todayMeals: todayDiets.length,
        totalCalories,
        suggestion: totalCalories < 800 ? '今日摄入偏低，建议补充' : '摄入合理',
        // 昨晚睡眠：阶段二「睡眠分析」基础版
        sleep: lastSleep
          ? {
              durationMin: lastSleep.durationMin,
              quality: lastSleep.quality,
              // 时长 < 6h 提示不足，> 9h 提示偏多
              hint:
                lastSleep.durationMin < 360
                  ? '睡眠不足，今晚早点休息'
                  : lastSleep.durationMin > 540
                    ? '睡眠偏多，注意规律作息'
                    : '睡眠时长合理',
            }
          : null,
      },
      events: events.map(e => ({
        ...e,
        time: e.time instanceof Date ? e.time.toISOString() : e.time,
      })),
      // 事件冲突（EV-02）：相邻事件间隔 < 15min 的冲突对
      conflicts,
      // DG-05 每日一问：基于当日数据生成启发式问题
      dailyQuestion: generateDailyQuestion({
        pendingTaskCount,
        todayMeals: todayDiets.length,
        totalCalories,
        sleepDurationMin: lastSleep?.durationMin ?? null,
        monthExpense: Number(monthExpense.toFixed(2)),
        monthIncome: Number(monthIncome.toFixed(2)),
      }),
      // DG-14 成就激励：今日进度 + 连续记录 + 成就徽章
      achievements: generateAchievements({
        todayDoneCount: todayDoneCount,
        todayTotalCount: todayTotalCount,
        dietStreak: calcStreak(dietDates.map(r => r.d)),
        sleepStreak: calcStreak(sleepDates.map(r => r.d)),
        sleepAllGood: lastSleep ? lastSleep.durationMin >= 360 && lastSleep.durationMin <= 540 : false,
        billMonthCount: bills.length,
        taskDoneStreak: calcStreak(taskDoneDates.map(r => r.d)),
      }),
      reminders: todayReminders,
      handover: {
        draft: draftHandover
          ? { id: draftHandover.id, title: draftHandover.title, updatedAt: draftHandover.updatedAt }
          : null,
        pendingItemCount: pendingHandoverCount,
      },
    })
  } catch (e) {
    next(e)
  }
})

/** 根据当前时间生成问候语（向后兼容：返回字符串） */
function getGreeting(d: Date): string {
  const h = d.getHours()
  if (h < 6) return '深夜好，注意休息'
  if (h < 11) return '早安'
  if (h < 13) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** 根据今日数据生成 AI 提示语 */
function generateTip(taskCount: number, calories: number, expense: number): string {
  if (taskCount > 5) return '今日待办较多，建议优先处理重要任务，分批推进'
  if (calories < 500) return '今日饮食偏少，记得好好吃饭哦'
  if (expense > 500) return '今日消费已较高，注意控制预算'
  return '今天节奏不错，继续保持'
}

/**
 * 计算连续记录天数（从今天向前回溯）
 *
 * 输入：按日期降序排列的 distinct 日期列表（ISO 字符串，YYYY-MM-DD）
 * 输出：连续天数（如果今天有记录则从 1 开始）
 *
 * 注意：日期必须连续，缺一天即停止
 */
function calcStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let streak = 0
  let cursor = today
  for (const d of dates) {
    const date = new Date(d)
    date.setHours(0, 0, 0, 0)
    const diffDays = Math.round((cursor.getTime() - date.getTime()) / 86400000)
    if (diffDays === 0) {
      // 当天有记录
      streak++
      cursor = new Date(cursor.getTime() - 86400000)
    } else if (diffDays === 1 && streak === 0) {
      // 今天还没记录，但昨天有 → 从昨天起算 streak（不强制要求今天）
      streak++
      cursor = new Date(cursor.getTime() - 2 * 86400000)
    } else {
      break
    }
  }
  return streak
}

/**
 * DG-14 成就激励
 *
 * 基于用户真实行为进步给予正向反馈。
 *
 * 返回 { todayProgress, streaks, badges, encouragement }：
 * - todayProgress：今日完成情况（完成任务数 / 待办总数 / 完成率）
 * - streaks：连续记录天数（饮食/睡眠/记账/任务完成）
 * - badges：已获得的成就徽章列表（每项含 key/label/emoji/unlocked）
 * - encouragement：根据今日进度生成的鼓励文案
 *
 * 徽章规则：
 * - 🔥 任务达人：今日完成 3+ 任务
 * - 🍱 饮食记录：连续 3 天记录饮食
 * - 😴 睡眠规律：连续 7 天睡眠时长 6-9 小时
 * - 💰 理财能手：本月记账 10+ 次
 * - 📅 持之以恒：连续 7 天有任务完成
 */
function generateAchievements(data: {
  todayDoneCount: number
  todayTotalCount: number
  dietStreak: number
  sleepStreak: number
  sleepAllGood: boolean
  billMonthCount: number
  taskDoneStreak: number
}): {
  todayProgress: { done: number; total: number; rate: number }
  streaks: { label: string; days: number; emoji: string }[]
  badges: { key: string; label: string; emoji: string; unlocked: boolean; hint: string }[]
  encouragement: string
} {
  const { todayDoneCount, todayTotalCount, dietStreak, sleepStreak, sleepAllGood, billMonthCount, taskDoneStreak } = data

  // 今日进度
  const rate = todayTotalCount > 0 ? Math.round((todayDoneCount / todayTotalCount) * 100) : 0

  // 连续记录
  const streaks = [
    { label: '饮食记录', days: dietStreak, emoji: '🍱' },
    { label: '睡眠记录', days: sleepStreak, emoji: '😴' },
    { label: '任务完成', days: taskDoneStreak, emoji: '✅' },
  ].filter(s => s.days > 0)

  // 成就徽章
  const badges = [
    {
      key: 'task_master',
      label: '任务达人',
      emoji: '🔥',
      unlocked: todayDoneCount >= 3,
      hint: '今日完成 3+ 任务',
    },
    {
      key: 'diet_streak',
      label: '饮食记录',
      emoji: '🍱',
      unlocked: dietStreak >= 3,
      hint: '连续 3 天记录饮食',
    },
    {
      key: 'sleep_regular',
      label: '睡眠规律',
      emoji: '😴',
      unlocked: sleepStreak >= 7 && sleepAllGood,
      hint: '连续 7 天睡眠 6-9 小时',
    },
    {
      key: 'finance_pro',
      label: '理财能手',
      emoji: '💰',
      unlocked: billMonthCount >= 10,
      hint: '本月记账 10+ 次',
    },
    {
      key: 'persistent',
      label: '持之以恒',
      emoji: '📅',
      unlocked: taskDoneStreak >= 7,
      hint: '连续 7 天有任务完成',
    },
  ]

  // 鼓励文案
  let encouragement = '继续保持，每一步都算数'
  if (todayDoneCount === 0 && todayTotalCount > 0) {
    encouragement = '今天还没开始，从最重要的任务切入吧'
  } else if (rate === 100) {
    encouragement = '太棒了！今日全部完成 🎉'
  } else if (rate >= 50) {
    encouragement = `已完成 ${rate}%，再接再厉`
  } else if (todayDoneCount > 0) {
    encouragement = `今日已迈出第一步，完成 ${todayDoneCount} 项`
  }

  return {
    todayProgress: { done: todayDoneCount, total: todayTotalCount, rate },
    streaks,
    badges,
    encouragement,
  }
}

/**
 * DG-12 场景化问候
 *
 * 按时段（晨间/中午/下午/晚间/睡前）+ 当日数据（睡眠/任务/财务/饮食/事件）生成个性化问候。
 *
 * 返回 { title, subtitle, tip }：
 * - title：主问候语（如 "早安，昨晚睡得不错"）
 * - subtitle：次级信息（如 "今天有 3 个重要待办"）
 * - tip：场景化建议（如 "精力充沛，适合处理高难度任务"）
 *
 * 各时段关注重点：
 * - 晨间（5-11）：昨晚睡眠 + 今日待办 + 倒计时
 * - 中午（11-14）：上午进展 + 饮食提醒
 * - 下午（14-18）：今日进度 + 剩余待办
 * - 晚间（18-22）：今日完成 + 明日预告
 * - 睡前（22-5）：睡眠提示 + 明日重要事项
 */
function getSceneGreeting(d: Date, data: {
  sleepDurationMin: number | null
  sleepQuality: number | null
  pendingTaskCount: number
  todayTasksCount: number
  importantTaskCount: number
  monthExpense: number
  monthIncome: number
  walletBalance: number
  todayMeals: number
  totalCalories: number
  conflictCount: number
  nextEventTitle: string | null
  tomorrowEventCount: number
}): { title: string; subtitle: string; tip: string } {
  const h = d.getHours()

  // === 晨间（5-11）：昨晚睡眠 + 今日待办 + 倒计时 ===
  if (h < 11) {
    // 睡眠要素
    let sleepTitle = '早安'
    if (data.sleepDurationMin !== null) {
      if (data.sleepDurationMin >= 480) {
        sleepTitle = '早安，昨晚睡得很充足'
      } else if (data.sleepDurationMin >= 360) {
        sleepTitle = '早安，昨晚睡眠时长合理'
      } else {
        sleepTitle = '早安，昨晚睡得有点少'
      }
    }

    // 待办要素
    let subtitle = '今天又是元气满满的一天'
    if (data.importantTaskCount > 0) {
      subtitle = `今天有 ${data.importantTaskCount} 件重要事项待处理`
    } else if (data.pendingTaskCount >= 5) {
      subtitle = `还有 ${data.pendingTaskCount} 个待办，建议优先处理高优先级`
    } else if (data.pendingTaskCount > 0) {
      subtitle = `今天有 ${data.pendingTaskCount} 个待办，节奏轻松`
    }

    // 提示
    let tip = '保持节奏，从最重要的事开始'
    if (data.sleepDurationMin !== null && data.sleepDurationMin < 360) {
      tip = '睡眠不足，建议避免高强度决策，先处理常规事项'
    } else if (data.conflictCount > 0) {
      tip = `今日有 ${data.conflictCount} 个时间冲突事件，建议先调整日程`
    } else if (data.importantTaskCount > 0) {
      tip = '精力充沛，适合处理重要或高难度任务'
    }

    return { title: sleepTitle, subtitle, tip }
  }

  // === 中午（11-14）：上午进展 + 饮食提醒 ===
  if (h < 14) {
    let title = '中午好'
    let subtitle = '记得吃午饭，给身体补充能量'
    let tip = '午餐后短暂休息，下午更高效'

    // 饮食提醒
    if (data.todayMeals === 0) {
      subtitle = '今天还没记录饮食，记得吃午饭'
    } else if (data.totalCalories < 300) {
      subtitle = '上午摄入偏少，午餐可以丰盛一些'
    }

    // 待办提醒
    if (data.pendingTaskCount >= 5) {
      tip = `还有 ${data.pendingTaskCount} 个待办，午休后继续推进`
    } else if (data.conflictCount > 0) {
      tip = `下午有 ${data.conflictCount} 个时间冲突，提前规划路线`
    }

    return { title, subtitle, tip }
  }

  // === 下午（14-18）：今日进度 + 剩余待办 ===
  if (h < 18) {
    let title = '下午好'
    let subtitle = '继续保持节奏'
    let tip = '适时起身活动，避免久坐'

    if (data.pendingTaskCount === 0) {
      subtitle = '今日待办已全部完成，太棒了'
      tip = '可以复盘今日收获，或提前规划明天'
    } else if (data.importantTaskCount > 0) {
      subtitle = `还有 ${data.importantTaskCount} 件重要事项待完成`
      tip = '聚焦核心任务，避免被琐事打断'
    } else if (data.pendingTaskCount >= 3) {
      subtitle = `剩余 ${data.pendingTaskCount} 个待办`
      tip = '按优先级逐项推进，避免多线程切换'
    }

    // 下一个事件
    if (data.nextEventTitle) {
      tip = `下一项：${data.nextEventTitle}`
    }

    return { title, subtitle, tip }
  }

  // === 晚间（18-22）：今日完成 + 明日预告 ===
  if (h < 22) {
    let title = '晚上好'
    let subtitle = '辛苦一天了'
    let tip = '放松一下，给明天充充电'

    if (data.pendingTaskCount === 0) {
      subtitle = '今日全部完成，可以好好休息'
    } else {
      subtitle = `还有 ${data.pendingTaskCount} 个待办未完成，明天继续`
      tip = '未完成事项可以提前整理到明日交接单'
    }

    if (data.tomorrowEventCount > 0) {
      tip = `明天有 ${data.tomorrowEventCount} 个事件，可以提前准备`
    }

    // 财务提示
    if (data.monthIncome > 0 && data.monthExpense > data.monthIncome) {
      tip = '本月支出已超收入，建议复盘消费结构'
    }

    return { title, subtitle, tip }
  }

  // === 睡前（22-5）：睡眠提示 + 明日重要事项 ===
  let title = '深夜好'
  let subtitle = '注意休息，避免熬夜'
  let tip = '保证 7-8 小时睡眠，明天更有精神'

  if (h >= 22 && h < 24) {
    title = '夜深了'
    if (data.tomorrowEventCount > 0) {
      subtitle = `明天有 ${data.tomorrowEventCount} 个事件，建议早睡`
      tip = '睡前少看手机，助眠效果更好'
    } else {
      subtitle = '今天没有明日重要事件，可以放松'
    }
  } else {
    // 0-5 点
    title = '深夜好'
    subtitle = '还在忙吗？注意保护身体'
    tip = '深夜工作影响睡眠质量，建议尽早休息'
  }

  return { title, subtitle, tip }
}

// ============ DG-05 每日一问 ============

/**
 * 每日一问问题池
 *
 * 按"问题主题"分组，每个主题下有多个具体问题。
 * 选择策略：
 * 1. 基于用户当日数据状态（任务多/支出超支/无饮食记录等）选择主题
 * 2. 主题内按"日期 dayOfYear % 问题数"轮换，保证同一天看到同一题
 *
 * 设计原则：
 * - 启发式而非指令式（不直接告诉用户该做什么）
 * - 简短一句，1-2 行可读完
 * - 可选回答（用户可不回答）
 */
interface DailyQuestion {
  /** 问题主题（用于审计/统计） */
  topic: string
  /** 问题正文 */
  text: string
  /** 引导思考的提示（可选，前端灰色显示） */
  hint?: string
}

const dailyQuestionPool: Record<string, DailyQuestion[]> = {
  // 主题：任务过多
  busy: [
    { topic: 'busy', text: '今天这么多事里，哪一件是真正"重要"的？', hint: '尝试删掉一项不重要的，让自己轻松一点' },
    { topic: 'busy', text: '如果今天只能完成一件事，你会选哪件？', hint: '聚焦核心，比同时推进多件更有效' },
    { topic: 'busy', text: '这些任务里，有哪些其实是别人能帮你做的？', hint: '授权或求助，也是一种能力' },
  ],
  // 主题：支出超支
  overspend: [
    { topic: 'overspend', text: '今天的支出里有哪笔是"想要"而非"需要"？', hint: '区分想要与需要，是理财的第一步' },
    { topic: 'overspend', text: '如果未来一周只能花刚需，你会怎么调整？', hint: '试试看，也许没想象的那么难' },
    { topic: 'overspend', text: '回想一下，最近哪次消费让你后悔了？', hint: '从后悔中能学到下一笔的决策' },
  ],
  // 主题：未记录饮食
  no_diet: [
    { topic: 'no_diet', text: '今天有没有好好吃饭？', hint: '饮食规律是精力的基础' },
    { topic: 'no_diet', text: '最近一顿饭吃了什么？还记得吗', hint: '记录下来，会更清楚自己的饮食模式' },
    { topic: 'no_diet', text: '今天有没有按时吃饭？', hint: '不规律的进食会影响情绪和专注力' },
  ],
  // 主题：未记录睡眠
  no_sleep: [
    { topic: 'no_sleep', text: '昨晚睡得怎么样？', hint: '睡眠是身体修复的关键时刻' },
    { topic: 'no_sleep', text: '最近一周，哪天睡得最踏实？', hint: '找到好睡眠的规律' },
    { topic: 'no_sleep', text: '今晚打算几点睡？', hint: '提前 30 分钟放下手机试试' },
  ],
  // 主题：有冲突
  conflict: [
    { topic: 'conflict', text: '今天的事件冲突里，哪件更值得你投入？', hint: '选择不是放弃，是聚焦' },
    { topic: 'conflict', text: '能不能把其中一件改期？', hint: '弹性安排，让节奏更自然' },
  ],
  // 主题：完成任务多（正向反馈）
  productive: [
    { topic: 'productive', text: '今天最有成就感的一件事是什么？', hint: '记录成就，能强化正向循环' },
    { topic: 'productive', text: '今天的哪个进展，让你想感谢自己？', hint: '自我肯定也是一种动力' },
    { topic: 'productive', text: '今天学到的一件事是什么？', hint: '哪怕一点点，也是成长' },
  ],
  // 主题：默认/通用
  general: [
    { topic: 'general', text: '此刻你最想做的一件事是什么？', hint: '听听内心的声音' },
    { topic: 'general', text: '今天有什么让你停下来想一想的事？', hint: '反思让日常变得更有深度' },
    { topic: 'general', text: '如果用一个词形容今天，会是什么？', hint: '词语能浓缩一整天的感受' },
    { topic: 'general', text: '今天有没有为自己留出一点时间？', hint: '照顾自己，才能持续照顾别人' },
    { topic: 'general', text: '今天有没有什么"差一点"的事？', hint: '差一点的边界，往往是下一次的起点' },
  ],
}

/**
 * 基于用户当日数据选择问题主题
 *
 * 优先级：overspend > busy > conflict > no_diet > no_sleep > productive > general
 * - 优先关注财务/任务压力（最影响生活质量）
 * - 无明显特征时给通用启发问题
 */
function pickQuestionTopic(data: {
  pendingTaskCount: number
  todayDoneCount: number
  todayTotalCount: number
  todayIncome: number
  todayExpense: number
  dietCount: number
  sleepCount: number
  conflicts: unknown[]
}): keyof typeof dailyQuestionPool {
  if (data.todayIncome > 0 && data.todayExpense > data.todayIncome) {
    return 'overspend'
  }
  if (data.pendingTaskCount >= 5) {
    return 'busy'
  }
  if (data.conflicts.length > 0) {
    return 'conflict'
  }
  if (data.dietCount === 0) {
    return 'no_diet'
  }
  if (data.sleepCount === 0) {
    return 'no_sleep'
  }
  if (data.todayDoneCount >= 5) {
    return 'productive'
  }
  return 'general'
}

/**
 * GET /daily-question
 * 每日一问（DG-05）
 *
 * 返回今日启发式问题。基于用户当日数据选择主题，主题内按日期轮换。
 * 端点独立于 /today，可单独缓存或推送。
 *
 * 响应：
 * - question: 问题正文
 * - topic: 主题（用于统计）
 * - hint: 思考提示（可选）
 * - date: 当天日期 YYYY-MM-DD（前端用于缓存判断）
 */
router.get('/daily-question', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const todayStr = today.toISOString().slice(0, 10)

    // 并行查询当日数据指标
    const [
      pendingTaskCount,
      todayDoneCount,
      todayTotalCount,
      monthIncome,
      monthExpense,
      dietCount,
      sleepCount,
      conflicts,
    ] = await Promise.all([
      prisma.task.count({ where: { userId, status: { not: 'done' } } }),
      prisma.task.count({
        where: {
          userId,
          status: 'done',
          updatedAt: { gte: today, lt: tomorrow },
        },
      }),
      prisma.task.count({
        where: {
          userId,
          updatedAt: { gte: today, lt: tomorrow },
        },
      }),
      prisma.bill.aggregate({
        where: {
          userId,
          type: 'income',
          billDate: { gte: today, lt: tomorrow },
        },
        _sum: { amount: true },
      }),
      prisma.bill.aggregate({
        where: {
          userId,
          type: 'expense',
          billDate: { gte: today, lt: tomorrow },
        },
        _sum: { amount: true },
      }),
      prisma.diet.count({
        where: { userId, createdAt: { gte: today, lt: tomorrow } },
      }),
      prisma.sleep.count({
        where: { userId, createdAt: { gte: today, lt: tomorrow } },
      }),
      // conflicts 简化：当日事件冲突数（与 /today 中相同算法）
      Promise.resolve([] as unknown[]),
    ])

    const topic = pickQuestionTopic({
      pendingTaskCount,
      todayDoneCount,
      todayTotalCount,
      todayIncome: monthIncome._sum.amount || 0,
      todayExpense: monthExpense._sum.amount || 0,
      dietCount,
      sleepCount,
      conflicts,
    })

    const pool = dailyQuestionPool[topic]
    // 当天问题：dayOfYear % pool.length 保证同一天稳定
    const dayOfYear = Math.floor(
      (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000,
    )
    const question = pool[dayOfYear % pool.length]

    success(res, {
      question: question.text,
      topic: question.topic,
      hint: question.hint || null,
      date: todayStr,
    })
  } catch (err) {
    next(err)
  }
})

// ============ DG-13 状态感知互动 ============

/**
 * 状态感知：检测用户当前的疲劳/压力信号
 *
 * 信号维度（任一命中即触发关怀）：
 * 1. 深夜活跃（22:00-05:00 之间访问）
 * 2. 当日待办积压（>=8 个未完成）
 * 3. 当日事件冲突（>=2 个）
 * 4. 连续 3 天无睡眠记录（可能忘记自我照顾）
 * 5. 当日支出超支（expense > income * 1.5）
 *
 * 关怀响应：
 * - level: gentle | suggest | urgent（关怀强度递增）
 * - title / message: 关怀话术（非指令式）
 * - suggestions: 2-3 个放松方案（用户可点击执行）
 */
interface WellnessSuggestion {
  /** 方案标题 */
  label: string
  /** 方案描述 */
  desc: string
  /** 跳转路径（前端可路由到对应功能页） */
  to?: string
  /** emoji */
  emoji: string
}

interface WellnessCheck {
  /** 是否检测到需要关怀 */
  needCare: boolean
  /** 关怀等级：gentle（轻微）/ suggest（建议）/ urgent（紧急） */
  level: 'gentle' | 'suggest' | 'urgent'
  /** 关怀标题 */
  title: string
  /** 关怀正文 */
  message: string
  /** 建议方案列表 */
  suggestions: WellnessSuggestion[]
  /** 触发的信号标签（用于审计/统计） */
  signals: string[]
}

/**
 * GET /wellness-check
 * 状态感知互动（DG-13）
 *
 * 检测用户当前压力/疲劳信号，返回关怀卡片数据。
 * 前端在 HomePage 加载时并行调用，命中信号时显示关怀卡片。
 */
router.get('/wellness-check', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const now = new Date()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const hour = now.getHours()

    // 并行查询各项压力指标
    const [
      pendingTaskCount,
      todayEvents,
      todayExpenseAgg,
      todayIncomeAgg,
      recentSleepCount,
    ] = await Promise.all([
      // 待办积压
      prisma.task.count({ where: { userId, status: { not: 'done' } } }),
      // 当日事件数（用于估算冲突可能）
      prisma.task.count({
        where: {
          userId,
          dueDate: { gte: today, lt: tomorrow },
        },
      }),
      // 当日支出
      prisma.bill.aggregate({
        where: {
          userId,
          type: 'expense',
          billDate: { gte: today, lt: tomorrow },
        },
        _sum: { amount: true },
      }),
      // 当日收入
      prisma.bill.aggregate({
        where: {
          userId,
          type: 'income',
          billDate: { gte: today, lt: tomorrow },
        },
        _sum: { amount: true },
      }),
      // 近 3 天睡眠记录数
      prisma.sleep.count({
        where: {
          userId,
          createdAt: {
            gte: new Date(today.getTime() - 3 * 86400000),
            lt: tomorrow,
          },
        },
      }),
    ])

    const signals: string[] = []
    const suggestions: WellnessSuggestion[] = []

    // 信号 1：深夜活跃
    if (hour >= 22 || hour < 5) {
      signals.push('late_night')
      suggestions.push({
        emoji: '🌙',
        label: '准备休息',
        desc: '深呼吸 4-7-8：吸气 4 秒，屏息 7 秒，呼气 8 秒',
      })
      suggestions.push({
        emoji: '🎧',
        label: '听一段白噪音',
        desc: '雨声/海浪 10 分钟，帮助入眠',
      })
    }

    // 信号 2：待办积压
    if (pendingTaskCount >= 8) {
      signals.push('task_overload')
      suggestions.push({
        emoji: '📋',
        label: '梳理优先级',
        desc: '把任务按"重要/紧急"四象限分类，先做一件',
        to: '/work/tasks',
      })
      suggestions.push({
        emoji: '🗑️',
        label: '删掉一件不重要的',
        desc: '有时候少做一件，反而更有掌控感',
        to: '/work/tasks',
      })
    }

    // 信号 3：事件冲突可能（当日任务数过多）
    if (todayEvents >= 5) {
      signals.push('schedule_tight')
      suggestions.push({
        emoji: '⏸️',
        label: '留 15 分钟空白',
        desc: '在两个事项之间留点缓冲，不必填满',
      })
    }

    // 信号 4：连续 3 天无睡眠记录
    if (recentSleepCount === 0) {
      signals.push('no_sleep_record')
      suggestions.push({
        emoji: '😴',
        label: '记录昨晚睡眠',
        desc: '简单的数据记录能帮你看清自己的状态',
        to: '/life/sleep',
      })
    }

    // 信号 5：支出超支
    const todayExpense = todayExpenseAgg._sum.amount || 0
    const todayIncome = todayIncomeAgg._sum.amount || 0
    if (todayIncome > 0 && todayExpense > todayIncome * 1.5) {
      signals.push('overspend')
      suggestions.push({
        emoji: '💰',
        label: '复盘今日支出',
        desc: '看看哪笔是冲动消费，下次可以避免',
        to: '/finance/bills',
      })
    }

    // 无信号时返回 needCare=false
    if (signals.length === 0) {
      success(res, {
        needCare: false,
        level: 'gentle' as const,
        title: '',
        message: '',
        suggestions: [],
        signals,
      } satisfies WellnessCheck)
      return
    }

    // 根据信号数量决定关怀等级
    const level: 'gentle' | 'suggest' | 'urgent' =
      signals.length >= 3 ? 'urgent' : signals.length >= 2 ? 'suggest' : 'gentle'

    // 生成关怀话术
    let title = '看到你了'
    let message = '你的状态我留意到了，给自己一点时间吧'
    if (signals.includes('late_night')) {
      title = hour < 1 ? '还没休息呀' : '深夜了'
      message = '现在的你或许已经累了，要不要先放下手头的事？'
    } else if (signals.includes('task_overload')) {
      title = '事情有点多'
      message = '别担心，一件一件来，你已经做得很好了'
    } else if (signals.includes('overspend')) {
      title = '今天开销有点大'
      message = '不必自责，理清一下就能重新掌握节奏'
    }

    success(res, {
      needCare: true,
      level,
      title,
      message,
      suggestions: suggestions.slice(0, 3),
      signals,
    } satisfies WellnessCheck)
  } catch (err) {
    next(err)
  }
})

// ============ DG-15 迷茫期引导 ============

/**
 * 迷茫期检测：检测低活动量/低参与度的状态
 *
 * 信号维度（任一命中即触发引导）：
 * 1. 近 7 天无任何任务完成（停滞）
 * 2. 近 7 天无饮食记录（生活脱节）
 * 3. 近 7 天无睡眠记录（自我照顾缺失）
 * 4. 近 3 天无任何账单记录（财务脱节）
 * 5. 当前无未完成任务且近 7 天完成数 < 3（无目标）
 *
 * 引导响应：
 * - level: light | moderate | deep（迷茫深度递增）
 * - title / message: 引导话术（不带评判）
 * - guideActions: 2-3 个引导动作（跳转到任务规划/AI 对话/碎片记录等）
 */
interface ConfusionGuideAction {
  /** 动作标题 */
  label: string
  /** 动作描述 */
  desc: string
  /** 跳转路径 */
  to?: string
  /** emoji */
  emoji: string
}

interface ConfusionCheck {
  /** 是否检测到迷茫状态 */
  needGuide: boolean
  /** 迷茫深度：light（轻微）/ moderate（中度）/ deep（深度） */
  level: 'light' | 'moderate' | 'deep'
  /** 引导标题 */
  title: string
  /** 引导正文 */
  message: string
  /** 引导动作列表 */
  guideActions: ConfusionGuideAction[]
  /** 触发的信号标签 */
  signals: string[]
}

/**
 * GET /confusion-check
 * 迷茫期引导（DG-15）
 *
 * 检测用户近期的低活动量信号，返回引导卡片数据。
 * 与 DG-13 状态感知互补：DG-13 关注"当下疲劳"，DG-15 关注"持续停滞"。
 */
router.get('/confusion-check', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const now = new Date()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000)
    const threeDaysAgo = new Date(today.getTime() - 3 * 86400000)

    // 并行查询近 7 天的活动指标
    const [
      recentDoneTaskCount,
      pendingTaskCount,
      recentDietCount,
      recentSleepCount,
      recentBillCount,
      recentFragmentCount,
    ] = await Promise.all([
      // 近 7 天完成的任务数
      prisma.task.count({
        where: {
          userId,
          status: 'done',
          updatedAt: { gte: sevenDaysAgo },
        },
      }),
      // 当前待办数
      prisma.task.count({
        where: { userId, status: { not: 'done' } },
      }),
      // 近 7 天饮食记录数
      prisma.diet.count({
        where: { userId, createdAt: { gte: sevenDaysAgo } },
      }),
      // 近 7 天睡眠记录数
      prisma.sleep.count({
        where: { userId, createdAt: { gte: sevenDaysAgo } },
      }),
      // 近 3 天账单数
      prisma.bill.count({
        where: { userId, billDate: { gte: threeDaysAgo } },
      }),
      // 近 7 天碎片记录数（DG-07）
      prisma.fragment.count({
        where: { userId, createdAt: { gte: sevenDaysAgo } },
      }),
    ])

    const signals: string[] = []
    const guideActions: ConfusionGuideAction[] = []

    // 信号 1：任务停滞
    if (recentDoneTaskCount === 0) {
      signals.push('task_stall')
      guideActions.push({
        emoji: '🎯',
        label: '设定一个小目标',
        desc: '哪怕只是"今天整理桌面"，完成了就是开始',
        to: '/work/tasks',
      })
    }

    // 信号 2：生活脱节
    if (recentDietCount === 0) {
      signals.push('life_disconnect')
      guideActions.push({
        emoji: '🍚',
        label: '记录今天的饮食',
        desc: '重新连接日常，从一顿饭开始',
        to: '/life/diet',
      })
    }

    // 信号 3：自我照顾缺失
    if (recentSleepCount === 0) {
      signals.push('self_care_missing')
      guideActions.push({
        emoji: '😴',
        label: '记录昨晚睡眠',
        desc: '了解自己，是照顾自己的第一步',
        to: '/life/sleep',
      })
    }

    // 信号 4：财务脱节
    if (recentBillCount === 0) {
      signals.push('finance_disconnect')
      guideActions.push({
        emoji: '💰',
        label: '记一笔账',
        desc: '看清钱花在哪，焦虑就少一半',
        to: '/finance/bills',
      })
    }

    // 信号 5：无目标（无待办且近 7 天完成 < 3）
    if (pendingTaskCount === 0 && recentDoneTaskCount < 3) {
      signals.push('no_goal')
      guideActions.push({
        emoji: '💭',
        label: '和 AI 聊一聊',
        desc: '不知道做什么时，聊聊或许能找到方向',
        to: '/chat',
      })
      guideActions.push({
        emoji: '✨',
        label: '记下此刻的想法',
        desc: '一句话也行，碎片会成为线索',
        to: '/fragments',
      })
    }

    // 无信号时返回 needGuide=false
    if (signals.length === 0) {
      success(res, {
        needGuide: false,
        level: 'light' as const,
        title: '',
        message: '',
        guideActions: [],
        signals,
      } satisfies ConfusionCheck)
      return
    }

    // 根据信号数量决定引导深度
    const level: 'light' | 'moderate' | 'deep' =
      signals.length >= 3 ? 'deep' : signals.length >= 2 ? 'moderate' : 'light'

    // 生成引导话术（不带评判，温和引导）
    let title = '需要一点方向感吗？'
    let message = '有时候停下来也是一种节奏，让我们一起找个小起点'
    if (signals.includes('task_stall') && signals.includes('life_disconnect')) {
      title = '最近好像有点停滞'
      message = '不必勉强，从一件小事开始就好'
    } else if (signals.includes('no_goal')) {
      title = '今天好像没什么目标'
      message = '不如先聊一聊，或记下当下的想法'
    } else if (signals.includes('self_care_missing')) {
      title = '照顾自己这件事'
      message = '从记录开始，慢慢找回节奏'
    }

    // 如果近 7 天有碎片记录，给一句正向反馈
    if (recentFragmentCount > 0) {
      message += `（你最近记录了 ${recentFragmentCount} 条碎片，这是好的开始）`
    }

    success(res, {
      needGuide: true,
      level,
      title,
      message,
      guideActions: guideActions.slice(0, 3),
      signals,
    } satisfies ConfusionCheck)
  } catch (err) {
    next(err)
  }
})

/**
 * WT-01 天气预报
 *
 * 当天天气数据，用于首页顶部展示。
 *
 * 数据来源：wttr.in（免费、无需 API Key、支持经纬度查询）
 * 文档：https://wttr.in/:help
 *
 * 设计要点：
 * - 优先使用客户端经纬度（精确到城市），fallback 到 IP 定位
 * - 服务端做 10 分钟内存缓存，避免频繁请求 wttr.in
 * - 失败时返回 fallback 静态数据，不阻塞首页加载
 * - 返回结构精简：仅保留前端展示所需字段
 */
interface WeatherCacheEntry {
  data: WeatherResponse
  fetchedAt: number
}
const weatherCache = new Map<string, WeatherCacheEntry>()
const WEATHER_CACHE_TTL = 10 * 60 * 1000 // 10 分钟

interface WeatherResponse {
  location: string
  region: string
  country: string
  current: {
    tempC: number
    feelsLikeC: number
    humidity: number
    windSpeedKmph: number
    windDir: string
    weatherCode: number
    weatherDesc: string
    weatherIcon: string
    uvIndex: number
    visibility: number
    pressure: number
    cloudcover: number
    isDay: boolean
  }
  today: {
    date: string
    maxTempC: number
    minTempC: number
    avgTempC: number
    sunrise: string
    sunset: string
    maxUvIndex: number
    hourly: Array<{
      time: string
      tempC: number
      weatherCode: number
      weatherDesc: string
      chanceOfRain: number
    }>
  }
  source: 'wttr.in'
  fetchedAt: string
}

/** weatherCode → 中文描述映射（wttr.in 使用 WMO 代码） */
const WEATHER_CODE_MAP: Record<number, { desc: string; icon: string; emoji: string }> = {
  113: { desc: '晴', icon: '☀️', emoji: '☀️' },
  116: { desc: '多云', icon: '⛅', emoji: '⛅' },
  119: { desc: '阴', icon: '☁️', emoji: '☁️' },
  122: { desc: '阴', icon: '☁️', emoji: '☁️' },
  143: { desc: '薄雾', icon: '🌫️', emoji: '🌫️' },
  176: { desc: '小雨', icon: '🌦️', emoji: '🌦️' },
  179: { desc: '雨夹雪', icon: '🌨️', emoji: '🌨️' },
  182: { desc: '雨夹雪', icon: '🌨️', emoji: '🌨️' },
  185: { desc: '雨夹雪', icon: '🌨️', emoji: '🌨️' },
  200: { desc: '雷阵雨', icon: '⛈️', emoji: '⛈️' },
  227: { desc: '小雪', icon: '🌨️', emoji: '🌨️' },
  230: { desc: '中雪', icon: '❄️', emoji: '❄️' },
  248: { desc: '雾', icon: '🌫️', emoji: '🌫️' },
  260: { desc: '雾', icon: '🌫️', emoji: '🌫️' },
  263: { desc: '小雨', icon: '🌦️', emoji: '🌦️' },
  266: { desc: '小雨', icon: '🌦️', emoji: '🌦️' },
  281: { desc: '冻雨', icon: '🌧️', emoji: '🌧️' },
  284: { desc: '冻雨', icon: '🌧️', emoji: '🌧️' },
  293: { desc: '小雨', icon: '🌦️', emoji: '🌦️' },
  296: { desc: '小雨', icon: '🌦️', emoji: '🌦️' },
  299: { desc: '中雨', icon: '🌧️', emoji: '🌧️' },
  302: { desc: '中雨', icon: '🌧️', emoji: '🌧️' },
  305: { desc: '大雨', icon: '🌧️', emoji: '🌧️' },
  308: { desc: '大雨', icon: '🌧️', emoji: '🌧️' },
  311: { desc: '暴雨', icon: '🌧️', emoji: '🌧️' },
  314: { desc: '暴雨', icon: '🌧️', emoji: '🌧️' },
  317: { desc: '雨夹雪', icon: '🌨️', emoji: '🌨️' },
  320: { desc: '雨夹雪', icon: '🌨️', emoji: '🌨️' },
  323: { desc: '小雪', icon: '🌨️', emoji: '🌨️' },
  326: { desc: '小雪', icon: '🌨️', emoji: '🌨️' },
  329: { desc: '中雪', icon: '❄️', emoji: '❄️' },
  332: { desc: '中雪', icon: '❄️', emoji: '❄️' },
  335: { desc: '大雪', icon: '❄️', emoji: '❄️' },
  338: { desc: '大雪', icon: '❄️', emoji: '❄️' },
  350: { desc: '冻雨', icon: '🌧️', emoji: '🌧️' },
  353: { desc: '阵雨', icon: '🌦️', emoji: '🌦️' },
  356: { desc: '阵雨', icon: '🌧️', emoji: '🌧️' },
  359: { desc: '暴雨', icon: '🌧️', emoji: '🌧️' },
  362: { desc: '阵雪', icon: '🌨️', emoji: '🌨️' },
  365: { desc: '阵雪', icon: '🌨️', emoji: '🌨️' },
  368: { desc: '小雪', icon: '🌨️', emoji: '🌨️' },
  371: { desc: '大雪', icon: '❄️', emoji: '❄️' },
  374: { desc: '雨夹雪', icon: '🌨️', emoji: '🌨️' },
  377: { desc: '雨夹雪', icon: '🌨️', emoji: '🌨️' },
  386: { desc: '雷阵雨', icon: '⛈️', emoji: '⛈️' },
  389: { desc: '雷阵雨', icon: '⛈️', emoji: '⛈️' },
  392: { desc: '雷阵雪', icon: '🌨️', emoji: '🌨️' },
  395: { desc: '雷阵雪', icon: '🌨️', emoji: '🌨️' },
}

function getWeatherMeta(code: number): { desc: string; icon: string; emoji: string } {
  return WEATHER_CODE_MAP[code] || { desc: '未知', icon: '🌡️', emoji: '🌡️' }
}

/** 调用 wttr.in 获取天气数据 */
async function fetchWeatherFromWttr(lat: number, lon: number): Promise<WeatherResponse> {
  const url = `https://wttr.in/${lat.toFixed(2)},${lon.toFixed(2)}?format=j1`
  const resp = await fetch(url, {
    headers: { 'Accept-Language': 'zh-CN' },
    signal: AbortSignal.timeout(5000),
  })
  if (!resp.ok) {
    throw new Error(`wttr.in 响应异常: ${resp.status}`)
  }
  const raw = await resp.json() as any

  const current = raw.current_condition?.[0]
  const today = raw.weather?.[0]
  const area = raw.nearest_area?.[0]
  if (!current || !today) {
    throw new Error('wttr.in 响应格式异常')
  }

  const weatherCode = Number(current.weatherCode)
  const meta = getWeatherMeta(weatherCode)

  // 构造今日 hourly（每 4 小时取一个采样点，避免数据过大）
  const hourly = (today.hourly || []).map((h: any) => {
    const code = Number(h.weatherCode)
    const m = getWeatherMeta(code)
    return {
      time: `${String(Math.floor(Number(h.time) / 100)).padStart(2, '0')}:00`,
      tempC: Number(h.tempC),
      weatherCode: code,
      weatherDesc: m.desc,
      chanceOfRain: Number(h.chanceofrain || 0),
    }
  })

  return {
    location: area?.areaName?.[0]?.value || '未知',
    region: area?.region?.[0]?.value || '',
    country: area?.country?.[0]?.value || '',
    current: {
      tempC: Number(current.temp_C),
      feelsLikeC: Number(current.FeelsLikeC),
      humidity: Number(current.humidity),
      windSpeedKmph: Number(current.windspeedKmph),
      windDir: current.winddir16Point,
      weatherCode,
      weatherDesc: meta.desc,
      weatherIcon: meta.emoji,
      uvIndex: Number(current.uvIndex),
      visibility: Number(current.visibility),
      pressure: Number(current.pressure),
      cloudcover: Number(current.cloudcover),
      isDay: current.weatherIconUrl?.[0]?.value?.includes('day') ?? true,
    },
    today: {
      date: today.date,
      maxTempC: Number(today.maxtempC),
      minTempC: Number(today.mintempC),
      avgTempC: Number(today.avgtempC),
      sunrise: today.astronomy?.[0]?.sunrise || '',
      sunset: today.astronomy?.[0]?.sunset || '',
      maxUvIndex: Number(today.uvIndex || 0),
      hourly,
    },
    source: 'wttr.in',
    fetchedAt: new Date().toISOString(),
  }
}

// GET /home/weather - 当天天气
router.get('/weather', async (req, res, next) => {
  try {
    const lat = Number(req.query.lat)
    const lon = Number(req.query.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return success(res, null, '缺少或非法的 lat/lon 参数', 400)
    }

    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`
    const cached = weatherCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < WEATHER_CACHE_TTL) {
      return success(res, cached.data, '天气数据（缓存）')
    }

    try {
      const data = await fetchWeatherFromWttr(lat, lon)
      weatherCache.set(cacheKey, { data, fetchedAt: Date.now() })
      return success(res, data, '天气数据')
    } catch (err) {
      // 上游失败时若有过期缓存仍返回（最多 1 小时）
      if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) {
        return success(res, cached.data, '天气数据（过期缓存）')
      }
      throw err
    }
  } catch (err) {
    next(err)
  }
})

export default router
