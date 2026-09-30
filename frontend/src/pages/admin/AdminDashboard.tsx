import { useEffect, useState } from 'react'
import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, TrendingDown, DollarSign, Receipt, FileText, Clock, CheckCircle, AlertTriangle, Users, Building2 } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { LoadingState, ErrorState } from '../../components/StateView'

interface PMProject {
  id: string
  name: string
  client: string
  purchaseAmount: number
  saleAmount: number
  status: 'active' | 'done' | 'cancelled'
  payments: { amount: number }[]
  receipts: { amount: number }[]
  invoices: { type: string; amount: number }[]
  department?: { id: string; name: string } | null
  updatedAt: string
}

interface PMStats {
  projectCount: number
  totalPurchase: number
  totalSale: number
  totalProfit: number
  totalPaid: number
  totalReceived: number
  totalUnpaid: number
  totalUnrecv: number
  totalInvIn: number
  totalInvOut: number
  range: { start: string; end: string } | null
}

interface Department {
  id: string
  name: string
  leaderId?: string
  _count?: { members?: number; projects?: number }
}

interface TeamTask {
  id: string
  title: string
  status: string
  priority: string
  dueDate?: string | null
  assignee?: { nickname?: string; username?: string } | null
}

interface Dashboard {
  stats: PMStats
  projects: PMProject[]
  departments: Department[]
  tasks: TeamTask[]
  userCount: number
}

const fmtY = (n: number) => n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString('zh-CN')
const fmtMoney = (n: number) => '¥' + fmtY(Math.abs(n))

