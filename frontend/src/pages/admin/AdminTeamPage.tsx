import { useEffect, useState } from 'react'
import { Building2, Users, UserCog, Crown } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { LoadingState, ErrorState } from '../../components/StateView'

interface AdminUser {
  id: string; username: string; nickname?: string | null;
  employeeRole?: string | null; departmentId?: string | null;
  department?: { id: string; name: string } | null;
  createdAt: string;
}

const roleLabel = (r?: string | null) => r === 'boss' ? '老板' : r === 'supervisor' ? '主管' : '员工'
const roleColor = (r?: string | null) =>
  r === 'boss' ? 'bg-amber-100 text-amber-700'
  : r === 'supervisor' ? 'bg-blue-100 text-blue-700'
  : 'bg-gray-100 text-gray-600'

export default function AdminTeamPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null)
      try {
        const u = await unwrap<AdminUser[]>(api.get('/admin/users', { params: { pageSize: 200 } }))
        setUsers(u || [])
      } catch (e: any) { setError(e?.message || '加载失败') }
      finally { setLoading(false) }
    })()
  }, [])

  if (loading) return <LoadingState />
  if (error) return <ErrorState text={error} />

  // 按部门分组
  const byDept = new Map<string | null, AdminUser[]>()
  for (const u of users) {
    const key = u.department?.name || u.departmentId || null
    if (!byDept.has(key)) byDept.set(key, [])
    byDept.get(key)!.push(u)
  }
  const deptList = Array.from(byDept.entries()).sort((a, b) => (a[0] || '').localeCompare(b[0] || ''))

  // 全局统计
  const stats = {
    total: users.length,
    boss: users.filter((u) => u.employeeRole === 'boss').length,
    supervisor: users.filter((u) => u.employeeRole === 'supervisor').length,
    staff: users.filter((u) => u.employeeRole !== 'boss' && u.employeeRole !== 'supervisor').length,
    noDept: users.filter((u) => !u.departmentId).length,
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Building2 className="text-emerald-600" />
          团队管理
        </h1>
        <p className="text-sm text-gray-500 mt-1">部门分组 · 成员角色一览</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat2 icon={<Users className="text-gray-400" />} label="总用户数" value={stats.total} />
        <Stat2 icon={<Crown className="text-amber-500" />} label="老板" value={stats.boss} />
        <Stat2 icon={<UserCog className="text-blue-500" />} label="主管" value={stats.supervisor} />
        <Stat2 icon={<Users className="text-gray-500" />} label="员工" value={stats.staff} />
        <Stat2 icon={<Building2 className="text-red-400" />} label="未分配部门" value={stats.noDept} />
      </div>

      <div className="space-y-4">
        {deptList.map(([deptName, members]) => (
          <div key={deptName || 'none'} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
              <Building2 size={16} className="text-emerald-600" />
              <span className="font-medium text-gray-900">{deptName || '未分配部门'}</span>
              <span className="text-xs text-gray-500">({members.length} 人)</span>
            </div>
            <div className="divide-y divide-gray-50">
              {members.map((u) => (
                <div key={u.id} className="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-gray-50/50">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                    {(u.nickname || u.username || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-800">{u.nickname || u.username}</div>
                    <div className="text-xs text-gray-400">@{u.username}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${roleColor(u.employeeRole)}`}>
                    {roleLabel(u.employeeRole)}
                  </span>
                  <span className="text-[10px] text-gray-400">{new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat2({ icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">{icon}</div>
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-xl font-bold text-gray-900">{value}</div>
      </div>
    </div>
  )
}
