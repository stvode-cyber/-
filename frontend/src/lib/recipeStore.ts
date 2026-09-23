/**
 * 菜谱收藏 · 数据层
 *
 * - 内置常见家常菜谱（10 道）
 * - 自定义菜谱（食材/步骤/用时/份量/难度/分类）
 * - 收藏 + 标签 + 搜索
 * - 纯 localStorage 离线可用
 */

export type RecipeCategory = 'breakfast' | 'staple' | 'meat' | 'veg' | 'soup' | 'dessert' | 'snack'
export type Difficulty = 'easy' | 'medium' | 'hard'

export interface Recipe {
  id: string
  name: string
  /** 简介 */
  desc: string
  category: RecipeCategory
  difficulty: Difficulty
  /** 烹饪时长（分钟） */
  cookTime: number
  /** 份量（人份） */
  servings: number
  /** 食材清单 */
  ingredients: string[]
  /** 烹饪步骤 */
  steps: string[]
  /** 标签 */
  tags: string[]
  source: 'builtin' | 'custom'
  createdAt: string
}

export const CATEGORY_META: Record<RecipeCategory, { label: string; emoji: string; color: string }> = {
  breakfast: { label: '早餐', emoji: '🌅', color: '#F59E0B' },
  staple: { label: '主食', emoji: '🍚', color: '#22C55E' },
  meat: { label: '荤菜', emoji: '🍖', color: '#EF4444' },
  veg: { label: '素菜', emoji: '🥬', color: '#22C55E' },
  soup: { label: '汤品', emoji: '🍲', color: '#06B6D4' },
  dessert: { label: '甜点', emoji: '🍰', color: '#EC4899' },
  snack: { label: '小食', emoji: '🍿', color: '#8B5CF6' },
}

export const DIFFICULTY_META: Record<Difficulty, { label: string; color: string }> = {
  easy: { label: '简单', color: '#22C55E' },
  medium: { label: '中等', color: '#F59E0B' },
  hard: { label: '困难', color: '#EF4444' },
}

