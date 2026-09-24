import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Check, ArrowRightCircle, Pause, AlertTriangle,
  ArrowRight, Trash2, Filter, Users,
} from 'lucide-react'
import Header from '../components/Header'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

/** 团队任务 */
interface TeamTask {
  id: string
  title: string
  description?: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'paused' | 'overdue'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueDate?: string | null
  assigneeId?: string | null
  origin: 'personal' | 'team'
  remark?: string | null
  completedAt?: string | null
  createdAt: string
  updatedAt: string
  assignee?: { id: string; nickname?: string | null; avatar?: string | null } | null
  user: { id: string; nickname?: string | null; avatar?: string | null }
}

interface TeamTaskList {
  grouped: boolean
  tasks?: TeamTask[]
  groups?: Record<string, { assignee: any; tasks: TeamTask[] }>
}

interface MemberBrief { id: string; nickname?: string | null; avatar?: string | null }

const STATUS_META: Record<TeamTask['status'], { label: string; color: string; bg: string; border: string }> = {
  pending:     { label: '待开始', color: 'text-gray-500',  bg: 'bg-gray-100',   border: 'border-gray-300' },
  in_progress: { label: '进行中', color: 'text-blue-600',   bg: 'bg-blue-50',    border: 'border-blue-300' },
  completed:   { label: '已完成', color: 'text-green-600',  bg: 'bg-green-50',   border: 'border-green-300' },
  paused:      { label: '已暂停', color: 'text-yellow-600', bg: 'bg-yellow-50',  border: 'border-yellow-300' },
  overdue:     { label: '已逾期', color: 'text-red-600',    bg: 'bg-red-50',     border: 'border-red-300' },
}
const PRIORITY_META = {
  low:    { label: '低',   color: 'text-gray-500',  bg: 'bg-gray-100' },
  medium: { label: '中',   color: 'text-blue-600',   bg: 'bg-blue-50' },
  high:   { label: '高',   color: 'text-orange-600', bg: 'bg-orange-50' },
  urgent: { label: '紧急', color: 'text-red-600',    bg: 'bg-red-50' },
}

const listTasks = (params?: Record<string, any>) => unwrap<TeamTaskList>(api.get('/task-team', { params }))
const createTask = (body: any) => unwrap<TeamTask>(api.post('/task-team', body))
const updateStatus = (id: string, status: string, remark?: string) =>
  unwrap<TeamTask>(api.patch(`/task-team/${id}/status`, { status, remark }))
const reassignTask = (id: string, assigneeId: string, remark?: string) =>
  unwrap<TeamTask>(api.patch(`/task-team/${id}/reassign`, { assigneeId, remark }))
const deleteTask = (id: string) => unwrap<null>(api.delete(`/task-team/${id}`))
const getMembers = () => unwrap<MemberBrief[]>(api.get('/team/members'))

