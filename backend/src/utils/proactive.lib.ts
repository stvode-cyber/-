/**
 * AI 主动聊天调度器
 *
 * 设计要点：
 * 1. 每日早晨 08:00 左右为每位启用 proactiveChatEnabled 的用户推送一条主动问候
 * 2. 问候内容包含：早安问候 + 今日待办数 + 询问是否有要提醒的事
 * 3. 同一用户当日只推送一次（查当天 isProactive=true 的消息去重）
 * 4. 调度器每 5 分钟扫描一次，检查是否到达推送窗口且当日尚未推送
 * 5. 复用 ChatSession + Message 表，写入 isProactive=true 的 assistant 消息
 * 6. 沿用 countdown.lib.ts 的 setInterval + unref() 模式，不引入 node-cron
 *
 * 与 generateReply 的关系：
 * - 主动消息不走 generateReply（无用户输入）
 * - 用户回复主动消息时，会走 chat.routes 的常规路径，触发 generateReply
 * - generateReply 中已支持"用户描述待办 → 自动创建任务"逻辑（见 ai-reply.ts）
 *
 * 审计：写入 audit(category='chat', action='proactive_send')
 */
import { prisma } from '../lib/prisma.js'
import { audit } from './audit.js'
import { bucketOf } from '../services/agentConfig.js'
import { llmGenerateChat } from '../services/llmService.js'
import { getVaultNotesForProactive, formatVaultBlock } from '../services/vaultService.js'

// ============ 配置 ============
/** 推送时间窗口：[8, 10) 点之间 */
const PUSH_HOUR_START = 8
const PUSH_HOUR_END = 10
/** 调度器扫描间隔：5 分钟 */
const SCAN_INTERVAL_MS = 5 * 60 * 1000
/** 单次扫描最大用户数（避免大用户量下耗时过长） */
const MAX_USERS_PER_SCAN = 500

interface ProactiveUser {
  id: string
  username: string
  nickname: string | null
  preferredTone: string | null
}

export interface TodayTask {
  id: string
  title: string
  important: boolean
  dueDate: Date | null
}

interface TriggerResult {
  pushed: boolean
  reason?: string
  messageId?: string
}

// ============ 调度器 ============
let schedulerHandle: NodeJS.Timeout | null = null

/**
 * 启动主动聊天调度器
 *
 * 每 5 分钟扫描一次：
 * - 当前时间在 08:00-10:00 窗口内
 * - 用户开启了 proactiveChatEnabled
 * - 当天还没有 isProactive=true 的消息
 *
 * 命中后向用户的 AI 会话写入一条主动问候消息
 */
export function startProactiveScheduler(intervalMs: number = SCAN_INTERVAL_MS): void {
  if (schedulerHandle) return // 防止重复启动
  // 启动时不立即跑（避免重启时集中推送，等到下一个扫描周期）
  schedulerHandle = setInterval(() => {
    // ① 早晨窗口主动问候（8-10 点）
    runProactiveScan().catch((err) => {
      console.error('[ProactiveScheduler] 扫描失败:', err)
    })
    // ② 宠物状态主动冒泡（独立于时间窗口，任何时段 pet 状态差且空闲超时都触发）
    scanPetIdle().catch((err) => {
      console.error('[ProactiveScheduler] PetIdle 扫描失败:', err)
    })
  }, intervalMs)
  schedulerHandle.unref?.() // 不阻塞进程退出
  console.log(`[ProactiveScheduler] 已启动，间隔 ${Math.floor(intervalMs / 1000)}s`)
}

export function stopProactiveScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle)
    schedulerHandle = null
  }
}

// ============ 核心扫描逻辑 ============
/**
 * 单次扫描：找出符合条件的用户并推送主动消息
 *
 * 可手动调用（用于测试）：await runProactiveScan()
 */
