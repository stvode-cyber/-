import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Sparkles, Pin, Star, Play, Pause, Check, Trash2, Edit3, X, ChevronRight, CalendarClock, Monitor } from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { useConfirm } from '../components/ConfirmDialog'
import CountdownFormModal from '../components/countdown/CountdownFormModal'
import {
  COUNTDOWN_TYPES,
  countdownTypeMeta,
  countdownStatusMeta,
  countdownStyleMeta,
} from '../lib/constants'

/** 后端 DTO（与 countdown.routes.ts toDTO 对齐） */
interface CountdownItem {
  id: string
  type: 'single' | 'recurring' | 'important' | 'goal'
  title: string
  description: string | null
  targetDate: string | null
  createdDate: string
  recurringConfig: { pattern: string; customRule?: string; nextTrigger?: string; triggerTime?: string; countdownStartAt?: string } | null
  milestones: { label: string; percentage: number; reached: boolean }[] | null
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  progress: number
  isPinned: boolean
  isImportant: boolean
  remainingDays: number | null
  remainingHours: number | null
  completedAt: string | null
  updatedAt: string
}

interface SuggestionItem {
  type: string
  title: string
  suggestedTitle: string
  suggestedTargetDate?: string
  suggestedType: 'single' | 'recurring' | 'important' | 'goal'
  reason: string
  linkedId?: string
  linkedModules?: { wishFund?: string; goalPlan?: string; importantDay?: string }
}

type Tab = 'active' | 'paused' | 'completed' | 'all'
type TypeFilter = 'all' | typeof COUNTDOWN_TYPES[number]

/**
 * 根据剩余时间判定展示风格
 * - normal: >7 天
 * - warning: 1-7 天
 * - urgent: <24h
 * - overdue: 已超期
 * - completed: 已完成
 */
function pickStyle(item: CountdownItem): keyof typeof countdownStyleMeta {
  if (item.status === 'completed') return 'completed'
  if (item.remainingDays === null) return 'normal'
  if (item.remainingDays < 0) return 'overdue'
  if (item.remainingHours !== null && item.remainingHours < 24) return 'urgent'
  if (item.remainingDays <= 7) return 'warning'
  return 'normal'
}

