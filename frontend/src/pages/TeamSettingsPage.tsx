import { useEffect, useState } from 'react'
import { Plus, Trash2, Shield, Users } from 'lucide-react'
import Header from '../components/Header'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

interface Department {
  id: string
  name: string
  description?: string | null
  leaderId?: string | null
  leader?: { id: string; nickname?: string | null } | null
  members: Array<{ id: string; nickname?: string | null; employeeRole: string }>
  createdAt: string
}

interface TeamMember {
  id: string
  nickname?: string | null
  avatar?: string | null
  phone?: string | null
  employeeRole: string
  departmentId?: string | null
  department?: { id: string; name: string } | null
  supervisorId?: string | null
  createdAt: string
  _count: { tasks: number }
}

const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  user:       { label: '成员', color: 'text-gray-600',  bg: 'bg-gray-100' },
  supervisor: { label: '主管', color: 'text-blue-600',   bg: 'bg-blue-100' },
  boss:       { label: '老板', color: 'text-orange-600', bg: 'bg-orange-100' },
}

const getDepartments = () => unwrap<Department[]>(api.get('/team/departments'))
const createDepartment = (body: any) => unwrap<Department>(api.post('/team/departments', body))
const deleteDepartment = (id: string) => unwrap<null>(api.delete(`/team/departments/${id}`))
const getMembers = () => unwrap<TeamMember[]>(api.get('/team/members'))
const updateRole = (id: string, body: any) => unwrap<any>(api.patch(`/team/members/${id}/role`, body))
const transferTasks = (fromId: string, newOwnerId: string) =>
  unwrap<any>(api.post(`/team/members/${fromId}/transfer`, { newOwnerId }))

