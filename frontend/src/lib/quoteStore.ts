/**
 * 每日金句 · 数据层
 *
 * - 内置名言库（约 60 条，6 大分类）
 * - 每日一签（按日期确定性选取，同一天固定同一句）
 * - 个人收藏 + 自定义金句
 * - 纯 localStorage 离线可用
 */

/** 分类 */
export type QuoteCategory = 'life' | 'motivate' | 'love' | 'wisdom' | 'success' | 'nature'

export interface Quote {
  id: string
  text: string
  author: string
  category: QuoteCategory
  /** 来源标记：built-in / custom */
  source: 'builtin' | 'custom'
}

export const CATEGORY_META: Record<QuoteCategory, { label: string; emoji: string; color: string }> = {
  life: { label: '人生', emoji: '🌅', color: '#3B82F6' },
  motivate: { label: '励志', emoji: '🔥', color: '#EF4444' },
  love: { label: '爱情', emoji: '❤️', color: '#EC4899' },
  wisdom: { label: '智慧', emoji: '💡', color: '#8B5CF6' },
  success: { label: '成功', emoji: '🏆', color: '#F59E0B' },
  nature: { label: '自然', emoji: '🌿', color: '#22C55E' },
}

/** 内置名言库 */
const BUILTIN_QUOTES: Omit<Quote, 'id' | 'source'>[] = [
  // 人生
  { text: '人的一生，是很短的，短暂的岁月要求我们好好领会。', author: '契诃夫', category: 'life' },
  { text: '人生就像一盒巧克力，你永远不知道下一颗是什么味道。', author: '《阿甘正传》', category: 'life' },
  { text: '生活不止眼前的苟且，还有诗和远方的田野。', author: '高晓松', category: 'life' },
  { text: '人生须知负责任的苦处，才能知道尽责任的乐趣。', author: '梁启超', category: 'life' },
  { text: '人生的价值，并不是用时间，而是用深度去衡量的。', author: '列夫·托尔斯泰', category: 'life' },
  { text: '世上只有一种英雄主义，就是在认清生活真相之后依然热爱生活。', author: '罗曼·罗兰', category: 'life' },
  { text: '人生不售来回票，一旦动身，绝不能复返。', author: '罗曼·罗兰', category: 'life' },
  { text: '生命不是要超越别人，而是要超越自己。', author: '德上海', category: 'life' },
  { text: '人生重要的不是所站的位置，而是所朝的方向。', author: '谚语', category: 'life' },
  { text: '人的一生可能燃烧也可能腐朽，我不能腐朽，我愿意燃烧起来。', author: '奥斯特洛夫斯基', category: 'life' },

  // 励志
  { text: '天行健，君子以自强不息。', author: '《周易》', category: 'motivate' },
  { text: '长风破浪会有时，直挂云帆济沧海。', author: '李白', category: 'motivate' },
  { text: '宝剑锋从磨砺出，梅花香自苦寒来。', author: '《警世贤文》', category: 'motivate' },
  { text: '世上无难事，只要肯登攀。', author: '毛泽东', category: 'motivate' },
  { text: '路漫漫其修远兮，吾将上下而求索。', author: '屈原', category: 'motivate' },
  { text: '不积跬步，无以至千里；不积小流，无以成江海。', author: '荀子', category: 'motivate' },
  { text: '千磨万击还坚劲，任尔东西南北风。', author: '郑板桥', category: 'motivate' },
  { text: '天将降大任于斯人也，必先苦其心志，劳其筋骨。', author: '孟子', category: 'motivate' },
  { text: '业精于勤，荒于嬉；行成于思，毁于随。', author: '韩愈', category: 'motivate' },
  { text: '不飞则已，一飞冲天；不鸣则已，一鸣惊人。', author: '司马迁', category: 'motivate' },

  // 爱情
  { text: '两情若是久长时，又岂在朝朝暮暮。', author: '秦观', category: 'love' },
  { text: '衣带渐宽终不悔，为伊消得人憔悴。', author: '柳永', category: 'love' },
  { text: '人生自是有情痴，此恨不关风与月。', author: '欧阳修', category: 'love' },
  { text: '曾经沧海难为水，除却巫山不是云。', author: '元稹', category: 'love' },
  { text: '愿得一心人，白头不相离。', author: '卓文君', category: 'love' },
  { text: '生死契阔，与子成说。执子之手，与子偕老。', author: '《诗经》', category: 'love' },
  { text: '玲珑骰子安红豆，入骨相思知不知。', author: '温庭筠', category: 'love' },
  { text: '此情可待成追忆，只是当时已惘然。', author: '李商隐', category: 'love' },
  { text: '花自飘零水自流，一种相思，两处闲愁。', author: '李清照', category: 'love' },
  { text: '只愿君心似我心，定不负相思意。', author: '李之仪', category: 'love' },

  // 智慧
  { text: '知者不惑，仁者不忧，勇者不惧。', author: '孔子', category: 'wisdom' },
  { text: '三人行，必有我师焉。择其善者而从之，其不善者而改之。', author: '孔子', category: 'wisdom' },
  { text: '上善若水。水善利万物而不争，处众人之所恶，故几于道。', author: '老子', category: 'wisdom' },
  { text: '吾日三省吾身。', author: '曾子', category: 'wisdom' },
  { text: '知之者不如好之者，好之者不如乐之者。', author: '孔子', category: 'wisdom' },
  { text: '学而不思则罔，思而不学则殆。', author: '孔子', category: 'wisdom' },
  { text: '君子和而不同，小人同而不和。', author: '孔子', category: 'wisdom' },
  { text: '勿以恶小而为之，勿以善小而不为。', author: '刘备', category: 'wisdom' },
  { text: '满招损，谦受益。', author: '《尚书》', category: 'wisdom' },
  { text: '祸兮福之所倚，福兮祸之所伏。', author: '老子', category: 'wisdom' },

  // 成功
  { text: '成功不是将来才有的，而是从决定去做的那一刻起，持续累积而成。', author: '佚名', category: 'success' },
  { text: '不积跬步，无以至千里。', author: '荀子', category: 'success' },
  { text: '千里之行，始于足下。', author: '老子', category: 'success' },
  { text: '成功的秘诀，在永不改变既定的目的。', author: '卢梭', category: 'success' },
  { text: '天下事有难易乎？为之，则难者亦易矣。', author: '彭端淑', category: 'success' },
  { text: '有志者事竟成。', author: '《后汉书》', category: 'success' },
  { text: '只要功夫深，铁杵磨成针。', author: '谚语', category: 'success' },
  { text: '锲而不舍，金石可镂。', author: '荀子', category: 'success' },
  { text: '故不积跬步，无以至千里；不积小流，无以成江海。', author: '荀子', category: 'success' },
  { text: '临渊羡鱼，不如退而结网。', author: '《汉书》', category: 'success' },

  // 自然
  { text: '落霞与孤鹜齐飞，秋水共长天一色。', author: '王勃', category: 'nature' },
  { text: '明月松间照，清泉石上流。', author: '王维', category: 'nature' },
  { text: '采菊东篱下，悠然见南山。', author: '陶渊明', category: 'nature' },
  { text: '会当凌绝顶，一览众山小。', author: '杜甫', category: 'nature' },
  { text: '大漠孤烟直，长河落日圆。', author: '王维', category: 'nature' },
  { text: '日出江花红胜火，春来江水绿如蓝。', author: '白居易', category: 'nature' },
  { text: '疏影横斜水清浅，暗香浮动月黄昏。', author: '林逋', category: 'nature' },
  { text: '接天莲叶无穷碧，映日荷花别样红。', author: '杨万里', category: 'nature' },
  { text: '春风又绿江南岸，明月何时照我还。', author: '王安石', category: 'nature' },
  { text: '山重水复疑无路，柳暗花明又一村。', author: '陆游', category: 'nature' },
]

