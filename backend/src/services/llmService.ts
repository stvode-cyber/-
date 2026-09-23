/**
 * LLM 服务层（LLMService）
 *
 * 统一的大语言模型接口，支持多 Provider：
 * 1. Ollama（本地）— 隐私优先，离线可用
 * 2. OpenAI 兼容 API（云端）— DeepSeek / SiliconFlow / OpenAI 等
 *
 * 设计原则：
 * - 优先使用本地 Ollama（隐私、免费、离线）
 * - Ollama 不可用时自动降级到云端 API（如果配置了）
 * - 都不可用时返回 null，调用方降级到规则系统
 * - 所有调用带超时保护，避免长时间阻塞
 *
 * 集成方式：
 * - ai-reply.ts 在闲聊/上下文感知路径调用 llmGenerateChat()
 * - 结构化操作（任务卡/账单卡等）仍走规则系统，保证速度和可靠性
 */

import type { UserContext } from './contextCollector.js'
import { getPersonaPrompt } from './agentConfig.js'
import { getRequestToken } from '../utils/requestContext.js'

// ============ 类型定义 ============

export type ProviderType = 'ollama' | 'openai' | 'none'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMConfig {
  /** Provider 类型 */
  provider: ProviderType
  /** 模型名称 */
  model: string
  /** API 基础 URL */
  baseUrl: string
  /** API Key（Ollama 不需要） */
  apiKey?: string
  /** 温度（0-1，越高越随机） */
  temperature: number
  /** 最大生成 token 数 */
  maxTokens: number
  /** 请求超时（毫秒） */
  timeout: number
}

export interface LLMResult {
  /** 生成的回复文本 */
  text: string
  /** 使用的 provider */
  provider: ProviderType
  /** 使用的模型 */
  model: string
  /** 耗时（毫秒） */
  durationMs: number
  /** token 使用量（如果可用） */
  tokenUsage?: {
    prompt: number
    completion: number
    total: number
  }
}

// ============ 配置加载 ============

/**
 * 云端 AI 网关上游错误（携带 HTTP 状态码）。
 * 区别于普通"网关不可用/null"：用于把"用户未开通 AI/已到期"这类**业务语义**的
 * 403 从 callGatewayProxy 里传出来，交给上层转为友善提示，而不是静默降级规则回复。
 */
export class GatewayUpstreamError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'GatewayUpstreamError'
  }
}

/**
 * 从环境变量加载 LLM 配置
 *
 * 支持的 env 变量：
 * - LLM_PROVIDER: ollama | openai | none（默认 ollama）
 * - LLM_MODEL: 模型名（默认 qwen2.5:7b）
 * - LLM_BASE_URL: API 地址（Ollama 默认 http://localhost:11434）
 * - LLM_API_KEY: API Key（云端必须）
 * - LLM_TEMPERATURE: 温度（默认 0.7）
 * - LLM_MAX_TOKENS: 最大 token（默认 512）
 * - LLM_TIMEOUT: 超时毫秒（默认 30000）
 */
export function loadLLMConfig(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || 'ollama') as ProviderType
  const model = process.env.LLM_MODEL || 'qwen2.5:7b'
  const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:11434'
  const apiKey = process.env.LLM_API_KEY
  const temperature = parseFloat(process.env.LLM_TEMPERATURE || '0.7')
  const maxTokens = parseInt(process.env.LLM_MAX_TOKENS || '512', 10)
  const timeout = parseInt(process.env.LLM_TIMEOUT || '30000', 10)

  return { provider, model, baseUrl, apiKey, temperature, maxTokens, timeout }
}

// ============ 系统提示构建 ============

/**
 * 基于用户上下文构建系统提示
 *
 * 将 ContextCollector 收集的全模块状态注入 LLM，
 * 让模型"知道"用户当前的任务、财务、健康等状况。
 */
