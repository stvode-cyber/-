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
import { useVoiceRecording } from './chat/useVoiceRecording'


// === 拆分后：类型 + 子组件从外部文件 import ===
import type { Message, TaskItem, ChatSessionItem, MessageMetadata, HandoverPendingItem } from '../components/chat/chatTypes'
import { MsgAvatar, TaskCard, BillCard, DietCard, HandoverCard, ScheduleCard, FragmentCard, DigestCard, ConnectionsCard, InsightsCard, PreparationCard, CrisisCard, UnifiedTaskCard, TaskResultView, TaskSelectionView, compressImage, formatFileSize } from '../components/chat/ChatWidgets'
import { MessageBubble } from '../components/chat/MessageBubble'

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
  // DG-10 录音状态：用 useVoiceRecording hook 统一管理（2026-10-17 抽离）
  const { recState, recElapsed, toggleRecording } = useVoiceRecording(
    (msg, type) => toast(msg, type as never),
    (msg) => setMessages((prev) => [...prev, msg]),
  )
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
            className={`p-2.5 text-white rounded-2xl disabled:opacity-40 hover:shadow-lg hover:shadow-primary-300/40 transition-all active:scale-90 ${!input.trim() || sending || recState !== 'idle' ? '' : 'bg-gradient-accent'}`}
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
