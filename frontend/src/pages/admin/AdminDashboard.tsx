import { useEffect, useState } from 'react'
import { Users, UserPlus, TrendingUp, DollarSign, Activity, CheckCircle, XCircle, ClipboardList, FileText, Archive, MessageSquare, Heart, Bookmark } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../../components/StateView'
import { formatMoney } from '../../lib/utils'

/** 交接单统计结构（与后端 dashboard.handlerStats 对应） */
interface HandoverStats {
  total: number
  today: number
  draft: number
  submitted: number
  archived: number
}

/** 社区统计结构（与后端 dashboard.communityStats 对应） */
interface CommunityStats {
  postTotal: number
  postToday: number
  todayInteractions: number
  commentToday: number
  likeToday: number
  favoriteToday: number
}

interface Dashboard {
  totalUsers: number
  todayNewUsers: number
  onlineEstimate: number
  todayIncome: number
  dailyNew: { date: string; count: number }[]
  // 台账统计
  todayAuditTotal: number
  todayAuditSuccess: number
  todayAuditFail: number
  todayAuditUsers: number
  // 交接单统计
  handlerStats?: HandoverStats
  // 社区统计
  communityStats?: CommunityStats
}

/**
 * 管理后台 · 首页概览
 *
 * 五大区域：
 * 1. 用户与收入统计卡片（总用户/今日新增/今日活跃/今日充值）
 * 2. 台账统计卡片（今日操作总数/成功/失败/活跃用户数）
 * 3. 交接单统计卡片（总交接单/今日新增/草稿/已提交/已归档）
 * 4. 社区统计卡片（帖子总数/今日新增/今日互动/评论/点赞/收藏）
 * 5. 7 天新增用户趋势图 + 系统信息
 */
