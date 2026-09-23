/**
 * AgentCore —— 生活助理 AI 核心（P0 落地版）
 *
 * 依据《产品需求规格.md》P0 范围实现：
 * 1. AgentCore 单例：所有对话 HTTP 入口统一走 getAgentCore().handle()
 * 2. accounting 全链路：记一笔（直接落 Bill）/ pending_confirm 队列（缺金额入 Fragment，后补）/ 查报表（自然语言→LLM 工具）
 * 3. 短回复拦截器：纯确认/情绪停顿/模糊意向/礼貌结束/噪音 5 类分支，不发气泡仅 silent_ack
 * 4. 静默理解管线：每轮对话后异步抽取 实体/偏好/习惯/情绪 → Fragment（kind=memory 体系），用户零感知
 * 5. 启动问候：冷启动（空会话）仅一次，时间感知 + 关系深度 + 30% 碎碎念
 *
 * 运行时流程：
 *   用户输入 → 危机检测 → pending 补账 → 短回复拦截 → @指令 → 记账快路 → 查账(LLM 工具) → 正常对话(legacy 降级)
 *                                     ↘ 每轮后台异步理解管线入库（fire-and-forget）
 *
 * 适配器说明（对应规格 7.1）：
 * - LLMClient 适配器 = llmService（Ollama/OpenAI 兼容统一出口，legacy 对话路径）；查询工具为确定性参数绑定（7B 模型 auto tool_choice 不稳，实测乱码）
 * - MemoryStore 适配器 = prisma（SQLite：User/Message/Bill/Task/Fragment）
 */
import { prisma } from '../lib/prisma.js'
import { llmGenerateChat, getLLMConfigSummary } from './llmService.js'
import { classifyBillCategory } from '../utils/classify.js'
import { generateReply } from '../lib/ai-reply.js'
import zlib from 'node:zlib'

// ============================================================
// 1. 配置常量（危机/重构红线语料为安全内容，保持硬编码）
//    问候/碎碎念/周报模板 → config/agent-config.json 热更（P4，见 services/agentConfig.js）
// ============================================================
import { getGreetingConfig, getWeeklyNotes, bucketOf } from './agentConfig.js'

// 危机信号（DG-16 对齐，最高优先级，命中走 legacy 危机卡流程）
// P2 危机分级：HIGH=明确极端意念 → legacy 危机卡（热线）；MID=无望/重度抑郁词 → 心理陪伴路径
const CRISIS_HIGH_RE = /不想活|想死|自杀|结束生命|了结自己|轻生|解脱|一了百了|生无可恋|生不如死|跳楼|割腕|上吊|烧炭|怎么死|自杀方法|安乐死|想消失|消失了.{0,4}好|活着.{0,4}没(有意义|意思)|撑不下去|坚持不下去|不想醒来|想永远睡|走绝路|kill\s*myself|end.{0,4}my.{0,4}life/i
const CRISIS_MID_RE = /崩溃|绝望|抑郁|压抑得.{0,6}(喘不过|难受)|痛苦不堪|焦虑.{0,6}睡不着|很累.{0,6}不想动|难受.{0,6}想哭|心如死灰/

// ============================================================
// 类型定义
// ============================================================
interface ToolContext {
  userId: string
  sessionId: string
  rawText: string
}

interface ToolResult {
  success: boolean
  data?: any
  error?: string
  silent?: boolean
}

interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  silent?: boolean
  execute: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>
}

interface AgentRequest {
  userId: string
  sessionId: string
  message?: { content?: string }
  excludeMsgId?: string
}

interface AgentReply {
  reply?: string
  messageType?: string
  // unknown（而非 Record<string,unknown>）：与 ai-reply.ts 的 ReplyResult.metadata 对齐，
  // 使 generateReply() 的返回值可直接作为 AgentReply 返回，避免无谓的类型断言
  metadata?: unknown
  silentAck?: boolean
}

interface MoodAssessment {
  valence: number
  dominant: '积极' | '低落' | '平静'
  trigger: string
  intensity: 'strong' | 'normal'
}

interface ConflictResolution {
  when: Date
  adjusted: boolean
  conflicts: string[]
}

interface ExtractedText {
  ok: boolean
  text?: string
  format?: string
  error?: string
}

interface WrittenDoc {
  ok: boolean
  data?: {
    docId: string
    title: string
    previewUrl: string
    downloadUrl: string
    charCount: number
    truncatedSource: boolean
  }
  error?: string
}

interface WeeklyReport {
  weekOffset: number
  range: { start: string; end: string; label: string }
  finance: {
    income: number
    expense: number
    balance: number
    billCount: number
    topCategories: { name: string; total: number }[]
  }
  stats: { doneTasks: number; dietCount: number; calories: number; msgCount: number; streak: number }
  mood: { positive: number; negative: number; calm: number; dominant: string; sampled: number }
  note: string
  generatedAt: string
}

interface ProfilePanel {
  month: string
  finance: { expense: number; topCategories: { name: string; total: number }[] }
  tasks: { total: number; done: number; doneRate: number }
  moods: { date: string; level: 'none' | 'low' | 'good' | 'calm'; sampled: number }[]
  memory: {
    counts: Record<string, number>
    recent: { id: string; kind: string; content: string; date: string }[]
  }
  relation: { streak: number; msgCount: number }
  generatedAt: string
}

type ShortReplyType = 'SILENT_ACK' | 'EMPATHY' | 'DELEGATE' | 'CLOSE' | 'NOISE' | 'PASS'

interface ShortReplyGuard {
  type: ShortReplyType
  text?: string
  summary?: string
}

// ============================================================
// 2. 工具注册表（{skill}.{action} 命名，供 LLM Function Calling）
// ============================================================
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** range → [gte, lt] */
function rangeToDates(range: string): [Date, Date] {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  switch (range) {
    case 'today':
      return [start, now]
    case 'month': {
      return [new Date(now.getFullYear(), now.getMonth(), 1), now]
    }
    case 'last_week': {
      // 上一周的周一 00:00 ~ 本周一 00:00
      const mon = new Date(start)
      mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7))
      const lastMon = new Date(mon)
      lastMon.setDate(lastMon.getDate() - 7)
      return [lastMon, mon]
    }
    case 'last_month': {
      return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)]
    }
    case 'week':
    default: {
      const mon = new Date(start)
      mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7))
      return [mon, now]
    }
  }
}

