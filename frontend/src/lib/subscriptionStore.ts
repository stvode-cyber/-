/**
 * 订阅管理 · 数据层
 *
 * - localStorage：订阅列表（subscriptions_v1）
 * - 周期性费用（会员/软件/服务等）：费用 + 周期 + 下次续费日
 * - 月均/年度成本折算、即将续费提醒、到期自动顺延
 * - 完全本地存储，离线可用
 */

/** 订阅周期 */
export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface Subscription {
  /** 唯一 id */
  id: string
  /** 名称 */
  name: string
  /** 图标 emoji */
  emoji: string
  /** 每周期费用（元） */
  cost: number
  /** 周期 */
  cycle: BillingCycle
  /** 下次续费日 YYYY-MM-DD */
  nextRenewal: string
  /** 是否生效（暂停的不计入统计） */
  active: boolean
  /** 备注 */
  note?: string
  /** 创建时间戳 */
  createdAt: number
}

export interface SubscriptionStat {
  /** 生效订阅数 */
  activeCount: number
  /** 暂停订阅数 */
  pausedCount: number
  /** 月均成本（元，按周期折算，保留 1 位） */
  monthlyCost: number
  /** 年度成本（元） */
  yearlyCost: number
  /** 未来 30 天内续费（升序，含已过期） */
  upcoming: { sub: Subscription; daysLeft: number }[]
  /** 未来 7 天内续费条数（含已过期） */
  urgentCount: number
  /** 已过期未续费条数 */
  overdueCount: number
}

/** 周期元数据：天数（月按 30.44、年按 365 折算）与标签 */
export const CYCLE_META: Record<BillingCycle, { label: string; days: number }> = {
  weekly: { label: '每周', days: 7 },
  monthly: { label: '每月', days: 30.44 },
  quarterly: { label: '每季', days: 91.31 },
  yearly: { label: '每年', days: 365 },
}

/** 常用订阅图标建议（增改时快捷选择） */
export const EMOJI_OPTIONS = [
  '📺', '🎵', '🎬', '🎮', '☁️', '💻', '📱', '🛠️', '📚', '🍔',
  '🚗', '✈️', '🏋️', '📦', '💳', '🌐', '🎧', '📰', '🎨', '⚙️',
]

const KEY = 'subscriptions_v1'

// ===== 日期工具 =====

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 日期差：today - date 的天数（正=未来，负=已过去） */
export function daysUntil(date: string): number {
  const a = new Date(todayStr() + 'T00:00:00').getTime()
  const b = new Date(date + 'T00:00:00').getTime()
  return Math.round((b - a) / 86400000)
}

/** 从某日起加一个周期，得到下次续费日 */
function plusCycle(date: string, cycle: BillingCycle): string {
  const d = new Date(date + 'T00:00:00')
  switch (cycle) {
    case 'weekly': d.setDate(d.getDate() + 7); break
    case 'monthly': d.setMonth(d.getMonth() + 1); break
    case 'quarterly': d.setMonth(d.getMonth() + 3); break
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break
  }
  return todayStr(d)
}

// ===== CRUD =====

function listAll(): Subscription[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as Subscription[]
    return raw.filter((s) => s && typeof s.id === 'string' && typeof s.cost === 'number')
  } catch {
    return []
  }
}

function saveAll(list: Subscription[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

function genId(): string {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 新增订阅（nextRenewal 缺省 = 今天加一个周期） */
export function addSub(data: Omit<Subscription, 'id' | 'createdAt'>): Subscription {
  const sub: Subscription = {
    ...data,
    nextRenewal: data.nextRenewal || plusCycle(todayStr(), data.cycle),
    id: genId(),
    createdAt: Date.now(),
  }
  const all = listAll()
  all.push(sub)
  saveAll(all)
  return sub
}

/** 更新订阅（按 id 全量覆盖字段） */
export function updateSub(id: string, data: Omit<Subscription, 'id' | 'createdAt'>) {
  const all = listAll()
  const idx = all.findIndex((s) => s.id === id)
  if (idx === -1) return
  all[idx] = { ...all[idx], ...data }
  saveAll(all)
}

/** 删除订阅 */
export function deleteSub(id: string) {
  saveAll(listAll().filter((s) => s.id !== id))
}

/** 切换生效/暂停 */
export function toggleActive(id: string) {
  const all = listAll()
  const sub = all.find((s) => s.id === id)
  if (!sub) return
  sub.active = !sub.active
  saveAll(all)
}

/**
 * 标记已续费：续费日顺延一个周期；若已过期多周期则顺延到未来最近一期
 * 返回新的续费日
 */
export function markRenewed(id: string): string | null {
  const all = listAll()
  const sub = all.find((s) => s.id === id)
  if (!sub) return null
  let next = plusCycle(sub.nextRenewal, sub.cycle)
  // 若仍在过去（漏记多期），顺延到 >= 今天
  while (daysUntil(next) < 0) next = plusCycle(next, sub.cycle)
  sub.nextRenewal = next
  saveAll(all)
  return next
}

// ===== 统计 =====

/** 单条订阅的月均费用 */
export function monthlyEquivalent(sub: Subscription): number {
  return (sub.cost / CYCLE_META[sub.cycle].days) * 30.44
}

export function getSubStat(): SubscriptionStat {
  const all = listAll()
  const active = all.filter((s) => s.active)

  const monthlyCost = active.reduce((s, x) => s + monthlyEquivalent(x), 0)

  // 即将续费：生效订阅按续费日升序，含已过期（daysLeft < 0）
  const upcoming = active
    .map((sub) => ({ sub, daysLeft: daysUntil(sub.nextRenewal) }))
    .filter((x) => x.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)

  return {
    activeCount: active.length,
    pausedCount: all.length - active.length,
    monthlyCost: Math.round(monthlyCost * 10) / 10,
    yearlyCost: Math.round(monthlyCost * 12),
    upcoming,
    urgentCount: upcoming.filter((x) => x.daysLeft <= 7).length,
    overdueCount: upcoming.filter((x) => x.daysLeft < 0).length,
  }
}

/** 全部订阅（生效在前，同组按续费日升序），供列表渲染 */
export function listSorted(): Subscription[] {
  return listAll().sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return a.nextRenewal.localeCompare(b.nextRenewal)
  })
}
