// ============================================================
// P4 运营配置化：Agent 语料/人设配置服务
// - 配置文件：backend/config/agent-config.json（随包分发，可后台编辑）
// - 热更：① 每次 getAgentConfig() 检查 mtime（文件被外部改动即时生效）
//         ② POST /admin/config/reload 强制重读（规格指定路径）
// - A/B 语料池：abTest.enabled 时按 hash(userId) 稳定分桶（同用户永远同桶）
// - 兜底：文件缺失/损坏/字段缺省 → 逐字段回退内置默认值，服务不中断
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config/agent-config.json')

// ------------------------------------------------------------
// 类型定义
// ------------------------------------------------------------
interface GreetingVariant {
  timePools: {
    morning: string[]
    noon: string[]
    evening: string[]
    late: string[]
  }
  relationPools: {
    first: string[]
    returning: string[]
    daily: string[]
    streak: string[]
  }
  casualNotes: string[]
  noteProb: number
}

export interface AgentConfig {
  version: number
  abTest: { enabled: boolean }
  greeting: { A: GreetingVariant; B: GreetingVariant | null }
  weeklyNotes: { A: string[]; B: string[] | null }
  /** 人设覆盖：非空时整体替换 llmService system prompt 的回复风格区块 */
  personaPrompt: string
}

/** 内置默认值（与抽取前 agentCore/llmService 硬编码一致，保证行为不回归） */
const DEFAULTS: AgentConfig = {
  version: 1,
  abTest: { enabled: false },
  greeting: {
    A: {
      timePools: {
        morning: ['早呀～睡得咋样？', '早安，今天状态如何？', '醒了？喝水没？'],
        noon: ['中午好啊，吃啥了？', '午休够不够？', '这点儿最困，撑住～'],
        evening: ['下班/收工啦？', '今天咋样？顺不顺心？', '忙完了没？饿不饿？'],
        late: ['还没睡呀？', '夜猫子上线', '想聊啥？还是发呆？'],
      },
      relationPools: {
        first: ['我是角角，以后啥事儿找我。', '刚认识，多关照～'],
        returning: ['好久不见，最近咋样？', '消失人口回归！', '终于又见着你了。'],
        daily: ['又见面了。', '今天过得咋样？', '在呢。'],
        streak: ['连续第 {n} 天碰头了😄', '这几天挺规律啊。', '成习惯了？'],
      },
      casualNotes: [
        '昨晚挺晚啊，今早别太勉强。',
        '这周咖啡钱有点超……但开心最重要。',
        '感觉你最近有点闷，要不今晚早点睡？',
        '最近作息稳多了，赞。',
      ],
      noteProb: 0.3,
    },
    B: null,
  },
  weeklyNotes: {
    A: [
      '记账连击 {streak} 天，比我坚持健身久多了 😄',
      '这周聊得挺多的，我都记着呢。',
      '花在 {top_cat} 的钱最多，别太省也别太造。',
      '下周想不想早点睡？无压力，随口一提。',
    ],
    B: null,
  },
  personaPrompt: '',
}

// ------------------------------------------------------------
// 缓存（mtime 检测热更）
// ------------------------------------------------------------
let cache: AgentConfig | null = null
let cacheMtime = 0

/** 深合并：file 值优先，缺省回退 DEFAULTS（数组/标量整体替换，不做数组级合并） */
function deepMerge<T>(defaults: T, file: unknown): T {
  if (file === null || file === undefined) return defaults
  if (defaults === null || defaults === undefined) return file as T
  if (Array.isArray(defaults) || typeof defaults !== 'object') return file as T
  if (Array.isArray(file) || typeof file !== 'object') return defaults
  const out = { ...(defaults as Record<string, unknown>) }
  for (const k of Object.keys(defaults as Record<string, unknown>)) {
    out[k] = deepMerge((defaults as Record<string, unknown>)[k], (file as Record<string, unknown>)[k])
  }
  return out as T
}

function clamp01(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0.3
  return Math.min(1, Math.max(0, v))
}

/** 读文件 + 校验结构化（损坏不炸服务，回退默认并打日志） */
function readRaw(): { cfg: AgentConfig; mtime: number } {
  try {
    const mtime = fs.statSync(CONFIG_PATH).mtimeMs
    if (cache && mtime === cacheMtime) return { cfg: cache, mtime }
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    const merged = deepMerge(DEFAULTS, raw) as AgentConfig
    merged.greeting.A.noteProb = clamp01(merged.greeting.A.noteProb)
    if (merged.greeting.B) merged.greeting.B.noteProb = clamp01(merged.greeting.B.noteProb)
    cache = merged
    cacheMtime = mtime
    return { cfg: merged, mtime }
  } catch (e) {
    if (!cache) {
      cache = structuredClone(DEFAULTS)
      cacheMtime = 0
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[AgentConfig] 配置文件读取失败，使用内置默认值:', e instanceof Error ? e.message : e)
      }
    }
    return { cfg: cache, mtime: cacheMtime }
  }
}

/** 当前生效配置（mtime 变化自动重读） */
export function getAgentConfig(): AgentConfig {
  return readRaw().cfg
}

/** 强制重读（admin 热更接口用）：清缓存后重读文件 */
export function reloadAgentConfig(): { mtime: number; version: number; abEnabled: boolean } {
  cache = null
  cacheMtime = 0
  const { cfg, mtime } = readRaw()
  return { mtime, version: cfg.version, abEnabled: !!cfg.abTest?.enabled }
}