export async function runProactiveScan(now: Date = new Date()): Promise<void> {
  // 1. 检查时间窗口
  const hour = now.getHours()
  if (hour < PUSH_HOUR_START || hour >= PUSH_HOUR_END) {
    return // 不在推送窗口内
  }
  // 2. 查询开启了主动聊天的用户
  const users = await prisma.user.findMany({
    where: { proactiveChatEnabled: true },
    select: { id: true, username: true, nickname: true, preferredTone: true },
    take: MAX_USERS_PER_SCAN,
  })
  if (users.length === 0) {
    return
  }
  // 3. 今日 0 点 / 明日 0 点（用于去重查询）
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setDate(todayEnd.getDate() + 1)
  // 4. 逐个用户处理（避免一个失败影响其他用户）
  let pushedCount = 0
  for (const user of users) {
    try {
      const ok = await pushIfDue(user.id, user.nickname || user.username, user.preferredTone || 'gentle', now, todayStart, todayEnd)
      if (ok) pushedCount++
    } catch (err) {
      console.error(`[ProactiveScheduler] 用户 ${user.id} 推送失败:`, err)
    }
  }
  if (pushedCount > 0) {
    console.log(`[ProactiveScheduler] 本次推送 ${pushedCount} 条主动消息`)
  }
}

/**
 * 检查单个用户今日是否需要推送，需要则写入主动消息
 *
 * @returns true=已推送 false=跳过（已推送过 / 无 AI 会话）
 */
async function pushIfDue(
  userId: string,
  displayName: string,
  tone: string,
  now: Date,
  todayStart: Date,
  todayEnd: Date,
): Promise<boolean> {
  // 1. 去重：查当天是否已有 isProactive=true 的消息
  const existing = await prisma.message.findFirst({
    where: {
      userId,
      isProactive: true,
      createdAt: { gte: todayStart, lt: todayEnd },
    },
    select: { id: true },
  })
  if (existing) return false
  // 2. 获取或创建 AI 会话（用户与 AI 助理的固定会话）
  const session = await ensureAiSession(userId)
  if (!session) return false
  // 3. 拉取用户今日数据（用于个性化问候）
  const todayTasks = await prisma.task.findMany({
    where: {
      userId,
      status: { not: 'done' },
      OR: [
        { dueDate: { gte: todayStart, lt: todayEnd } },
        { dueDate: null, important: true },
      ],
    },
    select: { id: true, title: true, important: true, dueDate: true },
    orderBy: [{ important: 'desc' }, { dueDate: 'asc' }],
    take: 5,
  })
  // 4. 生成问候内容（记忆库增强：检索用户资料 → LLM 个性化生成，失败回退模板）
  const content = await buildPersonalizedGreeting(userId, displayName, tone, now, todayTasks)
  // 5. 写入主动消息
  const msg = await prisma.message.create({
    data: {
      sessionId: session.id,
      userId,
      role: 'assistant',
      content,
      messageType: 'text',
      isProactive: true,
    },
  })
  // 6. 更新会话最后活跃时间（影响会话列表排序）
  await prisma.chatSession.update({
    where: { id: session.id },
    data: { updatedAt: now, title: 'AI 助理' },
  })
  // 7. 审计（fire-and-forget）
  audit({
    userId,
    category: 'chat',
    action: 'proactive_send',
    targetType: 'Message',
    targetId: msg.id,
    summary: `主动问候推送: ${content.slice(0, 30)}...`,
    detail: { scene: 'morning', taskCount: todayTasks.length },
  })
  return true
}

/**
 * 获取或创建用户与 AI 助理的固定会话
 *
 * 约定：AI 助理会话的 title 固定为 "AI 助理"
 * - 若已存在则复用最新一个
 * - 不存在则创建
 */
async function ensureAiSession(userId: string) {
  // 查找最新的 AI 助理会话
  const existing = await prisma.chatSession.findFirst({
    where: { userId, title: 'AI 助理' },
    orderBy: { updatedAt: 'desc' },
  })
  if (existing) return existing
  // 创建新会话
  return prisma.chatSession.create({
    data: {
      userId,
      title: 'AI 助理',
    },
  })
}

// ============ 问候内容生成 ============

/**
 * 个性化问候（记忆库增强版）—— MorningGreeting / ProactiveScheduler 共用
 *
 * 流程：检索用户资料库（Vault 记忆：置顶 + 最近优先）→ 交给 LLM 生成老朋友式问候，
 * 让主动聊天能自然引用"上次你说想看《奥本海默》"这类真实记忆。
 * 任何失败（无记忆 / LLM 不可用 / 输出异常）→ 回退 buildMorningGreeting 模板，绝不裸奔。
 *
 * @param extraContext 附加上下文（如睡眠/情绪摘要），非空则一并给 LLM 参考
 */
