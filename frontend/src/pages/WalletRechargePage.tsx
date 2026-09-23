import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { formatMoney } from '../lib/utils'

const presets = [10, 30, 50, 100, 200, 500]

/**
 * 钱包充值页
 *
 * 功能：
 * 1. 金额选择：预设 6 档（10/30/50/100/200/500）+ 自定义输入
 * 2. 支付方式：微信支付 / 支付宝（演示）
 * 3. 充值提交：调用 POST /wallet/recharge，成功后返回钱包页
 *
 * 演示环境，充值不会真实扣款。
 */
export default function WalletRechargePage() {
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const [amount, setAmount] = useState<number>(50)
  const [channel, setChannel] = useState<'wechat' | 'alipay'>('wechat')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (amount <= 0) {
      toast('请输入有效金额', 'error')
      return
    }
    // 金额上限校验（单笔 5000 元）
    if (amount > 5000) {
      toast('单笔充值上限 5000 元', 'error')
      return
    }
    setLoading(true)
    try {
      await unwrap(api.post('/wallet/recharge', { amount, channel }))
      toast(`充值成功 ${formatMoney(amount)}`, 'success')
      // 返回上一页（可能是钱包页或个人中心），而非强制跳转
      navigate(-1)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <Header title="充值" />
      <div className="px-4 py-4 space-y-4">
        <div className="card">
          <div className="text-sm text-gray-500 mb-2">充值金额</div>
          <div className="text-3xl font-bold text-primary-600">
            {formatMoney(amount)}
          </div>
          <input
            type="number"
            inputMode="decimal"
            className="input mt-3"
            placeholder="自定义金额"
            value={amount || ''}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <div className="grid grid-cols-3 gap-2 mt-3">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setAmount(p)}
                className={`py-2 rounded-lg text-sm border transition-all ${
                  amount === p
                    ? 'border-primary-500 bg-primary-50 text-primary-600'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                ¥{p}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="text-sm text-gray-500 mb-3">支付方式</div>
          <div className="space-y-2">
            <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer ${channel === 'wechat' ? 'border-green-500 bg-green-50' : 'border-gray-100'}`}>
              <input
                type="radio"
                className="hidden"
                name="channel"
                checked={channel === 'wechat'}
                onChange={() => setChannel('wechat')}
              />
              <span className="text-2xl">💚</span>
              <span className="text-sm flex-1">微信支付</span>
              {channel === 'wechat' && <span className="text-green-500">✓</span>}
            </label>
            <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer ${channel === 'alipay' ? 'border-blue-500 bg-blue-50' : 'border-gray-100'}`}>
              <input
                type="radio"
                className="hidden"
                name="channel"
                checked={channel === 'alipay'}
                onChange={() => setChannel('alipay')}
              />
              <span className="text-2xl">💙</span>
              <span className="text-sm flex-1">支付宝</span>
              {channel === 'alipay' && <span className="text-blue-500">✓</span>}
            </label>
          </div>
        </div>

        <button
          onClick={submit}
          disabled={loading || amount <= 0}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? '处理中...' : `充值 ${formatMoney(amount)}`}
        </button>
        <p className="text-xs text-gray-400 text-center">演示环境，充值不会真实扣款</p>
      </div>
    </div>
  )
}
