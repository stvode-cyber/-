import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { Send, Plus, Check, ArrowRight, Sparkles, Mic, Square, Loader2, List, Image as ImageIcon, Paperclip, MapPin, X, ChevronLeft, Smile, FileText, Download, Eye, Fingerprint, Settings } from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { formatTime, priorityMeta, toneMeta } from '../lib/utils'
import { BILL_QUICK_CATEGORIES, fragmentKindMeta } from '../lib/constants'
import { isDesktop } from '../hooks/useIsDesktop'

/**
 * 单条消息（与后端 ChatMessage 模型对应）
 * - messageType: text / task_card / bill_card / diet_card
 * - metadata: JSON 字符串，根据 messageType 解析为不同结构
 */
interface Message {
  id: string
  role: string
  content: string
  messageType: string
  metadata?: string | null
  /** DG-02 多模态附件（图片/文件的 base64 data URL；位置消息为 null） */
  mediaUrl?: string | null
  feedback?: string | null
  createdAt: string
}

/** 任务卡片中的单项任务 */
interface TaskItem {
  id: string
  title: string
  priority: string
  progress: number
  dueDate?: string | null
  important?: boolean
  status?: string
}

/** 会话列表项（与后端 /chat/sessions 返回对应） */
interface ChatSessionItem {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  _count?: { messages: number }
}

/**
 * 消息 metadata 结构：根据 messageType 不同，承载不同的卡片数据
 * - task_card:     { tasks: TaskItem[] }
 * - bill_card:     { amount, type, confirmed, confirmedCategory }
 * - diet_card:     { mealType }
 * - handover_card: { completedItems, pendingItems, billsSummary, dietsSummary }
 *
 * 注：字段全部可选，运行时按 messageType 判断有效字段。
 */
interface MessageMetadata {
  tasks?: TaskItem[]
  amount?: number
  type?: string
  confirmed?: boolean
  confirmedCategory?: string
  mealType?: string
  completedItems?: string[]
  pendingItems?: HandoverPendingItem[]
  billsSummary?: { expense: number; income: number; count: number }
  dietsSummary?: { meals: number; totalCalories: number }
  /** AI 记账卡：从消息提取的标题，用于自动分类 + 入账标题 */
  title?: string
  /** AI 记账卡：自动推断的分类，前端高亮显示 */
  autoCategory?: string
  /** DG-06 实时规划：时段块数组 */
  schedule?: ScheduleData
  /** DG-07 碎片信息：今日碎片列表（fragment_card 用） */
  fragments?: FragmentItem[]
  /** DG-08 隔夜整合：今日碎片结构化总结（digest_card 用） */
  digest?: DigestData
  /** DG-09 跨信息关联：碎片间关联发现（connections_card 用） */
  connections?: ConnectionsData
  /** DG-09 跨模块洞察：碎片↔任务/账单未闭环信号（insights_card 用） */
  insights?: InsightsData
  /** EV-04 智能准备：重要事件准备清单（preparation_card 用） */
  preparation?: PreparationData
  /** DG-16 危机干预信息（crisis_card 用） */
  crisis?: CrisisData
  /** P1 周报结构化数据（@回顾 文本气泡 + 跳转完整周报页） */
  weeklyReport?: {
    range: { start: string; end: string; label: string }
    finance: { income: number; expense: number; balance: number }
    stats: { doneTasks: number; dietCount: number; msgCount: number; streak: number }
  }
  /** P3 画像结构化数据（@画像 文本气泡 + 跳转画像面板页） */
  portrait?: {
    month: string
    finance: { expense: number; topCategories: { name: string; total: number }[] }
    tasks: { total: number; done: number; doneRate: number }
    relation: { streak: number; msgCount: number }
  }
  /** P2 办公小助手：读摘要 / 新版本（预览+下载）/ 导出结果 */
  office?: {
    type: 'read' | 'write' | 'export'
    fileName?: string
    docId?: string
    title?: string
    format?: string
    downloadUrl?: string
    basedOn?: string | null
    charCount?: number
    summary?: string
    error?: string
  }
  /** v4: 对话式任务创建结果（task_created_card 用） */
  actionResult?: {
    task: {
      id: string
      title: string
      priority: string
      category: string
      dueDate: string | null
    }
    reminder: {
      id: string
      remindAt: string
      reminderMinutes: number
    } | null
  }
  /** v4: 对话式任务创建选项卡（task_options_card 用） */
  pendingTaskCreation?: {
    title: string
    date: string | null
    wantReminder: boolean
    period: string | null
  }
  options?: TaskOptionsData
}

/** v4: 任务创建选项卡数据 */
interface TaskOptionsData {
  title: string
  dateLabel: string
  dateStr: string | null
  period: string | null
  timeSlots: Array<{ label: string; value: string }>
  /** 预选时间（当用户已提供时间时，自动选中对应时间槽） */
  preSelectedTime?: string
  /** 预选提醒（当用户已说"提醒我"时，默认选中15分钟） */
  preSelectedReminder?: string
  reminderOptions: Array<{ label: string; value: string; icon: string }>
  priorityOptions: Array<{ label: string; value: string; icon: string; color: string }>
}

/** DG-16 危机干预热线信息 */
interface CrisisHotline {
  name: string
  phone: string
  desc: string
}

/** DG-16 危机干预结果（与后端 CrisisIntervention 对齐） */
interface CrisisData {
  level: 'critical' | 'high' | 'moderate'
  hotlines: CrisisHotline[]
  message: string
  suggestions: string[]
}

/** DG-06 实时规划：单个时段块 */
interface ScheduleBlock {
  time: string
  type: 'warmup' | 'focus' | 'break' | 'routine' | 'review'
  title: string
  reason: string
}

/** DG-07 碎片信息：单条碎片（与后端 FragmentDTO 对齐） */
interface FragmentItem {
  id: string
  content: string
  kind: string
  tags: string[]
  sourceMsgId: string | null
  digested: boolean
  note: string | null
  createdAt: string
}

/** DG-08 隔夜整合：单个分类的高亮条目 */
interface DigestHighlight {
  id: string
  content: string
  createdAt: string
}

/** DG-08 隔夜整合：按 kind 分组的统计 */
interface DigestKindGroup {
  kind: string
  label: string
  count: number
  highlights: DigestHighlight[]
}

/** DG-08 隔夜整合：高频标签 */
interface DigestTopTag {
  tag: string
  count: number
}

/** DG-08 隔夜整合：整合结果（与后端 DigestResult 对齐） */
interface DigestData {
  date: string
  totalCount: number
  byKind: DigestKindGroup[]
  topTags: DigestTopTag[]
  todoItems: string[]
  summary: string
  generatedAt: string
}

/** DG-09 跨信息关联：单个关联组中的碎片样本 */
interface ConnectionSample {
  id: string
  content: string
  kind: string
  createdAt: string
}

/** DG-09 跨信息关联：按标签聚合的关联组 */
interface ConnectionGroup {
  tag: string
  count: number
  icon: string
  suggestedAction: string
  samples: ConnectionSample[]
}

/** DG-09 跨信息关联：关联发现结果（与后端 ConnectionsResult 对齐） */
interface ConnectionsData {
  days: number
  totalCount: number
  connections: ConnectionGroup[]
  summary: string
}

/** DG-09 跨模块洞察：单条信号样本（与后端 InsightSample 对齐） */
interface InsightSample {
  fragmentId: string
  content: string
  createdAt: string
  suggestion: string
}

/** DG-09 跨模块洞察：任务回响（与后端 InsightTaskEcho 对齐） */
interface InsightTaskEcho {
  taskId: string
  taskTitle: string
  taskStatus: string
  echoCount: number
  samples: InsightSample[]
}

/** DG-09 跨模块洞察结果（与后端 InsightsResult 对齐） */
interface InsightsData {
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

/** EV-04 智能准备：单个准备事项 */
interface PreparationItem {
  text: string
  optional?: boolean
}

/** EV-04 智能准备：单个重要事件的准备清单 */
interface PreparationEvent {
  taskId: string
  title: string
  dueDate: string
  daysLeft: number
  priority: string
  important: boolean
  category: string
  checklist: PreparationItem[]
}

/** EV-04 智能准备：准备结果（与后端 PreparationResult 对齐） */
interface PreparationData {
  events: PreparationEvent[]
  totalChecklistItems: number
  summary: string
  generatedAt: string
}

/** DG-06 实时规划：规划结果 */
interface ScheduleData {
  range: { label: string; start: string; end: string }
  blocks: ScheduleBlock[]
  tips: string[]
  summary: string
}

/** DG-10 录音纪要（与后端 VoiceMemoDTO 对齐） */
interface VoiceMemoDTO {
  id: string
  title: string
  duration: number
  audioData?: string
  audioFormat: string
  transcript: string | null
  todoItems: string[]
  summary: string | null
  status: string
  errorMsg: string | null
  createdAt: string
  updatedAt: string
}

/** DG-10 录音状态机：idle / recording / uploading */
type RecordingState = 'idle' | 'recording' | 'uploading'

/**
 * 快捷指令（DG-04）
 * - 底部按钮栏：展示常用 6 项，点击直接发送
 * - 输入框 "/" 触发：弹出完整菜单，支持关键词筛选，Enter/点击发送
 *
 * 字段：
 * - label：菜单展示名称
 * - text：发送的实际文本
 * - keywords：菜单筛选关键词（用于 "/" 后输入匹配）
 * - icon：菜单展示 emoji
 */
const quickCommands = [
  { label: '查看待办', text: '查看今日待办', keywords: '待办任务today', icon: '📋' },
  { label: '记录饮食', text: '我吃了早餐', keywords: '饮食早餐午餐晚餐food', icon: '🍱' },
  { label: '查余额', text: '查余额', keywords: '余额钱包balance', icon: '💰' },
  { label: '生成交接', text: '生成交接单', keywords: '交接班handover', icon: '📋' },
  { label: '倒计时', text: '倒计时', keywords: '倒计时countdown', icon: '⏰' },
  { label: '记录睡眠', text: '记录昨晚睡眠', keywords: '睡眠sleep', icon: '😴' },
  { label: '今日健康', text: '今日健康摘要', keywords: '健康health睡眠饮食', icon: '🏃' },
  // DG-06 实时规划：触发 AI 生成时段规划卡
  { label: '实时规划', text: '帮我规划今天下午', keywords: '规划安排plan下午', icon: '📅' },
  // DG-07 碎片信息：查看今日碎片
  { label: '我的碎片', text: '查看碎片', keywords: '碎片fragment记录', icon: '🧩' },
  // DG-08 隔夜整合：触发今日碎片整合
  { label: '今日总结', text: '整合碎片', keywords: '总结digest整合隔夜', icon: '🌙' },
  // DG-09 跨信息关联：发现碎片间关联
  { label: '发现关联', text: '发现关联', keywords: '关联connection碎片关联', icon: '🔍' },
  // DG-09 跨模块洞察：跨表关联检测
  { label: '跨模块洞察', text: '跨模块洞察', keywords: '洞察insights未闭环跨信息', icon: '🔎' },
  // EV-04 智能准备助手：为重要事件生成准备清单
  { label: '准备清单', text: '帮我准备', keywords: '准备prepare清单事件', icon: '🎯' },
  { label: '帮助', text: '帮助', keywords: '帮助helph', icon: '❓' },
]

/** v5: 表情包列表（仿微信表情面板） */
const STICKERS = [
  { id: 'happy',    name: '开心', path: '/stickers/sticker_happy.jpg' },
  { id: 'sad',      name: '难过', path: '/stickers/sticker_sad.jpg' },
  { id: 'angry',    name: '生气', path: '/stickers/sticker_angry.jpg' },
  { id: 'thinking', name: '思考', path: '/stickers/sticker_thinking.jpg' },
  { id: 'love',     name: '爱你', path: '/stickers/sticker_love.jpg' },
  { id: 'ok',       name: 'OK',  path: '/stickers/sticker_ok.jpg' },
  { id: 'cheer',    name: '加油', path: '/stickers/sticker_cheer.jpg' },
  { id: 'bye',      name: '拜拜', path: '/stickers/sticker_bye.jpg' },
  { id: 'sleepy',   name: '困了', path: '/stickers/sticker_sleepy.jpg' },
  { id: 'cry',      name: '大哭', path: '/stickers/sticker_cry.jpg' },
]

/**
 * AI 对话页
 *
 * 四大跨模块交接点（卡片可交互化）：
 * 1. 任务卡 → onTaskDone：调用 /work/tasks/:id/done 一键完成任务
 * 2. 账单卡 → onBillConfirm：调用 /finance/bills 一键入账
 * 3. 饮食卡 → onDietJump：跳转到 /diet 饮食记录页
 * 4. 交接卡 → onHandoverCreate：携带 AI 聚合的今日数据跳转 /handover?new=1 预填创建
 *
 * 消息卡片类型（messageType）：
 * - text           纯文本
 * - task_card      任务列表卡（渲染 TaskCard 组件）
 * - bill_card      账单识别卡（渲染 BillCard 组件）
 * - diet_card      饮食引导卡（渲染 DietCard 组件）
 * - handover_card  交接单生成卡（渲染 HandoverCard 组件）
 */
export default function ChatPage() {
  const { user } = useAuthStore()
  const aiNickname = user?.aiNickname
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast((s) => s.show)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  // 初始化加载状态：会话创建/历史消息加载期间展示骨架屏，避免首屏空白
  const [initLoading, setInitLoading] = useState(true)
  // 初始化失败状态：展示重试按钮，避免用户被困在空白页
  const [initError, setInitError] = useState(false)
  // DG-04 快捷指令菜单：输入框 "/" 触发，支持关键词筛选
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashActiveIdx, setSlashActiveIdx] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // DG-10 录音状态：idle 空闲 / recording 录音中 / uploading 上传中
  const [recState, setRecState] = useState<RecordingState>('idle')
  // 录音已用时（秒），仅展示用
  const [recElapsed, setRecElapsed] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recStartTsRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  // DG-02 多模态附件菜单 + 隐藏文件输入
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [mediaUploading, setMediaUploading] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // v5: 表情包面板
  const [stickerPanelOpen, setStickerPanelOpen] = useState(false)
  // v2: 上下文感知状态
  const [contextSummary, setContextSummary] = useState<string | null>(null)
  const [proactiveInsight, setProactiveInsight] = useState<{
    title: string
    message: string
    suggestions: string[]
  } | null>(null)
  const [statusScore, setStatusScore] = useState<{
    taskPressure: number
    financialHealth: number
    lifestyleRegularity: number
    overallEnergy: number
  } | null>(null)
  // v3: LLM 模型状态
  const [llmStatus, setLlmStatus] = useState<{
    available: boolean
    provider: string
    model: string
  } | null>(null)

