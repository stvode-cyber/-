import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Trash2, Edit3, Filter, Search, X, ArrowRightCircle,
  FileText, Users, Building2,
} from 'lucide-react'
import Header from '../components/Header'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

interface Department { id: string; name: string; }
interface Payment  { id: string; date: string; amount: number; note?: string | null }
interface Receipt  { id: string; date: string; amount: number; note?: string | null }
interface Invoice  { id: string; type: 'in' | 'out'; date: string; amount: number; note?: string | null }
interface Project {
  id: string; name: string; client: string; contractNo?: string | null; productType?: string | null;
  note?: string | null; status: string; createdAt: string; updatedAt: string;
  purchaseAmount: number; saleAmount: number; departmentId: string | null;
  department?: { id: string; name: string } | null;
  payments: Payment[]; receipts: Receipt[]; invoices: Invoice[];
}

interface Stats {
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
}

const fmtMoney = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

export default function PMBoardPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()

  const [depts, setDepts] = useState<Department[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [deptFilter, setDeptFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true); setError(null)
    try {
      const [deps, list, st] = await Promise.all([
        unwrap<Department[]>(api.get('/pm/departments')),
        unwrap<Project[]>(api.get('/pm/projects', { params: { departmentId: deptFilter || undefined, status: statusFilter || undefined, search: search || undefined } })),
        unwrap<Stats>(api.get('/pm/projects/stats', { params: { departmentId: deptFilter || undefined } })),
      ])
      setDepts(deps || [])
      setProjects(list || [])
      setStats(st)
    } catch (e: any) { setError(e?.message || '加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [deptFilter, statusFilter])

  const detail = detailId ? projects.find((p) => p.id === detailId) : null

  if (loading) return <><Header title="项目账款" /><LoadingState /></>
  if (error)   return <><Header title="项目账款" /><ErrorState text={error} onRetry={refresh} /></>

  return (
    <div className="pb-8">
      <Header title="项目账款" right={
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm flex items-center gap-1">
          <Plus size={16} /> 新建项目
        </button>
      } />

      {/* 部门切换 + 筛选 */}
      <div className="px-4 mb-3 flex items-center gap-2 flex-wrap">
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input py-1.5 text-sm w-auto">
          <option value="">全部部门</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input py-1.5 text-sm w-auto">
          <option value="">全部状态</option>
          <option value="active">进行中</option>
          <option value="done">已完成</option>
          <option value="cancelled">已取消</option>
        </select>
        <div className="relative flex-1 min-w-[140px]">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setTimeout(refresh, 300) }}
            placeholder="搜索项目/客户/合同号" className="input pl-7 py-1.5 text-sm" />
        </div>
      </div>

      {/* 看板统计 */}
      {stats && (
        <div className="px-4 mb-4">
          <div className="bg-gradient-to-br from-purple-600 to-purple-400 rounded-2xl p-4 text-white shadow-lg">
            <div className="text-sm opacity-90">项目账款总览</div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <StatItem label="项目数" value={stats.projectCount} />
              <StatItem label="总采购额" value={`¥${fmtMoney(stats.totalPurchase)}`} />
              <StatItem label="总销售额" value={`¥${fmtMoney(stats.totalSale)}`} />
              <StatItem label="毛利" value={`¥${fmtMoney(stats.totalProfit)}`} warn={stats.totalProfit < 0} />
              <StatItem label="待付" value={`¥${fmtMoney(stats.totalUnpaid)}`} warn />
              <StatItem label="待收" value={`¥${fmtMoney(stats.totalUnrecv)}`} warn />
            </div>
          </div>
        </div>
      )}

      {/* 项目列表 */}
      {projects.length === 0 ? (
        <EmptyState text="还没有项目，点右上角新建一个吧" />
      ) : (
        <div className="px-4 space-y-2">
          {projects.map((p) => <ProjectCard key={p.id} p={p} onClick={() => setDetailId(p.id)} />)}
        </div>
      )}

      {showCreate && <CreateProjectDialog depts={depts} onClose={() => setShowCreate(false)}
        onSubmit={async (body) => {
          await unwrap(api.post('/pm/projects', body))
          toast('项目已创建', 'success')
          setShowCreate(false); refresh()
        }} />}

      {detail && <ProjectDetailDialog project={detail} onClose={() => setDetailId(null)}
        onChanged={async () => { setDetailId(null); await refresh() }}
        onDelete={async () => {
          const ok = await confirm({ title: '确认删除', message: `删除「${detail.name}」？所有收付款/发票记录一起删。` })
          if (ok) { await unwrap(api.delete(`/pm/projects/${detail.id}`)); toast('已删除', 'success'); setDetailId(null); refresh() }
        }} />}
    </div>
  )
}

