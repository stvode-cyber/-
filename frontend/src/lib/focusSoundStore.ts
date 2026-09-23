/**
 * 专注音景 · 数据层
 *
 * - 8 个合成音景场景（雨/海浪/森林/篝火/风/咖啡馆/夜虫/白噪音）
 * - 收藏混音（多音源 + 音量）
 * - 定时停止设置
 * - 纯 localStorage 离线可用（音频通过 Web Audio API 合成）
 */

export type SoundSceneId = 'rain' | 'ocean' | 'forest' | 'fire' | 'wind' | 'cafe' | 'night' | 'white'

export interface SoundScene {
  id: SoundSceneId
  label: string
  emoji: string
  color: string
  description: string
}

export const SCENES: SoundScene[] = [
  { id: 'rain', label: '雨声', emoji: '🌧️', color: '#3B82F6', description: '淅淅沥沥的细雨' },
  { id: 'ocean', label: '海浪', emoji: '🌊', color: '#06B6D4', description: '潮起潮落的海浪' },
  { id: 'forest', label: '森林', emoji: '🌲', color: '#22C55E', description: '林间风声与鸟鸣' },
  { id: 'fire', label: '篝火', emoji: '🔥', color: '#F59E0B', description: '噼啪作响的篝火' },
  { id: 'wind', label: '风声', emoji: '🍃', color: '#8B5CF6', description: '轻拂而过的微风' },
  { id: 'cafe', label: '咖啡馆', emoji: '☕', color: '#A1887F', description: '嘈杂而温暖的人声' },
  { id: 'night', label: '夜虫', emoji: '🌙', color: '#1E40AF', description: '夏夜虫鸣与蛙声' },
  { id: 'white', label: '白噪音', emoji: '⚪', color: '#64748B', description: '纯净的白噪' },
]

export const SCENE_MAP: Record<SoundSceneId, SoundScene> = SCENES.reduce((m, s) => {
  m[s.id] = s
  return m
}, {} as Record<SoundSceneId, SoundScene>)

/** 一个混音项：场景 + 音量（0-1） */
export interface MixItem {
  scene: SoundSceneId
  volume: number
}

/** 收藏的混音 */
export interface SavedMix {
  id: string
  name: string
  items: MixItem[]
  createdAt: string
}

const MIX_KEY = 'saved_mixes_v1'
const TIMER_KEY = 'focus_sound_timer_min'

/** 读取所有收藏混音 */
export function listMixes(): SavedMix[] {
  try {
    const arr = JSON.parse(localStorage.getItem(MIX_KEY) || '[]') as SavedMix[]
    return arr.filter((m) => m && Array.isArray(m.items) && m.items.length > 0)
  } catch {
    return []
  }
}

function saveMixes(list: SavedMix[]) {
  localStorage.setItem(MIX_KEY, JSON.stringify(list))
}

function genId(): string {
  return `mix_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 添加混音 */
export function addMix(name: string, items: MixItem[]): SavedMix {
  const mix: SavedMix = {
    id: genId(),
    name: name.trim() || '我的混音',
    items: items.filter((i) => i.volume > 0),
    createdAt: new Date().toISOString(),
  }
  const all = listMixes()
  all.push(mix)
  saveMixes(all)
  return mix
}

/** 删除混音 */
export function deleteMix(id: string) {
  saveMixes(listMixes().filter((m) => m.id !== id))
}

/** 定时器（分钟，0 = 不定时） */
export function getTimerMin(): number {
  try {
    const v = parseInt(localStorage.getItem(TIMER_KEY) || '0', 10)
    return isNaN(v) ? 0 : v
  } catch {
    return 0
  }
}

export function setTimerMin(min: number) {
  localStorage.setItem(TIMER_KEY, String(min))
}

/** 统计 */
export function getStat() {
  return {
    scenes: SCENES.length,
    mixes: listMixes().length,
  }
}
