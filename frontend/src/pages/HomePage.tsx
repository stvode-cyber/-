import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, Search, Plus, ChevronRight, RefreshCw, MapPin, Users, EyeOff, BookOpen, Timer, Flame, Smile, BarChart3, Droplets, Scale, Dumbbell, Sparkles, Loader2, Send, ListTodo } from 'lucide-react'
import { isDesktop } from '../hooks/useIsDesktop'
import { getTodayLunarInfo } from '../lib/lunar'
import { getTodayProgress } from '../lib/habitStore'
import { todayStr } from '../lib/moodStore'
import { getTodayStat } from '../lib/pomodoroStore'
import { getStatsInRange } from '../lib/novelStore'
import { getWaterStat } from '../lib/waterStore'
import { getWeightStat } from '../lib/weightStore'
import { getExerciseStat } from '../lib/exerciseStore'
import { api, unwrap } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import {
  formatTime, formatMoney, daysLeft, priorityMeta,
} from '../lib/utils'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState } from '../components/StateView'
import { useConfirm } from '../components/ConfirmDialog'
import LiveCountdown from '../components/LiveCountdown'
import { useWeather, getWeatherImage } from '../hooks/useWeather'
import {
  eventScopeMeta, EVENT_SCOPES, manualEventColorMeta, MANUAL_EVENT_COLORS,
} from '../lib/constants'

interface HomeTaskItem {
  id: string
  title: string
  priority: string
  status: string
  dueDate?: string | null
  important?: boolean
  category?: string
}

interface HomeReminderItem {
  id: string
  title: string
  remindAt: string
  level?: string
  done: boolean
}

interface HomeData {
  date: string
  greeting: string
  /** DG-12 场景化问候：按时段+当日数据生成的个性化问候 */
  sceneGreeting: {
    title: string
    subtitle: string
    tip: string
  }
  energy: number
  mood: string
  todayTip: string
  countdowns: { id: string; title: string; targetDate: string; days: number; icon: string }[]
  todayTasks: HomeTaskItem[]
  pendingTaskCount: number
  finance: { monthExpense: number; monthIncome: number; walletBalance: number }
  health: {
    todayMeals: number
    totalCalories: number
    suggestion: string
    // 昨晚睡眠数据（阶段二「睡眠分析」基础版）
    sleep: {
      durationMin: number
      quality?: number | null
      hint: string
    } | null
  }
  events: {
    id: string
    type: string
    title: string
    time: string
    priority?: string
    level?: string
    // 情境视角（EV-05）：work | life | finance
    scope: 'work' | 'life' | 'finance'
    // EV-06 事件手动管理：手动事件携带的扩展字段
    manual?: boolean
    important?: boolean
    location?: string | null
    attendees?: string[]
    color?: string
  }[]
  // 事件冲突（EV-02）：相邻事件间隔 < 15min 的冲突对
  conflicts: {
    a: { id: string; type: string; title: string; time: string }
    b: { id: string; type: string; title: string; time: string }
    gapMin: number
    suggestion: string
  }[]
  // DG-05 每日一问：基于当日数据的启发式问题
  dailyQuestion: {
    question: string
    hint: string
    action: string
  }
  /** DG-14 成就激励：今日进度 + 连续记录 + 徽章 */
  achievements: {
    todayProgress: { done: number; total: number; rate: number }
    streaks: { label: string; days: number; emoji: string }[]
    badges: { key: string; label: string; emoji: string; unlocked: boolean; hint: string }[]
    encouragement: string
  }
  reminders: HomeReminderItem[]
  handover: {
    draft: { id: string; title: string; updatedAt: string } | null
    pendingItemCount: number
  }
}

/**
 * 主页 · 今日全景
 *
 * 页面结构（自上而下）：
 * 1. 顶部状态栏（日常模式 / 通知 / 设置）
 * 2. 用户问候卡片
 * 3. 跨模块快捷入口（6 个圆形图标，交接工作点）
 * 4. 今日全景卡（精力 + 心情 + AI 提示）
 * 5. 倒计时（最近 3 个未完成任务）
 * 6. 今日待办（最多 5 条 + "添加任务"入口）
 * 7. 财务速览（本月支出/收入/钱包余额）
 * 8. 健康摘要（餐数/热量/建议）
 * 9. 事件总汇（今日待办 + 提醒按时间排序）
 *
 * 数据来源：GET /home/today
 */