  useEffect(() => {
    initSession()
    fetchProactiveInsight()
    fetchLLMStatus()
  }, [])

  /** v3: 获取 LLM 模型连接状态 */
  const fetchLLMStatus = async () => {
    try {
      const data = await unwrap<{
        available: boolean
        provider: string
        model: string
      }>(api.get('/chat/llm-status'))
      setLlmStatus({ available: data.available, provider: data.provider, model: data.model })
    } catch {
      setLlmStatus(null)
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  /**
   * DG-05 每日一问跳转预填
   * - HomePage 每日一问卡片点击后，通过 location.state.prefillMessage 携带建议文案
   * - 会话初始化完成后，将其填入输入框（不自动发送，用户可编辑后决定）
   * - 用完即清空 state，避免刷新页面时重复填入
   */
  useEffect(() => {
    if (sessionId && initLoading === false) {
      const prefill = (location.state as { prefillMessage?: string } | null)?.prefillMessage
      if (prefill) {
        setInput(prefill)
        inputRef.current?.focus()
        // 清空 state，避免刷新时再次填入
        navigate(location.pathname, { replace: true, state: null })
      }
    }
  }, [sessionId, initLoading, location.state, navigate])

  /** 初始化会话：若已有会话取最新，否则新建 */
  const initSession = async () => {
    setInitLoading(true)
    setInitError(false)
    try {
      const list = await unwrap<ChatSessionItem[]>(api.get('/chat/sessions'))
      if (list.length > 0) {
        setSessionId(list[0].id)
        await loadMessages(list[0].id)
      } else {
        const created = await unwrap<ChatSessionItem>(api.post('/chat/sessions', { title: '今日对话' }))
        setSessionId(created.id)
        // P0 启动问候：新建会话立即拉取，让注入的问候消息即时显示
        await loadMessages(created.id)
      }
    } catch (err) {
      setInitError(true)
      toast((err as Error).message, 'error')
    } finally {
      setInitLoading(false)
    }
  }

  /** 加载会话消息 */
  const loadMessages = async (sid: string) => {
    try {
      const list = await unwrap<Message[]>(api.get(`/chat/sessions/${sid}/messages`))
      setMessages(list)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** v2: 获取主动洞察 + 上下文摘要（进入页面时自动调用） */
  const fetchProactiveInsight = async () => {
    try {
      const data = await unwrap<{
        insight: { title: string; message: string; suggestions: string[] } | null
        contextSummary: string
        statusScore: {
          taskPressure: number
          financialHealth: number
          lifestyleRegularity: number
          overallEnergy: number
        }
      }>(api.get('/chat/proactive'))
      setProactiveInsight(data.insight)
      setContextSummary(data.contextSummary)
      setStatusScore(data.statusScore)
    } catch {
      // 静默失败，不影响核心聊天功能
    }
  }

  /** 发送消息 */
  const send = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || !sessionId || sending) return

    setInput('')
    setSending(true)
    // 乐观更新：先显示用户消息
    const userMsg: Message = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content,
      messageType: 'text',
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    try {
      const aiMsg = await unwrap<Message & { silentAck?: boolean }>(
        api.post(`/chat/sessions/${sessionId}/messages`, { content }),
      )
      // P0 silent_ack：纯确认/噪音类短回复，AI 不发气泡，仅保留用户消息（输入框微动）
      if (aiMsg && (aiMsg as { silentAck?: boolean }).silentAck) {
        return
      }
      setMessages((prev) => [...prev, aiMsg])
      // v2: 解析 metadata 中的上下文摘要，实时更新状态栏
      if (aiMsg.metadata) {
        try {
          const meta = JSON.parse(aiMsg.metadata) as {
            contextSummary?: string
            proactiveSuggestions?: string[]
          }
          if (meta.contextSummary) setContextSummary(meta.contextSummary)
        } catch {
          // metadata 解析失败，忽略
        }
      }
    } catch (err) {
      toast((err as Error).message, 'error')
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id))
    } finally {
      setSending(false)
    }
  }

