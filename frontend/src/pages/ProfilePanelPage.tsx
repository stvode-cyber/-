import { useCallback, useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Fingerprint, RefreshCw, Receipt, CheckCircle2,
  Flame, MessageCircle, HeartPulse, Brain, ShieldCheck,
} from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { isDesktop } from '../lib/localCache'

/** GET /chat/profile 返回结构（与 @画像 metadata.portrait 同源同构） */
interface ProfilePanel {
  month: string
  finance: { expense: number; topCategories: { name: string; total: number }[] }
  tasks: { total: number; done: number; doneRate: number }
  moods: { date: string; level: 'good' | 'calm' | 'low' | 'none'; sampled: number }[]
  memory: {
    counts: Record<string, number>
    recent: { id: string; kind: string; content: string; date: string }[]
  }
  relation: { streak: number; msgCount: number }
  generatedAt: string
}

const KIND_LABEL: Record<string, string> = {
  preference: '偏好',
  habit: '习惯',
  entity: '人物',
  mood: '情绪',
}

/** 情绪带色块 */
const MOOD_STYLE: Record<string, { bg: string; label: string }> = {
  good: { bg: 'bg-emerald-400', label: '不错' },
  calm: { bg: 'bg-sky-200', label: '平静' },
  low: { bg: 'bg-rose-300', label: '低落' },
  none: { bg: 'bg-gray-100 border border-dashed border-gray-300', label: '无记录' },
}

/**
 * 画像面板页（P3）
 * 数据源：GET /chat/profile（消费/待办/情绪带/记忆分组/关系深度 只读聚合）
 * 入口：对话 @画像 卡片跳转 / 直达路由 /profile-panel
 * 红线：只读展示，无任何编辑入口；数据管理统一走隐私控制面板
 */
export default function ProfilePanelPage() {
  const navigate = useNavigate()
  const [panel, setPanel] = useState<ProfilePanel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const p = await unwrap<ProfilePanel>(api.get('/chat/profile'))
      setPanel(p)
    } catch (err) {
      setError((err as Error).message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const maxCat = panel?.finance.topCategories.length
    ? Math.max(...panel.finance.topCategories.map((c) => c.total))
    : 1

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏：返回主页 + 标题 + 刷新 */}
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
                <Fingerprint size={20} className="text-primary-500" /> 你的画像
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {panel ? `${panel.month} · 数据由理解管线静默积累` : '加载中…'}
              </p>
            </div>
          </div>
          <button
            onClick={() => load()}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            title="刷新"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>

        {loading && !panel && <div className="card p-10 text-center text-sm text-gray-400">正在拼画像…</div>}
        {error && <div className="card p-6 text-center text-sm text-red-400">{error}</div>}

        {panel && (
          <>
            {/* 四格统计 */}
            <div className="grid grid-cols-4 gap-2.5 mb-4">
              <div className="card p-3 text-center">
                <Receipt size={16} className="mx-auto text-primary-500 mb-1" />
                <div className="text-base font-bold text-gray-800">¥{panel.finance.expense.toFixed(0)}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">本月支出</div>
              </div>
              <div className="card p-3 text-center">
                <CheckCircle2 size={16} className="mx-auto text-emerald-500 mb-1" />
                <div className="text-base font-bold text-gray-800">{panel.tasks.doneRate}%</div>
                <div className="text-[10px] text-gray-400 mt-0.5">待办完成</div>
              </div>
              <div className="card p-3 text-center">
                <Flame size={16} className="mx-auto text-orange-400 mb-1" />
                <div className="text-base font-bold text-gray-800">{panel.relation.streak}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">连续陪聊</div>
              </div>
              <div className="card p-3 text-center">
                <MessageCircle size={16} className="mx-auto text-sky-500 mb-1" />
                <div className="text-base font-bold text-gray-800">{panel.relation.msgCount}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">累计聊过</div>
              </div>
            </div>

            <div className={isDesktop() ? 'grid grid-cols-2 gap-4' : 'space-y-4'}>
              {/* 消费结构 */}
              <div className="card p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                  <Receipt size={14} className="text-primary-500" /> 本月花在哪
                </h2>
                {panel.finance.topCategories.length ? (
                  <div className="space-y-2.5">
                    {panel.finance.topCategories.map((c) => (
                      <div key={c.name}>
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span>{c.name}</span>
                          <span className="text-gray-400">¥{c.total.toFixed(0)}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-400 rounded-full"
                            style={{ width: `${Math.max(6, (c.total / maxCat) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 py-2">本月还没记账</p>
                )}
              </div>

              {/* 近 7 天情绪带 */}
              <div className="card p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                  <HeartPulse size={14} className="text-rose-400" /> 近 7 天情绪
                </h2>
                <div className="grid grid-cols-7 gap-1.5">
                  {panel.moods.map((m) => (
                    <div key={m.date} className="text-center">
                      <div className="text-[9px] text-gray-400 mb-1">{m.date}</div>
                      <div className={`h-8 rounded-md ${MOOD_STYLE[m.level].bg}`} title={`${MOOD_STYLE[m.level].label}${m.sampled ? `（${m.sampled} 条）` : ''}`} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-400">
                  <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" />不错</span>
                  <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-sky-200 inline-block" />平静</span>
                  <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-rose-300 inline-block" />低落</span>
                </div>
              </div>
            </div>

            {/* 我记得的 */}
            <div className="card p-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  <Brain size={14} className="text-violet-500" /> 我记得的
                </h2>
                <div className="flex gap-1.5">
                  {Object.keys(KIND_LABEL).map((k) => (
                    panel.memory.counts[k] > 0 && (
                      <span key={k} className="px-2 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-500">
                        {KIND_LABEL[k]} {panel.memory.counts[k]}
                      </span>
                    )
                  ))}
                </div>
              </div>
              {panel.memory.recent.length ? (
                <div className="space-y-2">
                  {panel.memory.recent.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-xs">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-50 text-violet-500 flex-shrink-0">
                        {KIND_LABEL[m.kind] || m.kind}
                      </span>
                      <span className="text-gray-600 truncate">{m.content}</span>
                      <span className="text-gray-300 ml-auto flex-shrink-0">{m.date}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 py-2">咱俩还聊得不多，多聊聊我就更懂你了。</p>
              )}
            </div>

            {/* 隐私入口 */}
            <Link
              to="/privacy"
              className="mt-4 flex items-center justify-between gap-2 px-4 py-3 bg-white rounded-xl shadow-sm border border-gray-100 hover:border-gray-200 transition-colors"
            >
              <span className="flex items-center gap-2 text-xs text-gray-600">
                <ShieldCheck size={14} className="text-gray-400" />
                管理这些记忆 · 理解开关 / 撤销 / 导出
              </span>
              <span className="text-gray-300">›</span>
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