export default function HomePage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const [data, setData] = useState<HomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // EV-05 情境视角切换：all | work | life | finance
  const [scope, setScope] = useState<'all' | 'work' | 'life' | 'finance'>('all')
  // EV-06 添加事件弹层
  const [showAddEvent, setShowAddEvent] = useState(false)
  // EV-06 隐藏事件中的操作中事件 id（防止重复点击）
  const [hidingId, setHidingId] = useState<string | null>(null)
  // EV-03 事件详情弹层（null=关闭；非 null=当前查看的事件）
  const [detailEvent, setDetailEvent] = useState<HomeData['events'][number] | null>(null)
  // DG-05 每日一问
  const [dailyQuestion, setDailyQuestion] = useState<{ question: string; topic: string; hint: string | null; date: string } | null>(null)
  const [dailyQuestionLoading, setDailyQuestionLoading] = useState(false)
  // DG-13 状态感知互动（疲劳/压力关怀）
  const [wellness, setWellness] = useState<{
    needCare: boolean
    level: 'gentle' | 'suggest' | 'urgent'
    title: string
    message: string
    suggestions: Array<{ label: string; desc: string; to?: string; emoji: string }>
    signals: string[]
  } | null>(null)
  // DG-13 用户已关闭关怀卡片（本次会话内不再显示）
  const [wellnessDismissed, setWellnessDismissed] = useState(false)
  // 随手记快速输入（AI 自动分类）
  const [quickNote, setQuickNote] = useState('')
  const [quickSubmitting, setQuickSubmitting] = useState(false)
  const quickNoteRef = useRef<HTMLTextAreaElement>(null)

  /**
   * Deep link 唤起：检测 URL ?quick=1 参数
   * - 主屏小部件点击 → App.tsx 监听 appUrlOpen 事件 → navigate('/?quick=1')
   * - HomePage 检测到 quick=1 → 滚动到随手记卡片并自动聚焦输入框
   * - 仅触发一次（聚焦后清除 URL 参数，避免重复触发）
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('quick') === '1') {
      // 延迟 300ms 等待页面渲染完成
      const timer = setTimeout(() => {
        quickNoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        quickNoteRef.current?.focus()
        // 清除 URL 参数，避免刷新或后退重复触发
        const url = new URL(window.location.href)
        url.searchParams.delete('quick')
        window.history.replaceState({}, '', url.toString())
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [])
  // DG-15 迷茫期引导
  const [confusion, setConfusion] = useState<{
    needGuide: boolean
    level: 'light' | 'moderate' | 'deep'
    title: string
    message: string
    guideActions: Array<{ label: string; desc: string; to?: string; emoji: string }>
    signals: string[]
  } | null>(null)
  // DG-15 用户已关闭引导卡片（本次会话内不再显示）
  const [confusionDismissed, setConfusionDismissed] = useState(false)
  // 倒计时卡片（独立加载，失败不阻塞主页；展示最多 3 条，按优先级排序）
  const [countdownCards, setCountdownCards] = useState<{
    id: string
    type: string
    title: string
    targetDate: string | null
    recurringConfig: { nextTrigger?: string; pattern?: string; countdownStartAt?: string } | null
    remainingDays: number | null
    remainingHours: number | null
    isPinned: boolean
    isImportant: boolean
    progress: number
    status: string
  }[]>([])

  /** 随手记提交：调用后端 /fragment/quick，AI 自动分类 */
  const submitQuickNote = async () => {
    const content = quickNote.trim()
    if (!content) {
      toast('请输入内容', 'error')
      return
    }
    if (quickSubmitting) return
    setQuickSubmitting(true)
    try {
      const result = await unwrap<{ kind: string; tags: string[]; note: string | null; classifySource: 'ai' | 'rule' }>(
        api.post('/fragment/quick', { content }),
      )
      const kindLabelMap: Record<string, string> = {
        note: '笔记', link: '链接', todo: '待办', idea: '灵感', snippet: '代码',
      }
      const kindLabel = kindLabelMap[result.kind] || result.kind
      const sourceLabel = result.classifySource === 'ai' ? 'AI 分类' : '智能分类'
      toast(`${sourceLabel}：${kindLabel}${result.note ? ' · ' + result.note : ''}`, 'success', 3000)
      setQuickNote('')
    } catch (err) {
      toast(`保存失败：${(err as Error).message}`, 'error')
    } finally {
      setQuickSubmitting(false)
    }
  }

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      // DG-05/DG-13/DG-15 与 home/today 并行加载（不阻塞主数据）
      const [res] = await Promise.all([
        unwrap<HomeData>(api.get('/home/today')),
        // 每日一问失败不阻塞主页加载
        (async () => {
          try {
            const dq = await unwrap<{ question: string; topic: string; hint: string | null; date: string }>(
              api.get('/home/daily-question')
            )
            setDailyQuestion(dq)
          } catch {
            // 静默失败：每日一问不是核心功能
          }
        })(),
        // DG-13 状态感知：失败不阻塞主页
        (async () => {
          try {
            const w = await unwrap<{
              needCare: boolean
              level: 'gentle' | 'suggest' | 'urgent'
              title: string
              message: string
              suggestions: Array<{ label: string; desc: string; to?: string; emoji: string }>
              signals: string[]
            }>(api.get('/home/wellness-check'))
            setWellness(w)
            setWellnessDismissed(false)
          } catch {
            // 静默失败
          }
        })(),
        // DG-15 迷茫期引导：失败不阻塞主页
        (async () => {
          try {
            const c = await unwrap<{
              needGuide: boolean
              level: 'light' | 'moderate' | 'deep'
              title: string
              message: string
              guideActions: Array<{ label: string; desc: string; to?: string; emoji: string }>
              signals: string[]
            }>(api.get('/home/confusion-check'))
            setConfusion(c)
            setConfusionDismissed(false)
          } catch {
            // 静默失败
          }
        })(),
        // 倒计时卡片：失败不阻塞主页
        (async () => {
          try {
            const cd = await unwrap<{ items: Array<{
              id: string
              type: string
              title: string
              targetDate: string | null
              recurringConfig: { nextTrigger?: string; pattern?: string; countdownStartAt?: string } | null
              remainingDays: number | null
              remainingHours: number | null
              isPinned: boolean
              isImportant: boolean
              progress: number
              status: string
            }> }>(api.get('/countdowns?status=active'))
            // 优先级排序：重要 > 置顶 > 截止日期近 > 创建时间（后端已按此排序，前端再保险）
            const getTargetTime = (c: { targetDate: string | null; recurringConfig: { nextTrigger?: string; countdownStartAt?: string } | null }) =>
              c.targetDate || c.recurringConfig?.nextTrigger
            const sorted = [...(cd.items || [])].sort((a, b) => {
              if (a.isImportant !== b.isImportant) return a.isImportant ? -1 : 1
              if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
              const aTime = getTargetTime(a) ? new Date(getTargetTime(a)!).getTime() : Number.MAX_SAFE_INTEGER
              const bTime = getTargetTime(b) ? new Date(getTargetTime(b)!).getTime() : Number.MAX_SAFE_INTEGER
              return aTime - bTime
            })
            setCountdownCards(sorted.slice(0, 3))
          } catch {
            // 静默失败
          }
        })(),
      ])
      setData(res)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /**
   * DG-05 单独刷新每日一问（用户点击"换一题"时）
   * 注意：因问题由日期决定，"换一题"实际是从问题池中随机抽一道同主题的备选问题
   */
  const refreshDailyQuestion = async () => {
    setDailyQuestionLoading(true)
    try {
      const res = await unwrap<{ question: string; topic: string; hint: string | null; date: string }>(
        api.get('/home/daily-question')
      )
      setDailyQuestion(res)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setDailyQuestionLoading(false)
    }
  }

  /**
   * EV-06 隐藏事件
   * - 手动事件（type=manual）：PATCH /manual-events/:id 设置 hidden=true
   * - 自动事件（type=task/reminder 等）：POST /manual-events/hidden-auto 记录到 HiddenEvent
   */
  const hideEvent = async (ev: HomeData['events'][number]) => {
    const ok = await confirm({
      title: '隐藏事件',
      message: `将从事件总览中隐藏「${ev.title}」，可在事件管理页恢复。`,
      confirmText: '隐藏',
      danger: true,
    })
    if (!ok) return
    setHidingId(`${ev.type}-${ev.id}`)
    try {
      if (ev.type === 'manual') {
        await unwrap(api.patch(`/manual-events/${ev.id}`, { hidden: true }))
      } else {
        await unwrap(api.post('/manual-events/hidden-auto', {
          sourceType: ev.type,
          sourceId: ev.id,
        }))
      }
      toast('已隐藏', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setHidingId(null)
    }
  }

  /**
   * EV-03 打开事件详情弹层
   * 由事件项点击触发，查询 GET /manual-events/:id/detail?type=...
   */
  const openDetail = (ev: HomeData['events'][number]) => {
    setDetailEvent(ev)
  }

  useEffect(() => {
    load()
  }, [])

  const today = new Date()
  const weekDay = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()]
  const lunarInfo = getTodayLunarInfo()

  // 天气数据（横幅背景 + 右侧信息小卡）
  const { weather, loading: weatherLoading } = useWeather()
  const weatherImg = weather
    ? getWeatherImage(weather.current.weatherCode, weather.current.isDay)
    : '/weather-bg/sunny.jpg'

  return (
    <div className="app-shell pb-4">
      {/* 日常模式区域 - 实时天气横幅：真实天气景图（按天气/昼夜切换），白渐变过渡到内容区（底部大圆角，与下方卡片形成呼吸感） */}
      <div className="sticky top-0 z-30 text-slate-800 relative overflow-hidden rounded-b-[28px] shadow-lg shadow-slate-300/40" style={{ background: 'linear-gradient(160deg, #FFFFFF 0%, #F4F5F7 100%)' }}>
        {/* 实时天气景图层：真实照片原色全幅显示，随天气/昼夜自动切换 */}
        <div
          className="absolute inset-0 bg-cover bg-center transition-all duration-700"
          style={{ backgroundImage: `url(${weatherImg})`, filter: 'brightness(1.05) saturate(1.05)' }}
        />
        {/* 顶部深色渐晕：保证顶栏白字在照片上可读 */}
        <div className="absolute inset-x-0 top-0 h-24 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(15,23,42,0.38) 0%, rgba(15,23,42,0) 100%)' }} />
        {/* 底部白色渐变：照片自然过渡到白色内容区，深色文字可读 */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0) 26%, rgba(255,255,255,0.62) 52%, rgba(255,255,255,0.96) 100%)' }} />
        {/* 气泡装饰层：白色半透明圆点 */}
        <div className="absolute w-[200px] h-[200px] rounded-full bg-white/20 -top-20 -right-12 pointer-events-none" />
        <div className="absolute w-[120px] h-[120px] rounded-full bg-white/15 -bottom-12 -left-8 pointer-events-none" />
        <div className="absolute w-10 h-10 rounded-full bg-white/20 top-24 left-1/3 pointer-events-none" />
        <div className="relative flex items-center justify-between h-11 px-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse shadow-sm" />
            <span className="text-white font-medium drop-shadow-sm">日常模式</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/search')} aria-label="搜索" className="hover:bg-white/25 rounded-full p-1.5 transition-colors">
              <Search size={18} className="text-white drop-shadow-sm" />
            </button>
            <button
              onClick={load}
              className="relative hover:bg-white/25 rounded-full p-1.5 transition-colors"
              aria-label="刷新"
              disabled={loading}
            >
              <RefreshCw size={18} className={`text-white drop-shadow-sm ${loading ? 'animate-spin' : ''}`} />
            </button>
            <Link to="/tasks?view=reminders" className="relative hover:bg-white/25 rounded-full p-1.5 transition-colors">
              <Bell size={18} className="text-white drop-shadow-sm" />
              {data && data.events.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {data.events.length}
                </span>
              )}
            </Link>
          </div>
        </div>
        <div className="relative px-4 pb-6">
          <div className="flex items-center gap-3">
            {/* 桌面端顶栏已有小头像+下拉菜单，此处大头像仅移动端显示，避免重复 */}
            {!isDesktop() && (
              <button
                onClick={() => navigate('/profile')}
                className="relative w-16 h-16 flex-shrink-0 active:scale-95 transition-transform"
                title="我的"
                aria-label="我的页面"
              >
                {/* 白底头像+白描边，磨砂玻璃感浮于天气照片上（IDLE 轻呼吸） */}
                <span className="absolute inset-0 rounded-full overflow-hidden bg-white/65 backdrop-blur-sm border-[3px] border-white shadow-lg shadow-primary-500/25 flex items-center justify-center text-2xl animate-[heroBreathe_3.2s_ease-in-out_infinite]">
                  {user?.avatar && (user.avatar.startsWith('data:image') || user.avatar.startsWith('http') || user.avatar.startsWith('/')) ? (
                    <img src={user.avatar} alt="头像" className="w-full h-full object-cover" />
                  ) : (
                    <span>{user?.avatar || '👤'}</span>
                  )}
                </span>
                {/* 在线状态脉冲点（薄荷绿+白描边） */}
                <span className="absolute right-0.5 bottom-0.5 w-[15px] h-[15px] rounded-full bg-primary-400 border-[2.5px] border-white animate-[statusPulse_2.4s_infinite]" />
              </button>
            )}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              {/* DG-12 场景化问候：title 主问候 + subtitle 次级信息（不截断，完整显示） */}
              <div className="font-bold leading-snug text-[17px] text-slate-900 drop-shadow-sm">
                {data?.sceneGreeting?.title || data?.greeting || '你好'}，{user?.nickname || user?.username}
                {user?.levelInfo && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] bg-white/80 text-slate-700 px-1.5 py-0.5 rounded-full font-normal align-middle">
                    {user.levelInfo.icon} Lv{user.levelInfo.level}
                  </span>
                )}
              </div>
              {/* 副问候 + 日期农历生肖星座合并，自动换行完整显示 */}
              <div className="text-[11px] leading-relaxed text-slate-700">
                {data?.sceneGreeting?.subtitle && <>{data.sceneGreeting.subtitle} · </>}
                {lunarInfo.gregorian} {lunarInfo.lunarShort} · {lunarInfo.zodiacYear} · {lunarInfo.constellation.emoji}{lunarInfo.constellation.name}
                {lunarInfo.festival && <span className="ml-1">🎉{lunarInfo.festival}</span>}
              </div>
              {/* 宜忌双 chip（信息密度最高的放最后） */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] leading-none text-slate-700 bg-white/80 border border-slate-200/60 px-2 py-1 rounded-full">
                  宜 {lunarInfo.yi.slice(0, 2).join(' ')}
                </span>
                <span className="text-[10px] leading-none text-red-600 bg-white/80 border border-red-200/60 px-2 py-1 rounded-full">
                  忌 {lunarInfo.ji.slice(0, 2).join(' ')}
                </span>
              </div>
            </div>
            {/* 天气信息（右侧半透明小卡） */}
            {weather && !weatherLoading && (
              <div className="flex-shrink-0 self-center bg-white/70 backdrop-blur-md border border-white/90 rounded-2xl px-2.5 py-1.5 flex flex-col items-center gap-0.5">
                <div className="text-xl leading-none">{weather.current.weatherIcon}</div>
                <div className="flex items-baseline">
                  <span className="text-lg font-thin tabular-nums leading-none text-slate-800">{weather.current.tempC}</span>
                  <span className="text-[10px] font-thin text-slate-800">°</span>
                </div>
                <div className="text-[9px] text-slate-600 leading-none">{weather.current.weatherDesc}</div>
                <div className="text-[9px] text-slate-500 leading-none tabular-nums">
                  {weather.today.minTempC}°/{weather.today.maxTempC}°
                </div>
              </div>
            )}
          </div>
          {/* DG-12 场景化问候：tip 场景化建议 */}
          {data?.sceneGreeting?.tip && (
            <div className="mt-3 bg-white/70 backdrop-blur rounded-2xl px-3 py-2 text-xs text-slate-700">
              💡 {data.sceneGreeting.tip}
            </div>
          )}
        </div>
      </div>

      {/* ★ 事件总汇（含倒计时）：横幅圆角下的第一张卡，今日事件+倒计时集中展示 */}
      {data && (data.events.length > 0 || countdownCards.length > 0) && (
      <div className="relative mx-3 mt-3 p-4 rounded-3xl bg-white border border-primary-100" style={{ boxShadow: '0 10px 30px rgba(148,163,184,.14)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-[30px] h-[30px] rounded-[11px] flex items-center justify-center text-white text-sm" style={{ background: 'linear-gradient(135deg, #334155, #1E293B)', boxShadow: '0 4px 12px rgba(30,41,59,.30)' }}>📅</span>
            <span className="text-[15px] font-bold text-primary-800">事件总汇</span>
            {data.conflicts.length > 0 && (
              <span className="badge bg-orange-100 text-orange-700 text-[10px]">
                {data.conflicts.length} 冲突
              </span>
            )}
            {data.events.filter((e) => e.manual).length > 0 && (
              <span className="badge bg-accent-100 text-accent-600 text-[10px]">
                {data.events.filter((e) => e.manual).length} 手动
              </span>
            )}
          </div>
          {/* EV-06 添加事件按钮 */}
          <button
            onClick={() => setShowAddEvent(true)}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-1 rounded-full hover:bg-primary-50 transition-colors"
          >
            <Plus size={14} />
            <span>添加事件</span>
          </button>
        </div>
        {/* EV-05 情境视角切换：all | work | life | finance */}
        {data.events.length > 0 && (
        <div className="mb-3 flex gap-1 bg-primary-50/50 p-1 rounded-2xl">
          {([
            { key: 'all', label: '全部' },
            ...EVENT_SCOPES.map((k) => ({ key: k, label: `${eventScopeMeta[k].emoji} ${eventScopeMeta[k].label}` })),
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setScope(tab.key)}
              className={`flex-1 py-1.5 text-xs rounded-xl transition-all ${
                scope === tab.key
                  ? 'bg-white text-primary-600 shadow-sm font-medium'
                  : 'text-gray-500 hover:text-primary-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        )}
        {/* 事件冲突提示（EV-02） */}
        {data.conflicts.length > 0 && (
          <div className="mb-3 space-y-2">
            {data.conflicts.map((c, i) => (
              <div
                key={`${c.a.id}-${c.b.id}-${i}`}
                className="bg-orange-50 border border-orange-100 rounded-lg p-2 text-xs"
              >
                <div className="flex items-center gap-1 text-orange-600 font-medium mb-1">
                  <span>⚠️</span>
                  <span>时间冲突 · 间隔 {c.gapMin} 分钟</span>
                </div>
                <div className="text-gray-600">
                  <span className="text-gray-400">{formatTime(c.a.time)}</span>
                  {' '}
                  {c.a.title}
                  <span className="text-gray-300 mx-1">→</span>
                  <span className="text-gray-400">{formatTime(c.b.time)}</span>
                  {' '}
                  {c.b.title}
                </div>
                <div className="text-orange-500 mt-1">{c.suggestion}</div>
              </div>
            ))}
          </div>
        )}
        {/* 倒计时并入总汇显示（CD-XX：最多 3 条，按优先级排序） */}
        {countdownCards.length > 0 && (
          <div className="mb-3 rounded-2xl bg-primary-50/40 border border-primary-100 p-2.5">
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span className="text-[11px] font-semibold text-primary-700 flex items-center gap-1">
                <span>⏰</span> 倒计时
              </span>
              <Link to="/countdowns" className="text-[10px] text-primary-600 flex items-center font-medium">
                全部 <ChevronRight size={11} />
              </Link>
            </div>
            <div className="space-y-0.5">
              {countdownCards.map((c) => {
                // 循环倒计时：用 nextTrigger 作为倒计时目标
                const countdownTarget = c.targetDate || c.recurringConfig?.nextTrigger || null

                // 检查是否在倒计时显示窗口内（countdownStartAt 设置时）
                const countdownStartAt = c.recurringConfig?.countdownStartAt
                let isWaiting = false
                if (countdownTarget && countdownStartAt && c.type === 'recurring') {
                  // 计算 nextTrigger 当天的开始时间
                  const triggerDate = new Date(countdownTarget)
                  const [sh, sm] = countdownStartAt.split(':').map(Number)
                  const startDatetime = new Date(triggerDate)
                  startDatetime.setHours(sh, sm, 0, 0)
                  // 当前时间 < 开始时间 → 等待状态
                  if (Date.now() < startDatetime.getTime()) {
                    isWaiting = true
                  }
                }

                // 根据剩余时间选择紧迫度配色
                let styleText = 'text-gray-600'
                let styleBg = 'bg-gray-50'
                if (countdownTarget && !isWaiting) {
                  const diff = new Date(countdownTarget).getTime() - Date.now()
                  if (diff <= 0) {
                    styleText = 'text-red-700'
                    styleBg = 'bg-red-100'
                  } else if (diff < 24 * 60 * 60 * 1000) {
                    styleText = 'text-red-600'
                    styleBg = 'bg-red-50'
                  } else if (diff <= 7 * 24 * 60 * 60 * 1000) {
                    styleText = 'text-amber-600'
                    styleBg = 'bg-amber-50'
                  }
                }
                if (isWaiting) {
                  styleText = 'text-gray-400'
                  styleBg = 'bg-gray-50'
                }
                const typeEmoji = c.type === 'recurring' ? '🔁' : c.type === 'important' ? '⭐' : c.type === 'goal' ? '🎯' : '⏰'
                return (
                  <Link
                    key={c.id}
                    to={`/countdowns/${c.id}`}
                    className="flex items-center justify-between py-1.5 px-2 -mx-2 rounded-lg hover:bg-primary-50/50 group transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{typeEmoji}</span>
                      <span className="text-sm text-gray-700 group-hover:text-primary-600 truncate">
                        {c.title}
                      </span>
                      {c.isImportant && <span className="text-xs">⭐</span>}
                      {c.isPinned && <span className="text-xs">📌</span>}
                    </div>
                    {isWaiting ? (
                      <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${styleText} ${styleBg} flex-shrink-0`}>
                        ⏸️ 等待 {countdownStartAt}
                      </span>
                    ) : countdownTarget ? (
                      <span className={`text-lg font-bold px-3 py-1 rounded-full ${styleText} ${styleBg} flex-shrink-0`}>
                        <LiveCountdown targetDate={countdownTarget} />
                      </span>
                    ) : (
                      <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${styleText} ${styleBg} flex-shrink-0`}>
                        🔁 循环中
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        )}
        {/* 事件时间线 */}
        {data.events.length > 0 && (
        <div className="space-y-3">
          {data.events
            .filter((ev) => scope === 'all' || ev.scope === scope)
            .map((ev) => {
              const isUrgent = ev.priority === 'urgent' || ev.level === 'urgent'
              // EV-06 手动事件使用 color 字段；自动事件按紧急度
              const scopeMeta = eventScopeMeta[ev.scope] || eventScopeMeta.life
              const dotColor = ev.manual
                ? (manualEventColorMeta[ev.color || 'blue']?.dot || 'bg-blue-400')
                : isUrgent
                  ? 'bg-red-500'
                  : ev.priority === 'high'
                    ? 'bg-orange-400'
                    : 'bg-blue-400'
              const isHiding = hidingId === `${ev.type}-${ev.id}`
              return (
                <div key={`${ev.type}-${ev.id}`} className="flex gap-3 group">
                  <div className="flex flex-col items-center">
                    <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                    <span className="w-px flex-1 bg-gray-100 mt-1" />
                  </div>
                  <div className="pb-2 flex-1">
                    <button
                      onClick={() => openDetail(ev)}
                      className="block w-full text-left"
                    >
                      <div className="text-xs text-gray-400 flex items-center gap-1">
                        {formatTime(ev.time)}
                        <span className="text-[10px]">{scopeMeta.emoji}</span>
                        {ev.manual && (
                          <span className="text-[10px] text-purple-500">手动</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-700 mt-0.5 flex items-start gap-1">
                        <span className="flex-1">{ev.title}</span>
                      </div>
                    </button>
                    <div className="flex items-start gap-1 mt-0.5">
                      {/* EV-06 隐藏事件按钮 */}
                      <button
                        onClick={() => hideEvent(ev)}
                        disabled={isHiding}
                        title="隐藏此事件"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <EyeOff size={14} />
                      </button>
                    </div>
                    {/* EV-06 手动事件扩展信息：地点 / 参与人物 */}
                    {ev.manual && (ev.location || (ev.attendees && ev.attendees.length > 0)) && (
                      <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-gray-500">
                        {ev.location && (
                          <span className="flex items-center gap-0.5">
                            <MapPin size={10} />
                            {ev.location}
                          </span>
                        )}
                        {ev.attendees && ev.attendees.length > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Users size={10} />
                            {ev.attendees.join('、')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          {/* 当前视角下无事件时提示 */}
          {data.events.filter((ev) => scope === 'all' || ev.scope === scope).length === 0 && (
            <div className="text-center text-xs text-gray-400 py-4">
              {scope === 'all' ? '今日暂无事件，点击右上角添加' : `当前视角暂无${
                scope === 'work' ? '工作' : scope === 'life' ? '生活' : '财务'
              }事件`}
            </div>
          )}
        </div>
        )}
      </div>
      )}

      {/* 今日要事已移除 */}

      {/* 随手记已移至「设置 → 桌面工具 → 桌面便签」 */}

      {/* 番茄钟/习惯追踪/每周回顾 已隐藏，移至「我的 → 效率」 */}

      {/* 首页底部卡片（关怀/迷茫/每日一问/成就/全景/工作交接/健康摘要）已隐藏 */}
      {/* EV-06 添加事件弹层 */}
      {showAddEvent && (
        <AddEventModal
          onClose={() => setShowAddEvent(false)}
          onAdded={() => {
            setShowAddEvent(false)
            load()
          }}
        />
      )}

      {/* EV-03 事件详情弹层 */}
      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
        />
      )}
    </div>
  )
}

/**
 * 今日概览卡：聚合本地模块的今日数据
 * 习惯打卡进度 / 今日心情 / 专注时长 / 阅读时长，四格快捷入口
 * 全部读取 localStorage，离线可用；无任何记录时隐藏
 */
function TodayOverviewCard() {
  const habit = getTodayProgress()
  const focus = getTodayStat()
  const readSec = getStatsInRange(todayStr(), todayStr())[0]?.seconds || 0
  const readMin = Math.round(readSec / 60)
  const water = getWaterStat()
  const waterPct = Math.min(100, Math.round((water.todayMl / water.dailyGoal) * 100))
  const weight = getWeightStat()
  const exercise = getExerciseStat()

  const hasAny = habit.total > 0 || focus.focusMinutes > 0 || readMin > 0 || water.todayMl > 0 || weight.latest !== null || exercise.todayMinutes > 0
  if (!hasAny) return null

  return (
    <div className="mx-3 mt-3 p-3.5 rounded-3xl bg-white border border-gray-100"
      style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)' }}>
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <span className="text-xs font-semibold text-gray-700">今日概览</span>
        <Link to="/review" className="text-[10px] text-gray-400 flex items-center gap-0.5 active:text-primary-500">
          每周回顾 <ChevronRight size={10} />
        </Link>
      </div>
      <div className="grid grid-cols-6 gap-1">
        <Link to="/habit" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <Flame size={17} className={habit.total > 0 && habit.completed >= habit.total ? 'text-orange-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${habit.completed > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
            {habit.completed}/{habit.total}
          </span>
          <span className="text-[9px] text-gray-400">习惯</span>
        </Link>
        <Link to="/pomodoro" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <Timer size={17} className={focus.focusMinutes > 0 ? 'text-rose-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${focus.focusMinutes > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
            {focus.focusMinutes > 0 ? `${focus.focusMinutes}分` : '—'}
          </span>
          <span className="text-[9px] text-gray-400">专注</span>
        </Link>
        <Link to="/novel" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <BookOpen size={17} className={readMin > 0 ? 'text-blue-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${readMin > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
            {readMin > 0 ? `${readMin}分` : '—'}
          </span>
          <span className="text-[9px] text-gray-400">阅读</span>
        </Link>
        <Link to="/water" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <Droplets size={17} className={water.todayMl > 0 ? 'text-sky-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${water.todayMl > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
            {water.todayMl > 0 ? `${waterPct}%` : '—'}
          </span>
          <span className="text-[9px] text-gray-400">饮水</span>
        </Link>
        <Link to="/weight" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <Scale size={17} className={weight.recordedToday ? 'text-violet-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${weight.latest ? 'text-gray-800' : 'text-gray-300'}`}>
            {weight.latest ? `${weight.latest.kg}` : '—'}
          </span>
          <span className="text-[9px] text-gray-400">体重</span>
        </Link>
        <Link to="/exercise" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <Dumbbell size={17} className={exercise.todayMinutes > 0 ? 'text-orange-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${exercise.todayMinutes > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
            {exercise.todayMinutes > 0 ? `${exercise.todayMinutes}分` : '—'}
          </span>
          <span className="text-[9px] text-gray-400">运动</span>
        </Link>
      </div>
    </div>
  )
}

/**
 * EV-06 添加事件弹层
 *
 * 创建手动事件（ManualEvent），用户可自定义标题、时间、视角、地点、参与人、颜色。
 * 创建后通过 home/today 接口聚合到事件总览中显示。
 */
function AddEventModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast((s) => s.show)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [scope, setScope] = useState<typeof EVENT_SCOPES[number]>('life')
  const [location, setLocation] = useState('')
  const [attendeesText, setAttendeesText] = useState('')
  const [color, setColor] = useState<typeof MANUAL_EVENT_COLORS[number]>('blue')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!title.trim()) {
      toast('请填写事件标题', 'error')
      return
    }
    if (!startTime) {
      toast('请选择开始时间', 'error')
      return
    }
    // 将本地时间（datetime-local 输入）解析为 ISO 字符串
    const startISO = new Date(startTime).toISOString()
    const endISO = endTime ? new Date(endTime).toISOString() : undefined
    if (endISO && new Date(endISO).getTime() < new Date(startISO).getTime()) {
      toast('结束时间不能早于开始时间', 'error')
      return
    }

    const attendees = attendeesText
      .split(/[,，;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    setLoading(true)
    try {
      await unwrap(api.post('/manual-events', {
        title: title.trim(),
        description: description.trim() || undefined,
        startTime: startISO,
        endTime: endISO,
        scope,
        location: location.trim() || undefined,
        attendees: attendees.length > 0 ? attendees : undefined,
        color,
      }))
      toast('事件已添加', 'success')
      onAdded()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white w-full max-w-[480px] mx-auto rounded-t-2xl p-5 animate-slide-up max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">添加事件</h3>
        <div className="space-y-3">
          <input
            autoFocus
            className="input"
            placeholder="事件标题（如：朋友聚餐）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="input min-h-[60px] resize-none"
            placeholder="备注（可选）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">开始时间</label>
              <input
                type="datetime-local"
                className="input mt-1"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">结束时间（可选）</label>
              <input
                type="datetime-local"
                className="input mt-1"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500">视角</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {EVENT_SCOPES.map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`py-2 rounded-lg text-xs border ${
                    scope === s ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-gray-200'
                  }`}
                >
                  {eventScopeMeta[s].emoji} {eventScopeMeta[s].label}
                </button>
              ))}
            </div>
          </div>
          <input
            className="input"
            placeholder="地点（可选）"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <input
            className="input"
            placeholder="参与人物（用逗号分隔，可选）"
            value={attendeesText}
            onChange={(e) => setAttendeesText(e.target.value)}
          />
          <div>
            <label className="text-xs text-gray-500">颜色标识</label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {MANUAL_EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center border-2 ${
                    color === c ? 'border-gray-800 scale-110' : 'border-transparent'
                  } transition-transform`}
                  title={manualEventColorMeta[c].label}
                >
                  <span className={`w-4 h-4 rounded-full ${manualEventColorMeta[c].dot}`} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">取消</button>
          <button onClick={submit} disabled={loading} className="btn-primary flex-1 disabled:opacity-50">
            {loading ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * EV-03 事件详情接口
 *
 * 与后端 GET /manual-events/:id/detail 响应对齐。
 * 字段根据事件类型（manual/task/reminder）有所不同。
 */
interface EventDetail {
  id: string
  type: string
  title: string
  time: string
  scope: 'work' | 'life' | 'finance'
  description?: string | null
  location?: string | null
  attendees?: string[]
  color?: string
  priority?: string
  important?: boolean
  progress?: number
  level?: string
  repeat?: string
  countdown: number
  relatedPeople: string[]
  checklist: Array<{ text: string; optional?: boolean }>
}

/**
 * 将秒数倒计时转为人类可读字符串
 * - 正数：还有 X天 X小时 / X小时 X分钟 / X分钟
 * - 0 或负数：已开始 / 已结束
 */
function formatCountdown(seconds: number): { text: string; status: 'upcoming' | 'ongoing' | 'ended' } {
  if (seconds < -3600) {
    return { text: '已结束', status: 'ended' }
  }
  if (seconds <= 0) {
    return { text: '正在进行', status: 'ongoing' }
  }
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) {
    return { text: `还有 ${days} 天 ${hours} 小时`, status: 'upcoming' }
  }
  if (hours > 0) {
    return { text: `还有 ${hours} 小时 ${minutes} 分钟`, status: 'upcoming' }
  }
  return { text: `还有 ${minutes} 分钟`, status: 'upcoming' }
}

/** 提醒重复标签中文映射 */
const repeatLabel: Record<string, string> = {
  once: '单次',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
}

/** 任务优先级中文映射（与 utils.ts 中 priorityMeta 对齐） */
const priorityLabel: Record<string, string> = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
}

/**
 * EV-03 事件详情弹层
 *
 * 打开后查询 GET /manual-events/:id/detail?type=...
 * 展示：标题/倒计时/来源/备注/关联人物/准备清单
 */
function EventDetailModal({
  event,
  onClose,
}: {
  event: HomeData['events'][number]
  onClose: () => void
}) {
  const toast = useToast((s) => s.show)
  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadDetail = async () => {
      setLoading(true)
      setError(false)
      try {
        const res = await unwrap<EventDetail>(
          api.get(`/manual-events/${event.id}/detail`, { params: { type: event.type } })
        )
        if (!cancelled) setDetail(res)
      } catch (err) {
        if (!cancelled) {
          setError(true)
          toast((err as Error).message, 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadDetail()
    return () => {
      cancelled = true
    }
  }, [event.id, event.type])

  const scopeMeta = eventScopeMeta[event.scope] || eventScopeMeta.life
  const typeLabel = event.type === 'manual' ? '手动事件' : event.type === 'task' ? '任务' : '提醒'
  const typeEmoji = event.type === 'manual' ? '📌' : event.type === 'task' ? '✅' : '🔔'

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white w-full max-w-[480px] mx-auto rounded-t-2xl p-5 animate-slide-up max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：来源标签 + 关闭 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{typeEmoji}</span>
            <span className="text-xs text-gray-500">{typeLabel}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${scopeMeta.bg} ${scopeMeta.color}`}>
              {scopeMeta.emoji} {scopeMeta.label}
            </span>
            {event.manual && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">
                手动
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">
            ✕
          </button>
        </div>

        {/* 标题 */}
        <h3 className="text-lg font-semibold text-gray-800 mb-1">{event.title}</h3>

        {/* 倒计时 */}
        {detail && (
          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs mb-3 ${
            formatCountdown(detail.countdown).status === 'ended'
              ? 'bg-gray-100 text-gray-500'
              : formatCountdown(detail.countdown).status === 'ongoing'
                ? 'bg-green-50 text-green-600'
                : 'bg-blue-50 text-blue-600'
          }`}>
            <span>⏰</span>
            <span>{formatCountdown(detail.countdown).text}</span>
            <span className="text-gray-400 ml-1">· {formatTime(detail.time)}</span>
          </div>
        )}

        {loading && (
          <div className="py-8">
            <LoadingState text="加载事件详情..." />
          </div>
        )}

        {error && (
          <div className="py-6">
            <ErrorState onRetry={() => {
              // 触发重新加载：通过临时切换 event 引用
              setLoading(true)
              setError(false)
              setTimeout(() => {
                api.get(`/manual-events/${event.id}/detail`, { params: { type: event.type } })
                  .then((res) => {
                    const d = (res as { data: EventDetail }).data
                    setDetail(d)
                  })
                  .catch((err) => {
                    setError(true)
                    toast((err as Error).message, 'error')
                  })
                  .finally(() => setLoading(false))
              }, 50)
            }} />
          </div>
        )}

        {detail && !loading && !error && (
          <div className="space-y-3 text-sm">
            {/* 备注 */}
            {detail.description && (
              <div>
                <div className="text-xs text-gray-500 mb-1">备注</div>
                <div className="text-gray-700 bg-gray-50 rounded-lg p-2 whitespace-pre-wrap">
                  {detail.description}
                </div>
              </div>
            )}

            {/* 地点（仅 manual） */}
            {detail.location && (
              <div className="flex items-center gap-2 text-gray-600">
                <MapPin size={14} className="text-gray-400" />
                <span>{detail.location}</span>
              </div>
            )}

            {/* 任务属性 */}
            {detail.type === 'task' && (
              <div className="flex flex-wrap gap-2">
                {detail.priority && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-gray-50 text-gray-600">
                    优先级：{priorityLabel[detail.priority] || detail.priority}
                  </span>
                )}
                {detail.important && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-rose-50 text-rose-600">
                    ⭐ 重要
                  </span>
                )}
                {typeof detail.progress === 'number' && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-600">
                    进度：{detail.progress}%
                  </span>
                )}
              </div>
            )}

            {/* 提醒属性 */}
            {detail.type === 'reminder' && (
              <div className="flex flex-wrap gap-2">
                {detail.level && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-600">
                    等级：{detail.level}
                  </span>
                )}
                {detail.repeat && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-gray-50 text-gray-600">
                    重复：{repeatLabel[detail.repeat] || detail.repeat}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">关闭</button>
        </div>
      </div>
    </div>
  )
}