export async function buildPersonalizedGreeting(
  userId: string,
  displayName: string,
  tone: string,
  now: Date,
  todayTasks: TodayTask[],
  extraContext?: string,
): Promise<string> {
  try {
    const notes = await getVaultNotesForProactive(userId, 8)
    const taskSummary =
      todayTasks.length === 0
        ? '今天没有待办'
        : `今天有 ${todayTasks.length} 件待办：${todayTasks.slice(0, 3).map((t) => `「${t.title}」`).join('、')}${todayTasks.length > 3 ? ' 等' : ''}`
    const period = now.getHours() < 10 ? '上午' : now.getHours() < 14 ? '中午' : now.getHours() < 18 ? '下午' : '晚上'
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const vaultBlock = formatVaultBlock(notes)

    // 人设铁律：优先跟随应用配置（main.cjs 已注入 AGENT_PERSONA_PROMPT）
    const personaLine = process.env.AGENT_PERSONA_PROMPT
      ? `这是你的人设铁律，必须遵守：\n${process.env.AGENT_PERSONA_PROMPT}`
      : '你称呼用户"你"，禁用：您、用户、欢迎回来、检测到、建议您、还有什么可以帮你的。'

    const systemPrompt = [
      '你是用户的老朋友、隐形管家，写消息像老朋友发微信，不像客服机器人。',
      '要求：',
      '1. 语气自然口语化，2-4 句，别啰嗦别说教；',
      vaultBlock
        ? '2. 可以自然引用资料库里确实存在的 1 条信息引出话题或关心（比如他提过的电影、爱好、身边的人或事）；绝不编造资料里没有的内容；'
        : '2. 你目前没有任何关于该用户的过往资料，绝对禁止编造他提过的事、看过的电影、去过的地点、喜好或人际关系；只问候日常与待办；',
      '3. 有今日待办就自然带一句提醒，没有就略过；',
      '4. 直接输出消息内容本身，不要加引号、前缀、"早安"+冒号这类格式，也不要解释。',
      personaLine,
    ].join('\n')

    const userMsg = [
      `现在是 ${dateStr} ${period}。`,
      `今日待办：${taskSummary}。`,
      vaultBlock ? `\n这是你记得的关于用户（${displayName}）的资料库内容：\n${vaultBlock}` : '',
      extraContext ? `\n其他补充信息：\n${extraContext}` : '',
      '\n请按上面的人设与要求，给这位用户发一条今天的日常问候（主动关心，可以自然提到记忆里的内容）。',
    ].join('\n')

    const result = await llmGenerateChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ])
    const text = result?.text?.trim() ?? ''
    if (text.length > 1 && text.length <= 200) return text
    console.warn('[ProactiveScheduler] LLM 问候输出异常，回退模板:', JSON.stringify(text).slice(0, 80))
  } catch (err) {
    console.error('[ProactiveScheduler] LLM 问候生成失败，回退模板:', err instanceof Error ? err.message : err)
  }
  return buildMorningGreeting(displayName, tone, now, todayTasks)
}

/**
 * 生成早晨问候内容
 *
 * 内容结构：
 * 1. 早安问候（按时段调整：5-10点"早安"/10-12点"上午好"）
 * 2. 今日待办提示（若有则列出，若无则不提）
 * 3. 询问今日要事 + 引导用户回复任务
 *
 * 语气：根据 preferredTone 调整（gentle/friendly/professional）
 */
function buildMorningGreeting(displayName: string, tone: string, now: Date, todayTasks: TodayTask[]): string {
  const hour = now.getHours()
  const greeting = hour < 10 ? '早安' : '上午好'
  // 语气变体
  const tonePrefix = tone === 'professional' ? '' : tone === 'friendly' ? '嘿~ ' : ''
  // 待办部分
  let taskPart = ''
  if (todayTasks.length > 0) {
    const importantTasks = todayTasks.filter((t) => t.important)
    if (importantTasks.length > 0) {
      taskPart = `\n\n📋 今天有 ${todayTasks.length} 件待办，其中 ${importantTasks.length} 件重要的：\n${importantTasks
        .slice(0, 3)
        .map((t, i) => `${i + 1}. ${t.title}`)
        .join('\n')}`
    } else {
      taskPart = `\n\n📋 今天有 ${todayTasks.length} 件待办，比如「${todayTasks[0].title}」。`
    }
  }
  // 询问部分
  const askPart = '\n\n有什么重要的事需要我提醒你吗？直接告诉我，我帮你加进待办~ ✨'
  return `${tonePrefix}${greeting}，${displayName}！${taskPart}${askPart}`
}

