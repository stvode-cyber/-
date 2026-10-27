import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, Search, Plus, ChevronRight, RefreshCw, MapPin, Users, EyeOff, Sparkles, Send, ListTodo } from 'lucide-react'
import { isDesktop } from '../hooks/useIsDesktop'
import { getTodayLunarInfo } from '../lib/lunar'
import { api, unwrap } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import { formatTime } from '../lib/utils'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import LiveCountdown from '../components/LiveCountdown'
import { useWeather, getWeatherImage } from '../hooks/useWeather'
import { eventScopeMeta, EVENT_SCOPES, manualEventColorMeta } from '../lib/constants'
import GreetingHeader from '../components/home/GreetingHeader'
import WeekCalendar from '../components/home/WeekCalendar'
import MissionCard from '../components/home/MissionCard'
import { useHomeData } from './home/useHomeData'
import type { HomeData } from '../components/home/homeTypes'
import { AddEventModal } from '../components/home/HomeWidgets'
import EventDetailModal from '../components/home/EventDetailModal'

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
 *
 * 拆分记录（2026-10-18，ChatPage 二次拆分 SOP 验证）：
 * - 原 1093 行 → 现在 507 行（砍 586 行，-54%）
 * - 抽出 4 个文件：homeTypes.ts（types）+ HomeWidgets.tsx（TodayOverviewCard + AddEventModal + 工具函数）+ EventDetailModal.tsx（最大组件独立）
 */
