/**
 * FetchJob 超时清理调度器
 *
 * 设计要点：
 * 1. pending > 10min 没被 Worker confirm → 自动 rejected（发起者可能已取消 / Worker 离线）
 * 2. dispatched > 30min 没 execute done → 自动 failed（Worker 拿了任务但没执行完，大概率崩了）
 * 3. 每 60s 扫一次，两个 update 同事务执行
 * 4. 同样用 SQLite 原生 datetime() 避开 Prisma DateTime 序列化坑（见 execInstanceScheduler.ts）
 */
import { prisma } from '../lib/prisma.js'

// TODO: [Prisma SQLite DateTime 字符串比较失效] 预防：Prisma + SQLite 时间戳比较必须用 raw SQL 的 CAST(column AS INTEGER) 或 datetime(column,'unixepoch') 函数，不能直接用 Prisma Client 的 lt/gt: new Date(...)——驱动把 DateTime 存为 INTEGER 毫秒但 Client 比较时传 ISO8601 字符串，错位导致永远 false/true

const PENDING_TIMEOUT_MIN = 10
const DISPATCHED_TIMEOUT_MIN = 30
const SCAN_INTERVAL_MS = 60_000

let schedulerHandle: NodeJS.Timeout | null = null

export function startFetchJobScheduler(intervalMs: number = SCAN_INTERVAL_MS): void {
  if (schedulerHandle) return
  console.log(
    `[FetchJobScheduler] 超时清理启动（pending>${PENDING_TIMEOUT_MIN}min→rejected, dispatched>${DISPATCHED_TIMEOUT_MIN}min→failed，扫描 60s）`,
  )
  schedulerHandle = setInterval(async () => {
    try {
      // 1. pending 超时 → rejected
      const r1 = await prisma.$executeRawUnsafe(
        `UPDATE fetch_jobs SET status='rejected', finishedAt=datetime('now'), errorMsg='任务超时：Worker 未在 ${PENDING_TIMEOUT_MIN}min 内确认' WHERE status='pending' AND requestedAt < datetime('now','-${PENDING_TIMEOUT_MIN} minutes')`,
      )
      if (typeof r1 === 'number' && r1 > 0) {
        console.log(`[FetchJobScheduler] 清理 ${r1} 个 pending 超时任务`)
      }

      // 2. dispatched 超时 → failed
      const r2 = await prisma.$executeRawUnsafe(
        `UPDATE fetch_jobs SET status='failed', finishedAt=datetime('now'), errorMsg='任务超时：Worker 拿了任务但 ${DISPATCHED_TIMEOUT_MIN}min 内未完成' WHERE status='dispatched' AND dispatchedAt < datetime('now','-${DISPATCHED_TIMEOUT_MIN} minutes')`,
      )
      if (typeof r2 === 'number' && r2 > 0) {
        console.log(`[FetchJobScheduler] 清理 ${r2} 个 dispatched 超时任务`)
      }
    } catch (err) {
      console.error('[FetchJobScheduler] 扫描失败:', err instanceof Error ? err.message : err)
    }
  }, intervalMs)
  schedulerHandle.unref?.()
}

export function stopFetchJobScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle)
    schedulerHandle = null
    console.log('[FetchJobScheduler] 已停止')
  }
}