const TOOL_REGISTRY: Record<string, ToolDef> = {
  'accounting.add_entry': {
    name: 'accounting.add_entry',
    description: '记一笔账。用户提到花钱/买东西/收入时调用。amount 金额，title 名目，type expense|income。',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: '金额' },
        title: { type: 'string', description: '名目，如 午饭/打车/工资' },
        category: { type: 'string', description: '分类，可留空自动推断' },
        type: { type: 'string', enum: ['expense', 'income'] },
      },
      required: ['amount', 'title'],
    },
    async execute(args, ctx) {
      const amount = Number(args.amount)
      const type = args.type === 'income' ? 'income' : 'expense'
      const title = (args.title || '日常支出').toString().slice(0, 30)
      if (!amount || amount <= 0) {
        // 缺金额 → pending_confirm 队列（Fragment 承载，等用户后补）
        await prisma.fragment.create({
          data: {
            userId: ctx.userId,
            content: `待补账：${title}`,
            kind: 'pending_bill',
            tags: JSON.stringify(['pending_confirm']),
            note: JSON.stringify({ title, type, raw: ctx.rawText }),
          },
        })
        return { success: true, data: { pending: true, reason: '缺金额，已入待补队列' } }
      }
      const category = args.category || classifyBillCategory(title, type)
      const bill = await prisma.bill.create({
        data: {
          userId: ctx.userId,
          type,
          amount,
          category,
          title,
          note: (ctx.rawText || '').slice(0, 100),
          billDate: args.time ? new Date(args.time) : new Date(),
        },
      })
      return { success: true, data: { entryId: bill.id, amount, category, type, title } }
    },
  },
  'accounting.query_report': {
    name: 'accounting.query_report',
    description: '查账单报表。range: today|week|month|last_week|last_month，category 可选（如 餐饮/交通）。',
    parameters: {
      type: 'object',
      properties: {
        range: { type: 'string', enum: ['today', 'week', 'last_week', 'month', 'last_month'] },
        category: { type: 'string' },
      },
      required: ['range'],
    },
    async execute(args, ctx) {
      const [gte, lt] = rangeToDates(args.range || 'week')
      const where = {
        userId: ctx.userId,
        billDate: { gte, lt },
        ...(args.category ? { category: { contains: args.category } } : {}),
      }
      const rows = await prisma.bill.findMany({
        where,
        select: { type: true, amount: true, category: true, title: true },
        orderBy: { billDate: 'desc' },
        take: 300,
      })
      const income = rows.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0)
      const expense = rows.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0)
      const byCategory: Record<string, number> = {}
      for (const b of rows.filter((r) => r.type === 'expense')) {
        const key = b.category || '其他'
        byCategory[key] = (byCategory[key] || 0) + b.amount
      }
      return {
        success: true,
        data: {
          range: args.range || 'week',
          income: Math.round(income * 100) / 100,
          expense: Math.round(expense * 100) / 100,
          balance: Math.round((income - expense) * 100) / 100,
          count: rows.length,
          categories: Object.entries(byCategory)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 })),
        },
      }
    },
  },
  'schedule.query_events': {
    name: 'schedule.query_events',
    description: '查待办/日程。range: week|month。',
    parameters: {
      type: 'object',
      properties: { range: { type: 'string', enum: ['week', 'month'] } },
    },
    async execute(args, ctx) {
      // 待办查「未来窗口」：今天 00:00 ~ +7 天（month 则 +30 天），含未排期 todo
      const days = args.range === 'month' ? 30 : 7
      const gte = new Date()
      gte.setHours(0, 0, 0, 0)
      const lt = new Date(gte)
      lt.setDate(lt.getDate() + days)
      const tasks = await prisma.task.findMany({
        where: {
          userId: ctx.userId,
          OR: [{ dueDate: { gte, lt } }, { dueDate: null, status: 'todo' }],
        },
        select: { title: true, status: true, dueDate: true, priority: true },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
        take: 20,
      })
      return { success: true, data: { range: args.range || 'week', tasks } }
    },
  },
  'schedule.create_event': {
    name: 'schedule.create_event',
    description: '创建日程/待办。创建前自动查同日冲突并顺延到空闲时段。缺时间按用户历史偏好时段落地，绝不追问。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '事项名目，如 团队周会/牙医复查' },
        date: { type: 'string', description: 'ISO 日期时间，如 2026-08-21T15:00:00' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['title'],
    },
    async execute(args, ctx) {
      const title = (args.title || '待办事项').toString().slice(0, 40)
      const priority = ['low', 'medium', 'high'].includes(args.priority) ? args.priority : 'medium'
      // 时间：显式传入 > 历史偏好时段
      let when = args.date ? new Date(args.date) : null
      if (!when || Number.isNaN(when.getTime())) when = await nextPreferredSlot(ctx.userId)
      // 冲突检测：同日 ±1 小时已有未完成任务 → 顺延到下一个空闲小时（8~21 点内）
      const adjusted = await resolveConflict(ctx.userId, when)
      const task = await prisma.task.create({
        data: {
          userId: ctx.userId,
          title,
          priority,
          status: 'todo',
          dueDate: adjusted.when,
          remindAt: new Date(adjusted.when.getTime() - 15 * 60_000),
        },
      })
      return {
        success: true,
        data: {
          taskId: task.id,
          title,
          when: adjusted.when.toISOString(),
          adjusted: adjusted.adjusted,
          conflicts: adjusted.conflicts,
        },
      }
    },
  },
  'schedule.complete_event': {
    name: 'schedule.complete_event',
    description: '完成一个待办。按标题模糊匹配最近的未完成任务。',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string', description: '事项名目关键词' } },
      required: ['title'],
    },
    async execute(args, ctx) {
      const kw = (args.title || '').toString().trim().slice(0, 20)
      if (!kw) return { success: false, error: '缺少名目' }
      const task = await prisma.task.findFirst({
        where: { userId: ctx.userId, status: { in: ['todo', 'in_progress'] }, OR: [{ title: { contains: kw } }, { description: { contains: kw } }] },
        orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
      })
      if (!task) return { success: false, error: '没找到这个待办' }
      await prisma.task.update({ where: { id: task.id }, data: { status: 'done', progress: 100 } })
      return { success: true, data: { taskId: task.id, title: task.title } }
    },
  },
  'psychology.crisis_detect': {
    name: 'psychology.crisis_detect',
    description: '静默识别自伤/极端风险。level：0 无 / 1 高（危机卡+热线） / 2 中（心理陪伴路径）。',
    silent: true,
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    async execute({ text }) {
      const t = text || ''
      const level = CRISIS_HIGH_RE.test(t) ? 1 : CRISIS_MID_RE.test(t) ? 2 : 0
      return { success: true, silent: true, data: { level } }
    },
  },
  'psychology.assess_mood': {
    name: 'psychology.assess_mood',
    description: '静默评估情绪维度（valence -1~1 / dominant / trigger / intensity）。',
    silent: true,
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    async execute({ text }) {
      return { success: true, silent: true, data: assessMoodLexicon(text || '') }
    },
  },
  'office.read_document': {
    name: 'office.read_document',
    description: '读文档并生成摘要（txt/md/csv/docx/pdf；大文件自动分块）。只读不改原件。',
    parameters: {
      type: 'object',
      properties: {
        mediaUrl: { type: 'string', description: '文件 data URL（base64）' },
        fileName: { type: 'string' },
      },
      required: ['mediaUrl'],
    },
    async execute({ mediaUrl, fileName }, ctx) {
      const extracted = extractTextFromDataUrl(mediaUrl, fileName)
      if (!extracted.ok) return { success: false, error: extracted.error }
      const { text, format } = extracted
      if (!text || !text.trim()) return { success: false, error: '文档里没提到可读文本' }
      const summary = await summarizeDocument(text, ctx.userId)
      return {
        success: true,
        data: {
          fileName: fileName || '未命名',
          format,
          charCount: text.length,
          chunkCount: Math.ceil(text.length / OFFICE_CHUNK_SIZE),
          summary,
        },
      }
    },
  },
  'office.write_document': {
    name: 'office.write_document',
    description: '按指令生成新版本文档（绝不改动原件）。返回预览链接与下载地址。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '新文档标题' },
        instruction: { type: 'string', description: '改写指令，如「改成周报口吻」' },
        sourceText: { type: 'string', description: '原文（可选，无则纯创作）' },
        basedOn: { type: 'string', description: '原文件名（溯源用）' },
      },
      required: ['title', 'instruction'],
    },
    async execute({ title, instruction, sourceText, basedOn }, ctx) {
      const written = await writeNewVersion(String(title).slice(0, 60), String(instruction).slice(0, 500), sourceText ? String(sourceText).slice(0, 4000) : '', ctx.userId)
      if (!written.ok) return { success: false, error: written.error }
      return { success: true, data: written.data }
    },
  },
  'office.export_document': {
    name: 'office.export_document',
    description: '导出已生成的新版本文档（md/txt），返回下载链接。',
    parameters: {
      type: 'object',
      properties: {
        docId: { type: 'string' },
        format: { type: 'string', enum: ['md', 'txt'] },
      },
      required: ['docId'],
    },
    async execute({ docId, format }, ctx) {
      const doc = await prisma.fragment.findFirst({
        where: { id: docId, userId: ctx.userId, kind: 'office_doc' },
      })
      if (!doc) return { success: false, error: '没找到这份文档' }
      const fmt = format === 'txt' ? 'txt' : 'md'
      return {
        success: true,
        data: { docId, format: fmt, downloadUrl: `/api/v1/chat/office-docs/${doc.id}/download?format=${fmt}` },
      }
    },
  },
}

async function executeTool(name: string, args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOL_REGISTRY[name]
  if (!tool) return { success: false, error: `Tool ${name} not found` }
  try {
    return await tool.execute(args || {}, ctx)
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ============================================================
// 3. 情绪词典（理解管线 + assess_mood 共用）
// ============================================================
const POS_WORDS = ['开心', '高兴', '爽', '不错', '好玩', '哈哈', '顺利', '兴奋', '舒服', '满意', '喜欢', '赞']
const NEG_WORDS = ['烦', '累', '难过', '焦虑', 'emo', '崩溃', '无语', '难受', '丧', '压力', '失眠', '睡不着', '生气', '委屈', '低落', '抑郁', '绝望', '想哭', '孤独', '空虚', '没劲', '提不起劲']

function assessMoodLexicon(text: string): MoodAssessment {
  let score = 0
  const hits: string[] = []
  for (const w of POS_WORDS) if (text.includes(w)) { score += 1; hits.push(w) }
  for (const w of NEG_WORDS) if (text.includes(w)) { score -= 1; hits.push(w) }
  const valence = Math.max(-1, Math.min(1, score / 2))
  // P2 强度：程度副词放大（很/太/真的/要命…），供波动检测加权
  const amplified = /(很|太|超|特别|非常|真的|要命|极|完全|一点都)/.test(text)
  return {
    valence: Math.round(valence * 100) / 100,
    dominant: score > 0 ? '积极' : score < 0 ? '低落' : '平静',
    trigger: hits.slice(0, 3).join('、'),
    intensity: amplified ? 'strong' : 'normal',
  }
}

// ============================================================
// 3.5 心理陪伴（P2：认知重构 + 波动共情 + 中风险陪伴路径）
// 红线：不说教、不推量表、不给建议；仅高风险（危机卡）/大波动（共情占位）显性化
// ============================================================
/** 负面自我评价（认知重构触发）：限第一人称+句尾自评，排除"我没用Excel"类误报 */
const NEG_SELF_RE = /(我|咱|自己)(真的|真|就|太|很|好|特别|非常|总是|这么)?(没用|废物|失败|不行|差劲|一无是处|一事无成)([了的啊哦。！!\s]|$)|(我|自己)(什么都|什么也)(做不好|搞不定|弄不好|不行)|(没人|没有人|没一个人)(喜欢|爱|在乎|要|看得上)(我|咱)|我就是个?(笑话|累赘|负担|多余|废人)/

/** 认知重构语料（接住+换角度，不说教不建议） */
const REFRAME_PLAIN = [
  '打住，这话我可不答应。你只是这会儿被磨没了电，不是不行。',
  '先别急着给自己下结论，这阵子的状态不等于你这个人的成色。',
  '别拿这几天的低谷给整个人打分，划不来。',
  '谁在泥里的时候都觉得自己脏，出来了照样走路。缓一缓，你还照旧。',
]
/** 实证反驳（本周有 ≥2 件完成事项时启用） */
const REFRAME_EVIDENCE = [
  '我可不同意。这礼拜你还搞定了{n}件事，没用的人做不到这个。',
  '先把这话收回去——{n}件事可是实打实办完的，我这儿记着账呢。',
]
/** 连续低落共情占位（大波动才显性化） */
const EMPATHY_HOLD = [
  '在听。不用撑着，想说什么接着说。',
  '抱抱。这阵子是真不容易。',
  '我一直在。倒吧，倒完轻省。',
  '听着呢，先喘口气，不急着好起来。',
]

/** 波动检测：近 24h 已有 ≥2 条低落记录（当前条尚未入库） */
async function detectMoodBurst(userId: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 24 * 3600_000)
    const recent = await prisma.fragment.findMany({
      where: { userId, kind: 'mood', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { content: true },
    })
    return recent.length === 2 && recent.every((m) => m.content.includes('低落'))
  } catch {
    return false
  }
}

/** 共情占位冷却：同一用户 30 分钟内不重复占位 */
const EMPATHY_COOLDOWN = new Map<string, number>()
function empathyCooldownOk(userId: string): boolean {
  const last = EMPATHY_COOLDOWN.get(userId) || 0
  if (Date.now() - last < 30 * 60_000) return false
  EMPATHY_COOLDOWN.set(userId, Date.now())
  return true
}

/** 认知重构：接住 + 温和换角度（60% 概率附本周实证反驳） */
async function buildCognitiveReframe(userId: string, mood: MoodAssessment): Promise<AgentReply> {
  let text = pick(REFRAME_PLAIN)
  try {
    const since = new Date(Date.now() - 7 * 864e5)
    const n = await prisma.task.count({ where: { userId, status: 'done', updatedAt: { gte: since } } })
    if (n >= 2 && Math.random() < 0.6) text = pick(REFRAME_EVIDENCE).replace('{n}', String(n))
  } catch { /* 实证查询失败不影响重构 */ }
  return {
    reply: text,
    messageType: 'text',
    metadata: { psychology: { type: 'reframe', trigger: mood.trigger || null } },
  }
}

/** 中风险心理陪伴 LLM 路径：只接住不说教（失败返回 null，落共情占位兜底） */
async function psychologyLLMReply(userText: string, history: { role: string; content: string }[]): Promise<AgentReply | null> {
  const sys = [
    '你是用户的老朋友角角（绿角犀）。用户这会儿情绪很沉（提到了崩溃/抑郁/绝望这类词）。',
    '你的任务只有一件：接住。像深夜回消息的老朋友，一两句就够，微信短消息的口语。',
    '红线：不分析对方心理、不说教、不给任何建议（包括作息/运动/就医）、不推荐量表测试、不复述对方的痛苦细节。',
    '可以：承认听到、陪着、给一个能落脚的小台阶（比如接着说，比如先歇着）。',
    '回复直接给内容，不要引导语，20~60 字为宜。',
    `当前时间：${new Date().toLocaleString('zh-CN')}`,
  ].join('\n')
  const msgs: { role: 'system' | 'assistant' | 'user'; content: string }[] = [
    { role: 'system', content: sys },
    ...history.slice(-6).map((m): { role: 'assistant' | 'user'; content: string } => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: (m.content || '').slice(0, 200),
    })),
    { role: 'user', content: userText },
  ]
  const r = await llmGenerateChat(msgs)
  const text = r && r.text ? r.text.trim() : ''
  if (text.length >= 4 && text.length <= 120) {
    return { reply: text, messageType: 'text', metadata: { psychology: { type: 'hold' } } }
  }
  return null
}

