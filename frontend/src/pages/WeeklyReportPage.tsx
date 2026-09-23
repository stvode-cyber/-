import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ChevronLeft, ChevronRight, MessageCircle, CheckCircle2,
  Receipt, Utensils, TrendingUp, TrendingDown, Sparkles, RefreshCw,
} from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { isDesktop } from '../lib/localCache'

/** GET /chat/weekly-report 返回结构 */
interface WeeklyReport {
  weekOffset: number
  range: { start: string; end: string; label: string }
  finance: {
    income: number
    expense: number
    balance: number
    billCount: number
    topCategories: { name: string; total: number }[]
  }
  stats: { doneTasks: number; dietCount: number; calories: number; msgCount: number; streak: number }
  mood: { positive: number; negative: number; calm: number; dominant: string; sampled: number }
  note: string
  generatedAt: string
}

/**
 * 周报单页（P1）
 * 数据源：GET /chat/weekly-report?offset=N（本周实时聚合 / 上周命中周一 03:00 Job 缓存）
 * 入口：对话 @回顾 卡片跳转 / 直达路由 /weekly-report
 */
export default function WeeklyReportPage() {
  const navigate = useNavigate()
  const [offset, setOffset] = useState(0)
  const [report, setReport] = useState<WeeklyReport | null>(null)
  const [cached, setCached] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (o: number) => {
    setLoading(true)
    setError('')
    try {
      const r = await unwrap<{ report: WeeklyReport; cached: boolean }>(
        api.get(`/chat/weekly-report?offset=${o}`),
      )
      setReport(r.report)
      setCached(r.cached)
    } catch (err) {
      setError((err as Error).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(offset)
  }, [offset, load])

  const f = report?.finance
  const maxCat = f && f.topCategories.length ? Math.max(...f.topCategories.map((c) => c.total)) : 1

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏：返回主页 + 标题 + 周导航 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/')}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
              title="返回主页"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <Sparkles size={20} className="text-primary-500" /> {report ? `${report.range.label}小结` : '周报'}
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {report ? `${report.range.start} ~ ${report.range.end}` : '加载中…'}
                {cached && <span className="ml-1 text-gray-300">（缓存）</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOffset((o) => o + 1)}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
              title="上一周"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => setOffset((o) => Math.max(0, o - 1))}
              disabled={offset <= 0}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30"
              title="下一周"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={() => load(offset)}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
              title="刷新"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
            </button>
          </div>
        </div>

        {loading && !report && (
          <div className="card p-10 text-center text-sm text-gray-400">正在翻你这一周的记录…</div>
        )}
        {error && <div className="card p-6 text-center text-sm text-red-400">{error}</div>}

        {report && (
          <>
            {/* 概览统计：四格 */}
            <div className="grid grid-cols-4 gap-2.5 mb-4">
              <StatCell icon={<MessageCircle size={14} />} label="聊了几句" value={`${report.stats.msgCount}`} color="#818CF8" />
              <StatCell icon={<CheckCircle2 size={14} />} label="完成待办" value={`${report.stats.doneTasks}`} color="#10B981" />
              <StatCell icon={<Receipt size={14} />} label="记了几笔" value={`${f?.billCount ?? 0}`} color="#F59E0B" />
              <StatCell icon={<Utensils size={14} />} label="记了几餐" value={`${report.stats.dietCount}`} color="#F97316" />
            </div>

            {/* 收支卡 */}
            <div className="card p-5 mb-4">
              <div className="text-sm font-medium text-gray-700 mb-3">收支</div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <MoneyCell label="收入" value={f?.income ?? 0} color="#10B981" icon={<TrendingUp size={13} />} />
                <MoneyCell label="支出" value={f?.expense ?? 0} color="#EF4444" icon={<TrendingDown size={13} />} />
                <MoneyCell label="结余" value={f?.balance ?? 0} color={((f?.balance ?? 0) >= 0) ? '#3B82F6' : '#F97316'} icon={null} />
              </div>
              {f && f.topCategories.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400">主要花在</div>
                  {f.topCategories.map((c) => (
                    <div key={c.name} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 w-14 truncate flex-shrink-0">{c.name}</span>
                      <div className="flex-1 h-4 rounded-md bg-gray-50 overflow-hidden">
                        <div
                          className="h-full rounded-md"
                          style={{
                            width: `${Math.max(6, (c.total / maxCat) * 100)}%`,
                            background: 'linear-gradient(90deg, rgb(var(--color-primary-400)) 0%, rgb(var(--color-primary-500)) 100%)',
                          }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-gray-700 w-14 text-right tabular-nums">¥{c.total.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              )}
              {f && f.billCount === 0 && (
                <div className="text-xs text-gray-300 text-center py-2">这一周没记过账</div>
              )}
            </div>

            {/* 情绪卡 */}
            <div className="card p-5 mb-4">
              <div className="text-sm font-medium text-gray-700 mb-3">
                情绪 · {report.mood.sampled > 0 ? report.mood.dominant : '这周没聊到情绪'}
              </div>
              {report.mood.sampled > 0 && (
                <div className="flex h-3 rounded-full overflow-hidden mb-2">
                  <div className="bg-emerald-400" style={{ width: `${(report.mood.positive / report.mood.sampled) * 100}%` }} title={`积极 ${report.mood.positive}`} />
                  <div className="bg-gray-200" style={{ width: `${(report.mood.calm / report.mood.sampled) * 100}%` }} title={`平静 ${report.mood.calm}`} />
                  <div className="bg-orange-400" style={{ width: `${(report.mood.negative / report.mood.sampled) * 100}%` }} title={`低落 ${report.mood.negative}`} />
                </div>
              )}
              {report.mood.sampled > 0 && (
                <div className="flex gap-4 text-[10px] text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400" /> 积极 {report.mood.positive}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-gray-200" /> 平静 {report.mood.calm}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-400" /> 低落 {report.mood.negative}</span>
                </div>
              )}
            </div>

            {/* 角角落碎碎念 */}
            <div className="card p-5 mb-4 bg-gradient-to-br from-amber-50 via-white to-orange-50">
              <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                <Sparkles size={15} className="text-amber-500" /> 角角落
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{report.note}</p>
              <p className="text-[10px] text-gray-300 mt-2">
                连续相伴 {report.stats.streak} 天 · 生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** 概览小格 */
function StatCell({ icon, label, value, color }: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
}) {
  return (
    <div className="card p-3 text-center">
      <div className="flex items-center justify-center gap-1" style={{ color }}>
        {icon}
        <span className="text-[10px] text-gray-400">{label}</span>
      </div>
      <div className="text-lg font-bold text-gray-800 mt-1 tabular-nums">{value}</div>
    </div>
  )
}

/** 收支金额格 */
function MoneyCell({ label, value, color, icon }: {
  label: string
  value: number
  color: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-lg p-3 text-center" style={{ background: 'rgb(var(--color-card-bg) / 0.7)' }}>
      <div className="flex items-center justify-center gap-1 text-[10px] text-gray-400">
        {icon}
        {label}
      </div>
      <div className="text-base font-bold mt-0.5 tabular-nums" style={{ color }}>
        ¥{value.toFixed(2)}
      </div>
    </div>
  )
}