export default function AdminDashboard() {
  const toast = useToast((s) => s.show)
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await unwrap<Dashboard>(api.get('/admin/dashboard'))
      setData(res)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const userStats = [
    { label: '总用户数', value: data?.totalUsers ?? 0, icon: Users, color: 'bg-blue-500' },
    { label: '今日新增', value: data?.todayNewUsers ?? 0, icon: UserPlus, color: 'bg-green-500' },
    { label: '今日活跃', value: data?.onlineEstimate ?? 0, icon: TrendingUp, color: 'bg-orange-500' },
    { label: '今日充值', value: data ? formatMoney(data.todayIncome) : '¥0.00', icon: DollarSign, color: 'bg-purple-500' },
  ]

  const auditStats = [
    { label: '今日操作总数', value: data?.todayAuditTotal ?? 0, icon: Activity, color: 'bg-indigo-500' },
    { label: '操作成功', value: data?.todayAuditSuccess ?? 0, icon: CheckCircle, color: 'bg-green-500' },
    { label: '操作失败', value: data?.todayAuditFail ?? 0, icon: XCircle, color: 'bg-red-500' },
    { label: '活跃用户数', value: data?.todayAuditUsers ?? 0, icon: Users, color: 'bg-cyan-500' },
  ]

  // 交接单统计卡片（与后端 handlerStats 对应）
  const handlerStats = [
    { label: '总交接单', value: data?.handlerStats?.total ?? 0, icon: ClipboardList, color: 'bg-teal-500' },
    { label: '今日新增', value: data?.handlerStats?.today ?? 0, icon: FileText, color: 'bg-indigo-500' },
    { label: '草稿', value: data?.handlerStats?.draft ?? 0, icon: FileText, color: 'bg-gray-500' },
    { label: '已提交', value: data?.handlerStats?.submitted ?? 0, icon: FileText, color: 'bg-blue-500' },
    { label: '已归档', value: data?.handlerStats?.archived ?? 0, icon: Archive, color: 'bg-green-500' },
  ]

  // 社区统计卡片（与后端 communityStats 对应）
  const communityStats = [
    { label: '帖子总数', value: data?.communityStats?.postTotal ?? 0, icon: MessageSquare, color: 'bg-blue-500' },
    { label: '今日新帖', value: data?.communityStats?.postToday ?? 0, icon: FileText, color: 'bg-indigo-500' },
    { label: '今日互动', value: data?.communityStats?.todayInteractions ?? 0, icon: Activity, color: 'bg-orange-500' },
    { label: '今日评论', value: data?.communityStats?.commentToday ?? 0, icon: MessageSquare, color: 'bg-cyan-500' },
    { label: '今日点赞', value: data?.communityStats?.likeToday ?? 0, icon: Heart, color: 'bg-red-500' },
    { label: '今日收藏', value: data?.communityStats?.favoriteToday ?? 0, icon: Bookmark, color: 'bg-amber-500' },
  ]

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-800 mb-6">首页概览</h1>

      {/* 加载中 */}
      {loading && (
        <div className="py-24 flex flex-col items-center justify-center">
          <LoadingState text="加载统计数据中..." />
        </div>
      )}

      {/* 加载失败 */}
      {error && !loading && (
        <div className="py-24 flex flex-col items-center justify-center">
          <ErrorState text="统计数据加载失败" onRetry={load} />
        </div>
      )}

      {/* 数据就绪后渲染统计卡片 */}
      {!loading && !error && data && (
        <>
      {/* 用户与收入统计 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {userStats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">{s.label}</span>
              <div className={`w-9 h-9 rounded-lg ${s.color} flex items-center justify-center text-white`}>
                <s.icon size={18} />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-800">{s.value}</div>
          </div>
        ))}
      </div>

      {/* 台账统计 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {auditStats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">{s.label}</span>
              <div className={`w-9 h-9 rounded-lg ${s.color} flex items-center justify-center text-white`}>
                <s.icon size={18} />
              </div>
            </div>
            <div className={`text-2xl font-bold ${
              s.label === '操作失败' && (data?.todayAuditFail ?? 0) > 0 ? 'text-red-500' : 'text-gray-800'
            }`}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* 交接单统计 */}
      <div className="mb-4">
        <h2 className="text-sm font-medium text-gray-600 mb-3">📋 交接单统计</h2>
        <div className="grid grid-cols-5 gap-4">
          {handlerStats.map((s) => (
            <div key={s.label} className="bg-white rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-500">{s.label}</span>
                <div className={`w-9 h-9 rounded-lg ${s.color} flex items-center justify-center text-white`}>
                  <s.icon size={18} />
                </div>
              </div>
              <div className="text-2xl font-bold text-gray-800">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 社区统计 */}
      <div className="mb-4">
        <h2 className="text-sm font-medium text-gray-600 mb-3">💬 社区统计</h2>
        <div className="grid grid-cols-6 gap-4">
          {communityStats.map((s) => (
            <div key={s.label} className="bg-white rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-500">{s.label}</span>
                <div className={`w-9 h-9 rounded-lg ${s.color} flex items-center justify-center text-white`}>
                  <s.icon size={18} />
                </div>
              </div>
              <div className="text-2xl font-bold text-gray-800">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 7天趋势 */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-base font-medium text-gray-800 mb-4">最近7天新增用户</h2>
        {data && (
          <div className="flex items-end gap-3 h-48">
            {data.dailyNew.map((d) => {
              const max = Math.max(...data.dailyNew.map((x) => x.count), 1)
              const height = (d.count / max) * 100
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end">
                  <div className="text-xs text-gray-500 mb-1">{d.count}</div>
                  <div
                    className="w-full bg-gradient-to-t from-primary-500 to-primary-300 rounded-t-md transition-all"
                    style={{ height: `${height}%`, minHeight: '4px' }}
                  />
                  <div className="text-xs text-gray-400 mt-2">{d.date}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="mt-6 bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-base font-medium text-gray-800 mb-4">系统信息</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex justify-between py-2 border-b border-gray-50">
            <span className="text-gray-500">系统版本</span>
            <span className="text-gray-800">v1.0.6</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-50">
            <span className="text-gray-500">开发阶段</span>
            <span className="text-gray-800">阶段一 · MVP</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-50">
            <span className="text-gray-500">数据库</span>
            <span className="text-gray-800">SQLite</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-50">
            <span className="text-gray-500">API 版本</span>
            <span className="text-gray-800">v1</span>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  )
}
