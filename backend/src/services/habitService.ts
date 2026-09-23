/**
 * 用户习惯档案服务（HabitService）
 *
 * 功能：
 * 1. 从用户消息中自动提取个人习惯/兴趣/偏好
 * 2. 提供读取/更新/删除习惯的接口
 * 3. 按分类汇总习惯，供 LLM 系统提示词注入
 *
 * 提取逻辑：
 * - 基于关键词模式匹配，识别兴趣爱好/日常习惯/工作信息/性格偏好
 * - 同一习惯被多次提及自动累加 hitCount，提高置信度
 * - 提取后异步写入，不阻塞对话回复
 */

import { prisma } from '../lib/prisma.js'

// ============ 类型定义 ============

export type HabitCategory = 'interest' | 'routine' | 'preference' | 'personality' | 'work' | 'other'

export interface ExtractedHabit {
  category: HabitCategory
  content: string
  tags?: string[]
  confidence: number
}

// ============ 关键词模式库 ============

/** 兴趣爱好模式 */
const INTEREST_PATTERNS: Array<{ regex: RegExp; label: string; tags: string[] }> = [
  { regex: /(?:喜欢|爱|热爱|爱好|经常)(看|刷)(电影|剧|动漫|番剧|综艺)/, label: '喜欢{1}{2}', tags: ['影视', '娱乐'] },
  { regex: /(?:喜欢|爱|常|经常)(打|玩|踢)(篮球|足球|羽毛球|乒乓球|网球|排球|游戏|手游|switch|ps)/, label: '喜欢{1}{2}', tags: ['运动', '游戏'] },
  { regex: /(?:喜欢|爱|热爱|常去)(旅行|旅游|爬山|徒步|露营|骑行|跑步|健身|游泳)/, label: '热爱{1}', tags: ['运动', '户外'] },
  { regex: /(?:喜欢|爱)(听|弹|唱|玩)(音乐|歌|钢琴|吉他|古琴|古筝|架子鼓)/, label: '喜欢{1}{2}', tags: ['音乐'] },
  { regex: /(?:喜欢|爱|常)(看|读|写)(书|小说|漫画|杂志|诗|散文|博客)/, label: '喜欢{1}{2}', tags: ['阅读'] },
  { regex: /(?:喜欢|爱|经常)(做饭|烹饪|烘焙|研究美食|探店|拍照|摄影|画画|画画|写代码|编程)/, label: '喜欢{1}', tags: ['爱好'] },
  { regex: /(?:在玩|在追|在看)(.+?)(?:呢|啦|。|，|$)/, label: '在追{1}', tags: ['娱乐'] },
  { regex: /(?:喜欢|爱)(.+?)(?:这个|这款|这种)/, label: '喜欢{1}', tags: ['偏好'] },
]

/** 日常习惯模式 */
const ROUTINE_PATTERNS: Array<{ regex: RegExp; label: string; tags: string[] }> = [
  { regex: /(?:早起|起得早|习惯早起|早上[五六七]点)/, label: '习惯早起', tags: ['作息'] },
  { regex: /(?:熬夜|夜猫子|习惯晚睡|凌晨|半夜才睡)/, label: '习惯晚睡', tags: ['作息'] },
  { regex: /(?:不吃早饭|不吃早餐|没吃早饭的习惯)/, label: '不吃早餐', tags: ['饮食'] },
  { regex: /(?:每天|经常)(跑步|锻炼|健身|散步|走路)/, label: '经常{1}', tags: ['运动'] },
  { regex: /(?:每天|经常)(喝咖啡|喝茶|喝奶茶|喝酒|抽烟)/, label: '经常{1}', tags: ['饮食'] },
  { regex: /(?:午休|睡午觉|午睡)/, label: '有午休习惯', tags: ['作息'] },
  { regex: /(?:咖啡因|咖啡续命|靠咖啡)/, label: '依赖咖啡', tags: ['饮食'] },
]

