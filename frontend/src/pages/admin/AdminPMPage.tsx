import { useEffect, useState } from 'react'
import { Search, TrendingUp, Users, Wallet, CreditCard, FileText } from 'lucide-react'
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
interface FlowRecord {
  id: string; projectId: string; date: string; amount: number; note?: string | null;
  project: { id: string; name: string; client: string };
}
interface InvoiceRecord extends FlowRecord { type: 'in' | 'out' }

type TabKey = 'projects' | 'flows' | 'invoices'

const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

export default function AdminPMPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('projects')

  // 项目列表 Tab
  const [projects, setProjects] = useState<PMProject[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 流水 Tab
  const [payments, setPayments] = useState<FlowRecord[]>([])
  const [receipts, setReceipts] = useState<FlowRecord[]>([])
  const [flowsLoading, setFlowsLoading] = useState(false)
  const [flowsError, setFlowsError] = useState<string | null>(null)

  // 发票 Tab
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [invLoading, setInvLoading] = useState(false)
  const [invError, setInvError] = useState<string | null>(null)

  const refreshProjects = async () => {
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
  const refreshFlows = async () => {
    setFlowsLoading(true); setFlowsError(null)
    try {
      const [p, r] = await Promise.all([
        unwrap<FlowRecord[]>(api.get('/pm/payments', { params: { limit: 200 } })),
        unwrap<FlowRecord[]>(api.get('/pm/receipts', { params: { limit: 200 } })),
      ])
      setPayments(p || []); setReceipts(r || [])
    } catch (e: any) { setFlowsError(e?.message || '加载失败') }
    finally { setFlowsLoading(false) }
  }
  const refreshInvoices = async () => {
    setInvLoading(true); setInvError(null)
    try {
      const list = await unwrap<InvoiceRecord[]>(api.get('/pm/invoices', { params: { limit: 200 } }))
      setInvoices(list || [])
    } catch (e: any) { setInvError(e?.message || '加载失败') }
    finally { setInvLoading(false) }
  }

  useEffect(() => { refreshProjects() }, [])

  // Tab 切换时懒加载
  useEffect(() => {
    if (activeTab === 'flows' && payments.length === 0 && receipts.length === 0) refreshFlows()
    if (activeTab === 'invoices' && invoices.length === 0) refreshInvoices()
  }, [activeTab])

  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: 'projects', label: '项目列表', icon: TrendingUp },
    { key: 'flows', label: '收付款流水', icon: Wallet },
    { key: 'invoices', label: '发票流水', icon: FileText },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp className="text-emerald-600" />
          项目账款（全公司视角）
        </h1>
        <p className="text-sm text-gray-500 mt-1">管理员可见所有用户的采购/销售/收付款/发票数据</p>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 mb-4 bg-gray-50 p-1 rounded-lg w-fit">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1.5 transition
              ${activeTab === key
                ? 'bg-white text-emerald-700 shadow-sm border border-gray-200'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'}`}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {activeTab === 'projects' && (
        <>
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
                  onKeyDown={(e) => e.key === 'Enter' && refreshProjects()}
                  placeholder="搜索项目/客户/合同号"
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
              </div>
              <button onClick={refreshProjects} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
                查询
              </button>
            </div>

            {loading ? <LoadingState /> : error ? <ErrorState text={error} onRetry={refreshProjects} /> :
              projects.length === 0 ? <EmptyState text="暂无项目数据" /> : (
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
              )
            }
          </div>
        </>
      )}

      {activeTab === 'flows' && (
        <FlowsTab
          payments={payments} receipts={receipts}
          loading={flowsLoading} error={flowsError}
          onRetry={refreshFlows}
        />
      )}

      {activeTab === 'invoices' && (
        <InvoicesTab
          invoices={invoices}
          loading={invLoading} error={invError}
          onRetry={refreshInvoices}
        />
      )}
    </div>
  )
}

