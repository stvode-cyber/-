/**
 * 每周聚合调度器（WeeklyAggregator）— P1
 *
 * 功能：每周一 03:00 为所有活跃用户预聚合「上周周报」JSON，
 * 存入 Fragment(kind='weekly_report', note='week:YYYY-MM-DD') 缓存。
 * @回顾 / GET /chat/weekly-report 读取时上周报告直接命中缓存，零等待。
 *
 * 设计要点：
 * 1. 沿用 morningGreeting.lib 的 setInterval + unref() 模式，不引入 node-cron
 * 2. 每分钟检查，周一 03:00~03:59 窗口内触发（分钟级容错，重启不丢）
 * 3. 防重：聚合前先查该用户该周 Fragment 是否已存在，已有则跳过
 * 4. 活跃用户定义：近 14 天有 user 消息的用户（避免全表扫描）
 */
import { prisma } from '../lib/prisma.js'
import { buildWeeklyReport } from '../services/agentCore.js'

let schedulerHandle: NodeJS.Timeout | null = null
let lastRunDate: string | null = null

/** 单次检查：周一 03:00~03:59 窗口触发 */
export async function runWeeklyAggregatorCheck(now: Date = new Date()): Promise<void> {
  const day = now.getDay()
  const hour = now.getHours()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (day !== 1 || hour !== 3) return
  if (lastRunDate === todayStr) return
  lastRunDate = todayStr
  console.log(`[WeeklyAggregator] 触发周报聚合 (${todayStr} ${hour}:${now.getMinutes()})`)
  await aggregateForAllUsers()
}

/** 启动调度器（每分钟检查） */
export function startWeeklyAggregatorScheduler(intervalMs: number = 60_000): void {
  if (schedulerHandle) return
  schedulerHandle = setInterval(() => {
    runWeeklyAggregatorCheck().catch((err) => {
      console.error('[WeeklyAggregator] 检查失败:', err)
    })
  }, intervalMs)
  schedulerHandle.unref?.()
  console.log('[WeeklyAggregator] 已启动，每周一 03:00 触发')
}

/** 停止调度器（仅测试用） */
export function stopWeeklyAggregatorScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle)
    schedulerHandle = null
  }
}

/** 为所有活跃用户聚合上周周报并缓存 */
export async function aggregateForAllUsers(): Promise<number> {
  const since = new Date(Date.now() - 14 * 864e5)
  // 活跃用户：近 14 天有 user 消息的用户（经 chatSessions → messages 链路过滤）
  const users = await prisma.user.findMany({
    where: { chatSessions: { some: { messages: { some: { role: 'user', createdAt: { gte: since } } } } } },
    select: { id: true },
    take: 500,
  })
  let ok = 0
  for (const u of users) {
    try {
      await aggregateForUser(u.id)
      ok += 1
    } catch (err) {
      console.error(`[WeeklyAggregator] 用户 ${u.id} 聚合失败:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`[WeeklyAggregator] 完成，缓存 ${ok}/${users.length} 位用户的上周周报`)
  return ok
}

/** 为单个用户聚合上周周报 → Fragment 缓存（幂等） */
export async function aggregateForUser(userId: string): Promise<{ id: string; userId: string; note: string }> {
  const report = await buildWeeklyReport(userId, 1)
  const note = `week:${report.range.start}`
  const exists = await prisma.fragment.findFirst({ where: { userId, kind: 'weekly_report', note } })
  if (exists) return { id: exists.id, userId, note }
  const id = `wr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  await prisma.$executeRaw`INSERT INTO fragments (id, userId, content, kind, tags, sourceMsgId, digested, note, createdAt) VALUES (${id}, ${userId}, ${JSON.stringify(report)}, ${'weekly_report'}, ${JSON.stringify(['周报', '自动聚合'])}, ${null}, 1, ${note}, datetime('now'))`
  return { id, userId, note }
}
