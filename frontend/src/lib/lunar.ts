/**
 * 农历/万年历工具
 *
 * 功能：
 * 1. 公历转农历（年月日 + 天干地支 + 生肖）
 * 2. 农历节日判断
 * 3. 节气查询（简化版，基于近似公式）
 *
 * 数据来源：1900-2100 年农历查找表（标准实现）
 */

/** 农历查找表：1900-2100 年，每年用 hex 编码
 * 高 4 位：闰月月份（0=无闰月）
 * 低 12 位：12 个月的大小月标志（1=30天大月，0=29天小月），从正月到十二月
 */
const LUNAR_INFO: number[] = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
  0x0d520, // 2100
]

/** 天干 */
const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
/** 地支 */
const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
/** 生肖 */
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']
/** 农历月名 */
const LUNAR_MONTH = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
/** 农历日名 */
const LUNAR_DAY = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
]

/** 农历节日（月-日 → 名称） */
const LUNAR_FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵节',
  '5-5': '端午节',
  '7-7': '七夕节',
  '7-15': '中元节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
  '12-23': '小年',
  '12-30': '除夕',
}

/** 西方星座 */
const CONSTELLATIONS: { name: string; emoji: string; start: [number, number] }[] = [
  { name: '摩羯座', emoji: '♑', start: [12, 22] },
  { name: '水瓶座', emoji: '♒', start: [1, 20] },
  { name: '双鱼座', emoji: '♓', start: [2, 19] },
  { name: '白羊座', emoji: '♈', start: [3, 21] },
  { name: '金牛座', emoji: '♉', start: [4, 20] },
  { name: '双子座', emoji: '♊', start: [5, 21] },
  { name: '巨蟹座', emoji: '♋', start: [6, 22] },
  { name: '狮子座', emoji: '♌', start: [7, 23] },
  { name: '处女座', emoji: '♍', start: [8, 23] },
  { name: '天秤座', emoji: '♎', start: [9, 23] },
  { name: '天蝎座', emoji: '♏', start: [10, 24] },
  { name: '射手座', emoji: '♐', start: [11, 23] },
  { name: '摩羯座', emoji: '♑', start: [12, 22] },
]

/** 获取西方星座 */
function getConstellation(month: number, day: number): { name: string; emoji: string } {
  for (let i = CONSTELLATIONS.length - 1; i >= 0; i--) {
    const [m, d] = CONSTELLATIONS[i].start
    if (month > m || (month === m && day >= d)) {
      return { name: CONSTELLATIONS[i].name, emoji: CONSTELLATIONS[i].emoji }
    }
  }
  return { name: '摩羯座', emoji: '♑' }
}

/** 宜忌活动池（按六十甲子日序循环）
 * 简化版黄历：每 12 天轮换一组宜忌，覆盖常见生活场景
 */
const YI_POOL: string[][] = [
  ['祭祀', '祈福', '出行', '嫁娶'],
  ['开市', '交易', '立券', '纳财'],
  ['修造', '动土', '上梁', '盖屋'],
  ['移徙', '入宅', '安床', '拆卸'],
  ['栽种', '纳畜', '牧养', '开池'],
  ['求嗣', '冠笄', '纳采', '订盟'],
  ['解除', '扫舍', '出行', '伐木'],
  ['经络', '酝酿', '裁衣', '合帐'],
  ['破土', '安葬', '移柩', '入殓'],
  ['开仓', '出货', '放水', '交易'],
  ['祈福', '求嗣', '祭祀', '解除'],
  ['出行', '嫁娶', '移徙', '入宅'],
]

const JI_POOL: string[][] = [
  ['开市', '动土', '安葬', '移徙'],
  ['嫁娶', '出行', '安床', '拆卸'],
  ['开市', '交易', '纳财', '栽种'],
  ['祭祀', '祈福', '求嗣', '出行'],
  ['修造', '动土', '上梁', '盖屋'],
  ['开仓', '出货', '放水', '伐木'],
  ['嫁娶', '移徙', '入宅', '安床'],
  ['出行', '解除', '扫舍', '开市'],
  ['开市', '交易', '立券', '纳财'],
  ['修造', '动土', '上梁', '盖屋'],
  ['嫁娶', '移徙', '入宅', '安葬'],
  ['祭祀', '祈福', '求嗣', '冠笄'],
]

/** 计算当日干支日序（六十甲子，1-60） */
function getGanzhiDayIndex(date: Date): number {
  // 1900-01-31 为甲戌日（第11位，索引10）
  const baseDate = new Date(1900, 0, 31)
  const diff = Math.floor((date.getTime() - baseDate.getTime()) / 86400000)
  return ((diff % 60) + 60) % 60
}

/** 获取当日宜忌 */
function getYiJi(date: Date): { yi: string[]; ji: string[] } {
  const idx = getGanzhiDayIndex(date) % 12
  return { yi: YI_POOL[idx], ji: JI_POOL[idx] }
}

/** 获取农历年总天数 */
function lunarYearDays(year: number): number {
  let sum = 348 // 12 * 29
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += LUNAR_INFO[year - 1900] & i ? 1 : 0
  }
  return sum + leapDays(year)
}

/** 闰月天数 */
function leapDays(year: number): number {
  if (leapMonth(year) === 0) return 0
  return LUNAR_INFO[year - 1900] & 0x10000 ? 30 : 29
}

/** 闰月月份（0=无闰月） */
function leapMonth(year: number): number {
  return LUNAR_INFO[year - 1900] & 0xf
}

/** 某月天数（不包含闰月） */
function monthDays(year: number, month: number): number {
  return LUNAR_INFO[year - 1900] & (0x10000 >> month) ? 30 : 29
}