// ============================================================
// 4. 短回复拦截器（5 类分支）
// ============================================================
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function isStatement(text: string): boolean {
  const t = (text || '').trim()
  return /[。！.!]$/.test(t) || t === '' || /[\)）」”]\s*$/.test(t)
}

function hasProposal(text: string): boolean {
  return /(要不|要不要|建议|选|定|约|改到|挪到)/.test(text || '')
}

/** 从上条 AI 提议里抓名目（P0：口头代决策，不假装执行了系统动作） */
function extractProposal(lastAi: string): { summary: string; text: string } {
  const m = (lastAi || '').match(/要不([^，。？?！!]{2,20})/) || (lastAi || '').match(/(?:选|定|约)([^，。？?！!]{2,20})/)
  const what = m ? m[1].trim() : ''
  return { summary: what, text: what ? `行，那就${what}。` : '行，按我说的办。' }
}

function handleShortReply(userText: string, lastAiText: string): ShortReplyGuard {
  const t = userText.trim().toLowerCase()
  // 1. 纯确认：上条是陈述/完成汇报 → 不发气泡，仅前端 silent_ack
  if (/^(好|行|嗯|ok|okay|好的|好嘞|收到|知道了|嗯嗯|哦哦)$/.test(t) && isStatement(lastAiText)) {
    return { type: 'SILENT_ACK' }
  }
  // 2. 情绪停顿：单字情绪词 → 极短共情占位
  if (/^(唉|烦|累|无语|破防|emo|麻了|服了|唉唉)$/.test(t)) {
    return { type: 'EMPATHY', text: pick(['在听', '抱抱', '想吐就吐', '要不歇会儿？', '陪你发会儿呆']) }
  }
  // 3. 模糊意向：上条有提议 → 代决策
  if (/^(随便|都行|你看着办|随意|看你|随你)$/.test(t) && hasProposal(lastAiText)) {
    return { type: 'DELEGATE', ...extractProposal(lastAiText) }
  }
  // 4. 礼貌结束：对话自然终点 → 温柔收尾
  if (/^(谢谢|谢了|辛苦了|辛苦|晚安|拜拜|再见|bye|睡了|先这样|就这样)$/.test(t)) {
    return { type: 'CLOSE', text: pick(['不客气，早点睡🌙', '随时喊', '晚安，做个不加班的梦', '去忙吧，我在']) }
  }
  // 5. 噪音：纯标点/纯数字/纯 emoji → 30% 回同款，70% silent_ack
  if (/^[\d\s.。,，!！?？~…-]+$/.test(t) || /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+$/u.test(t)) {
    return Math.random() < 0.3 ? { type: 'NOISE', text: t } : { type: 'SILENT_ACK' }
  }
  return { type: 'PASS' }
}

// ============================================================
// 5. 记账意图检测（快路：确定性规则，不走 LLM）
// ============================================================
interface AccountingEntry {
  amount: number | null
  hasAmount: boolean
  title: string
  type: 'expense' | 'income'
}

function detectAccountingEntry(text: string): AccountingEntry | null {
  const t = text.toLowerCase()
  // 查询意图不算记账（"这周花了多少"是问句，不是陈述花销）
  if (/(多少|几块|几元|几钱|哪些|什么账|明细|报表|账单|统计|汇总|算过|加起来)/.test(t)) return null
  const spendRe = /(花了|买了|消费了?|付了|支出|开销|充值|充了)/
  const incomeRe = /(收入|到账|工资|进账|发钱了|收了|红包|报销|退款|奖金)/
  const isIncome = incomeRe.test(t) && !spendRe.test(t)
  if (!spendRe.test(t) && !incomeRe.test(t)) return null
  // 金额：优先"X元/X块"；否则取第一个非时间数字
  let amount: number | null = null
  const withUnit = t.match(/(\d+(?:\.\d+)?)(?:元|块钱?|块)/)
  if (withUnit) {
    amount = Number(withUnit[1])
  } else {
    for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) {
      const next = t[m.index + m[0].length] || ''
      if (!/[点号月日年时:：]/.test(next)) {
        amount = Number(m[0])
        break
      }
    }
  }
  const rawTitle = t
    .replace(/花了|买了|消费了?|付了|支出|开销|充值|充了|收入|到账|工资|进账|发钱了|收了|红包|报销|退款|奖金|块钱?|元/g, '')
    .replace(/\d+(?:\.\d+)?/g, '')
    .replace(/我|今天|昨天|刚才|刚刚|下午|上午|晚上|早上/g, '')
    .replace(/[，。,.!！?？\s]+/g, '')
    .trim()
  return {
    amount,
    hasAmount: amount != null && amount > 0,
    title: rawTitle.slice(0, 20) || '日常支出',
    type: isIncome ? 'income' : 'expense',
  }
}

/** 纯数字消息 → 尝试补全最近的 pending 账 */
async function tryCompletePendingBill(userId: string, amount: number): Promise<{ entryId: string; title: string; amount: number; category: string } | null> {
  const pending = await prisma.fragment.findFirst({
    where: { userId, kind: 'pending_bill' },
    orderBy: { createdAt: 'desc' },
  })
  if (!pending) return null
  // 超过 48 小时的 pending 不再自动补
  if (Date.now() - pending.createdAt.getTime() > 48 * 3600_000) return null
  let info: { title: string; type: 'expense' | 'income' } = { title: '日常支出', type: 'expense' }
  try {
    info = { ...info, ...JSON.parse(pending.note || '{}') }
  } catch { /* note 解析失败用默认 */ }
  const category = classifyBillCategory(info.title, info.type)
  const bill = await prisma.bill.create({
    data: {
      userId,
      type: info.type,
      amount,
      category,
      title: info.title,
      note: `补全自待记账：${pending.content}`,
      billDate: new Date(),
    },
  })
  // 标记已消化，防止重复补
  await prisma.fragment.update({ where: { id: pending.id }, data: { digested: true, content: `已补账：${info.title} ¥${amount}` } })
  return { entryId: bill.id, title: info.title, amount, category }
}

// ============================================================
// 5.5 日程意图（P1 三件套：中文时间解析 + 冲突检测 + 历史偏好）
// ============================================================
const WEEKDAY_CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }

/** 中文日期解析：返回相对今天的天数偏移（null=未识别） */
function parseDayOffset(t: string): number | null {
  if (/大后天/.test(t)) return 3
  if (/后天/.test(t)) return 2
  if (/明天|明晚/.test(t)) return 1
  if (/今天|今晚/.test(t)) return 0
  const wk = t.match(/(下?)(?:周|星期|礼拜)([一二三四五六日天])/)
  if (wk) {
    const now = new Date()
    const day = now.getDay()
    if (wk[1] === '下') {
      // 下周X：以下周一为基准（daysToMonday=1~7），X 转成 0~6（周一=0）
      const daysToMonday = (8 - day) % 7 || 7
      return daysToMonday + (WEEKDAY_CN[wk[2]] === 0 ? 6 : WEEKDAY_CN[wk[2]] - 1)
    }
    return (WEEKDAY_CN[wk[2]] - day + 7) % 7 // 本周X（0=今天）
  }
  const md = t.match(/(\d{1,2})月(\d{1,2})[日号]?/)
  if (md) {
    const now = new Date()
    let d = new Date(now.getFullYear(), Number(md[1]) - 1, Number(md[2]))
    if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d = new Date(now.getFullYear() + 1, Number(md[1]) - 1, Number(md[2]))
    return Math.round((d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5)
  }
  const dm = t.match(/(?:^|\s)(\d{1,2})[日号]/)
  if (dm) {
    const now = new Date()
    const day = Number(dm[1])
    let month = now.getMonth()
    if (day < now.getDate()) month += 1
    return Math.round((new Date(now.getFullYear(), month, day).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5)
  }
  return null
}

/** 中文时间解析：返回 { hour, minute }（null=未识别）。下午/晚上 X 点自动 +12 */
function parseHourMinute(t: string): { hour: number; minute: number } | null {
  const m = t.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?(\d{1,2})(?::|：|点)(\d{1,2})?分?/) || t.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?(\d{1,2})点半/)
  if (m) {
    let hour = Number(m[2])
    const minute = m[3] !== undefined && m[3] !== '' ? Number(m[3]) : /半/.test(t) && m[0].includes('半') ? 30 : 0
    const period = m[1]
    if ((period === '下午' || period === '晚上' || period === '傍晚') && hour < 12) hour += 12
    if (period === '中午' && hour < 11) hour += 12 // 中午12点=12点，中午1点=13点
    if (!period && hour > 0 && hour < 8) hour += 12 // 裸"3点"默认下午
    if (hour > 23) return null
    return { hour, minute: Math.min(minute, 59) }
  }
  // 只有时段没有钟点
  const pOnly = t.match(/^(?:凌晨|早上|上午|中午|下午|傍晚|晚上)$/)
  if (pOnly) return null
  return null
}

/** 出行类日程：要去某地/见某人，且用户没说路程 → LLM 在线时让给 LLM（它会反问路程做出行规划） */
function isTravelScheduleWithoutDistance(text: string): boolean {
  const isGoing = /要去|得去|去趟|要见|得见|约了?.{0,4}(见|聊|谈)|见(客户|医生|老师|老板|面试官|朋友)|去(机场|车站|高铁站|医院|学校|银行|超市|健身房|驾校|律所)/.test(text)
  if (!isGoing) return false
  // 已含路程信息（车程/多久/公里/打车等）→ 不算缺，正常建
  const hasDistance = /(车程|路程|多远|多久|公里|小时|分钟|地铁|打车|开车|骑车|走路|公交|高铁|飞机)/.test(text)
  return !hasDistance
}

/** LLM 是否在线（provider 配置有效） */
function isLLMOnline(): boolean {
  const c = getLLMConfigSummary()
  if (c.provider === 'none') return false
  if (c.provider === 'openai') return !!c.hasApiKey
  return true
}

/** 日程意图：任务动作词 + 时间词（疑问句排除） */
function detectScheduleIntent(text: string): string | null {
  const t = text.toLowerCase()
  if (/(多少|几|哪些|什么时[候候])/.test(t) && /[?？]/.test(t)) return null // 问句不是创建
  const action = /(提醒我|帮我记|帮我安[排排]|安排(一?下|我)?|定个|订个|约了?|有个会|要开会|要开|要去做|要去看|要去|要做|得去|得做|得买|记得(去|买|做|给))/.test(t)
  if (!action) return null
  const hasTime = /(今天|今晚|明天|明晚|后天|大后天|下周|本周|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]|\d{1,2}[日号]|\d{1,2}点|\d{1,2}[:：]\d{2}|上午|下午|晚上|中午|早上|傍晚)/.test(t)
  return hasTime ? t : null
}

