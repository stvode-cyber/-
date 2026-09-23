// ============================================================
// P4+：A/B 语料池效果统计
// 口径：
// - 曝光（greetingCount）：期间问候消息数，桶位取消息 metadata.abBucket
//   写入时快照（bucketOf 当时值），历史准确不受后续配置改动影响
// - 回复率（replyRate）：问候后 24h 内同会话出现用户消息的比例（互动质量核心指标）
// - 活跃/人均消息/记账/待办完成：期间业务数据按当前 bucketOf(userId) 分桶
// 说明：埋点（abBucket 字段）上线前的问候消息不计入曝光，属预期口径
// ============================================================
import { prisma } from '../lib/prisma.js'
import { bucketOf, getAgentConfig } from './agentConfig.js'

const REPLY_WINDOW_MS = 24 * 3600 * 1000

/** 单桶统计指标 */
export interface AbBucketStats {
  bucket: 'A' | 'B'
  greetingCount: number
  /** 回复率百分比（保留 1 位小数）；无曝光时为 null */
  replyRate: number | null
  activeUsers: number
  /** 活跃用户人均消息数（保留 1 位小数）；无活跃用户时为 null */
  msgPerActiveUser: number | null
  billCount: number
  taskDone: number
}

/** A/B 统计结果 */
export interface AbStatsResult {
  days: number
  abEnabled: boolean
  hasBPools: boolean
  since: string
  /** 埋点上线前的老问候数（未计入曝光，口径提示用） */
  legacySkipped: number
  buckets: [AbBucketStats, AbBucketStats]
}

/** 计算指定天数窗口内 A/B 双桶效果指标 */
export async function buildAbStats(days = 14): Promise<AbStatsResult> {
  const since = new Date(Date.now() - days * 864e5)
  const cfg = getAgentConfig()

  // 1. 期间问候消息（含 abBucket 快照）+ 用户消息 + 业务数据，并行拉取
  const [greetings, userMsgs, bills, doneTasks] = await Promise.all([
    prisma.message.findMany({
      where: { role: 'assistant', createdAt: { gte: since }, metadata: { contains: '"greeting":true' } },
      select: { sessionId: true, createdAt: true, metadata: true },
    }),
    prisma.message.findMany({
      where: { role: 'user', createdAt: { gte: since } },
      select: { sessionId: true, userId: true, createdAt: true },
    }),
    prisma.bill.findMany({ where: { createdAt: { gte: since } }, select: { userId: true } }),
    prisma.task.findMany({ where: { status: 'done', updatedAt: { gte: since } }, select: { userId: true } }),
  ])

  // 2. 曝光 + 回复率（按 metadata.abBucket 快照分桶；无快照的埋点前老数据丢弃，不入任何桶）
  const exposure: Record<'A' | 'B', number> = { A: 0, B: 0 }
  const replied: Record<'A' | 'B', number> = { A: 0, B: 0 }
  let legacySkipped = 0
  // 按 session 建用户消息时间索引，加速"问候后 24h 内有无回复"匹配
  const userMsgsBySession = new Map<string, number[]>()
  for (const m of userMsgs) {
    if (!userMsgsBySession.has(m.sessionId)) userMsgsBySession.set(m.sessionId, [])
    userMsgsBySession.get(m.sessionId)!.push(m.createdAt.getTime())
  }
  for (const g of greetings) {
    const meta = JSON.parse(g.metadata || '{}') as { abBucket?: 'A' | 'B' }
    const b: 'A' | 'B' | null = meta.abBucket === 'A' || meta.abBucket === 'B' ? meta.abBucket : null
    if (!b) {
      legacySkipped += 1
      continue
    }
    exposure[b] += 1
    const times = (userMsgsBySession.get(g.sessionId) || []).filter((t) => t >= g.createdAt.getTime())
    if (times.length > 0 && Math.min(...times) - g.createdAt.getTime() <= REPLY_WINDOW_MS) {
      replied[b] += 1
    }
  }

  // 3. 活跃/人均消息/记账/待办（按当前 bucketOf 分桶）
  const msgCount: Record<'A' | 'B', number> = { A: 0, B: 0 }
  const activeUsers: Record<'A' | 'B', Set<string>> = { A: new Set(), B: new Set() }
  for (const m of userMsgs) {
    const b = bucketOf(m.userId)
    msgCount[b] += 1
    activeUsers[b].add(m.userId)
  }
  const billCount: Record<'A' | 'B', number> = { A: 0, B: 0 }
  for (const b of bills) billCount[bucketOf(b.userId)] += 1
  const taskDone: Record<'A' | 'B', number> = { A: 0, B: 0 }
  for (const t of doneTasks) taskDone[bucketOf(t.userId)] += 1

  const mk = (b: 'A' | 'B'): AbBucketStats => ({
    bucket: b,
    greetingCount: exposure[b],
    replyRate: exposure[b] > 0 ? Math.round((replied[b] / exposure[b]) * 1000) / 10 : null, // 百分比保留 1 位
    activeUsers: activeUsers[b].size,
    msgPerActiveUser: activeUsers[b].size > 0 ? Math.round((msgCount[b] / activeUsers[b].size) * 10) / 10 : null,
    billCount: billCount[b],
    taskDone: taskDone[b],
  })

  return {
    days,
    abEnabled: !!cfg.abTest?.enabled,
    hasBPools: !!(cfg.greeting.B || cfg.weeklyNotes.B),
    since: since.toISOString(),
    legacySkipped, // 埋点上线前的老问候数（未计入曝光，口径提示用）
    buckets: [mk('A'), mk('B')],
  }
}