export interface LunarDate {
  /** 农历年（数字，如 2024） */
  year: number
  /** 农历月（1-12） */
  month: number
  /** 是否闰月 */
  isLeap: boolean
  /** 农历日（1-30） */
  day: number
  /** 天干地支年（如 "丙午"） */
  ganzhi: string
  /** 生肖（如 "马"） */
  zodiac: string
  /** 生肖年全称（如 "马年（丙午年）"） */
  zodiacYear: string
  /** 农历月名（如 "正月"） */
  monthName: string
  /** 农历日名（如 "初一"） */
  dayName: string
  /** 农历大写日期（如 "二零二六年六月廿五日"） */
  lunarDateText: string
  /** 农历节日（如有） */
  festival?: string
  /** 宜（今日宜做的事） */
  yi: string[]
  /** 忌（今日忌做的事） */
  ji: string[]
  /** 西方星座 */
  constellation: { name: string; emoji: string }
  /** 完整农历日期字符串（如 "丙午马年 正月十五 元宵节"） */
  fullText: string
  /** 简短农历日期（如 "正月十五"） */
  shortText: string
}

/**
 * 公历转农历
 * @param date 公历日期
 * @returns 农历日期信息
 */
export function gregorianToLunar(date: Date): LunarDate {
  let offset = Math.floor((date.getTime() - new Date(1900, 0, 31).getTime()) / 86400000)
  let year = 1900
  let temp = 0

  // 逐年减去农历年天数
  while (year < 2101 && offset > 0) {
    temp = lunarYearDays(year)
    if (offset < temp) break
    offset -= temp
    year++
  }

  // 逐年减去农历月天数
  let month = 1
  let isLeap = false
  const leap = leapMonth(year)
  while (month < 13 && offset > 0) {
    // 闰月处理
    if (leap > 0 && month === leap + 1 && !isLeap) {
      month--
      isLeap = true
      temp = leapDays(year)
    } else {
      temp = monthDays(year, month)
    }

    if (offset < temp) break
    if (isLeap) {
      isLeap = false
      month++
    } else {
      month++
    }
    offset -= temp
  }

  // 修正：如果 offset 正好为 0 且是最后一天
  if (offset === 0 && leap > 0 && month === leap + 1) {
    if (isLeap) {
      isLeap = false
      month++
    } else {
      isLeap = true
    }
  }

  const day = offset + 1

  // 天干地支
  const ganIdx = (year - 4) % 10
  const zhiIdx = (year - 4) % 12
  const ganzhi = `${TIAN_GAN[ganIdx]}${DI_ZHI[zhiIdx]}`
  const zodiac = ZODIAC[zhiIdx]

  const monthName = `${isLeap ? '闰' : ''}${LUNAR_MONTH[month - 1]}月`
  const dayName = LUNAR_DAY[day - 1]
  const zodiacYear = `${zodiac}年（${ganzhi}年）`

  // 农历大写日期（如 "二零二六年六月廿五日"）
  const lunarNumMap = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  const yearText = String(year).split('').map(c => lunarNumMap[Number(c)]).join('')
  const monthNumText = lunarNumMap[month] || String(month)
  const lunarDateText = `${yearText}年${monthNumText}月${dayName}`

  // 节日判断
  const festivalKey = `${month}-${day}`
  const festival = LUNAR_FESTIVALS[festivalKey]

  // 宜忌
  const { yi, ji } = getYiJi(date)

  // 西方星座
  const constellation = getConstellation(date.getMonth() + 1, date.getDate())

  const shortText = festival
    ? `${monthName}${dayName} · ${festival}`
    : `${monthName}${dayName}`

  const fullText = festival
    ? `${ganzhi}${zodiac}年 ${monthName}${dayName} · ${festival}`
    : `${ganzhi}${zodiac}年 ${monthName}${dayName}`

  return {
    year,
    month,
    isLeap,
    day,
    ganzhi,
    zodiac,
    zodiacYear,
    monthName,
    dayName,
    lunarDateText,
    festival,
    yi,
    ji,
    constellation,
    fullText,
    shortText,
  }
}

/**
 * 获取今日农历信息（用于首页日期显示）
 * @returns 格式化的日期信息
 */
export function getTodayLunarInfo(): {
  /** 公历日期文本，如 "2026年8月7日 周五" */
  gregorian: string
  /** 农历日期文本，如 "丙午马年 六月廿五" */
  lunar: string
  /** 农历简短文本，如 "六月廿五" */
  lunarShort: string
  /** 农历大写日期，如 "二零二六年六月廿五日" */
  lunarDateText: string
  /** 生肖年全称，如 "马年（丙午年）" */
  zodiacYear: string
  /** 生肖，如 "马" */
  zodiac: string
  /** 干支年，如 "丙午" */
  ganzhi: string
  /** 节日（如有） */
  festival?: string
  /** 宜（今日宜做的事） */
  yi: string[]
  /** 忌（今日忌做的事） */
  ji: string[]
  /** 西方星座 */
  constellation: { name: string; emoji: string }
} {
  const now = new Date()
  const weekDay = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
  const lunar = gregorianToLunar(now)

  return {
    gregorian: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 周${weekDay}`,
    lunar: lunar.fullText,
    lunarShort: lunar.shortText,
    lunarDateText: lunar.lunarDateText,
    zodiacYear: lunar.zodiacYear,
    zodiac: lunar.zodiac,
    ganzhi: lunar.ganzhi,
    festival: lunar.festival,
    yi: lunar.yi,
    ji: lunar.ji,
    constellation: lunar.constellation,
  }
}