/** 从日程语句提取标题：剥离时间词/动作词/助词 */
function extractScheduleTitle(text: string): string {
  const title = text
    .replace(/(大后天|后天|明天|明晚|今天|今晚|下?周[一二三四五六日天]|下?星期[一二三四五六日天]|下?礼拜[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]?|\d{1,2}[日号])/g, ' ')
    .replace(/(凌晨|早上|上午|中午|下午|傍晚|晚上)/g, ' ')
    .replace(/\d{1,2}(?::|：|点)\d{1,2}分?|\d{1,2}点半|\d{1,2}[:：]\d{2}|\d{1,2}点(?![\d分半])/g, ' ')
    .replace(/(提醒我|帮我记|帮我安排|安排一下|安排我|安排|定个|订个|记得|要|得|去|个)/g, ' ')
    .replace(/[，。,.!！?？\s我你他的了着在]+/g, ' ')
    .trim()
  return title.slice(0, 20) || '待办事项'
}

/** 历史偏好时段：统计用户历史任务 dueDate 的小时分布，取最常见小时；无历史默认 10 点 */
async function nextPreferredSlot(userId: string): Promise<Date> {
  const tasks = await prisma.task.findMany({
    where: { userId, dueDate: { not: null } },
    select: { dueDate: true },
    orderBy: { dueDate: 'desc' },
    take: 50,
  })
  const hourCount: Record<number, number> = {}
  for (const t of tasks) {
    if (t.dueDate) {
      const h = t.dueDate.getHours()
      hourCount[h] = (hourCount[h] || 0) + 1
    }
  }
  const preferred = Object.entries(hourCount).sort((a, b) => b[1] - a[1])[0]
  const hour = preferred ? Number(preferred[0]) : 10
  const when = new Date()
  when.setHours(hour, 0, 0, 0)
  if (when <= new Date()) when.setDate(when.getDate() + 1) // 已过则明天
  return when
}

/** 冲突检测：同日 ±1 小时内已有未完成任务 → 顺延到下一个空闲整点（8~21 点） */
async function resolveConflict(userId: string, when: Date): Promise<ConflictResolution> {
  const dayStart = new Date(when)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  const sameDay = await prisma.task.findMany({
    where: { userId, status: { in: ['todo', 'in_progress'] }, dueDate: { gte: dayStart, lt: dayEnd } },
    select: { title: true, dueDate: true },
  })
  const conflicts = sameDay.filter((t) => t.dueDate && Math.abs(t.dueDate.getTime() - when.getTime()) < 3600_000)
  if (!conflicts.length) return { when, adjusted: false, conflicts: [] }
  // 顺延：从当前时间起找下一个无冲突整点（限 8~21 点，超 21 点挪到次日 9 点）
  const cand = new Date(when)
  for (let i = 0; i < 24; i++) {
    cand.setMinutes(0, 0, 0)
    cand.setHours(cand.getHours() + 1)
    if (cand.getHours() > 21 || cand.getHours() < 8) {
      cand.setDate(cand.getDate() + 1)
      cand.setHours(9, 0, 0, 0)
    }
    if (!sameDay.some((t) => t.dueDate && Math.abs(t.dueDate.getTime() - cand.getTime()) < 3600_000)) {
      return { when: cand, adjusted: true, conflicts: conflicts.map((c) => c.title) }
    }
  }
  return { when, adjusted: false, conflicts: conflicts.map((c) => c.title) }
}