export default function TeamTasksPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<TeamTaskList | null>(null)
  const [members, setMembers] = useState<MemberBrief[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showDetail, setShowDetail] = useState<string | null>(null)
  const [showReassign, setShowReassign] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [grouped, setGrouped] = useState(true)

  const refresh = async () => {
    setLoading(true); setError(null)
    try {
      const params: Record<string, any> = { grouped: grouped ? 'assignee' : undefined, origin: 'all' }
      if (statusFilter.length) params.status = statusFilter
      if (overdueOnly) params.overdueOnly = 'true'
      const [list, mems] = await Promise.all([listTasks(params), getMembers()])
      setData(list); setMembers(mems)
    } catch (e: any) { setError(e?.message || '加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [grouped, JSON.stringify(statusFilter), overdueOnly])

  const toggleStatus = (s: string) =>
    setStatusFilter((arr) => arr.includes(s) ? arr.filter((x) => x !== s) : [...arr, s])

  const currentDetail = showDetail
    ? (data?.grouped
        ? Object.values(data.groups || {}).flatMap((g) => g.tasks).find((t) => t.id === showDetail)
        : data?.tasks?.find((t) => t.id === showDetail))
    : null

  const stats = useMemo(() => {
    const all = data?.grouped ? Object.values(data.groups || {}).flatMap((g) => g.tasks) : data?.tasks || []
    return {
      total: all.length,
      pending: all.filter((t) => t.status === 'pending').length,
      inProgress: all.filter((t) => t.status === 'in_progress').length,
      completed: all.filter((t) => t.status === 'completed').length,
      overdue: all.filter((t) => t.status === 'overdue').length,
    }
  }, [data])

  if (loading) return <><Header title="团队任务" /><LoadingState /></>
  if (error) return <><Header title="团队任务" /><ErrorState text={error} onRetry={refresh} /></>

  return (
    <div className="pb-8">
      <Header title="团队任务" right={
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm flex items-center gap-1">
          <Plus size={16} /> 新建任务
        </button>
      } />

      <div className="px-4 grid grid-cols-5 gap-2 mb-4">
        <StatCard label="全部" value={stats.total} />
        <StatCard label="待开始" value={stats.pending} color="text-gray-600" />
        <StatCard label="进行中" value={stats.inProgress} color="text-blue-600" />
        <StatCard label="已完成" value={stats.completed} color="text-green-600" />
        <StatCard label="逾期" value={stats.overdue} color="text-red-600" />
      </div>

      <div className="px-4 mb-3">
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="text-gray-500 flex items-center gap-1"><Filter size={12} /> 状态：</span>
          {(['pending', 'in_progress', 'completed', 'paused', 'overdue'] as const).map((s) => {
            const active = statusFilter.includes(s)
            const meta = STATUS_META[s]
            return (
              <button key={s} onClick={() => toggleStatus(s)}
                className={`px-2 py-0.5 rounded text-[11px] border ${active ? `${meta.bg} ${meta.color} ${meta.border}` : 'border-gray-200 text-gray-400'}`}>
                {meta.label}
              </button>
            )
          })}
          <span className="mx-1 text-gray-300">|</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            <span>只看逾期</span>
          </label>
          <button onClick={() => setGrouped(!grouped)} className="ml-auto text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <Users size={12} /> {grouped ? '按归属人分组' : '不分组'}
          </button>
        </div>
      </div>

      {!data || stats.total === 0 ? (
        <EmptyState text="还没有团队任务，点右上角新建一个吧" />
      ) : data.grouped && data.groups ? (
        <div className="px-4 space-y-5">
          {Object.entries(data.groups).map(([key, { assignee, tasks }]) => (
            <div key={key}>
              <div className="flex items-center gap-2 mb-2 text-sm">
                <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">
                  {(assignee?.nickname || '?')[0]}
                </div>
                <span className="font-medium">{assignee?.nickname || '未分配'}</span>
                <span className="text-xs text-gray-400">（{tasks.length}）</span>
              </div>
              <div className="space-y-2">
                {tasks.map((t) => (
                  <TaskCard key={t.id} task={t} onOpen={() => setShowDetail(t.id)}
                    onStatus={async (s) => { await updateStatus(t.id, s); toast('状态已更新', 'success'); refresh() }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 space-y-2">
          {data.tasks?.map((t) => (
            <TaskCard key={t.id} task={t} onOpen={() => setShowDetail(t.id)}
              onStatus={async (s) => { await updateStatus(t.id, s); toast('状态已更新', 'success'); refresh() }} />
          ))}
        </div>
      )}

      {showCreate && <CreateTaskDialog members={members} onClose={() => setShowCreate(false)}
        onSubmit={async (body) => {
          await createTask(body); toast('任务已创建', 'success')
          setShowCreate(false); refresh()
        }} />}

      {currentDetail && (
        <TaskDetailDialog task={currentDetail} onClose={() => setShowDetail(null)}
          onStatus={async (s) => { await updateStatus(currentDetail.id, s); toast('状态已更新', 'success'); refresh(); setShowDetail(null) }}
          onReassign={() => { setShowReassign(currentDetail.id); setShowDetail(null) }}
          onDelete={async () => {
            const ok = await confirm({ title: '确认删除', message: `确定删除「${currentDetail.title}」吗？` })
            if (ok) { await deleteTask(currentDetail.id); toast('已删除', 'success'); refresh(); setShowDetail(null) }
          }} />
      )}

      {showReassign && (
        <ReassignDialog members={members} onClose={() => setShowReassign(null)}
          onSubmit={async (assigneeId) => {
            await reassignTask(showReassign, assigneeId); toast('已重新分配', 'success')
            setShowReassign(null); refresh()
          }} />
      )}
    </div>
  )
}

function StatCard({ label, value, color = 'text-gray-800' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 px-2 py-3 text-center">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{label}</div>
    </div>
  )
}

function TaskCard({ task, onOpen, onStatus }: { task: TeamTask; onOpen: () => void; onStatus: (s: string) => void }) {
  const sm = STATUS_META[task.status]
  const pm = PRIORITY_META[task.priority]
  return (
    <div onClick={onOpen} className="bg-white rounded-lg border border-gray-100 p-3 cursor-pointer hover:border-primary-300 hover:shadow-sm transition">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${pm.bg} ${pm.color}`}>{pm.label}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${sm.bg} ${sm.color}`}>{sm.label}</span>
            {task.status === 'overdue' && <AlertTriangle size={12} className="text-red-500" />}
          </div>
          <div className="font-medium text-sm truncate">{task.title}</div>
          {task.dueDate && (
            <div className="text-[11px] text-gray-400 mt-1">截止：{new Date(task.dueDate).toLocaleDateString()}</div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {task.status === 'pending' && (
            <button onClick={(e) => { e.stopPropagation(); onStatus('in_progress') }}
              className="p-1 rounded hover:bg-blue-50 text-blue-500" title="开始"><ArrowRightCircle size={14} /></button>
          )}
          {task.status === 'in_progress' && (
            <button onClick={(e) => { e.stopPropagation(); onStatus('completed') }}
              className="p-1 rounded hover:bg-green-50 text-green-500" title="完成"><Check size={14} /></button>
          )}
          {(task.status === 'pending' || task.status === 'in_progress') && (
            <button onClick={(e) => { e.stopPropagation(); onStatus('paused') }}
              className="p-1 rounded hover:bg-yellow-50 text-yellow-500" title="暂停"><Pause size={14} /></button>
          )}
          {task.status === 'paused' && (
            <button onClick={(e) => { e.stopPropagation(); onStatus('in_progress') }}
              className="p-1 rounded hover:bg-blue-50 text-blue-500" title="继续"><ArrowRight size={14} /></button>
          )}
        </div>
      </div>
    </div>
  )
}

function CreateTaskDialog({ members, onClose, onSubmit }: {
  members: MemberBrief[]; onClose: () => void; onSubmit: (body: any) => Promise<void>
}) {
  const [form, setForm] = useState({
    title: '', description: '', dueDate: '', priority: 'medium' as const,
    assigneeId: '' as string, origin: 'team' as const, remark: '',
  })
  const [submitting, setSubmitting] = useState(false)

  return (
    <Dialog title="新建团队任务" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500">标题 *</label>
          <input className="input mt-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-gray-500">描述</label>
          <textarea className="input mt-1 min-h-[60px]" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">优先级</label>
            <select className="input mt-1" value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as any })}>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">截止日期</label>
            <input type="date" className="input mt-1" value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500">归属人（默认自己）</label>
          <select className="input mt-1" value={form.assigneeId}
            onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
            <option value="">给自己</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.nickname}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500">备注</label>
          <textarea className="input mt-1 min-h-[40px]" value={form.remark}
            onChange={(e) => setForm({ ...form, remark: e.target.value })} />
        </div>
      </div>
      <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
        <button onClick={onClose} className="btn-secondary flex-1">取消</button>
        <button onClick={async () => {
          if (!form.title.trim()) return
          setSubmitting(true)
          try { await onSubmit({ ...form, assigneeId: form.assigneeId || undefined, dueDate: form.dueDate || undefined }) }
          finally { setSubmitting(false) }
        }} disabled={submitting} className="btn-primary flex-1 disabled:opacity-50">
          {submitting ? '提交中...' : '创建'}
        </button>
      </div>
    </Dialog>
  )
}

function TaskDetailDialog({ task, onClose, onStatus, onReassign, onDelete }: {
  task: TeamTask; onClose: () => void;
  onStatus: (s: string) => Promise<void>; onReassign: () => void; onDelete: () => void
}) {
  const sm = STATUS_META[task.status]
  const pm = PRIORITY_META[task.priority]
  return (
    <Dialog title="任务详情" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded text-[11px] ${pm.bg} ${pm.color}`}>{pm.label}优先级</span>
          <span className={`px-2 py-0.5 rounded text-[11px] ${sm.bg} ${sm.color}`}>{sm.label}</span>
        </div>
        <div>
          <div className="font-medium text-base">{task.title}</div>
          {task.description && <div className="text-gray-500 mt-1 whitespace-pre-wrap">{task.description}</div>}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-gray-400">创建人：</span>{task.user.nickname || '未命名'}</div>
          {task.assignee && <div><span className="text-gray-400">归属人：</span>{task.assignee.nickname}</div>}
          {task.dueDate && <div><span className="text-gray-400">截止：</span>{new Date(task.dueDate).toLocaleDateString()}</div>}
          {task.completedAt && <div><span className="text-gray-400">完成：</span>{new Date(task.completedAt).toLocaleDateString()}</div>}
          <div><span className="text-gray-400">来源：</span>{task.origin === 'team' ? '团队' : '私人'}</div>
        </div>
        {task.remark && <div><span className="text-xs text-gray-400">备注：</span><div className="text-gray-600 mt-0.5 whitespace-pre-wrap">{task.remark}</div></div>}
      </div>
      <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2 flex-wrap">
        {task.status !== 'overdue' && task.status !== 'completed' && (
          <>
            {task.status === 'pending' && <button onClick={() => onStatus('in_progress')} className="btn-secondary text-xs">开始</button>}
            {task.status === 'in_progress' && <button onClick={() => onStatus('completed')} className="btn-primary text-xs">标记完成</button>}
            <button onClick={() => onStatus(task.status === 'paused' ? 'in_progress' : 'paused')} className="btn-secondary text-xs">
              {task.status === 'paused' ? '继续' : '暂停'}
            </button>
          </>
        )}
        <button onClick={onReassign} className="btn-secondary text-xs">重新分配</button>
        <button onClick={onDelete} className="text-red-500 text-xs flex items-center gap-1 ml-auto"><Trash2 size={12} /> 删除</button>
      </div>
    </Dialog>
  )
}

function ReassignDialog({ members, onClose, onSubmit }: {
  members: MemberBrief[]; onClose: () => void; onSubmit: (id: string) => Promise<void>
}) {
  const [selected, setSelected] = useState('')
  const [submitting, setSubmitting] = useState(false)
  return (
    <Dialog title="重新分配归属人" onClose={onClose}>
      <div>
        <label className="text-xs text-gray-500">选择新归属人</label>
        <select className="input mt-1" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">-- 请选择 --</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.nickname}</option>)}
        </select>
      </div>
      <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
        <button onClick={onClose} className="btn-secondary flex-1">取消</button>
        <button disabled={!selected || submitting} onClick={async () => {
          setSubmitting(true); try { await onSubmit(selected) } finally { setSubmitting(false) }
        }} className="btn-primary flex-1 disabled:opacity-50">
          {submitting ? '提交中...' : '确认'}
        </button>
      </div>
    </Dialog>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 flex items-center justify-between border-b border-gray-100">
          <h3 className="font-medium">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}