/* ========================== Flows Tab ========================== */
function FlowsTab({
  payments, receipts, loading, error, onRetry,
}: {
  payments: FlowRecord[]; receipts: FlowRecord[];
  loading: boolean; error: string | null; onRetry: () => void;
}) {
  const totalPaid = payments.reduce((s, x) => s + x.amount, 0)
  const totalRecv = receipts.reduce((s, x) => s + x.amount, 0)

  // 合并排序（按日期降序，最多显示 200）
  const merged: (FlowRecord & { kind: 'paid' | 'recv' })[] = [
    ...payments.map(p => ({ ...p, kind: 'paid' as const })),
    ...receipts.map(r => ({ ...r, kind: 'recv' as const })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <>
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="付款笔数" value={payments.length} accent="orange" />
        <StatCard label="收款笔数" value={receipts.length} accent="emerald" />
        <StatCard label="净流出" value={`¥${fmt(totalPaid - totalRecv)}`} accent={totalPaid >= totalRecv ? 'orange' : 'blue'} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <CreditCard size={14} className="text-emerald-600" />
            收付款明细（按日期倒序）
          </div>
        </div>

        {loading ? <LoadingState /> : error ? <ErrorState text={error} onRetry={onRetry} /> :
          merged.length === 0 ? <EmptyState text="暂无收付款流水" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">日期</th>
                    <th className="px-4 py-3 text-center">类型</th>
                    <th className="px-4 py-3 text-left">项目</th>
                    <th className="px-4 py-3 text-left">客户</th>
                    <th className="px-4 py-3 text-right">金额</th>
                    <th className="px-4 py-3 text-left">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {merged.map((r) => (
                    <tr key={`${r.kind}-${r.id}`} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-gray-600">{new Date(r.date).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                          r.kind === 'paid' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {r.kind === 'paid' ? '付款' : '收款'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{r.project.name}</td>
                      <td className="px-4 py-3 text-gray-600">{r.project.client}</td>
                      <td className={`px-4 py-3 text-right font-medium ${
                        r.kind === 'paid' ? 'text-orange-600' : 'text-emerald-600'
                      }`}>
                        {r.kind === 'paid' ? '-' : '+'}¥{fmt(r.amount)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{r.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </>
  )
}

/* ========================== Invoices Tab ========================== */
function InvoicesTab({
  invoices, loading, error, onRetry,
}: {
  invoices: InvoiceRecord[]; loading: boolean; error: string | null; onRetry: () => void;
}) {
  const totalIn  = invoices.filter(i => i.type === 'in').reduce((s, x) => s + x.amount, 0)
  const totalOut = invoices.filter(i => i.type === 'out').reduce((s, x) => s + x.amount, 0)

  return (
    <>
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="发票总数" value={invoices.length} accent="emerald" />
        <StatCard label="进项总额" value={`¥${fmt(totalIn)}`} accent="orange" />
        <StatCard label="销项总额" value={`¥${fmt(totalOut)}`} accent="blue" />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <FileText size={14} className="text-emerald-600" />
            发票明细（按日期倒序）
          </div>
        </div>

        {loading ? <LoadingState /> : error ? <ErrorState text={error} onRetry={onRetry} /> :
          invoices.length === 0 ? <EmptyState text="暂无发票记录" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">日期</th>
                    <th className="px-4 py-3 text-center">类型</th>
                    <th className="px-4 py-3 text-left">项目</th>
                    <th className="px-4 py-3 text-left">客户</th>
                    <th className="px-4 py-3 text-right">金额</th>
                    <th className="px-4 py-3 text-left">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((r) => (
                    <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-gray-600">{new Date(r.date).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                          r.type === 'in' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {r.type === 'in' ? '进项' : '销项'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{r.project.name}</td>
                      <td className="px-4 py-3 text-gray-600">{r.project.client}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800">¥{fmt(r.amount)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{r.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </>
  )
}

/* ========================== StatCard ========================== */
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
