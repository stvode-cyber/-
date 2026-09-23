import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Edit3, Pause, Play, Check, Trash2, Pin, Plus, X, Sparkles, Star,
  Calendar, Target, Trophy, Bell, Gift, Link2, Clock, Monitor,
} from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState } from '../components/StateView'
import { useConfirm } from '../components/ConfirmDialog'
import CountdownFormModal from '../components/countdown/CountdownFormModal'
import CelebrationOverlay from '../components/countdown/CelebrationOverlay'
import {
  countdownTypeMeta,
  countdownStatusMeta,
  countdownStyleMeta,
  recurringPatternMeta,
  celebrationStyleMeta,
  DECREASING_ZONES,
} from '../lib/constants'

/** 后端 DTO（与 countdown.routes.ts toDTO 对齐） */
interface CountdownDetail {
  id: string
  type: 'single' | 'recurring' | 'important' | 'goal'
  title: string
  description: string | null
  targetDate: string | null
  createdDate: string
  recurringConfig: { pattern: string; customRule?: string; nextTrigger?: string } | null
  milestones: { label: string; percentage: number; reached: boolean }[] | null
  reminderConfig: {
    enabled: boolean
    rule: string
    decreasingRule?: Record<string, string>
    customReminders?: { daysBefore: number; time: string; level: string }[]
  } | null
  celebrationConfig: {
    enabled: boolean
    style: 'confetti' | 'fireworks' | 'milestone' | 'minimal'
    sound?: string
    message?: string
  } | null
  linkedModules: { wishFund?: string; goalPlan?: string; importantDay?: string } | null
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  progress: number
  isPinned: boolean
  isImportant: boolean
  lastNotified: string | null
  completedAt: string | null
  completionSnapshot: Record<string, unknown> | null
  remainingDays: number | null
  remainingHours: number | null
  updatedAt: string
}

type Milestone = { label: string; percentage: number; reached: boolean }

/**
 * 数字倒计时（剩余 ≤ 6 小时启用）
 * 纯时间显示 05:47:32，每秒直接跳变
 */
function RollingCountdown({ target }: { target: string }) {
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
    <div className="font-mono tabular-nums text-2xl font-bold text-gray-800 mt-1">
      {text}
    </div>
  )
}