function StatItem({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`bg-white/15 backdrop-blur rounded-lg px-3 py-2 ${warn ? 'ring-1 ring-yellow-300' : ''}`}>
      <div className="text-[11px] opacity-85">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${warn ? 'text-yellow-200' : ''}`}>{value}</div>
    </div>
  )
}

function ProjectCard({ p, onClick }: { p: Project; onClick: () => void }) {
  const paid   = p.payments.reduce((s, x) => s + x.amount, 0)
  const recv   = p.receipts.reduce((s, x) => s + x.amount, 0)
  const invIn  = p.invoices.filter((i) => i.type === 'in').reduce((s, x) => s + x.amount, 0)
  const invOut = p.invoices.filter((i) => i.type === 'out').reduce((s, x) => s + x.amount, 0)
  const payPct  = p.purchaseAmount > 0 ? Math.min(100, Math.round(paid / p.purchaseAmount * 100)) : 0
  const recvPct = p.saleAmount     > 0 ? Math.min(100, Math.round(recv / p.saleAmount     * 100)) : 0

  const statusCls = p.status === 'done' ? 'bg-green-100 text-green-600'
                  : p.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
                  : 'bg-purple-100 text-purple-600'

  return (
    <div onClick={onClick} className="bg-white rounded-xl border border-gray-100 p-3 cursor-pointer hover:border-purple-300 hover:shadow-sm transition">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${statusCls}`}>
              {p.status === 'done' ? '已完成' : p.status === 'cancelled' ? '已取消' : '进行中'}
            </span>
            {p.department && <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Building2 size={10} />{p.department.name}</span>}
          </div>
          <div className="font-medium text-sm mt-1 truncate">{p.name}</div>
          <div className="text-[11px] text-gray-400 mt-0.5 truncate">
            {p.client}{p.contractNo ? ` · 合同号 ${p.contractNo}` : ''}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-purple-600">¥{fmtMoney(p.saleAmount)}</div>
          <div className="text-[10px] text-gray-400">成本 ¥{fmtMoney(p.purchaseAmount)}</div>
        </div>
      </div>
      {(p.payments.length > 0 || p.receipts.length > 0) && (
        <div className="mt-2 space-y-1">
          <Bar label="付款" pct={payPct} amt={paid} total={p.purchaseAmount} color="bg-orange-400" />
          <Bar label="收款" pct={recvPct} amt={recv} total={p.saleAmount} color="bg-green-400" />
        </div>
      )}
      {(invIn > 0 || invOut > 0) && (
        <div className="mt-1.5 text-[10px] text-gray-400 flex gap-2">
          {invIn  > 0 && <span>进项发票 ¥{fmtMoney(invIn)}</span>}
          {invOut > 0 && <span>销项发票 ¥{fmtMoney(invOut)}</span>}
        </div>
      )}
    </div>
  )
}

