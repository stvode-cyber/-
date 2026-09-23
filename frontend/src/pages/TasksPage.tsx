import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Check, Trash2, ChevronDown, ChevronRight, Edit3, Clock, Timer, ListTodo, X, Monitor, PawPrint, CalendarClock, Bell, StickyNote, Sparkles } from 'lucide-react'
import Header from '../components/Header'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { formatDateTime, priorityMeta } from '../lib/utils'
import { communityCategoryMeta } from '../lib/constants'
import { isDesktop } from '../lib/localCache'
import { ReminderListPanel } from './RemindersPage'

interface Task {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  progress: number
  dueDate?: string | null
  category?: string
  important: boolean
  createdAt: string
}

/**
 * 任务日程页（待办 + 提醒 合并入口）
 *
 * 功能：
 * 0. 视图切换：待办 / 提醒（提醒原为独立页，已并入）
 * 1. Tab 切换：全部 / 待办 / 已完成
 * 2. 点击任务展开详情：可调整进度（0-100% 滑块）、查看描述、截止时间
 * 3. 列表项支持：完成 / 取消完成 / 删除
 * 4. 新建任务/提醒（底部弹层，按当前视图触发）
 */
export default function TasksPage() {
  const toast = useToast((s) => s.show)
  const desktop = isDesktop()
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<'all' | 'todo' | 'done'>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [showFloatMenu, setShowFloatMenu] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // 编辑中的进度值（实时更新滑块，但失焦后才提交）
  const [editProgress, setEditProgress] = useState<number | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  // 视图：tasks=待办任务 / reminders=提醒（URL ?view=reminders 直达）
  const [view, setView] = useState<'tasks' | 'reminders'>(
    searchParams.get('view') === 'reminders' ? 'reminders' : 'tasks',
  )
  // 提醒新增触发信号（递增时 ReminderListPanel 打开新建弹层）
  const [reminderAddTrigger, setReminderAddTrigger] = useState(0)
  const float = searchParams.get('float') === '1'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // 桌面浮窗选项（统一入口，在任务页 Header 下拉菜单里）
  const floatOptions = [
    { key: 'pet', label: '宠物', icon: PawPrint, toggle: () => (window as any).desktopAPI?.togglePetWindow?.() },
    { key: 'countdown', label: '倒计时', icon: CalendarClock, toggle: () => (window as any).desktopAPI?.toggleCountdownWindow?.() },
    { key: 'todo', label: '待办', icon: ListTodo, toggle: () => (window as any).desktopAPI?.toggleTodoWindow?.() },
    { key: 'reminder', label: '提醒', icon: Bell, toggle: () => (window as any).desktopAPI?.toggleReminderWindow?.() },
    { key: 'sticky', label: '便签', icon: StickyNote, toggle: () => (window as any).desktopAPI?.toggleStickyWindow?.() },
    { key: 'wallpaper', label: '壁纸', icon: Sparkles, toggle: () => (window as any).desktopAPI?.toggleWallpaperWindow?.() },
  ]

  useEffect(() => {
    load()
    // 来自 HomePage 快捷入口 ?new=1 → 自动打开新增弹层
    if (searchParams.get('new') === '1') {
      setShowAdd(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [filter])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`
      const list = await unwrap<Task[]>(api.get(`/work/tasks${query}`))
      setTasks(list)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const toggleDone = async (t: Task) => {
    try {
      if (t.status === 'done') {
        await unwrap(api.patch(`/work/tasks/${t.id}`, { status: 'todo', progress: t.progress || 0 }))
      } else {
        await unwrap(api.post(`/work/tasks/${t.id}/done`))
      }
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const remove = async (id: string) => {
    try {
      await unwrap(api.delete(`/work/tasks/${id}`))
      toast('已删除', 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** 展开任务详情时，初始化进度编辑值 */
  const toggleExpand = (t: Task) => {
    if (expandedId === t.id) {
      setExpandedId(null)
      setEditProgress(null)
    } else {
      setExpandedId(t.id)
      setEditProgress(t.progress)
    }
  }

  /** 保存进度（滑块松手时触发） */
  const saveProgress = async (t: Task, progress: number) => {
    try {
      await unwrap(api.patch(`/work/tasks/${t.id}`, { progress }))
      toast(`进度已更新至 ${progress}%`, 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
      setEditProgress(t.progress) // 回滚
    }
  }

  const tabs = [
    { key: 'all', label: '全部' },
    { key: 'todo', label: '待办' },
    { key: 'done', label: '已完成' },
  ] as const

  // ---- 桌面浮窗精简模式（仅显示待办任务，支持快速完成，浮于桌面）----
  if (float) {
    const display = tasks.filter((t) => t.status === 'todo').slice(0, 12)
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
            <ListTodo size={15} className="text-primary-600" />
            <span className="text-sm font-semibold tracking-wide text-gray-800">今日待办</span>
            <span className="text-[10px] text-gray-400 font-normal px-1.5 py-0.5 rounded-full bg-white/60">{display.length}</span>
          </div>
          <button onClick={() => (window as any).desktopAPI?.toggleTodoWindow?.()} className="p-1.5 rounded-full hover:bg-black/5 transition-colors cursor-pointer text-gray-500 hover:text-gray-700" style={{ WebkitAppRegion: 'no-drag' } as any} aria-label="关闭浮窗" title="关闭">
            <X size={14} />
          </button>
        </div>
        {/* 列表区：卡片悬浮态 */}
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {loading ? (
            <div className="text-center text-xs text-gray-400 py-8">加载中…</div>
          ) : display.length === 0 ? (
            <div className="text-center text-xs text-gray-400 py-12">🎉 今日无待办</div>
          ) : (
            display.map((t) => {
              const meta = priorityMeta[t.priority] || priorityMeta.medium
              return (
                <div
                  key={t.id}
                  className="group flex items-start gap-2.5 rounded-2xl p-2.5 transition-all duration-200 hover:-translate-y-0.5"
                  style={{ border: '1px solid rgba(0,0,0,0.05)', background: 'rgba(255,255,255,0.55)' }}
                >
                  <button
                    onClick={() => toggleDone(t)}
                    className="mt-0.5 w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer hover:border-primary-500 group-hover:border-primary-400"
                    aria-label="完成任务"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">{t.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.bg} ${meta.color}`}>{meta.label}</span>
                      {t.dueDate && (
                        <span className="text-[10px] text-gray-400">
                          {new Date(t.dueDate).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
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

  return (
    <div className="app-shell">
      <Header
        title="任务日程"
        right={
          <div className="flex items-center relative">
            {desktop && (
              <button
                onClick={() => setShowFloatMenu((v) => !v)}
                className="p-2 text-gray-500 hover:text-primary-600 transition-colors"
                title="桌面浮窗"
              >
                <Monitor size={18} />
              </button>
            )}
            <button
              onClick={() => (view === 'reminders' ? setReminderAddTrigger((v) => v + 1) : setShowAdd(true))}
              className="p-2 text-primary-600"
            >
              <Plus size={20} />
            </button>
            {showFloatMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowFloatMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-white rounded-xl shadow-2xl border border-gray-100 py-1 overflow-hidden">
                  <div className="px-3 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-50">
                    桌面浮窗
                  </div>
                  {floatOptions.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => { opt.toggle(); setShowFloatMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-primary-50 hover:text-primary-600 transition-colors"
                    >
                      <opt.icon size={16} className="text-gray-400" />
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        }
      />
      {/* 视图切换：待办 / 提醒（QQ 风分段胶囊）+ 浮于桌面入口 */}
      <div className="px-3 pt-3 flex items-center gap-2">
        <div className="flex-1 flex bg-gray-100 rounded-full p-1">
          <button
            onClick={() => setView('tasks')}
            className={`flex-1 py-1.5 rounded-full text-sm transition-colors ${
              view === 'tasks' ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-500'
            }`}
          >
            待办
          </button>
          <button
            onClick={() => setView('reminders')}
            className={`flex-1 py-1.5 rounded-full text-sm transition-colors ${
              view === 'reminders' ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-500'
            }`}
          >
            提醒
          </button>
        </div>
      </div>

      {/* 提醒视图：完整提醒面板（自带 Tab + 等级筛选 + 列表 + 新增弹层） */}
      {view === 'reminders' ? (
        <ReminderListPanel addTrigger={reminderAddTrigger} />
      ) : (
        <>
      <div className="sticky top-12 bg-white z-10 border-b border-gray-100">
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`flex-1 py-3 text-sm border-b-2 ${
                filter === t.key
                  ? 'border-primary-500 text-primary-600 font-medium'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-3 space-y-2">
        {loading ? (
          <LoadingState skeleton count={3} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : tasks.length === 0 ? (
          <EmptyState icon="📝" text="暂无任务" hint="点击右上角 + 创建" />
        ) : (
          tasks.map((t) => {
            const meta = priorityMeta[t.priority] || priorityMeta.medium
            const done = t.status === 'done'
            const expanded = expandedId === t.id
            return (
              <div key={t.id} className="card group">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleDone(t)}
                    className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      done ? 'bg-green-500 border-green-500' : 'border-gray-300'
                    }`}
                  >
                    {done && <Check size={12} className="text-white" />}
                  </button>
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => toggleExpand(t)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-300">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <span className={`text-sm ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {t.important && '🔴 '}{t.title}
                      </span>
                      <span className={`badge ${meta.bg} ${meta.color}`}>{meta.label}</span>
                    </div>
                    {!expanded && t.description && (
                      <div className="text-xs text-gray-500 mt-1 truncate ml-5">{t.description}</div>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 ml-5">
                      {t.dueDate && <TaskCountdown dueDate={t.dueDate} createdAt={t.createdAt} done={done} compact />}
                      <span>📊 {t.progress}%</span>
                      <span className={`badge ${categoryBadge(t.category)}`}>
                        {categoryLabel(t.category)}
                      </span>
                    </div>
                    {/* 进度条（折叠态） */}
                    {!expanded && (
                      <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden ml-5">
                        <div
                          className="h-full bg-primary-500 transition-all"
                          style={{ width: `${t.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => remove(t.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-opacity"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* 展开详情：进度调整 + 描述 */}
                {expanded && (
                  <div className="mt-3 pt-3 border-t border-gray-50 ml-8 space-y-3">
                    {/* 进度滑块 */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-gray-500 flex items-center gap-1">
                          <Edit3 size={12} /> 进度
                        </label>
                        <span className={`text-xs font-medium ${editProgress === 100 ? 'text-green-500' : 'text-primary-600'}`}>
                          {editProgress ?? t.progress}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={editProgress ?? t.progress}
                        onChange={(e) => setEditProgress(Number(e.target.value))}
                        onMouseUp={(e) => saveProgress(t, Number((e.target as HTMLInputElement).value))}
                        onTouchEnd={(e) => saveProgress(t, Number((e.target as HTMLInputElement).value))}
                        className="w-full accent-primary-600"
                        disabled={done}
                      />
                      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                        <span>0%</span>
                        <span>25%</span>
                        <span>50%</span>
                        <span>75%</span>
                        <span>100%</span>
                      </div>
                    </div>

                    {/* 倒计时（展开态） */}
                    {t.dueDate && (
                      <TaskCountdown dueDate={t.dueDate} createdAt={t.createdAt} done={done} />
                    )}

                    {/* 描述 */}
                    {t.description ? (
                      <div>
                        <div className="text-xs text-gray-500 mb-1">描述</div>
                        <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-2">
                          {t.description}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">无描述</div>
                    )}

                    {/* 创建时间 */}
                    <div className="text-xs text-gray-400">
                      创建于 {formatDateTime(t.createdAt)}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {showAdd && <AddTaskModal onClose={() => setShowAdd(false)} onAdded={load} />}
        </>
      )}
    </div>
  )
}

function AddTaskModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast((s) => s.show)
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [dueDate, setDueDate] = useState('')
  const [category, setCategory] = useState('work')
  const [important, setImportant] = useState(false)
  const [loading, setLoading] = useState(false)
  /** 提醒时效：选中的提前量（分钟），null=默认（不设置提醒），-1=自定义 */
  const [remindLead, setRemindLead] = useState<number | null>(null)
  /** 自定义提前量（分钟），配合 remindLead=-1 使用 */
  const [customLead, setCustomLead] = useState('')
  /** 自定义输入框错误提示 */
  const [customLeadError, setCustomLeadError] = useState('')

  // 提醒时效选项（分钟）：准时 / 提前15分 / 30分 / 1小时 / 2小时
  const REMIND_LEAD_OPTIONS: Array<{ value: number; label: string }> = [
    { value: 0, label: '准时' },
    { value: 15, label: '提前15分' },
    { value: 30, label: '提前30分' },
    { value: 60, label: '提前1小时' },
    { value: 120, label: '提前2小时' },
  ]

  /** 校验自定义提前量，返回分钟数；不合法返回 null */
  const parseCustomLead = (): number | null => {
    // 支持纯数字（分钟）和"90分"/"2小时"/"1.5小时"这类写法
    const t = customLead.trim()
    if (!t) return null
    const m = t.match(/^(\d+(?:\.\d+)?)\s*(小时|h|时|分钟|分|m)?$/i)
    if (!m) return null
    const n = parseFloat(m[1])
    if (!Number.isFinite(n) || n <= 0 || n > 24 * 60) return null
    return m[2] && /小时|^h$|时/i.test(m[2]) ? Math.round(n * 60) : Math.round(n)
  }

  const submit = async () => {
    if (!title.trim()) {
      toast('请输入任务标题', 'error')
      return
    }
    // 自定义模式下先校验输入
    let effectiveLead = remindLead
    if (remindLead === -1) {
      const parsed = parseCustomLead()
      if (parsed === null) {
        setCustomLeadError('请输入 1-1440 之间的分钟数，或如"2小时"的写法')
        return
      }
      effectiveLead = parsed
    }
    setLoading(true)
    try {
      // 根据提醒时效计算 remindAt：截止时间往前推 N 分钟；未选或没填截止时间则不设置
      let remindAt: string | undefined
      if (effectiveLead !== null && dueDate) {
        const due = new Date(dueDate)
        remindAt = new Date(due.getTime() - effectiveLead * 60_000).toISOString()
      }
      await unwrap(api.post('/work/tasks', {
        title,
        priority,
        dueDate: dueDate || undefined,
        remindAt,
        category,
        important,
      }))
      toast('任务已创建', 'success')
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
        <h3 className="text-lg font-semibold mb-4">新建任务</h3>
        <div className="space-y-3">
          <input
            autoFocus
            className="input"
            placeholder="任务标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div>
            <label className="text-xs text-gray-500">优先级</label>
            <div className="flex gap-2 mt-1">
              {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-2 rounded-lg text-xs border ${
                    priority === p ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {priorityMeta[p].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500">截止时间</label>
            <input
              type="datetime-local"
              className="input mt-1 cursor-pointer"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              onClick={(e) => { try { (e.target as HTMLInputElement).showPicker?.() } catch { /* ignore */ } }}
              onFocus={(e) => { try { e.target.showPicker() } catch { /* ignore */ } }}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">
              提醒时效
              <span className="text-gray-400">（不选则默认不提醒）</span>
            </label>
            <div className="flex gap-1.5 mt-1">
              <button
                onClick={() => { setRemindLead(null); setCustomLeadError('') }}
                className={`flex-1 py-1.5 rounded-lg text-xs border ${
                  remindLead === null ? 'border-gray-300 bg-gray-50 text-gray-700 font-medium' : 'border-gray-200 text-gray-400'
                }`}
              >
                默认
              </button>
              {REMIND_LEAD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setRemindLead(opt.value); setCustomLeadError('') }}
                  disabled={!dueDate}
                  title={!dueDate ? '请先选择截止时间' : undefined}
                  className={`flex-1 py-1.5 rounded-lg text-xs border disabled:opacity-40 disabled:cursor-not-allowed ${
                    remindLead === opt.value ? 'border-primary-500 bg-primary-50 text-primary-600 font-medium' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <button
                onClick={() => { setRemindLead(remindLead === -1 ? null : -1); setCustomLeadError('') }}
                disabled={!dueDate}
                title={!dueDate ? '请先选择截止时间' : undefined}
                className={`flex-1 py-1.5 rounded-lg text-xs border disabled:opacity-40 disabled:cursor-not-allowed ${
                  remindLead === -1 ? 'border-primary-500 bg-primary-50 text-primary-600 font-medium' : 'border-gray-200 text-gray-500'
                }`}
              >
                自定义
              </button>
            </div>
            {remindLead === -1 && (
              <div className="mt-1.5">
                <input
                  autoFocus
                  className={`input text-sm ${customLeadError ? 'border-red-400' : ''}`}
                  placeholder="提前量，如 45、90分、2小时"
                  value={customLead}
                  onChange={(e) => { setCustomLead(e.target.value); setCustomLeadError('') }}
                />
                {customLeadError ? (
                  <p className="text-xs text-red-500 mt-1">{customLeadError}</p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">纯数字按分钟算，也可写"2小时"</p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500">分类</label>
            <div className="flex gap-2 mt-1">
              {['work', 'life', 'finance'].map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`flex-1 py-2 rounded-lg text-xs border ${
                    category === c ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {c === 'work' ? '工作' : c === 'life' ? '生活' : '财务'}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={important}
              onChange={(e) => setImportant(e.target.checked)}
              className="w-4 h-4 accent-primary-600"
            />
            标记为重要事项
          </label>
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

/** 任务分类 → 中文标签（复用 communityCategoryMeta） */
function categoryLabel(cat?: string): string {
  return communityCategoryMeta[cat || '']?.label || '其他'
}

/** 任务分类 → 徽章配色（复用 communityCategoryMeta） */
function categoryBadge(cat?: string): string {
  return communityCategoryMeta[cat || '']?.color || 'bg-gray-100 text-gray-600'
}

/**
 * 任务倒计时组件
 *
 * 功能：
 * - 实时显示距离截止时间的剩余时间（每秒更新）
 * - 紧迫度颜色分级（红 < 1天 / 橙 < 3天 / 灰 > 3天）
 * - 时间进度条展示时间流逝感
 * - compact 模式：折叠态简短徽章
 * - 完整模式：展开态详细倒计时 + 进度条
 */
function TaskCountdown({
  dueDate,
  createdAt,
  done,
  compact,
}: {
  dueDate: string
  createdAt?: string
  done?: boolean
  compact?: boolean
}) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const target = new Date(dueDate).getTime()
  const diff = target - now
  const isPast = diff < 0
  const absDiff = Math.abs(diff)

  const days = Math.floor(absDiff / 86400000)
  const hours = Math.floor((absDiff % 86400000) / 3600000)
  const minutes = Math.floor((absDiff % 3600000) / 60000)
  const seconds = Math.floor((absDiff % 60000) / 1000)

  // 时间流逝进度
  let timeProgress = 0
  if (createdAt) {
    const created = new Date(createdAt).getTime()
    const total = target - created
    if (total > 0) {
      timeProgress = Math.min(100, Math.max(0, ((now - created) / total) * 100))
    } else if (isPast) {
      timeProgress = 100
    }
  }

  // 紧迫度样式 + 时间文本
  let timeText = ''
  let prefix = '📅'
  let textColor = 'text-gray-500'
  let bgColor = 'bg-gray-50'
  let barColor = 'bg-gray-400'
  let pulse = false

  if (done) {
    timeText = '已完成'
    prefix = '✅'
  } else if (isPast) {
    textColor = 'text-red-600'
    bgColor = 'bg-red-50'
    barColor = 'bg-red-500'
    prefix = '‼️'
    if (days > 0) timeText = `超期${days}天${hours}小时`
    else if (hours > 0) timeText = `超期${hours}小时${minutes}分`
    else timeText = `超期${minutes}分${seconds}秒`
  } else if (diff < 3600000) {
    textColor = 'text-red-600'
    bgColor = 'bg-red-50'
    barColor = 'bg-red-500'
    prefix = '🔴'
    pulse = true
    timeText = `${minutes}分${seconds}秒`
  } else if (diff < 86400000) {
    textColor = 'text-red-500'
    bgColor = 'bg-red-50'
    barColor = 'bg-red-400'
    prefix = '⏰'
    timeText = `${hours}小时${minutes}分`
  } else if (diff < 259200000) {
    textColor = 'text-amber-600'
    bgColor = 'bg-amber-50'
    barColor = 'bg-amber-400'
    prefix = '⏳'
    timeText = `${days}天${hours}小时`
  } else {
    timeText = `${days}天${hours}小时`
  }

  // 紧凑模式
  if (compact) {
    return (
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ${bgColor} ${textColor} text-[11px] font-medium`}>
        <Clock size={10} />
        {prefix} {timeText}
      </span>
    )
  }

  // 完整模式
  return (
    <div className={`rounded-lg p-3 ${bgColor}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Timer size={14} className={textColor} />
          <span className={`text-xs font-medium ${textColor}`}>
            {done ? '已完成' : isPast ? '已超期' : '倒计时'}
          </span>
        </div>
        <span className={`text-base font-bold tabular-nums ${textColor} ${pulse ? 'animate-pulse' : ''}`}>
          {timeText}
        </span>
      </div>
      {createdAt && !done && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
            <span>时间流逝</span>
            <span>{Math.round(timeProgress)}%</span>
          </div>
          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
            <div
              className={`h-full ${barColor} rounded-full transition-all duration-1000`}
              style={{ width: `${timeProgress}%` }}
            />
          </div>
        </div>
      )}
      <div className="mt-1.5 text-[10px] text-gray-400">
        截止时间：{formatDateTime(dueDate)}
      </div>
    </div>
  )
}