export default function CountdownDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()

  const [detail, setDetail] = useState<CountdownDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)

  // 弹层
  const [showEdit, setShowEdit] = useState(false)
  const [showAddMilestone, setShowAddMilestone] = useState(false)
  const [newMsLabel, setNewMsLabel] = useState('')
  const [newMsPercentage, setNewMsPercentage] = useState('50')
  // 庆祝动画
  const [celebration, setCelebration] = useState<{
    style: 'confetti' | 'fireworks' | 'milestone' | 'minimal'
    message?: string
    title: string
  } | null>(null)

  useEffect(() => {
    load()
  }, [id])

  const load = async () => {
    if (!id) return
    setLoading(true)
    setError(false)
    try {
      const data = await unwrap<CountdownDetail>(api.get(`/countdowns/${id}`))
      setDetail(data)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /** 操作：暂停 */
  const pause = async () => {
    if (!detail) return
    setActingId('pause')
    try {
      await unwrap(api.post(`/countdowns/${detail.id}/pause`))
      toast('已暂停', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 操作：恢复 */
  const resume = async () => {
    if (!detail) return
    setActingId('resume')
    try {
      await unwrap(api.post(`/countdowns/${detail.id}/resume`))
      toast('已恢复', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 操作：手动完成 → 触发庆祝动画 */
  const complete = async () => {
    if (!detail) return
    const ok = await confirm({
      title: '完成倒计时',
      message: `确认「${detail.title}」已完成？将触发庆祝动画。`,
      confirmText: '已完成',
    })
    if (!ok) return
    setActingId('complete')
    try {
      const updated = await unwrap<CountdownDetail>(api.post(`/countdowns/${detail.id}/complete`))
      setDetail(updated)
      // 触发庆祝动画
      const style = updated.celebrationConfig?.style || 'confetti'
      const message = updated.celebrationConfig?.message
      setCelebration({ style, message, title: updated.title })
      toast('🎉 恭喜达成！', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 操作：删除 */
  const remove = async () => {
    if (!detail) return
    const ok = await confirm({
      title: '删除倒计时',
      message: `删除「${detail.title}」后无法恢复，关联的提醒也会一并删除。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    setActingId('delete')
    try {
      await unwrap(api.delete(`/countdowns/${detail.id}`))
      toast('已删除', 'success')
      navigate('/countdowns', { replace: true })
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 操作：置顶切换 */
  const togglePin = async () => {
    if (!detail) return
    setActingId('pin')
    try {
      await unwrap(api.patch(`/countdowns/${detail.id}`, { isPinned: !detail.isPinned }))
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 操作：重要标记切换 */
  const toggleImportant = async () => {
    if (!detail) return
    setActingId('important')
    try {
      await unwrap(api.patch(`/countdowns/${detail.id}`, { isImportant: !detail.isImportant }))
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 里程碑：添加 */
  const addMilestone = async () => {
    if (!detail) return
    const percentage = parseInt(newMsPercentage, 10)
    if (!newMsLabel.trim() || isNaN(percentage) || percentage < 0 || percentage > 100) {
      toast('请填写有效的标签和百分比(0-100)', 'error')
      return
    }
    setActingId('addMs')
    try {
      await unwrap(api.post(`/countdowns/${detail.id}/milestones`, {
        label: newMsLabel.trim(),
        percentage,
        reached: percentage <= detail.progress,
      }))
      toast('里程碑已添加', 'success')
      setNewMsLabel('')
      setNewMsPercentage('50')
      setShowAddMilestone(false)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 里程碑：切换 reached 状态 */
  const toggleMilestone = async (idx: number, ms: Milestone) => {
    if (!detail) return
    setActingId(`ms-${idx}`)
    try {
      await unwrap(api.patch(`/countdowns/${detail.id}/milestones/${idx}`, { reached: !ms.reached }))
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 里程碑：删除 */
  const removeMilestone = async (idx: number, ms: Milestone) => {
    if (!detail) return
    const ok = await confirm({
      title: '删除里程碑',
      message: `删除里程碑「${ms.label}」？`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    setActingId(`ms-del-${idx}`)
    try {
      await unwrap(api.delete(`/countdowns/${detail.id}/milestones/${idx}`))
      toast('已删除', 'success')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setActingId(null)
    }
  }

  /** 计算展示风格 */
  const pickStyleKey = (d: CountdownDetail): keyof typeof countdownStyleMeta => {
    if (d.status === 'completed') return 'completed'
    if (d.remainingDays === null) return 'normal'
    if (d.remainingDays < 0) return 'overdue'
    if (d.remainingHours !== null && d.remainingHours < 24) return 'urgent'
    if (d.remainingDays <= 7) return 'warning'
    return 'normal'
  }

  /** 格式化剩余时间 */
  const formatRemaining = (d: CountdownDetail): string => {
    if (d.status === 'completed') return '✅ 已完成'
    if (d.status === 'cancelled') return '已取消'
    if (d.status === 'paused') return '⏸ 已暂停'
    if (d.remainingDays === null) {
      const next = d.recurringConfig?.nextTrigger
      return next
        ? `🔁 下次触发 ${new Date(next).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
        : '🔁 循环中'
    }
    if (d.remainingDays < 0) return `‼️ 已超期 ${Math.abs(d.remainingDays)} 天`
    if (d.remainingHours !== null && d.remainingHours < 24) {
      if (d.remainingHours <= 0) return '🔴 不足 1 小时'
      return `🔴 仅剩 ${d.remainingHours} 小时`
    }
    if (d.remainingDays === 0) return '🔴 今天'
    if (d.remainingDays <= 7) return `⚠️ 还剩 ${d.remainingDays} 天`
    return `还剩 ${d.remainingDays} 天`
  }

  if (loading) {
    return (
      <div className="app-shell">
        <Header title="倒计时详情" />
        <LoadingState skeleton count={4} />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="app-shell">
        <Header title="倒计时详情" />
        <ErrorState onRetry={load} />
      </div>
    )
  }

  const typeMeta = countdownTypeMeta[detail.type]
  const statusMeta = countdownStatusMeta[detail.status]
  const styleKey = pickStyleKey(detail)
  const styleMeta = countdownStyleMeta[styleKey]
  const milestones: Milestone[] = detail.milestones || []
  const isRecurring = detail.type === 'recurring'
  const patternMeta = detail.recurringConfig ? recurringPatternMeta[detail.recurringConfig.pattern] : null

  return (
    <div className="app-shell pb-6">
      <Header
        title="倒计时详情"
        right={
          <div className="flex items-center">
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
              onClick={() => setShowEdit(true)}
              className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-full transition-colors"
              aria-label="编辑"
            >
              <Edit3 size={18} />
            </button>
          </div>
        }
      />

      <div className="px-3 py-3 space-y-3">
        {/* 主卡片：标题 + 剩余时间 + 状态 */}
        <div className={`card ring-1 ${styleMeta.ring} ${styleMeta.bg} ${styleKey === 'urgent' ? 'animate-pulse' : ''}`}>
          <div className="flex items-start gap-3">
            <span className="text-3xl flex-shrink-0">{typeMeta.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-800">{detail.title}</h2>
                {detail.isImportant && <Star size={14} className="text-amber-500 fill-amber-500" />}
                {detail.isPinned && <Pin size={14} className="text-primary-500" />}
              </div>
              {/* 剩余时间：≤6 小时切换为数字滚动时钟，其余保持文字 */}
              {(() => {
                const useRolling = !!detail.targetDate
                  && detail.status === 'active'
                  && detail.remainingHours !== null
                  && detail.remainingHours >= 0
                  && detail.remainingHours <= 6
                if (useRolling) {
                  return <RollingCountdown target={detail.targetDate!} />
                }
                return (
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`text-base font-bold ${styleMeta.text}`}>{formatRemaining(detail)}</span>
                  </div>
                )
              })()}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusMeta.color} ${statusMeta.bg}`}>
                  {statusMeta.label}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeMeta.color} ${typeMeta.bg}`}>
                  {typeMeta.label}
                </span>
              </div>
            </div>
          </div>

          {detail.description && (
            <div className="mt-3 text-sm text-gray-600 bg-white/60 rounded-lg p-2">
              {detail.description}
            </div>
          )}

          {/* 进度条 */}
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>进度</span>
              <span>{detail.progress}%</span>
            </div>
            <div className="h-2 bg-white/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-400 to-teal-400 transition-all"
                style={{ width: `${detail.progress}%` }}
              />
            </div>
          </div>

          {/* 关键信息 */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {detail.targetDate && (
              <div className="flex items-center gap-1.5 text-gray-600">
                <Target size={12} />
                <span>目标: {new Date(detail.targetDate).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-gray-600">
              <Calendar size={12} />
              <span>创建: {new Date(detail.createdDate).toLocaleDateString('zh-CN')}</span>
            </div>
            {detail.completedAt && (
              <div className="flex items-center gap-1.5 text-green-600">
                <Check size={12} />
                <span>完成: {new Date(detail.completedAt).toLocaleDateString('zh-CN')}</span>
              </div>
            )}
            {isRecurring && patternMeta && (
              <div className="flex items-center gap-1.5 text-purple-600">
                <Clock size={12} />
                <span>循环: {patternMeta.label}</span>
              </div>
            )}
          </div>
        </div>

        {/* 操作按钮组 */}
        <div className="card">
          <div className="grid grid-cols-4 gap-2">
            {detail.status === 'active' && (
              <button
                onClick={pause}
                disabled={actingId === 'pause'}
                className="flex flex-col items-center py-2 text-amber-600 hover:bg-amber-50 rounded-lg disabled:opacity-50"
              >
                <Pause size={18} />
                <span className="text-xs mt-1">暂停</span>
              </button>
            )}
            {detail.status === 'paused' && (
              <button
                onClick={resume}
                disabled={actingId === 'resume'}
                className="flex flex-col items-center py-2 text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50"
              >
                <Play size={18} />
                <span className="text-xs mt-1">恢复</span>
              </button>
            )}
            {detail.status !== 'completed' && detail.status !== 'cancelled' && (
              <button
                onClick={complete}
                disabled={actingId === 'complete'}
                className="flex flex-col items-center py-2 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50"
              >
                <Check size={18} />
                <span className="text-xs mt-1">完成</span>
              </button>
            )}
            <button
              onClick={togglePin}
              disabled={actingId === 'pin'}
              className={`flex flex-col items-center py-2 rounded-lg disabled:opacity-50 ${
                detail.isPinned ? 'text-primary-600 hover:bg-primary-50' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Pin size={18} />
              <span className="text-xs mt-1">{detail.isPinned ? '已置顶' : '置顶'}</span>
            </button>
            <button
              onClick={toggleImportant}
              disabled={actingId === 'important'}
              className={`flex flex-col items-center py-2 rounded-lg disabled:opacity-50 ${
                detail.isImportant ? 'text-amber-600 hover:bg-amber-50' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Star size={18} />
              <span className="text-xs mt-1">{detail.isImportant ? '重要' : '标记重要'}</span>
            </button>
            <button
              onClick={remove}
              disabled={actingId === 'delete'}
              className="flex flex-col items-center py-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50"
            >
              <Trash2 size={18} />
              <span className="text-xs mt-1">删除</span>
            </button>
          </div>
        </div>

        {/* 里程碑 */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-amber-500" />
              <span className="font-medium text-gray-800">里程碑</span>
              {milestones.length > 0 && (
                <span className="text-xs text-gray-400">
                  ({milestones.filter((m) => m.reached).length}/{milestones.length})
                </span>
              )}
            </div>
            <button
              onClick={() => setShowAddMilestone(!showAddMilestone)}
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
            >
              <Plus size={12} /> 添加
            </button>
          </div>

          {/* 新增里程碑表单 */}
          {showAddMilestone && (
            <div className="bg-primary-50/50 rounded-lg p-2 mb-2 space-y-2">
              <input
                autoFocus
                className="input"
                placeholder="里程碑标签，如：存到 3000"
                value={newMsLabel}
                onChange={(e) => setNewMsLabel(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input flex-1"
                  placeholder="百分比（0-100）"
                  value={newMsPercentage}
                  onChange={(e) => setNewMsPercentage(e.target.value)}
                  inputMode="numeric"
                />
                <span className="text-xs text-gray-500">%</span>
                <button
                  onClick={addMilestone}
                  disabled={actingId === 'addMs'}
                  className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                >
                  添加
                </button>
              </div>
            </div>
          )}

          {milestones.length === 0 ? (
            <div className="py-4 text-center text-xs text-gray-400">
              暂无里程碑，点击"添加"创建进度节点
            </div>
          ) : (
            <div className="space-y-2">
              {milestones.map((ms, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-2 p-2 rounded-lg ${
                    ms.reached ? 'bg-green-50' : 'bg-gray-50'
                  }`}
                >
                  <button
                    onClick={() => toggleMilestone(idx, ms)}
                    disabled={actingId === `ms-${idx}`}
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      ms.reached ? 'bg-green-500 border-green-500' : 'border-gray-300'
                    }`}
                  >
                    {ms.reached && <Check size={12} className="text-white" />}
                  </button>
                  <span className={`flex-1 text-sm ${ms.reached ? 'text-green-700 line-through' : 'text-gray-700'}`}>
                    {ms.label}
                  </span>
                  <span className="text-xs text-gray-400">{ms.percentage}%</span>
                  <button
                    onClick={() => removeMilestone(idx, ms)}
                    disabled={actingId === `ms-del-${idx}`}
                    className="p-1 text-gray-300 hover:text-red-500 rounded disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 提醒配置 */}
        {detail.reminderConfig && detail.reminderConfig.enabled && (
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <Bell size={16} className="text-amber-500" />
              <span className="font-medium text-gray-800">提醒配置</span>
            </div>
            <div className="text-sm text-gray-600">
              {detail.reminderConfig.rule === 'decreasing' && (
                <div>
                  <div className="text-xs text-amber-600 mb-1">递减式提醒规则：</div>
                  <div className="space-y-1 text-xs">
                    {DECREASING_ZONES.map((z) => (
                      <div key={z.zone} className="flex justify-between bg-gray-50 rounded px-2 py-1">
                        <span>{z.range}</span>
                        <span className="text-gray-500">{z.freq} · {z.level}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detail.reminderConfig.rule === 'fixed' && (
                <div className="text-xs">固定间隔提醒</div>
              )}
              {detail.reminderConfig.rule === 'custom' && detail.reminderConfig.customReminders && (
                <div>
                  <div className="text-xs text-purple-600 mb-1">自定义提醒：</div>
                  <div className="space-y-1 text-xs">
                    {detail.reminderConfig.customReminders.map((cr, idx) => (
                      <div key={idx} className="flex justify-between bg-gray-50 rounded px-2 py-1">
                        <span>{cr.daysBefore} 天前 {cr.time}</span>
                        <span className="text-gray-500">{cr.level}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {detail.lastNotified && (
              <div className="text-xs text-gray-400 mt-2">
                上次提醒: {new Date(detail.lastNotified).toLocaleString('zh-CN')}
              </div>
            )}
          </div>
        )}

        {/* 庆祝配置 */}
        {detail.celebrationConfig && detail.celebrationConfig.enabled && (
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <Gift size={16} className="text-pink-500" />
              <span className="font-medium text-gray-800">完成庆祝</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{celebrationStyleMeta[detail.celebrationConfig.style]?.emoji || '🎉'}</span>
              <div>
                <div className="text-sm text-gray-700">
                  {celebrationStyleMeta[detail.celebrationConfig.style]?.label || '撒花'} 样式
                </div>
                <div className="text-xs text-gray-400">
                  {celebrationStyleMeta[detail.celebrationConfig.style]?.desc}
                </div>
              </div>
            </div>
            {detail.celebrationConfig.message && (
              <div className="mt-2 text-sm text-gray-600 bg-pink-50/50 rounded p-2">
                {detail.celebrationConfig.message}
              </div>
            )}
          </div>
        )}

        {/* 关联模块 */}
        {detail.linkedModules && (detail.linkedModules.wishFund || detail.linkedModules.goalPlan || detail.linkedModules.importantDay) && (
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <Link2 size={16} className="text-blue-500" />
              <span className="font-medium text-gray-800">关联模块</span>
            </div>
            <div className="space-y-1 text-xs">
              {detail.linkedModules.wishFund && (
                <div className="flex items-center gap-2 text-gray-600">
                  <span>💰</span> <span>愿望基金: {detail.linkedModules.wishFund}</span>
                </div>
              )}
              {detail.linkedModules.goalPlan && (
                <div className="flex items-center gap-2 text-gray-600">
                  <span>🎯</span> <span>目标计划: {detail.linkedModules.goalPlan}</span>
                </div>
              )}
              {detail.linkedModules.importantDay && (
                <div className="flex items-center gap-2 text-gray-600">
                  <span>📅</span> <span>重要日: {detail.linkedModules.importantDay}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 完成快照 */}
        {detail.status === 'completed' && detail.completionSnapshot && (
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={16} className="text-green-500" />
              <span className="font-medium text-gray-800">完成回顾</span>
            </div>
            <pre className="text-xs text-gray-600 bg-gray-50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
{JSON.stringify(detail.completionSnapshot, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* 编辑弹层 */}
      {showEdit && (
        <CountdownFormModal
          countdown={detail}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false)
            load()
          }}
        />
      )}

      {/* 庆祝动画 */}
      {celebration && (
        <CelebrationOverlay
          style={celebration.style}
          title={celebration.title}
          message={celebration.message}
          onClose={() => setCelebration(null)}
        />
      )}
    </div>
  )
}
