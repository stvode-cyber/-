/**
 * 愿望清单 · 数据层
 *
 * - localStorage：愿望清单（wishlist_v1）
 * - 追踪"种草→决定→攒钱→已买"的成熟度流转
 * - 优先级（想要/需要/刚需）、预估费用、实付记录
 * - 完全本地存储，离线可用
 */

/** 状态流转：种草 → 决定 → 攒钱 → 已买 */
export type WishStatus = 'considering' | 'decided' | 'saving' | 'purchased'

/** 优先级 */
export type WishPriority = 'want' | 'need' | 'urgent'

/** 分类 */
export type WishCategory = 'digital' | 'clothing' | 'home' | 'food' | 'travel' | 'gift' | 'other'

export interface WishItem {
  id: string
  /** 名称 */
  name: string
  /** 图标 emoji */
  emoji: string
  /** 预估价格（元） */
  estimatedPrice: number
  /** 实付价格（元，已买时填写） */
  actualPrice?: number
  /** 状态 */
  status: WishStatus
  /** 优先级 */
  priority: WishPriority
  /** 分类 */
  category: WishCategory
  /** 链接（可选） */
  url?: string
  /** 备注 */
  note?: string
  /** 创建时间戳 */
  createdAt: number
  /** 购买时间戳 */
  purchasedAt?: number
}

export interface WishStat {
  /** 总数 */
  total: number
  /** 各状态数量 */
  byStatus: Record<WishStatus, number>
  /** 待购预估总额（considering + decided + saving） */
  pendingCost: number
  /** 已购实付总额 */
  spentCost: number
  /** 本月已购数 */
  purchasedThisMonth: number
  /** 攒钱中条数 */
  savingCount: number
}

/** 状态元数据 */
export const STATUS_META: Record<WishStatus, { label: string; color: string; emoji: string; order: number }> = {
  considering: { label: '种草中', color: '#A78BFA', emoji: '🌱', order: 0 },
  decided: { label: '已决定', color: '#3B82F6', emoji: '✅', order: 1 },
  saving: { label: '攒钱中', color: '#F59E0B', emoji: '🐷', order: 2 },
  purchased: { label: '已购买', color: '#10B981', emoji: '📦', order: 3 },
}

/** 优先级元数据 */
export const PRIORITY_META: Record<WishPriority, { label: string; color: string }> = {
  want: { label: '想要', color: '#A78BFA' },
  need: { label: '需要', color: '#3B82F6' },
  urgent: { label: '刚需', color: '#EF4444' },
}

/** 分类元数据 */
export const CATEGORY_META: Record<WishCategory, { label: string; emoji: string }> = {
  digital: { label: '数码', emoji: '📱' },
  clothing: { label: '服饰', emoji: '👕' },
  home: { label: '家居', emoji: '🏠' },
  food: { label: '食品', emoji: '🍔' },
  travel: { label: '旅行', emoji: '✈️' },
  gift: { label: '礼物', emoji: '🎁' },
  other: { label: '其他', emoji: '📦' },
}

/** 常用 emoji */
export const EMOJI_OPTIONS = [
  '📱', '💻', '🎧', '⌚', '📷', '🎮', '🖥️', '⌨️',
  '👕', '👟', '👜', '🕶️', '💍', '🧢', '🧥', '👗',
  '🏠', '🛋️', '🪑', '🍽️', '☕', '📚', '🎨', '🧴',
  '✈️', '🎁', '🚗', '🚲', '⚽', '🎸', '💡', '📦',
]

const KEY = 'wishlist_v1'

// ===== 日期工具 =====

function todayMonthPrefix(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ===== CRUD =====

function listAll(): WishItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as WishItem[]
    return raw.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string')
  } catch {
    return []
  }
}

function saveAll(list: WishItem[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

function genId(): string {
  return `wish_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 新增 */
export function addWish(data: Omit<WishItem, 'id' | 'createdAt'>): WishItem {
  const item: WishItem = {
    ...data,
    id: genId(),
    createdAt: Date.now(),
  }
  const all = listAll()
  all.push(item)
  saveAll(all)
  return item
}

/** 更新 */
export function updateWish(id: string, data: Partial<Omit<WishItem, 'id' | 'createdAt'>>) {
  const all = listAll()
  const idx = all.findIndex((x) => x.id === id)
  if (idx === -1) return
  all[idx] = { ...all[idx], ...data }
  saveAll(all)
}

/** 删除 */
export function deleteWish(id: string) {
  saveAll(listAll().filter((x) => x.id !== id))
}

/** 推进状态（种草→决定→攒钱→已买循环） */
export function advanceStatus(id: string): WishStatus | null {
  const all = listAll()
  const item = all.find((x) => x.id === id)
  if (!item) return null

  const flow: WishStatus[] = ['considering', 'decided', 'saving', 'purchased']
  const curIdx = flow.indexOf(item.status)
  const next = flow[(curIdx + 1) % flow.length]

  item.status = next
  if (next === 'purchased' && !item.purchasedAt) {
    item.purchasedAt = Date.now()
  }
  // 从已买退回时清除购买记录
  if (next !== 'purchased') {
    item.actualPrice = undefined
    item.purchasedAt = undefined
  }
  saveAll(all)
  return next
}

// ===== 统计 =====

export function getWishStat(): WishStat {
  const all = listAll()
  const byStatus: Record<WishStatus, number> = { considering: 0, decided: 0, saving: 0, purchased: 0 }

  let pendingCost = 0
  let spentCost = 0
  let purchasedThisMonth = 0
  const monthPrefix = todayMonthPrefix()

  for (const item of all) {
    byStatus[item.status]++
    if (item.status === 'purchased') {
      spentCost += item.actualPrice ?? item.estimatedPrice
      if (item.purchasedAt) {
        const d = new Date(item.purchasedAt)
        const pm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (pm === monthPrefix) purchasedThisMonth++
      }
    } else {
      pendingCost += item.estimatedPrice
    }
  }

  return {
    total: all.length,
    byStatus,
    pendingCost,
    spentCost,
    purchasedThisMonth,
    savingCount: byStatus.saving,
  }
}

/** 按状态分组（组内按优先级降序 → 创建时间降序） */
export function groupByStatus(): { status: WishStatus; items: WishItem[] }[] {
  const priorityOrder: WishPriority[] = ['urgent', 'need', 'want']
  const all = listAll()
  const map = new Map<WishStatus, WishItem[]>()

  for (const item of all) {
    const arr = map.get(item.status) || []
    arr.push(item)
    map.set(item.status, arr)
  }

  return (Object.keys(STATUS_META) as WishStatus[])
    .filter((s) => map.has(s))
    .map((status) => ({
      status,
      items: (map.get(status) || []).sort((a, b) => {
        const pa = priorityOrder.indexOf(a.priority)
        const pb = priorityOrder.indexOf(b.priority)
        if (pa !== pb) return pa - pb
        return b.createdAt - a.createdAt
      }),
    }))
}

/** 按分类统计支出 */
export function spendingByCategory(): { category: WishCategory; spent: number; count: number }[] {
  const all = listAll().filter((x) => x.status === 'purchased')
  const map = new Map<WishCategory, { spent: number; count: number }>()
  for (const item of all) {
    const cur = map.get(item.category) || { spent: 0, count: 0 }
    cur.spent += item.actualPrice ?? item.estimatedPrice
    cur.count++
    map.set(item.category, cur)
  }
  return Array.from(map.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.spent - a.spent)
}