/** 工作信息模式 */
const WORK_PATTERNS: Array<{ regex: RegExp; label: string; tags: string[] }> = [
  { regex: /(?:我是|我做|我干|我搞)(前端|后端|全栈|开发|产品|设计|运营|测试|运维|算法|数据|UI|iOS|安卓|Android)/, label: '做{1}的', tags: ['职业'] },
  { regex: /(?:在|在一家)(大厂|创业公司|外企|国企|互联网公司|公司)工作/, label: '在{1}工作', tags: ['职业'] },
  { regex: /(?:经常|天天|每天)(加班|开会|出差|写文档|写代码|review|对接)/, label: '经常{1}', tags: ['工作'] },
  { regex: /(?:上班|下班)(时间|比较)(早|晚|灵活)/, label: '上班时间{2}', tags: ['工作'] },
  { regex: /(?:老板|领导|上司|主管)让我(写|做|准备|整理)(方案|报告|计划|总结|PPT|文案|文档|策划|汇报|材料)/, label: '经常被安排写{2}', tags: ['工作', '写作'] },
  { regex: /(?:需要|得|要)(写|做|准备)(方案|报告|计划|总结|PPT|文案|文档|策划|汇报|材料)/, label: '经常需要写{2}', tags: ['工作', '写作'] },
]

/** 性格/偏好模式 */
const PERSONALITY_PATTERNS: Array<{ regex: RegExp; label: string; tags: string[] }> = [
  { regex: /(?:我比较|我是|我有点)(内向|外向|乐观|悲观|焦虑|敏感|佛系|急躁|慢性子)/, label: '比较{1}', tags: ['性格'] },
  { regex: /(?:不太会|不擅长|不喜欢)(社交|聊天|表达|说话)/, label: '不擅长{1}', tags: ['性格'] },
  { regex: /(?:喜欢|偏好)(简洁|简短|直接|详细|轻松|正式)(的)?(回复|沟通|聊天|方式)/, label: '偏好{1}沟通', tags: ['沟通偏好'] },
]

/** 情绪/状态模式（也记录为习惯） */
const MOOD_PATTERNS: Array<{ regex: RegExp; label: string; tags: string[] }> = [
  { regex: /(?:最近|经常)(压力大|焦虑|烦躁|疲惫|失眠|睡不好|没动力)/, label: '最近{1}', tags: ['状态'] },
]

// ============ 核心函数 ============

/**
 * 从用户消息中提取习惯信号
 *
 * @param message 用户消息原文
 * @returns 提取到的习惯列表
 */
export function extractHabitsFromMessage(message: string): ExtractedHabit[] {
  const text = message.toLowerCase()
  const results: ExtractedHabit[] = []

  const allPatterns: Array<{ patterns: typeof INTEREST_PATTERNS; category: HabitCategory }> = [
    { patterns: INTEREST_PATTERNS, category: 'interest' },
    { patterns: ROUTINE_PATTERNS, category: 'routine' },
    { patterns: WORK_PATTERNS, category: 'work' },
    { patterns: PERSONALITY_PATTERNS, category: 'personality' },
    { patterns: MOOD_PATTERNS, category: 'other' },
  ]

  for (const { patterns, category } of allPatterns) {
    for (const p of patterns) {
      const match = text.match(p.regex)
      if (match) {
        // 用捕获组替换标签中的占位 {1} {2}
        let content = p.label
        if (match[1]) {
          content = content.replace('{1}', match[1])
        }
        if (match[2]) {
          content = content.replace('{2}', match[2])
        }
        results.push({
          category,
          content,
          tags: p.tags,
          confidence: 0.6,
        })
      }
    }
  }

  return results
}

/**
 * 将提取的习惯写入数据库
 *
 * - 如果同一用户已有相似内容（content 相同），累加 hitCount、更新 lastMentionedAt
 * - 否则创建新记录
 *
 * @param userId 用户 ID
 * @param habits 提取到的习惯列表
 */
