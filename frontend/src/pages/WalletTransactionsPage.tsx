import { useEffect, useState } from 'react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { formatDateTime, formatMoney } from '../lib/utils'

interface Transaction {
  id: string
  type: string
  amount: number
  balanceAfter: number
  title: string
  category?: string
  status: string
  createdAt: string
}

/**
 * 钱包账单流水页
 *
 * 功能：
 * 1. Tab 切换：全部 / 充值 / 消费 / 退款
 * 2. 流水卡片：图标、标题、分类标签、时间、金额、操作后余额
 * 3. 顶部统计：当前 Tab 总览（笔数 + 收入 + 支出）
 */
export default function WalletTransactionsPage() {
  const toast = useToast((s) => s.show)
  const [txns, setTxns] = useState<Transaction[]>([])
  const [filter, setFilter] = useState<'all' | 'recharge' | 'consume' | 'refund'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    load()
  }, [filter])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const query = filter === 'all' ? '' : `?type=${filter}`
      const list = await unwrap<Transaction[]>(api.get(`/wallet/transactions${query}`))
      setTxns(list)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const tabs = [
    { key: 'all', label: '全部' },
    { key: 'recharge', label: '充值' },
    { key: 'consume', label: '消费' },
    { key: 'refund', label: '退款' },
  ] as const

  const txnIcon = (t: string) => (t === 'recharge' ? '📈' : t === 'refund' ? '💰' : '📉')
  const txnIconBg = (t: string) =>
    t === 'recharge' ? 'bg-green-50' : t === 'refund' ? 'bg-blue-50' : 'bg-red-50'
  const txnColor = (t: string) => (t === 'consume' ? 'text-red-500' : 'text-green-500')
  const txnSign = (t: string) => (t === 'consume' ? '-' : '+')

  // 当前 Tab 统计
  const totalIn = txns.filter((t) => t.type !== 'consume').reduce((s, t) => s + t.amount, 0)
  const totalOut = txns.filter((t) => t.type === 'consume').reduce((s, t) => s + t.amount, 0)

  return (
    <div className="app-shell">
      <Header title="账单流水" />
      <div className="sticky top-12 bg-white z-10 border-b border-gray-100">
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`flex-1 py-3 text-sm border-b-2 ${
                filter === t.key
                  ? 'border-primary-500 text-primary-600 font-medium'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 py-3">
        {loading ? (
          <LoadingState skeleton count={5} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : (
          <>
            {/* 当前 Tab 统计概览 */}
            {txns.length > 0 && (
              <div className="card mb-3 flex items-center justify-around text-center">
                <div>
                  <div className="text-xs text-gray-400">笔数</div>
                  <div className="text-sm font-medium text-gray-700">{txns.length}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">收入</div>
                  <div className="text-sm font-medium text-green-500">+{formatMoney(totalIn)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">支出</div>
                  <div className="text-sm font-medium text-red-500">-{formatMoney(totalOut)}</div>
                </div>
              </div>
            )}

            {txns.length === 0 ? (
              <EmptyState icon="💸" text="暂无记录" hint="切换其他分类试试" />
            ) : (
              <div className="space-y-2">
                {txns.map((t) => (
                  <div key={t.id} className="card flex items-center gap-3 py-3">
                    <div className={`w-10 h-10 rounded-full ${txnIconBg(t.type)} flex items-center justify-center text-lg`}>
                      {txnIcon(t.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-800 truncate">{t.title}</span>
                        {t.category && (
                          <span className="badge bg-gray-100 text-gray-500">{t.category}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400">{formatDateTime(t.createdAt)}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-medium ${txnColor(t.type)}`}>
                        {txnSign(t.type)}{formatMoney(t.amount)}
                      </div>
                      <div className="text-xs text-gray-400">余额 {formatMoney(t.balanceAfter)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
