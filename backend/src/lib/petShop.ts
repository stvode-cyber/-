// 宠物装扮商店目录（静态配置，无需落库；用户持有/装备状态存数据库）
export type PetSlot = 'hat' | 'glasses' | 'collar' | 'toy' | 'background'
export type PetRarity = 'common' | 'rare' | 'epic'

export interface PetShopItem {
  key: string
  name: string
  desc: string
  icon: string // emoji 展示
  slot: PetSlot
  cost: number // 金币价格
  rarity: PetRarity
  // 解锁等级：宠物达到该等级才可在商店购买（默认缺省 = 1，即无门槛）。
  // 与"成长进化体系"联动——越稀有的装扮门槛越高，让升级产生实际回报。
  unlockLevel?: number
  // 背景类商品使用的着色（CSS 渐变起止色），其余为 null
  bg?: [string, string] | null
}

export const PET_SHOP_ITEMS: PetShopItem[] = [
  // ---- 帽子 ----
  { key: 'hat_cap', name: '棒球帽', desc: '日常百搭的棒球帽', icon: '🧢', slot: 'hat', cost: 20, rarity: 'common' },
  { key: 'hat_top', name: '绅士帽', desc: '瞬间变成小绅士', icon: '🎩', slot: 'hat', cost: 30, rarity: 'common' },
  { key: 'hat_crown', name: '皇冠', desc: '尊贵的象征（Lv5 解锁）', icon: '👑', slot: 'hat', cost: 120, rarity: 'epic', unlockLevel: 5 },
  // ---- 眼镜 ----
  { key: 'glass_cool', name: '墨镜', desc: '酷酷的墨镜', icon: '🕶️', slot: 'glasses', cost: 25, rarity: 'common' },
  { key: 'glass_nerd', name: '书呆子镜', desc: '萌系书呆子', icon: '🤓', slot: 'glasses', cost: 15, rarity: 'common' },
  // ---- 项圈 ----
  { key: 'collar_bow', name: '蝴蝶结', desc: '可爱蝴蝶结', icon: '🎀', slot: 'collar', cost: 18, rarity: 'common' },
  { key: 'collar_diamond', name: '钻石项圈', desc: '闪耀钻石（Lv6 解锁）', icon: '💎', slot: 'collar', cost: 150, rarity: 'epic', unlockLevel: 6 },
  // ---- 玩具 ----
  { key: 'toy_bone', name: '骨头玩具', desc: '爱不释手的骨头', icon: '🦴', slot: 'toy', cost: 22, rarity: 'common' },
  { key: 'toy_ball', name: '弹力球', desc: '滚来滚去的小球', icon: '⚽', slot: 'toy', cost: 12, rarity: 'common' },
  // ---- 背景 ----
  { key: 'bg_sakura', name: '樱花背景', desc: '粉色樱花飘落', icon: '🌸', slot: 'background', cost: 40, rarity: 'common', bg: ['#ffe3ef', '#ffd0e4'] },
  { key: 'bg_ocean', name: '海洋背景', desc: '清凉的海浪（Lv3 解锁）', icon: '🌊', slot: 'background', cost: 50, rarity: 'rare', unlockLevel: 3, bg: ['#cdeffd', '#a7d8f5'] },
  { key: 'bg_star', name: '星空背景', desc: '静谧的星空（Lv4 解锁）', icon: '🌌', slot: 'background', cost: 60, rarity: 'rare', unlockLevel: 4, bg: ['#1f2a52', '#0b1230'] },
]

export const PET_SHOP_MAP: Record<string, PetShopItem> = Object.fromEntries(
  PET_SHOP_ITEMS.map((it) => [it.key, it]),
)

export const PET_SLOTS: PetSlot[] = ['hat', 'glasses', 'collar', 'toy', 'background']

// 安全的 equipped 解析（PET 表 equipped 存 JSON 字符串）
export function parseEquipped(raw: string | null | undefined): Record<PetSlot, string | null> {
  const base: Record<PetSlot, string | null> = {
    hat: null, glasses: null, collar: null, toy: null, background: null,
  }
  if (!raw) return base
  try {
    const obj = JSON.parse(raw)
    for (const s of PET_SLOTS) {
      if (obj[s] && typeof obj[s] === 'string') base[s] = obj[s]
    }
  } catch {
    return base
  }
  return base
}