// ------------------------------------------------------------
// A/B 分桶
// ------------------------------------------------------------
/** 稳定分桶：userId 字符码求和奇偶 → 'A' | 'B'（同用户永远同桶，无随机抖动） */
export function bucketOf(userId: string | number): 'A' | 'B' {
  const cfg = getAgentConfig()
  if (!cfg.abTest?.enabled) return 'A'
  let sum = 0
  for (const ch of String(userId || '')) sum += ch.codePointAt(0)!
  return sum % 2 === 0 ? 'A' : 'B'
}

/** 取该用户分桶的问候配置（B 桶未配置时回退 A） */
export function getGreetingConfig(userId: string | number): GreetingVariant {
  const cfg = getAgentConfig()
  if (bucketOf(userId) === 'B' && cfg.greeting.B) return cfg.greeting.B
  return cfg.greeting.A
}

/** 取该用户分桶的周报碎碎念模板 */
export function getWeeklyNotes(userId: string | number): string[] {
  const cfg = getAgentConfig()
  if (bucketOf(userId) === 'B' && cfg.weeklyNotes.B) return cfg.weeklyNotes.B
  return cfg.weeklyNotes.A
}

/** 人设覆盖文本（空串=用内置人设）
 * 铁律⑨重点项：AGENT_PERSONA_PROMPT 环境变量优先（main.cjs 从 userData 持久化注入，重打包不丢），
 * 其次配置文件 personaPrompt，最后空串。
 */
export function getPersonaPrompt(): string {
  const envPersona = process.env.AGENT_PERSONA_PROMPT
  if (envPersona && envPersona.trim()) return envPersona.trim()
  return getAgentConfig().personaPrompt || ''
}

// ------------------------------------------------------------
// 校验 + 写入（admin PUT 用）
// ------------------------------------------------------------
const POOL_KEYS = ['morning', 'noon', 'evening', 'late'] as const
const RELATION_KEYS = ['first', 'returning', 'daily', 'streak'] as const
const MAX_ITEMS = 50
const MAX_LINE = 100

function assertStrArray(arr: unknown, p: string, { allowEmpty = false } = {}): void {
  if (!Array.isArray(arr)) throw new Error(`${p} 必须是字符串数组`)
  if (!allowEmpty && arr.length === 0) throw new Error(`${p} 至少保留 1 条`)
  if (arr.length > MAX_ITEMS) throw new Error(`${p} 最多 ${MAX_ITEMS} 条`)
  arr.forEach((s: unknown, i: number) => {
    if (typeof s !== 'string' || !s.trim()) throw new Error(`${p}[${i}] 不能为空`)
    if (s.length > MAX_LINE) throw new Error(`${p}[${i}] 超过 ${MAX_LINE} 字`)
  })
}

function assertGreetingVariant(v: unknown, p: string): void {
  if (v === null || v === undefined) return
  const obj = v as Record<string, unknown>
  const tp = obj?.timePools as Record<string, unknown>
  const rp = obj?.relationPools as Record<string, unknown>
  for (const k of POOL_KEYS) assertStrArray(tp?.[k], `${p}.timePools.${k}`)
  for (const k of RELATION_KEYS) assertStrArray(rp?.[k], `${p}.relationPools.${k}`)
  assertStrArray(obj?.casualNotes, `${p}.casualNotes`, { allowEmpty: true })
  const n = Number(obj?.noteProb)
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${p}.noteProb 必须在 0~1 之间`)
}

/** 校验完整配置对象（写入前把关；通过后与默认值合并落盘） */
export function validateAgentConfig(raw: unknown): void {
  if (!raw || typeof raw !== 'object') throw new Error('配置必须是对象')
  const obj = raw as Record<string, unknown>
  if (obj.abTest && typeof obj.abTest !== 'object') throw new Error('abTest 必须是对象')
  if (obj.abTest && typeof (obj.abTest as Record<string, unknown>).enabled !== 'boolean') throw new Error('abTest.enabled 必须是布尔值')
  const greeting = obj.greeting as Record<string, unknown>
  assertGreetingVariant(greeting?.A, 'greeting.A')
  assertGreetingVariant(greeting?.B, 'greeting.B')
  const wn = obj.weeklyNotes as Record<string, unknown>
  assertStrArray(wn?.A, 'weeklyNotes.A')
  if (wn?.B != null) assertStrArray(wn.B, 'weeklyNotes.B', { allowEmpty: true })
  if (obj.personaPrompt !== undefined && typeof obj.personaPrompt !== 'string') throw new Error('personaPrompt 必须是字符串')
  if (obj.personaPrompt && (obj.personaPrompt as string).length > 3000) throw new Error('personaPrompt 超过 3000 字')
}

/** 原子写入（tmp+rename）+ 刷新缓存 */
export function writeAgentConfig(next: unknown): AgentConfig {
  validateAgentConfig(next)
  const merged = deepMerge(DEFAULTS, next) as AgentConfig
  const dir = path.dirname(CONFIG_PATH)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${CONFIG_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8')
  fs.renameSync(tmp, CONFIG_PATH)
  cache = null
  cacheMtime = 0
  return getAgentConfig()
}

/** admin 视图：生效配置 + 文件信息 + 分桶说明 */
export function describeAgentConfig() {
  const { cfg, mtime } = readRaw()
  return {
    config: cfg,
    file: {
      path: CONFIG_PATH,
      mtime: mtime ? new Date(mtime).toISOString() : null,
      exists: mtime > 0,
    },
    defaults: DEFAULTS,
  }
}