/** 格式化剩余时间展示 */
function formatRemaining(item: CountdownItem): string {
  if (item.status === 'completed') return '✅ 已完成'
  if (item.status === 'cancelled') return '已取消'
  if (item.status === 'paused') return '⏸ 已暂停'
  if (item.remainingDays === null) {
    // 循环型：展示下次触发
    const next = item.recurringConfig?.nextTrigger
    return next ? `🔁 下次 ${new Date(next).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '🔁 循环中'
  }
  if (item.remainingDays < 0) {
    const overdue = Math.abs(item.remainingDays)
    return `‼️ 已超期 ${overdue} 天`
  }
  if (item.remainingHours !== null && item.remainingHours < 24) {
    // 不足1小时显示分钟，避免 Math.max(1,...) 把 0/负数 误显示为"1 小时"
    if (item.remainingHours <= 0) return '🔴 不足 1 小时'
    return `🔴 仅剩 ${item.remainingHours} 小时`
  }
  if (item.remainingDays === 0) return '🔴 今天'
  if (item.remainingDays <= 7) return `⚠️ 还剩 ${item.remainingDays} 天`
  return `还剩 ${item.remainingDays} 天`
}

/** 浮窗内判断：剩余 ≤ 6 小时且进行中 → 用跳动时钟 */
function shouldRoll(item: CountdownItem): boolean {
  return !!item.targetDate
    && item.status === 'active'
    && item.remainingHours !== null
    && item.remainingHours >= 0
    && item.remainingHours <= 6
}

/**
 * 浮窗数字倒计时（与详情页同款：纯数字 05:47:32 每秒直接跳变）
 * urgent 红字
 */
function FloatRollingClock({ target, urgent }: { target: string; urgent: boolean }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const abs = Math.max(0, new Date(target).getTime() - now)
  const h = Math.floor(abs / 3_600_000)
  const m = Math.floor((abs % 3_600_000) / 60_000)
  const s = Math.floor((abs % 60_000) / 1000)
  const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return (
    <div className={`mt-1 font-mono tabular-nums text-lg font-bold ${urgent ? 'text-red-600' : 'text-gray-800'}`}>
      {text}
    </div>
  )
}

export default function CountdownListPage() {
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const float = searchParams.get('float') === '1'

  const [items, setItems] = useState<CountdownItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [tab, setTab] = useState<Tab>('active')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  // 弹层
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<CountdownItem | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  // 操作中状态（防止重复点击）
  const [actingId, setActingId] = useState<string | null>(null)

  useEffect(() => {
    load()
    if (searchParams.get('new') === '1') {
      setShowCreate(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [tab, typeFilter])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams()
      params.set('status', tab)
      if (typeFilter !== 'all') params.set('type', typeFilter)
      const data = await unwrap<{ items: CountdownItem[] }>(
        api.get(`/countdowns?${params.toString()}`),
      )
      setItems(data.items || [])
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /** 加载智能建议 */
  const loadSuggestions = async () => {
    setSuggestionsLoading(true)
    try {
      const data = await unwrap<{ items: SuggestionItem[] }>(api.get('/countdowns/suggestions'))
      setSuggestions(data.items || [])
      setShowSuggestions(true)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSuggestionsLoading(false)
    }
  }

  /** 操作：暂停 */
  const pause = async (id: string) => {
    setActingId(id)
    try {
      await unwrap(api.post(`/countdowns/${id}/pause`))
      toast('已暂停', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 操作：恢复 */
  const resume = async (id: string) => {
    setActingId(id)
    try {
      await unwrap(api.post(`/countdowns/${id}/resume`))
      toast('已恢复', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 操作：手动完成 */
  const complete = async (item: CountdownItem) => {
    const ok = await confirm({
      title: '完成倒计时',
      message: `确认「${item.title}」已完成？将触发庆祝动画。`,
      confirmText: '已完成',
    })
    if (!ok) return
    setActingId(item.id)
    try {
      await unwrap(api.post(`/countdowns/${item.id}/complete`))
      toast('🎉 恭喜达成！', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 操作：删除 */
  const remove = async (item: CountdownItem) => {
    const ok = await confirm({
      title: '删除倒计时',
      message: `删除「${item.title}」后无法恢复，关联的提醒也会一并删除。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    setActingId(item.id)
    try {
      await unwrap(api.delete(`/countdowns/${item.id}`))
      toast('已删除', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 操作：置顶切换 */
  const togglePin = async (item: CountdownItem) => {
    setActingId(item.id)
    try {
      await unwrap(api.patch(`/countdowns/${item.id}`, { isPinned: !item.isPinned }))
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 应用建议：跳转到新建弹层并预填 */
  const applySuggestion = (s: SuggestionItem) => {
    setShowSuggestions(false)
    // 用 sessionStorage 传递预填数据
    sessionStorage.setItem(
      'countdown_prefill',
      JSON.stringify({
        type: s.suggestedType,
        title: s.suggestedTitle,
        targetDate: s.suggestedTargetDate,
        linkedModules: s.linkedModules,
      }),
    )
    setShowCreate(true)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'active', label: '进行中' },
    { key: 'paused', label: '已暂停' },
    { key: 'completed', label: '已完成' },
    { key: 'all', label: '全部' },
  ]

  const typeFilters: { key: TypeFilter; label: string }[] = [
    { key: 'all', label: '全部' },
    ...COUNTDOWN_TYPES.map((t) => ({ key: t, label: countdownTypeMeta[t].label })),
  ]

  // ---- 桌面浮窗精简模式（仅显示进行中的倒计时，浮于桌面）----
  if (float) {
    const display = items.filter((i) => i.status === 'active').slice(0, 12)
    return (
      <div
        className="w-full h-full flex flex-col overflow-hidden select-none rounded-3xl"
        style={{
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.65)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        {/* 标题栏：拖拽区 + 窗口控制（VisionOS 风格：无色块，玻璃上直接排布） */}
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5" style={{ WebkitAppRegion: 'drag' } as any}>
          <div className="flex items-center gap-2">
            <CalendarClock size={15} className="text-primary-600" />
            <span className="text-sm font-semibold tracking-wide text-gray-800">倒计时</span>
            <span className="text-[10px] text-gray-400 font-normal px-1.5 py-0.5 rounded-full bg-white/60">{display.length}</span>
          </div>
          <button onClick={() => (window as any).desktopAPI?.toggleCountdownWindow?.()} className="p-1.5 rounded-full hover:bg-black/5 transition-colors cursor-pointer text-gray-500 hover:text-gray-700" style={{ WebkitAppRegion: 'no-drag' } as any} aria-label="关闭浮窗" title="关闭">
            <X size={14} />
          </button>
        </div>
        {/* 列表区：卡片悬浮态 */}
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {loading ? (
            <div className="text-center text-xs text-gray-400 py-8">加载中…</div>
          ) : display.length === 0 ? (
            <div className="text-center text-xs text-gray-400 py-12">暂无进行中的倒计时</div>
          ) : (
            display.map((item) => {
              const styleKey = pickStyle(item)
              const meta = countdownStyleMeta[styleKey]
              return (
                <div
                  key={item.id}
                  className={`rounded-2xl p-3 transition-all duration-200 hover:-translate-y-0.5 ${meta.bg}`}
                  style={{ border: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.55)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">{item.title}</span>
                    {item.isPinned && <Pin size={12} className="text-primary-500 flex-shrink-0" />}
                  </div>
                  {shouldRoll(item) ? (
                    <FloatRollingClock target={item.targetDate!} urgent={styleKey === 'urgent'} />
                  ) : (
                    <div className={`mt-1 text-lg font-bold ${meta.text}`}>{formatRemaining(item)}</div>
                  )}
                  {item.targetDate && (
                    <div className="mt-0.5 text-[10px] text-gray-400">
                      {new Date(item.targetDate).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell pb-4">
      <Header
        title="倒计时"
        right={
          <div className="flex items-center gap-1">
            {(window as any).desktopAPI && (
              <button
                onClick={() => (window as any).desktopAPI?.toggleCountdownWindow?.()}
                className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-full transition-colors"
                aria-label="桌面浮窗"
                title="把倒计时钉在电脑桌面上（置顶浮窗）"
              >
                <Monitor size={18} />
              </button>
            )}
            <button
              onClick={loadSuggestions}
              disabled={suggestionsLoading}
              className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-full transition-colors disabled:opacity-50"
              aria-label="智能建议"
              title="智能建议"
            >
              <Sparkles size={18} className={suggestionsLoading ? 'animate-pulse' : ''} />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-full transition-colors"
              aria-label="新建倒计时"
            >
              <Plus size={20} />
            </button>
          </div>
        }
      />

      {/* Tab 切换 */}
      <div className="sticky top-12 bg-white z-10 border-b border-gray-100">
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-3 text-sm border-b-2 ${
                tab === t.key
                  ? 'border-primary-500 text-primary-600 font-medium'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* 类型筛选 */}
        <div className="flex gap-1.5 px-3 py-2 overflow-x-auto">
          {typeFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap ${
                typeFilter === f.key
                  ? 'bg-primary-100 text-primary-600'
                  : 'bg-gray-50 text-gray-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-3">
        {loading ? (
          <LoadingState skeleton count={4} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="⏰"
            text={tab === 'active' ? '暂无进行中的倒计时' : tab === 'completed' ? '暂无已完成倒计时' : '暂无倒计时'}
            hint="点击右上角 + 创建第一个倒计时"
            action={
              <button
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 text-sm text-white bg-primary-500 rounded-lg hover:bg-primary-600"
              >
                + 新建倒计时
              </button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => {
              const typeMeta = countdownTypeMeta[item.type]
              const statusMeta = countdownStatusMeta[item.status]
              const style = pickStyle(item)
              const styleMeta = countdownStyleMeta[style]
              const isActing = actingId === item.id
              return (
                <div
                  key={item.id}
                  className={`card group relative ring-1 ${styleMeta.ring} ${styleMeta.bg} ${
                    style === 'urgent' ? 'animate-pulse' : ''
                  }`}
                >
                  {/* 点击区域：进入详情 */}
                  <button
                    onClick={() => navigate(`/countdowns/${item.id}`)}
                    className="block w-full text-left"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl flex-shrink-0 mt-0.5">{typeMeta.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-800 truncate">
                            {item.title}
                          </span>
                          {item.isImportant && <Star size={12} className="text-amber-500 fill-amber-500 flex-shrink-0" />}
                          {item.isPinned && <Pin size={12} className="text-primary-500 flex-shrink-0" />}
                        </div>
                        {item.description && (
                          <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.description}</div>
                        )}
                        {/* 剩余时间 + 状态 */}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`text-sm font-semibold ${styleMeta.text}`}>
                            {formatRemaining(item)}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusMeta.color} ${statusMeta.bg}`}>
                            {statusMeta.label}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeMeta.color} ${typeMeta.bg}`}>
                            {typeMeta.label}
                          </span>
                        </div>
                        {/* 进度条 */}
                        {item.progress > 0 && item.progress < 100 && (
                          <div className="mt-2">
                            <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                              <span>进度</span>
                              <span>{item.progress}%</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-primary-400 to-teal-400 transition-all"
                                style={{ width: `${item.progress}%` }}
                              />
                            </div>
                          </div>
                        )}
                        {/* 目标日期 */}
                        {item.targetDate && (
                          <div className="text-[10px] text-gray-400 mt-1">
                            🎯 {new Date(item.targetDate).toLocaleString('zh-CN', {
                              month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                            })}
                          </div>
                        )}
                      </div>
                      <ChevronRight size={16} className="text-gray-300 flex-shrink-0 mt-1" />
                    </div>
                  </button>

                  {/* 操作按钮组 */}
                  <div className="flex gap-1 mt-2 pt-2 border-t border-gray-100/80">
                    {item.status === 'active' && (
                      <button
                        onClick={() => pause(item.id)}
                        disabled={isActing}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 rounded disabled:opacity-50"
                      >
                        <Pause size={12} /> 暂停
                      </button>
                    )}
                    {item.status === 'paused' && (
                      <button
                        onClick={() => resume(item.id)}
                        disabled={isActing}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50"
                      >
                        <Play size={12} /> 恢复
                      </button>
                    )}
                    {item.status !== 'completed' && item.status !== 'cancelled' && (
                      <button
                        onClick={() => complete(item)}
                        disabled={isActing}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                      >
                        <Check size={12} /> 完成
                      </button>
                    )}
                    <button
                      onClick={() => setEditTarget(item)}
                      disabled={isActing}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 rounded disabled:opacity-50"
                    >
                      <Edit3 size={12} /> 编辑
                    </button>
                    <button
                      onClick={() => togglePin(item)}
                      disabled={isActing}
                      className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-50 ${
                        item.isPinned
                          ? 'text-primary-600 hover:bg-primary-50'
                          : 'text-gray-400 hover:bg-gray-50'
                      }`}
                    >
                      <Pin size={12} /> {item.isPinned ? '已置顶' : '置顶'}
                    </button>
                    <button
                      onClick={() => remove(item)}
                      disabled={isActing}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded ml-auto disabled:opacity-50"
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 创建/编辑弹层 */}
      {showCreate && (
        <CountdownFormModal
          countdown={null}
          onClose={() => {
            setShowCreate(false)
            // 清理预填缓存
            sessionStorage.removeItem('countdown_prefill')
          }}
          onSaved={() => load()}
        />
      )}
      {editTarget && (
        <CountdownFormModal
          countdown={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null)
            load()
          }}
        />
      )}

      {/* 智能建议弹层 */}
      {showSuggestions && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setShowSuggestions(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-white w-full max-w-[480px] mx-auto rounded-t-2xl p-5 animate-slide-up max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-primary-500" />
                <h3 className="text-lg font-semibold">智能建议</h3>
              </div>
              <button onClick={() => setShowSuggestions(false)} className="p-1 -mr-1 text-gray-400 hover:text-gray-600 rounded">
                <X size={20} />
              </button>
            </div>
            {suggestions.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-sm">
                <div className="text-3xl mb-2">✨</div>
                暂无建议，你已经创建了所有可能的倒计时
              </div>
            ) : (
              <div className="space-y-2">
                {suggestions.map((s, idx) => {
                  const typeMeta = countdownTypeMeta[s.suggestedType]
                  return (
                    <div key={idx} className="border border-gray-100 rounded-xl p-3 hover:border-primary-200 transition-colors">
                      <div className="flex items-start gap-2">
                        <span className="text-lg">{typeMeta.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800">{s.suggestedTitle}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{s.reason}</div>
                          {s.suggestedTargetDate && (
                            <div className="text-xs text-gray-400 mt-1">
                              🎯 {new Date(s.suggestedTargetDate).toLocaleString('zh-CN', {
                                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => applySuggestion(s)}
                        className="mt-2 w-full py-1.5 text-xs text-white bg-primary-500 hover:bg-primary-600 rounded-lg"
                      >
                        创建此倒计时
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
