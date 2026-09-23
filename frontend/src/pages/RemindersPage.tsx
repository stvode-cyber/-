import { useEffect, useState } from 'react'
import { useSearchParams, Navigate } from 'react-router-dom'
import { Plus, Check, Trash2, Bell, X } from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { formatDateTime } from '../lib/utils'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { reminderLevelMeta, REMINDER_LEVELS } from '../lib/constants'

/** 提醒结构 */
interface Reminder {
  id: string
  title: string
  content?: string
  level: string
  remindAt: string
  repeat: string
  done: boolean
}

type Tab = 'pending' | 'done' | 'all'
type LevelFilter = 'all' | typeof REMINDER_LEVELS[number]

/**
 * 提醒页（并入任务日程页后的兼容层）
 *
 * - 桌面浮窗模式（?float=1）：Electron 桌面提醒浮窗直接加载本路由，保留原渲染
 * - 普通访问：重定向到 /tasks?view=reminders（提醒与待办已合并为「任务日程」一个入口）
 */
export default function RemindersPage() {
  const [searchParams] = useSearchParams()
  const float = searchParams.get('float') === '1'

  // 浮窗模式走精简渲染；普通访问 302 到任务页提醒视图（保留 new 等参数）
  if (!float) {
    const next = new URLSearchParams(searchParams)
    next.delete('float')
    next.set('view', 'reminders')
    return <Navigate to={`/tasks?${next.toString()}`} replace />
  }

  return <ReminderFloatWindow />
}

/**
 * 桌面提醒浮窗（Electron 专用）
 * - 仅显示待办提醒（前 8 条），支持快速完成
 * - 与桌面待办浮窗同构：标题栏拖拽区 + 列表区
 */