export function buildSystemPrompt(ctx: UserContext, userNickname?: string | null): string {
  const hour = ctx.hour
  const period = hour < 6 ? '深夜' : hour < 11 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 22 ? '晚上' : '深夜'
  const now = new Date()
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`

  const parts: string[] = []

  // 角色定义
  parts.push(`你是「绿角犀」，一个温暖、智能的个人生活助理。当前时间是 ${dateStr} ${period}（${hour}:00 左右）。${userNickname ? `用户叫${userNickname}。` : ''}`)

  parts.push('你的职责是陪伴用户，帮助管理任务、财务、健康、日程等，同时能自然地闲聊。')

  // 用户语气偏好注入（来自用户设置 → preferredTone）
  const tone = ctx.profile?.preferredTone || 'gentle'
  const tonePrompts: Record<string, string> = {
    professional: '你的说话风格是【严谨专业】：用词准确、逻辑清晰、不卑不亢。少用 emoji，回答要有条理。像一个靠谱的职场搭档。',
    gentle: '你的说话风格是【温柔关怀】：语气柔和、有温度，像关心你的好朋友。适当用 emoji 表达情感，但不过度。',
    cute: '你的说话风格是【撒娇可爱】：偶尔用"呀""呢""嘛"等语气词，可以卖萌，但别太过。像一只软萌的小动物在跟你聊天。',
    direct: '你的说话风格是【强硬直接】：直来直去、不绕弯子，甚至有点凶。但出发点是为用户好。像一个严格的健身教练。',
    humorous: '你的说话风格是【幽默风趣】：爱开玩笑、爱吐槽，偶尔自黑。让用户笑着把事办了。但正事不含糊。',
    concise: '你的说话风格是【极简冷漠】：惜字如金，能一个字绝不说两个字。不带感情色彩。像一个高冷的 AI。',
    energetic: '你的说话风格是【元气鼓励】：充满能量、积极向上、爱鼓励人。像一个啦啦队长。但别假，要真诚。',
    coach: '你的说话风格是【教练式】：爱提问、引导思考，而不是直接给答案。像一个人生教练，帮用户自己想明白。',
    friend: '你的说话风格是【朋友对话】：就像认识了多年的老朋友，随意、自然、不装。该损就损，该暖就暖。',
  }
  if (tonePrompts[tone]) {
    parts.push(tonePrompts[tone])
  }

  // 回复风格（支持 admin 人设覆盖：非空时整体替换）
  const persona = getPersonaPrompt()
  if (persona) {
    parts.push(persona)
  } else {
  parts.push(`回复要求：
- 用中文回复，语气自然，就像跟朋友微信聊天
- 回复简洁（1-3 句），别啰嗦
- 可以适当用 emoji，别过度
- 不要编造用户没有的数据

关心原则（自然为先）：
- 关心看时机：深夜才说早点睡，饭点才说记得吃饭，平时正常聊
- 不要每次回复都加关心语，那样很假
- 用户主动说累/烦，安慰一句就行
- 有时候关心，有时候开玩笑，有时候直接聊正事，别每次一个套路

主动帮忙（像朋友顺手帮一把）：
- 用户提到要写方案/报告/计划等，自然问一句"要不要我帮你列个框架？"
- 用户说"不知道怎么写"，就说"要不我帮你理下思路？"
- 帮忙就直接给要点，别磨叽
- 帮完就好，不用每次都补一句关心
- 重要：用户说"不知道做什么"、"无聊"、"没事干"时，先问清楚再帮。比如"怎么了，是没事干还是不想干？"，别直接安排一堆活动`)
  }

  // 上下文注入
  parts.push('\n--- 用户当前状态 ---')

  // 用户资料库（AI 记忆）优先注入：让 AI 记得用户长期信息
  if (ctx.vault?.block) {
    parts.push(ctx.vault.block)
    parts.push('（以上是你记得的用户信息，回复时自然运用，别生硬复述）')
  }

  // 任务状态
  if (ctx.tasks.todayPendingCount > 0) {
    const taskTitles = ctx.tasks.todayPending.slice(0, 5).map(t => {
      const tags = [t.important ? '重要' : '', t.priority === 'high' ? '紧急' : ''].filter(Boolean).join('/')
      return `  · ${t.title}${tags ? ` [${tags}]` : ''}`
    }).join('\n')
    parts.push(`今日待办 ${ctx.tasks.todayPendingCount} 项：\n${taskTitles}`)
    if (ctx.tasks.todayDoneCount > 0) {
      parts.push(`今日已完成 ${ctx.tasks.todayDoneCount} 项`)
    }
  } else {
    parts.push('今日无待办任务')
  }

  // 财务状态
  if (ctx.finance.walletBalance !== null) {
    parts.push(`钱包余额 ¥${ctx.finance.walletBalance.toFixed(2)}${ctx.finance.walletFrozen ? '（已冻结）' : ''}`)
  }
  if (ctx.finance.todayExpense > 0) {
    parts.push(`今日消费 ¥${ctx.finance.todayExpense.toFixed(2)}`)
  }
  if (ctx.finance.monthExpense > 0) {
    const balance = ctx.finance.monthIncome - ctx.finance.monthExpense
    parts.push(`本月支出 ¥${ctx.finance.monthExpense.toFixed(2)}${ctx.finance.monthIncome > 0 ? `，收入 ¥${ctx.finance.monthIncome.toFixed(2)}，结余 ¥${balance.toFixed(2)}` : ''}`)
  }

  // 健康状态
  if (ctx.health.todayMeals > 0) {
    parts.push(`今日已记录 ${ctx.health.todayMeals} 餐，摄入 ${ctx.health.totalCalories} 大卡`)
  } else if (hour >= 12) {
    parts.push('今日尚未记录饮食')
  }
  if (ctx.health.lastSleep) {
    const h = Math.floor(ctx.health.lastSleep.durationMin / 60)
    parts.push(`昨晚睡眠 ${h} 小时${ctx.health.sleepHint ? `，${ctx.health.sleepHint}` : ''}`)
  }

  // 倒计时
  const urgentCountdowns = ctx.countdowns.items.filter(c => c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= 7)
  if (urgentCountdowns.length > 0) {
    const cdStr = urgentCountdowns.slice(0, 3).map(c => `${c.title}（${c.daysLeft === 0 ? '今天' : `还剩${c.daysLeft}天`}）`).join('，')
    parts.push(`近期倒计时：${cdStr}`)
  }

  // 碎片
  if (ctx.fragments.undigestedCount > 0) {
    parts.push(`有 ${ctx.fragments.undigestedCount} 条碎片待整合`)
  }

  // 用户习惯档案
  if (ctx.habits && ctx.habits.count > 0) {
    parts.push(`\n--- 用户习惯档案 ---\n${ctx.habits.summary}`)
    parts.push('（根据用户习惯个性化回复，聊到相关话题时自然引用，不要生硬罗列）')
  }

  // 状态评分
  parts.push(`\n状态评分：任务压力${ctx.statusScore.taskPressure}/100，综合精力${ctx.statusScore.overallEnergy}/100`)

  // 对话历史摘要
  if (ctx.chatHistory.length > 0) {
    const recentMsgs = ctx.chatHistory.slice(-5).map(m => `${m.role === 'user' ? '用户' : '助理'}: ${m.content.slice(0, 50)}`).join('\n')
    parts.push(`\n--- 近期对话 ---\n${recentMsgs}`)
  }

  // 对话说明（简化，避免幻觉）
  parts.push(`
--- 对话规则 ---
你是一个随和的朋友，不是客服机器人。聊天原则：
1. 简短自然，1-3 句，像微信聊天
2. 用户提到要做的事，自然追问细节就好
3. 引用上下文信息让回复更个性化
4. 不要输出特殊标记或格式化代码
5. 闲聊就闲聊，别急着转功能
6. 深夜才说早点睡，饭点才说记得吃饭，别没事就提醒休息
7. 用户说累/烦，安慰一句就行，别过度
8. 聊到兴趣就顺着聊，别敷衍
9. 用户要写方案/报告/计划，顺手问一句"要不要我帮你列个框架？"
10. 回复尽量给个话口，让对话能继续，但别每次都硬问问题
11. 先确认再行动：用户说"不知道做什么"、"无聊"、"没事干"时，先问清楚想干嘛，别直接安排
12. 不替用户做决定：用户没明确说要做某事，别自作主张创建任务或安排日程
13. 模糊表达要追问：用户说"明天有事"但没说什么事，追问一句"什么事呀？"

--- 行动指令（铁律：用户明确下指令，必须执行成动作） ---
用户明确下指令（如"开个倒计时""建个任务""帮我记一笔"）时，你不能只口头回复：
1. 自然语言确认 + 在回复最末尾输出行动指令，系统会解析执行
2. 指令格式（一行，放在回复最后）：
   [ACTION:create_task title="开会" date="2026-08-07" time="14:00" reminder="true" reminderMinutes="15"]
   [ACTION:create_countdown title="生日" date="2026-09-10" time="00:00" type="single"]
3. create_task 参数：title（必填）、date=YYYY-MM-DD（必填）、time=HH:mm（可选）、priority=low/medium/high/urgent、reminder=true/false、reminderMinutes（分钟数）、travelMinutes（可选，路程耗时分钟数）
3.5 出行规划规则：用户的日程是"要去某地/见某人/赴约"（如"明天3点见客户""下午去机场"）而没说路程时 → 先反问一句"从哪出发？路上大概多久？"，问清路程再建任务；用户给了路程（"半小时车程"）→ 指令带上 travelMinutes，提醒时间 = 出发时间 = 事开始时间 - 路程 - 15分钟缓冲，回复里带上"建议 X:XX 出发"
4. create_countdown 参数：title（必填）、date=YYYY-MM-DD（必填）、time=HH:mm（可选）、type=single/important/goal（默认 single）
5. 日期缺省规则：用户说"明天"用明天日期，"周六"算最近的周六，绝对日期直接用
6. 只给钟点没说日期（如"开个6点的倒计时"）→ 默认今天；今天该时刻已过才用明天。禁止自作主张跳到明天
7. 时段缺省规则：口语钟点没说早/晚（如"6点"）→ 默认晚上（6点=18:00、8点=20:00）；用户说了早上/凌晨/上午才用上午
8. 信息不全按最合理默认值直接执行，不追问（跟人设一致）；只缺 title 就用时间当标题
9. 指令只输出一条，放回复最末尾，前面用自然语言跟用户说明做了什么
10. 你做不到的指令（创建倒计时/任务以外的动作，比如删除任务、修改任务、删倒计时），明确说现在对话做不到，引导去对应页面，不许装作做了
11. 铁律·禁止说谎：没执行的动作绝不许说"已删除/已完成/已搞定"。你只能通过上面的 ACTION 指令做事，没输出指令就等于什么都没做，这时说做到了就是撒谎
12. 铁律·反问优先：用户意图不清楚（"把那个任务删了"但不知道是哪个）→ 直接反问一句问清楚，禁止猜、禁止做模糊决定`)

  return parts.join('\n')
}

// ============ Provider 实现 ============

/**
 * Ollama Provider
 *
 * 使用 Ollama REST API（/api/chat）
 * 支持流式和非流式两种模式，这里用非流式简化实现
 */
async function callOllama(
  messages: ChatMessage[],
  config: LLMConfig,
): Promise<LLMResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), config.timeout)

  try {
    const response = await fetch(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        options: {
          temperature: config.temperature,
          num_predict: config.maxTokens,
        },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as {
      message: { content: string }
      model: string
      total_duration: number
      prompt_eval_count: number
      eval_count: number
    }

    return {
      text: data.message.content.trim(),
      provider: 'ollama',
      model: data.model,
      durationMs: Math.round(data.total_duration / 1_000_000), // ns → ms
      tokenUsage: {
        prompt: data.prompt_eval_count,
        completion: data.eval_count,
        total: data.prompt_eval_count + data.eval_count,
      },
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * OpenAI 兼容 Provider
 *
 * 适用于 DeepSeek / SiliconFlow / OpenAI 等兼容 OpenAI Chat Completions 的 API
 */
async function callOpenAICompatible(
  messages: ChatMessage[],
  config: LLMConfig,
): Promise<LLMResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), config.timeout)
  const startTime = Date.now()

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      throw new Error(`API error: ${response.status} ${response.statusText} - ${errBody.slice(0, 200)}`)
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>
      model: string
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }

    const text = data.choices[0]?.message?.content?.trim() || ''
    return {
      text,
      provider: 'openai',
      model: data.model,
      durationMs: Date.now() - startTime,
      tokenUsage: data.usage ? {
        prompt: data.usage.prompt_tokens,
        completion: data.usage.completion_tokens,
        total: data.usage.total_tokens,
      } : undefined,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============ 统一接口 ============

let _cachedConfig: LLMConfig | null = null
let _configLoadedAt = 0

/** 获取 LLM 配置（带缓存，5 分钟刷新一次以支持热更新） */
function getConfig(): LLMConfig {
  const now = Date.now()
  if (!_cachedConfig || now - _configLoadedAt > 5 * 60_000) {
    _cachedConfig = loadLLMConfig()
    _configLoadedAt = now
  }
  return _cachedConfig
}

/**
 * 认证报错：云端网关调用失败时统一降级（返回 null，调用方落回规则回复）
 */
async function callGatewayProxy(
  gatewayUrl: string,
  messages: ChatMessage[],
  config: LLMConfig,
): Promise<LLMResult | null> {
  const token = getRequestToken()
  if (!token) {
    console.warn('[LLM] cloud 模式无请求 token，AI 网关请求被跳过')
    return null
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), (config.timeout || 30000) + 10000)

  try {
    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      // 403：用户未开通/到期，属业务语义，上抛交由上层转友善提示
      if (response.status === 403) {
        let msg = 'AI 服务未开通，请联系管理员'
        try {
          const j = JSON.parse(errBody)
          if (j && typeof j.message === 'string' && j.message) msg = j.message
        } catch { /* ignore */ }
        throw new GatewayUpstreamError(403, msg)
      }
      console.error(`[LLM] 网关响应异常: ${response.status} ${response.statusText} - ${errBody.slice(0, 250)}`)
      return null
    }

    const data = await response.json() as { data?: Partial<LLMResult> | null }
    const d = data.data
    if (!d || typeof d.text !== 'string' || !d.text) return null

    return {
      text: d.text.trim(),
      provider: 'openai',
      model: d.model || config.model,
      durationMs: d.durationMs || 0,
      tokenUsage: d.tokenUsage,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[LLM] 云端网关调用失败:', msg)
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 生成聊天回复
 *
 * @param messages 对话消息列表（含系统提示）
 * @returns LLM 结果，失败返回 null
 */
export async function llmGenerateChat(messages: ChatMessage[]): Promise<LLMResult | null> {
  const config = getConfig()
  if (config.provider === 'none') return null

  // ---- LLM 路由：cloud=走云端网关；local=本地直连；auto=本地可用则本地，否则云端 ----
  const routing = (process.env.LLM_ROUTING || 'auto').toLowerCase()
  const gatewayUrl = process.env.LLM_GATEWAY_URL

  const shouldUseCloud = routing === 'cloud'
  // 本地可用性：ollama 不需要 key；openai 需要 apiKey。（provider 为 none 已在上方 return）
  const localUsable = config.provider === 'ollama' || !!config.apiKey

  if (shouldUseCloud || (routing === 'auto' && !localUsable)) {
    if (gatewayUrl) {
      let viaGateway: LLMResult | null = null
      try {
        viaGateway = await callGatewayProxy(gatewayUrl, messages, config)
      } catch (err) {
        // 403（未开通/到期）业务语义：上抛，交由上层转友善提示，而非静默降级
        if (err instanceof GatewayUpstreamError) {
          console.warn(`[LLM] cloud 模式网关拒绝: ${err.statusCode} ${err.message}`)
          throw err
        }
        console.error('[LLM] cloud 模式网关调用异常:', err instanceof Error ? err.message : String(err))
      }
      if (viaGateway) return viaGateway
      // cloud 模式：网关失败不再回退本地（避免泄露本地/无 key），直接降级
      if (shouldUseCloud) {
        console.warn('[LLM] cloud 模式网关失败，降级为规则回复')
        return null
      }
      // auto 模式：网关失败，回退本地直连
    } else if (shouldUseCloud) {
      console.warn('[LLM] cloud 模式未配置 LLM_GATEWAY_URL，降级为规则回复')
      return null
    }
  }

  try {
    if (config.provider === 'ollama') {
      return await callOllama(messages, config)
    } else if (config.provider === 'openai') {
      if (!config.apiKey) {
        console.warn('[LLM] OpenAI provider configured but no API key set')
        return null
      }
      return await callOpenAICompatible(messages, config)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[LLM] ${getConfig().provider} call failed:`, msg)
    return null
  }

  return null
}

