// ===== 天干地支基础数据 =====

export const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const
export const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const
export const ZODIAC_ANIMALS = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'] as const

// 天干五行: 甲乙木 丙丁火 戊己土 庚辛金 壬癸水
const GAN_WUXING = ['木', '木', '火', '火', '土', '土', '金', '金', '水', '水'] as const
// 天干阴阳: 奇数位阳，偶数位阴
const GAN_YINYANG = ['阳', '阴', '阳', '阴', '阳', '阴', '阳', '阴', '阳', '阴'] as const

// 地支五行
const ZHI_WUXING = ['水', '土', '木', '木', '土', '火', '火', '土', '金', '金', '土', '水'] as const
// 地支阴阳
const ZHI_YINYANG = ['阳', '阴', '阳', '阴', '阳', '阴', '阳', '阴', '阳', '阴', '阳', '阴'] as const

// 地支藏干
export const ZHI_CANG_GAN: string[][] = [
  ['癸'],         // 子
  ['己', '辛', '癸'], // 丑
  ['甲', '丙', '戊'], // 寅
  ['乙'],         // 卯
  ['戊', '乙', '癸'], // 辰
  ['丙', '庚', '戊'], // 巳
  ['丁', '己'],     // 午
  ['己', '丁', '乙'], // 未
  ['庚', '壬', '戊'], // 申
  ['辛'],         // 酉
  ['戊', '辛', '丁'], // 戌
  ['壬', '甲'],     // 亥
]

// 五行
export const WUXING = ['木', '火', '土', '金', '水'] as const

// 五行相生: 木生火 火生土 土生金 金生水 水生木
const WUXING_SHENG: Record<string, string> = { '木': '火', '火': '土', '土': '金', '金': '水', '水': '木' }
// 五行相克: 木克土 土克水 水克火 火克金 金克木
const WUXING_KE: Record<string, string> = { '木': '土', '土': '水', '水': '火', '火': '金', '金': '木' }

// 纳音（30 对，每对覆盖 2 个甲子序号）
const NAYIN: string[] = [
  '海中金', '炉中火', '大林木', '路旁土', '剑锋金', '山头火', '涧下水', '城墙土', '白蜡金', '杨柳木',
  '泉中水', '屋上土', '霹雳火', '松柏木', '长流水', '砂石金', '山下火', '平地木', '壁上土', '金箔金',
  '覆灯火', '天河水', '大驿土', '钗钏金', '桑柘木', '大溪水', '沙中土', '天上火', '石榴木', '大海水',
]

// 节气近似日期（用于月柱判断）
// 每个节气对应一个月支切换点
const JIEQI_DATES = [
  { month: 2, day: 4, branchIndex: 2 },   // 立春 → 寅
  { month: 3, day: 6, branchIndex: 3 },   // 惊蛰 → 卯
  { month: 4, day: 5, branchIndex: 4 },   // 清明 → 辰
  { month: 5, day: 6, branchIndex: 5 },   // 立夏 → 巳
  { month: 6, day: 6, branchIndex: 6 },   // 芒种 → 午
  { month: 7, day: 7, branchIndex: 7 },   // 小暑 → 未
  { month: 8, day: 8, branchIndex: 8 },   // 立秋 → 申
  { month: 9, day: 8, branchIndex: 9 },   // 白露 → 酉
  { month: 10, day: 8, branchIndex: 10 }, // 寒露 → 戌
  { month: 11, day: 7, branchIndex: 11 }, // 立冬 → 亥
  { month: 12, day: 7, branchIndex: 0 },  // 大雪 → 子
  { month: 1, day: 6, branchIndex: 1 },   // 小寒 → 丑
]

// ===== 计算函数 =====

// 获取 60 甲子序号
function getPillarIndex(stemIndex: number, branchIndex: number): number {
  return ((stemIndex * 6 - branchIndex * 5) % 60 + 60) % 60
}

// 公历日期 → 儒略日号
function getJDN(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12)
  const y = year + 4800 - a
  const m = month + 12 * a - 3
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045
}

// 判断日期在当年哪个节气段，返回月支 index
function getMonthBranchIndex(year: number, month: number, day: number): number {
  // 按 (month, day) 排序查找
  const sorted = [...JIEQI_DATES].sort((a, b) => a.month !== b.month ? a.month - b.month : a.day - b.day)
  let result = sorted[sorted.length - 1].branchIndex // 默认：小寒后的丑月

  for (const jq of sorted) {
    if (month > jq.month || (month === jq.month && day >= jq.day)) {
      result = jq.branchIndex
    }
  }
  return result
}

// 判断是否在立春前（用于年柱）
function isBeforeLichun(year: number, month: number, day: number): boolean {
  return month < 2 || (month === 2 && day < 4)
}

export interface BaziPillar {
  stem: string
  branch: string
  stemIndex: number
  branchIndex: number
  wuxing: { stem: string; branch: string }
  yinyang: { stem: string; branch: string }
  cangGan: string[]
  nayin: string
  pillarIndex: number
  animal: string
}

export interface BaziResult {
  year: BaziPillar
  month: BaziPillar
  day: BaziPillar
  hour: BaziPillar
  wuxingCount: Record<string, number>
  wuxingPercent: Record<string, number>
  dayMaster: string // 日主（日干）
  dayMasterElement: string
  nayinYear: string // 年柱纳音（年命）
  description: string
  birthInfo: { year: number; month: number; day: number; hour: number }
}