function Bar({ label, pct, amt, total, color }: { label: string; pct: number; amt: number; total: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] text-gray-500">
        <span>{label} {pct}%</span>
        <span>¥{fmtMoney(amt)} / ¥{fmtMoney(total)}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-0.5">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/* ---------------- Dialogs ---------------- */

function CreateProjectDialog({ depts, onClose, onSubmit }: {
  depts: Department[]; onClose: () => void; onSubmit: (body: any) => Promise<void>
}) {
  const [form, setForm] = useState<any>({
    name: '', client: '', contractNo: '', productType: '', note: '',
    purchaseAmount: 0, saleAmount: 0, departmentId: '', status: 'active',
    payments: [], receipts: [], invoices: [],
  })
  const [submitting, setSubmitting] = useState(false)

  const addRow = (arr: string) => setForm({ ...form, [arr]: [...form[arr], { date: new Date().toISOString().slice(0, 10), amount: 0, note: '' }] })
  const updRow = (arr: string, idx: number, key: string, val: any) => {
    const copy = form[arr].map((x: any, i: number) => i === idx ? { ...x, [key]: val } : x)
    setForm({ ...form, [arr]: copy })
  }
  const delRow = (arr: string, idx: number) => setForm({ ...form, [arr]: form[arr].filter((_: any, i: number) => i !== idx) })

  return (
    <Dialog title="新建项目" onClose={onClose}>
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500">项目名 *</label>
            <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="text-xs text-gray-500">客户 *</label>
            <input className="input mt-1" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500">合同号</label>
            <input className="input mt-1" value={form.contractNo} onChange={(e) => setForm({ ...form, contractNo: e.target.value })} /></div>
          <div><label className="text-xs text-gray-500">产品类型</label>
            <input className="input mt-1" value={form.productType} onChange={(e) => setForm({ ...form, productType: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className="text-xs text-gray-500">采购额（成本）</label>
            <input type="number" className="input mt-1" value={form.purchaseAmount} onChange={(e) => setForm({ ...form, purchaseAmount: +e.target.value })} /></div>
          <div><label className="text-xs text-gray-500">销售额（收入）</label>
            <input type="number" className="input mt-1" value={form.saleAmount} onChange={(e) => setForm({ ...form, saleAmount: +e.target.value })} /></div>
          <div><label className="text-xs text-gray-500">部门</label>
            <select className="input mt-1" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">不指定</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></div>
        </div>
        <div><label className="text-xs text-gray-500">备注</label>
          <textarea className="input mt-1 min-h-[40px]" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>

        {/* 快速付款 */}
        <QuickRows title="💸 快速录付款（采购侧支出）" rows={form.payments} onAdd={() => addRow('payments')} onUpd={(i, k, v) => updRow('payments', i, k, v)} onDel={(i) => delRow('payments', i)} type="payment" />
        {/* 快速收款 */}
        <QuickRows title="💰 快速录收款（销售侧收入）" rows={form.receipts} onAdd={() => addRow('receipts')} onUpd={(i, k, v) => updRow('receipts', i, k, v)} onDel={(i) => delRow('receipts', i)} type="receipt" />
        {/* 快速发票 */}
        <QuickRows title="📄 快速录发票" rows={form.invoices} onAdd={() => addRow('invoices')} onUpd={(i, k, v) => updRow('invoices', i, k, v)} onDel={(i) => delRow('invoices', i)} type="invoice" />
      </div>

      <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
        <button onClick={onClose} className="btn-secondary flex-1">取消</button>
        <button disabled={!form.name.trim() || !form.client.trim() || submitting}
          onClick={async () => {
            setSubmitting(true); try { await onSubmit({
              ...form,
              purchaseAmount: +form.purchaseAmount || 0,
              saleAmount:     +form.saleAmount     || 0,
              payments:  form.payments.filter((r: any) => +r.amount > 0),
              receipts:  form.receipts.filter((r: any) => +r.amount > 0),
              invoices:  form.invoices.filter((r: any) => +r.amount > 0),
            }) } finally { setSubmitting(false) }
          }} className="btn-primary flex-1 disabled:opacity-50">
          {submitting ? '提交中...' : '创建'}
        </button>
      </div>
    </Dialog>
  )
}

function QuickRows({ title, rows, onAdd, onUpd, onDel, type }: {
  title: string; rows: any[]; onAdd: () => void;
  onUpd: (idx: number, key: string, val: any) => void;
  onDel: (idx: number) => void; type: 'payment' | 'receipt' | 'invoice'
}) {
  return (
    <div className="border border-dashed border-gray-200 rounded-lg p-3">
      <div className="text-xs font-bold text-gray-600 mb-2">{title}</div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 mb-1.5 items-center">
          <input type="date" className="input !py-1 text-xs" value={r.date} onChange={(e) => onUpd(i, 'date', e.target.value)} />
          <input type="number" className="input !py-1 text-xs" placeholder="金额" value={r.amount || ''} onChange={(e) => onUpd(i, 'amount', +e.target.value)} />
          {type === 'invoice' ? (
            <select className="input !py-1 text-xs" value={r.type || 'in'} onChange={(e) => onUpd(i, 'type', e.target.value)}>
              <option value="in">进项（成本侧）</option>
              <option value="out">销项（收入侧）</option>
            </select>
          ) : (
            <input className="input !py-1 text-xs" placeholder="备注（可选）" value={r.note || ''} onChange={(e) => onUpd(i, 'note', e.target.value)} />
          )}
          <button onClick={() => onDel(i)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
        </div>
      ))}
      <button onClick={onAdd} className="text-xs text-purple-600 flex items-center gap-1">
        <Plus size={12} /> 加一行
      </button>
    </div>
  )
}

function ProjectDetailDialog({ project, onClose, onChanged, onDelete }: {
  project: Project; onClose: () => void; onChanged: () => void; onDelete: () => void
}) {
  const toast = useToast((s) => s.show)
  const tabDef = project.payments.length > 0 ? 'payments' : 'receipts'
  const [tab, setTab] = useState<'payments' | 'receipts' | 'invoices'>(tabDef)
  const [addRow, setAddRow] = useState<{ date: string; amount: number; note: string; type?: 'in' | 'out' }>(
    { date: new Date().toISOString().slice(0, 10), amount: 0, note: '', type: 'in' }
  )

  const totalPaid  = project.payments.reduce((s, x) => s + x.amount, 0)
  const totalRecv  = project.receipts.reduce((s, x) => s + x.amount, 0)
  const totalInvIn = project.invoices.filter((i) => i.type === 'in').reduce((s, x) => s + x.amount, 0)
  const totalInvOut= project.invoices.filter((i) => i.type === 'out').reduce((s, x) => s + x.amount, 0)

  const addRecord = async () => {
    if (!addRow.amount || addRow.amount <= 0) return
    try {
      const endpoint = tab === 'payments' ? 'payments' : tab === 'receipts' ? 'receipts' : 'invoices'
      const body = tab === 'invoices' ? { ...addRow, type: addRow.type } : addRow
      await unwrap(api.post(`/pm/projects/${project.id}/${endpoint}`, body))
      toast('已记录', 'success')
      setAddRow({ date: new Date().toISOString().slice(0, 10), amount: 0, note: '', type: 'in' })
      await onChanged()
    } catch (e: any) { toast(e?.message || '失败', 'error') }
  }

  const delRecord = async (rid: string, kind: string) => {
    try {
      await unwrap(api.delete(`/pm/${kind}/${rid}`))
      toast('已删除', 'success')
      await onChanged()
    } catch (e: any) { toast(e?.message || '失败', 'error') }
  }

  return (
    <Dialog title="项目详情" onClose={onClose}>
      <div className="space-y-3">
        {/* 头部信息 */}
        <div>
          <div className="text-base font-bold">{project.name}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {project.client}{project.contractNo ? ` · 合同号 ${project.contractNo}` : ''}
            {project.department?.name ? ` · ${project.department.name}` : ''}
          </div>
          <div className="flex gap-3 mt-2 text-xs">
            <span className="text-orange-600">采购 ¥{fmtMoney(project.purchaseAmount)}</span>
            <span className="text-green-600">销售 ¥{fmtMoney(project.saleAmount)}</span>
            <span className={project.saleAmount - project.purchaseAmount >= 0 ? 'text-purple-600' : 'text-red-600'}>
              毛利 ¥{fmtMoney(project.saleAmount - project.purchaseAmount)}
            </span>
          </div>
          {project.note && <div className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">备注：{project.note}</div>}
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-1 text-xs border-b border-gray-100">
          {([
            ['payments', `付款 (${project.payments.length})`, `¥${fmtMoney(totalPaid)}`],
            ['receipts', `收款 (${project.receipts.length})`, `¥${fmtMoney(totalRecv)}`],
            ['invoices', `发票 (${project.invoices.length})`, `进¥${fmtMoney(totalInvIn)} 销¥${fmtMoney(totalInvOut)}`],
          ] as const).map(([k, label, sum]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-2 py-1.5 flex-1 border-b-2 transition ${tab === k ? 'border-purple-500 text-purple-600 font-bold' : 'border-transparent text-gray-500'}`}>
              {label}<div className="text-[10px] opacity-75">{sum}</div>
            </button>
          ))}
        </div>

        {/* 记录列表 */}
        <div className="max-h-[250px] overflow-y-auto">
          {tab === 'payments' && (
            <RecList rows={project.payments.map((x) => ({ ...x, kind: 'payment' }))} onDel={delRecord} empty="还没有付款记录" />
          )}
          {tab === 'receipts' && (
            <RecList rows={project.receipts.map((x) => ({ ...x, kind: 'receipt' }))} onDel={delRecord} empty="还没有收款记录" />
          )}
          {tab === 'invoices' && (
            <RecList rows={project.invoices.map((x) => ({ ...x, kind: 'invoice' }))} onDel={delRecord} empty="还没有发票记录" showType />
          )}
        </div>

        {/* 快速添加 */}
        <div className="border border-dashed border-gray-200 rounded-lg p-3">
          <div className="text-xs font-bold text-gray-600 mb-2">
            加一条{tab === 'payments' ? '付款' : tab === 'receipts' ? '收款' : '发票'}
          </div>
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
            <input type="date" className="input !py-1.5 text-xs" value={addRow.date} onChange={(e) => setAddRow({ ...addRow, date: e.target.value })} />
            <input type="number" className="input !py-1.5 text-xs" placeholder="金额" value={addRow.amount || ''} onChange={(e) => setAddRow({ ...addRow, amount: +e.target.value })} />
            {tab === 'invoices' ? (
              <select className="input !py-1.5 text-xs" value={addRow.type} onChange={(e) => setAddRow({ ...addRow, type: e.target.value as any })}>
                <option value="in">进项</option>
                <option value="out">销项</option>
              </select>
            ) : (
              <input className="input !py-1.5 text-xs" placeholder="备注" value={addRow.note} onChange={(e) => setAddRow({ ...addRow, note: e.target.value })} />
            )}
            <button onClick={addRecord} className="btn-primary !py-1.5 !px-3 text-xs">加</button>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
        <button onClick={onClose} className="btn-secondary flex-1">关闭</button>
        <button onClick={onDelete} className="btn-danger flex items-center gap-1"><Trash2 size={14} /> 删项目</button>
      </div>
    </Dialog>
  )
}

function RecList({ rows, onDel, empty, showType }: {
  rows: any[]; onDel: (rid: string, kind: string) => void; empty: string; showType?: boolean
}) {
  if (!rows.length) return <div className="text-center text-xs text-gray-400 py-6">{empty}</div>
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5 text-xs">
          <span className="text-gray-400">{new Date(r.date).toLocaleDateString()}</span>
          {showType && <span className={`px-1 py-0.5 rounded text-[10px] ${r.type === 'in' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>{r.type === 'in' ? '进项' : '销项'}</span>}
          <span className="font-bold text-gray-700">¥{fmtMoney(r.amount)}</span>
          {r.note && <span className="text-gray-500 truncate flex-1">{r.note}</span>}
          <button onClick={() => onDel(r.id, r.kind)} className="text-red-400 hover:bg-red-50 p-1 rounded"><X size={12} /></button>
        </div>
      ))}
    </div>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 flex items-center justify-between border-b border-gray-100 shrink-0">
          <h3 className="font-medium">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}