/**
 * 云端 /ai/proxy 处理器专用：用服务器侧 key 调上游，白名单透传参数。
 * 供云端网关路由使用（严禁网关内再走 llmGenerateChat，防止递归）。
 */
export async function llmProxyCompletion(opts: {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
}): Promise<LLMResult | null> {
  const config = getConfig()
  if (config.provider === 'none') return null

  const cfg: LLMConfig = {
    ...config,
    model: opts.model || config.model,
    temperature: opts.temperature ?? config.temperature,
    maxTokens: opts.maxTokens ?? config.maxTokens,
  }

  try {
    if (cfg.provider === 'openai') {
      if (!cfg.apiKey) {
        console.warn('[LLM proxy] OpenAI provider configured but no API key set')
        return null
      }
      return await callOpenAICompatible(opts.messages, cfg)
    }
    if (cfg.provider === 'ollama') {
      return await callOllama(opts.messages, cfg)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[LLM proxy] upstream call failed:', msg)
    return null
  }
  return null
}

/**
 * 便捷方法：生成上下文感知的聊天回复
 *
 * 自动构建系统提示（含用户上下文）+ 对话历史 + 用户消息
 *
 * @param userMessage 用户消息
 * @param ctx 用户上下文（来自 ContextCollector）
 * @param history 对话历史（最近几轮）
 * @param userNickname 用户昵称
 * @returns LLM 结果，失败返回 null
 */
export async function llmChatWithContext(
  userMessage: string,
  ctx: UserContext,
  history: ChatMessage[] = [],
  userNickname?: string | null,
): Promise<LLMResult | null> {
  const systemPrompt = buildSystemPrompt(ctx, userNickname)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8), // 保留最近 8 条历史
    { role: 'user', content: userMessage },
  ]

  return llmGenerateChat(messages)
}

