import type { ReplyResult } from './index.js'
import { prisma } from '../prisma.js'
import { llmChatWithContext } from '../../services/llmService.js'
import { parseAction, executeAction, stripActionTag } from '../../services/conversationActionService.js'
export function formatDateLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (date.getTime() === today.getTime()) return '今天'
    if (date.getTime() === tomorrow.getTime()) return '明天'

    return `${date.getMonth() + 1}月${date.getDate()}日`
  } catch {
    return dateStr
  }
}

export function guessMealType(): string {
  const h = new Date().getHours()
  if (h < 10) return 'breakfast'
  if (h < 14) return 'lunch'
  if (h < 17) return 'snack'
  return 'dinner'
}

/**
 * DG-07 碎片信息分类器
 * - 检测 URL → link
 * - 检测代码标记 → snippet
 * - 检测待办线索 → todo
 * - 检测灵感关键词 → idea
 * - 默认 → note
 */
export function classifyFragment(content: string): { kind: string; tags: string[] } {
  const tags: string[] = []

  if (/https?:\/\/[^\s]+/i.test(content)) {
    tags.push('链接')
    return { kind: 'link', tags }
  }
  if (/```|^\s{4}|function |const |let |import |class /.test(content)) {
    tags.push('代码')
    return { kind: 'snippet', tags }
  }
  if (/应该|需要|记得|待办|要做|得去|别忘了|提醒我/.test(content)) {
    tags.push('待办')
    return { kind: 'todo', tags }
  }
  if (/想法|灵感|idea|如果|能不能|突然觉得|或许可以|不如/.test(content)) {
    tags.push('灵感')
    return { kind: 'idea', tags }
  }
  if (/工作|项目|任务|会议|客户/.test(content)) tags.push('工作')
  if (/生活|家庭|健康|运动|饮食/.test(content)) tags.push('生活')
  if (/钱|消费|收入|支出|理财/.test(content)) tags.push('财务')
  if (/学习|读书|课程|笔记/.test(content)) tags.push('学习')
  return { kind: 'note', tags }
}

/**
 * DG-08 隔夜整合：生成今日碎片的结构化总结
 *
 * 流程：
 * 1. 读取当日未整合碎片（digested=0）
 * 2. 按 kind 分组，每组取前 3 条作为 highlights
 * 3. 聚合所有 tags，按出现频次排序取前 8
 * 4. 提取 todo 类型碎片作为待跟进事项
 * 5. 生成自然语言总结
 * 6. 标记所有碎片为已整合（digested=1）
 *
 * 幂等：若当日已无未整合碎片，返回空摘要
 */
export interface DigestHighlight {
  id: string
  content: string
  createdAt: string
}

export interface DigestKindGroup {
  kind: string
  label: string
  count: number
  highlights: DigestHighlight[]
}

export interface DigestTopTag {
  tag: string
  count: number
}

export interface DigestResult {
  date: string
  totalCount: number
  byKind: DigestKindGroup[]
  topTags: DigestTopTag[]
  todoItems: string[]
  summary: string
  generatedAt: string
}

export async function generateDigest(userId: string): Promise<DigestResult> {
  const date = new Date().toISOString().slice(0, 10)

  // 读取当日未整合碎片
  const rows = await prisma.$queryRaw<{ id: string; content: string; kind: string; tags: string | null; createdAt: string }[]>`SELECT id, content, kind, tags, createdAt FROM fragments WHERE userId = ${userId} AND date(createdAt) = date(${date}) AND digested = 0 ORDER BY createdAt ASC`

  if (rows.length === 0) {
    return {
      date,
      totalCount: 0,
      byKind: [],
      topTags: [],
      todoItems: [],
      summary: '今日暂无未整合碎片，可继续发送文字/链接/想法收集~',
      generatedAt: new Date().toISOString(),
    }
  }

  // 解析 tags
  const parsed = rows.map((r) => {
    let tags: string[] = []
    try { tags = JSON.parse(r.tags || '[]') } catch { /* ignore */ }
    return { id: r.id, content: r.content, kind: r.kind, tags, createdAt: r.createdAt }
  })

  // 1. 按 kind 分组
  const kindGroups: Record<string, typeof parsed> = {}
  for (const f of parsed) {
    if (!kindGroups[f.kind]) kindGroups[f.kind] = []
    kindGroups[f.kind].push(f)
  }

  const kindLabels: Record<string, string> = {
    note: '笔记',
    link: '链接',
    todo: '待办',
    idea: '灵感',
    snippet: '代码',
  }

  const byKind: DigestKindGroup[] = Object.keys(kindGroups).map((kind) => ({
    kind,
    label: kindLabels[kind] || kind,
    count: kindGroups[kind].length,
    highlights: kindGroups[kind].slice(0, 3).map((f) => ({
      id: f.id,
      content: f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content,
      createdAt: f.createdAt,
    })),
  }))

  // 2. 聚合 tags
  const tagCount: Record<string, number> = {}
  for (const f of parsed) {
    for (const tag of f.tags) {
      tagCount[tag] = (tagCount[tag] || 0) + 1
    }
  }
  const topTags: DigestTopTag[] = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }))

  // 3. 提取 todo 待跟进
  const todoItems: string[] = parsed
    .filter((f) => f.kind === 'todo')
    .map((f) => (f.content.length > 80 ? f.content.slice(0, 80) + '…' : f.content))

  // 4. 生成总结文案
  const summaryParts: string[] = []
  summaryParts.push(`今日共记录 ${parsed.length} 条碎片`)
  if (byKind.length > 0) {
    const breakdown = byKind.map((g) => `${g.label} ${g.count} 条`).join('、')
    summaryParts.push(`分布：${breakdown}`)
  }
  if (topTags.length > 0) {
    summaryParts.push(`高频标签：${topTags.slice(0, 5).map((t) => `#${t.tag}`).join(' ')}`)
  }
  if (todoItems.length > 0) {
    summaryParts.push(`待跟进 ${todoItems.length} 项`)
  }
  const summary = summaryParts.join('。') + '。'

  // 5. 标记为已整合
  await prisma.$executeRaw`UPDATE fragments SET digested = 1 WHERE userId = ${userId} AND date(createdAt) = date(${date}) AND digested = 0`

  return {
    date,
    totalCount: parsed.length,
    byKind,
    topTags,
    todoItems,
    summary,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * DG-09 跨信息关联：发现碎片间的关联，主动提示并建议行动
 *
 * 算法：
 * 1. 读取最近 7 天的碎片
 * 2. 按 tag 聚合，找出有 2+ 碎片的标签
 * 3. 为每个关联组生成建议行动（基于标签语义）
 * 4. 返回关联组列表（最多 10 组）
 *
 * 返回结构对齐 GET /fragment/connections 接口
 */
export interface ConnectionSample {
  id: string
  content: string
  kind: string
  createdAt: string
}

export interface ConnectionGroup {
  tag: string
  count: number
  icon: string
  suggestedAction: string
  samples: ConnectionSample[]
}

export interface ConnectionsResult {
  days: number
  totalCount: number
  connections: ConnectionGroup[]
  summary: string
}

export async function generateConnections(userId: string): Promise<ConnectionsResult> {
  const days = 7
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  const rows = await prisma.$queryRaw<{ id: string; content: string; kind: string; tags: string | null; createdAt: string }[]>`SELECT id, content, kind, tags, createdAt FROM fragments WHERE userId = ${userId} AND date(createdAt) >= date(${sinceStr}) ORDER BY createdAt DESC LIMIT 200`

  if (rows.length === 0) {
    return {
      days,
      totalCount: 0,
      connections: [],
      summary: '最近无碎片记录，发送文字/链接/想法即可开始收集。',
    }
  }

  // 解析 tags
  const parsed = rows.map((r) => {
    let tags: string[] = []
    try { tags = JSON.parse(r.tags || '[]') } catch { /* ignore */ }
    return { id: r.id, content: r.content, kind: r.kind, tags, createdAt: r.createdAt }
  })

  // 按 tag 聚合
  const tagGroups: Record<string, typeof parsed> = {}
  for (const f of parsed) {
    for (const tag of f.tags) {
      if (!tagGroups[tag]) tagGroups[tag] = []
      tagGroups[tag].push(f)
    }
  }

  // 建议行动映射
  const actionMap: Record<string, { action: string; icon: string }> = {
    工作: { action: '考虑创建项目任务，统一跟进相关碎片', icon: '📋' },
    项目: { action: '建议汇总为项目笔记，便于回溯', icon: '📁' },
    待办: { action: '建议加入任务清单，逐项落实', icon: '✅' },
    灵感: { action: '建议整理为灵感笔记，触发后续行动', icon: '💡' },
    学习: { action: '建议汇总为学习主题，制定学习计划', icon: '📚' },
    财务: { action: '建议纳入预算规划，关注支出趋势', icon: '💰' },
    生活: { action: '建议回顾关联内容，平衡生活节奏', icon: '🌿' },
    链接: { action: '建议整理为书签清单，分类保存', icon: '🔗' },
    代码: { action: '建议汇总为代码片段集，便于复用', icon: '⌗' },
  }

  // 构建关联组（仅保留 2+ 碎片的标签）
  const connections: ConnectionGroup[] = Object.entries(tagGroups)
    .filter(([, frags]) => frags.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([tag, frags]) => {
      const meta = actionMap[tag] || { action: '建议回顾关联内容，发现潜在行动', icon: '🔍' }
      return {
        tag,
        count: frags.length,
        icon: meta.icon,
        suggestedAction: meta.action,
        samples: frags.slice(0, 3).map((f) => ({
          id: f.id,
          content: f.content.length > 50 ? f.content.slice(0, 50) + '…' : f.content,
          kind: f.kind,
          createdAt: f.createdAt,
        })),
      }
    })

  const summary =
    connections.length > 0
      ? `最近 ${days} 天发现 ${connections.length} 组关联信息`
      : `最近 ${days} 天共 ${parsed.length} 条碎片，暂无明显关联`

  return {
    days,
    totalCount: parsed.length,
    connections,
    summary,
  }
}

/**
 * DG-09 跨模块洞察：检测碎片↔任务/账单之间的未闭环信号
 *
 * 信号类型：
 * 1. orphanTodos：待办碎片未对应任务
 * 2. unactedIdeas：灵感碎片近 3 天未触发任务
 * 3. financeMentions：含金额语义但未入账
 * 4. taskEchoes：任务标题在碎片中重复出现
 *
 * 返回结构对齐 GET /fragment/insights 接口
 */
export interface InsightSample {
  fragmentId: string
  content: string
  createdAt: string
  suggestion: string
}

export interface InsightTaskEcho {
  taskId: string
  taskTitle: string
  taskStatus: string
  echoCount: number
  samples: InsightSample[]
}

export interface InsightsResult {
  days: number
  totalCount: number
  signals: {
    orphanTodos: InsightSample[]
    unactedIdeas: InsightSample[]
    financeMentions: InsightSample[]
    taskEchoes: InsightTaskEcho[]
  }
  signalCount: number
  summary: string
  generatedAt: string
}

export async function generateInsights(userId: string): Promise<InsightsResult> {
  const days = 7
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)

  // 并行查询：碎片 + 近期任务 + 近期账单
  const [fragRows, tasks, bills] = await Promise.all([
    prisma.$queryRaw<{ id: string; content: string; kind: string; tags: string | null; createdAt: string }[]>`SELECT id, content, kind, tags, createdAt FROM fragments WHERE userId = ${userId} AND date(createdAt) >= date(${sinceStr}) ORDER BY createdAt DESC LIMIT 200`,
    prisma.task.findMany({
      where: { userId, updatedAt: { gte: since } },
      select: { id: true, title: true, status: true, priority: true, dueDate: true },
      take: 100,
    }),
    prisma.bill.findMany({
      where: { userId, billDate: { gte: since } },
      select: { id: true, title: true, type: true, amount: true, category: true, billDate: true },
      take: 100,
    }),
  ])

  // 解析碎片
  const fragments = fragRows.map((r) => {
    let tags: string[] = []
    try { tags = JSON.parse(r.tags || '[]') } catch { /* ignore */ }
    return { id: r.id, content: r.content, kind: r.kind, tags, createdAt: r.createdAt }
  })

  // 信号 1：orphanTodos
  const todoFrags = fragments.filter(
    (f) => f.kind === 'todo' || /待办|要做|得去|记得|别忘了|提醒我/.test(f.content),
  )
  const taskTitles = tasks.map((t) => t.title)
  const orphanTodos: InsightSample[] = todoFrags
    .filter((f) => {
      const kw = f.content.replace(/应该|需要|记得|待办|要做|得去|别忘了|提醒我|完成|处理/g, '').trim().slice(0, 5)
      if (!kw) return true
      return !taskTitles.some((t) => t.includes(kw) || kw.includes(t.slice(0, 4)))
    })
    .slice(0, 5)
    .map((f) => ({
      fragmentId: f.id,
      content: f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content,
      createdAt: f.createdAt,
      suggestion: '建议转为任务，纳入待办清单跟踪',
    }))

  // 信号 2：unactedIdeas
  const ideaFrags = fragments.filter((f) => f.kind === 'idea')
  const recent3d = new Date()
  recent3d.setDate(recent3d.getDate() - 3)
  const unactedIdeas: InsightSample[] = ideaFrags
    .filter((f) => new Date(f.createdAt) < recent3d)
    .slice(0, 5)
    .map((f) => ({
      fragmentId: f.id,
      content: f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content,
      createdAt: f.createdAt,
      suggestion: '灵感已搁置 3 天以上，建议整理为笔记或转为任务',
    }))

  // 信号 3：financeMentions
  const financeFrags = fragments.filter(
    (f) => /(\d+(\.\d+)?)\s*(元|块|￥|¥)|花了|收入|支出|消费|入账/.test(f.content),
  )
  const billTitles = bills.map((b) => b.title)
  const financeMentions: InsightSample[] = financeFrags
    .filter((f) => {
      const kw = f.content.replace(/\d+(?:\.\d+)?/g, '').replace(/元|块|￥|¥|花了|收入|支出|消费|入账/g, '').trim().slice(0, 5)
      if (!kw) return true
      return !billTitles.some((t) => t.includes(kw))
    })
    .slice(0, 5)
    .map((f) => ({
      fragmentId: f.id,
      content: f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content,
      createdAt: f.createdAt,
      suggestion: '提及金额但未在账单中找到对应记录，建议核实是否已入账',
    }))

  // 信号 4：taskEchoes
  const taskEchoes: InsightTaskEcho[] = tasks
    .map((t) => {
      const kw = t.title.slice(0, 5)
      const echoes = fragments.filter((f) => f.content.includes(kw)).slice(0, 2)
      return {
        taskId: t.id,
        taskTitle: t.title,
        taskStatus: t.status,
        echoCount: echoes.length,
        samples: echoes.map((f) => ({
          fragmentId: f.id,
          content: f.content.length > 50 ? f.content.slice(0, 50) + '…' : f.content,
          createdAt: f.createdAt,
          suggestion: '该任务在碎片中有相关思考，建议整合沉淀',
        })),
      }
    })
    .filter((e) => e.echoCount > 0)
    .slice(0, 5)

  const signalCount =
    orphanTodos.length + unactedIdeas.length + financeMentions.length + taskEchoes.length

  const summaryParts: string[] = []
  summaryParts.push(`最近 ${days} 天共 ${fragments.length} 条碎片`)
  if (orphanTodos.length > 0) summaryParts.push(`${orphanTodos.length} 项待办未转化`)
  if (unactedIdeas.length > 0) summaryParts.push(`${unactedIdeas.length} 个灵感搁置`)
  if (financeMentions.length > 0) summaryParts.push(`${financeMentions.length} 笔金额未入账`)
  if (taskEchoes.length > 0) summaryParts.push(`${taskEchoes.length} 个任务有相关思考`)
  const summary =
    signalCount === 0
      ? `最近 ${days} 天共 ${fragments.length} 条碎片，跨模块关联已闭环`
      : summaryParts.join('，') + '。'

  return {
    days,
    totalCount: fragments.length,
    signals: { orphanTodos, unactedIdeas, financeMentions, taskEchoes },
    signalCount,
    summary,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * EV-04 智能准备助手：为重要事件自动生成倒计时待办清单
 *
 * 算法：
 * 1. 查询未来 3 天内的重要任务（important=true 或 priority=urgent/high）
 * 2. 按任务标题关键词匹配准备模板：
 *    - 会议/汇报 → 准备资料/确认参会人员/检查设备/演示文稿
 *    - 客户/拜访 → 准备资料/确认行程/准备名片/了解客户背景
 *    - 截止/提交/交付 → 检查完整性/准备备份/确认提交方式
 *    - 考试/面试 → 复习重点/准备证件/调整作息/准备材料
 *    - 旅行/出差/出发 → 确认行程/准备行李/检查证件/预订住宿
 *    - 默认 → 梳理要点/准备材料/确认时间
 * 3. 返回每个重要事件的准备清单
 */
export interface PreparationItem {
  text: string
  optional?: boolean
}

export interface PreparationEvent {
  taskId: string
  title: string
  dueDate: string
  daysLeft: number
  priority: string
  important: boolean
  category: string | null
  checklist: PreparationItem[]
}

export interface PreparationResult {
  events: PreparationEvent[]
  totalChecklistItems: number
  summary: string
  generatedAt: string
}

/**
 * 根据任务标题生成准备清单
 */
export function generateChecklist(title: string): PreparationItem[] {
  const items: PreparationItem[] = []

  if (/会议|汇报|演示|分享|讲座/.test(title)) {
    items.push({ text: '准备会议资料和议程' })
    items.push({ text: '确认参会人员并通知' })
    items.push({ text: '检查投影/音响设备' })
    items.push({ text: '准备演示文稿', optional: true })
    return items
  }
  if (/客户|拜访|会见|面谈|接见/.test(title)) {
    items.push({ text: '准备相关资料和方案' })
    items.push({ text: '确认会面时间和地点' })
    items.push({ text: '准备名片和笔记本' })
    items.push({ text: '了解对方背景信息', optional: true })
    return items
  }
  if (/截止|提交|交付|报送|上报/.test(title)) {
    items.push({ text: '检查材料完整性' })
    items.push({ text: '准备备份文件' })
    items.push({ text: '确认提交渠道和格式' })
    return items
  }
  if (/考试|面试|考核|答辩/.test(title)) {
    items.push({ text: '复习重点知识' })
    items.push({ text: '准备证件和文具' })
    items.push({ text: '调整作息保证状态' })
    items.push({ text: '准备自我介绍/简历', optional: true })
    return items
  }
  if (/旅行|出差|出发|启程|航班|高铁|火车/.test(title)) {
    items.push({ text: '确认行程和票据' })
    items.push({ text: '准备行李清单' })
    items.push({ text: '检查证件有效性' })
    items.push({ text: '预订住宿和交通', optional: true })
    return items
  }
  if (/发布|上线|部署|发版|release/.test(title)) {
    items.push({ text: '完成最终测试验证' })
    items.push({ text: '准备发布说明文档' })
    items.push({ text: '确认回滚方案' })
    items.push({ text: '通知相关方', optional: true })
    return items
  }

  // 默认准备清单
  items.push({ text: '梳理任务要点和目标' })
  items.push({ text: '准备所需材料' })
  items.push({ text: '确认时间和资源' })
  return items
}

export async function generatePreparation(userId: string): Promise<PreparationResult> {
  const now = new Date()
  const horizon = new Date(now)
  horizon.setDate(horizon.getDate() + 3) // 未来 3 天

  // 查询未来 3 天内未完成的重要/紧急任务
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      status: { not: 'done' },
      dueDate: { gte: now, lte: horizon },
      OR: [
        { important: true },
        { priority: { in: ['urgent', 'high'] } },
      ],
    },
    orderBy: [{ important: 'desc' }, { priority: 'desc' }, { dueDate: 'asc' }],
    take: 5,
  })

  if (tasks.length === 0) {
    return {
      events: [],
      totalChecklistItems: 0,
      summary: '未来 3 天暂无重要事件需要准备。继续保持节奏~',
      generatedAt: now.toISOString(),
    }
  }

  const events: PreparationEvent[] = tasks.map((t) => {
    const dueDate = new Date(t.dueDate!)
    const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000)
    return {
      taskId: t.id,
      title: t.title,
      dueDate: dueDate.toISOString(),
      daysLeft: Math.max(0, daysLeft),
      priority: t.priority,
      important: t.important,
      category: t.category,
      checklist: generateChecklist(t.title),
    }
  })

  const totalChecklistItems = events.reduce((s, e) => s + e.checklist.length, 0)
  const urgentCount = events.filter((e) => e.daysLeft <= 1).length

  const summaryParts: string[] = []
  summaryParts.push(`发现 ${events.length} 个重要事件需要准备`)
  summaryParts.push(`共 ${totalChecklistItems} 项准备事项`)
  if (urgentCount > 0) {
    summaryParts.push(`其中 ${urgentCount} 个事件在 24 小时内`)
  }
  const summary = summaryParts.join('，') + '。'

  return {
    events,
    totalChecklistItems,
    summary,
    generatedAt: now.toISOString(),
  }
}

/**
 * DG-06 实时规划：时段块定义
 * - warmup：热身回顾（梳理待办、列重点）
 * - focus：深度专注（处理重要任务）
 * - break：休息放松
 * - routine：常规事务（次要任务、邮件、回复消息）
 * - review：复盘总结
 */
export interface ScheduleBlock {
  time: string
  type: 'warmup' | 'focus' | 'break' | 'routine' | 'review'
  title: string
  reason: string
}

export interface ScheduleResult {
  range: { label: string; start: string; end: string }
  blocks: ScheduleBlock[]
  tips: string[]
  summary: string
}

/**
 * 解析规划时段
 * - 支持关键词：上午/下午/晚上/今天/明天/全天
 * - 默认：从当前时间到 18:00
 */
export function parsePlanRange(text: string): { label: string; startH: number; endH: number; isTomorrow: boolean } {
  const isTomorrow = /明天|明日|tomorrow/.test(text)
  const isMorning = /上午|早上|早晨/.test(text)
  const isAfternoon = /下午|午后/.test(text)
  const isEvening = /晚上|晚间|夜晚/.test(text)
  const isFullDay = /全天|今天一天|一天/.test(text)

  if (isMorning) return { label: isTomorrow ? '明天上午' : '今天上午', startH: 9, endH: 12, isTomorrow }
  if (isAfternoon) return { label: isTomorrow ? '明天下午' : '今天下午', startH: 14, endH: 18, isTomorrow }
  if (isEvening) return { label: isTomorrow ? '明天晚上' : '今天晚上', startH: 19, endH: 22, isTomorrow }
  if (isFullDay) return { label: isTomorrow ? '明天全天' : '今天全天', startH: 9, endH: 22, isTomorrow }

  // 默认：当前时段到 18:00（或晚上 22:00）
  const now = new Date().getHours()
  if (now < 12) return { label: '今天上午', startH: Math.max(now, 9), endH: 12, isTomorrow }
  if (now < 18) return { label: '今天下午', startH: Math.max(now + 1, 14), endH: 18, isTomorrow }
  return { label: '今天晚上', startH: Math.max(now + 1, 19), endH: 22, isTomorrow }
}

/**
 * 生成时段规划
 *
 * 算法：
 * 1. 解析用户指定的时间范围
 * 2. 查询该时段内的待办任务和提醒
 * 3. 基于任务优先级、睡眠状态、饮食记录，分配时段块
 * 4. 每个时段不超过 90 分钟（深度专注），中间插入 15 分钟休息
 * 5. 优先处理 urgent/important 任务，routine 处理常规事务
 */
export async function generateSchedule(content: string, userId: string): Promise<ScheduleResult> {
  const range = parsePlanRange(content)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const targetDate = new Date(today)
  if (range.isTomorrow) targetDate.setDate(targetDate.getDate() + 1)
  const rangeStart = new Date(targetDate)
  rangeStart.setHours(range.startH, 0, 0, 0)
  const rangeEnd = new Date(targetDate)
  rangeEnd.setHours(range.endH, 0, 0, 0)

  // 并行查询：待办任务 + 提醒 + 昨晚睡眠 + 今日饮食
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const [pendingTasks, rangeReminders, lastSleep, todayDiets] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        status: { not: 'done' },
        OR: [
          { dueDate: { gte: rangeStart, lt: rangeEnd } },
          { dueDate: null, important: true },
          { dueDate: null },
        ],
      },
      orderBy: [{ important: 'desc' }, { priority: 'desc' }],
      take: 10,
    }),
    prisma.reminder.findMany({
      where: {
        userId,
        done: false,
        remindAt: { gte: rangeStart, lt: rangeEnd },
      },
      orderBy: { remindAt: 'asc' },
    }),
    prisma.sleep.findFirst({
      where: { userId, sleepDate: { gte: yesterday, lt: today } },
      orderBy: { sleepDate: 'desc' },
    }),
    prisma.diet.findMany({
      where: { userId, eatenAt: { gte: today, lt: tomorrow } },
      select: { mealType: true, calories: true },
    }),
  ])

  // 按 priority 排序任务，urgent > high > medium > low
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
  const sortedTasks = [...pendingTasks].sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 2
    const pb = priorityOrder[b.priority] ?? 2
    if (pa !== pb) return pa - pb
    // important 优先
    if (a.important && !b.important) return -1
    if (!a.important && b.important) return 1
    return 0
  })

  const blocks: ScheduleBlock[] = []
  const tips: string[] = []
  let cursor = range.startH
  // 将小数小时转为 "HH:MM" 格式（如 9.25 → "09:15"）
  const fmtTime = (h: number) => {
    const hh = Math.floor(h)
    const mm = Math.round((h - hh) * 60)
    // 处理 60 分钟进位（如 9.999 → 10:00）
    if (mm === 60) {
      return `${String(hh + 1).padStart(2, '0')}:00`
    }
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  // 将小时+分钟转为 "HH:MM" 格式（用于提醒时间）
  const fmtHM = (h: number, m: number) =>
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

  // 睡眠不足提示
  if (lastSleep && lastSleep.durationMin < 360) {
    tips.push('昨晚睡眠不足 6 小时，建议每专注 60 分钟休息一次')
  } else if (lastSleep && lastSleep.durationMin > 540) {
    tips.push('昨晚睡眠偏多，今天精力应该不错，可适当增加专注时长')
  }

  // 饮食提示
  if (todayDiets.length === 0 && new Date().getHours() >= 12 && !range.isTomorrow) {
    tips.push('今日尚未记录饮食，记得按时吃饭')
  }

  // 1. 开场热身（15 分钟）
  if (cursor < range.endH) {
    blocks.push({
      time: `${fmtTime(cursor)} - ${fmtTime(cursor + 0.25)}`,
      type: 'warmup',
      title: '回顾待办，列出重点',
      reason: '快速过一遍今日任务，明确优先级，避免被琐事带偏',
    })
    cursor = cursor + 0.25 // +15min
  }

  // 2. 分配任务到时段块
  // 每个 focus 块 60-90 分钟，中间穿插 15 分钟 break
  let taskIdx = 0
  while (cursor < range.endH - 1 && taskIdx < sortedTasks.length) {
    const task = sortedTasks[taskIdx]
    const isUrgent = task.priority === 'urgent' || task.important
    // 睡眠不足时缩短专注时长
    const focusDur = lastSleep && lastSleep.durationMin < 360 ? 60 : 90
    const endH = Math.min(cursor + focusDur / 60, range.endH)
    if (endH - cursor < 0.5) break // 剩余时间不足 30 分钟，不再安排

    blocks.push({
      time: `${fmtTime(cursor)} - ${fmtTime(endH)}`,
      type: 'focus',
      title: `${isUrgent ? '🔴 ' : ''}${task.title}`,
      reason: isUrgent
        ? '重要/紧急任务，优先处理'
        : `优先级 ${task.priority}，安排在精力较好的时段`,
    })

    cursor = endH

    // 安排 15 分钟休息（除非是最后一个块）
    if (cursor + 0.5 < range.endH && taskIdx < sortedTasks.length - 1) {
      blocks.push({
        time: `${fmtTime(cursor)} - ${fmtTime(cursor + 0.25)}`,
        type: 'break',
        title: '休息 15 分钟',
        reason: '喝水、活动、远眺，避免久坐疲劳',
      })
      cursor += 0.25
    }

    taskIdx++
  }

  // 3. 插入今日提醒（按时间点）
  rangeReminders.forEach((r) => {
    const rTime = new Date(r.remindAt)
    const rH = rTime.getHours()
    const rM = rTime.getMinutes()
    if (rH >= range.startH && rH < range.endH) {
      blocks.push({
        time: `${fmtHM(rH, rM)} ⏰`,
        type: 'routine',
        title: `提醒：${r.title}`,
        reason: r.level === 'urgent' ? '紧急提醒，请按时处理' : '已安排的提醒事项',
      })
    }
  })

  // 4. 复盘总结（最后 15 分钟）
  if (cursor + 0.25 <= range.endH) {
    blocks.push({
      time: `${fmtTime(range.endH - 0.25)} - ${fmtTime(range.endH)}`,
      type: 'review',
      title: '复盘今日成果，规划明日重点',
      reason: '回顾完成情况，把未完成项挪到明天，保持节奏',
    })
  }

  // 按 type 重新排序：warmup → focus → routine → break → review
  // 但保留 time 顺序，所以按 time 排序（time 字符串前 5 字符可比较）
  blocks.sort((a, b) => a.time.localeCompare(b.time))

  // 默认提示
  if (tips.length === 0) {
    tips.push('建议每专注 90 分钟休息一次')
    if (pendingTasks.length > 5) {
      tips.push(`今日有 ${pendingTasks.length} 项待办，必要时可拒绝或简化低优先级任务`)
    }
  }

  const summary = `📅 已为你规划${range.label}的时段安排，共 ${blocks.filter(b => b.type === 'focus').length} 个专注块。${pendingTasks.length > 0 ? `覆盖 ${Math.min(taskIdx, pendingTasks.length)}/${pendingTasks.length} 项待办。` : '当前没有待办任务，安排了热身和复盘。'}`

  return {
    range: {
      label: range.label,
      start: fmtTime(range.startH),
      end: fmtTime(range.endH),
    },
    blocks,
    tips,
    summary,
  }
}

/**
 * DG-16 危机信号检测
 *
 * 设计原则（合规）：
 * - 仅识别"风险信号"，不生成任何鼓励/指导性内容
 * - 直接引导用户到专业危机干预资源（热线、心理援助机构）
 * - 不替代专业诊断，不分析风险等级细节
 *
 * 三个等级：
 * - critical：明确表达自杀意念或自伤计划（立即干预）
 * - high：情绪极度低落、无望感、想消失（高度关注）
 * - moderate：负面情绪、压力大、疲惫（关怀提示）
 */