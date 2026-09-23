/**
 * 纪念日管理 · 数据层
 *
 * - localStorage：纪念日列表（anniversaries_v1）
 * - 区别于「倒计时」：倒计时是一次性未来事件；纪念日是每年循环的生日/结婚纪念日等
 * - 计算：第几个纪念日 + 下次到来的日期 + 倒计时天数
 * - 完全本地存储，离线可用
 */

/** 纪念日类型 */
export type AnniversaryType = 'birthday' | 'wedding' | 'relationship' | 'memorial' | 'meeting' | 'custom'

export interface Anniversary {
  /** 唯一 id */
  id: string
  /** 名称（如：妈妈、我们的婚礼） */
  name: string
  /** 图标 emoji */
  emoji: string
  /** 原始日期 YYYY-MM-DD（公历） */
  date: string
  /** 类型 */
  type: AnniversaryType
  /** 备注（可选） */
  note?: string
  /** 创建时间戳 */
  createdAt: number
}

export interface AnniversaryWithNext {
  anniversary: Anniversary
  /** 下次到来日期 YYYY-MM-DD */
  nextDate: string
  /** 距今天数（0=今天，负数=已过当前年份下次才到，正数=未来） */
  daysLeft: number
  /** 第几个纪念日（年数，如结婚 10 周年） */
  yearsCount: number
  /** 是否今天就是纪念日 */
  isToday: boolean
}

export interface AnniversaryStat {
  total: number
  /** 最近 30 天内到来（升序，含今天） */
  upcoming: AnniversaryWithNext[]
  /** 今天有纪念日 */
  todayCount: number
  /** 7 天内到来条数 */
  weekCount: number
  /** 下一个到来的纪念日（最近的，可能已过当前年） */
  nextOne: AnniversaryWithNext | null
}

/** 类型元数据：标签 + emoji + 主题色 */
export const TYPE_META: Record<AnniversaryType, { label: string; defaultEmoji: string; color: string }> = {
  birthday: { label: '生日', defaultEmoji: '🎂', color: '#EC4899' },
  wedding: { label: '结婚纪念', defaultEmoji: '💍', color: '#F43F5E' },
  relationship: { label: '恋爱纪念', defaultEmoji: '❤️', color: '#EF4444' },
  memorial: { label: '悼念', defaultEmoji: '🕊️', color: '#64748B' },
  meeting: { label: '相识', defaultEmoji: '🤝', color: '#0EA5E9' },
  custom: { label: '自定义', defaultEmoji: '🎉', color: '#8B5CF6' },
}

const KEY = 'anniversaries_v1'

// ===== 日期工具 =====

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 闰年判断 */
function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** 该年某月的天数 */
function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28
  return [4, 6, 9, 11].includes(m) ? 30 : 31
}

/**
 * 计算某纪念日在给定年份的"该年到来日"
 * 特殊处理 2 月 29 日：非闰年取 2 月 28 日
 */
function occurrenceInYear(date: string, year: number): string {
  const [, m, d] = date.split('-').map(Number)
  const day = (m === 2 && d === 29 && !isLeapYear(year)) ? 28 : d
  return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(day, daysInMonth(year, m))).padStart(2, '0')}`
}

/** 日期差：today - date 的天数 */
function daysUntil(date: string): number {
  const a = new Date(todayStr() + 'T00:00:00').getTime()
  const b = new Date(date + 'T00:00:00').getTime()
  return Math.round((b - a) / 86400000)
}

/**
 * 计算某纪念日的下次到来信息
 * - 若今年还未到来（含今天）→ 今年，yearsCount = 今年-原始年
 * - 若今年已过 → 明年，yearsCount = 明年-原始年
 */
export function calcNext(aniv: Anniversary): AnniversaryWithNext {
  const today = todayStr()
  const origYear = Number(aniv.date.slice(0, 4))
  const thisYear = Number(today.slice(0, 4))

  const thisYearOccur = occurrenceInYear(aniv.date, thisYear)
  const d = daysUntil(thisYearOccur)

  let nextDate: string
  let yearsCount: number

  if (d >= 0) {
    // 今年还未到或就是今天
    nextDate = thisYearOccur
    yearsCount = thisYear - origYear
  } else {
    // 今年已过，下次是明年
    nextDate = occurrenceInYear(aniv.date, thisYear + 1)
    yearsCount = thisYear + 1 - origYear
  }

  return {
    anniversary: aniv,
    nextDate,
    daysLeft: daysUntil(nextDate),
    yearsCount: Math.max(0, yearsCount),
    isToday: nextDate === today && d === 0,
  }
}

// ===== CRUD =====

function listAll(): Anniversary[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]') as Anniversary[]
    return raw.filter((a) => a && typeof a.id === 'string' && typeof a.date === 'string')
  } catch {
    return []
  }
}

function saveAll(list: Anniversary[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

function genId(): string {
  return `aniv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 新增纪念日（date 必须是过去或今天） */
export function addAniv(data: Omit<Anniversary, 'id' | 'createdAt'>): Anniversary {
  const aniv: Anniversary = {
    ...data,
    id: genId(),
    createdAt: Date.now(),
  }
  const all = listAll()
  all.push(aniv)
  saveAll(all)
  return aniv
}

/** 更新纪念日 */
export function updateAniv(id: string, data: Omit<Anniversary, 'id' | 'createdAt'>) {
  const all = listAll()
  const idx = all.findIndex((a) => a.id === id)
  if (idx === -1) return
  all[idx] = { ...all[idx], ...data }
  saveAll(all)
}

/** 删除纪念日 */
export function deleteAniv(id: string) {
  saveAll(listAll().filter((a) => a.id !== id))
}

// ===== 统计 =====

/** 全部纪念日 + 下次到来信息，按距今天数升序 */
export function listWithNext(): AnniversaryWithNext[] {
  return listAll()
    .map(calcNext)
    .sort((a, b) => a.daysLeft - b.daysLeft)
}

export function getAnivStat(): AnniversaryStat {
  const all = listWithNext()
  const today = todayStr()

  const upcoming = all.filter((x) => x.daysLeft >= 0 && x.daysLeft <= 30)

  return {
    total: all.length,
    upcoming,
    todayCount: all.filter((x) => x.nextDate === today).length,
    weekCount: all.filter((x) => x.daysLeft >= 0 && x.daysLeft <= 7).length,
    nextOne: all.length > 0 ? all[0] : null,
  }
}

/** 按类型分组（带下次到来） */
export function groupByType(): { type: AnniversaryType; items: AnniversaryWithNext[] }[] {
  const all = listWithNext()
  const map = new Map<AnniversaryType, AnniversaryWithNext[]>()
  all.forEach((x) => {
    const arr = map.get(x.anniversary.type) || []
    arr.push(x)
    map.set(x.anniversary.type, arr)
  })
  return Array.from(map.entries())
    .map(([type, items]) => ({ type, items }))
    .sort((a, b) => {
      // 按类型预设顺序
      const order: AnniversaryType[] = ['birthday', 'wedding', 'relationship', 'meeting', 'memorial', 'custom']
      return order.indexOf(a.type) - order.indexOf(b.type)
    })
}