function ReminderFloatWindow() {
  const toast = useToast((s) => s.show)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const list = await unwrap<Reminder[]>(api.get('/reminder?pending=1'))
        setReminders(list)
      } catch (err) {
        toast((err as Error).message, 'error')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const done = async (id: string) => {
    try {
      await unwrap(api.post(`/reminder/${id}/done`))
      setReminders((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const display = reminders.slice(0, 12)

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
      {/* 标题栏：拖拽区 + 窗口控制（VisionOS 风格玻璃） */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex items-center gap-2">
          <Bell size={15} className="text-primary-600" />
          <span className="text-sm font-semibold tracking-wide text-gray-800">提醒</span>
          <span className="text-[10px] text-gray-400 font-normal px-1.5 py-0.5 rounded-full bg-white/60">{display.length}</span>
        </div>
        <button onClick={() => (window as any).desktopAPI?.toggleReminderWindow?.()} className="p-1.5 rounded-full hover:bg-black/5 transition-colors cursor-pointer text-gray-500 hover:text-gray-700" style={{ WebkitAppRegion: 'no-drag' } as any} aria-label="关闭浮窗" title="关闭">
          <X size={14} />
        </button>
      </div>
      {/* 列表区：卡片悬浮态 */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
        {loading ? (
          <div className="text-center text-xs text-gray-400 py-8">加载中…</div>
        ) : display.length === 0 ? (
          <div className="text-center text-xs text-gray-400 py-12">🔔 暂无待办提醒</div>
        ) : (
          display.map((r) => {
            const meta = reminderLevelMeta[r.level] || reminderLevelMeta.normal
            return (
              <div
                key={r.id}
                className="group flex items-start gap-2.5 rounded-2xl p-2.5 transition-all duration-200 hover:-translate-y-0.5"
                style={{ border: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.55)' }}
              >
                <button
                  onClick={() => done(r.id)}
                  className="mt-0.5 w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer hover:border-primary-500 group-hover:border-primary-400"
                  aria-label="完成提醒"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-800 truncate">{r.title}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color}`}>{meta.label}</span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(r.remindAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {r.repeat !== 'once' && (
                      <span className="text-[10px] text-gray-400">🔁 {r.repeat === 'daily' ? '每天' : r.repeat === 'weekly' ? '每周' : '每月'}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/**
 * 提醒列表面板（嵌入任务日程页「提醒」视图）
 *
 * 功能：
 * 1. Tab：待办 / 已完成 / 全部
 * 2. 等级筛选：全部 / 闹钟级 / 横幅 / 普通 / 静默
 * 3. 列表项：完成 / 删除
 * 4. 新增弹层：由外部 Header 的 + 按钮触发（addTrigger 递增时打开）
 *
 * props：
 * - addTrigger: 外部触发新增的信号（数值递增即打开弹层）
 */
export function ReminderListPanel({ addTrigger = 0 }: { addTrigger?: number }) {
  const toast = useToast((s) => s.show)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      // tab=pending → 只查未完成；done/all → 查全部后前端过滤
      const onlyPending = tab === 'pending'
      const list = await unwrap<Reminder[]>(api.get(`/reminder${onlyPending ? '?pending=1' : ''}`))
      setReminders(list)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // 外部 + 按钮触发新增（跳过初始值 0）
  useEffect(() => {
    if (addTrigger > 0) setShowAdd(true)
  }, [addTrigger])

  const done = async (id: string) => {
    try {
      await unwrap(api.post(`/reminder/${id}/done`))
      toast('已完成', 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const remove = async (id: string) => {
    try {
      await unwrap(api.delete(`/reminder/${id}`))
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** 前端二次过滤：按 tab + 等级 */
  const filtered = reminders.filter((r) => {
    if (tab === 'pending' && r.done) return false
    if (tab === 'done' && !r.done) return false
    if (levelFilter !== 'all' && r.level !== levelFilter) return false
    return true
  })

  const tabs: { key: Tab; label: string }[] = [
    { key: 'pending', label: '待办' },
    { key: 'done', label: '已完成' },
    { key: 'all', label: '全部' },
  ]

  const levelFilters: { key: LevelFilter; label: string }[] = [
    { key: 'all', label: '全部' },
    ...REMINDER_LEVELS.map((l) => ({ key: l, label: reminderLevelMeta[l].label })),
  ]

  return (
    <>
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
        {/* 等级筛选 */}
        <div className="flex gap-1.5 px-3 py-2 overflow-x-auto">
          {levelFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => setLevelFilter(f.key)}
              className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap ${
                levelFilter === f.key
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
        {/* 列表：loading / error / empty / 正常列表 三态兜底 */}
        {loading ? (
          <LoadingState skeleton count={4} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="🔔"
            text={tab === 'pending' ? '暂无待办提醒' : tab === 'done' ? '暂无已完成提醒' : '暂无提醒'}
            hint={tab === 'pending' ? '点击右上角 + 创建提醒' : undefined}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => {
              const meta = reminderLevelMeta[r.level] || reminderLevelMeta.normal
              return (
                <div key={r.id} className={`card group ${r.done ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 w-2 h-2 rounded-full ${meta.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm text-gray-800 ${r.done ? 'line-through' : ''}`}>
                          {r.title}
                        </span>
                        <span className={`badge ${meta.color}`}>{meta.label}</span>
                      </div>
                      {r.content && <div className="text-xs text-gray-500 mt-0.5">{r.content}</div>}
                      <div className="text-xs text-gray-400 mt-1">
                        ⏰ {formatDateTime(r.remindAt)}
                        {r.repeat !== 'once' && <span className="ml-2">🔁 {r.repeat === 'daily' ? '每天' : r.repeat === 'weekly' ? '每周' : '每月'}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {!r.done && (
                        <button
                          onClick={() => done(r.id)}
                          className="p-1.5 text-gray-400 hover:text-green-500 rounded"
                        >
                          <Check size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => remove(r.id)}
                        className="p-1.5 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 rounded"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showAdd && <AddReminderModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </>
  )
}

function AddReminderModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast((s) => s.show)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [level, setLevel] = useState<typeof REMINDER_LEVELS[number]>('proper')
  const [remindAt, setRemindAt] = useState('')
  const [repeat, setRepeat] = useState<'once' | 'daily' | 'weekly' | 'monthly'>('once')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!title || !remindAt) {
      toast('请填写标题和时间', 'error')
      return
    }
    setLoading(true)
    try {
      await unwrap(api.post('/reminder', { title, content, level, remindAt, repeat }))
      toast('提醒已创建', 'success')
      onAdded()
      onClose()
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
        className="relative bg-white w-full max-w-[480px] mx-auto rounded-t-2xl p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">新建提醒</h3>
        <div className="space-y-3">
          <input
            autoFocus
            className="input"
            placeholder="提醒标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="input"
            placeholder="备注（可选）"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div>
            <label className="text-xs text-gray-500">提醒时间</label>
            <input
              type="datetime-local"
              className="input mt-1"
              value={remindAt}
              onChange={(e) => setRemindAt(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">等级</label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {REMINDER_LEVELS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className={`py-2 rounded-lg text-xs border ${
                    level === l ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-gray-200'
                  }`}
                >
                  {reminderLevelMeta[l].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500">重复</label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {(['once', 'daily', 'weekly', 'monthly'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRepeat(r)}
                  className={`py-2 rounded-lg text-xs border ${
                    repeat === r ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-gray-200'
                  }`}
                >
                  {r === 'once' ? '单次' : r === 'daily' ? '每天' : r === 'weekly' ? '每周' : '每月'}
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