/** 内置菜谱（10 道家常菜） */
const BUILTIN_RECIPES: Omit<Recipe, 'id' | 'source' | 'createdAt'>[] = [
  {
    name: '番茄炒蛋',
    desc: '最经典的家常菜，酸甜开胃',
    category: 'meat', difficulty: 'easy', cookTime: 10, servings: 2,
    ingredients: ['鸡蛋 3 个', '番茄 2 个', '盐 1 小勺', '糖 1 小勺', '葱花适量', '食用油 2 勺'],
    steps: ['鸡蛋打散，加少许盐', '番茄切块', '热锅下油，倒入蛋液炒至凝固盛出', '锅中下番茄翻炒出汁', '加盐、糖调味', '倒回鸡蛋翻匀，撒葱花出锅'],
    tags: ['家常', '快手', '下饭'],
  },
  {
    name: '麻婆豆腐',
    desc: '麻辣鲜香，四川经典',
    category: 'meat', difficulty: 'medium', cookTime: 20, servings: 3,
    ingredients: ['嫩豆腐 1 块', '猪肉末 100g', '豆瓣酱 1 勺', '花椒粉适量', '蒜末适量', '葱花适量', '生抽 1 勺', '水淀粉适量'],
    steps: ['豆腐切方块，焯水去豆腥', '热锅下油，爆香蒜末', '下肉末炒散变色', '加豆瓣酱炒出红油', '加水煮开，下豆腐', '加生抽调味，炖 5 分钟', '勾薄芡，撒花椒粉、葱花出锅'],
    tags: ['川菜', '辣', '下饭'],
  },
  {
    name: '红烧肉',
    desc: '肥而不腻，入口即化',
    category: 'meat', difficulty: 'medium', cookTime: 60, servings: 4,
    ingredients: ['五花肉 500g', '冰糖 30g', '生抽 2 勺', '老抽 1 勺', '料酒 2 勺', '姜片 4 片', '葱段适量', '八角 2 个', '桂皮 1 小段'],
    steps: ['五花肉切方块，焯水去血沫', '热锅下冰糖炒糖色', '下肉块翻炒上色', '加料酒、生抽、老抽', '加热水没过肉，下姜葱八角桂皮', '大火烧开转小火炖 40 分钟', '大火收汁出锅'],
    tags: ['家常', '下饭', '老少咸宜'],
  },
  {
    name: '清炒西兰花',
    desc: '清爽健康，5 分钟搞定',
    category: 'veg', difficulty: 'easy', cookTime: 5, servings: 2,
    ingredients: ['西兰花 1 个', '蒜末适量', '盐 1 小勺', '食用油 1 勺'],
    steps: ['西兰花掰小朵，洗净', '沸水焯水 30 秒捞出', '热锅下油爆香蒜末', '下西兰花翻炒', '加盐炒匀出锅'],
    tags: ['素食', '快手', '健康'],
  },
  {
    name: '皮蛋瘦肉粥',
    desc: '广东经典早餐，绵滑暖胃',
    category: 'breakfast', difficulty: 'easy', cookTime: 40, servings: 3,
    ingredients: ['大米 1 杯', '皮蛋 2 个', '瘦肉 100g', '姜丝适量', '葱花适量', '盐适量', '料酒 1 勺'],
    steps: ['大米淘净加水煮粥', '瘦肉切丝，用料酒腌制', '皮蛋切小块', '粥煮至绵稠，下肉丝煮熟', '加皮蛋、姜丝煮 5 分钟', '加盐调味，撒葱花出锅'],
    tags: ['粤菜', '早餐', '养胃'],
  },
  {
    name: '蛋炒饭',
    desc: '国民快手主食，粒粒分明',
    category: 'staple', difficulty: 'easy', cookTime: 10, servings: 1,
    ingredients: ['隔夜米饭 1 碗', '鸡蛋 2 个', '葱花适量', '盐适量', '食用油 2 勺', '生抽少许'],
    steps: ['鸡蛋打散加少许盐', '热锅下油，倒入蛋液', '蛋液半凝固下米饭快速翻炒', '炒散米饭，让米粒裹上蛋液', '加盐、生抽调味', '撒葱花出锅'],
    tags: ['主食', '快手', '剩饭利用'],
  },
  {
    name: '酸辣土豆丝',
    desc: '酸辣爽脆，开胃下饭',
    category: 'veg', difficulty: 'easy', cookTime: 10, servings: 2,
    ingredients: ['土豆 2 个', '干辣椒 3 个', '花椒少许', '醋 2 勺', '盐 1 小勺', '蒜末适量', '葱花适量'],
    steps: ['土豆切细丝，泡水去淀粉', '热锅下油，爆香干辣椒花椒', '下蒜末爆香', '下土豆丝大火快炒', '加醋、盐调味', '炒至断生，撒葱花出锅'],
    tags: ['家常', '酸辣', '下饭'],
  },
  {
    name: '紫菜蛋花汤',
    desc: '5 分钟暖汤，营养丰富',
    category: 'soup', difficulty: 'easy', cookTime: 5, servings: 2,
    ingredients: ['紫菜适量', '鸡蛋 2 个', '盐适量', '香油几滴', '葱花适量'],
    steps: ['紫菜撕碎，鸡蛋打散', '锅中加水煮开', '下紫菜煮 1 分钟', '淋入蛋液，形成蛋花', '加盐、香油调味', '撒葱花出锅'],
    tags: ['汤品', '快手', '营养'],
  },
  {
    name: '可乐鸡翅',
    desc: '甜香入味，新手必会',
    category: 'meat', difficulty: 'easy', cookTime: 30, servings: 3,
    ingredients: ['鸡翅 10 个', '可乐 1 罐', '生抽 2 勺', '老抽 1 勺', '姜片 4 片', '料酒 1 勺'],
    steps: ['鸡翅两面划刀，焯水去血沫', '热锅下油，下鸡翅煎至两面金黄', '加姜片、料酒', '加生抽、老抽上色', '倒入可乐没过鸡翅', '大火烧开转中火炖 15 分钟', '大火收汁出锅'],
    tags: ['家常', '甜口', '下饭'],
  },
  {
    name: '银耳莲子羹',
    desc: '润肺养颜，慢炖甜汤',
    category: 'dessert', difficulty: 'easy', cookTime: 60, servings: 4,
    ingredients: ['银耳 1 朵', '莲子 30g', '红枣 6 颗', '冰糖 50g', '枸杞适量', '清水适量'],
    steps: ['银耳泡发，撕小朵', '莲子泡软', '锅中加水，下银耳、莲子', '大火烧开转小火炖 40 分钟', '加红枣、冰糖煮 10 分钟', '撒枸杞关火焖 2 分钟'],
    tags: ['甜品', '养颜', '润肺'],
  },
]