export default function HomePage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  // 数据获取相关 state 全部用 useHomeData hook（2026-10-17 抽离）
  const {
    data: _data, loading, error, hidingId, detailEvent,
    dailyQuestion, dailyQuestionLoading,
    wellness, wellnessDismissed, setWellnessDismissed,
    confusion, confusionDismissed, setConfusionDismissed,
    countdownCards,
    load, refreshDailyQuestion, hideEvent, openDetail, setDetailEvent,
  } = useHomeData(toast, confirm)
  const data = _data as HomeData | null
  // EV-05 情境视角切换：all | work | life | finance
  const [scope, setScope] = useState<'all' | 'work' | 'life' | 'finance'>('all')
  // EV-06 添加事件弹层
  const [showAddEvent, setShowAddEvent] = useState(false)
  // 随手记快速输入（AI 自动分类）
  const [quickNote, setQuickNote] = useState('')
  const [quickSubmitting, setQuickSubmitting] = useState(false)
  const quickNoteRef = useRef<HTMLTextAreaElement>(null)

  /**
   * Deep link 唤起：检测 URL ?quick=1 参数
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('quick') === '1') {
      const timer = setTimeout(() => {
        quickNoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        quickNoteRef.current?.focus()
        const url = new URL(window.location.href)
        url.searchParams.delete('quick')
        window.history.replaceState({}, '', url.toString())
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [])

  /** 随手记提交：调用后端 /fragment/quick，AI 自动分类 */
  const submitQuickNote = async () => {
    const content = quickNote.trim()
    if (!content) { toast('请输入内容', 'error'); return }
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
      {/* ========== 合并：天气照片背景 + 墨玉绿新头部 ========== */}
      <div
        className="relative overflow-hidden"
        style={{ backgroundImage: `url(${weatherImg})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'brightness(1.05) saturate(1.05)' }}
      >
        <div className="absolute inset-x-0 top-0 h-36 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(15,23,42,0.45) 0%, rgba(15,23,42,0) 100%)' }} />
        <div className="absolute inset-x-0 bottom-0 h-40 pointer-events-none" style={{ background: 'linear-gradient(0deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0) 100%)' }} />

        {/* 顶部日常模式顶栏 */}
        <div className="relative flex items-center justify-between h-11 px-5 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse shadow-sm" />
            <span className="text-white/90 font-medium drop-shadow-sm">日常模式</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/search')} aria-label="搜索" className="hover:bg-white/25 rounded-full p-1.5 transition-colors">
              <Search size={18} className="text-white drop-shadow-sm" />
            </button>
            <button onClick={load} className="relative hover:bg-white/25 rounded-full p-1.5 transition-colors" aria-label="刷新" disabled={loading}>
              <RefreshCw size={18} className={`text-white drop-shadow-sm ${loading ? 'animate-spin' : ''}`} />
            </button>
            <Link to="/tasks?view=reminders" className="relative hover:bg-white/25 rounded-full p-1.5 transition-colors">
              <Bell size={18} className="text-white drop-shadow-sm" />
              {data && data.events.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-brand text-on-brand text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {data.events.length}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* 问候头 */}
        <div className="relative">
          <header className="flex items-center px-5 pt-3 pb-2 mb-2">
            <div className="min-w-0">
              <p className="text-[14px] leading-[1.4] text-white/70 mb-1">
                {data?.sceneGreeting?.title ? `${data.sceneGreeting.title} 👋` : (data?.greeting || '早上好')}
              </p>
              <h1 className="text-[30px] font-bold leading-[1.2] text-white drop-shadow-sm truncate">
                {user?.nickname || user?.username || '用户'}
              </h1>
            </div>
          </header>
        </div>

        {/* MissionCard + 农历宜忌 */}
        <div className="relative pt-1 pb-4">
          {data?.todayTasks && data.todayTasks.length > 0 ? (
            <MissionCard label="今日重点" title={data.todayTasks[0].title} badgeText={data.todayTasks[0].priority ? `${data.todayTasks[0].priority}优先` : ''} />
          ) : (
            <MissionCard label="今日重点" title="开启新的一天" badgeText={data?.achievements?.todayProgress ? `${data.achievements.todayProgress.done}/${data.achievements.todayProgress.total} 完成` : '开始吧'} />
          )}

          <div className="mx-5 mt-4 flex items-center justify-between text-[13px] text-lgray">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-brand font-medium">{lunarInfo.lunarShort}</span>
              <span className="mx-0.5">·</span>
              <span>{lunarInfo.zodiacYear}{lunarInfo.constellation.emoji}{lunarInfo.constellation.name}</span>
              {lunarInfo.festival && <span className="ml-1">🎉{lunarInfo.festival}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="bg-brand-pale/40 text-brand text-[11px] px-2 py-0.5 rounded-full">宜 {lunarInfo.yi.slice(0, 2).join(' ')}</span>
              <span className="bg-red-50 text-red-600 text-[11px] px-2 py-0.5 rounded-full">忌 {lunarInfo.ji.slice(0, 2).join(' ')}</span>
            </div>
          </div>

          {weather && !weatherLoading && (
            <div className="mx-5 mt-3 flex items-center gap-2 text-[13px] text-lgray">
              <span className="text-xl leading-none">{weather.current.weatherIcon}</span>
              <span className="text-[15px] font-semibold text-ink">{weather.current.tempC}°</span>
              <span>{weather.current.weatherDesc}</span>
              <span className="text-lgray-light tabular-nums">{weather.today.minTempC}°/{weather.today.maxTempC}°</span>
            </div>
          )}

          {data?.sceneGreeting?.tip && (
            <div className="mx-5 mt-3 bg-white/80 backdrop-blur rounded-2xl px-3 py-2 text-[13px] text-accent-700 border border-lgray-light/40">
              💡 {data.sceneGreeting.tip}
            </div>
          )}
        </div>
      </div>

      <WeekCalendar />

      {/* ★ 事件总汇 */}
      {data && (data.events.length > 0 || countdownCards.length > 0) && (
      <div className="relative mx-5 mt-3 p-4 rounded-3xl bg-white border border-primary-100" style={{ boxShadow: '0 10px 30px rgba(148,163,184,.14)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-[30px] h-[30px] rounded-[11px] flex items-center justify-center text-white text-sm bg-gradient-accent shadow-lg shadow-accent-900/30">📅</span>
            <span className="text-[15px] font-bold text-primary-800">事件总汇</span>
            {data.conflicts.length > 0 && <span className="badge bg-orange-100 text-orange-700 text-[10px]">{data.conflicts.length} 冲突</span>}
            {data.events.filter((e) => e.manual).length > 0 && <span className="badge bg-accent-100 text-accent-600 text-[10px]">{data.events.filter((e) => e.manual).length} 手动</span>}
          </div>
          <button onClick={() => setShowAddEvent(true)} className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-1 rounded-full hover:bg-primary-50 transition-colors">
            <Plus size={14} /><span>添加事件</span>
          </button>
        </div>

        {data.events.length > 0 && (
        <div className="mb-3 flex gap-1 bg-primary-50/50 p-1 rounded-2xl">
          {([{ key: 'all', label: '全部' }, ...EVENT_SCOPES.map((k) => ({ key: k, label: `${eventScopeMeta[k].emoji} ${eventScopeMeta[k].label}` }))] as const).map((tab) => (
            <button key={tab.key} onClick={() => setScope(tab.key)} className={`flex-1 py-1.5 text-xs rounded-xl transition-all ${scope === tab.key ? 'bg-white text-primary-600 shadow-sm font-medium' : 'text-gray-500 hover:text-primary-500'}`}>
              {tab.label}
            </button>
          ))}
        </div>
        )}

        {data.conflicts.length > 0 && (
          <div className="mb-3 space-y-2">
            {data.conflicts.map((c, i) => (
              <div key={`${c.a.id}-${c.b.id}-${i}`} className="bg-orange-50 border border-orange-100 rounded-lg p-2 text-xs">
                <div className="flex items-center gap-1 text-orange-600 font-medium mb-1">⚠️ 时间冲突 · 间隔 {c.gapMin} 分钟</div>
                <div className="text-gray-600">
                  <span className="text-gray-400">{formatTime(c.a.time)}</span> {c.a.title}
                  <span className="text-gray-300 mx-1">→</span>
                  <span className="text-gray-400">{formatTime(c.b.time)}</span> {c.b.title}
                </div>
                <div className="text-orange-500 mt-1">{c.suggestion}</div>
              </div>
            ))}
          </div>
        )}

        {countdownCards.length > 0 && (
          <div className="mb-3 rounded-2xl bg-primary-50/40 border border-primary-100 p-2.5">
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span className="text-[11px] font-semibold text-primary-700 flex items-center gap-1"><span>⏰</span> 倒计时</span>
              <Link to="/countdowns" className="text-[10px] text-primary-600 flex items-center font-medium">全部 <ChevronRight size={11} /></Link>
            </div>
            <div className="space-y-0.5">
              {countdownCards.map((c) => {
                const countdownTarget = c.targetDate || c.recurringConfig?.nextTrigger || null
                const countdownStartAt = c.recurringConfig?.countdownStartAt
                let isWaiting = false
                if (countdownTarget && countdownStartAt && c.type === 'recurring') {
                  const triggerDate = new Date(countdownTarget)
                  const [sh, sm] = countdownStartAt.split(':').map(Number)
                  const startDatetime = new Date(triggerDate); startDatetime.setHours(sh, sm, 0, 0)
                  if (Date.now() < startDatetime.getTime()) isWaiting = true
                }
                let styleText = 'text-gray-600', styleBg = 'bg-gray-50'
                if (countdownTarget && !isWaiting) {
                  const diff = new Date(countdownTarget).getTime() - Date.now()
                  if (diff <= 0) { styleText = 'text-red-700'; styleBg = 'bg-red-100' }
                  else if (diff < 86400000) { styleText = 'text-red-600'; styleBg = 'bg-red-50' }
                  else if (diff <= 604800000) { styleText = 'text-amber-600'; styleBg = 'bg-amber-50' }
                }
                if (isWaiting) { styleText = 'text-gray-400'; styleBg = 'bg-gray-50' }
                const typeEmoji = c.type === 'recurring' ? '🔁' : c.type === 'important' ? '⭐' : c.type === 'goal' ? '🎯' : '⏰'
                return (
                  <Link key={c.id} to={`/countdowns/${c.id}`} className="flex items-center justify-between py-1.5 px-2 -mx-2 rounded-lg hover:bg-primary-50/50 group transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{typeEmoji}</span>
                      <span className="text-sm text-gray-700 group-hover:text-primary-600 truncate">{c.title}</span>
                      {c.isImportant && <span className="text-xs">⭐</span>}
                      {c.isPinned && <span className="text-xs">📌</span>}
                    </div>
                    {isWaiting ? (
                      <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${styleText} ${styleBg} flex-shrink-0`}>⏸️ 等待 {countdownStartAt}</span>
                    ) : countdownTarget ? (
                      <span className={`text-lg font-bold px-3 py-1 rounded-full ${styleText} ${styleBg} flex-shrink-0`}><LiveCountdown targetDate={countdownTarget} /></span>
                    ) : (
                      <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${styleText} ${styleBg} flex-shrink-0`}>🔁 循环中</span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {data.events.length > 0 && (
        <div className="space-y-3">
          {data.events.filter((ev) => scope === 'all' || ev.scope === scope).map((ev) => {
            const isUrgent = ev.priority === 'urgent' || ev.level === 'urgent'
            const scopeMeta = eventScopeMeta[ev.scope] || eventScopeMeta.life
            const dotColor = ev.manual ? (manualEventColorMeta[ev.color || 'blue']?.dot || 'bg-blue-400') : isUrgent ? 'bg-red-500' : ev.priority === 'high' ? 'bg-orange-400' : 'bg-blue-400'
            const isHiding = hidingId === `${ev.type}-${ev.id}`
            return (
              <div key={`${ev.type}-${ev.id}`} className="flex gap-3 group">
                <div className="flex flex-col items-center">
                  <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                  <span className="w-px flex-1 bg-gray-100 mt-1" />
                </div>
                <div className="pb-2 flex-1">
                  <button onClick={() => openDetail(ev)} className="block w-full text-left">
                    <div className="text-xs text-gray-400 flex items-center gap-1">
                      {formatTime(ev.time)}
                      <span className="text-[10px]">{scopeMeta.emoji}</span>
                      {ev.manual && <span className="text-[10px] text-purple-500">手动</span>}
                    </div>
                    <div className="text-sm text-gray-700 mt-0.5 flex items-start gap-1"><span className="flex-1">{ev.title}</span></div>
                  </button>
                  <div className="flex items-start gap-1 mt-0.5">
                    <button onClick={() => hideEvent(ev)} disabled={isHiding} title="隐藏此事件" className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 disabled:opacity-30">
                      <EyeOff size={14} />
                    </button>
                  </div>
                  {ev.manual && (ev.location || (ev.attendees && ev.attendees.length > 0)) && (
                    <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-gray-500">
                      {ev.location && <span className="flex items-center gap-0.5"><MapPin size={10} />{ev.location}</span>}
                      {ev.attendees && ev.attendees.length > 0 && <span className="flex items-center gap-0.5"><Users size={10} />{ev.attendees.join('、')}</span>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {data.events.filter((ev) => scope === 'all' || ev.scope === scope).length === 0 && (
            <div className="text-center text-xs text-gray-400 py-4">
              {scope === 'all' ? '今日暂无事件，点击右上角添加' : `当前视角暂无${scope === 'work' ? '工作' : scope === 'life' ? '生活' : '财务'}事件`}
            </div>
          )}
        </div>
        )}
      </div>
      )}

      {/* 已隐藏的区块 */}
      {/* 今日要事 / 番茄钟 / 习惯追踪 / 健康摘要 / 财务速览 / 底部卡片 已隐藏，移至对应子页面 */}

      {showAddEvent && (
        <AddEventModal onClose={() => setShowAddEvent(false)} onAdded={() => { setShowAddEvent(false); load() }} />
      )}

      {detailEvent && (
        <EventDetailModal event={detailEvent} onClose={() => setDetailEvent(null)} />
      )}
    </div>
  )
}