/** 格式化日程时间标签：明天 15:00 */
function formatScheduleLabel(d: Date): string {
  const now = new Date()
  const diffDay = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5)
  const dayLabel = diffDay === 0 ? '今天' : diffDay === 1 ? '明天' : diffDay === 2 ? '后天' : `${d.getMonth() + 1}月${d.getDate()}日`
  return `${dayLabel} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ============================================================
// 6. 查账意图（LLM + Function Calling 路径）
// ============================================================
function detectQueryIntent(text: string): boolean {
  const t = text.toLowerCase()
  // 钱包余额走 legacy 规则（直接查 wallet，别让 LLM 猜）
  if (/(余额|钱包)/.test(t) && !/(花了?多少|账单|报表|花了?几)/.test(t)) return false
  const billQuery = /(花了?多少|多少钱|账单|报表|账目|汇总|开销|支出了?多少|花了?几|消费多少)/.test(t)
  const timeQuery = /(这个月|本月|上周|这周|本周|上个月|上月|今天|这阵子|最近)/.test(t) && /(花|消费|买|开销|支出|账)/.test(t)
  // P1 待办查询：「有什么待办/任务列表/查日程」（"提醒我明天有个待办"这类创建语不含问词，不会误伤）
  const todoQuery = /(待办|任务|日程)/.test(t) && /(什么|哪些|几[个件条]?|看看|列出|查|安排了?啥|有啥)/.test(t)
  return billQuery || timeQuery || todoQuery
}

/** 从查询文本确定性解析报表参数（P0：小模型 auto 工具调用不可靠，规则绑定） */
function detectReportParams(text: string): { range: string; category?: string } {
  const t = text.toLowerCase()
  let range = 'week'
  if (/今天|今日/.test(t)) range = 'today'
  else if (/上周|上星期/.test(t)) range = 'last_week'
  else if (/上个?月/.test(t)) range = 'last_month'
  else if (/这个?月|本月/.test(t)) range = 'month'
  else if (/这周|本周|这礼拜|这星期/.test(t)) range = 'week'
  const cat = t.match(/(餐饮|食物|吃饭|交通|打车|购物|娱乐|居住|医疗|学习|咖啡|奶茶)/)
  return { range, ...(cat ? { category: cat[1] } : {}) }
}

const RANGE_LABEL: Record<string, string> = { today: '今天', week: '这周', last_week: '上周', month: '本月', last_month: '上个月' }

// ============================================================
// 7. 静默理解管线（后台异步，fire-and-forget）
// ============================================================
const MEMORY_KINDS = ['preference', 'habit', 'entity', 'mood'] as const
type MemoryKind = typeof MEMORY_KINDS[number]

interface MemoryItem {
  kind: MemoryKind
  content: string
}

async function runUnderstandingPipeline(userId: string, sessionId: string, userText: string, sourceMsgId: string | null, source: 'text' | 'multimodal' = 'text'): Promise<void> {
  try {
    // P3 隐私四档：off=完全不写库；text=仅理解纯文本（多模态描述跳过）；local=仅本地正则（不调云端 LLM，语义为未来 LLM 深度理解预留）；full=全开
    const privacyRow = await prisma.user.findUnique({ where: { id: userId }, select: { privacyMode: true } })
    const privacyMode = privacyRow?.privacyMode || 'full'
    if (privacyMode === 'off') return
    if (privacyMode === 'text' && source === 'multimodal') return
    const items: MemoryItem[] = []
    // 偏好
    const pref = userText.match(/(喜欢|爱吃|爱喝|讨厌|不爱吃|不喜欢|最爱)([^，。！!？?、\s]{1,12})/)
    if (pref) items.push({ kind: 'preference', content: `${pref[1]}${pref[2]}` })
    // 习惯
    const habit = userText.match(/(每天|总是|经常|一般都|习惯)([^，。！!？?]{2,15})/)
    if (habit) items.push({ kind: 'habit', content: `${habit[1]}${habit[2]}` })
    // 人物实体
    const name = userText.match(/(?:叫|和|跟)([\u4e00-\u9fa5]{2,3})(?:一起|说|聊|见|去|约|吃)/)
    if (name) items.push({ kind: 'entity', content: `提到「${name[1]}」` })
    // 情绪信号
    const mood = assessMoodLexicon(userText)
    if (mood.dominant !== '平静') {
      items.push({ kind: 'mood', content: `情绪：${mood.dominant}${mood.trigger ? `（${mood.trigger}）` : ''}` })
    }
    if (!items.length) return

    // 去重：最近 20 条同类记忆已有相同内容则跳过
    const recent = await prisma.fragment.findMany({
      where: { userId, kind: { in: [...MEMORY_KINDS] as string[] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { content: true },
    })
    const seen = new Set(recent.map((r) => r.content))
    for (const it of items) {
      if (seen.has(it.content)) continue
      await prisma.fragment.create({
        data: {
          userId,
          content: it.content,
          kind: it.kind,
          tags: JSON.stringify(['memory', it.kind]),
          sourceMsgId: sourceMsgId || null,
          note: `会话 ${sessionId}`,
        },
      })
    }
  } catch (e) {
    console.error('[AgentCore] understanding pipeline failed:', e instanceof Error ? e.message : e)
  }
}

// ============================================================
// 6.5 办公小助手（P2：只读不改原件；生成新版本+预览链接；大文件分块）
// ============================================================
const OFFICE_CHUNK_SIZE = 3500 // LLM 单块处理上限（7B 模型上下文预算）
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|xml|html?|srt|vtt|yml|yaml|ini|conf|js|ts|py|css|sql)$/i

/** data URL → Buffer */
function dataUrlToBuffer(mediaUrl: string): Buffer | null {
  const idx = (mediaUrl || '').indexOf('base64,')
  if (idx < 0) return null
  try {
    return Buffer.from(mediaUrl.slice(idx + 7), 'base64')
  } catch {
    return null
  }
}

/** 极简 docx 文本提取：ZIP 解包 word/document.xml → 剥标签（Node 内置 zlib，零依赖） */
function extractDocxText(buf: Buffer): string | null {
  try {
    // 从尾部找 End of Central Directory
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    if (eocd < 0) return null
    const entryCount = buf.readUInt16LE(eocd + 10)
    let cdOffset = buf.readUInt32LE(eocd + 16)
    // 遍历 Central Directory 找 word/document.xml
    for (let i = 0; i < entryCount; i++) {
      if (buf.readUInt32LE(cdOffset) !== 0x02014b50) break
      const method = buf.readUInt16LE(cdOffset + 10)
      const compSize = buf.readUInt32LE(cdOffset + 20)
      const nameLen = buf.readUInt16LE(cdOffset + 28)
      const extraLen = buf.readUInt16LE(cdOffset + 30)
      const localOffset = buf.readUInt32LE(cdOffset + 42)
      const name = buf.slice(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8')
      if (name === 'word/document.xml') {
        // Local header：跳过文件名/扩展字段拿数据
        const lhNameLen = buf.readUInt16LE(localOffset + 26)
        const lhExtraLen = buf.readUInt16LE(localOffset + 28)
        const dataStart = localOffset + 30 + lhNameLen + lhExtraLen
        const raw = buf.slice(dataStart, dataStart + compSize)
        const xml = method === 8 ? zlib.inflateRawSync(raw).toString('utf8') : method === 0 ? raw.toString('utf8') : null
        if (!xml) return null
        // 段落转换：w:p → 换行；剥其余标签；解 XML 实体
        return xml
          .replace(/<\/w:p>/g, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      }
      cdOffset += 46 + nameLen + extraLen
    }
    return null
  } catch {
    return null
  }
}

/** PDF 尽力提取：stream 块（FlateDecode inflate）+ 括号内文本运算符（Tj/TJ） */
function extractPdfText(buf: Buffer): string | null {
  try {
    const parts: string[] = []
    const str = buf.toString('latin1')
    const re = /stream\r?\n([\s\S]*?)endstream/g
    let m: RegExpExecArray | null
    while ((m = re.exec(str)) !== null) {
      const chunk = Buffer.from(m[1], 'latin1')
      // 先试 zlib 头 inflate，再试 raw deflate（PDF FlateDecode 无 zlib 头）
      let text = ''
      try {
        text = zlib.inflateSync(chunk).toString('latin1')
      } catch {
        try {
          text = zlib.inflateRawSync(chunk).toString('latin1')
        } catch {
          text = m[1] // 未压缩流直接用
        }
      }
      // 提取 (...) 文本：Tj 单串 / TJ 数组（含 \( \) \\ 转义）
      const tre = /\((?:\\.|[^\\()])*\)/g
      let t: RegExpExecArray | null
      while ((t = tre.exec(text)) !== null) {
        const s = t[0]
          .slice(1, -1)
          .replace(/\\([()\\])/g, '$1')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '')
        if (s.trim()) parts.push(s)
      }
    }
    const out = parts.join(' ').replace(/\s{2,}/g, ' ').trim()
    // 中文字体缺失编码时 latin1 会出乱码——乱码占比过高视为失败
    if (!out || out.length < 10) return null
    const junk = (out.match(/[\x00-\x08\x0e-\x1f]/g) || []).length
    return junk / out.length > 0.1 ? null : out
  } catch {
    return null
  }
}

/** data URL + 文件名 → { ok, text, format } */
function extractTextFromDataUrl(mediaUrl: string, fileName?: string): ExtractedText {
  const buf = dataUrlToBuffer(mediaUrl)
  if (!buf || buf.length === 0) return { ok: false, error: '文件内容读不出来' }
  if (fileName && /\.docx$/i.test(fileName)) {
    const t = extractDocxText(buf)
    return t ? { ok: true, text: t, format: 'docx' } : { ok: false, error: '这个 docx 解不开（可能是新版加密格式）' }
  }
  if (fileName && /\.pdf$/i.test(fileName)) {
    const t = extractPdfText(buf)
    return t ? { ok: true, text: t, format: 'pdf' } : { ok: false, error: '这个 PDF 提不出文本（可能是扫描件/图片版）' }
  }
  if (fileName && TEXT_EXT.test(fileName)) {
    return { ok: true, text: buf.toString('utf8'), format: (fileName.match(TEXT_EXT) || [])[1]?.toLowerCase() || 'txt' }
  }
  // 无扩展名/未知扩展：尝试 UTF-8 解码，可打印率高就当文本
  const t = buf.toString('utf8')
  const printable = (t.match(/[\x09\x0a\x0d\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  if (t.length && printable / t.length > 0.85) return { ok: true, text: t, format: 'txt' }
  return { ok: false, error: '这个格式暂时读不了（支持 txt/md/csv/docx/pdf）' }
}

/** 大文件分块 */
function chunkText(text: string, size: number = OFFICE_CHUNK_SIZE): string[] {
  if (text.length <= size) return [text]
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    // 在块尾就近找断行，避免句子拦腰截断
    let end = Math.min(i + size, text.length)
    if (end < text.length) {
      const br = text.lastIndexOf('\n', end)
      if (br > i + size * 0.6) end = br
    }
    chunks.push(text.slice(i, end))
  }
  return chunks
}

/** 单块摘要（LLM，失败规则兜底：首段+字数） */
async function summarizeChunk(chunk: string, seq: number, total: number): Promise<string> {
  const r = await llmGenerateChat([
    { role: 'system', content: '你是文档摘要助手。用三五句口语化中文概括下面这段内容的核心信息，直接给摘要正文，不要前后缀。' },
    { role: 'user', content: `（第${seq}/${total}部分）\n${chunk.slice(0, OFFICE_CHUNK_SIZE)}` },
  ])
  const t = r && r.text ? r.text.trim() : ''
  if (t.length >= 10 && t.length <= 500) return t
  // 规则兜底
  const firstPara = chunk.split(/\n+/).find((p) => p.trim().length > 10) || chunk.slice(0, 120)
  return `要点：${firstPara.trim().slice(0, 150)}…（本部分 ${chunk.length} 字）`
}

/** 文档摘要：≤1 块直接摘要；多块分块摘要再合并（大文件分块处理） */
async function summarizeDocument(text: string, _userId: string): Promise<string> {
  const chunks = chunkText(text)
  if (chunks.length === 1) return summarizeChunk(chunks[0], 1, 1)
  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    parts.push(await summarizeChunk(chunks[i], i + 1, chunks.length))
  }
  const merged = await llmGenerateChat([
    { role: 'system', content: '把下面各部分摘要合并成一段连贯的全文摘要（三五句中文），不要列表不要分点。' },
    { role: 'user', content: parts.map((p, i) => `【部分${i + 1}】${p}`).join('\n') },
  ])
  const t = merged && merged.text ? merged.text.trim() : ''
  return t.length >= 10 && t.length <= 600 ? t : parts.join('\n')
}

/** 生成新版本文档（绝不改原件）：LLM 改写 → Fragment(kind='office_doc') */
async function writeNewVersion(title: string, instruction: string, sourceText: string, userId: string): Promise<WrittenDoc> {
  // !! 强制 boolean：原 `sourceText && boolean` 类型为 string|boolean，
  // 赋给 WrittenDoc.data.truncatedSource(boolean) 报错；运行时真值判断结果不变
  const hasSource = !!(sourceText && sourceText.trim().length > 0)
  const sys = hasSource
    ? '你是文档改写助手。基于原文按指令生成新版本，保留原文关键事实，直接输出新版本正文（可用 Markdown），不要任何前后缀说明。'
    : '你是文档撰写助手。按标题和指令直接输出正文（可用 Markdown），不要任何前后缀说明。'
  const user = hasSource
    ? `标题：${title}\n改写指令：${instruction}\n\n原文：\n${sourceText}`
    : `标题：${title}\n写作指令：${instruction}`
  const r = await llmGenerateChat([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ])
  const body = r && r.text ? r.text.trim() : ''
  if (body.length < 20) return { ok: false, error: '这轮没写出来，再试一次' }
  const docId = `doc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const meta = {
    title,
    instruction,
    basedOn: null,
    version: 1,
    charCount: body.length,
    truncatedSource: hasSource && sourceText.length >= 4000,
  }
  await prisma.$executeRaw`INSERT INTO fragments (id, userId, content, kind, tags, sourceMsgId, digested, note, createdAt) VALUES (${docId}, ${userId}, ${`# ${title}\n\n${body}`}, ${'office_doc'}, ${JSON.stringify(['办公', '新版本'])}, ${null}, 1, ${JSON.stringify(meta)}, datetime('now'))`
  return {
    ok: true,
    data: {
      docId,
      title,
      previewUrl: `/api/v1/chat/office-docs/${docId}`,
      downloadUrl: `/api/v1/chat/office-docs/${docId}/download?format=md`,
      charCount: body.length,
      truncatedSource: meta.truncatedSource,
    },
  }
}

/** office 意图：read（总结/看下）/ write（改写/润色/纯创作）/ export（导出/下载） */
function detectOfficeIntent(text: string): 'read' | 'write' | 'export' | null {
  const t = text.toLowerCase()
  if (/(总结|摘要|概括|讲了?什么|主要(内容|说了什么)|看(一?下|看)|读(一?下|读))/.test(t) && /(文件|文档|这个|刚发|附件|pdf|docx?|txt|md)/.test(t)) return 'read'
  if (/(改写|润色|改成|改个|调整|续写|扩写|缩写|重新写|翻译成|转成|帮我写|写个|写一份)/.test(t)) return 'write'
  if (/(导出|下载)/.test(t) && /(文档|文件|版本|md|txt)/.test(t)) return 'export'
  return null
}

/** 会话里最近一条文件消息（office 源） */
async function findLatestFileMessage(sessionId: string) {
  const msg = await prisma.message.findFirst({
    where: { sessionId, role: 'user', messageType: 'file', mediaUrl: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, content: true, mediaUrl: true, metadata: true },
  })
  return msg
}

// ============================================================
// 7.5 周报聚合（P1：自然周，供 @回顾 文本版 / API / 周一 Job 共用）
// ============================================================
/** 周一为起点的自然周 Date */
function weekStartOf(date: Date, offsetWeeks = 0): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = (d.getDay() + 6) % 7 // 周一=0
  d.setDate(d.getDate() - day - offsetWeeks * 7)
  return d
}

/** 聚合一周数据 → 结构化周报。offsetWeeks=0 本周（周一~现在），1=上周（完整周） */
export async function buildWeeklyReport(userId: string, offsetWeeks = 0): Promise<WeeklyReport> {
  const now = new Date()
  const start = weekStartOf(now, offsetWeeks)
  const end = offsetWeeks === 0 ? now : new Date(start.getTime() + 7 * 864e5)
  const [bills, doneTasks, diets, msgCount, moods] = await Promise.all([
    prisma.bill.findMany({ where: { userId, billDate: { gte: start, lt: end } }, select: { type: true, amount: true, category: true } }),
    prisma.task.count({ where: { userId, status: 'done', updatedAt: { gte: start, lt: end } } }),
    prisma.diet.findMany({ where: { userId, eatenAt: { gte: start, lt: end } }, select: { calories: true } }),
    prisma.message.count({ where: { userId, role: 'user', createdAt: { gte: start, lt: end } } }),
    prisma.fragment.findMany({ where: { userId, kind: 'mood', createdAt: { gte: start, lt: end } }, select: { content: true }, take: 30 }),
  ])
  const income = bills.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0)
  const expense = bills.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0)
  const byCategory: Record<string, number> = {}
  for (const b of bills.filter((r) => r.type === 'expense')) {
    const key = b.category || '其他'
    byCategory[key] = (byCategory[key] || 0) + b.amount
  }
  const topCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, total]) => ({ name, total }))
  const moodCount = { positive: 0, negative: 0, calm: 0 }
  for (const m of moods) {
    if (m.content.includes('积极')) moodCount.positive += 1
    else if (m.content.includes('低落')) moodCount.negative += 1
    else moodCount.calm += 1
  }
  const streak = await computeStreak(userId)
  const calories = diets.reduce((s, d) => s + (d.calories || 0), 0)
  const note = pick(getWeeklyNotes(userId))
    .replace('{streak}', String(streak))
    .replace('{top_cat}', topCategories.length ? topCategories[0].name : '日常')
  return {
    weekOffset: offsetWeeks,
    range: { start: localDate(start), end: localDate(offsetWeeks === 0 ? now : new Date(end.getTime() - 1)), label: offsetWeeks === 0 ? '本周' : '上周' },
    finance: {
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      balance: Math.round((income - expense) * 100) / 100,
      billCount: bills.length,
      topCategories,
    },
    stats: { doneTasks, dietCount: diets.length, calories, msgCount, streak },
    mood: { ...moodCount, dominant: moodCount.positive >= moodCount.negative ? '整体不错' : '有点down', sampled: moods.length },
    note,
    generatedAt: now.toISOString(),
  }
}