export default function TeamSettingsPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()

  const [depts, setDepts] = useState<Department[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'members' | 'departments'>('members')
  const [showCreateDept, setShowCreateDept] = useState(false)
  const [editingRole, setEditingRole] = useState<TeamMember | null>(null)
  const [transferFrom, setTransferFrom] = useState<TeamMember | null>(null)

  const refresh = async () => {
    setLoading(true); setError(null)
    try {
      const [d, m] = await Promise.all([getDepartments(), getMembers()])
      setDepts(d); setMembers(m)
    } catch (e: any) { setError(e?.message || '加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  if (loading) return <><Header title="团队设置" /><LoadingState /></>
  if (error) return <><Header title="团队设置" /><ErrorState text={error} onRetry={refresh} /></>

  return (
    <div className="pb-10">
      <Header title="团队设置" right={
        tab === 'departments' ? (
          <button onClick={() => setShowCreateDept(true)} className="btn-primary text-sm flex items-center gap-1">
            <Plus size={16} /> 新建部门
          </button>
        ) : null
      } />

      <div className="flex border-b border-gray-100 bg-white sticky top-[56px] z-10">
        {(['members', 'departments'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm flex items-center justify-center gap-1 ${
              tab === t ? 'text-primary-600 border-b-2 border-primary-500 font-medium' : 'text-gray-500'
            }`}>
            {t === 'members' ? <Users size={14} /> : <Shield size={14} />}
            {t === 'members' ? `成员 (${members.length})` : `部门 (${depts.length})`}
          </button>
        ))}
      </div>

      {tab === 'members' ? (
        members.length === 0 ? <EmptyState text="还没有团队成员" /> : (
          <div className="divide-y divide-gray-50">
            {members.map((m) => {
              const rm = ROLE_META[m.employeeRole] || ROLE_META.user
              return (
                <div key={m.id} className="px-4 py-3 flex items-center gap-3 bg-white">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-lg text-gray-600">
                    {(m.nickname || '?')[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{m.nickname || '未命名'}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${rm.bg} ${rm.color}`}>{rm.label}</span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-2">
                      <span>{m.department?.name || '无部门'}</span>
                      <span>·</span>
                      <span>任务 {m._count.tasks}</span>
                    </div>
                  </div>
                  <button onClick={() => setEditingRole(m)} className="text-xs text-primary-600 hover:text-primary-700 px-2 py-1">
                    改角色
                  </button>
                  {m._count.tasks > 0 && (
                    <button onClick={() => setTransferFrom(m)} className="text-xs text-orange-600 hover:text-orange-700 px-2 py-1">
                      转移
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )
      ) : (
        depts.length === 0 ? <EmptyState text="还没有部门，点右上角新建" /> : (
          <div className="px-4 space-y-3 pt-3">
            {depts.map((d) => (
              <div key={d.id} className="bg-white rounded-lg border border-gray-100 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-sm">{d.name}</div>
                    {d.description && <div className="text-xs text-gray-500 mt-0.5">{d.description}</div>}
                  </div>
                  <button onClick={async () => {
                    const ok = await confirm({ title: '删除部门', message: `删除「${d.name}」？部门成员会自动脱离（不会删人）。` })
                    if (ok) { await deleteDepartment(d.id); toast('部门已删除', 'success'); refresh() }
                  }} className="text-red-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  主管：{d.leader?.nickname || '未设'} · 成员：{d.members.length} 人
                </div>
                {d.members.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {d.members.map((m) => {
                      const rm = ROLE_META[m.employeeRole] || ROLE_META.user
                      return (
                        <span key={m.id} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px]">
                          {m.nickname}{m.employeeRole !== 'user' && <span className={`ml-1 ${rm.color}`}>({rm.label})</span>}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {showCreateDept && <CreateDeptDialog members={members} onClose={() => setShowCreateDept(false)}
        onSubmit={async (body) => {
          await createDepartment(body); toast('部门已创建', 'success')
          setShowCreateDept(false); refresh()
        }} />}

      {editingRole && <EditRoleDialog member={editingRole} onClose={() => setEditingRole(null)}
        onSubmit={async (body) => {
          await updateRole(editingRole.id, body); toast('已更新', 'success')
          setEditingRole(null); refresh()
        }} />}

      {transferFrom && <TransferDialog from={transferFrom} members={members.filter((m) => m.id !== transferFrom.id)}
        onClose={() => setTransferFrom(null)}
        onSubmit={async (newOwnerId) => {
          const r = await transferTasks(transferFrom.id, newOwnerId)
          toast(`已转移 ${r.transferredTasks} 个任务`, 'success')
          setTransferFrom(null); refresh()
        }} />}
    </div>
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

function CreateDeptDialog({ members, onClose, onSubmit }: {
  members: TeamMember[]; onClose: () => void; onSubmit: (body: any) => Promise<void>
}) {
  const [form, setForm] = useState({ name: '', description: '', leaderId: '' })
  return (
    <Dialog title="新建部门" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500">部门名称 *</label>
          <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-gray-500">描述</label>
          <input className="input mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-gray-500">主管（可选）</label>
          <select className="input mt-1" value={form.leaderId} onChange={(e) => setForm({ ...form, leaderId: e.target.value })}>
            <option value="">暂不指定</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.nickname}</option>)}
          </select>
        </div>
      </div>
      <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
        <button onClick={onClose} className="btn-secondary flex-1">取消</button>
        <button disabled={!form.name.trim()} onClick={() => onSubmit({ ...form, leaderId: form.leaderId || undefined })}
          className="btn-primary flex-1 disabled:opacity-50">创建</button>
      </div>
    </Dialog>
  )
}

function EditRoleDialog({ member, onClose, onSubmit }: {
  member: TeamMember; onClose: () => void; onSubmit: (body: any) => Promise<void>
}) {
  const [role, setRole] = useState(member.employeeRole)
  const [deptId, setDeptId] = useState(member.departmentId || '')
  return (
    <Dialog title={`修改 ${member.nickname || '成员'} 的角色`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500">角色</label>
          <select className="input mt-1" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">成员</option>
            <option value="supervisor">主管</option>
            <option value="boss">老板</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500">部门 ID</label>
          <input className="input mt-1" value={deptId} onChange={(e) => setDeptId(e.target.value)} placeholder="留空=无部门" />
          <div className="text-[10px] text-gray-400 mt-1">创建部门后在列表里能看到部门 ID</div>
        </div>
      </div>
      <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
        <button onClick={onClose} className="btn-secondary flex-1">取消</button>
        <button onClick={() => onSubmit({ employeeRole: role, departmentId: deptId || undefined })}
          className="btn-primary flex-1">保存</button>
      </div>
    </Dialog>
  )
}

function TransferDialog({ from, members, onClose, onSubmit }: {
  from: TeamMember; members: TeamMember[]; onClose: () => void; onSubmit: (id: string) => Promise<void>
}) {
  const [toId, setToId] = useState('')
  return (
    <Dialog title={`转移 ${from.nickname} 的团队任务`} onClose={onClose}>
      <div className="text-xs text-gray-500 mb-3">
        将把此人名下所有团队任务（创建者+归属人）一次性转给接手人。操作不可撤销。
      </div>
      <div>
        <label className="text-xs text-gray-500">接手人</label>
        <select className="input mt-1" value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">-- 选择接手人 --</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.nickname}</option>)}
        </select>
      </div>
      <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
        <button onClick={onClose} className="btn-secondary flex-1">取消</button>
        <button disabled={!toId} onClick={() => onSubmit(toId)}
          className="btn-primary flex-1 disabled:opacity-50">确认转移</button>
      </div>
    </Dialog>
  )
}