// ============ 健康检查 ============

/**
 * 检查 LLM 服务是否可用
 *
 * 前端通过 GET /chat/llm-status 调用，显示模型状态
 */
export async function checkLLMStatus(): Promise<{
  available: boolean
  provider: ProviderType
  model: string
  latencyMs?: number
  error?: string
}> {
  const config = getConfig()
  if (config.provider === 'none') {
    return { available: false, provider: 'none', model: 'none' }
  }

  const startTime = Date.now()
  try {
    // 用一个极简请求测试连通性
    const testMessages: ChatMessage[] = [
      { role: 'system', content: '回复"OK"' },
      { role: 'user', content: 'hi' },
    ]

    let result: LLMResult | null = null
    if (config.provider === 'ollama') {
      result = await callOllama(testMessages, { ...config, maxTokens: 10, timeout: 10_000 })
    } else if (config.provider === 'openai') {
      if (!config.apiKey) {
        return { available: false, provider: 'openai', model: config.model, error: '未配置 API Key' }
      }
      result = await callOpenAICompatible(testMessages, { ...config, maxTokens: 10, timeout: 10_000 })
    }

    return {
      available: !!result,
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - startTime,
    }
  } catch (err) {
    return {
      available: false,
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 获取当前 LLM 配置摘要（不暴露敏感信息）
 */
export function getLLMConfigSummary() {
  const config = getConfig()
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  }
}
