import { useEffect, useState } from 'react'
import { Search, TrendingUp, Users } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { LoadingState, ErrorState, EmptyState } from '../../components/StateView'

interface ProjectOwner { id: string; username: string; nickname?: string | null }
interface PMProject {
  id: string; name: string; client: string; contractNo?: string | null;
  purchaseAmount: number; saleAmount: number; status: string;
  payments: { amount: number }[]; receipts: { amount: number }[];
  invoices: { type: string; amount: number }[];
  user?: ProjectOwner | null;
  department?: { id: string; name: string } | null;
  updatedAt: string; createdAt: string;
}
interface Stats {
  projectCount: number; totalPurchase: number; totalSale: number; totalProfit: number;
  totalPaid: number; totalReceived: number; totalUnpaid: number; totalUnrecv: number;
  totalInvIn: number; totalInvOut: number;
}

const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

export default function AdminPMPage() {
  const [projects, setProjects] = useState<PMProject[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true); setError(null)
    try {
      const [list, st] = await Promise.all([
        unwrap<PMProject[]>(api.get('/pm/projects', { params: { search: search || undefined } })),
        unwrap<Stats>(api.get('/pm/projects/stats')),
      ])
      setProjects(list || []); setStats(st)
    } catch (e: any) { setError(e?.message || '加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  if (loading) return <LoadingState />
  if (error) return <ErrorState text={error} onRetry={refresh} />

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp className="text-emerald-600" />
          项目账款（全公司视角）
        </h1>
        <p className="text-sm text-gray-500 mt-1">管理员可见所有用户的采购/销售/收付款/发票数据</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <StatCard label="项目总数" value={stats.projectCount} accent="emerald" />
          <StatCard label="总采购额" value={`¥${fmt(stats.totalPurchase)}`} accent="orange" />
          <StatCard label="总销售额" value={`¥${fmt(stats.totalSale)}`} accent="blue" />
          <StatCard label="总毛利" value={`¥${fmt(stats.totalProfit)}`} accent={stats.totalProfit >= 0 ? 'emerald' : 'red'} />
          <StatCard label="待付 / 待收" value={`¥${fmt(stats.totalUnpaid)} / ¥${fmt(stats.totalUnrecv)}`} accent="amber" />
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && refresh()}
              placeholder="搜索项目/客户/合同号"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
          </div>
          <button onClick={refresh} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
            查询
          </button>
        </div>

        {projects.length === 0 ? (
          <EmptyState text="暂无项目数据" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">项目</th>
                  <th className="px-4 py-3 text-left">所属用户</th>
                  <th className="px-4 py-3 text-right">采购</th>
                  <th className="px-4 py-3 text-right">销售</th>
                  <th className="px-4 py-3 text-right">毛利</th>
                  <th className="px-4 py-3 text-right">已付/待付</th>
                  <th className="px-4 py-3 text-right">已收/待收</th>
                  <th className="px-4 py-3 text-center">状态</th>
                  <th className="px-4 py-3 text-left">更新</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const paid = p.payments.reduce((s, x) => s + x.amount, 0)
                  const recv = p.receipts.reduce((s, x) => s + x.amount, 0)
                  const profit = p.saleAmount - p.purchaseAmount
                  return (
                    <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{p.name}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[200px]">
                          {p.client}{p.contractNo ? ` · ${p.contractNo}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Users size={12} className="text-gray-400" />
                          <span className="text-gray-700">{p.user?.nickname || p.user?.username || '-'}</span>
                        </div>
                        {p.department && <div className="text-[10px] text-gray-400">{p.department.name}</div>}
                      </td>
                      <td className="px-4 py-3 text-right text-orange-600">¥{fmt(p.purchaseAmount)}</td>
                      <td className="px-4 py-3 text-right text-blue-600">¥{fmt(p.saleAmount)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>¥{fmt(profit)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-600">{fmt(paid)} / {fmt(p.purchaseAmount - paid)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-600">{fmt(recv)} / {fmt(p.saleAmount - recv)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] ${
                          p.status === 'done' ? 'bg-emerald-100 text-emerald-700'
                          : p.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
                          : 'bg-blue-100 text-blue-700'
                        }`}>
                          {p.status === 'done' ? '已完成' : p.status === 'cancelled' ? '已取消' : '进行中'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{new Date(p.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent: 'emerald' | 'orange' | 'blue' | 'amber' | 'red' }) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-600', orange: 'text-orange-600', blue: 'text-blue-600',
    amber: 'text-amber-600', red: 'text-red-600',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold mt-1 ${colors[accent]}`}>{value}</div>
    </div>
  )
}