/** KPI 卡片 */
function KpiCard({ label, value, sub, trend, positive, accent }: {
  label: string
  value: string
  sub?: string
  trend?: number
  positive?: boolean
  accent?: 'blue' | 'green' | 'red' | 'purple' | 'orange' | 'gray'
}) {
  const accentMap: Record<string, string> = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-emerald-500 to-emerald-600',
    red: 'from-rose-500 to-rose-600',
    purple: 'from-violet-500 to-violet-600',
    orange: 'from-amber-500 to-amber-600',
    gray: 'from-gray-500 to-gray-600',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] text-gray-500 font-medium">{label}</span>
        {trend !== undefined && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded ${
            positive ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'
          }`}>
            {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div className={`text-2xl font-bold text-gray-900 mb-1`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  )
}

/** 项目状态环形图（纯 CSS，SVG） */
function StatusDonut({ stats, departments }: { stats: PMStats; departments: Department[] }) {
  const total = stats.projectCount || 1
  // 简化：按 departments 算 active / done / cancelled
  // 实际应该从 projects list 算
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">部门结构</h3>
      {departments.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-xs">暂无部门数据</div>
      ) : (
        <div className="space-y-3">
          {departments.slice(0, 5).map((d) => (
            <div key={d.id} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                <Building2 size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{d.name}</div>
                <div className="text-[11px] text-gray-400">{d._count?.members ?? 0} 人</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-5 pt-4 border-t border-gray-50">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>活跃项目</span>
          <span className="font-semibold text-gray-800">{total}</span>
        </div>
      </div>
    </div>
  )
}

/** 应收 vs 应付 对比条 */
function CashFlowBar({ stats }: { stats: PMStats }) {
  const max = Math.max(stats.totalUnrecv, stats.totalUnpaid, 1)
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">资金往来</h3>
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-500">应收账款（未收款）</span>
            <span className="text-sm font-semibold text-rose-600">{fmtMoney(stats.totalUnrecv)}</span>
          </div>
          <div className="h-2 bg-gray-50 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-rose-400 to-rose-500 rounded-full" style={{ width: `${(stats.totalUnrecv / max) * 100}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-500">应付账款（未付款）</span>
            <span className="text-sm font-semibold text-amber-600">{fmtMoney(stats.totalUnpaid)}</span>
          </div>
          <div className="h-2 bg-gray-50 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full" style={{ width: `${(stats.totalUnpaid / max) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="mt-5 pt-4 border-t border-gray-50 grid grid-cols-2 gap-4 text-center">
        <div>
          <div className="text-xs text-gray-400 mb-0.5">已收款</div>
          <div className="text-base font-bold text-emerald-600">{fmtMoney(stats.totalReceived)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-0.5">已付款</div>
          <div className="text-base font-bold text-blue-600">{fmtMoney(stats.totalPaid)}</div>
        </div>
      </div>
    </div>
  )
}

/** 最近项目列表 */
function RecentProjects({ projects }: { projects: PMProject[] }) {
  const statusMap: Record<string, { label: string; cls: string }> = {
    active: { label: '进行中', cls: 'bg-blue-50 text-blue-600' },
    done: { label: '已完成', cls: 'bg-emerald-50 text-emerald-600' },
    cancelled: { label: '已取消', cls: 'bg-gray-100 text-gray-500' },
  }
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">最近项目</h3>
        <span className="text-[11px] text-gray-400">共 {projects.length} 个</span>
      </div>
      {projects.length === 0 ? (
        <div className="py-10 text-center text-gray-400 text-xs">暂无项目数据</div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] text-gray-400 bg-gray-50/50">
              <th className="text-left px-5 py-2.5 font-medium">项目 / 客户</th>
              <th className="text-left px-5 py-2.5 font-medium">部门</th>
              <th className="text-right px-5 py-2.5 font-medium">销售额</th>
              <th className="text-right px-5 py-2.5 font-medium">毛利润</th>
              <th className="text-center px-5 py-2.5 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {projects.slice(0, 6).map((p) => {
              const profit = p.saleAmount - p.purchaseAmount
              const profitRate = p.saleAmount > 0 ? ((profit / p.saleAmount) * 100).toFixed(1) : '0.0'
              const st = statusMap[p.status] ?? statusMap.active
              return (
                <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-gray-800 truncate max-w-[180px]">{p.name}</div>
                    <div className="text-[11px] text-gray-400 truncate max-w-[180px]">{p.client}</div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500 text-xs">{p.department?.name || '—'}</td>
                  <td className="px-5 py-3.5 text-right font-medium text-gray-800">{fmtMoney(p.saleAmount)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <span className={`font-semibold ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {profit >= 0 ? '+' : ''}{fmtMoney(profit)}
                    </span>
                    <span className="text-[10px] text-gray-400 ml-1">({profitRate}%)</span>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** 待办任务 */
function PendingTasks({ tasks }: { tasks: TeamTask[] }) {
  const priorityMap: Record<string, string> = {
    urgent: 'bg-rose-50 text-rose-600 border-rose-200',
    high: 'bg-amber-50 text-amber-600 border-amber-200',
    medium: 'bg-blue-50 text-blue-600 border-blue-200',
    low: 'bg-gray-50 text-gray-500 border-gray-200',
  }
  const statusMap: Record<string, { label: string; cls: string }> = {
    pending: { label: '待办', cls: 'text-gray-500' },
    in_progress: { label: '进行中', cls: 'text-blue-600' },
    completed: { label: '已完成', cls: 'text-emerald-600' },
    paused: { label: '暂停', cls: 'text-gray-400' },
    overdue: { label: '逾期', cls: 'text-rose-600' },
  }
  const pending = tasks.filter(t => t.status !== 'completed').slice(0, 5)
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">待办任务</h3>
      {pending.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-xs">没有待办任务 🎉</div>
      ) : (
        <div className="space-y-2.5">
          {pending.map((t) => {
            const st = statusMap[t.status] ?? statusMap.pending
            const pr = priorityMap[t.priority] ?? priorityMap.medium
            return (
              <div key={t.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${pr.split(' ')[0].replace('bg-', 'bg-')}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-gray-800 truncate">{t.title}</div>
                  <div className="flex items-center gap-2 mt-1 text-[11px]">
                    <span className={st.cls}>{st.label}</span>
                    {t.assignee && <span className="text-gray-400">· {t.assignee.nickname || t.assignee.username}</span>}
                    {t.dueDate && <span className="text-gray-400">· {t.dueDate.slice(0, 10)}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AdminDashboard() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = async () => {
    setLoading(true); setError(false)
    try {
      const [statsRes, projectsRes, deptsRes, tasksRes, usersRes] = await Promise.all([
        unwrap<PMStats>(api.get('/pm/projects/stats')),
        unwrap<PMProject[]>(api.get('/pm/projects')),
        unwrap<Department[]>(api.get('/pm/departments')),
        unwrap<{ grouped: boolean; tasks: TeamTask[] }>(api.get('/task-team')),
        unwrap<{ total: number }>(api.get('/admin/users', { params: { pageSize: 1 } })),
      ])
      setData({
        stats: statsRes,
        projects: projectsRes || [],
        departments: deptsRes || [],
        tasks: tasksRes?.tasks || [],
        userCount: usersRes?.total ?? 0,
      })
    } catch (err) {
      console.error('[Dashboard] load failed:', err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <LoadingState text="加载运营数据中..." />
  if (error) return <ErrorState text="数据加载失败" onRetry={load} />
  if (!data) return null

  const { stats, projects, departments, tasks, userCount } = data
  const profitRate = stats.totalSale > 0 ? ((stats.totalProfit / stats.totalSale) * 100).toFixed(1) : '0.0'

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">运营总汇</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            {stats.range
              ? `数据区间 ${stats.range.start} ~ ${stats.range.end}`
              : '实时数据'}
          </p>
        </div>
        <div className="text-right text-[12px] text-gray-400">
          {new Date().toLocaleDateString('zh-CN')}
        </div>
      </div>

      {/* KPI 行 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
        <KpiCard label="项目总数" value={stats.projectCount.toString()} sub={`${departments.length} 个部门`} accent="blue" />
        <KpiCard label="销售总额" value={fmtMoney(stats.totalSale)} accent="purple" />
        <KpiCard label="毛利润" value={fmtMoney(stats.totalProfit)} sub={`利润率 ${profitRate}%`} accent={stats.totalProfit >= 0 ? 'green' : 'red'} />
        <KpiCard label="采购总额" value={fmtMoney(stats.totalPurchase)} accent="gray" />
        <KpiCard label="已收款" value={fmtMoney(stats.totalReceived)} accent="green" />
        <KpiCard label="未收款" value={fmtMoney(stats.totalUnrecv)} accent="orange" />
        <KpiCard label="用户数" value={userCount.toLocaleString()} accent="gray" />
      </div>

      {/* 中部：资金往来 + 部门结构 + 待办 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <CashFlowBar stats={stats} />
        <StatusDonut stats={stats} departments={departments} />
        <PendingTasks tasks={tasks} />
      </div>

      {/* 下部：最近项目表 */}
      <RecentProjects projects={projects} />
    </div>
  )
}
