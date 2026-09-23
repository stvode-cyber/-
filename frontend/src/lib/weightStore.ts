/**
 * 体重记录 · 数据层
 *
 * - localStorage：设置（weight_settings_v1）+ 体重记录（weight_records_v1）
 * - 每天一条记录（重复记录覆盖当日），支持 BMI 计算与目标进度
 * - 完全本地存储，离线可用
 */

/** 单条体重记录（每天最多一条，重复保存为覆盖） */
export interface WeightEntry {
  /** 日期 YYYY-MM-DD */
  date: string
  /** 体重 kg（保留 1 位小数） */
  kg: number
}

export interface WeightSettings {
  /** 身高 cm（BMI 计算用），默认 0 表示未设置 */
  heightCm: number
  /** 目标体重 kg，null 表示未设置 */
  goalKg: number | null
}

export interface WeightStat {
  /** 最新一条记录（无记录为 null） */
  latest: WeightEntry | null
  /** 今日是否已记录 */
  recordedToday: boolean
  /** BMI（未设身高或无记录为 null） */
  bmi: number | null
  /** 较 7 天前变化（kg，正=增重；无对比为 null） */
  change7d: number | null
  /** 较 30 天前变化（kg；无对比为 null） */
  change30d: number | null
  /** 近 90 天最小/最大（无记录为 null） */
  minKg: number | null
  maxKg: number | null
  /** 目标进度：0-100（未设目标或无基线为 null） */
  goalProgress: number | null
  /** 距目标还差多少 kg（正=还需减，负=还需增；未设置为 null） */
  goalRemaining: number | null
  /** 首条记录（作为目标进度基线） */
  first: WeightEntry | null
  /** 近 30 天记录序列（升序，供趋势图） */
  trend: WeightEntry[]
}

const SETTINGS_KEY = 'weight_settings_v1'
const RECORDS_KEY = 'weight_records_v1'

export const DEFAULT_SETTINGS: WeightSettings = {
  heightCm: 0,
  goalKg: null,
}

/** 体重合理范围（超出拒绝保存，防误输） */
export const KG_MIN = 20
export const KG_MAX = 300

// ===== 日期工具 =====

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

// ===== 设置 =====

export function loadSettings(): WeightSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      heightCm: typeof raw.heightCm === 'number' ? raw.heightCm : 0,
      goalKg: typeof raw.goalKg === 'number' ? raw.goalKg : null,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: WeightSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

// ===== 记录 CRUD =====

/** 全部记录（按日期排序，升序） */
export function listAll(): WeightEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]') as WeightEntry[]
    return raw
      .filter((e) => e && typeof e.date === 'string' && typeof e.kg === 'number')
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

function saveAll(entries: WeightEntry[]) {
  // 仅保留最近 365 天，防止无限增长
  const cutoff = dateOffset(-365)
  const filtered = entries.filter((e) => e.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date))
  localStorage.setItem(RECORDS_KEY, JSON.stringify(filtered))
}

/** 保存体重（当日重复保存为覆盖；返回 false 表示数值非法被拒绝） */
export function saveWeight(date: string, kg: number): boolean {
  const rounded = Math.round(kg * 10) / 10
  if (!Number.isFinite(rounded) || rounded < KG_MIN || rounded > KG_MAX) return false
  const all = listAll().filter((e) => e.date !== date)
  all.push({ date, kg: rounded })
  saveAll(all)
  return true
}

/** 删除某日记录 */
export function deleteWeight(date: string) {
  saveAll(listAll().filter((e) => e.date !== date))
}

/** 获取某日记录 */
export function getWeight(date: string): WeightEntry | null {
  return listAll().find((e) => e.date === date) || null
}

// ===== BMI =====

/** 中国成人 BMI 标准：<18.5 偏瘦 / 18.5-24 正常 / 24-28 超重 / ≥28 肥胖 */
export function bmiCategory(bmi: number): { label: string; color: string } {
  if (bmi < 18.5) return { label: '偏瘦', color: '#F59E0B' }
  if (bmi < 24) return { label: '正常', color: '#10B981' }
  if (bmi < 28) return { label: '超重', color: '#F97316' }
  return { label: '肥胖', color: '#EF4444' }
}

/** 计算 BMI（身高未设置返回 null） */
export function calcBmi(kg: number, heightCm: number): number | null {
  if (!heightCm || heightCm < 80) return null
  const m = heightCm / 100
  return Math.round((kg / (m * m)) * 10) / 10
}

// ===== 统计 =====

/** 取不晚于某日期的最近一条记录（用于"较 X 天前变化"） */
function nearestBefore(entries: WeightEntry[], date: string): WeightEntry | null {
  const before = entries.filter((e) => e.date <= date)
  return before.length > 0 ? before[before.length - 1] : null
}

export function getWeightStat(): WeightStat {
  const all = listAll()
  const { heightCm, goalKg } = loadSettings()
  const today = todayStr()

  const latest = all.length > 0 ? all[all.length - 1] : null
  const recordedToday = all.some((e) => e.date === today)
  const bmi = latest ? calcBmi(latest.kg, heightCm) : null

  // 变化对比：取目标日期（含）之前最近一条，与最新一条对比
  const ref7 = all.length >= 2 ? nearestBefore(all, dateOffset(-7)) : null
  const ref30 = all.length >= 2 ? nearestBefore(all, dateOffset(-30)) : null
  const change7d = latest && ref7 && ref7.date !== latest.date
    ? Math.round((latest.kg - ref7.kg) * 10) / 10
    : null
  const change30d = latest && ref30 && ref30.date !== latest.date
    ? Math.round((latest.kg - ref30.kg) * 10) / 10
    : null

  // 近 90 天范围
  const cutoff90 = dateOffset(-90)
  const recent90 = all.filter((e) => e.date >= cutoff90)
  const minKg = recent90.length > 0 ? Math.min(...recent90.map((e) => e.kg)) : null
  const maxKg = recent90.length > 0 ? Math.max(...recent90.map((e) => e.kg)) : null

  // 目标进度：以首条记录为基线
  const first = all.length > 0 ? all[0] : null
  let goalProgress: number | null = null
  let goalRemaining: number | null = null
  if (goalKg && latest && first) {
    goalRemaining = Math.round((latest.kg - goalKg) * 10) / 10
    const totalDiff = first.kg - goalKg
    if (Math.abs(totalDiff) >= 0.1) {
      const done = first.kg - latest.kg
      goalProgress = Math.max(0, Math.min(100, Math.round((done / totalDiff) * 100)))
    } else {
      goalProgress = 100 // 基线即目标
    }
  }

  // 近 30 天趋势
  const cutoff30 = dateOffset(-30)
  const trend = all.filter((e) => e.date >= cutoff30)

  return {
    latest,
    recordedToday,
    bmi,
    change7d,
    change30d,
    minKg,
    maxKg,
    goalProgress,
    goalRemaining,
    first,
    trend,
  }
}
