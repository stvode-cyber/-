import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, ChevronLeft, ChevronRight, Sparkles, BarChart3 } from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { formatMoney, formatDateTime } from '../lib/utils'
import { BILL_CATEGORIES } from '../lib/constants'

interface Bill {
  id: string
  type: string
  amount: number
  category: string
  account?: string
  title: string
  note?: string
  billDate: string
}

interface Summary {
  month: string
  income: number
  expense: number
  balance: number
  byCategory: Record<string, number>
  count: number
}

const categories = BILL_CATEGORIES

/**
 * 财务记账页
 *
 * 功能：
 * 1. 月份切换：上一月 / 下一月 / 回到本月
 * 2. 月度概览卡片：收入 / 支出 / 结余 + 分类标签
 * 3. 账单列表：按月份过滤，支持删除
 * 4. 新建账单（底部弹层）
 */
export default function FinancePage() {
  const toast = useToast((s) => s.show)
  const [bills, setBills] = useState<Bill[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [searchParams, setSearchParams] = useSearchParams()
  // 列表加载 / 错误状态
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    load()
    // 来自 HomePage 快捷入口 ?new=1 → 自动打开新增弹层
    if (searchParams.get('new') === '1') {
      setShowAdd(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [month])

  const load = async () => {
    // 同时加载账单列表和月度概览，任一失败即标记 error
    setLoading(true)
    setError(false)
    try {
      const [list, s] = await Promise.all([
        unwrap<Bill[]>(api.get(`/finance/bills?month=${month}`)),
        unwrap<Summary>(api.get(`/finance/summary/monthly?month=${month}`)),
      ])
      setBills(list)
      setSummary(s)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await unwrap(api.delete(`/finance/bills/${id}`))
      toast('已删除', 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** 切换到上一个月 */
  const prevMonth = () => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1, 1)
    d.setMonth(d.getMonth() - 1)
    setMonth(d.toISOString().slice(0, 7))
  }

  /** 切换到下一个月 */
  const nextMonth = () => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1, 1)
    d.setMonth(d.getMonth() + 1)
    setMonth(d.toISOString().slice(0, 7))
  }

  /** 是否为当前月（用于禁用"下一月"按钮） */
  const isCurrentMonth = month === new Date().toISOString().slice(0, 7)

  /** 格式化月份显示：2026-08 → 2026年8月 */
  const formatMonthLabel = (m: string) => {
    const [y, mo] = m.split('-')
    return `${y}年${Number(mo)}月`
  }

  return (
    <div className="app-shell">
      <Header
        title="财务记账"
        right={
          <div className="flex items-center">
            <Link to="/finance/analytics" className="p-2 text-accent-600" title="财务分析">
              <BarChart3 size={20} />
            </Link>
            <button onClick={() => setShowAdd(true)} className="p-2 text-primary-600">
              <Plus size={20} />
            </button>
          </div>
        }
      />
      <div className="px-4 py-3 space-y-3">
        {/* 月份切换器 */}
        <div className="card flex items-center justify-between py-2">
          <button
            onClick={prevMonth}
            className="p-2 rounded-lg hover:bg-gray-50 text-gray-500"
            aria-label="上一月"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="text-center">
            <div className="text-sm font-medium text-gray-800">{formatMonthLabel(month)}</div>
            {!isCurrentMonth && (
              <button
                onClick={() => setMonth(new Date().toISOString().slice(0, 7))}
                className="text-[10px] text-primary-500"
              >
                回到本月
              </button>
            )}
          </div>
          <button
            onClick={nextMonth}
            disabled={isCurrentMonth}
            className="p-2 rounded-lg hover:bg-gray-50 text-gray-500 disabled:opacity-30"
            aria-label="下一月"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* 月度卡片 */}
        {summary && (
          <div className="card bg-gradient-to-br from-primary-50 via-white to-accent-50 border-primary-100">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">{formatMonthLabel(summary.month)} 概览</div>
              <span className="text-xs text-gray-400">{summary.count} 笔</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-center">
              <div>
                <div className="text-xs text-gray-400">收入</div>
                <div className="text-sm font-medium text-green-500">{formatMoney(summary.income)}</div>
              </div>
              <div className="border-x border-gray-100">
                <div className="text-xs text-gray-400">支出</div>
                <div className="text-sm font-medium text-red-500">{formatMoney(summary.expense)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">结余</div>
                <div className="text-sm font-medium text-primary-600">{formatMoney(summary.balance)}</div>
              </div>
            </div>
            {Object.keys(summary.byCategory).length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="text-xs text-gray-500 mb-2">支出分类</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(summary.byCategory).map(([cat, amt]) => (
                    <span key={cat} className="badge bg-gray-100 text-gray-600">
                      {cat} {formatMoney(amt)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 账单列表 */}
        <div className="card">
          <div className="font-medium text-gray-800 mb-3">
            {formatMonthLabel(month)} 账单
          </div>
          {loading ? (
            <LoadingState skeleton count={3} />
          ) : error ? (
            <ErrorState onRetry={load} />
          ) : bills.length === 0 ? (
            <EmptyState
              icon="💰"
              text={isCurrentMonth ? '暂无账单' : '本月暂无账单记录'}
              hint={isCurrentMonth ? '点击右上角 + 记一笔' : undefined}
            />
          ) : (
            <div className="space-y-2">
              {bills.map((b) => (
                <div key={b.id} className="flex items-center gap-3 py-2 group">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                    b.type === 'income' ? 'bg-green-50' : 'bg-red-50'
                  }`}>
                    {b.type === 'income' ? '📈' : '📉'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">{b.title}</div>
                    <div className="text-xs text-gray-400">
                      {b.category} · {formatDateTime(b.billDate)}
                    </div>
                  </div>
                  <div className={`text-sm font-medium ${b.type === 'income' ? 'text-green-500' : 'text-red-500'}`}>
                    {b.type === 'income' ? '+' : '-'}{formatMoney(b.amount)}
                  </div>
                  <button
                    onClick={() => remove(b.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showAdd && <AddBillModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  )
}

function AddBillModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast((s) => s.show)
  const [type, setType] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState<number | ''>('')
  // category 默认 'auto'：用户不选分类时后端自动推断（阶段二功能）
  const [category, setCategory] = useState('auto')
  const [title, setTitle] = useState('')
  const [account, setAccount] = useState('微信')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!amount || !title) {
      toast('请填写金额和标题', 'error')
      return
    }
    setLoading(true)
    try {
      await unwrap(api.post('/finance/bills', {
        type, amount, category, title, account,
      }))
      toast('已记录', 'success')
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
        <h3 className="text-lg font-semibold mb-4">记一笔</h3>
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setType('expense')}
              className={`flex-1 py-2 rounded-lg text-sm border ${
                type === 'expense' ? 'border-red-500 bg-red-50 text-red-600' : 'border-gray-200'
              }`}
            >
              支出
            </button>
            <button
              onClick={() => setType('income')}
              className={`flex-1 py-2 rounded-lg text-sm border ${
                type === 'income' ? 'border-green-500 bg-green-50 text-green-600' : 'border-gray-200'
              }`}
            >
              收入
            </button>
          </div>
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            className="input text-2xl font-bold text-center"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
          />
          <input
            className="input"
            placeholder="标题（如 午餐、打车）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div>
            <label className="text-xs text-gray-500">
              分类{category === 'auto' && <span className="text-primary-500 ml-1">· 智能识别</span>}
            </label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {/* 智能识别选项：不选分类时后端根据标题自动推断 */}
              <button
                onClick={() => setCategory('auto')}
                className={`px-3 py-1 rounded-full text-xs border flex items-center gap-1 ${
                  category === 'auto'
                    ? 'border-primary-500 bg-primary-50 text-primary-600'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                <Sparkles size={10} /> 智能
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`px-3 py-1 rounded-full text-xs border ${
                    category === c ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <input
            className="input"
            placeholder="账户（微信/支付宝/现金）"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">取消</button>
          <button onClick={submit} disabled={loading} className="btn-primary flex-1 disabled:opacity-50">
            {loading ? '记录中...' : '记录'}
          </button>
        </div>
      </div>
    </div>
  )
}
