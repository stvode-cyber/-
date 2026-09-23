import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BarChart3, PieChart, Wallet, Target, TrendingUp, TrendingDown, Loader2, Settings2, X } from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'
import { formatMoney } from '../lib/utils'
import { BILL_CATEGORIES } from '../lib/constants'

interface Bill {
  id: string
  type: string
  amount: number
  category: string
  title: string
  billDate: string
}

interface MonthAgg {
  month: string
  income: number
  expense: number
  balance: number
  byCategory: Record<string, number>
}

/** 月度预算设置（localStorage） */
const BUDGET_KEY = 'finance_budgets_v1'

function loadBudgets(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BUDGET_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveBudgets(b: Record<string, number>) {
  localStorage.setItem(BUDGET_KEY, JSON.stringify(b))
}

/** 配色：分类 → 颜色 */
const CATEGORY_COLORS: Record<string, string> = {
  食物: '#F97316',
  交通: '#3B82F6',
  购物: '#EC4899',
  住房: '#8B5CF6',
  娱乐: '#10B981',
  医疗: '#EF4444',
  教育: '#06B6D4',
  工资: '#22C55E',
  其他: '#6B7280',
}

function monthLabel(m: string): string {
  const [, mo] = m.split('-')
  return `${Number(mo)}月`
}

/** 取最近 N 个月的月份字符串（YYYY-MM），含当月，升序 */
function recentMonths(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export default function FinanceAnalyticsPage() {
  const toast = useToast((s) => s.show)
  const [months, setMonths] = useState<MonthAgg[]>([])
  const [loading, setLoading] = useState(true)
  const [showBudgetSettings, setShowBudgetSettings] = useState(false)
  const [budgets, setBudgets] = useState<Record<string, number>>(() => loadBudgets())
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({})

  const targetMonths = useMemo(() => recentMonths(6), [])
  const currentMonth = targetMonths[targetMonths.length - 1]

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      // 并行加载 6 个月账单
      const results = await Promise.all(
        targetMonths.map((m) =>
          unwrap<Bill[]>(api.get(`/finance/bills?month=${m}`))
            .then((bills) => aggregateMonth(m, bills))
            .catch(() => ({ month: m, income: 0, expense: 0, balance: 0, byCategory: {} }))
        )
      )
      setMonths(results)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const aggregateMonth = (month: string, bills: Bill[]): MonthAgg => {
    let income = 0, expense = 0
    const byCategory: Record<string, number> = {}
    for (const b of bills) {
      if (b.type === 'income') income += b.amount
      else {
        expense += b.amount
        byCategory[b.category] = (byCategory[b.category] || 0) + b.amount
      }
    }
    return { month, income, expense, balance: income - expense, byCategory }
  }

  const current = months[months.length - 1]
  const maxBar = Math.max(...months.map((m) => Math.max(m.income, m.expense)), 100)

  // 当月分类排序
  const currentCategories = current
    ? Object.entries(current.byCategory).sort((a, b) => b[1] - a[1])
    : []

  const totalExpense = current?.expense || 0

  // 预算汇总
  const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0)
  const budgetUsed = Object.keys(budgets).reduce((s, cat) => s + (current?.byCategory[cat] || 0), 0)

  const openBudgetSettings = () => {
    const draft: Record<string, string> = {}
    BILL_CATEGORIES.forEach((c) => {
      draft[c] = budgets[c] ? String(budgets[c]) : ''
    })
    setBudgetDraft(draft)
    setShowBudgetSettings(true)
  }

  const saveBudgetSettings = () => {
    const next: Record<string, number> = {}
    BILL_CATEGORIES.forEach((c) => {
      const v = Number(budgetDraft[c])
      if (v > 0) next[c] = v
    })
    setBudgets(next)
    saveBudgets(next)
    setShowBudgetSettings(false)
    toast('预算已保存', 'success')
  }

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell p-4 pb-8'}>
      <div className={isDesktop() ? 'max-w-5xl mx-auto' : ''}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Link to="/finance" className="p-1.5 rounded-lg hover:bg-gray-100 text-accent-500">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-accent-800 flex items-center gap-2">
                <BarChart3 size={22} className="text-primary-500" /> 财务分析
              </h1>
              <p className="text-xs text-accent-400 mt-0.5">近 6 个月收支趋势 · 分类占比 · 预算追踪</p>
            </div>
          </div>
          <button
            onClick={openBudgetSettings}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white text-accent-700 hover:bg-gray-50"
          >
            <Settings2 size={16} /> <span className="hidden sm:inline">预算设置</span>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-accent-400 text-sm">
            <Loader2 size={18} className="animate-spin mr-2" /> 加载中…
          </div>
        ) : (
          <>
            {/* 当月概览卡片 */}
            {current && (
              <div className="card p-5 mb-4 bg-gradient-to-br from-primary-50 via-white to-emerald-50">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-accent-500">{current.month} 概览</span>
                  <span className="text-xs text-accent-400">{current.income + current.expense > 0 ? '有记录' : '暂无账单'}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="flex items-center justify-center text-emerald-500 mb-0.5"><TrendingUp size={14} /></div>
                    <div className="text-[11px] text-accent-400">收入</div>
                    <div className="text-base font-bold text-emerald-600">{formatMoney(current.income)}</div>
                  </div>
                  <div className="border-x border-gray-100">
                    <div className="flex items-center justify-center text-rose-500 mb-0.5"><TrendingDown size={14} /></div>
                    <div className="text-[11px] text-accent-400">支出</div>
                    <div className="text-base font-bold text-rose-600">{formatMoney(current.expense)}</div>
                  </div>
                  <div>
                    <div className="flex items-center justify-center text-primary-500 mb-0.5"><Wallet size={14} /></div>
                    <div className="text-[11px] text-accent-400">结余</div>
                    <div className={`text-base font-bold ${current.balance >= 0 ? 'text-primary-600' : 'text-rose-600'}`}>
                      {formatMoney(current.balance)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 近 6 个月柱状图 */}
            <div className="card p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-accent-700 flex items-center gap-1.5">
                  <BarChart3 size={15} className="text-primary-500" /> 近 6 个月收支对比
                </span>
                <div className="flex items-center gap-3 text-[11px] text-accent-400">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />收入</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400" />支出</span>
                </div>
              </div>
              <div className="flex items-end justify-between gap-2 h-44">
                {months.map((m) => (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="text-[10px] text-accent-500 tabular-nums">
                      {m.expense > 0 ? `${Math.round(m.expense)}` : ''}
                    </div>
                    <div className="w-full flex items-end justify-center gap-0.5" style={{ height: '120px' }}>
                      <div
                        className="w-1/2 max-w-[18px] rounded-t bg-gradient-to-t from-emerald-300 to-emerald-500 transition-all"
                        style={{ height: `${(m.income / maxBar) * 100}%` }}
                        title={`收入 ${formatMoney(m.income)}`}
                      />
                      <div
                        className="w-1/2 max-w-[18px] rounded-t bg-gradient-to-t from-rose-300 to-rose-500 transition-all"
                        style={{ height: `${(m.expense / maxBar) * 100}%` }}
                        title={`支出 ${formatMoney(m.expense)}`}
                      />
                    </div>
                    <div className="text-[10px] text-accent-400">{monthLabel(m.month)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 当月分类占比 */}
            <div className="card p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-accent-700 flex items-center gap-1.5">
                  <PieChart size={15} className="text-primary-500" /> {currentMonth} 支出分类
                </span>
                <span className="text-xs text-accent-400">共 {formatMoney(totalExpense)}</span>
              </div>
              {currentCategories.length === 0 ? (
                <div className="text-center text-xs text-accent-400 py-8">本月暂无支出记录</div>
              ) : (
                <>
                  {/* 横向堆叠条 */}
                  <div className="flex h-3 rounded-full overflow-hidden mb-4">
                    {currentCategories.map(([cat, amt]) => (
                      <div
                        key={cat}
                        style={{ width: `${(amt / totalExpense) * 100}%`, background: CATEGORY_COLORS[cat] || '#6B7280' }}
                        title={`${cat} ${formatMoney(amt)}`}
                      />
                    ))}
                  </div>
                  <div className="space-y-2">
                    {currentCategories.map(([cat, amt]) => {
                      const pct = (amt / totalExpense) * 100
                      return (
                        <div key={cat} className="flex items-center gap-2 text-xs">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CATEGORY_COLORS[cat] || '#6B7280' }} />
                          <span className="flex-1 text-accent-700">{cat}</span>
                          <span className="text-accent-400 tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                          <span className="text-accent-700 font-medium tabular-nums w-20 text-right">{formatMoney(amt)}</span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 预算追踪 */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-accent-700 flex items-center gap-1.5">
                  <Target size={15} className="text-primary-500" /> 预算追踪
                </span>
                {totalBudget > 0 && (
                  <span className="text-xs text-accent-400">
                    已用 {formatMoney(budgetUsed)} / {formatMoney(totalBudget)}
                  </span>
                )}
              </div>
              {totalBudget === 0 ? (
                <div className="text-center py-6">
                  <p className="text-xs text-accent-400 mb-3">还未设置预算，点击右上角「预算设置」开始</p>
                  <button
                    onClick={openBudgetSettings}
                    className="text-sm text-primary-600 hover:text-primary-500"
                  >设置月度预算 →</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(budgets).map(([cat, budget]) => {
                    const used = current?.byCategory[cat] || 0
                    const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0
                    const over = used > budget
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-accent-700">{cat}</span>
                          <span className={`tabular-nums ${over ? 'text-rose-600 font-medium' : 'text-accent-400'}`}>
                            {formatMoney(used)} / {formatMoney(budget)}
                            {over && <span className="ml-1">超支</span>}
                          </span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${over ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 预算设置弹窗 */}
      {showBudgetSettings && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowBudgetSettings(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full sm:w-[440px] rounded-t-2xl sm:rounded-2xl p-5 shadow-xl bg-white max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-sm flex items-center gap-2">
                <Target size={16} className="text-primary-500" /> 月度预算设置
              </span>
              <button onClick={() => setShowBudgetSettings(false)} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
            </div>
            <p className="text-xs text-accent-400 mb-4">为每个支出分类设置月度预算上限，超支时变红提醒</p>
            <div className="space-y-2.5">
              {BILL_CATEGORIES.filter((c) => c !== '工资').map((cat) => (
                <div key={cat} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CATEGORY_COLORS[cat] || '#6B7280' }} />
                  <span className="flex-1 text-sm text-accent-700">{cat}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={budgetDraft[cat] || ''}
                    onChange={(e) => setBudgetDraft({ ...budgetDraft, [cat]: e.target.value })}
                    className="w-24 px-2 py-1.5 text-right text-sm border border-gray-200 rounded-lg focus:border-primary-400 focus:outline-none tabular-nums"
                  />
                  <span className="text-xs text-accent-400">元</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setBudgets({}); saveBudgets({}); setShowBudgetSettings(false); toast('已清空预算', 'info') }}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 text-accent-500"
              >清空</button>
              <button
                onClick={saveBudgetSettings}
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600"
              >保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
