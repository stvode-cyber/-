import { useEffect, useState } from 'react'
import { Search, TrendingUp, Users, Wallet, CreditCard, FileText, Plus, Pencil, Trash2, X, AlertTriangle } from 'lucide-react'
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
interface Department { id: string; name: string }
type ProjectForm = {
  name: string; client: string; contractNo: string; productType: string;
  purchaseAmount: number; saleAmount: number; note: string;
  departmentId: string; status: 'active' | 'done' | 'cancelled';
}

type TabKey = 'projects' | 'flows' | 'invoices'

const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const emptyForm: ProjectForm = {
  name: '', client: '', contractNo: '', productType: '',
  purchaseAmount: 0, saleAmount: 0, note: '',
  departmentId: '', status: 'active',
}

export default function AdminPMPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('projects')

  // 项目列表 Tab
  const [projects, setProjects] = useState<PMProject[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // CRUD 状态
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PMProject | null>(null)
  const [formData, setFormData] = useState<ProjectForm>(emptyForm)
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState<{ ids: string[]; label: string } | null>(null)

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
      const [list, st, deps] = await Promise.all([
        unwrap<PMProject[]>(api.get('/pm/projects', { params: { search: search || undefined } })),
        unwrap<Stats>(api.get('/pm/projects/stats')),
        unwrap<Department[]>(api.get('/pm/departments')),
      ])
      setProjects(list || []); setStats(st); setDepartments(deps || [])
    } catch (e: any) { setError(e?.message || '加载失败') }
    finally { setLoading(false); setSelectedIds(new Set()) }
  }

  // ============ CRUD 操作 ============
  const openCreate = () => {
    setEditing(null); setFormData(emptyForm); setFormError(null); setFormOpen(true)
  }
  const openEdit = (p: PMProject) => {
    setEditing(p)
    setFormData({
      name: p.name, client: p.client,
      contractNo: p.contractNo || '', productType: '',
      purchaseAmount: p.purchaseAmount, saleAmount: p.saleAmount,
      note: '', departmentId: p.department?.id || '',
      status: (p.status as any) || 'active',
    })
    setFormError(null); setFormOpen(true)
  }
  const submitForm = async () => {
    if (!formData.name.trim()) { setFormError('项目名必填'); return }
    if (!formData.client.trim()) { setFormError('客户必填'); return }
    setFormSubmitting(true); setFormError(null)
    try {
      const body = {
        name: formData.name.trim(), client: formData.client.trim(),
        contractNo: formData.contractNo.trim() || undefined,
        productType: formData.productType.trim() || undefined,
        purchaseAmount: Number(formData.purchaseAmount) || 0,
        saleAmount: Number(formData.saleAmount) || 0,
        note: formData.note.trim() || undefined,
        departmentId: formData.departmentId || undefined,
        status: formData.status,
      }
      if (editing) {
        await api.patch(`/pm/projects/${editing.id}`, body)
      } else {
        await api.post('/pm/projects', body)
      }
      setFormOpen(false); await refreshProjects()
    } catch (e: any) {
      setFormError(e?.response?.data?.message || e?.message || '保存失败')
    } finally { setFormSubmitting(false) }
  }
  const requestDelete = (ids: string[], label: string) => {
    setConfirmDel({ ids, label })
  }
  const doConfirmDelete = async () => {
    if (!confirmDel) return
    const ids = confirmDel.ids
    try {
      if (ids.length === 1) {
        await api.delete(`/pm/projects/${ids[0]}`)
      } else {
        await api.post('/pm/projects/bulk-delete', { ids })
      }
      setConfirmDel(null); await refreshProjects()
    } catch (e: any) { alert(e?.response?.data?.message || e?.message || '删除失败'); setConfirmDel(null) }
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
            <div className="p-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && refreshProjects()}
                  placeholder="搜索项目/客户/合同号"
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
              </div>
              <button onClick={refreshProjects} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">
                查询
              </button>
              <button onClick={openCreate}
                className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 flex items-center gap-1.5 ml-auto">
                <Plus size={14} />新建项目
              </button>
              {selectedIds.size >= 2 && (
                <button onClick={() => requestDelete([...selectedIds], `选中的 ${selectedIds.size} 个项目`)}
                  className="px-3 py-2 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600 flex items-center gap-1.5">
                  <Trash2 size={14} />批量删除 ({selectedIds.size})
                </button>
              )}
            </div>

            {loading ? <LoadingState /> : error ? <ErrorState text={error} onRetry={refreshProjects} /> :
              projects.length === 0 ? <EmptyState text="暂无项目数据" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="px-3 py-3 text-center w-10">
                          <input type="checkbox"
                            checked={selectedIds.size === projects.length && projects.length > 0}
                            onChange={(e) => setSelectedIds(e.target.checked ? new Set(projects.map(p => p.id)) : new Set())}
                            className="rounded" />
                        </th>
                        <th className="px-4 py-3 text-left">项目</th>
                        <th className="px-4 py-3 text-left">所属用户</th>
                        <th className="px-4 py-3 text-right">采购</th>
                        <th className="px-4 py-3 text-right">销售</th>
                        <th className="px-4 py-3 text-right">毛利</th>
                        <th className="px-4 py-3 text-right">已付/待付</th>
                        <th className="px-4 py-3 text-right">已收/待收</th>
                        <th className="px-4 py-3 text-center">状态</th>
                        <th className="px-4 py-3 text-left">更新</th>
                        <th className="px-4 py-3 text-center w-24">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((p) => {
                        const paid = p.payments.reduce((s, x) => s + x.amount, 0)
                        const recv = p.receipts.reduce((s, x) => s + x.amount, 0)
                        const profit = p.saleAmount - p.purchaseAmount
                        const checked = selectedIds.has(p.id)
                        return (
                          <tr key={p.id} className={`border-t border-gray-50 hover:bg-gray-50/50 ${checked ? 'bg-emerald-50/40' : ''}`}>
                            <td className="px-3 py-3 text-center">
                              <input type="checkbox" checked={checked}
                                onChange={(e) => {
                                  const next = new Set(selectedIds)
                                  if (e.target.checked) next.add(p.id); else next.delete(p.id)
                                  setSelectedIds(next)
                                }}
                                className="rounded" />
                            </td>
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
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button onClick={() => openEdit(p)} title="编辑"
                                  className="p-1 text-blue-600 hover:bg-blue-50 rounded">
                                  <Pencil size={14} />
                                </button>
                                <button onClick={() => requestDelete([p.id], `项目「${p.name}」`)} title="删除"
                                  className="p-1 text-red-500 hover:bg-red-50 rounded">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
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

      {/* 项目新建/编辑 Modal */}
      {formOpen && (
        <ProjectFormModal
          editing={editing}
          form={formData}
          setForm={setFormData}
          departments={departments}
          onSubmit={submitForm}
          onClose={() => setFormOpen(false)}
          submitting={formSubmitting}
          error={formError}
        />
      )}

      {/* 删除确认 Dialog */}
      {confirmDel && (
        <ConfirmDialog
          title="确认删除"
          message={`确定要删除${confirmDel.label}吗？删除后无法恢复。`}
          confirmText="删除"
          danger
          onConfirm={doConfirmDelete}
          onCancel={() => setConfirmDel(null)}
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

/* ========================== ProjectFormModal ========================== */
function ProjectFormModal({
  editing, form, setForm, departments, onSubmit, onClose, submitting, error,
}: {
  editing: PMProject | null; form: ProjectForm;
  setForm: React.Dispatch<React.SetStateAction<ProjectForm>>;
  departments: Department[];
  onSubmit: () => void; onClose: () => void;
  submitting: boolean; error: string | null;
}) {
  const set = <K extends keyof ProjectForm>(k: K, v: ProjectForm[K]) => setForm(f => ({ ...f, [k]: v }))
  const label = editing ? '编辑项目' : '新建项目'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">{label}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {error && (
            <div className="px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="项目名 *">
              <input value={form.name} onChange={(e) => set('name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
            </Field>
            <Field label="客户 *">
              <input value={form.client} onChange={(e) => set('client', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
            </Field>
            <Field label="合同号">
              <input value={form.contractNo} onChange={(e) => set('contractNo', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
            </Field>
            <Field label="产品类型">
              <input value={form.productType} onChange={(e) => set('productType', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
            </Field>
            <Field label="部门">
              <select value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
                <option value="">— 不指定 —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="状态">
              <select value={form.status} onChange={(e) => set('status', e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
                <option value="active">进行中</option>
                <option value="done">已完成</option>
                <option value="cancelled">已取消</option>
              </select>
            </Field>
            <Field label="采购额（成本）">
              <input type="number" value={form.purchaseAmount} onChange={(e) => set('purchaseAmount', Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
            </Field>
            <Field label="销售额（收入）">
              <input type="number" value={form.saleAmount} onChange={(e) => set('saleAmount', Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
            </Field>
          </div>
          <Field label="备注">
            <textarea value={form.note} onChange={(e) => set('note', e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 resize-none" />
          </Field>
          {editing && editing.user && (
            <div className="text-xs text-gray-400 pt-1">负责人：{editing.user.nickname || editing.user.username}</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
          <button onClick={onSubmit} disabled={submitting}
            className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? '保存中...' : (editing ? '保存' : '创建')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ========================== ConfirmDialog ========================== */
function ConfirmDialog({
  title, message, confirmText, danger, onConfirm, onCancel,
}: {
  title: string; message: string; confirmText: string;
  danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-5 py-4">
          <div className="flex items-start gap-3">
            {danger && (
              <div className="p-2 bg-red-100 text-red-600 rounded-lg">
                <AlertTriangle size={20} />
              </div>
            )}
            <div>
              <h3 className="text-base font-semibold text-gray-800">{title}</h3>
              <p className="text-sm text-gray-600 mt-1">{message}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
          <button onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded-lg text-white ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}>{confirmText}</button>
        </div>
      </div>
    </div>
  )
}

/* ========================== Field 辅助 ========================== */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 mb-1 block">{label}</span>
      {children}
    </label>
  )
}
