import { useEffect, useState } from 'react'
import { FlaskConical, TrendingUp, RefreshCw } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { LoadingState, ErrorState } from '../../components/StateView'

interface BucketStat {
  bucket: 'A' | 'B'
  greetingCount: number
  replyRate: number | null
  activeUsers: number
  msgPerActiveUser: number | null
  billCount: number
  taskDone: number
}

interface AbStats {
  days: number
  abEnabled: boolean
  hasBPools: boolean
  since: string
  buckets: BucketStat[]
}

const METRICS: { key: keyof BucketStat; label: string; hint: string; suffix?: string }[] = [
  { key: 'greetingCount', label: '问候曝光', hint: '期间注入的启动问候次数（按当时桶位快照）' },
  { key: 'replyRate', label: '24h 回复率', hint: '问候后 24 小时内用户在该会话说话的比例', suffix: '%' },
  { key: 'activeUsers', label: '活跃用户', hint: '期间发过消息的用户数（按当前分桶）' },
  { key: 'msgPerActiveUser', label: '人均消息', hint: '期间人均用户消息条数' },
  { key: 'billCount', label: '记账笔数', hint: '期间新增账单数' },
  { key: 'taskDone', label: '待办完成', hint: '期间完成的待办数' },
]

/** A 池徽标色 / B 池徽标色（与语料配置页一致） */
const bucketColor = (b: string) => (b === 'A' ? 'bg-emerald-600' : 'bg-teal-600')

/** 数值格式化：null 显示 —（样本不足），百分比保留 1 位 */
const fmt = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`)

/**
 * 管理后台 · A/B 语料池效果统计页
 *
 * 指标口径（与后端 abStats.js 对齐）：
 * - 曝光/回复率：问候消息 metadata.abBucket 写入时快照，历史准确
 * - 活跃/人均消息/记账/待办：期间业务数据按当前 bucketOf(userId) 分桶
 * 埋点上线前的问候不计入曝光（预期口径）
 */
export default function AdminAbStatsPage() {
  const toast = useToast((s) => s.show)
  const [stats, setStats] = useState<AbStats | null>(null)
  const [days, setDays] = useState(14)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => { load(days) }, [days])

  const load = async (d: number) => {
    setLoading(true)
    setError(false)
    try {
      const res = await unwrap<AbStats>(api.get(`/admin/ab-stats?days=${d}`))
      setStats(res)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const a = stats?.buckets.find((b) => b.bucket === 'A')
  const b = stats?.buckets.find((b) => b.bucket === 'B')

  return (
    <div className="p-6 max-w-4xl">
      {/* 头部 */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <FlaskConical size={20} className="text-emerald-600" />
            A/B 效果统计
          </h1>
          {stats && (
            <p className="text-xs text-gray-400 mt-1">
              统计窗口：近 {stats.days} 天（自 {new Date(stats.since).toLocaleDateString()} 起）
              {' · '}曝光/回复率按问候时桶位快照，其余按当前分桶
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value={7}>近 7 天</option>
            <option value={14}>近 14 天</option>
            <option value={30}>近 30 天</option>
            <option value={90}>近 90 天</option>
          </select>
          <button onClick={() => load(days)} className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

      {/* 状态提示 */}
      {stats && !stats.abEnabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700 mb-4">
          A/B 分桶当前未开启，所有用户都在 A 池。B 列数据仅反映历史分桶开启期间。
        </div>
      )}
      {stats?.abEnabled && !stats.hasBPools && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700 mb-4">
          分桶已开启但 B 池未配置语料，B 桶用户实际使用 A 池文案，对比无意义。去「语料配置」启用 B 池。
        </div>
      )}

      {loading ? (
        <LoadingState text="统计中…" />
      ) : error || !stats ? (
        <ErrorState onRetry={() => load(days)} />
      ) : (
        <>
          {/* 双桶对比卡 */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {stats.buckets.map((s) => (
              <div key={s.bucket} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${bucketColor(s.bucket)}`}>{s.bucket}</span>
                  <span className="text-sm text-gray-600">语料池 {s.bucket}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {METRICS.map(({ key, label, suffix }) => (
                    <div key={key} className="rounded-lg bg-gray-50 p-3">
                      <div className="text-xs text-gray-400">{label}</div>
                      <div className="text-lg font-semibold text-gray-800 mt-0.5">{fmt(s[key] as number | null, suffix)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 指标差值解读 */}
          {a && b && (
            <div className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-emerald-600" />
                <span className="font-medium text-gray-800 text-sm">指标解读</span>
              </div>
              <div className="space-y-2">
                {METRICS.map(({ key, label, suffix, hint }) => {
                  const va = a[key] as number | null
                  const vb = b[key] as number | null
                  // 样本不足或双方均无数据时不给结论
                  if (va === null || vb === null) {
                    return (
                      <div key={key} className="flex items-start gap-2 text-sm text-gray-400">
                        <span className="w-20 shrink-0 text-gray-500">{label}</span>
                        <span>样本不足（{hint}）</span>
                      </div>
                    )
                  }
                  const diff = Number(vb) - Number(va)
                  const better = diff > 0 ? 'B' : diff < 0 ? 'A' : null
                  const pct = Number(va) !== 0 ? `${diff > 0 ? '+' : ''}${Math.round((diff / Number(va)) * 1000) / 10}%` : '—'
                  return (
                    <div key={key} className="flex items-start gap-2 text-sm">
                      <span className="w-20 shrink-0 text-gray-500">{label}</span>
                      <span className="text-gray-700">
                        {better ? (
                          <>
                            <b className={better === 'A' ? 'text-emerald-600' : 'text-teal-600'}>{better} 池领先</b>
                            {Number(va) !== 0 && `（B 相对 A ${pct}）`}
                            {' · '}{va}{suffix ?? ''} vs {vb}{suffix ?? ''}
                          </>
                        ) : (
                          <>两池持平 · {va}{suffix ?? ''} vs {vb}{suffix ?? ''}</>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-gray-300 mt-3">样本小时差值噪音大，建议曝光 ≥50 再下结论；回复率是核心指标，人均消息次之。</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