  /** v5: 发送表情包 */
  const sendSticker = async (stickerId: string, stickerName: string, stickerPath: string) => {
    if (!sessionId || sending) return
    setStickerPanelOpen(false)

    // 乐观更新：先显示用户贴纸消息
    const userMsg: Message = {
      id: 'temp-sticker-' + Date.now(),
      role: 'user',
      content: `[表情: ${stickerName}]`,
      messageType: 'sticker',
      mediaUrl: stickerPath,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    try {
      // 表情包消息不需要 AI 回复，后端直接返回
      await api.post(`/chat/sessions/${sessionId}/messages`, {
        content: `[表情: ${stickerName}]`,
        messageType: 'sticker',
        mediaUrl: stickerPath,
      })
    } catch (err) {
      toast((err as Error).message, 'error')
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id))
    }
  }

  /**
   * DG-04 输入变更处理
   * - 首字符为 "/" 时打开 slash 菜单
   * - 后续输入作为关键词筛选（去掉前导 "/"）
   * - 清空或失去前导 "/" 时关闭菜单
   */
  const onInputChange = (v: string) => {
    setInput(v)
    if (v.startsWith('/')) {
      setSlashMenuOpen(true)
      setSlashActiveIdx(0)
    } else {
      setSlashMenuOpen(false)
    }
  }

  /** slash 菜单筛选结果：根据 "/" 后的关键词匹配 label/keywords */
  const slashFiltered = slashMenuOpen
    ? quickCommands.filter((cmd) => {
        const q = input.slice(1).toLowerCase()
        if (!q) return true
        return (
          cmd.label.toLowerCase().includes(q) ||
          cmd.keywords.toLowerCase().includes(q)
        )
      })
    : []

  /** 选中某条指令：直接发送该指令文本 */
  const selectSlashCommand = (cmd: typeof quickCommands[number]) => {
    setSlashMenuOpen(false)
    setInput('')
    send(cmd.text)
    inputRef.current?.focus()
  }

  /** 键盘导航：ArrowUp/Down 切换，Enter 发送，Esc 关闭 */
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // slash 菜单打开时，Enter 发送当前选中指令
      if (slashMenuOpen && slashFiltered.length > 0) {
        selectSlashCommand(slashFiltered[slashActiveIdx])
        return
      }
      send()
      return
    }
    if (slashMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashActiveIdx((i) => (i + 1) % slashFiltered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashActiveIdx((i) => (i - 1 + slashFiltered.length) % slashFiltered.length)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setSlashMenuOpen(false)
      }
    }
  }

  /** 反馈 */
  const onFeedback = async (msgId: string, feedback: 'like' | 'dislike') => {
    try {
      await api.post(`/chat/messages/${msgId}/feedback`, { feedback })
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, feedback } : m)),
      )
    } catch {
      // ignore
    }
  }

  /**
   * 跨模块交接点 1：任务卡 → 一键完成任务
   * - 调用 /work/tasks/:id/done
   * - 在消息卡片上更新任务状态
   */
  const onTaskDone = async (taskId: string, msgId: string) => {
    try {
      await unwrap(api.post(`/work/tasks/${taskId}/done`))
      toast('任务已完成 ✅', 'success')
      // 更新消息中的 metadata，标记任务为 done
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.metadata) return m
          try {
            const meta: MessageMetadata = JSON.parse(m.metadata)
            if (meta.tasks) {
              meta.tasks = meta.tasks.map((t) =>
                t.id === taskId ? { ...t, status: 'done' } : t,
              )
              return { ...m, metadata: JSON.stringify(meta) }
            }
          } catch {
            // ignore
          }
          return m
        }),
      )
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /**
   * 跨模块交接点 2：账单卡 → 一键入账
   * - 调用 /finance/bills 创建账单
   * - 完成后跳转到财务页查看
   */
  const onBillConfirm = async (
    amount: number,
    category: string,
    msgId: string,
  ) => {
    // 从消息 metadata 中读取 AI 提取的标题，用于入账（缺失时回退到默认标题）
    const msg = messages.find((m) => m.id === msgId)
    let title = `AI识别支出-${category}`
    if (msg?.metadata) {
      try {
        const meta: MessageMetadata = JSON.parse(msg.metadata)
        if (meta.title) title = meta.title
      } catch { /* ignore */ }
    }
    try {
      await unwrap(
        api.post('/finance/bills', {
          type: 'expense',
          amount,
          category,
          title,
          account: '微信',
        }),
      )
      toast(`已记录 ${category} ¥${amount}`, 'success')
      // 更新卡片，标记已入账
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.metadata) return m
          try {
            const meta: MessageMetadata = JSON.parse(m.metadata)
            meta.confirmed = true
            meta.confirmedCategory = category
            return { ...m, metadata: JSON.stringify(meta) }
          } catch {
            return m
          }
        }),
      )
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /**
   * 跨模块交接点 3：饮食卡 → 跳转记录页
   * - 直接路由到 /diet，由用户在饮食页填写详情
   */
  const onDietJump = (mealType: string) => {
    navigate('/diet')
    toast(`去记录${mealType === 'breakfast' ? '早餐' : mealType === 'lunch' ? '午餐' : mealType === 'dinner' ? '晚餐' : '加餐'}`, 'info')
  }

  /**
   * 跨模块交接点 4：交接卡 → 携带 AI 聚合数据跳转创建页
   * - 将 AI 汇总的 completedItems / pendingItems 通过 location.state 传给 /handover?new=1
   * - HandoverPage 在新建弹层中读取 state 完成预填
   */
  const onHandoverCreate = (data: {
    completedItems: string[]
    pendingItems: { text: string; priority: string; dueDate?: string }[]
    billsSummary?: { expense: number; income: number; count: number }
    dietsSummary?: { meals: number; totalCalories: number }
  }) => {
    navigate('/handover?new=1', { state: { aiPrefill: data } })
    toast('已汇总今日数据，去完善交接单', 'success')
  }

  /**
   * DG-10 录音按钮：点击开始录音，再次点击停止并上传
   *
   * 流程：
   * 1. idle 状态：点击请求麦克风权限，启动 MediaRecorder
   * 2. recording 状态：点击停止，收集 Blob 转 base64，POST /voice-memos
   * 3. uploading 状态：禁用按钮，等待后端返回（含转写+提取结果）
   * 4. 成功：在对话中追加 AI 消息，展示纪要摘要 + 待办列表
   * 5. 失败：toast 提示，回到 idle 状态
   *
   * 兼容性：MediaRecorder API 在 Chrome/Firefox/Safari 移动版均支持
   */
  const toggleRecording = async () => {
    if (recState === 'uploading') return

    // 录音中 → 停止并上传
    if (recState === 'recording') {
      stopRecording()
      return
    }

    // 空闲 → 开始录音
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      audioChunksRef.current = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      mr.onstop = handleRecordingStop
      mr.start()
      mediaRecorderRef.current = mr
      recStartTsRef.current = Date.now()
      setRecElapsed(0)
      setRecState('recording')
      // 启动计时器，每秒更新 recElapsed
      recTimerRef.current = setInterval(() => {
        setRecElapsed(Math.floor((Date.now() - recStartTsRef.current) / 1000))
      }, 1000)
    } catch (err) {
      toast(`无法访问麦克风：${(err as Error).message}`, 'error')
      setRecState('idle')
    }
  }

  /** 停止录音：关闭 MediaRecorder 与媒体流 */
  const stopRecording = () => {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  /** 录音停止后：将 Blob 转 base64 并上传到 /voice-memos */
  const handleRecordingStop = async () => {
    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
    // 大小校验：5MB 上限（与后端 MAX_AUDIO_BASE64_SIZE 对齐）
    if (blob.size > 5 * 1024 * 1024) {
      toast('录音文件过大（上限 5MB），请缩短录音时长', 'error')
      setRecState('idle')
      return
    }

    setRecState('uploading')
    try {
      // Blob → base64（去掉 data:audio/webm;base64, 前缀）
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result
          if (typeof result !== 'string') {
            reject(new Error('转 base64 失败'))
            return
          }
          const commaIdx = result.indexOf(',')
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result)
        }
        reader.onerror = () => reject(reader.error || new Error('读取失败'))
        reader.readAsDataURL(blob)
      })

      const duration = Math.floor((Date.now() - recStartTsRef.current) / 1000)

      // 上传到后端，后端会同步触发转写 + 提取
      const memo = await unwrap<VoiceMemoDTO>(
        api.post('/voice-memos', {
          audioData: base64,
          audioFormat: 'audio/webm',
          duration,
        }),
      )

      // 在对话中追加 AI 消息：展示纪要摘要 + 待办列表
      const aiMsg: Message = {
        id: 'voice-' + memo.id,
        role: 'assistant',
        content: `🎙️ 录音纪要已生成（${duration}秒）\n\n${memo.summary || '（暂无摘要）'}${memo.todoItems.length > 0 ? `\n\n待办 ${memo.todoItems.length} 项：\n${memo.todoItems.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : ''}`,
        messageType: 'text',
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, aiMsg])

      if (memo.status === 'extracted') {
        toast('录音纪要已生成', 'success')
      } else if (memo.status === 'failed') {
        toast(`转写/提取失败：${memo.errorMsg || '未知原因'}`, 'error')
      } else {
        toast('录音已上传', 'success')
      }
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setRecState('idle')
      setRecElapsed(0)
      audioChunksRef.current = []
    }
  }

  /** 组件卸载时清理录音资源，避免媒体流泄漏 */
  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  /**
   * DG-02 多模态消息发送（图片/文件/位置）
   * - 图片：File → 压缩 → base64 data URL → POST /multimodal
   * - 文件：File → base64 data URL → POST /multimodal
   * - 位置：navigator.geolocation → 坐标 + 反查地址 → POST /multimodal
   */
  const sendMultimodal = async (
    messageType: 'image' | 'file' | 'location',
    payload: { mediaUrl?: string; content?: string; metadata?: Record<string, unknown> },
  ) => {
    if (!sessionId || mediaUploading) return
    setAttachMenuOpen(false)
    setMediaUploading(true)
    try {
      const aiMsg = await unwrap<Message>(
        api.post(`/chat/sessions/${sessionId}/messages/multimodal`, {
          messageType,
          content: payload.content,
          mediaUrl: payload.mediaUrl,
          metadata: payload.metadata,
        }),
      )
      // 乐观追加一条用户消息（与后端保持一致的字段）
      const userMsg: Message = {
        id: 'mm-' + Date.now(),
        role: 'user',
        content: payload.content || `[${messageType}]`,
        messageType,
        mediaUrl: payload.mediaUrl || null,
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg, aiMsg])
      toast(`${messageType === 'image' ? '图片' : messageType === 'file' ? '文件' : '位置'}已发送`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setMediaUploading(false)
    }
  }

  /** 图片选择：压缩到最大 1280px，转 JPEG base64 */
  const onImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 重置以便再次选择同一文件
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('请选择图片文件', 'error')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('图片过大（上限 10MB）', 'error')
      return
    }
    try {
      const dataUrl = await compressImage(file, 1280, 0.8)
      await sendMultimodal('image', { mediaUrl: dataUrl, content: file.name })
    } catch (err) {
      toast(`图片处理失败：${(err as Error).message}`, 'error')
    }
  }

  /** 文件选择：直接转 base64 data URL（无压缩） */
  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast('文件过大（上限 5MB）', 'error')
      return
    }
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error || new Error('读取失败'))
        reader.readAsDataURL(file)
      })
      await sendMultimodal('file', {
        mediaUrl: dataUrl,
        content: file.name,
        metadata: { fileName: file.name, fileSize: file.size, fileType: file.type },
      })
    } catch (err) {
      toast(`文件处理失败：${(err as Error).message}`, 'error')
    }
  }

  /** 位置共享：调用浏览器定位，简化为坐标 + 时间戳（无反查地理编码服务） */
  const onShareLocation = () => {
    if (!navigator.geolocation) {
      toast('浏览器不支持定位', 'error')
      return
    }
    setAttachMenuOpen(false)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        const address = `(${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
        sendMultimodal('location', {
          content: address,
          metadata: { lat: latitude, lng: longitude, accuracy, address },
        })
      },
      (err) => {
        toast(`定位失败：${err.message}`, 'error')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const desktop = isDesktop()

  return (
    <div className={`app-shell flex flex-col ${desktop ? 'h-[calc(100vh-7rem)]' : 'h-screen'}`}>
      {/* 顶部 - 毛玻璃会话头：角角 + 状态徽章（IDLE 态语言） */}
      <header className="bg-primary-50/60 backdrop-blur-xl border-b border-primary-100 text-gray-900 rounded-xl overflow-hidden">
        <div className="h-12 flex items-center px-4 gap-2.5">
          <button
            onClick={() => navigate('/chat')}
            className="p-1.5 -ml-1 rounded-xl bg-primary-50 hover:bg-primary-100 text-primary-700 transition-colors"
            aria-label="返回会话列表"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[15px] flex items-center gap-2">
              {aiNickname || '角角'}
              {llmStatus?.available ? (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                  在呢
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  <span className="w-1 h-1 rounded-full bg-amber-500" />
                  规则模式
                </span>
              )}
            </div>
            <div className="text-[10px] text-gray-400 truncate">
              {llmStatus?.available ? `已连接 ${llmStatus.model}` : `当前语气：${toneMeta[user?.preferredTone || 'gentle']?.label || '温柔关怀'}`}
            </div>
          </div>
          {/* AI 助理设定入口 */}
          <button
            onClick={() => navigate('/settings/ai-assistant')}
            className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-100 transition-colors"
            aria-label="AI 助理设定"
            title="AI 助理设定"
          >
            <Settings size={18} />
          </button>
          {/* DG-10 录音纪要列表入口 */}
          <button
            onClick={() => navigate('/voice-memos')}
            className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-100 transition-colors"
            aria-label="录音纪要列表"
            title="录音纪要列表"
          >
            <List size={18} />
          </button>
        </div>
      </header>

      {/* 消息列表 */}
      <div ref={scrollRef} className={`flex-1 overflow-y-auto px-3 py-4 bg-gradient-to-b from-primary-50/40 via-white to-primary-50/10 ${desktop ? 'rounded-b-xl' : ''}`}>
        <div className={`space-y-3 ${desktop ? 'max-w-[800px] mx-auto' : ''}`}>
        {initLoading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <LoadingState text="加载会话中..." />
          </div>
        ) : initError ? (
          <div className="flex flex-col items-center justify-center h-full">
            <ErrorState text="会话加载失败" onRetry={initSession} />
          </div>
        ) : (
          <>
            {/* 日期分隔线：居中文字 + 两侧细线 */}
            <div className="flex items-center gap-3 text-[10px] text-gray-400 my-1">
              <span className="flex-1 h-px bg-gray-200/70" />
              今天 {formatTime(new Date().toISOString())}
              <span className="flex-1 h-px bg-gray-200/70" />
            </div>

            {/* v2: 主动洞察卡片（用户进入页面时若状态异常则展示） */}
            {proactiveInsight && (
              <div className="bg-gradient-to-br from-primary-50 to-primary-100 border border-primary-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-start gap-2 mb-2">
                  <Sparkles size={18} className="text-primary-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-primary-700 text-sm mb-1">{proactiveInsight.title}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{proactiveInsight.message}</p>
                  </div>
                  <button
                    onClick={() => setProactiveInsight(null)}
                    className="text-gray-400 hover:text-gray-600 p-0.5"
                    aria-label="关闭"
                  >
                    <X size={14} />
                  </button>
                </div>
                {proactiveInsight.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {proactiveInsight.suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => send(s)}
                        className="text-xs bg-white text-primary-600 px-3 py-1.5 rounded-full hover:bg-primary-100 border border-primary-100 transition-colors active:scale-95"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* v2: 上下文状态栏（展示当前全模块状态摘要 + 状态评分） */}
            {contextSummary && (
              <div className="bg-white/60 backdrop-blur rounded-xl px-3 py-2 border border-gray-100">
                <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
                  AI 已感知当前状态
                </div>
                <p className="text-xs text-gray-600 leading-relaxed mb-2">{contextSummary}</p>
                {statusScore && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: '压力', value: statusScore.taskPressure, color: 'bg-amber-400', desc: '任务压力' },
                      { label: '财务', value: statusScore.financialHealth, color: 'bg-emerald-400', desc: '财务健康' },
                      { label: '规律', value: statusScore.lifestyleRegularity, color: 'bg-sky-400', desc: '生活规律' },
                      { label: '能量', value: statusScore.overallEnergy, color: 'bg-violet-400', desc: '综合能量' },
                    ].map((item) => (
                      <div key={item.label} className="flex flex-col items-center">
                        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                          <div
                            className={`h-full ${item.color} rounded-full transition-all duration-500`}
                            style={{ width: `${Math.min(100, Math.max(0, item.value))}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400">{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.length === 0 && (
              <EmptyState
                icon="💬"
                text="开始和 角角对话吧"
                hint="输入消息开始对话"
              />
            )}
            {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            avatar={user?.avatar}
            onFeedback={onFeedback}
            onTaskDone={(taskId) => onTaskDone(taskId, m.id)}
            onBillConfirm={(amount, category) => onBillConfirm(amount, category, m.id)}
            onDietJump={onDietJump}
            onHandoverCreate={onHandoverCreate}
            onQuickReply={send}
          />
        ))}
        {sending && (
          <div className="flex gap-2 justify-start">
            <MsgAvatar avatar={user?.avatar} isAi />
            <div className="bg-white rounded-[20px] rounded-bl-md px-4 py-3 shadow-sm border border-gray-100 self-start">
              <span className="inline-flex gap-1">
                <span className="w-2 h-2 rounded-full bg-primary-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-primary-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-primary-300 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
          </>
        )}
        </div>
      </div>

      {/* 输入区 */}
      <div className={`bg-white/90 backdrop-blur border-t border-primary-50 px-3 py-2 relative ${desktop ? 'rounded-b-xl' : ''}`}>
        <div className={desktop ? 'max-w-[800px] mx-auto' : ''}>
        {/* DG-04 slash 快捷指令菜单 */}
        {slashMenuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden max-h-64 overflow-y-auto">
            <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-50 bg-gray-50/50">
              快捷指令 · 输入关键词筛选 · ↑↓ 选择 · Enter 发送 · Esc 关闭
            </div>
            {slashFiltered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400">
                没有匹配的指令
              </div>
            ) : (
              slashFiltered.map((cmd, idx) => (
                <button
                  key={cmd.label}
                  onClick={() => selectSlashCommand(cmd)}
                  onMouseEnter={() => setSlashActiveIdx(idx)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    idx === slashActiveIdx ? 'bg-primary-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="text-lg">{cmd.icon}</span>
                  <div className="flex-1">
                    <div className="text-sm text-gray-800">{cmd.label}</div>
                    <div className="text-xs text-gray-400">{cmd.text}</div>
                  </div>
                  {idx === slashActiveIdx && (
                    <span className="text-xs text-primary-500">↩</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
        {/* DG-02 多模态附件菜单 */}
        {attachMenuOpen && (
          <div className="absolute bottom-full left-3 mb-1 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden w-40">
            <button
              onClick={() => imageInputRef.current?.click()}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <ImageIcon size={16} className="text-blue-500" /> 图片
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 border-t border-gray-50"
            >
              <Paperclip size={16} className="text-green-500" /> 文件
            </button>
            <button
              onClick={onShareLocation}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 border-t border-gray-50"
            >
              <MapPin size={16} className="text-rose-500" /> 位置
            </button>
          </div>
        )}
        {/* v5: 表情包面板（仿微信） */}
        {stickerPanelOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
            <div className="px-3 py-2 text-xs text-gray-400 border-b border-gray-50 bg-gray-50/50 flex items-center justify-between">
              <span>表情包 · 点击发送</span>
              <button onClick={() => setStickerPanelOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1 p-2 max-h-48 overflow-y-auto">
              {STICKERS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => sendSticker(s.id, s.name, s.path)}
                  className="aspect-square rounded-lg overflow-hidden hover:bg-primary-50 transition-colors p-1 active:scale-90"
                  title={s.name}
                >
                  <img src={s.path} alt={s.name} className="w-full h-full object-cover rounded" />
                </button>
              ))}
            </div>
          </div>
        )}
        {/* 隐藏的文件输入 */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onImageSelected}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileSelected}
        />
        <div className="flex items-end gap-2">
          <div className="flex-1 bg-white rounded-3xl border-[1.5px] border-primary-200 px-3.5 py-2 flex items-end gap-2 shadow-sm transition-all focus-within:border-primary-400 focus-within:shadow-md focus-within:shadow-primary-100/60">
            <textarea
              ref={inputRef}
              className="flex-1 bg-transparent text-sm outline-none resize-none max-h-24"
              rows={1}
              placeholder={recState === 'recording' ? `录音中... ${recElapsed}s（再次点击停止）` : recState === 'uploading' ? '上传处理中...' : '输入消息... 输入 / 呼出快捷指令'}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onInputKeyDown}
              onBlur={() => {
                // 延迟关闭，避免点击菜单前触发
                setTimeout(() => setSlashMenuOpen(false), 150)
              }}
              disabled={recState !== 'idle'}
            />
            {/* DG-10 录音状态指示（录音中显示计时） */}
            {recState === 'recording' && (
              <span className="text-xs text-red-500 flex items-center gap-1 flex-shrink-0 self-center">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {recElapsed}s
              </span>
            )}
          </div>

          {/* DG-02 多模态附件按钮：+ 切换附件菜单 */}
          <button
            onClick={() => { setAttachMenuOpen((v) => !v); setStickerPanelOpen(false) }}
            disabled={mediaUploading}
            aria-label={attachMenuOpen ? '关闭附件菜单' : '打开附件菜单'}
            className={`p-2 rounded-full transition-colors flex-shrink-0 ${
              attachMenuOpen
                ? 'bg-primary-100 text-primary-600'
                : 'bg-primary-50 text-primary-600 hover:bg-primary-100'
            } disabled:opacity-40`}
          >
            {mediaUploading ? <Loader2 size={18} className="animate-spin" /> : attachMenuOpen ? <X size={18} /> : <Plus size={18} />}
          </button>

          {/* v5: 表情包按钮 — 仿微信笑脸 */}
          <button
            onClick={() => { setStickerPanelOpen((v) => !v); setAttachMenuOpen(false); setSlashMenuOpen(false) }}
            disabled={recState !== 'idle'}
            aria-label={stickerPanelOpen ? '关闭表情包' : '打开表情包'}
            className={`p-2 rounded-full transition-colors flex-shrink-0 ${
              stickerPanelOpen
                ? 'bg-primary-100 text-primary-600'
                : 'bg-primary-50 text-primary-600 hover:bg-primary-100'
            } disabled:opacity-40`}
          >
            {stickerPanelOpen ? <X size={18} /> : <Smile size={18} />}
          </button>

          {/* DG-10 录音按钮：点击切换 录音/停止 */}
          <button
            onClick={toggleRecording}
            disabled={recState === 'uploading'}
            aria-label={recState === 'recording' ? '停止录音' : '开始录音'}
            className={`p-2 rounded-full transition-colors flex-shrink-0 ${
              recState === 'recording'
                ? 'bg-red-500 text-white hover:bg-red-600'
                : recState === 'uploading'
                  ? 'bg-gray-300 text-white'
                  : 'bg-primary-50 text-primary-600 hover:bg-primary-100'
            }`}
          >
            {recState === 'recording' ? (
              <Square size={18} fill="currentColor" />
            ) : recState === 'uploading' ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Mic size={18} />
            )}
          </button>

          <button
            onClick={() => send()}
            disabled={!input.trim() || sending || recState !== 'idle'}
            className="p-2.5 text-white rounded-2xl disabled:opacity-40 hover:shadow-lg hover:shadow-primary-300/40 transition-all active:scale-90"
            style={{ background: !input.trim() || sending || recState !== 'idle' ? undefined : 'linear-gradient(135deg, #334155 0%, #1e293b 100%)' }}
          >
            <Send size={18} />
          </button>
        </div>
        <div className="text-[10px] text-gray-300 mt-1 px-2">
          猜你想做：{user?.primaryGoal || '查看待办 | 记录饮食'}
        </div>
        </div>
      </div>
    </div>
  )
}

/** 消息气泡 */
function MessageBubble({
  message,
  avatar,
  onFeedback,
  onTaskDone,
  onBillConfirm,
  onDietJump,
  onHandoverCreate,
  onQuickReply,
}: {
  message: Message
  avatar?: string
  onFeedback: (id: string, f: 'like' | 'dislike') => void
  onTaskDone: (taskId: string) => void
  onBillConfirm: (amount: number, category: string) => void
  onDietJump: (mealType: string) => void
  onHandoverCreate: (data: {
    completedItems: string[]
    pendingItems: { text: string; priority: string; dueDate?: string }[]
    billsSummary?: { expense: number; income: number; count: number }
    dietsSummary?: { meals: number; totalCalories: number }
  }) => void
  onQuickReply?: (text: string) => void
}) {
  const isUser = message.role === 'user'
  let metadata: MessageMetadata | null = null
  try {
    metadata = message.metadata ? JSON.parse(message.metadata) : null
  } catch {
    // ignore
  }

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* AI 头像：产品红线——AI 也用用户头像，右下「角」角标区分身份 */}
      {!isUser && <MsgAvatar avatar={avatar} isAi />}
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* DG-02 多模态消息渲染：图片/文件/位置 */}
        {isUser && message.messageType === 'image' && message.mediaUrl && (
          <div className="rounded-2xl rounded-tr-sm overflow-hidden bg-white shadow-sm">
            <img
              src={message.mediaUrl}
              alt={message.content}
              className="max-w-full max-h-64 object-cover"
            />
            {message.content && message.content !== '[图片]' && (
              <div className="px-3 py-1.5 text-xs text-gray-700">{message.content}</div>
            )}
          </div>
        )}
        {isUser && message.messageType === 'file' && message.mediaUrl && (
          <a
            href={message.mediaUrl}
            download={(metadata as { fileName?: string } | null)?.fileName || message.content}
            className="flex items-center gap-2 px-4 py-3 text-white rounded-2xl rounded-tr-sm shadow-sm shadow-primary-200/40"
            style={{ background: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)' }}
          >
            <Paperclip size={18} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{message.content}</div>
              {(metadata as { fileSize?: number } | null)?.fileSize && (
                <div className="text-[10px] opacity-80">
                  {formatFileSize((metadata as { fileSize: number }).fileSize)}
                </div>
              )}
            </div>
          </a>
        )}
        {isUser && message.messageType === 'location' && (
          <div
            className="px-4 py-3 text-white rounded-2xl rounded-tr-sm shadow-sm shadow-primary-200/40"
            style={{ background: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)' }}
          >
            <div className="flex items-center gap-2">
              <MapPin size={16} />
              <span className="text-sm font-medium">位置共享</span>
            </div>
            <div className="text-xs mt-1 opacity-90">{message.content}</div>
            {(metadata as { accuracy?: number } | null)?.accuracy && (
              <div className="text-[10px] mt-0.5 opacity-70">
                精度 ±{Math.round((metadata as { accuracy: number }).accuracy)}m
              </div>
            )}
          </div>
        )}
        {/* v5: 表情包消息渲染 */}
        {message.messageType === 'sticker' && message.mediaUrl && (
          <div className="rounded-2xl overflow-hidden bg-transparent shadow-sm" style={{ maxWidth: '120px' }}>
            <img
              src={message.mediaUrl}
              alt={message.content}
              className="w-full h-auto object-cover rounded-xl"
            />
          </div>
        )}
        {/* 普通文本消息（非多模态、非表情包） */}
        {!(
          isUser &&
          (message.messageType === 'image' ||
            message.messageType === 'file' ||
            message.messageType === 'location')
        ) && message.messageType !== 'sticker' && (
          <div
            className={`px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
              isUser
                ? 'text-white rounded-[20px] rounded-br-md shadow-md shadow-primary-500/30'
                : 'bg-white text-gray-800 rounded-[20px] rounded-bl-md shadow-sm border-[1.5px] border-primary-100'
            }`}
            style={isUser ? { background: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)' } : undefined}
          >
            {message.content}
          </div>
        )}

        {/* 卡片渲染（交接点：可交互的功能卡片） */}
        {!isUser && message.messageType === 'task_card' && metadata?.tasks && (
          <TaskCard
            tasks={metadata.tasks}
            onDone={onTaskDone}
          />
        )}
        {!isUser && message.messageType === 'bill_card' && metadata && (
          <BillCard
            amount={metadata.amount || 0}
            type={metadata.type || '其他'}
            confirmed={metadata.confirmed}
            autoCategory={metadata.autoCategory}
            onConfirm={onBillConfirm}
          />
        )}
        {!isUser && message.messageType === 'diet_card' && metadata && (
          <DietCard mealType={metadata.mealType || 'breakfast'} onJump={onDietJump} />
        )}
        {!isUser && message.messageType === 'handover_card' && metadata && (
          <HandoverCard
            completedItems={metadata.completedItems || []}
            pendingItems={metadata.pendingItems || []}
            billsSummary={metadata.billsSummary}
            dietsSummary={metadata.dietsSummary}
            onCreate={onHandoverCreate}
          />
        )}
        {!isUser && message.messageType === 'schedule_card' && metadata?.schedule && (
          <ScheduleCard schedule={metadata.schedule} />
        )}
        {!isUser && message.messageType === 'fragment_card' && metadata?.fragments && (
          <FragmentCard fragments={metadata.fragments} />
        )}
        {!isUser && message.messageType === 'digest_card' && metadata?.digest && (
          <DigestCard digest={metadata.digest} />
        )}
        {/* P1 周报：@回顾 文本气泡下追加「看完整周报」跳转卡 */}
        {!isUser && metadata?.weeklyReport && (
          <Link
            to="/weekly-report"
            className="mt-1.5 flex items-center justify-between gap-2 px-3.5 py-2.5 bg-white rounded-xl rounded-tl-sm shadow-sm border border-primary-100 hover:border-primary-300 transition-colors"
          >
            <span className="flex items-center gap-2 text-xs text-gray-600">
              <Sparkles size={14} className="text-primary-500" />
              图表版周报 · 收支/情绪/角角落
            </span>
            <ArrowRight size={14} className="text-primary-400" />
          </Link>
        )}
        {/* P3 画像：@画像 文本气泡下追加「看完整画像」跳转卡 */}
        {!isUser && metadata?.portrait && (
          <Link
            to="/profile-panel"
            className="mt-1.5 flex items-center justify-between gap-2 px-3.5 py-2.5 bg-white rounded-xl rounded-tl-sm shadow-sm border border-primary-100 hover:border-primary-300 transition-colors"
          >
            <span className="flex items-center gap-2 text-xs text-gray-600">
              <Fingerprint size={14} className="text-primary-500" />
              图表版画像 · 消费/情绪/记忆
            </span>
            <ArrowRight size={14} className="text-primary-400" />
          </Link>
        )}
        {/* P2 办公小助手：新版本/导出结果卡片（预览 + 下载） */}
        {!isUser && metadata?.office && (metadata.office.type === 'write' || metadata.office.type === 'export') && metadata.office.docId && (
          <div className="mt-1.5 px-3.5 py-3 bg-white rounded-xl rounded-tl-sm shadow-sm border border-emerald-100">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-emerald-500" />
              <span className="text-xs font-medium text-gray-700 truncate">{metadata.office.title || '新文档'}</span>
              {metadata.office.basedOn && (
                <span className="text-[10px] text-gray-400 truncate">基于 {metadata.office.basedOn} · 原件未动</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={`/office-doc/${metadata.office!.docId}`}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
              >
                <Eye size={12} /> 预览
              </Link>
              <button
                onClick={() => downloadOfficeDoc(metadata.office!.docId!, metadata.office!.format === 'txt' ? 'txt' : 'md', metadata.office!.title)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Download size={12} /> 下载 {String(metadata.office.format === 'txt' ? 'txt' : 'md').toUpperCase()}
              </button>
            </div>
          </div>
        )}
        {/* P2 办公小助手：读文档摘要卡 */}
        {!isUser && metadata?.office?.type === 'read' && (
          <div className="mt-1.5 flex items-center gap-2 px-3.5 py-2.5 bg-white rounded-xl rounded-tl-sm shadow-sm border border-gray-100">
            <FileText size={14} className="text-gray-400" />
            <span className="text-[11px] text-gray-500 truncate">
              {metadata.office.fileName} · {metadata.office.charCount} 字{metadata.office.format ? ` · ${metadata.office.format}` : ''}
            </span>
          </div>
        )}
        {!isUser && message.messageType === 'connections_card' && metadata?.connections && (
          <ConnectionsCard connections={metadata.connections} />
        )}
        {!isUser && message.messageType === 'insights_card' && metadata?.insights && (
          <InsightsCard insights={metadata.insights} />
        )}
        {!isUser && message.messageType === 'preparation_card' && metadata?.preparation && (
          <PreparationCard preparation={metadata.preparation} />
        )}
        {/* DG-16 危机干预卡 */}
        {!isUser && message.messageType === 'crisis_card' && metadata?.crisis && (
          <CrisisCard crisis={metadata.crisis} />
        )}
        {/* v4: 统一任务交互卡片（选项卡 + 结果卡合并） */}
        {!isUser && (message.messageType === 'task_created_card' || message.messageType === 'task_options_card') && (
          <UnifiedTaskCard
            options={metadata?.options}
            actionResult={metadata?.actionResult}
            onQuickReply={onQuickReply}
          />
        )}

        {/* 反馈按钮 */}
        {!isUser && message.messageType !== 'text' && (
          <div className="flex gap-2 mt-1 px-1">
            <button
              onClick={() => onFeedback(message.id, 'like')}
              className={`text-xs ${message.feedback === 'like' ? 'text-green-500' : 'text-gray-400'}`}
            >
              👍
            </button>
            <button
              onClick={() => onFeedback(message.id, 'dislike')}
              className={`text-xs ${message.feedback === 'dislike' ? 'text-red-500' : 'text-gray-400'}`}
            >
              👎
            </button>
          </div>
        )}
      </div>
      {/* 用户头像（右侧） */}
      {isUser && <MsgAvatar avatar={avatar} />}
    </div>
  )
}

/** 消息头像：双方都用用户头像（产品红线），AI 侧加「角」角标区分 */
function MsgAvatar({ avatar, isAi }: { avatar?: string; isAi?: boolean }) {
  const isImg = avatar && (avatar.startsWith('data:image') || avatar.startsWith('http') || avatar.startsWith('/'))
  return (
    <div className="relative w-[34px] h-[34px] rounded-[13px] flex-shrink-0 self-end mb-1 bg-primary-100 border-2 border-white shadow-md shadow-primary-500/20">
      <div className="w-full h-full rounded-[11px] overflow-hidden flex items-center justify-center text-base text-primary-700">
        {isImg ? <img src={avatar} alt="头像" className="w-full h-full object-cover" /> : <span>{avatar || '👤'}</span>}
      </div>
      {isAi && (
        <span className="absolute -right-1 -bottom-1 w-[15px] h-[15px] rounded-full bg-primary-500 border-2 border-white text-white text-[8px] flex items-center justify-center font-bold leading-none">
          角
        </span>
      )}
    </div>
  )
}

/**
 * 任务卡片
 * - 每条任务支持"完成"按钮
 * - 已完成的任务显示对勾
 */
function TaskCard({ tasks, onDone }: { tasks: TaskItem[]; onDone: (id: string) => void }) {
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-3 py-2 bg-primary-50 text-primary-700 text-xs font-medium">
        📋 待办列表
      </div>
      <div className="divide-y divide-gray-50">
        {tasks.map((t) => {
          const done = t.status === 'done'
          return (
            <div key={t.id} className="px-3 py-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                  {t.important && '🔴 '}{t.title}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {t.dueDate && `截止 ${formatTime(t.dueDate)} · `}
                  进度 {t.progress}%
                </div>
              </div>
              {done ? (
                <span className="text-xs text-green-500 flex items-center gap-1">
                  <Check size={14} /> 已完成
                </span>
              ) : (
                <button
                  onClick={() => onDone(t.id)}
                  className="px-2 py-1 text-xs bg-primary-50 text-primary-600 rounded-full hover:bg-primary-100"
                >
                  完成
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 账单卡片
 * - 点击分类按钮一键入账
 * - 入账后显示已记录提示
 */
function BillCard({
  amount,
  type,
  confirmed,
  autoCategory,
  onConfirm,
}: {
  amount: number
  type: string
  confirmed?: boolean
  autoCategory?: string
  onConfirm: (amount: number, category: string) => void
}) {
  const categories = BILL_QUICK_CATEGORIES
  if (confirmed) {
    return (
      <div className="mt-2 bg-green-50 rounded-xl shadow-sm border border-green-100 p-3 flex items-center gap-2">
        <Check size={16} className="text-green-500" />
        <span className="text-sm text-green-700">已记录 ¥{amount.toFixed(2)}</span>
      </div>
    )
  }
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 p-3">
      <div className="text-xs text-gray-400">识别到{type === 'expense' ? '支出' : '收入'}</div>
      <div className="text-xl font-bold text-red-500 mt-1">¥{amount.toFixed(2)}</div>
      {autoCategory && (
        <div className="mt-1 text-xs text-primary-600 flex items-center gap-1">
          <Sparkles size={10} /> AI 建议分类：{autoCategory}
        </div>
      )}
      <div className="mt-2 text-xs text-gray-500">选择分类一键入账：</div>
      <div className="mt-2 flex gap-2 flex-wrap">
        {/* AI 建议分类若不在快捷分类中，单独显示一个高亮按钮 */}
        {autoCategory && !categories.includes(autoCategory as never) && (
          <button
            onClick={() => onConfirm(amount, autoCategory)}
            className="px-3 py-1 text-xs bg-primary-500 text-white rounded-full ring-2 ring-primary-300"
          >
            {autoCategory} ✓
          </button>
        )}
        {categories.map((cat) => {
          const isSuggested = autoCategory === cat
          return (
            <button
              key={cat}
              onClick={() => onConfirm(amount, cat)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                isSuggested
                  ? 'bg-primary-500 text-white ring-2 ring-primary-300'
                  : 'bg-primary-50 text-primary-600 hover:bg-primary-100'
              }`}
            >
              {cat}{isSuggested ? ' ✓' : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 饮食卡片
 * - 点击跳转到饮食记录页
 */
function DietCard({ mealType, onJump }: { mealType: string; onJump: (m: string) => void }) {
  const labels: Record<string, string> = {
    breakfast: '🍳 早餐',
    lunch: '🥗 午餐',
    dinner: '🍲 晚餐',
    snack: '🍎 加餐',
  }
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 p-3">
      <div className="text-sm text-gray-700">记录{labels[mealType] || '饮食'}</div>
      <div className="mt-2 text-xs text-gray-400">点击下方按钮，前往饮食记录页填写详情</div>
      <button
        onClick={() => onJump(mealType)}
        className="mt-2 flex items-center gap-1 px-3 py-1 text-xs bg-primary-50 text-primary-600 rounded-full hover:bg-primary-100"
      >
        去记录 <ArrowRight size={12} />
      </button>
    </div>
  )
}

/** 交接卡中待跟进事项结构 */
interface HandoverPendingItem {
  text: string
  priority: string
  dueDate?: string
}

/**
 * 交接单生成卡
 * - 展示 AI 汇总的今日已完成事项 / 待跟进事项 / 账单 / 饮食摘要
 * - 点击"生成交接单"按钮跳转到 /handover?new=1 并通过 location.state 预填
 */
function HandoverCard({
  completedItems,
  pendingItems,
  billsSummary,
  dietsSummary,
  onCreate,
}: {
  completedItems: string[]
  pendingItems: HandoverPendingItem[]
  billsSummary?: { expense: number; income: number; count: number }
  dietsSummary?: { meals: number; totalCalories: number }
  onCreate: (data: {
    completedItems: string[]
    pendingItems: HandoverPendingItem[]
    billsSummary?: { expense: number; income: number; count: number }
    dietsSummary?: { meals: number; totalCalories: number }
  }) => void
}) {
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-3 py-2 bg-teal-50 text-teal-700 text-xs font-medium">
        📋 今日数据汇总
      </div>

      <div className="p-3 space-y-3 text-sm">
        {/* 已完成事项 */}
        {completedItems.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 mb-1">✓ 已完成（{completedItems.length}）</div>
            <ul className="space-y-0.5">
              {completedItems.slice(0, 5).map((item, i) => (
                <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                  <Check size={12} className="text-green-500 mt-0.5 flex-shrink-0" />
                  <span className="line-through text-gray-400">{item}</span>
                </li>
              ))}
              {completedItems.length > 5 && (
                <li className="text-xs text-gray-400">...还有 {completedItems.length - 5} 项</li>
              )}
            </ul>
          </div>
        )}

        {/* 待跟进事项 */}
        {pendingItems.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 mb-1">⏳ 待跟进（{pendingItems.length}）</div>
            <ul className="space-y-1">
              {pendingItems.slice(0, 5).map((item, i) => {
                const pMeta = priorityMeta[item.priority] || priorityMeta.medium
                return (
                  <li key={i} className="flex items-center gap-1.5">
                    <span className={`badge ${pMeta.bg} ${pMeta.color} text-[10px]`}>
                      {pMeta.label}
                    </span>
                    <span className="text-xs text-gray-700 flex-1 truncate">{item.text}</span>
                  </li>
                )
              })}
              {pendingItems.length > 5 && (
                <li className="text-xs text-gray-400">...还有 {pendingItems.length - 5} 项</li>
              )}
            </ul>
          </div>
        )}

        {/* 账单摘要 */}
        {billsSummary && (
          <div className="flex items-center gap-3 text-xs text-gray-500 bg-gray-50 rounded p-2">
            <span>💰 今日支出 ¥{billsSummary.expense.toFixed(2)}</span>
            {billsSummary.income > 0 && <span>· 收入 ¥{billsSummary.income.toFixed(2)}</span>}
            <span>· {billsSummary.count} 笔</span>
          </div>
        )}

        {/* 饮食摘要 */}
        {dietsSummary && (
          <div className="flex items-center gap-3 text-xs text-gray-500 bg-gray-50 rounded p-2">
            <span>🍱 {dietsSummary.meals} 餐</span>
            <span>· 🔥 {dietsSummary.totalCalories} kcal</span>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-gray-50">
        <button
          onClick={() => onCreate({ completedItems, pendingItems, billsSummary, dietsSummary })}
          className="w-full flex items-center justify-center gap-1 py-2 text-xs bg-teal-500 text-white rounded-lg hover:bg-teal-600"
        >
          <Plus size={14} /> 生成交接单 <ArrowRight size={12} />
        </button>
      </div>
    </div>
  )
}

/**
 * DG-06 实时规划：时段规划卡
 *
 * 渲染 AI 生成的时段规划，按时间顺序展示：
 * - 顶部：时段范围（label + start-end）+ 专注块数量统计
 * - 中部：时段块列表，每块含 time/type 标签/title/reason
 *   - warmup  🔍 热身回顾
 *   - focus   🎯 深度专注（核心任务）
 *   - break   ☕ 休息放松
 *   - routine 📌 常规事务（提醒）
 *   - review  ✨ 复盘总结
 * - 底部：AI 个性化提示
 */
const scheduleBlockMeta: Record<ScheduleBlock['type'], { label: string; emoji: string; color: string; bg: string; bar: string }> = {
  warmup: { label: '热身', emoji: '🔍', color: 'text-blue-600', bg: 'bg-blue-50', bar: 'bg-blue-600' },
  focus: { label: '专注', emoji: '🎯', color: 'text-purple-600', bg: 'bg-purple-50', bar: 'bg-purple-600' },
  break: { label: '休息', emoji: '☕', color: 'text-green-600', bg: 'bg-green-50', bar: 'bg-green-600' },
  routine: { label: '常规', emoji: '📌', color: 'text-orange-600', bg: 'bg-orange-50', bar: 'bg-orange-600' },
  review: { label: '复盘', emoji: '✨', color: 'text-teal-600', bg: 'bg-teal-50', bar: 'bg-teal-600' },
}

function ScheduleCard({ schedule }: { schedule: ScheduleData }) {
  const focusCount = schedule.blocks.filter((b) => b.type === 'focus').length
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：时段范围 */}
      <div className="px-3 py-2 bg-gradient-to-r from-primary-50 to-accent-50 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">📅</span>
            <span className="text-sm font-medium text-gray-800">{schedule.range.label}</span>
            <span className="text-xs text-gray-400">
              {schedule.range.start} - {schedule.range.end}
            </span>
          </div>
          <span className="text-[10px] text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
            {focusCount} 个专注块
          </span>
        </div>
      </div>

      {/* 时段块列表 */}
      <div className="p-3 space-y-2">
        {schedule.blocks.map((block, i) => {
          const meta = scheduleBlockMeta[block.type]
          return (
            <div
              key={i}
              className={`relative pl-3 py-2 pr-2 rounded-lg ${meta.bg} border border-gray-50`}
            >
              {/* 左侧时间线 */}
              <div className={`absolute left-0 top-2 bottom-2 w-1 rounded-full ${meta.bar}`} />
              <div className="flex items-start gap-2">
                <span className="text-sm flex-shrink-0">{meta.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono text-gray-500">{block.time}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color} bg-white border border-gray-100`}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="text-sm text-gray-800 leading-snug">{block.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{block.reason}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部：AI 提示 */}
      {schedule.tips.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border-t border-amber-100">
          <div className="text-[10px] text-amber-600 font-medium mb-1">💡 个性化提示</div>
          <ul className="space-y-0.5">
            {schedule.tips.map((tip, i) => (
              <li key={i} className="text-xs text-gray-600 leading-relaxed">· {tip}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * 碎片卡片（DG-07）
 * - 展示今日已记录的碎片列表
 * - 每条碎片按 kind 显示对应配色徽章 + emoji
 * - 显示内容摘要、标签、创建时间
 * - 长内容截断显示，避免卡片过长
 */
function FragmentCard({ fragments }: { fragments: FragmentItem[] }) {
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：标题 + 数量 */}
      <div className="px-3 py-2 bg-gradient-to-r from-primary-50 to-primary-100 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🧩</span>
            <span className="text-sm font-medium text-gray-800">今日碎片</span>
            <span className="text-xs text-gray-400">{fragments.length} 条</span>
          </div>
          <span className="text-[10px] text-teal-600 bg-teal-100 px-2 py-0.5 rounded-full">
            自动分类
          </span>
        </div>
      </div>

      {/* 碎片列表 */}
      <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
        {fragments.map((f) => {
          const meta = fragmentKindMeta[f.kind] || fragmentKindMeta.note
          const content = f.content.length > 80 ? f.content.slice(0, 80) + '…' : f.content
          const time = new Date(f.createdAt)
          const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
          return (
            <div key={f.id} className="px-3 py-2 hover:bg-gray-50">
              <div className="flex items-start gap-2">
                <span className="text-sm flex-shrink-0 mt-0.5">{meta.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color} ${meta.bg}`}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{timeStr}</span>
                    {f.digested && (
                      <span className="text-[10px] text-purple-500 bg-purple-50 px-1 py-0.5 rounded">
                        已整合
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-700 leading-snug break-words whitespace-pre-wrap">
                    {content}
                  </div>
                  {f.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {f.tags.map((tag, i) => (
                        <span
                          key={i}
                          className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部：提示 */}
      <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100">
        <div className="text-[10px] text-gray-400">
          发送任何文字我都会自动帮你分类存储~
        </div>
      </div>
    </div>
  )
}

/**
 * 隔夜整合卡片（DG-08）
 * - 展示今日碎片的结构化总结
 * - 顶部：日期 + 总数 + 整合时间
 * - 中部：按 kind 分组的统计 + highlights
 * - 标签云：高频标签 Top 5
 * - 待跟进：todo 类型碎片列表
 * - 底部：自然语言总结
 */
function DigestCard({ digest }: { digest: DigestData }) {
  const genTime = new Date(digest.generatedAt)
  const genTimeStr = `${String(genTime.getHours()).padStart(2, '0')}:${String(genTime.getMinutes()).padStart(2, '0')}`

  // 空整合：展示提示信息
  if (digest.totalCount === 0) {
    return (
      <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-3 bg-gradient-to-r from-gray-50 to-gray-100 text-center">
          <div className="text-2xl mb-1">🌙</div>
          <div className="text-sm text-gray-600">{digest.summary}</div>
          <div className="text-[10px] text-gray-400 mt-1">{digest.date} · {genTimeStr}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：日期 + 总数 */}
      <div className="px-3 py-2 bg-gradient-to-r from-primary-50 to-accent-50 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🌙</span>
            <span className="text-sm font-medium text-gray-800">今日整合</span>
            <span className="text-xs text-gray-400">{digest.date}</span>
          </div>
          <span className="text-[10px] text-primary-600 bg-primary-100 px-2 py-0.5 rounded-full">
            {digest.totalCount} 条碎片
          </span>
        </div>
      </div>

      {/* 分类统计 + highlights */}
      <div className="p-3 space-y-2">
        {digest.byKind.map((group) => {
          const meta = fragmentKindMeta[group.kind] || fragmentKindMeta.note
          return (
            <div key={group.kind} className={`rounded-lg ${meta.bg} p-2 border border-gray-50`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">{meta.emoji}</span>
                <span className={`text-xs font-medium ${meta.color}`}>{group.label}</span>
                <span className="text-[10px] text-gray-400">{group.count} 条</span>
              </div>
              <div className="space-y-1">
                {group.highlights.map((h) => (
                  <div key={h.id} className="text-xs text-gray-700 leading-snug pl-4 border-l-2 border-gray-200">
                    {h.content}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* 标签云 */}
      {digest.topTags.length > 0 && (
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
          <div className="text-[10px] text-gray-500 font-medium mb-1">🏷️ 高频标签</div>
          <div className="flex flex-wrap gap-1">
            {digest.topTags.slice(0, 5).map((t, i) => (
              <span
                key={i}
                className="text-[10px] text-indigo-600 bg-white border border-indigo-100 px-1.5 py-0.5 rounded"
              >
                #{t.tag} <span className="text-gray-400">×{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 待跟进事项 */}
      {digest.todoItems.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border-t border-amber-100">
          <div className="text-[10px] text-amber-700 font-medium mb-1">✅ 待跟进 ({digest.todoItems.length})</div>
          <ul className="space-y-0.5">
            {digest.todoItems.map((item, i) => (
              <li key={i} className="text-xs text-gray-700 leading-relaxed">· {item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 底部：自然语言总结 */}
      <div className="px-3 py-2 bg-indigo-50 border-t border-indigo-100">
        <div className="text-xs text-gray-700 leading-relaxed">{digest.summary}</div>
        <div className="text-[10px] text-gray-400 mt-1">生成于 {genTimeStr}</div>
      </div>
    </div>
  )
}

/**
 * 跨信息关联卡片（DG-09）
 * - 展示碎片间的关联发现
 * - 顶部：时间范围 + 总数
 * - 关联组列表：每个标签关联组展示图标 + 标签 + 数量 + 建议行动 + 样本碎片
 * - 空状态：无关联时展示提示
 */
function ConnectionsCard({ connections }: { connections: ConnectionsData }) {
  // 空状态
  if (connections.connections.length === 0) {
    return (
      <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-3 bg-gradient-to-r from-gray-50 to-gray-100 text-center">
          <div className="text-2xl mb-1">🔍</div>
          <div className="text-sm text-gray-600">{connections.summary}</div>
          <div className="text-[10px] text-gray-400 mt-1">
            最近 {connections.days} 天 · {connections.totalCount} 条碎片
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：时间范围 + 关联组数 */}
      <div className="px-3 py-2 bg-gradient-to-r from-primary-50 to-accent-50 border-b border-primary-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🔍</span>
            <span className="text-sm font-medium text-gray-800">跨信息关联</span>
            <span className="text-xs text-gray-400">最近 {connections.days} 天</span>
          </div>
          <span className="text-[10px] text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">
            {connections.connections.length} 组关联
          </span>
        </div>
      </div>

      {/* 关联组列表 */}
      <div className="divide-y divide-gray-50">
        {connections.connections.map((group, i) => (
          <div key={i} className="px-3 py-2.5 hover:bg-gray-50">
            {/* 标签头部 */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm">{group.icon}</span>
              <span className="text-xs font-medium text-gray-800">#{group.tag}</span>
              <span className="text-[10px] text-gray-400">{group.count} 条碎片</span>
            </div>

            {/* 建议行动 */}
            <div className="text-xs text-violet-600 bg-violet-50 px-2 py-1 rounded mb-1.5">
              💡 {group.suggestedAction}
            </div>

            {/* 样本碎片 */}
            <div className="space-y-1">
              {group.samples.map((s) => {
                const meta = fragmentKindMeta[s.kind] || fragmentKindMeta.note
                return (
                  <div key={s.id} className="flex items-start gap-1.5 pl-2">
                    <span className={`text-[10px] px-1 py-0.5 rounded ${meta.color} ${meta.bg} flex-shrink-0`}>
                      {meta.label}
                    </span>
                    <div className="text-xs text-gray-600 leading-snug flex-1 min-w-0">
                      {s.content}
                    </div>
                  </div>
                )
              })}
              {group.count > group.samples.length && (
                <div className="text-[10px] text-gray-400 pl-2">
                  ...还有 {group.count - group.samples.length} 条
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 底部：总结 */}
      <div className="px-3 py-2 bg-violet-50 border-t border-violet-100">
        <div className="text-xs text-gray-700 leading-relaxed">{connections.summary}</div>
        <div className="text-[10px] text-gray-400 mt-1">
          共 {connections.totalCount} 条碎片参与分析
        </div>
      </div>
    </div>
  )
}

/**
 * 跨模块洞察卡片（DG-09 进阶）
 * - 展示碎片↔任务/账单的未闭环信号
 * - 4 类信号：待办未转化 / 灵感搁置 / 金额未入账 / 任务有相关思考
 * - 每条信号含 content + suggestion，引导用户行动
 */
function InsightsCard({ insights }: { insights: InsightsData }) {
  const { signals, summary, days, totalCount, signalCount } = insights

  // 空状态
  if (signalCount === 0) {
    return (
      <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-3 bg-gradient-to-r from-gray-50 to-gray-100 text-center">
          <div className="text-2xl mb-1">✨</div>
          <div className="text-sm text-gray-600">{summary}</div>
          <div className="text-[10px] text-gray-400 mt-1">
            最近 {days} 天 · {totalCount} 条碎片
          </div>
        </div>
      </div>
    )
  }

  const signalMeta = [
    {
      key: 'orphanTodos' as const,
      label: '待办未转化',
      emoji: '📋',
      items: signals.orphanTodos,
      bg: 'bg-amber-50 border-amber-100',
    },
    {
      key: 'unactedIdeas' as const,
      label: '灵感搁置',
      emoji: '💡',
      items: signals.unactedIdeas,
      bg: 'bg-purple-50 border-purple-100',
    },
    {
      key: 'financeMentions' as const,
      label: '金额未入账',
      emoji: '💰',
      items: signals.financeMentions,
      bg: 'bg-rose-50 border-rose-100',
    },
    {
      key: 'taskEchoes' as const,
      label: '任务有相关思考',
      emoji: '🔄',
      items: signals.taskEchoes,
      bg: 'bg-blue-50 border-blue-100',
    },
  ]

  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：标题 + 信号数 */}
      <div className="px-3 py-2 bg-gradient-to-r from-primary-50 to-accent-50 border-b border-primary-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🔎</span>
            <span className="text-sm font-medium text-gray-800">跨模块洞察</span>
            <span className="text-xs text-gray-400">最近 {days} 天</span>
          </div>
          <span className="text-[10px] text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">
            {signalCount} 个信号
          </span>
        </div>
      </div>

      {/* 信号列表 */}
      <div className="divide-y divide-gray-50">
        {signalMeta.map((meta) => {
          if (meta.items.length === 0) return null
          return (
            <div key={meta.key} className="px-3 py-2.5">
              {/* 信号标题 */}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm">{meta.emoji}</span>
                <span className="text-xs font-medium text-gray-800">{meta.label}</span>
                <span className="text-[10px] text-gray-400">{meta.items.length} 项</span>
              </div>

              {/* 信号样本 */}
              <div className="space-y-1.5">
                {meta.key === 'taskEchoes' ? (
                  (meta.items as InsightTaskEcho[]).map((echo, i) => (
                    <div key={i} className={`rounded-lg border ${meta.bg} px-2 py-1.5`}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs text-gray-700 font-medium truncate">
                          {echo.taskTitle}
                        </span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {echo.echoCount} 条碎片
                        </span>
                      </div>
                      {echo.samples.map((s) => (
                        <div key={s.fragmentId} className="pl-2 border-l border-gray-200 mt-1">
                          <div className="text-xs text-gray-600 leading-snug">{s.content}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{s.suggestion}</div>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  (meta.items as InsightSample[]).map((s) => (
                    <div key={s.fragmentId} className={`rounded-lg border ${meta.bg} px-2 py-1.5`}>
                      <div className="text-xs text-gray-700 leading-snug">{s.content}</div>
                      <div className="text-[10px] text-gray-500 mt-1">{s.suggestion}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部：总结 */}
      <div className="px-3 py-2 bg-violet-50 border-t border-violet-100">
        <div className="text-xs text-gray-700 leading-relaxed">{summary}</div>
      </div>
    </div>
  )
}

/**
 * 智能准备卡片（EV-04）
 * - 为重要事件自动生成准备清单
 * - 顶部：事件数量 + 总准备事项数
 * - 事件列表：每个事件展示标题、倒计时、优先级、准备清单
 * - 紧迫事件高亮（24小时内红色，2天内橙色）
 * - 空状态：无重要事件时展示鼓励信息
 */
function PreparationCard({ preparation }: { preparation: PreparationData }) {
  // 空状态
  if (preparation.events.length === 0) {
    return (
      <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-3 bg-gradient-to-r from-gray-50 to-gray-100 text-center">
          <div className="text-2xl mb-1">✨</div>
          <div className="text-sm text-gray-600">{preparation.summary}</div>
        </div>
      </div>
    )
  }

  // 倒计时配色：0-1天=红色，2天=橙色，3天=蓝色
  const getUrgencyClass = (daysLeft: number): string => {
    if (daysLeft <= 1) return 'text-red-600 bg-red-50 border-red-100'
    if (daysLeft <= 2) return 'text-orange-600 bg-orange-50 border-orange-100'
    return 'text-blue-600 bg-blue-50 border-blue-100'
  }

  const getUrgencyLabel = (daysLeft: number): string => {
    if (daysLeft === 0) return '今天'
    if (daysLeft === 1) return '明天'
    return `${daysLeft} 天后`
  }

  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：标题 + 统计 */}
      <div className="px-3 py-2 bg-gradient-to-r from-rose-50 to-orange-50 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🎯</span>
            <span className="text-sm font-medium text-gray-800">智能准备</span>
          </div>
          <span className="text-[10px] text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full">
            {preparation.events.length} 事件 · {preparation.totalChecklistItems} 事项
          </span>
        </div>
      </div>

      {/* 事件列表 */}
      <div className="divide-y divide-gray-50">
        {preparation.events.map((event) => (
          <div key={event.taskId} className="px-3 py-2.5">
            {/* 事件头部 */}
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {event.important && <span className="text-xs">⭐</span>}
                  <span className="text-sm font-medium text-gray-800 truncate">{event.title}</span>
                </div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getUrgencyClass(event.daysLeft)}`}>
                {getUrgencyLabel(event.daysLeft)}
              </span>
            </div>

            {/* 准备清单 */}
            <div className="space-y-1">
              {event.checklist.map((item, i) => (
                <div key={i} className="flex items-start gap-1.5 pl-2">
                  <span className="text-[10px] text-gray-400 mt-0.5">{i + 1}.</span>
                  <div className={`text-xs leading-snug ${item.optional ? 'text-gray-400' : 'text-gray-700'}`}>
                    {item.text}
                    {item.optional && <span className="text-[10px] text-gray-400 ml-1">(可选)</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 底部：总结 */}
      <div className="px-3 py-2 bg-rose-50 border-t border-rose-100">
        <div className="text-xs text-gray-700 leading-relaxed">{preparation.summary}</div>
      </div>
    </div>
  )
}

/** P2 办公文档下载：axios blob（带认证）→ 前端触发保存
 * 注意：api 拦截器直接返回 response.data，blob 请求的返回值就是 Blob 本身
 */
export async function downloadOfficeDoc(docId: string, format: 'md' | 'txt' = 'md', title?: string) {
  const blob = (await api.get(`/chat/office-docs/${docId}/download`, {
    params: { format },
    responseType: 'blob',
    timeout: 30000,
  })) as unknown as Blob
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeName = (title || '文档').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 40)
  a.download = `${safeName}.${format}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * DG-02 图片压缩：使用 Canvas 将图片缩放至最大边长并输出 JPEG data URL
 * - maxSize：最大边长（px）
 * - quality：JPEG 质量 0-1
 */
function compressImage(file: File, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width)
            width = maxSize
          } else {
            width = Math.round((width * maxSize) / height)
            height = maxSize
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 上下文不可用'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(reader.error || new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

/** 格式化文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * DG-16 危机干预卡片
 *
 * 设计原则：
 * - 醒目红色边框，立即吸引用户注意
 * - 突出热线号码，支持 tel: 直接拨号
 * - 不分析、不评价用户情绪，只引导到专业资源
 * - 移动端友好：大按钮、清晰的层级
 */
function CrisisCard({ crisis }: { crisis: CrisisData }) {
  const levelMeta = {
    critical: { label: '紧急干预', bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', badge: 'bg-red-500' },
    high: { label: '高度关注', bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700', badge: 'bg-orange-500' },
    moderate: { label: '关怀提示', bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'bg-amber-500' },
  }
  const meta = levelMeta[crisis.level]

  return (
    <div className={`mt-2 rounded-xl border-2 ${meta.border} ${meta.bg} overflow-hidden`}>
      {/* 头部：等级标识 */}
      <div className={`px-3 py-2 ${meta.badge} text-white flex items-center gap-2`}>
        <span className="text-base">🆘</span>
        <span className="text-sm font-medium">危机干预 · {meta.label}</span>
      </div>

      <div className="p-3 space-y-3">
        {/* 暖心文案 */}
        <div className={`text-sm ${meta.text} leading-relaxed font-medium`}>
          {crisis.message}
        </div>

        {/* 热线列表 */}
        <div className="space-y-2">
          <div className="text-xs text-gray-500 font-medium">紧急援助热线（24 小时）</div>
          {crisis.hotlines.map((h) => (
            <a
              key={h.phone}
              href={`tel:${h.phone.replace(/[^0-9+-]/g, '')}`}
              className="block bg-white rounded-lg border border-gray-200 p-2.5 hover:border-primary-400 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800">{h.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{h.desc}</div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-base font-mono font-bold text-primary-600">{h.phone}</div>
                  <div className="text-[10px] text-primary-500">点击拨号 →</div>
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* 建议行动 */}
        {crisis.suggestions.length > 0 && (
          <div className="bg-white/60 rounded-lg p-2.5">
            <div className="text-xs text-gray-500 font-medium mb-1.5">建议行动</div>
            <ul className="space-y-1">
              {crisis.suggestions.map((s, i) => (
                <li key={i} className="text-xs text-gray-700 leading-relaxed flex items-start gap-1.5">
                  <span className="text-primary-500 mt-0.5">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 底部提示 */}
        <div className="text-[10px] text-gray-400 text-center pt-1 border-t border-gray-100">
          你不是一个人 · 任何时候都可以寻求帮助
        </div>
      </div>
    </div>
  )
}

/**
 * v4: 统一任务交互卡片（UnifiedTaskCard）
 *
 * 合并了「选项卡」和「创建结果卡」两种状态，用户从提到事项到创建完成
 * 全程使用同一个交互组件，体验统一。
 *
 * 两种状态：
 * - 选项状态（options 有值）：用户选择时间/提醒/优先级 → 确认创建
 * - 结果状态（actionResult 有值）：展示已创建的任务详情和提醒信息
 *
 * 支持预选：当用户已提供部分信息（如"明天下午3点开会"），后端会
 * 返回 preSelectedTime，前端自动选中对应时间槽，用户可直接确认。
 */
function UnifiedTaskCard({
  options,
  actionResult,
  onQuickReply,
}: {
  options?: TaskOptionsData
  actionResult?: {
    task: {
      id: string
      title: string
      priority: string
      category: string
      dueDate: string | null
    }
    reminder: {
      id: string
      remindAt: string
      reminderMinutes: number
    } | null
  }
  onQuickReply?: (text: string) => void
}) {
  // ============ 结果状态：展示已创建任务 ============
  if (actionResult) {
    return <TaskResultView actionResult={actionResult} />
  }

  // ============ 选项状态：交互选择 ============
  if (options) {
    return (
      <TaskSelectionView
        options={options}
        onQuickReply={onQuickReply}
      />
    )
  }

  return null
}

/**
 * 任务创建结果视图（UnifiedTaskCard 子组件）
 * 展示已创建的任务标题、优先级、截止时间和提醒信息。
 */
function TaskResultView({ actionResult }: {
  actionResult: {
    task: {
      id: string
      title: string
      priority: string
      category: string
      dueDate: string | null
    }
    reminder: {
      id: string
      remindAt: string
      reminderMinutes: number
    } | null
  }
}) {
  const { task, reminder } = actionResult
  const pMeta = priorityMeta[task.priority] || priorityMeta.medium

  const dueDateStr = task.dueDate
    ? new Date(task.dueDate).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '全天'

  const reminderStr = reminder
    ? new Date(reminder.remindAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-green-200 overflow-hidden">
      <div className="px-3 py-2 bg-green-50 text-green-700 text-xs font-medium flex items-center gap-1.5">
        <Check size={14} />
        <span>已创建待办</span>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-800">{task.title}</div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
              <span className={`px-1.5 py-0.5 rounded ${pMeta.bg} ${pMeta.color} font-medium`}>
                {pMeta.label}
              </span>
              <span>{dueDateStr}</span>
            </div>
          </div>
        </div>
        {reminder && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1.5">
            <span>⏰</span>
            <span>提前 {reminder.reminderMinutes} 分钟提醒（{reminderStr}）</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** 优先级颜色映射 */
const PRIORITY_COLOR_MAP: Record<string, { selected: string; idle: string }> = {
  blue: {
    selected: 'border-primary-400 bg-primary-50 text-primary-700 ring-1 ring-primary-200',
    idle: 'border-gray-200 text-gray-600 hover:border-primary-300 hover:bg-primary-50',
  },
  amber: {
    selected: 'border-amber-400 bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    idle: 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50',
  },
  red: {
    selected: 'border-red-400 bg-red-50 text-red-700 ring-1 ring-red-200',
    idle: 'border-gray-200 text-gray-600 hover:border-red-300 hover:bg-red-50',
  },
}

/**
 * 任务选项选择视图（UnifiedTaskCard 子组件）
 * 用户在此选择时间、提醒和优先级，点击确认后触发后端创建。
 */
function TaskSelectionView({
  options,
  onQuickReply,
}: {
  options: TaskOptionsData
  onQuickReply?: (text: string) => void
}) {
  // 初始化状态：支持预选值（用户已提供时间/提醒时自动选中）
  const [selectedTime, setSelectedTime] = useState<string | null>(
    options.preSelectedTime || null
  )
  const [selectedReminder, setSelectedReminder] = useState(
    options.preSelectedReminder || '15'
  )
  const [selectedPriority, setSelectedPriority] = useState('medium')
  const [confirmed, setConfirmed] = useState(false)

  const handleConfirm = () => {
    if (!selectedTime || confirmed) return
    setConfirmed(true)

    const reminderLabel = selectedReminder === '0'
      ? '不用提醒'
      : `提前${selectedReminder}分钟`
    const priorityLabel = options.priorityOptions.find(p => p.value === selectedPriority)?.label || '普通'

    onQuickReply?.(`${selectedTime} ${reminderLabel} ${priorityLabel}`)
  }

  return (
    <div className={`mt-2 rounded-xl shadow-sm border overflow-hidden transition-opacity ${confirmed ? 'opacity-50 pointer-events-none' : 'border-primary-100'}`}>
      {/* 头部 */}
      <div className="px-3 py-2 bg-primary-50 text-primary-700 text-xs font-medium flex items-center gap-1.5">
        <Sparkles size={13} />
        <span>{options.title} · {options.dateLabel}</span>
        {options.period && (
          <span className="text-primary-400">· {options.period}</span>
        )}
      </div>

      <div className="p-3 bg-white space-y-3">
        {/* 步骤 1：时间选择（始终显示） */}
        <div>
          <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <span>🕐 选择时间</span>
            {selectedTime && <span className="text-primary-600 font-medium">· {selectedTime}</span>}
            {options.preSelectedTime && !confirmed && (
              <span className="text-xs text-primary-400">（已为你预选）</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {options.timeSlots.map((slot) => (
              <button
                key={slot.value}
                onClick={() => setSelectedTime(slot.value)}
                className={`text-sm py-1.5 rounded-lg border transition-all ${
                  selectedTime === slot.value
                    ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium ring-1 ring-primary-200'
                    : 'border-gray-200 text-gray-600 hover:border-primary-300 hover:bg-primary-50'
                }`}
              >
                {slot.label}
              </button>
            ))}
          </div>
        </div>

        {/* 步骤 2：提醒设置 + 优先级 + 确认（选好时间后才显示） */}
        {selectedTime && (
          <div className="space-y-3 pt-1 border-t border-gray-100" style={{ animation: 'fadeIn 0.3s ease-in' }}>
            {/* 提醒设置 */}
            <div>
              <div className="text-xs text-gray-500 mb-1.5">⏰ 提醒设置</div>
              <div className="flex flex-wrap gap-1.5">
                {options.reminderOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedReminder(opt.value)}
                    className={`text-xs flex items-center gap-1 py-1 px-2.5 rounded-lg border transition-all ${
                      selectedReminder === opt.value
                        ? 'border-amber-400 bg-amber-50 text-amber-700 font-medium ring-1 ring-amber-200'
                        : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50'
                    }`}
                  >
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 优先级 */}
            <div>
              <div className="text-xs text-gray-500 mb-1.5">📋 优先级</div>
              <div className="flex gap-1.5">
                {options.priorityOptions.map((opt) => {
                  const colors = PRIORITY_COLOR_MAP[opt.color] || PRIORITY_COLOR_MAP.blue
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setSelectedPriority(opt.value)}
                      className={`text-xs flex items-center gap-1 py-1 px-2.5 rounded-lg border transition-all ${
                        selectedPriority === opt.value ? colors.selected : colors.idle
                      }`}
                    >
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 确认按钮 */}
            <button
              onClick={handleConfirm}
              disabled={confirmed}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                !confirmed
                  ? 'bg-primary-500 text-white hover:bg-primary-600 active:scale-[0.98] shadow-sm'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {confirmed ? (
                <>
                  <Check size={15} />
                  <span>已提交</span>
                </>
              ) : (
                <>
                  <Check size={15} />
                  <span>确认创建</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