/** 为内置名言生成稳定 id */
function builtinId(idx: number): string {
  return `bq_${idx}`
}

/** 获取全部内置名言（带 id） */
function getBuiltinQuotes(): Quote[] {
  return BUILTIN_QUOTES.map((q, i) => ({
    ...q,
    id: builtinId(i),
    source: 'builtin' as const,
  }))
}

// ===== 自定义名言 =====

const CUSTOM_KEY = 'custom_quotes_v1'
const FAV_KEY = 'favorite_quotes_v1'

function listCustom(): Quote[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]') as Quote[]
    return raw.filter((q) => q && typeof q.text === 'string')
  } catch {
    return []
  }
}

function saveCustom(list: Quote[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
}

function genId(): string {
  return `cq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 添加自定义金句 */
export function addCustomQuote(text: string, author: string, category: QuoteCategory): Quote {
  const quote: Quote = {
    id: genId(),
    text: text.trim(),
    author: author.trim() || '佚名',
    category,
    source: 'custom',
  }
  const all = listCustom()
  all.push(quote)
  saveCustom(all)
  return quote
}

/** 删除自定义金句 */
export function deleteCustomQuote(id: string) {
  saveCustom(listCustom().filter((q) => q.id !== id))
  // 同步移除收藏
  toggleFavorite(id, false)
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

/** 切换收藏状态 */
export function toggleFavorite(id: string, force?: boolean) {
  const set = listFavorites()
  if (force === true) set.add(id)
  else if (force === false) set.delete(id)
  else { set.has(id) ? set.delete(id) : set.add(id) }
  saveFavorites(set)
}

/** 是否已收藏 */
export function isFavorite(id: string): boolean {
  return listFavorites().has(id)
}

// ===== 每日一签 =====

/** 基于日期的确定性 hash（同一天返回同一句） */
function dateHash(date: string): number {
  let h = 0
  for (let i = 0; i < date.length; i++) {
    h = (h * 31 + date.charCodeAt(i)) & 0x7fffffff
  }
  return h
}

/** 获取今日金句（确定性选取） */
export function getTodayQuote(): Quote {
  const all = getAllQuotes()
  const today = todayStr()
  const idx = dateHash(today) % all.length
  return all[idx]
}

// ===== 查询 =====

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 全部名言（内置 + 自定义） */
export function getAllQuotes(): Quote[] {
  return [...getBuiltinQuotes(), ...listCustom()]
}

/** 按分类筛选 */
export function getQuotesByCategory(category: QuoteCategory | 'all' | 'favorite'): Quote[] {
  if (category === 'all') return getAllQuotes()
  if (category === 'favorite') {
    const fav = listFavorites()
    return getAllQuotes().filter((q) => fav.has(q.id))
  }
  return getAllQuotes().filter((q) => q.category === category)
}

/** 随机一条 */
export function getRandomQuote(): Quote {
  const all = getAllQuotes()
  return all[Math.floor(Math.random() * all.length)]
}

/** 统计 */
export function getQuoteStat() {
  const all = getAllQuotes()
  const custom = listCustom()
  const fav = listFavorites()
  return {
    total: all.length,
    builtin: all.length - custom.length,
    custom: custom.length,
    favorites: fav.size,
  }
}
