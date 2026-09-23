import { useEffect, useState } from 'react'
import { ShieldCheck, Clock, CheckCircle, Award } from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { verifyLevelMeta, VERIFY_LEVELS, verifyStatusMeta } from '../lib/constants'
import { formatDateTime } from '../lib/utils'

interface RealNameRecord {
  id: string
  realName: string
  idCard: string
  phone?: string | null
  status: string
  rejectReason?: string | null
  submittedAt: string
  reviewedAt?: string | null
}

interface VerifyStatus {
  verifyLevel: string
  profile: {
    username: string
    nickname: string | null
    phone: string | null
    email: string | null
  }
  records: RealNameRecord[]
  hasPending: boolean
}

/**
 * 实名认证中心（SA-13 认证中心页面基础版）
 *
 * 功能：
 * 1. 顶部展示当前认证等级（Lv0-Lv5）与权益描述
 * 2. 认证等级阶梯：可视化展示 6 级体系，当前等级高亮
 * 3. 提交实名认证（姓名 + 身份证号 + 可选电话）
 * 4. 历史记录列表：展示历次提交与审核结果
 *
 * 数据来源：GET /verify/status  POST /verify/submit
 */
export default function VerifyPage() {
  const toast = useToast((s) => s.show)
  const [status, setStatus] = useState<VerifyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const s = await unwrap<VerifyStatus>(api.get('/verify/status'))
      setStatus(s)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const onSubmitSuccess = () => {
    setShowForm(false)
    load()
  }

  const currentLevel = status?.verifyLevel || 'Lv0'
  const currentLevelIdx = VERIFY_LEVELS.indexOf(currentLevel as typeof VERIFY_LEVELS[number])

  return (
    <div className="app-shell">
      <Header title="实名认证" />
      <div className="px-4 py-3 space-y-3">
        {loading ? (
          <LoadingState skeleton count={2} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : status ? (
          <>
            {/* 当前认证等级卡 */}
            <div className={`card ${verifyLevelMeta[currentLevel].bg}`}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-2xl">
                  {verifyLevelMeta[currentLevel].icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-gray-800">{currentLevel}</span>
                    <span className={`badge ${verifyLevelMeta[currentLevel].bg} ${verifyLevelMeta[currentLevel].color}`}>
                      {verifyLevelMeta[currentLevel].label}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{verifyLevelMeta[currentLevel].desc}</div>
                </div>
              </div>
              {currentLevel === 'Lv0' && !status.hasPending && (
                <button
                  onClick={() => setShowForm(true)}
                  className="btn-primary w-full mt-3"
                >
                  <ShieldCheck size={16} className="inline mr-1" /> 立即认证
                </button>
              )}
              {status.hasPending && (
                <div className="mt-3 bg-amber-50 border border-amber-100 rounded-lg p-2 text-xs text-amber-600 flex items-center gap-2">
                  <Clock size={14} />
                  <span>您提交的认证申请审核中，请耐心等待</span>
                </div>
              )}
              {currentLevel === 'Lv2' && (
                <div className="mt-3 bg-green-50 border border-green-100 rounded-lg p-2 text-xs text-green-600 flex items-center gap-2">
                  <CheckCircle size={14} />
                  <span>已通过实名认证，享受全部基础权益</span>
                </div>
              )}
            </div>

            {/* 认证等级阶梯 */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Award size={16} className="text-primary-500" />
                <span className="font-medium text-gray-800">认证等级体系</span>
              </div>
              <div className="space-y-2">
                {VERIFY_LEVELS.map((lv, idx) => {
                  const meta = verifyLevelMeta[lv]
                  const reached = idx <= currentLevelIdx
                  const isCurrent = lv === currentLevel
                  return (
                    <div
                      key={lv}
                      className={`flex items-center gap-3 p-2 rounded-lg ${
                        isCurrent ? `${meta.bg} ring-1 ring-primary-300` : reached ? 'bg-gray-50' : 'opacity-50'
                      }`}
                    >
                      <span className="text-lg">{meta.icon}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${meta.color}`}>{lv}</span>
                          <span className="text-sm text-gray-700">{meta.label}</span>
                          {isCurrent && (
                            <span className="badge bg-primary-100 text-primary-700 text-[10px]">当前</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{meta.desc}</div>
                      </div>
                      {reached && !isCurrent && <CheckCircle size={14} className="text-green-500" />}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 历史记录 */}
            <div className="card">
              <div className="font-medium text-gray-800 mb-3">认证记录</div>
              {status.records.length === 0 ? (
                <EmptyState icon="📋" text="暂无认证记录" hint="提交认证后在此查看进度" />
              ) : (
                <div className="space-y-3">
                  {status.records.map((r) => {
                    const sm = verifyStatusMeta[r.status] || verifyStatusMeta.pending
                    return (
                      <div key={r.id} className="border border-gray-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-800">{r.realName}</span>
                          <span className={`badge ${sm.color}`}>{sm.label}</span>
                        </div>
                        <div className="text-xs text-gray-500 space-y-0.5">
                          <div>身份证：{r.idCard}</div>
                          {r.phone && <div>电话：{r.phone}</div>}
                          <div>提交时间：{formatDateTime(r.submittedAt)}</div>
                          {r.reviewedAt && <div>审核时间：{formatDateTime(r.reviewedAt)}</div>}
                          {r.status === 'rejected' && r.rejectReason && (
                            <div className="text-red-500 mt-1">驳回原因：{r.rejectReason}</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      {showForm && status && (
        <SubmitVerifyModal onClose={() => setShowForm(false)} onSuccess={onSubmitSuccess} />
      )}
    </div>
  )
}

function SubmitVerifyModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const toast = useToast((s) => s.show)
  const [realName, setRealName] = useState('')
  const [idCard, setIdCard] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!realName.trim()) {
      toast('请填写真实姓名', 'error')
      return
    }
    if (!idCard.trim()) {
      toast('请填写身份证号', 'error')
      return
    }
    // 简单前端校验：18 位，最后一位可为 X
    if (!/^\d{17}[\dXx]$/.test(idCard.trim())) {
      toast('身份证号格式无效（应为 18 位）', 'error')
      return
    }
    setLoading(true)
    try {
      await unwrap(
        api.post('/verify/submit', {
          realName: realName.trim(),
          idCard: idCard.trim().toUpperCase(),
          phone: phone.trim() || undefined,
        }),
      )
      toast('已提交，等待审核', 'success')
      onSuccess()
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
        <h3 className="text-lg font-semibold mb-1">实名认证</h3>
        <p className="text-xs text-gray-500 mb-4">
          请填写真实信息，提交后由管理员审核。通过后认证等级将提升至 Lv2。
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">真实姓名</label>
            <input
              className="input mt-1"
              placeholder="请输入真实姓名"
              value={realName}
              onChange={(e) => setRealName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">身份证号</label>
            <input
              className="input mt-1"
              placeholder="18 位身份证号"
              maxLength={18}
              value={idCard}
              onChange={(e) => setIdCard(e.target.value)}
            />
            <p className="text-[10px] text-gray-400 mt-1">
              🔒 身份证号将脱敏存储，仅保留前 6 位和后 4 位
            </p>
          </div>
          <div>
            <label className="text-xs text-gray-500">联系电话（可选）</label>
            <input
              className="input mt-1"
              placeholder="便于审核联系"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">取消</button>
          <button onClick={submit} disabled={loading} className="btn-primary flex-1 disabled:opacity-50">
            {loading ? '提交中...' : '提交认证'}
          </button>
        </div>
      </div>
    </div>
  )
}
