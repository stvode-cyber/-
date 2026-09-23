import crypto from 'crypto'
import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'
import { auditReq } from '../utils/audit.js'
import { llmGenerateChat } from '../services/llmService.js'

/**
 * 碎片信息收集（DG-07）
 *
 * 用户在对话中发送的文字/链接/想法，AI 自动分类存储。
 * 后续隔夜整合卡片（DG-08）会将当日碎片汇总为结构化总结。
 *
 * 数据模型 Fragment（表 fragments）：
 * - id: cuid
 * - userId: 用户 ID
 * - content: 原始内容
 * - kind: note | link | todo | idea | snippet
 * - tags: JSON 数组字符串
 * - sourceMsgId: 来源消息 ID
 * - digested: 是否已被隔夜整合
 * - note: 备注
 * - createdAt: 创建时间
 *
 * 注意：因 prisma client 未重新生成（环境无 node），此处使用 $queryRaw / $executeRaw
 * 操作 fragments 表，待 prisma generate 后可切换为 prisma.fragment。
 */

const router = Router()
router.use(authRequired)

/** Fragment 行结构（与数据库表对应） */
interface FragmentRow {
  id: string
  userId: string
  content: string
  kind: string
  tags: string | null
  sourceMsgId: string | null
  digested: number
  note: string | null
  createdAt: string
}

/** 前端返回结构（tags 解析为数组，digested 转为布尔） */
interface FragmentDTO {
  id: string
  content: string
  kind: string
  tags: string[]
  sourceMsgId: string | null
  digested: boolean
  note: string | null
  createdAt: string
}

/** 将数据库行转为前端 DTO */
function toDTO(row: FragmentRow): FragmentDTO {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags || '[]')
    if (Array.isArray(parsed)) tags = parsed
  } catch { /* ignore */ }
  return {
    id: row.id,
    content: row.content,
    kind: row.kind,
    tags,
    sourceMsgId: row.sourceMsgId,
    digested: row.digested === 1,
    note: row.note,
    createdAt: row.createdAt,
  }
}

/** 生成 cuid（SQLite 不支持 @default(cuid())，需手动生成）
 * P3 修复：随机部分改用 crypto.randomBytes，替代可预测的 Math.random
 */
function generateId(): string {
  const ts = Date.now().toString(36)
  const rand = crypto.randomBytes(5).toString('hex') // 10 个十六进制字符
  return `c${ts}${rand}`
}

/**
 * AI 碎片分类器
 * - 检测 URL → link
 * - 检测代码标记 → snippet
 * - 检测待办线索 → todo
 * - 检测灵感关键词 → idea
 * - 默认 → note
 */