/** 为内置菜谱生成稳定 id */
function builtinId(idx: number): string {
  return `br_${idx}`
}

function getBuiltinRecipes(): Recipe[] {
  return BUILTIN_RECIPES.map((r, i) => ({
    ...r,
    id: builtinId(i),
    source: 'builtin' as const,
    createdAt: `2026-01-01T00:00:0${i}.000Z`,
  }))
}

// ===== 自定义菜谱 =====

const CUSTOM_KEY = 'custom_recipes_v1'
const FAV_KEY = 'favorite_recipes_v1'

function listCustom(): Recipe[] {
  try {
    const arr = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]') as Recipe[]
    return arr.filter((r) => r && typeof r.name === 'string')
  } catch {
    return []
  }
}

function saveCustom(list: Recipe[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
}

function genId(): string {
  return `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function addCustomRecipe(input: Omit<Recipe, 'id' | 'source' | 'createdAt'>): Recipe {
  const recipe: Recipe = {
    ...input,
    id: genId(),
    source: 'custom',
    createdAt: new Date().toISOString(),
  }
  const all = listCustom()
  all.unshift(recipe)
  saveCustom(all)
  return recipe
}

export function deleteCustomRecipe(id: string) {
  saveCustom(listCustom().filter((r) => r.id !== id))
  toggleFavorite(id, false)
}

export function updateCustomRecipe(id: string, patch: Partial<Recipe>) {
  const all = listCustom()
  const idx = all.findIndex((r) => r.id === id)
  if (idx < 0) return
  all[idx] = { ...all[idx], ...patch }
  saveCustom(all)
}

// ===== 收藏 =====

function listFavorites(): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as string[]
    return new Set(arr)
  } catch {
    return new Set()
  }
}

function saveFavorites(set: Set<string>) {
  localStorage.setItem(FAV_KEY, JSON.stringify([...set]))
}

export function toggleFavorite(id: string, force?: boolean) {
  const set = listFavorites()
  if (force === true) set.add(id)
  else if (force === false) set.delete(id)
  else { set.has(id) ? set.delete(id) : set.add(id) }
  saveFavorites(set)
}

export function isFavorite(id: string): boolean {
  return listFavorites().has(id)
}

// ===== 查询 =====

export function getAllRecipes(): Recipe[] {
  return [...getBuiltinRecipes(), ...listCustom()]
}

export function getRecipesByCategory(category: RecipeCategory | 'all' | 'favorite'): Recipe[] {
  if (category === 'all') return getAllRecipes()
  if (category === 'favorite') {
    const fav = listFavorites()
    return getAllRecipes().filter((r) => fav.has(r.id))
  }
  return getAllRecipes().filter((r) => r.category === category)
}

/** 关键词搜索（菜名/食材/标签） */
export function searchRecipes(keyword: string): Recipe[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return getAllRecipes()
  return getAllRecipes().filter((r) =>
    r.name.toLowerCase().includes(kw) ||
    r.desc.toLowerCase().includes(kw) ||
    r.ingredients.some((i) => i.toLowerCase().includes(kw)) ||
    r.tags.some((t) => t.toLowerCase().includes(kw)),
  )
}

/** 统计 */
export function getRecipeStat() {
  const all = getAllRecipes()
  const custom = listCustom()
  const fav = listFavorites()
  return {
    total: all.length,
    builtin: all.length - custom.length,
    custom: custom.length,
    favorites: fav.size,
  }
}
