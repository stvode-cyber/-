/**
 * 等级系统工具
 * 对标QQ等级：按累计在线时间计算
 * Level n 需要 n*(n-1)/2 * 60 分钟
 */

export interface LevelInfo {
  level: number
  totalOnlineMinutes: number
  totalOnlineHours: number
  /** 当前等级已完成的分钟数 */
  currentLevelMinutes: number
  /** 升到下一等级还需多少分钟 */
  nextLevelMinutes: number
  /** 当前等级进度百分比 0-100 */
  progress: number
  /** 等级图标 emoji */
  icon: string
  /** 等级称号 */
  title: string
}

const LEVEL_TITLES: { icon: string; title: string }[] = [
  { icon: '🌱', title: '新手' },    // Lv1-3
  { icon: '🌿', title: '成长' },    // Lv4-6
  { icon: '🌳', title: '活跃' },    // Lv7-9
  { icon: '⭐', title: '达人' },    // Lv10-12
  { icon: '🔥', title: '精英' },    // Lv13-16
  { icon: '👑', title: '传奇' },    // Lv17+
]

/** 宠物领养上限：Lv1-5 仅 1 只，之后每 6 级 +1（Lv6→2、Lv12→3 …） */
export function getMaxPets(level: number): number {
  return level < 6 ? 1 : 1 + Math.floor(level / 6)
}

/** 计算等级 */
export function calcLevel(totalOnlineMinutes: number): number {
  if (totalOnlineMinutes < 60) return 1
  // n*(n-1)/2 * 60 = totalOnlineMinutes
  // n = (1 + sqrt(1 + 4*totalOnlineMinutes/30)) / 2
  const n = Math.floor((1 + Math.sqrt(1 + (4 * totalOnlineMinutes) / 30)) / 2)
  return Math.max(1, n)
}

/** 获取等级信息 */
export function getLevelInfo(totalOnlineMinutes: number): LevelInfo {
  const level = calcLevel(totalOnlineMinutes)
  const currentLevelStart = (level * (level - 1) / 2) * 60
  const nextLevelStart = (level * (level + 1) / 2) * 60
  const currentLevelMinutes = totalOnlineMinutes - currentLevelStart
  const nextLevelMinutes = nextLevelStart - totalOnlineMinutes
  const progress = Math.round((currentLevelMinutes / (nextLevelStart - currentLevelStart)) * 100)

  const titleIdx = Math.min(Math.floor((level - 1) / 3), LEVEL_TITLES.length - 1)
  const { icon, title } = LEVEL_TITLES[titleIdx]

  return {
    level,
    totalOnlineMinutes,
    totalOnlineHours: Math.round(totalOnlineMinutes / 60 * 10) / 10,
    currentLevelMinutes,
    nextLevelMinutes,
    progress: Math.min(100, Math.max(0, progress)),
    icon,
    title,
  }
}