// ============ 手动触发（用于测试） ============
/**
 * 手动为指定用户推送一次主动消息（用于测试）
 *
 * @param userId 目标用户 ID
 * @param force 是否强制推送（忽略时间窗口和去重检查）
 * @returns 推送结果
 */
export async function triggerProactiveForUser(userId: string, force: boolean = false): Promise<TriggerResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, nickname: true, preferredTone: true, proactiveChatEnabled: true },
  })
  if (!user) return { pushed: false, reason: '用户不存在' }
  if (!force && !user.proactiveChatEnabled) return { pushed: false, reason: '用户已关闭主动聊天' }
  const now = new Date()
  if (!force) {
    // 检查时间窗口
    const hour = now.getHours()
    if (hour < PUSH_HOUR_START || hour >= PUSH_HOUR_END) {
      return { pushed: false, reason: `当前 ${hour} 点不在推送窗口 ${PUSH_HOUR_START}-${PUSH_HOUR_END} 点` }
    }
    // 检查去重
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(todayStart)
    todayEnd.setDate(todayEnd.getDate() + 1)
    const existing = await prisma.message.findFirst({
      where: { userId, isProactive: true, createdAt: { gte: todayStart, lt: todayEnd } },
    })
    if (existing) return { pushed: false, reason: '今日已推送过' }
  }
  // 获取或创建 AI 会话
  const session = await ensureAiSession(userId)
  if (!session) return { pushed: false, reason: '无法创建 AI 会话' }
  // 拉取今日数据
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setDate(todayEnd.getDate() + 1)
  const todayTasks = await prisma.task.findMany({
    where: {
      userId,
      status: { not: 'done' },
      OR: [
        { dueDate: { gte: todayStart, lt: todayEnd } },
        { dueDate: null, important: true },
      ],
    },
    select: { id: true, title: true, important: true, dueDate: true },
    orderBy: [{ important: 'desc' }, { dueDate: 'asc' }],
    take: 5,
  })
  const content = await buildPersonalizedGreeting(user.id, user.nickname || user.username, user.preferredTone || 'gentle', now, todayTasks)
  const msg = await prisma.message.create({
    data: {
      sessionId: session.id,
      userId: user.id,
      role: 'assistant',
      content,
      messageType: 'text',
      isProactive: true,
    },
  })
  await prisma.chatSession.update({
    where: { id: session.id },
    data: { updatedAt: now, title: 'AI 助理' },
  })
  audit({
    userId,
    category: 'chat',
    action: 'proactive_send',
    targetType: 'Message',
    targetId: msg.id,
    summary: `主动问候推送（手动）: ${content.slice(0, 30)}...`,
    detail: { scene: 'morning', taskCount: todayTasks.length, triggeredBy: 'manual' },
  })
  return { pushed: true, reason: '推送成功', messageId: msg.id }
}

// ============================================================
// 宠物状态主动冒泡（Exp-B：宠物 idle 超时 -> 主动冒泡）
// ============================================================
const PET_DECAY = { hunger: 0.2, mood: 0.15, clean: 0.2, energy: 0.1 }
const PET_IDLE_MIN_MS = 30 * 60 * 1000
const PET_TRIGGER = { hungry: 25, sad: 30, sleepy: 20 }
const PET_PROACTIVE_COOLDOWN_MS = 24 * 3600 * 1000

function clamp01(n: number) { return Math.max(0, Math.min(100, n)) }

function computePetDecayed(pet: any) {
  const minutes = Math.max(0, (Date.now() - pet.lastUpdated.getTime()) / 60000)
  return {
    hunger: clamp01(pet.hunger - PET_DECAY.hunger * minutes),
    mood: clamp01(pet.mood - PET_DECAY.mood * minutes),
    clean: clamp01(pet.clean - PET_DECAY.clean * minutes),
    energy: clamp01(pet.energy - PET_DECAY.energy * minutes),
  }
}

function petNeedsBubble(decayed: any) {
  if (decayed.hunger < PET_TRIGGER.hungry) return 'hungry'
  if (decayed.mood < PET_TRIGGER.sad) return 'sad'
  if (decayed.energy < PET_TRIGGER.sleepy) return 'sleepy'
  return null
}

