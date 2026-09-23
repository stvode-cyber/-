import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Lock, ChevronRight, Edit3, Loader2 } from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { formatMoney, fromNow } from '../lib/utils'

interface WalletInfo {
  id: string
  balance: number
  frozen: boolean
  hasPaymentPwd: boolean
  newDeviceUntil?: string | null
}

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
 * 我的钱包页
 *
 * 三大区域：
 * 1. 余额卡片：余额 + 充值/账单入口
 * 2. 最近交易：最近 5 笔流水
 * 3. 安全：支付密码（可设置/修改） + 账户状态
 */
export default function WalletPage() {
  const toast = useToast((s) => s.show)
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [txns, setTxns] = useState<Transaction[]>([])
  const [showPwdModal, setShowPwdModal] = useState(false)
  // 钱包余额加载 / 错误状态
  const [walletLoading, setWalletLoading] = useState(true)
  const [walletError, setWalletError] = useState(false)
  // 交易记录加载 / 错误状态
  const [txnLoading, setTxnLoading] = useState(true)
  const [txnError, setTxnError] = useState(false)

  useEffect(() => {
    Promise.all([loadWallet(), loadTxns()])
  }, [])

  const loadWallet = async () => {
    setWalletLoading(true)
    setWalletError(false)
    try {
      const w = await unwrap<WalletInfo>(api.get('/wallet'))
      setWallet(w)
    } catch (err) {
      setWalletError(true)
      toast((err as Error).message, 'error')
    } finally {
      setWalletLoading(false)
    }
  }

  const loadTxns = async () => {
    setTxnLoading(true)
    setTxnError(false)
    try {
      const list = await unwrap<Transaction[]>(api.get('/wallet/transactions'))
      setTxns(list.slice(0, 5))
    } catch (err) {
      setTxnError(true)
      toast((err as Error).message, 'error')
    } finally {
      setTxnLoading(false)
    }
  }

  const txnIcon = (t: string) => (t === 'recharge' ? '📈' : t === 'refund' ? '💰' : '📉')
  const txnColor = (t: string) => (t === 'consume' ? 'text-red-500' : 'text-green-500')
  const txnSign = (t: string) => (t === 'consume' ? '-' : '+')

  return (
    <div className="app-shell">
      <Header title="我的钱包" />
      <div className="px-4 py-4 space-y-4">
        {/* 余额卡片 */}
        <div
          className="bg-gradient-to-br from-primary-400 to-primary-600 text-white rounded-3xl p-6 shadow-lg shadow-primary-200/40 relative overflow-hidden"
        >
          {/* 装饰圆 */}
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full" />
          <div className="absolute top-8 right-8 w-10 h-10 bg-white/10 rounded-full" />
          <div className="relative">
          <div className="text-sm opacity-80">可用余额</div>
          {/* 余额加载中 / 加载失败 / 正常展示，避免 wallet 为 null 时误显示 ¥0.00 */}
          <div className="text-3xl font-bold mt-1">
            {walletLoading ? (
              <Loader2 size={28} className="animate-spin" />
            ) : walletError ? (
              <span className="text-base">加载失败</span>
            ) : wallet ? (
              formatMoney(wallet.balance)
            ) : (
              ''
            )}
          </div>
          {walletError ? (
            <button
              onClick={loadWallet}
              className="text-xs underline mt-1 opacity-90 hover:opacity-100"
            >
              点击重试
            </button>
          ) : (
            <div className="text-xs opacity-70 mt-1">仅限平台内使用</div>
          )}

          <div className="flex gap-3 mt-4">
            <Link
              to="/wallet/recharge"
              className="flex-1 bg-white/20 backdrop-blur rounded-lg py-2 text-center text-sm font-medium hover:bg-white/30"
            >
              充值
            </Link>
            <Link
              to="/wallet/transactions"
              className="flex-1 bg-white/20 backdrop-blur rounded-lg py-2 text-center text-sm font-medium hover:bg-white/30"
            >
              流水明细
            </Link>
          </div>
          </div>
        </div>

        {/* 最近交易 */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="font-medium text-gray-800">最近交易</span>
            <Link to="/wallet/transactions" className="text-xs text-primary-600 flex items-center">
              查看全部 <ChevronRight size={14} />
            </Link>
          </div>
          {txnLoading ? (
            <LoadingState skeleton count={3} />
          ) : txnError ? (
            <ErrorState onRetry={loadTxns} />
          ) : txns.length === 0 ? (
            <EmptyState icon="💳" text="暂无交易记录" />
          ) : (
            <div className="space-y-3">
              {txns.map((t) => (
                <div key={t.id} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-lg">
                    {txnIcon(t.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">{t.title}</div>
                    <div className="text-xs text-gray-400">{fromNow(t.createdAt)}</div>
                  </div>
                  <div className={`text-sm font-medium ${txnColor(t.type)}`}>
                    {txnSign(t.type)}{formatMoney(t.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 安全 */}
        <div className="card">
          <div className="font-medium text-gray-800 mb-3">安全</div>
          <div className="space-y-3">
            {/* 支付密码（可点击设置/修改） */}
            <button
              onClick={() => setShowPwdModal(true)}
              className="w-full flex items-center justify-between py-1 group"
            >
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Lock size={16} />
                支付密码
              </div>
              <div className="flex items-center gap-1">
                <span className={`text-xs ${wallet?.hasPaymentPwd ? 'text-green-500' : 'text-orange-500'}`}>
                  {wallet?.hasPaymentPwd ? '已设置' : '未设置'}
                </span>
                <Edit3 size={12} className="text-gray-300 group-hover:text-primary-500" />
              </div>
            </button>
            {/* 账户状态 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <ShieldCheck size={16} />
                账户状态
              </div>
              <span className={`text-xs ${wallet?.frozen ? 'text-red-500' : 'text-green-500'}`}>
                {wallet?.frozen ? '已冻结' : '正常'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 支付密码设置弹层 */}
      {showPwdModal && (
        <PaymentPwdModal
          isSet={wallet?.hasPaymentPwd || false}
          onClose={() => setShowPwdModal(false)}
          onSuccess={() => {
            loadWallet()
            setShowPwdModal(false)
          }}
        />
      )}
    </div>
  )
}

/**
 * 支付密码设置/修改弹层
 * - 6 位数字密码
 * - 二次确认输入
 */
function PaymentPwdModal({
  isSet,
  onClose,
  onSuccess,
}: {
  isSet: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const toast = useToast((s) => s.show)
  const [pwd, setPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!/^\d{6}$/.test(pwd)) {
      toast('支付密码必须为 6 位数字', 'error')
      return
    }
    if (pwd !== confirmPwd) {
      toast('两次输入不一致', 'error')
      return
    }
    setLoading(true)
    try {
      await unwrap(api.post('/wallet/payment-pwd', { paymentPwd: pwd }))
      toast(isSet ? '支付密码已修改' : '支付密码已设置', 'success')
      onSuccess()
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
        <h3 className="text-lg font-semibold mb-1">{isSet ? '修改支付密码' : '设置支付密码'}</h3>
        <p className="text-xs text-gray-400 mb-4">6 位数字密码，用于消费验证</p>
        <div className="space-y-3">
          <input
            type="password"
            autoFocus
            inputMode="numeric"
            maxLength={6}
            className="input text-center text-2xl tracking-[0.5em]"
            placeholder="●●●●●●"
            value={pwd}
            onChange={(e) => setPwd(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            className="input text-center text-2xl tracking-[0.5em]"
            placeholder="确认密码"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">取消</button>
          <button onClick={submit} disabled={loading || pwd.length !== 6} className="btn-primary flex-1 disabled:opacity-50">
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
