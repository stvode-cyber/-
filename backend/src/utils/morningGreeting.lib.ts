/**
 * 每日早安问候调度器（MorningGreetingScheduler）
 *
 * 功能：每天早上 9:00 自动向每位用户的最近会话发送一条 AI 私信，
 * 问候"今天还好吗"并询问是否需要帮忙记录事项。
 *
 * 设计要点：
 * 1. 沿用 countdown.lib.ts 的 setInterval + unref() 模式，不引入 node-cron
 * 2. 每分钟检查一次，当 hour=9 且 minute=0 时触发
 * 3. 用 lastSentDate 防止同一天重复发送
 * 4. 消息带有 messageType='text' + metadata={ isProactive: true, greeting: 'morning' }
 * 5. 消息内容根据用户上下文个性化（待办数量、昵称等）
 */

import { prisma } from '../lib/prisma.js'
import { buildPersonalizedGreeting, type TodayTask } from './proactive.lib.js'

/** 调度器状态 */
let schedulerHandle: ReturnType<typeof setInterval> | null = null

/** 记录上次发送日期（YYYY-MM-DD），防止同一天重复发送 */
let lastSentDate: string | null = null

/** 触发时间：每天 9:00 */
const TRIGGER_HOUR = 9
const TRIGGER_MINUTE = 0

/**
 * 启动早安问候调度器
 *
 * 每分钟检查当前时间，到达 9:00 时向所有用户发送问候消息。
 *
 * @param intervalMs 扫描间隔（默认 60_000，即每分钟）
 */
export function startMorningGreetingScheduler(intervalMs: number = 60_000): void {
  if (schedulerHandle) return

  schedulerHandle = setInterval(() => {
    runMorningGreetingCheck().catch((err) => {
      console.error('[MorningGreeting] 检查失败:', err)
    })
  }, intervalMs)

  schedulerHandle.unref?.()
  console.log(`[MorningGreeting] 已启动，每日 ${TRIGGER_HOUR}:${String(TRIGGER_MINUTE).padStart(2, '0')} 触发`)
}

/** 停止调度器（仅测试用） */
export function stopMorningGreetingScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle)
    schedulerHandle = null
  }
}

/**
 * 单次检查：判断是否到达触发时间
 */
export async function runMorningGreetingCheck(now: Date = new Date()): Promise<void> {
  const hour = now.getHours()
  const minute = now.getMinutes()
  const todayStr = formatDateKey(now)

  // 不在 9:00 时段，跳过
  if (hour !== TRIGGER_HOUR || minute !== TRIGGER_MINUTE) return

  // 今天已经发送过，跳过
  if (lastSentDate === todayStr) return

  console.log(`[MorningGreeting] 触发每日问候 (${todayStr} ${hour}:${minute})`)
  lastSentDate = todayStr

  await sendMorningGreetingsToAllUsers()
}

/**
 * 向所有用户发送早安问候
 *
 * 1. 查询所有用户
 * 2. 为每位用户找到最近的 chat session（没有则创建）
 * 3. 生成个性化问候消息并写入数据库（资料库 + LLM，见 buildPersonalizedGreeting）
 */
export async function sendMorningGreetingsToAllUsers(): Promise<number> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      nickname: true,
      username: true,
      preferredTone: true,
    },
    take: 500, // 单次上限
  })

  let sentCount = 0

  for (const user of users) {
    try {
      await sendGreetingToUser(user.id, user.nickname || user.username, user.preferredTone || 'gentle')
      sentCount++
    } catch (err) {
      console.error(`[MorningGreeting] 用户 ${user.id} 发送失败:`, err)
    }
  }

  console.log(`[MorningGreeting] 完成，共发送 ${sentCount}/${users.length} 条`)
  return sentCount
}

/**
 * 向单个用户发送早安问候
 *
 * - 找到用户最近的 chat session（按 updatedAt 降序）
 * - 如果没有 session，创建一个新的
 * - 写入一条 assistant 角色的消息
 * - 消息内容：检索用户资料库 → LLM 个性化生成（睡眠/情绪摘要作为补充上下文）
 *
 * @returns 创建的 Message 对象
 */
export async function sendGreetingToUser(userId: string, displayName: string, tone: string): Promise<{ id: string; content: string; sessionId: string }> {
  // 找到用户最近的会话
  let session = await prisma.chatSession.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  })

  // 没有会话则创建一个
  if (!session) {
    session = await prisma.chatSession.create({
      data: {
        userId,
        title: '每日问候',
      },
    })
  }

  // 查询今日待办（供 LLM 参考 + metadata）
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const todayTasks: TodayTask[] = await prisma.task.findMany({
    where: {
      userId,
      status: 'todo',
      dueDate: {
        gte: new Date(`${todayStr}T00:00:00`),
        lt: new Date(`${todayStr}T23:59:59`),
      },
    },
    select: { id: true, title: true, important: true, dueDate: true },
    orderBy: [{ important: 'desc' }, { dueDate: 'asc' }],
    take: 5,
  })
  const todayPendingCount = todayTasks.length

  // 查询昨晚睡眠记录
  const lastSleep = await prisma.sleep.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  let sleepCare = ''
  if (lastSleep) {
    const sleepDate = new Date(lastSleep.createdAt)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (sleepDate.toDateString() === yesterday.toDateString() || sleepDate.toDateString() === today.toDateString()) {
      const sleepHours = lastSleep.durationMin ? Math.floor(lastSleep.durationMin / 60) : 0
      if (sleepHours > 0 && sleepHours < 6) {
        sleepCare = ' 看你昨晚睡得不太久（不足6小时）'
      } else if (sleepHours >= 7) {
        sleepCare = ' 昨晚睡得不错（7小时以上）'
      }
    }
  }

  // 查询近期对话情绪（最近3条用户消息是否有负面情绪）
  const recentMessages = await prisma.message.findMany({
    where: { userId, role: 'user' },
    orderBy: { createdAt: 'desc' },
    take: 3,
  })
  const negativeWords = ['累', '烦', '压力', '焦虑', '难过', '不开心', '孤独', '无聊', '没动力']
  const hasRecentNegative = recentMessages.some(m =>
    m.content && negativeWords.some(w => m.content.includes(w)),
  )
  let moodCare = ''
  if (hasRecentNegative) {
    moodCare = ' 他最近挺累/情绪有点低落，可以多关心他'
  }

  // 生成问候内容：资料库 + LLM（睡眠/情绪作为补充，LLM 不可用时回退内置模板）
  const extraContext = [sleepCare.trim(), moodCare.trim()].filter(Boolean).join('。')
  const content = await buildPersonalizedGreeting(userId, displayName, tone, today, todayTasks, extraContext || undefined)

  // 写入 AI 消息
  const msg = await prisma.message.create({
    data: {
      sessionId: session.id,
      userId,
      role: 'assistant',
      content,
      messageType: 'text',
      metadata: JSON.stringify({
        isProactive: true,
        greeting: 'morning',
        sentAt: new Date().toISOString(),
        context: {
          todayPendingCount,
          sleepCare: sleepCare || undefined,
          moodCare: moodCare || undefined,
        },
      }),
    },
  })

  // 更新会话时间，让这条消息排在最前
  await prisma.chatSession.update({
    where: { id: session.id },
    data: { updatedAt: new Date() },
  })

  return { id: msg.id, content: msg.content, sessionId: msg.sessionId }
}

/**
 * 格式化日期为 YYYY-MM-DD（用于去重判断）
 */
function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