function buildPillar(stemIndex: number, branchIndex: number): BaziPillar {
  const pillarIndex = getPillarIndex(stemIndex, branchIndex)
  const nayinIndex = Math.floor(pillarIndex / 2)
  return {
    stem: TIAN_GAN[stemIndex],
    branch: DI_ZHI[branchIndex],
    stemIndex,
    branchIndex,
    wuxing: {
      stem: GAN_WUXING[stemIndex],
      branch: ZHI_WUXING[branchIndex],
    },
    yinyang: {
      stem: GAN_YINYANG[stemIndex],
      branch: ZHI_YINYANG[branchIndex],
    },
    cangGan: ZHI_CANG_GAN[branchIndex],
    nayin: NAYIN[nayinIndex],
    pillarIndex,
    animal: ZODIAC_ANIMALS[branchIndex],
  }
}

export function calculateBazi(year: number, month: number, day: number, hour: number, gender: 'male' | 'female' = 'male'): BaziResult {
  // === 年柱 ===
  const adjustedYear = isBeforeLichun(year, month, day) ? year - 1 : year
  const yearStemIndex = ((adjustedYear - 4) % 10 + 10) % 10
  const yearBranchIndex = ((adjustedYear - 4) % 12 + 12) % 12
  const yearPillar = buildPillar(yearStemIndex, yearBranchIndex)

  // === 月柱 ===
  const monthBranchIndex = getMonthBranchIndex(year, month, day)
  // 五虎遁：月干起首（寅月的天干）
  const monthStemStart = (yearStemIndex % 5) * 2 + 2
  const monthOffset = (monthBranchIndex - 2 + 12) % 12
  const monthStemIndex = (monthStemStart + monthOffset) % 10
  const monthPillar = buildPillar(monthStemIndex, monthBranchIndex)

  // === 日柱 ===
  const jdn = getJDN(year, month, day)
  const dayPillarIndex = ((jdn + 49) % 60 + 60) % 60
  const dayStemIndex = dayPillarIndex % 10
  const dayBranchIndex = dayPillarIndex % 12
  const dayPillar = buildPillar(dayStemIndex, dayBranchIndex)

  // === 时柱 ===
  // 子时: 23-1点, 丑时: 1-3点, ... 亥时: 21-23点
  // 23 点算当天的子时（简化处理）
  const hourBranchIndex = Math.floor(((hour + 1) % 24) / 2)
  // 五鼠遁：子时的天干
  const hourStemStart = (dayStemIndex % 5) * 2
  const hourStemIndex = (hourStemStart + hourBranchIndex) % 10
  const hourPillar = buildPillar(hourStemIndex, hourBranchIndex)

  // === 五行统计 ===
  const wuxingCount: Record<string, number> = { '木': 0, '火': 0, '土': 0, '金': 0, '水': 0 }
  // 天干
  ;[yearPillar, monthPillar, dayPillar, hourPillar].forEach((p) => {
    wuxingCount[p.wuxing.stem] += 1
  })
  // 地支（含藏干，主气权重1，中气0.5，余气0.3）
  ;[yearPillar, monthPillar, dayPillar, hourPillar].forEach((p) => {
    wuxingCount[p.wuxing.branch] += 0.5
    p.cangGan.forEach((cg, idx) => {
      const ganIdx = TIAN_GAN.indexOf(cg as any)
      if (ganIdx >= 0) {
        const w = idx === 0 ? 1 : idx === 1 ? 0.5 : 0.3
        wuxingCount[GAN_WUXING[ganIdx]] += w
      }
    })
  })

  const total = Object.values(wuxingCount).reduce((a, b) => a + b, 0)
  const wuxingPercent: Record<string, number> = {}
  for (const k of WUXING) {
    wuxingPercent[k] = Math.round((wuxingCount[k] / total) * 100)
  }

  const dayMaster = dayPillar.stem
  const dayMasterElement = GAN_WUXING[dayStemIndex]

  // 生肖
  const animal = yearPillar.animal

  const description = `${gender === 'male' ? '乾造' : '坤造'}：${yearPillar.stem}${yearPillar.branch}年 ${monthPillar.stem}${monthPillar.branch}月 ${dayPillar.stem}${dayPillar.branch}日 ${hourPillar.stem}${hourPillar.branch}时`

  return {
    year: yearPillar,
    month: monthPillar,
    day: dayPillar,
    hour: hourPillar,
    wuxingCount,
    wuxingPercent,
    dayMaster,
    dayMasterElement,
    nayinYear: yearPillar.nayin,
    description,
    birthInfo: { year, month, day, hour },
  }
}

// 五行关系描述
export function getWuxingRelation(element: string): { sheng: string; ke: string; beiSheng: string; beiKe: string } {
  // 找到此元素生什么、克什么、被谁生、被谁克
  let sheng = '', ke = '', beiSheng = '', beiKe = ''
  for (const e of WUXING) {
    if (WUXING_SHENG[e] === element) beiSheng = e
    if (WUXING_KE[e] === element) beiKe = e
  }
  sheng = WUXING_SHENG[element] || ''
  ke = WUXING_KE[element] || ''
  return { sheng, ke, beiSheng, beiKe }
}
