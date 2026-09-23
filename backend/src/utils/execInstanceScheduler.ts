/**
 * Worker 心跳超时清理调度器
 *
 * 设计要点：
 * 1. Worker 默认每 30s 发一次 heartbeat（CONFIG.heartbeatInterval=30000）
 * 2. 超时阈值 5min（10 倍余量，容忍网络抖动 / Worker 短暂卡死）
 * 3. 每 60s 扫一次 → 将 status=online AND lastHeartbeat < now-5min 的 → 置 offline
 * 4. 已 revoked / bound=false 的不动
 * 5. 沿用 countdown.lib.ts 的 setInterval + unref() 模式，不引入 node-cron
 *
 * 为什么需要这个：
 * - Worker 被 kill / 电脑休眠 / 网络断开后，DB 里 ExecInstance 还停留在 status=online
 * - 前端 RemoteAccessPage 「远程节点」Tab 显示的在线徽标会误导用户
 * - 超时清理保证 UI 状态真实
 */
import { prisma } from '../lib/prisma.js'

// TODO: [Prisma SQLite DateTime 字符串比较失效] 预防：Prisma + SQLite 时间戳比较必须用 raw SQL 的 CAST(column AS INTEGER) 或 datetime(column,'unixepoch') 函数，不能直接用 Prisma Client 的 lt/gt: new Date(...)——驱动把 DateTime 存为 INTEGER 毫秒但 Client 比较时传 ISO8601 字符串，错位导致永远 false/true

const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000 // 5 分钟
const SCAN_INTERVAL_MS = 60_000 // 每 60s 扫一次

let schedulerHandle: NodeJS.Timeout | null = null

export function startExecInstanceScheduler(intervalMs: number = SCAN_INTERVAL_MS): void {
  if (schedulerHandle) return
  console.log('[ExecInstanceScheduler] 心跳超时清理调度器启动（阈值 5min，扫描间隔 60s）')
  schedulerHandle = setInterval(async () => {
    try {
      // Prisma SQLite 上 DateTime 列存为 INTEGER 毫秒时间戳
      // 必须用 strftime('%s','now') 返回秒级 unix timestamp 做数值比较
      // 用 datetime('now') 会返回 TEXT 格式，和 INTEGER 列字符串比较永远错
      const cutoffSec = Math.floor((Date.now() - HEARTBEAT_TIMEOUT_MS) / 1000)
      const result = await prisma.$executeRawUnsafe(
        `UPDATE exec_instances SET status='offline' WHERE status='online' AND bound=1 AND revoked=0 AND CAST(lastHeartbeat AS INTEGER)/1000 < ${cutoffSec}`,
      )
      // $executeRawUnsafe 返回受影响行数（SQLite）
      if (typeof result === 'number' && result > 0) {
        console.log(`[ExecInstanceScheduler] 清理 ${result} 个超时离线的 Worker（心跳 > 5min）`)
      }
    } catch (err) {
      console.error('[ExecInstanceScheduler] 扫描失败:', err instanceof Error ? err.message : err)
    }
  }, intervalMs)
  // unref() — 不阻塞进程退出（Electron 主进程 / 服务器进程退出时自动清理）
  schedulerHandle.unref?.()
}

export function stopExecInstanceScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle)
    schedulerHandle = null
    console.log('[ExecInstanceScheduler] 已停止')
  }
}
