/**
 * 用户资料库（AI 记忆 / Obsidian 式）服务
 *
 * 每个账号一套独立 vault：
 * - 对话结束后异步调 LLM 提炼"值得长期记住的用户资料"→ 结构化笔记入库（title 去重，重复即更新）
 * - 对话前按用户消息关键词检索 + 置顶笔记 → 注入 LLM 系统提示，让 AI"记得"用户
 * - 提供完整 CRUD，用户可在设置页查看/编辑/删除自己的资料库
 */
import { prisma } from '../lib/prisma.js'
import { llmGenerateChat, type ChatMessage } from './llmService.js'

// 白名单分类（防 LLM 幻觉）
export const VAULT_CATEGORIES = ['person', 'preference', 'event', 'timeline', 'other'] as const
export type VaultCategory = (typeof VAULT_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<string, string> = {
  person: '人物',
  preference: '偏好',
  event: '事项',
  timeline: '时间线',
  other: '其他',
}

export interface VaultNoteDTO {
  id: string
  title: string
  category: string
  content: string
  tags: string[]
  pinned: boolean
  source: string
  createdAt: Date
  updatedAt: Date
}

function toDTO(n: {
  id: string; title: string; category: string; content: string;
  tags: string | null; pinned: boolean; source: string;
  createdAt: Date; updatedAt: Date;
}): VaultNoteDTO {
  let tags: string[] = []
  try { tags = n.tags ? JSON.parse(n.tags) : [] } catch { tags = [] }
  return {
    id: n.id, title: n.title, category: n.category, content: n.content,
    tags, pinned: n.pinned, source: n.source,
    createdAt: n.createdAt, updatedAt: n.updatedAt,
  }
}

// ============ 检索：关键词评分 ============

/**
 * 按用户消息检索相关笔记（注入对话上下文用）
 * 策略：置顶笔记全带 + 关键词命中评分，取前 N 条
 */
export async function searchVaultNotes(userId: string, message: string, limit = 8): Promise<VaultNoteDTO[]> {
  let notes: Awaited<ReturnType<typeof prisma.vaultNote.findMany>>
  try {
    notes = await prisma.vaultNote.findMany({
      where: { userId },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    })
  } catch (e: any) {
    // 兜底：DB 有损坏行（如 DATETIME 空字符串）时 Prisma 会抛 Inconsistent column data
    console.warn('[vault] searchVaultNotes 查询失败（DB 可能有坏数据），返回空:', e.message?.substring(0, 120))
    return []
  }
  if (notes.length === 0) return []

  // 分词：2-gram（中文无空格，滑动窗口）+ 英文/数字词
  const tokens = new Set<string>()
  const words = message.toLowerCase().match(/[a-z0-9]+/g) || []
  for (const w of words) if (w.length >= 2) tokens.add(w)
  for (let i = 0; i < message.length - 1; i++) {
    const bigram = message.slice(i, i + 2)
    if (!/[\s\d\p{P}]/u.test(bigram)) tokens.add(bigram)
  }

  const scored = notes.map((n) => {
    const hay = `${n.title} ${n.content} ${n.tags || ''}`.toLowerCase()
    let score = 0
    for (const t of tokens) {
      if (n.title.toLowerCase().includes(t)) score += 3
      else if (hay.includes(t)) score += 1
    }
    if (n.pinned) score += 2 // 置顶保底加权
    return { n, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => toDTO(s.n))
}

/**
 * 主动聊天用检索：置顶 + 最近更新优先，取前 N 条
 * （主动推送没有用户消息可做关键词评分，故按"最该记住的"排序）
 */
export async function getVaultNotesForProactive(userId: string, limit = 8): Promise<VaultNoteDTO[]> {
  let notes: Awaited<ReturnType<typeof prisma.vaultNote.findMany>>
  try {
    notes = await prisma.vaultNote.findMany({
      where: { userId },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    })
  } catch (e: any) {
    console.warn('[vault] getVaultNotesForProactive 查询失败（DB 可能有坏数据），返回空:', e.message?.substring(0, 120))
    return []
  }
  return notes.map(toDTO)
}

/**
 * 生成注入系统提示的资料库文本块（无可记内容返回 null）
 */
export function formatVaultBlock(notes: VaultNoteDTO[]): string | null {
  if (notes.length === 0) return null
  const lines = notes.map((n) => {
    const label = CATEGORY_LABELS[n.category] || '其他'
    const tagStr = n.tags.length > 0 ? `（${n.tags.join('、')}）` : ''
    return `- [${label}] ${n.title}${tagStr}：${n.content}`
  })
  return `--- 用户资料库（你长期记住的用户信息） ---\n${lines.join('\n')}`
}

// ============ 提炼：对话后异步沉淀 ============

/**
 * 判断消息是否值得提炼（避免每句闲聊都打 LLM）
 */
function worthExtracting(userContent: string): boolean {
  const text = userContent.trim()
  if (text.length < 6 || text.length > 500) return false
  // 明确的临时指令/查询类，不值得记忆
  const skip = /^(帮我|打开|关闭|查一下|看看|今天|现在|几点|晚上吃啥|你好|哈喽|嗯|哦|好的|谢谢)/.test(text)
  return !skip
}

/**
 * 对话后异步提炼记忆（fire-and-forget，绝不阻塞回复）
 * LLM 不可用 / 提炼失败时静默跳过
 */
export async function extractVaultMemory(userId: string, userContent: string, aiReply: string): Promise<void> {
  try {
    if (!worthExtracting(userContent)) return

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个记忆提炼器。从用户与AI助理的对话中，提取"值得长期记住的用户个人信息"。

只提取这些类型：
- person：用户提到的人物关系（家人/朋友/同事的名字、称呼、关系）
- preference：用户的喜好、习惯、忌口、作息、常用工具
- event：用户的重要事项、计划、经历（带时间背景）
- timeline：用户的重要人生节点

不要提取：
- 临时指令（帮我删任务/开倒计时这类）
- AI 助理自己的话
- 无关闲聊（天气哈哈哈之类）

输出 JSON 数组（无值得记的内容输出 []），每项：
{"title":"简短唯一标题（如：用户不吃香菜）","category":"person|preference|event|timeline|other","content":"一句话事实","tags":["可选标签"]}

只输出 JSON，不要任何其他文字。最多 3 条。`,
      },
      {
        role: 'user',
        content: `用户说：${userContent}\n\nAI回复：${aiReply.slice(0, 300)}`,
      },
    ]

    const result = await llmGenerateChat(messages)
    if (!result?.text) return

    // 从回复中抠 JSON（容忍 ```json 包裹）
    const jsonStr = result.text.replace(/```json|```/g, '').trim()
    const match = jsonStr.match(/\[[\s\S]*\]/)
    if (!match) return

    let items: Array<{ title?: string; category?: string; content?: string; tags?: string[] }>
    try { items = JSON.parse(match[0]) } catch { return }
    if (!Array.isArray(items)) return

    for (const item of items) {
      const title = (item.title || '').toString().trim().slice(0, 60)
      const content = (item.content || '').toString().trim().slice(0, 500)
      if (!title || !content) continue
      const category = (VAULT_CATEGORIES as readonly string[]).includes(item.category || '')
        ? (item.category as VaultCategory)
        : 'other'
      const tags = Array.isArray(item.tags)
        ? item.tags.filter((t) => typeof t === 'string').slice(0, 5).map((t) => (t as string).slice(0, 20))
        : []

      // userId+title 唯一：已存在则更新内容（记忆演进），否则新建
      await prisma.vaultNote.upsert({
        where: { userId_title: { userId, title } },
        update: { content, category, tags: JSON.stringify(tags) },
        create: { userId, title, content, category, tags: JSON.stringify(tags), source: 'auto' },
      })
    }
  } catch (err) {
    console.error('[Vault] Memory extraction failed:', err instanceof Error ? err.message : err)
  }
}

// ============ CRUD（设置页管理用） ============

export async function listVaultNotes(userId: string, opts?: { category?: string; search?: string }): Promise<VaultNoteDTO[]> {
  const where: Record<string, unknown> = { userId }
  if (opts?.category) where.category = opts.category
  if (opts?.search) {
    where.OR = [
      { title: { contains: opts.search } },
      { content: { contains: opts.search } },
    ]
  }
  let notes: Awaited<ReturnType<typeof prisma.vaultNote.findMany>>
  try {
    notes = await prisma.vaultNote.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      take: 500,
    })
  } catch (e: any) {
    console.warn('[vault] listVaultNotes 查询失败（DB 可能有坏数据），返回空:', e.message?.substring(0, 120))
    return []
  }
  return notes.map(toDTO)
}

export async function createVaultNote(userId: string, data: { title: string; content: string; category?: string; tags?: string[]; pinned?: boolean }): Promise<VaultNoteDTO> {
  const category = (VAULT_CATEGORIES as readonly string[]).includes(data.category || '')
    ? (data.category as VaultCategory)
    : 'other'
  const n = await prisma.vaultNote.create({
    data: {
      userId,
      title: data.title.trim().slice(0, 60),
      content: data.content.trim().slice(0, 2000),
      category,
      tags: JSON.stringify((data.tags || []).slice(0, 5)),
      pinned: !!data.pinned,
      source: 'manual',
    },
  })
  return toDTO(n)
}

export async function updateVaultNote(userId: string, id: string, data: Partial<{ title: string; content: string; category: string; tags: string[]; pinned: boolean }>): Promise<VaultNoteDTO | null> {
  const patch: Record<string, unknown> = {}
  if (data.title !== undefined) patch.title = data.title.trim().slice(0, 60)
  if (data.content !== undefined) patch.content = data.content.trim().slice(0, 2000)
  if (data.category !== undefined && (VAULT_CATEGORIES as readonly string[]).includes(data.category)) patch.category = data.category
  if (data.tags !== undefined) patch.tags = JSON.stringify(data.tags.slice(0, 5))
  if (data.pinned !== undefined) patch.pinned = data.pinned
  const n = await prisma.vaultNote.update({ where: { id, userId }, data: patch })
  return toDTO(n)
}

export async function deleteVaultNote(userId: string, id: string): Promise<void> {
  await prisma.vaultNote.delete({ where: { id, userId } })
}

export async function getVaultStats(userId: string): Promise<{ total: number; byCategory: Record<string, number> }> {
  let notes: { category: string }[]
  try {
    notes = await prisma.vaultNote.findMany({ where: { userId }, select: { category: true } })
  } catch (e: any) {
    console.warn('[vault] getVaultStats 查询失败（DB 可能有坏数据），返回空:', e.message?.substring(0, 120))
    return { total: 0, byCategory: {} }
  }
  const byCategory: Record<string, number> = {}
  for (const n of notes) byCategory[n.category] = (byCategory[n.category] || 0) + 1
  return { total: notes.length, byCategory }
}