export async function saveExtractedHabits(userId: string, habits: ExtractedHabit[]): Promise<number> {
  if (habits.length === 0) return 0

  // P2 修复：先批量查询已有习惯，避免循环内 N 次 findFirst（N+1 查询）
  const contents = habits.map((h) => h.content)
  const existingHabits = await prisma.userHabit.findMany({
    where: { userId, content: { in: contents } },
    select: { id: true, content: true, confidence: true },
  })
  const existingMap = new Map(existingHabits.map((h) => [h.content, h]))
  const now = new Date()

  const toCreate: Array<{
    userId: string
    category: string
    content: string
    source: string
    tags: string | null
    confidence: number
    hitCount: number
    lastMentionedAt: Date
  }> = []
  const toUpdate: Array<{ id: string; confidence: number }> = []
  let savedCount = 0

  for (const habit of habits) {
    const existing = existingMap.get(habit.content)
    if (existing) {
      // 已存在：累加 hitCount + 递增 confidence（基于读到的原值）
      toUpdate.push({
        id: existing.id,
        confidence: Math.min(1, existing.confidence + 0.1),
      })
    } else {
      // 新习惯：收集后批量创建
      toCreate.push({
        userId,
        category: habit.category,
        content: habit.content,
        source: 'auto',
        tags: habit.tags ? JSON.stringify(habit.tags) : null,
        confidence: habit.confidence,
        hitCount: 1,
        lastMentionedAt: now,
      })
      savedCount++
    }
  }

  // 批量创建新习惯（1 次 createMany 替代 N 次 create）
  if (toCreate.length > 0) {
    await prisma.userHabit.createMany({ data: toCreate })
  }

  // 逐条更新已存在习惯（hitCount 原子递增 + confidence 设置）
  // 注：每行 confidence 不同，updateMany 无法一次更新；但已省去 N 次 findFirst 查询
  for (const item of toUpdate) {
    await prisma.userHabit.update({
      where: { id: item.id },
      data: {
        hitCount: { increment: 1 },
        lastMentionedAt: now,
        confidence: item.confidence,
      },
    })
  }

  return savedCount
}

/**
 * 获取用户的习惯档案（按分类分组）
 *
 * @param userId 用户 ID
 * @returns 按分类分组的习惯列表
 */
export async function getUserHabits(userId: string): Promise<Record<string, Array<{
  id: string
  content: string
  category: string
  hitCount: number
  confidence: number
  source: string
}>>> {
  const habits = await prisma.userHabit.findMany({
    where: { userId },
    orderBy: [
      { hitCount: 'desc' },
      { updatedAt: 'desc' },
    ],
    take: 50,
  })

  const grouped: Record<string, typeof habits> = {}
  for (const h of habits) {
    if (!grouped[h.category]) grouped[h.category] = []
    grouped[h.category].push(h)
  }

  return grouped
}

/**
 * 生成习惯摘要文本（注入 LLM 系统提示词用）
 *
 * @param userId 用户 ID
 * @returns 习惯摘要文本，如"用户兴趣：喜欢打篮球、看电影；作息：习惯晚睡"
 */
export async function getHabitSummary(userId: string): Promise<string> {
  const grouped = await getUserHabits(userId)
  const categoryLabels: Record<string, string> = {
    interest: '兴趣',
    routine: '习惯',
    work: '工作',
    personality: '性格',
    preference: '偏好',
    other: '其他',
  }

  const parts: string[] = []
  for (const [category, items] of Object.entries(grouped)) {
    const label = categoryLabels[category] || category
    const contents = items.slice(0, 5).map(h => h.content).join('、')
    if (contents) {
      parts.push(`${label}：${contents}`)
    }
  }

  return parts.join('；')
}

/**
 * 从消息中提取并保存习惯（一步到位，适合在对话流程中调用）
 *
 * @param userId 用户 ID
 * @param message 用户消息
 * @returns 新增的习惯数量
 */
export async function extractAndSaveHabits(userId: string, message: string): Promise<number> {
  const habits = extractHabitsFromMessage(message)
  if (habits.length === 0) return 0
  return saveExtractedHabits(userId, habits)
}