function classifyFragment(content: string): { kind: string; tags: string[] } {
  const tags: string[] = []

  // URL 检测
  if (/https?:\/\/[^\s]+/i.test(content)) {
    tags.push('链接')
    return { kind: 'link', tags }
  }

  // 代码片段检测（``` 或行首 4 空格 / 函数定义）
  if (/```|^\s{4}|function |const |let |import |class /.test(content)) {
    tags.push('代码')
    return { kind: 'snippet', tags }
  }

  // 待办线索
  if (/应该|需要|记得|待办|要做|得去|别忘了|提醒我/.test(content)) {
    tags.push('待办')
    return { kind: 'todo', tags }
  }

  // 灵感/想法
  if (/想法|灵感|idea|如果|能不能|突然觉得|或许可以|不如/.test(content)) {
    tags.push('灵感')
    return { kind: 'idea', tags }
  }

  // 按内容分类标签
  if (/工作|项目|任务|会议|客户/.test(content)) tags.push('工作')
  if (/生活|家庭|健康|运动|饮食/.test(content)) tags.push('生活')
  if (/钱|消费|收入|支出|理财/.test(content)) tags.push('财务')
  if (/学习|读书|课程|笔记/.test(content)) tags.push('学习')

  return { kind: 'note', tags }
}

/**
 * AI 智能碎片分类（增强版）
 *
 * 调用 LLM 对碎片内容做语义级分类，返回 kind / tags / note（一句话摘要）。
 * - LLM 不可用 / 超时 / 输出格式异常 → 回退到规则引擎 classifyFragment
 * - 超时阈值 8 秒，避免快速输入场景长时间阻塞
 * - 始终返回有效结果，永不抛错（最差回退到规则）
 *
 * @param content 用户随手输入的原始内容
 * @returns { kind, tags, note, source: 'ai' | 'rule' }
 */
async function aiClassifyFragment(content: string): Promise<{
  kind: string
  tags: string[]
  note: string | null
  source: 'ai' | 'rule'
}> {
  // 规则回退
  const ruleFallback = () => {
    const r = classifyFragment(content)
    return { kind: r.kind, tags: r.tags, note: null, source: 'rule' as const }
  }

  try {
    const systemPrompt = `你是内容分类助手。请将用户输入的内容分类到以下 5 种之一：
- note: 普通笔记、记录、备忘
- link: 网址、链接、引用来源
- todo: 待办事项、需要去做的事、提醒
- idea: 灵感、想法、创意、可能性探讨
- snippet: 代码片段、技术命令、配置

请只返回纯 JSON（不要 markdown 代码块），格式：
{"kind":"note|link|todo|idea|snippet","tags":["标签1","标签2"],"note":"一句话摘要"}

要求：
- kind 必须是上述 5 种之一
- tags 最多 3 个，每个 2-6 字
- note 不超过 30 字，概括内容主旨
- 若内容含义模糊，kind 返回 "note"`

    const result = await llmGenerateChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ])

    if (!result || !result.text) return ruleFallback()

    // LLM 可能包裹 ```json ... ```，做容错提取
    let raw = result.text.trim()
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) raw = fenceMatch[1].trim()
    // 尝试提取首个 { ... } 块
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return ruleFallback()
    const parsed = JSON.parse(jsonMatch[0])

    const validKinds = ['note', 'link', 'todo', 'idea', 'snippet']
    const kind = validKinds.includes(parsed.kind) ? parsed.kind : 'note'
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: unknown) => typeof t === 'string').slice(0, 3)
      : []
    const note = typeof parsed.note === 'string' && parsed.note.trim()
      ? parsed.note.trim().slice(0, 50)
      : null

    return { kind, tags, note, source: 'ai' }
  } catch (err) {
    console.warn('[fragment/quick] AI 分类失败，回退规则引擎:', (err as Error).message)
    return ruleFallback()
  }
}

/** 随手记快速创建 schema：仅需 content，AI 自动分类 */
const quickCreateSchema = z.object({
  content: z.string().min(1).max(2000),
})

/**
 * 随手记快速创建（AI 自动分类）
 *
 * - 接收纯文本 content
 * - 调 LLM 做语义级分类（kind + tags + note 摘要）
 * - LLM 不可用/超时/异常 → 回退到规则引擎 classifyFragment
 * - 创建 Fragment 记录
 * - 返回完整 Fragment DTO + 分类来源标识
 *
 * 与 POST / 区别：本端点强制走 AI 分类（用户无需选 kind），适合"随手记"快速输入场景。
 */
router.post('/quick', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = quickCreateSchema.parse(req.body)
    const content = body.content.trim()
    if (!content) throw new HttpError('内容不能为空', 422)

    const { kind, tags, note, source } = await aiClassifyFragment(content)
    const id = generateId()
    const tagsJson = JSON.stringify(tags)

    await prisma.$executeRaw`INSERT INTO fragments (id, userId, content, kind, tags, sourceMsgId, digested, note, createdAt) VALUES (${id}, ${userId}, ${content}, ${kind}, ${tagsJson}, NULL, 0, ${note}, datetime('now'))`

    const rows = await prisma.$queryRaw<FragmentRow[]>`SELECT * FROM fragments WHERE id = ${id}`
    const dto = rows.length > 0 ? toDTO(rows[0]) : null

    auditReq(req, res, {
      category: 'fragment',
      action: 'quick_create',
      targetType: 'Fragment',
      targetId: id,
      summary: `随手记: ${content.slice(0, 30)}`,
      detail: { kind, tags, source },
    })

    // 返回 DTO + 分类来源（前端可据此提示"AI 分类"或"规则分类"）
    success(res, { ...dto, classifySource: source })
  } catch (e) {
    next(e)
  }
})

/** 创建碎片 */
const createSchema = z.object({
  content: z.string().min(1).max(2000),
  kind: z.enum(['note', 'link', 'todo', 'idea', 'snippet']).optional(),
  tags: z.array(z.string()).optional(),
  sourceMsgId: z.string().optional(),
  note: z.string().optional(),
})

/** 碎片列表（按日期/类型过滤） */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const kind = req.query.kind as string | undefined
    const date = req.query.date as string | undefined

    const conditions: Prisma.Sql[] = [Prisma.sql`userId = ${userId}`]
    if (kind) {
      conditions.push(Prisma.sql`AND kind = ${kind}`)
    }
    if (date) {
      conditions.push(Prisma.sql`AND date(createdAt) = date(${date})`)
    }

    const rows = await prisma.$queryRaw<FragmentRow[]>`SELECT * FROM fragments WHERE ${Prisma.join(conditions, ' ')} ORDER BY createdAt DESC LIMIT 100`
    const dtos = rows.map(toDTO)
    success(res, dtos)
  } catch (e) {
    next(e)
  }
})

/** 创建碎片（自动分类） */
router.post('/', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const body = createSchema.parse(req.body)

    // 若未指定 kind，自动分类
    const { kind, tags } = body.kind
      ? { kind: body.kind, tags: body.tags || [] }
      : classifyFragment(body.content)
    const finalTags = body.tags && body.tags.length > 0 ? body.tags : tags
    const id = generateId()

    const tagsJson = JSON.stringify(finalTags)
    const sourceMsgId = body.sourceMsgId || null
    const note = body.note || null
    await prisma.$executeRaw`INSERT INTO fragments (id, userId, content, kind, tags, sourceMsgId, digested, note, createdAt) VALUES (${id}, ${userId}, ${body.content}, ${kind}, ${tagsJson}, ${sourceMsgId}, 0, ${note}, datetime('now'))`

    const rows = await prisma.$queryRaw<FragmentRow[]>`SELECT * FROM fragments WHERE id = ${id}`
    const dto = rows.length > 0 ? toDTO(rows[0]) : null

    auditReq(req, res, {
      category: 'fragment',
      action: 'create',
      targetType: 'Fragment',
      targetId: id,
      summary: `创建碎片: ${body.content.slice(0, 30)}`,
      detail: { kind, tags: finalTags },
    })

    success(res, dto)
  } catch (e) {
    next(e)
  }
})

/** 编辑碎片 schema：所有字段可选，支持内容/分类/标签/备注调整 */
const updateSchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  kind: z.enum(['note', 'link', 'todo', 'idea', 'snippet']).optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().max(500).optional().nullable(),
})

/**
 * 编辑碎片（DG-07 补全）
 *
 * 用途：用户手动调整碎片的内容、分类、标签或备注。
 *
 * 行为：
 * - 仅更新请求中传入的字段（PATCH 语义）
 * - kind/tags/note 显式传入即覆盖；未传字段保持原值
 * - 通过 SET 子句动态拼接，避免全字段覆盖
 * - 写入审计：fragment.update
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const id = req.params.id
    const body = updateSchema.parse(req.body)

    // 先校验碎片归属当前用户
    const rows = await prisma.$queryRaw<FragmentRow[]>`SELECT * FROM fragments WHERE id = ${id} AND userId = ${userId}`
    if (rows.length === 0) {
      throw new HttpError('碎片不存在', 404)
    }

    // 动态拼接 SET 子句
    const setClauses: Prisma.Sql[] = []
    if (body.content !== undefined) {
      setClauses.push(Prisma.sql`content = ${body.content}`)
    }
    if (body.kind !== undefined) {
      setClauses.push(Prisma.sql`kind = ${body.kind}`)
    }
    if (body.tags !== undefined) {
      setClauses.push(Prisma.sql`tags = ${JSON.stringify(body.tags)}`)
    }
    if (body.note !== undefined) {
      setClauses.push(Prisma.sql`note = ${body.note}`)
    }

    if (setClauses.length === 0) {
      // 无字段更新，直接返回当前 DTO
      return success(res, toDTO(rows[0]))
    }

    await prisma.$executeRaw`UPDATE fragments SET ${Prisma.join(setClauses, ', ')} WHERE id = ${id} AND userId = ${userId}`

    // 读取更新后的行
    const updated = await prisma.$queryRaw<FragmentRow[]>`SELECT * FROM fragments WHERE id = ${id}`

    auditReq(req, res, {
      category: 'fragment',
      action: 'update',
      targetType: 'Fragment',
      targetId: id,
      summary: `编辑碎片: ${body.content?.slice(0, 30) || rows[0].content.slice(0, 30)}`,
      detail: { updatedFields: Object.keys(body) },
    })

    success(res, updated.length > 0 ? toDTO(updated[0]) : null)
  } catch (e) {
    next(e)
  }
})

/** 删除碎片 */
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const id = req.params.id

    const rows = await prisma.$queryRaw<FragmentRow[]>`SELECT * FROM fragments WHERE id = ${id} AND userId = ${userId}`
    if (rows.length === 0) {
      throw new HttpError('碎片不存在', 404)
    }

    await prisma.$executeRaw`DELETE FROM fragments WHERE id = ${id} AND userId = ${userId}`

    auditReq(req, res, {
      category: 'fragment',
      action: 'delete',
      targetType: 'Fragment',
      targetId: id,
      summary: `删除碎片: ${rows[0].content.slice(0, 30)}`,
    })

    success(res, { id })
  } catch (e) {
    next(e)
  }
})

/** 今日碎片统计 */
router.get('/stats', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const today = new Date().toISOString().slice(0, 10)

    const rows = await prisma.$queryRaw<{ kind: string; count: number }[]>`SELECT kind, COUNT(*) as count FROM fragments WHERE userId = ${userId} AND date(createdAt) = date(${today}) GROUP BY kind`

    const stats: Record<string, number> = { note: 0, link: 0, todo: 0, idea: 0, snippet: 0 }
    rows.forEach((r) => {
      stats[r.kind] = Number(r.count)
    })

    const totalCount = Object.values(stats).reduce((s, c) => s + c, 0)

    success(res, { date: today, byKind: stats, total: totalCount })
  } catch (e) {
    next(e)
  }
})

/**
 * 隔夜整合卡片（DG-08）
 *
 * 用途：每日整理碎片收获，生成结构化总结。
 *
 * 流程：
 * 1. 读取当日（或指定日期）未整合的碎片（digested=0）
 * 2. 按 kind 分组，每组取前 3 条作为 highlights
 * 3. 聚合所有 tags，按出现频次排序取前 8
 * 4. 提取 todo 类型碎片作为待跟进事项
 * 5. 生成自然语言总结
 * 6. 标记所有碎片为已整合（digested=1）
 * 7. 写入审计：fragment.digest
 *
 * 幂等：若当日已无未整合碎片，返回空摘要 + 提示
 */
router.post('/digest', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const date = (req.body?.date as string | undefined) || new Date().toISOString().slice(0, 10)

    // 读取当日未整合碎片
    const rows = await prisma.$queryRaw<FragmentRow[]>`SELECT * FROM fragments WHERE userId = ${userId} AND date(createdAt) = date(${date}) AND digested = 0 ORDER BY createdAt ASC`

    if (rows.length === 0) {
      const digestedCount = await prisma.$queryRaw<{ count: number }[]>`SELECT COUNT(*) as count FROM fragments WHERE userId = ${userId} AND date(createdAt) = date(${date}) AND digested = 1`
      const alreadyDigested = Number(digestedCount[0]?.count || 0) > 0
      return res.json(
        success(res, {
          date,
          totalCount: 0,
          byKind: [],
          topTags: [],
          todoItems: [],
          summary: alreadyDigested ? '今日碎片已整合完毕，无需重复整合' : '今日暂无碎片记录',
          generatedAt: new Date().toISOString(),
        }),
      )
    }

    const dtos = rows.map(toDTO)

    // 1. 按 kind 分组
    const kindGroups: Record<string, typeof dtos> = {}
    for (const f of dtos) {
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

    // 每组取 highlights（前 3 条，截断 60 字符）
    const byKind = Object.keys(kindGroups).map((kind) => ({
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
    for (const f of dtos) {
      for (const tag of f.tags) {
        tagCount[tag] = (tagCount[tag] || 0) + 1
      }
    }
    const topTags = Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }))

    // 3. 提取 todo 类型的待跟进事项
    const todoItems = dtos
      .filter((f) => f.kind === 'todo')
      .map((f) => f.content.length > 80 ? f.content.slice(0, 80) + '…' : f.content)

    // 4. 生成总结文案
    const summaryParts: string[] = []
    summaryParts.push(`今日共记录 ${dtos.length} 条碎片`)
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

    auditReq(req, res, {
      category: 'fragment',
      action: 'digest',
      targetType: 'Fragment',
      summary: `隔夜整合: ${date} ${dtos.length} 条碎片`,
      detail: {
        date,
        count: dtos.length,
        byKind: byKind.map((g) => ({ kind: g.kind, count: g.count })),
      },
    })

    res.json(
      success(res, {
        date,
        totalCount: dtos.length,
        byKind,
        topTags,
        todoItems,
        summary,
        generatedAt: new Date().toISOString(),
      }),
    )
  } catch (e) {
    next(e)
  }
})

/**
 * 跨信息关联（DG-09）
 *
 * 用途：发现碎片间的关联，主动提示并建议行动。
 *
 * 算法：
 * 1. 读取最近 7 天的碎片
 * 2. 按 tag 聚合，找出有 2+ 碎片的标签
 * 3. 为每个关联组生成建议行动：
 *    - 工作/项目 → 建议创建项目任务
 *    - 待办 → 建议加入任务清单
 *    - 灵感 → 建议整理为笔记
 *    - 学习 → 建议汇总为学习主题
 *    - 财务 → 建议纳入预算规划
 *    - 其他 → 建议回顾关联内容
 * 4. 返回关联组列表
 */
router.get('/connections', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const days = Math.min(Number(req.query.days as string) || 7, 90)
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString().slice(0, 10)
    // P2 修复：范围查询替代 date(createdAt) 套函数，命中 (userId, createdAt) 复合索引
    const sinceStart = `${sinceStr}T00:00:00.000Z`

    const rows = await prisma.$queryRaw<FragmentRow[]>`SELECT * FROM fragments WHERE userId = ${userId} AND createdAt >= ${sinceStart} ORDER BY createdAt DESC LIMIT 200`

    if (rows.length === 0) {
      return success(res, {
        days,
        totalCount: 0,
        connections: [],
        summary: '最近无碎片记录，发送文字/链接/想法即可开始收集。',
      })
    }

    const dtos = rows.map(toDTO)

    // 按 tag 聚合
    const tagGroups: Record<string, typeof dtos> = {}
    for (const f of dtos) {
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
    const connections = Object.entries(tagGroups)
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
        : `最近 ${days} 天共 ${dtos.length} 条碎片，暂无明显关联`

    res.json(
      success(res, {
        days,
        totalCount: dtos.length,
        connections,
        summary,
      }),
    )
  } catch (e) {
    next(e)
  }
})

/**
 * 跨信息关联洞察（DG-09 进阶）
 *
 * 用途：在 /connections（按 tag 聚合碎片）之上，进一步跨越模块边界，
 *       发现「碎片 ↔ 任务/账单/提醒」之间的潜在关联与未闭环事项。
 *
 * 检测信号：
 * 1. orphanTodos：碎片中含「待办」语义但未在任务表中找到对应任务（待办流失）
 * 2. unactedIdeas：含「灵感/想法」关键词但近 3 天未产生相关任务（灵感搁置）
 * 3. financeMentions：含「金额/支出/收入」语义但未在账单中找到对应记录（财务挂账）
 * 4. taskEchoes：任务标题在碎片中重复出现（任务有相关思考但未沉淀）
 *
 * 与 /connections 的差异：
 * - /connections 仅看碎片内部 tag 聚类
 * - /insights 跨表查询，输出"未闭环"信号，更偏行动建议
 *
 * 性能：4 个独立查询并行执行，限制每个信号最多 5 条，避免响应膨胀
 */
router.get('/insights', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const days = Math.min(Number(req.query.days as string) || 7, 90)
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString().slice(0, 10)
    // P2 修复：范围查询替代 date(createdAt) 套函数，命中 (userId, createdAt) 复合索引
    const sinceStart = `${sinceStr}T00:00:00.000Z`

    // 并行查询：碎片 + 近期任务 + 近期账单
    const [fragRows, tasks, bills] = await Promise.all([
      prisma.$queryRaw<FragmentRow[]>`SELECT * FROM fragments WHERE userId = ${userId} AND createdAt >= ${sinceStart} ORDER BY createdAt DESC LIMIT 200`,
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

    const fragments = fragRows.map(toDTO)

    // ---- 信号 1：orphanTodos - 待办碎片未对应任务 ----
    // 提取碎片正文关键词（去停用词后取前 4 字），检查任务标题是否包含
    const todoFrags = fragments.filter((f) => f.kind === 'todo' || /待办|要做|得去|记得|别忘了|提醒我/.test(f.content))
    const taskTitles = tasks.map((t) => t.title)
    const orphanTodos = todoFrags
      .filter((f) => {
        // 简易匹配：取碎片内容前 5 字作为关键词，看是否在任务标题中出现
        const kw = f.content.replace(/应该|需要|记得|待办|要做|得去|别忘了|提醒我|完成|处理/g, '').trim().slice(0, 5)
        if (!kw) return true // 关键词为空，视为未对应
        return !taskTitles.some((t) => t.includes(kw) || kw.includes(t.slice(0, 4)))
      })
      .slice(0, 5)
      .map((f) => ({
        fragmentId: f.id,
        content: f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content,
        createdAt: f.createdAt,
        suggestion: '建议转为任务，纳入待办清单跟踪',
      }))

    // ---- 信号 2：unactedIdeas - 灵感碎片近 3 天未触发任务 ----
    const ideaFrags = fragments.filter((f) => f.kind === 'idea')
    const recent3d = new Date()
    recent3d.setDate(recent3d.getDate() - 3)
    const unactedIdeas = ideaFrags
      .filter((f) => new Date(f.createdAt) < recent3d)
      .slice(0, 5)
      .map((f) => ({
        fragmentId: f.id,
        content: f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content,
        createdAt: f.createdAt,
        suggestion: '灵感已搁置 3 天以上，建议整理为笔记或转为任务',
      }))

    // ---- 信号 3：financeMentions - 含金额语义但未入账 ----
    // 匹配「¥/元/块 + 数字」或「花了/收入/支出」关键词
    const financeFrags = fragments.filter(
      (f) => /(\d+(\.\d+)?)\s*(元|块|￥|¥)|花了|收入|支出|消费|入账/.test(f.content),
    )
    const billTitles = bills.map((b) => b.title)
    const financeMentions = financeFrags
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

    // ---- 信号 4：taskEchoes - 任务标题在碎片中重复出现（任务有相关思考） ----
    const taskEchoes = tasks
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
          })),
        }
      })
      .filter((e) => e.echoCount > 0)
      .slice(0, 5)

    // ---- 汇总 ----
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

    auditReq(req, res, {
      category: 'fragment',
      action: 'insights',
      targetType: 'Fragment',
      summary: `跨信息关联洞察: ${signalCount} 个信号`,
      detail: {
        days,
        orphanTodos: orphanTodos.length,
        unactedIdeas: unactedIdeas.length,
        financeMentions: financeMentions.length,
        taskEchoes: taskEchoes.length,
      },
    })

    res.json(
      success(res, {
        days,
        totalCount: fragments.length,
        signals: {
          orphanTodos,
          unactedIdeas,
          financeMentions,
          taskEchoes,
        },
        signalCount,
        summary,
        generatedAt: new Date().toISOString(),
      }),
    )
  } catch (e) {
    next(e)
  }
})

export default router