/** 周报文本版（@回顾 气泡用） */
export function formatWeeklyReportText(r: WeeklyReport): string {
  const moodText = r.mood.sampled
    ? `，情绪${r.mood.dominant}（积极${r.mood.positive}/低落${r.mood.negative}）`
    : ''
  return [
    `📊 ${r.range.label}小结 ${r.range.start} ~ ${r.range.end}`,
    `收支：收入 ¥${r.finance.income.toFixed(2)}，支出 ¥${r.finance.expense.toFixed(2)}，结余 ¥${r.finance.balance.toFixed(2)}`,
    r.finance.topCategories.length ? `主要花在：${r.finance.topCategories.slice(0, 3).map((c) => `${c.name} ¥${c.total.toFixed(0)}`).join('、')}` : '',
    `完成待办 ${r.stats.doneTasks} 项，记了 ${r.stats.dietCount} 餐${r.stats.dietCount ? `（${r.stats.calories} 大卡）` : ''}`,
    `咱俩聊了 ${r.stats.msgCount} 句${moodText}`,
    `角角落：${r.note}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 读取周报：上周优先读 Job 缓存（Fragment kind='weekly_report'），本周实时聚合 */
export async function getWeeklyReport(userId: string, offsetWeeks = 0): Promise<{ report: WeeklyReport; cached: boolean }> {
  if (offsetWeeks > 0) {
    const start = weekStartOf(new Date(), offsetWeeks)
    const cached = await prisma.fragment.findFirst({
      where: { userId, kind: 'weekly_report', note: `week:${localDate(start)}` },
      orderBy: { createdAt: 'desc' },
    })
    if (cached) {
      try {
        return { report: JSON.parse(cached.content) as WeeklyReport, cached: true }
      } catch { /* 缓存损坏则实时聚合 */ }
    }
  }
  const report = await buildWeeklyReport(userId, offsetWeeks)
  return { report, cached: false }
}

// ============================================================
// P3 画像面板聚合（@画像 metadata + GET /chat/profile 共用）
// ============================================================
export async function buildProfilePanel(userId: string): Promise<ProfilePanel> {
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const weekAgo = new Date(Date.now() - 7 * 864e5)
  const [bills, totalTasks, doneTasks, memories, moodFrags, msgCount, countsRows] = await Promise.all([
    prisma.bill.findMany({ where: { userId, billDate: { gte: monthStart } }, select: { type: true, amount: true, category: true } }),
    prisma.task.count({ where: { userId } }),
    prisma.task.count({ where: { userId, status: 'done' } }),
    prisma.fragment.findMany({ where: { userId, kind: { in: [...MEMORY_KINDS] as string[] } }, orderBy: { createdAt: 'desc' }, take: 12, select: { id: true, kind: true, content: true, createdAt: true } }),
    prisma.fragment.findMany({ where: { userId, kind: 'mood', createdAt: { gte: weekAgo } }, select: { content: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.message.count({ where: { userId, role: 'user' } }),
    prisma.fragment.groupBy({ by: ['kind'], where: { userId, kind: { in: [...MEMORY_KINDS] as string[] } }, _count: { _all: true } }),
  ])
  const expense = bills.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0)
  const byCategory: Record<string, number> = {}
  for (const b of bills.filter((r) => r.type === 'expense')) {
    const key = b.category || '其他'
    byCategory[key] = (byCategory[key] || 0) + b.amount
  }
  const topCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }))
  // 近 7 天情绪带：按日分组（与周报 mood 判定词表一致，另加 烦/累/焦虑/压力 计负面）
  const moodByDay: Record<string, { positive: number; negative: number; calm: number }> = {}
  for (const m of moodFrags) {
    const day = localDate(m.createdAt)
    if (!moodByDay[day]) moodByDay[day] = { positive: 0, negative: 0, calm: 0 }
    if (/积极|开心|高兴|不错/.test(m.content)) moodByDay[day].positive += 1
    else if (/低落|烦|累|焦虑|压力|难过/.test(m.content)) moodByDay[day].negative += 1
    else moodByDay[day].calm += 1
  }
  const moods: ProfilePanel['moods'] = []
  for (let i = 6; i >= 0; i--) {
    const day = localDate(new Date(Date.now() - i * 864e5))
    const c = moodByDay[day]
    moods.push({
      date: day.slice(5),
      level: !c ? 'none' : c.negative > c.positive ? 'low' : c.positive > 0 ? 'good' : 'calm',
      sampled: c ? c.positive + c.negative + c.calm : 0,
    })
  }
  // 记忆分组统计
  const counts: Record<string, number> = {}
  for (const k of MEMORY_KINDS) counts[k] = 0
  for (const r of countsRows) counts[r.kind] = r._count._all
  const streak = await computeStreak(userId)
  return {
    month: localDate(monthStart).slice(0, 7),
    finance: { expense: Math.round(expense * 100) / 100, topCategories },
    tasks: { total: totalTasks, done: doneTasks, doneRate: totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0 },
    moods,
    memory: {
      counts,
      recent: memories.map((m) => ({ id: m.id, kind: m.kind, content: m.content, date: localDate(m.createdAt) })),
    },
    relation: { streak, msgCount },
    generatedAt: new Date().toISOString(),
  }
}

// ============================================================
// 8. 关系深度计算（启动问候用）
// ============================================================
async function computeStreak(userId: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 864e5)
  const msgs = await prisma.message.findMany({
    where: { userId, role: 'user', createdAt: { gte: since } },
    select: { createdAt: true },
  })
  const days = new Set(msgs.map((m) => localDate(m.createdAt)))
  let streak = 0
  const d = new Date()
  if (!days.has(localDate(d))) d.setDate(d.getDate() - 1) // 今天还没发言则从昨天起算
  while (days.has(localDate(d))) {
    streak += 1
    d.setDate(d.getDate() - 1)
  }
  return streak
}

// ============================================================
// 9. AgentCore 单例
// ============================================================
class AgentCore {
  /** 加载会话历史（可排除刚存的当前消息），升序返回 */
  async getHistory(sessionId: string, limit = 20, excludeMsgId?: string) {
    const rows = await prisma.message.findMany({
      where: { sessionId, ...(excludeMsgId ? { NOT: { id: excludeMsgId } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { role: true, content: true, metadata: true },
    })
    return rows.reverse()
  }

  /** 每轮对话后异步触发理解管线（fire-and-forget，不阻塞回复） */
  fireUnderstanding(userId: string, sessionId: string, userText: string, sourceMsgId?: string) {
    runUnderstandingPipeline(userId, sessionId, userText, sourceMsgId || null).catch(() => {})
  }

  /** 统一入口 */
  async handle(req: AgentRequest): Promise<AgentReply> {
    const { userId, sessionId, message, excludeMsgId } = req
    const userText = ((message && message.content) || '').trim()
    const ctx: ToolContext = { userId, sessionId, rawText: userText }

    // 0. 危机信号（最高优先级）：高风险 → legacy 危机卡（热线资源）
    if (CRISIS_HIGH_RE.test(userText)) {
      this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
      return generateReply(userText, userId, sessionId)
    }

    // 0.5 纯数字 → 尝试补全 pending 账（在噪音拦截之前）
    const justAmount = userText.match(/^(\d+(?:\.\d+)?)(?:元|块)?$/)
    if (justAmount) {
      const completed = await tryCompletePendingBill(userId, Number(justAmount[1]))
      if (completed) {
        this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
        return {
          reply: `补上了：${completed.title} ¥${completed.amount}（${completed.category}）`,
          messageType: 'text',
          metadata: { accounting: { entryId: completed.entryId, completed: true } },
        }
      }
    }

    // 1. 短回复拦截（需要上条 AI 消息判断语境）
    const history = await this.getHistory(sessionId, 20, excludeMsgId)
    const lastAiMsg = [...history].reverse().find((m) => m.role === 'assistant')
    const lastAi = lastAiMsg?.content || ''
    const guard = handleShortReply(userText, lastAi)
    if (guard.type !== 'PASS') {
      this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
      switch (guard.type) {
        case 'SILENT_ACK':
          return { silentAck: true }
        case 'EMPATHY':
        case 'CLOSE':
        case 'NOISE':
          return { reply: guard.text, messageType: 'text', metadata: { guard: guard.type } }
        case 'DELEGATE':
          // P1 模糊意向落地：上条 AI 在问任务时间（legacy 时间选项卡）→ 代选第一个槽直接创建
          {
            const landed = await this.tryDelegateSchedule(lastAiMsg, ctx)
            if (landed) return landed
            return { reply: guard.text, messageType: 'text', metadata: { guard: 'DELEGATE', decision: guard.summary } }
          }
        default:
          return { silentAck: true }
      }
    }

    // 2. 显性化指令：@回顾/@周报 @画像 @找
    const cmd = await this.handleExplicitCommand(userText, ctx)
    if (cmd) {
      this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
      return cmd
    }

    // 2.5 P2 情绪评估（每条静默跑一次，供心理陪伴/日程守卫复用）
    const mood = assessMoodLexicon(userText)
    const midCrisis = CRISIS_MID_RE.test(userText)
    const negSelf = NEG_SELF_RE.test(userText)
    const emotionallyLoaded = midCrisis || negSelf || mood.valence <= -0.5

    // 3. 记账快路（确定性规则，零延迟落库）
    const entry = detectAccountingEntry(userText)
    if (entry) {
      const r = await this.executeAccountingEntry(userId, entry, ctx)
      this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
      return r
    }

    // 3.2 完成待办快路：「XX 搞定了/办完了/做完了」
    const doneKw = userText.match(/^(.+?)(?:搞定了|办完[了啦]|做完了|完成了|完事了|办好了)[。！!~]?$/)
    if (doneKw && doneKw[1].trim()) {
      const r = await executeTool('schedule.complete_event', { title: doneKw[1].trim() }, ctx)
      if (r.success && r.data) {
        this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
        return {
          reply: `销掉了：${r.data.title} 👌`,
          messageType: 'text',
          metadata: { schedule: { completed: true, taskId: r.data.taskId } },
        }
      }
    }

    // 3.5 日程快路（P1 三件套主入口：明确时间+任务意图 → 直接创建，绝不追问）
    // P2 守卫1：情绪强烈时人优先于事，不建任务（如「焦虑得睡不着，明天还有个早会」）
    // P2 守卫2：办公创作意图（帮我写个XX）无明确钟点时不抢日程——「帮我写个请假条，明天要去医院」是创作不是日程
    // P2 守卫3：出行类日程（要去某地/见某人且没说路程）LLM 在线时让给 LLM——它会反问路程、反推出发时间（出行规划）
    const officeWriteIntent = detectOfficeIntent(userText) === 'write'
    const hasClockTime = /\d{1,2}点|\d{1,2}[:：]\d{2}|上午|下午|晚上|中午|早上|傍晚/.test(userText)
    const travelDeferToLLM = isLLMOnline() && isTravelScheduleWithoutDistance(userText)
    if (!emotionallyLoaded && !(officeWriteIntent && !hasClockTime) && !travelDeferToLLM && detectScheduleIntent(userText)) {
      const r = await this.executeScheduleEntry(userText, ctx)
      if (r) {
        this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
        return r
      }
    }

    // 4. 查账意图 → 确定性工具绑定
    if (detectQueryIntent(userText)) {
      const r = await this.handleQueryWithTools(ctx, userText)
      if (r) {
        this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
        return r
      }
      // LLM 工具路径失败 → 继续 legacy（有规则兜底）
    }

    // 4.5 心理陪伴（P2）：认知重构 / 连续低落共情占位 / 中风险陪伴路径
    if (negSelf) {
      const r = await buildCognitiveReframe(userId, mood)
      this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
      return r
    }
    if (mood.valence <= -0.5 || midCrisis) {
      // 大波动（近 24h 已连着两条低落）→ 共情占位，30 分钟冷却
      const burst = await detectMoodBurst(userId)
      if (burst && empathyCooldownOk(userId)) {
        this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
        return {
          reply: pick(EMPATHY_HOLD),
          messageType: 'text',
          metadata: { psychology: { type: 'empathy_hold', burst: true } },
        }
      }
      // 中风险词（崩溃/抑郁/绝望…）→ 心理陪伴 LLM 路径（只接住不说教），失败落共情占位
      if (midCrisis) {
        const r = await psychologyLLMReply(userText, history)
        this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
        if (r) return r
        return {
          reply: pick(EMPATHY_HOLD),
          messageType: 'text',
          metadata: { psychology: { type: 'empathy_hold', fallback: true } },
        }
      }
      // 单次负面（未达波动阈值）→ 掉 legacy，人设已含共情
    }

    // 4.6 办公小助手（P2）：读文档摘要 / 生成新版本 / 导出
    const officeIntent = detectOfficeIntent(userText)
    if (officeIntent) {
      const r = await this.handleOfficeIntent(officeIntent, userText, ctx, history)
      if (r) {
        this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
        return r
      }
      // 无文件源 → 掉 legacy 继续对话
    }

    // 5. 正常对话 → legacy 全能力（上下文 LLM / 任务卡 / 饮食卡 / 交接卡…）
    const r = await generateReply(userText, userId, sessionId)
    this.fireUnderstanding(userId, sessionId, userText, excludeMsgId)
    return r
  }

  /** 记账快路执行 */
  async executeAccountingEntry(userId: string, entry: AccountingEntry, ctx: ToolContext): Promise<AgentReply> {
    if (!entry.hasAmount) {
      // 缺金额 → pending_confirm 队列，绝不追问
      await executeTool('accounting.add_entry', { title: entry.title, type: entry.type }, { ...ctx, userId })
      return {
        reply: `先记着了：${entry.title}，想到多少钱了随时跟我说一声`,
        messageType: 'text',
        metadata: { accounting: { pending: true, title: entry.title } },
      }
    }
    const result = await executeTool(
      'accounting.add_entry',
      { amount: entry.amount, title: entry.title, type: entry.type },
      { ...ctx, userId },
    )
    if (result.success && result.data && !result.data.pending) {
      const d = result.data
      return {
        reply: `记好了：${d.title} ¥${d.amount}（${d.category}）`,
        messageType: 'text',
        metadata: { accounting: d },
      }
    }
    return { reply: '记好了', messageType: 'text', metadata: { accounting: { fallback: true } } }
  }

  /** 日程快路执行：解析时间 → 冲突检测 → 直接创建（绝不追问） */
  async executeScheduleEntry(userText: string, ctx: ToolContext): Promise<AgentReply | null> {
    const title = extractScheduleTitle(userText)
    const dayOffset = parseDayOffset(userText)
    const hm = parseHourMinute(userText)
    // 无日期无时间 → 不走快路（掉 legacy）
    if (dayOffset === null && !hm) return null
    let when = new Date()
    if (dayOffset !== null) when.setDate(when.getDate() + dayOffset)
    if (hm) {
      when.setHours(hm.hour, hm.minute, 0, 0)
      // 今天但时间已过 → 顺延到明天同一时间
      if (dayOffset === null || dayOffset === 0) {
        if (when <= new Date() && dayOffset === null) when.setDate(when.getDate() + 1)
      }
    } else {
      // 有日期无钟点 → 历史偏好时段（取偏好小时，应用到目标日期）
      const pref = await nextPreferredSlot(ctx.userId)
      when = new Date()
      when.setDate(when.getDate() + (dayOffset || 0))
      when.setHours(pref.getHours(), 0, 0, 0)
      if (when <= new Date()) when.setDate(when.getDate() + 1) // 今天已过 → 明天
    }
    const result = await executeTool('schedule.create_event', { title, date: when.toISOString() }, ctx)
    if (!result.success) return null
    const d = result.data
    const label = formatScheduleLabel(new Date(d.when))
    let reply: string
    if (d.adjusted) {
      reply = `${formatScheduleLabel(when)}那个点你已经有「${d.conflicts[0]}」了，给你挪到 ${label}，${d.title}记上了`
    } else {
      reply = `安排上了：${label} ${d.title}`
    }
    return {
      reply,
      messageType: 'text',
      metadata: { schedule: { taskId: d.taskId, title: d.title, when: d.when, adjusted: d.adjusted } },
    }
  }

  /** P1 模糊意向落地：上条是 legacy 任务时间选项卡 → 代选第一个时间槽直接创建 */
  async tryDelegateSchedule(lastAiMsg: { metadata?: string | null } | undefined, ctx: ToolContext): Promise<AgentReply | null> {
    if (!lastAiMsg || !lastAiMsg.metadata) return null
    let meta: { pendingTaskCreation?: { title: string; date?: string | null }; options?: { timeSlots?: { value: string }[] } }
    try {
      meta = JSON.parse(lastAiMsg.metadata)
    } catch {
      return null
    }
    const pending = meta.pendingTaskCreation
    if (!pending || !meta.options) return null
    const slot = (meta.options.timeSlots && meta.options.timeSlots[0] && meta.options.timeSlots[0].value) || '09:00'
    // 组装时间：pending.date（YYYY-MM-DD）+ 槽位 HH:mm，缺日期默认今天，已过则明天
    let dateStr = pending.date
    if (!dateStr) {
      const now = new Date()
      dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    }
    let when = new Date(`${dateStr}T${slot}:00`)
    if (Number.isNaN(when.getTime())) return null
    if (when <= new Date()) when = new Date(when.getTime() + 864e5)
    const result = await executeTool('schedule.create_event', { title: pending.title, date: when.toISOString() }, ctx)
    if (!result.success) return null
    const d = result.data
    const label = formatScheduleLabel(new Date(d.when))
    return {
      reply: `行，${label} ${d.title}，给你定好了`,
      messageType: 'text',
      metadata: { schedule: { taskId: d.taskId, title: d.title, when: d.when, via: 'delegate' } },
    }
  }

  /** P2 办公小助手编排：read（摘要）/ write（新版本）/ export（导出）
   * 红线：只读不改原件——原文仅作 LLM 输入，新版本独立成文（Fragment kind='office_doc'）
   */
  async handleOfficeIntent(intent: 'read' | 'write' | 'export', userText: string, ctx: ToolContext, _history: unknown[]): Promise<AgentReply | null> {
    const fileMsg = await findLatestFileMessage(ctx.sessionId)
    if (intent === 'read') {
      if (!fileMsg) {
        // 无文件源：若是纯「总结一下」掉 legacy；明确提到文件则提示
        if (/(文件|文档|附件|刚发)/.test(userText)) {
          return { reply: '这边还没收到文件。发我一个（txt/md/csv/docx/pdf 都行），我看完直接给你讲。', messageType: 'text' }
        }
        return null
      }
      const fileName = fileMsg.content || '未命名文件'
      const r = await executeTool('office.read_document', { mediaUrl: fileMsg.mediaUrl || '', fileName }, ctx)
      if (!r.success) {
        return { reply: `${fileName}这个我打不开：${r.error}`, messageType: 'text', metadata: { office: { error: r.error } } }
      }
      const d = r.data
      return {
        reply: `${fileName}看完了（${d.charCount} 字${d.chunkCount > 1 ? `，分了 ${d.chunkCount} 段处理` : ''}）：${d.summary}`,
        messageType: 'text',
        metadata: { office: { type: 'read', fileName: d.fileName, format: d.format, charCount: d.charCount, summary: d.summary } },
      }
    }
    if (intent === 'write') {
      // 有文件源 → 原文作输入；无文件源 → 纯创作（如「帮我写个请假条」）
      let sourceText = ''
      let basedOn: string | null = null
      if (fileMsg) {
        const extracted = extractTextFromDataUrl(fileMsg.mediaUrl || '', fileMsg.content || undefined)
        if (extracted.ok && extracted.text && extracted.text.trim()) {
          sourceText = extracted.text
          basedOn = fileMsg.content || null
        }
      }
      // 标题：优先从指令提取「写成/改成 XX」
      const titleMatch = userText.match(/(?:写成|改成|写一?[份个]|写个?|生成一?[份个]?|来个?|帮我(?:写|做)一?[份个条]?)(.{2,20}?)(?:吧|呗|，|。|$)/)
      let title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : '新文档'
      // 剥尾巴：「改成周报口吻重新整理一下」→ 标题只取「周报口吻」
      title = title.split(/重新|一遍|一下|再帮/)[0].replace(/[的了把给]$/, '').trim().slice(0, 30) || '新文档'
      const r = await executeTool('office.write_document', { title, instruction: userText, sourceText, basedOn: basedOn || undefined }, ctx)
      if (!r.success) return { reply: r.error || '生成失败', messageType: 'text' }
      const d = r.data
      const srcNote = basedOn ? `（基于《${basedOn}》生成，原件没动）` : ''
      const truncNote = d.truncatedSource ? '。原文太长，新版本基于前 4000 字生成' : ''
      return {
        reply: `新版本好了：「${d.title}」${srcNote}${truncNote}`,
        messageType: 'text',
        metadata: {
          office: {
            type: 'write',
            docId: d.docId,
            title: d.title,
            previewUrl: d.previewUrl,
            downloadUrl: d.downloadUrl,
            charCount: d.charCount,
            basedOn,
          },
        },
      }
    }
    if (intent === 'export') {
      // 找最近生成的新版本
      const doc = await prisma.fragment.findFirst({
        where: { userId: ctx.userId, kind: 'office_doc' },
        orderBy: { createdAt: 'desc' },
      })
      if (!doc) return { reply: '还没有生成过新版本。先说「帮我改写/写个 XX」，生成后就能导出。', messageType: 'text' }
      const r = await executeTool('office.export_document', { docId: doc.id, format: /txt/.test(userText) ? 'txt' : 'md' }, ctx)
      if (!r.success) return { reply: r.error || '导出失败', messageType: 'text' }
      const meta = JSON.parse(doc.note || '{}') as { title?: string }
      return {
        reply: `导出好了：「${meta.title || doc.id}」，点下面下载。`,
        messageType: 'text',
        metadata: {
          office: {
            type: 'export',
            docId: r.data.docId,
            format: r.data.format,
            title: meta.title,
            previewUrl: `/api/v1/chat/office-docs/${r.data.docId}`,
            downloadUrl: r.data.downloadUrl,
          },
        },
      }
    }
    return null
  }

  /** 查账/查待办：确定性参数绑定 → 工具执行 → 规则文案回报
   * P0：Qwen2.5-7B 的 tool_choice=auto 乱码、LLM 改写数字口误（均实测），
   * 查账数字必须准确，故参数与文案全走确定性规则；换强模型后可升级为 LLM 路径。
   */
  async handleQueryWithTools(ctx: ToolContext, userText: string): Promise<AgentReply | null> {
    const isSchedule = /(待办|任务|日程|安排)/.test(userText)
    const toolName = isSchedule ? 'schedule.query_events' : 'accounting.query_report'
    const params = isSchedule
      ? { range: /月/.test(userText) ? 'month' : 'week' }
      : detectReportParams(userText)
    const result = await executeTool(toolName, params, ctx)
    if (!result.success) return null
    const d = result.data
    const label = RANGE_LABEL[d.range] || '这阵子'

    // P0：直接返回规则文案。实测 Qwen2.5-7B 数字保真度不足（明令保留数字仍口误），
    // 查账数字必须准确，故不走 LLM 改写；换强模型后可在此加 LLM 口语化+数字校验。
    if (isSchedule) {
      const tasks = d.tasks || []
      if (!tasks.length) return { reply: `接下来${d.range === 'month' ? '一个月' : '一周'}没有待办，清清爽爽。`, messageType: 'text', metadata: { via: 'agent-tools', tools: [toolName], report: d } }
      const pending = tasks.filter((t: { status: string }) => t.status !== 'done')
      return {
        reply: `接下来${d.range === 'month' ? '一个月' : '一周'}有 ${tasks.length} 个待办，没完成的 ${pending.length} 个：${pending.slice(0, 3).map((t: { title: string }) => t.title).join('、')}。`,
        messageType: 'text',
        metadata: { via: 'agent-tools', tools: [toolName], report: d },
      }
    }
    if (!d.count) return { reply: `${label}没记过账，想记随时说。`, messageType: 'text', metadata: { via: 'agent-tools', tools: [toolName], report: d } }
    const catText = d.categories?.length ? `，花得最多的是${d.categories[0].name}（¥${d.categories[0].total}）` : ''
    return {
      reply: `${label}支出 ¥${d.expense}，收入 ¥${d.income}，结余 ¥${d.balance}${catText}。`,
      messageType: 'text',
      metadata: { via: 'agent-tools', tools: [toolName], report: d },
    }
  }

  /** @指令显性化（仅此三条） */
  async handleExplicitCommand(text: string, ctx: ToolContext): Promise<AgentReply | null> {
    if (/^@(回顾|周报)/.test(text)) return this.renderWeeklyReport(ctx.userId)
    if (/^@画像/.test(text)) return this.renderPortrait(ctx.userId)
    const find = text.match(/^@找\s*(.+)/)
    if (find) return this.searchMemory(ctx.userId, find[1].trim())
    return null
  }

  /** @回顾/@周报：聚合本周数据（P1 结构化 + 文本版共用 buildWeeklyReport） */
  async renderWeeklyReport(userId: string): Promise<AgentReply> {
    const report = await buildWeeklyReport(userId, 0)
    return {
      reply: formatWeeklyReportText(report),
      messageType: 'text',
      metadata: { weeklyReport: report },
    }
  }

  /** @画像：只读画像面板（P0 文本版 + P3 结构化 metadata 供跳转卡） */
  async renderPortrait(userId: string): Promise<AgentReply> {
    const portrait = await buildProfilePanel(userId)
    const lines = [
      `🧩 你的画像（${portrait.month}）`,
      `消费：本月支出 ¥${portrait.finance.expense.toFixed(2)}${portrait.finance.topCategories.length ? `，偏${portrait.finance.topCategories.map((c) => c.name).join('、')}` : ''}`,
      `做事：待办完成率 ${portrait.tasks.doneRate}%（${portrait.tasks.done}/${portrait.tasks.total}）`,
      `陪聊：连续 ${portrait.relation.streak} 天，累计 ${portrait.relation.msgCount} 句`,
    ]
    if (portrait.memory.recent.length) {
      lines.push('我记得的：')
      for (const m of portrait.memory.recent.slice(0, 6)) lines.push(`· ${m.content}（${m.kind}）`)
    } else {
      lines.push('咱俩还聊得不多，多聊聊我就更懂你了。')
    }
    return { reply: lines.join('\n'), messageType: 'text', metadata: { portrait } }
  }

  /** P3：多模态消息的理解入口（multimodal 端点调用，受隐私四档管控） */
  async understandFromMultimodal(userId: string, sessionId: string, userText: string, sourceMsgId: string | null) {
    return runUnderstandingPipeline(userId, sessionId, userText, sourceMsgId, 'multimodal')
  }

  /** @找：检索记忆（Fragment 记忆 + 账单名目 + 待办） */
  async searchMemory(userId: string, query: string): Promise<AgentReply> {
    const q = query.slice(0, 30)
    const [frags, bills, tasks] = await Promise.all([
      prisma.fragment.findMany({
        where: { userId, kind: { in: [...MEMORY_KINDS, 'pending_bill'] as string[] }, content: { contains: q } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, content: true, kind: true, createdAt: true },
      }),
      prisma.bill.findMany({ where: { userId, OR: [{ title: { contains: q } }, { category: { contains: q } }] }, orderBy: { billDate: 'desc' }, take: 5, select: { title: true, amount: true, type: true, billDate: true } }),
      prisma.task.findMany({ where: { userId, title: { contains: q } }, orderBy: { createdAt: 'desc' }, take: 5, select: { title: true, status: true, dueDate: true } }),
    ])
    const lines = [`🔎 找「${q}」的结果：`]
    if (frags.length) lines.push(...frags.map((f) => `· 记忆：${f.content}`))
    if (bills.length) lines.push(...bills.map((b) => `· 账单：${b.title} ¥${b.amount}（${b.type === 'income' ? '收入' : '支出'}）`))
    if (tasks.length) lines.push(...tasks.map((t) => `· 待办：${t.title}${t.status === 'done' ? '（已完成）' : ''}`))
    if (!frags.length && !bills.length && !tasks.length) lines.push('没找到相关记录，换个词试试？')
    return {
      reply: lines.join('\n'),
      messageType: 'text',
      metadata: {
        search: {
          query: q,
          fragments: frags.map((f) => ({ id: f.id, kind: f.kind, content: f.content, date: localDate(f.createdAt) })),
          bills: bills.map((b) => ({ title: b.title, amount: b.amount, type: b.type, date: localDate(b.billDate) })),
          tasks: tasks.map((t) => ({ title: t.title, status: t.status, due: t.dueDate ? localDate(t.dueDate) : null })),
        },
      },
    }
  }
}

// ============================================================
// 10. 启动问候（冷启动仅一次：空会话注入）
// ============================================================
const GREETING_INFLIGHT = new Set<string>()
export async function maybeInjectGreeting(sessionId: string, userId: string) {
  // 并发防重：同一会话问候注入进行中时直接跳过（防双开页/双请求双倍问候）
  if (GREETING_INFLIGHT.has(sessionId)) return null
  GREETING_INFLIGHT.add(sessionId)
  try {
    const count = await prisma.message.count({ where: { sessionId } })
    if (count > 0) return null
    // 关系深度
    const [totalUserMsgs, lastUserMsg] = await Promise.all([
      prisma.message.count({ where: { userId, role: 'user' } }),
      prisma.message.findFirst({ where: { userId, role: 'user' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ])
    const streak = await computeStreak(userId)
    const relationTag: 'streak' | 'returning' | 'first' | 'daily' =
      streak > 7 ? 'streak'
        : lastUserMsg && Date.now() - lastUserMsg.createdAt.getTime() > 7 * 864e5 ? 'returning'
          : totalUserMsgs < 3 ? 'first'
            : 'daily'
    // 时间感知
    const hour = new Date().getHours()
    const bucket: 'late' | 'morning' | 'noon' | 'evening' = hour < 6 ? 'late' : hour < 11 ? 'morning' : hour < 14 ? 'noon' : hour < 19 ? 'evening' : 'late'
    // P4：语料池来自配置文件（按用户 A/B 分桶），后台可热更
    const gc = getGreetingConfig(userId)
    let text = pick(gc.timePools[bucket])
    // 首见/久别/连击 才补关系语，日常不加
    if (relationTag === 'first' || relationTag === 'returning' || relationTag === 'streak') {
      text += ' ' + pick(gc.relationPools[relationTag]).replace('{n}', String(streak))
    }
    // 概率碎碎念（noteProb 可配置）
    if (Math.random() < gc.noteProb) {
      text += '\n' + pick(gc.casualNotes)
    }
    return await prisma.message.create({
      data: {
        sessionId,
        userId,
        role: 'assistant',
        content: text,
        messageType: 'text',
        metadata: JSON.stringify({ greeting: true, relation: relationTag, timeBucket: bucket, abBucket: bucketOf(userId) }),
      },
    })
  } catch (e) {
    console.error('[AgentCore] greeting inject failed:', e instanceof Error ? e.message : e)
    return null
  } finally {
    GREETING_INFLIGHT.delete(sessionId)
  }
}

// ============================================================
// 11. 单例导出
// ============================================================
let _instance: AgentCore | null = null
export function initAgentCore(): AgentCore {
  if (!_instance) _instance = new AgentCore()
  return _instance
}
export function getAgentCore(): AgentCore {
  if (!_instance) _instance = new AgentCore()
  return _instance
}