export async function scanPetIdle() {
  const now = new Date()
  const activeSince = new Date(now.getTime() - PET_IDLE_MIN_MS)
  const cooldownSince = new Date(now.getTime() - PET_PROACTIVE_COOLDOWN_MS)

  const users = await prisma.user.findMany({
    where: { proactiveChatEnabled: true, activePetId: { not: null } },
    select: {
      id: true, username: true, nickname: true,
      activePetId: true,
      pets: { select: { id: true, name: true, hunger: true, mood: true, clean: true, energy: true, lastUpdated: true } },
    },
    take: MAX_USERS_PER_SCAN,
  })

  let petPushed = 0
  for (const u of users) {
    const pet = u.pets?.[0]
    if (!pet) continue
    if (pet.lastUpdated.getTime() > activeSince.getTime()) continue
    const decayed = computePetDecayed(pet)
    const reason = petNeedsBubble(decayed)
    if (!reason) continue
    const recentPetMsg = await prisma.message.findFirst({
      where: {
        userId: u.id,
        createdAt: { gte: cooldownSince },
        metadata: { contains: 'petTrigger' },
      },
      select: { id: true },
    })
    if (recentPetMsg) continue
    try {
      const ok = await pushPetProactive(u.id, u.nickname || u.username, pet.name, decayed, reason)
      if (ok) petPushed++
    } catch (err) {
      console.error('[ProactiveScheduler] PetIdle 推送失败:', err)
    }
  }
  if (petPushed > 0) console.log('[ProactiveScheduler] PetIdle push:', petPushed)
}

async function pushPetProactive(userId: string, displayName: string, petName: string, decayed: any, reason: string) {
  const bucket = bucketOf(userId)
  const name = petName || '它'

  let content = ''
  if (reason === 'hungry') {
    const a = [name + '好像饿了喵～给点吃的呗～', name + '肚子咕咕叫了，要不喂点？']
    const b = [name + '饿了。', '喂下' + name + '。']
    content = bucket === 'B' ? b[Math.floor(Math.random()*b.length)] : a[Math.floor(Math.random()*a.length)]
  } else if (reason === 'sad') {
    const a = [name + '好像没精神，陪它玩会儿？', name + '情绪不高……摸一摸？']
    const b = [name + '没精神。', '陪下' + name + '。']
    content = bucket === 'B' ? b[Math.floor(Math.random()*b.length)] : a[Math.floor(Math.random()*a.length)]
  } else {
    const a = [name + '困了，让它睡会儿～', name + '眼皮打架了，该睡觉了']
    const b = [name + '困了。', '让它睡。']
    content = bucket === 'B' ? b[Math.floor(Math.random()*b.length)] : a[Math.floor(Math.random()*a.length)]
  }

  const session = await ensureAiSession(userId)
  if (!session) return false

  const now = new Date()
  const msg = await prisma.message.create({
    data: {
      sessionId: session.id,
      userId,
      role: 'assistant',
      content,
      messageType: 'text',
      isProactive: true,
      metadata: JSON.stringify({
        petTrigger: true, petName, petReason: reason, petBucket: bucket,
        petHunger: Math.round(decayed.hunger), petMood: Math.round(decayed.mood), petEnergy: Math.round(decayed.energy),
      }),
    },
  })
  await prisma.chatSession.update({
    where: { id: session.id },
    data: { updatedAt: now, title: 'AI 助理' },
  })
  audit({
    userId, category: 'chat', action: 'pet_proactive_send',
    targetType: 'Message', targetId: msg.id,
    summary: 'Pet bubble: ' + content.slice(0, 30),
    detail: { petName, reason, bucket, decayed: { hunger: Math.round(decayed.hunger), mood: Math.round(decayed.mood), energy: Math.round(decayed.energy) } },
  })
  return true
}

export async function triggerPetProactiveForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { pets: true },
  })
  if (!user) return { pushed: false, reason: 'user not found' }
  const pet = user.pets?.[0]
  if (!pet) return { pushed: false, reason: 'no pet' }
  const decayed = computePetDecayed(pet)
  const reason = petNeedsBubble(decayed) || 'idle'
  const ok = await pushPetProactive(user.id, user.nickname || user.username, pet.name, decayed, reason)
  return ok ? { pushed: true, reason, messageId: 'live' } : { pushed: false, reason: 'write failed' }
}

