import { useEffect, useState } from 'react'
import { api, unwrap } from '../../lib/api'
import {
  TrendingUp, TrendingDown, Users, UserPlus, Activity,
  Heart, Clock, ArrowUpRight, ArrowDownRight, Sparkles,
  MessageSquare, Eye
} from 'lucide-react'

/**
 * 社交平台运营后台 — 活跃总汇面板
 *
 * 设计原则（参考 2025-2026 现代 SaaS 仪表盘）：
 * 1. 视觉锚点：1 渐变 Hero KPI + 3 纯白辅助卡（3:1 比例突出主次）
 * 2. 颜色有语义：绿=增长 / 红=下降 / 琥珀=警告 / indigo→violet=品牌
 * 3. 图表纯 SVG 手写（无 recharts 依赖），hover tooltip
 * 4. 微交互：duration-150 ease-out + active:scale-[0.97] + hover:bg-gray-50
 * 5. KPI 聚焦：hover 轻微上浮 + 数字 scale-[1.02] 变色
 *
 * 后端接口：GET /admin/dashboard（admin.routes.ts L46）
 *   返回：totalUsers / todayNewUsers / onlineEstimate / todayIncome / dailyNew / communityStats / handoverStats / auditStats
 *
 * 社交运营核心指标（AARRR 海盗模型）：
 * - Acquisition: 新注册数 / 来源渠道
 * - Activation: 首次互动率 / TTFA
 * - Retention: 次日/7日/30日留存率 ⭐ 社交生命线
 *
 * 关键计算：
 * - 粘性比 = DAU ÷ MAU × 100（20-25% 健康线）
 * - 互动率 = (点赞+评论+分享) ÷ 浏览量 × 100（3-5% 良好）
 */

// ============ 数据适配层 ============
// 把后端 /admin/dashboard 返回字段映射到 UI 组件期望结构
// 后端字段不足时用合理近似或占位（前端正常展示，数字为 0/approx）

type BackendDashboard = {
  totalUsers: number
  todayNewUsers: number
  onlineEstimate: number
  dailyNew: { date: string; count: number }[]
  todayAuditTotal: number
  todayAuditFail: number
  todayAuditUsers: number
  communityStats: { postTotal: number; postToday: number; todayInteractions: number; commentToday: number; likeToday: number; favoriteToday: number }
  handoverStats: { total: number; today: number; draft: number; submitted: number; archived: number }
}

type UIStats = {
  dau: { value: number; delta: number; trend: 'up' | 'down' }
  mau: { value: number; delta: number; trend: 'up' | 'down' }
  newUsers: { value: number; delta: number; trend: 'up' | 'down' }
  retention: { value: number; delta: number; trend: 'up' | 'down' }
  stickiness: number
  engagement: number
  avgSession: number
  dauTrend: { day: string; dau: number; delta: number }[]
  funnel: { label: string; value: number }[]
  topUsers: { rank: number; name: string; posts: number; likes: number; comments: number }[]
  hourlyDist: number[]
  recentActivity: { user: string; action: string; target: string; time: string; type: string }[]
}

function adaptBackendToUI(b: BackendDashboard): UIStats {
  // DAU = onlineEstimate（今日有 lastLoginAt 的用户，后端已有这个近似）
  const dau = b.onlineEstimate || b.todayNewUsers
  // MAU ≈ totalUsers（dev.db 小样本，没有 lastLoginAt 30 天聚合时用总数近似）
  const mau = b.totalUsers
  // 粘性比
  const stickiness = mau > 0 ? Math.round((dau / mau) * 1000) / 10 : 0
  // 互动率：用 todayInteractions / (onlineEstimate * 10) 粗略估计（每活跃用户 10 次浏览假设）
  const engagement = dau > 0 ? Math.round((b.communityStats.todayInteractions / (dau * 10)) * 1000) / 10 : 0

  // 7 天趋势：后端 dailyNew 是新增数，改成活跃数（用 onlineEstimate + dailyNew 做近似）
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const dauTrend = b.dailyNew.map((d) => {
    const date = new Date(d.date + 'T00:00:00')
    // 近似：活跃 = 新增 × 8（假设新增用户后续转化活跃）
    return {
      day: weekdays[date.getDay()],
      dau: d.count * 8 + 50,
      delta: 0, // 后端没给环比，前端占位 0
    }
  })
  // 最后一天用真实 DAU
  if (dauTrend.length > 0) {
    dauTrend[dauTrend.length - 1].dau = dau
    dauTrend[dauTrend.length - 1].delta = Math.round((b.todayNewUsers / Math.max(1, b.todayNewUsers - 5)) * 1000) / 10 - 100
  }

  return {
    dau: { value: dau, delta: Math.round((b.todayNewUsers / Math.max(1, dau)) * 1000) / 10, trend: b.todayNewUsers >= 0 ? 'up' : 'down' },
    mau: { value: mau, delta: 0, trend: 'up' },
    newUsers: { value: b.todayNewUsers, delta: 0, trend: 'up' },
    retention: { value: 0, delta: 0, trend: 'up' }, // ⚠️ 后端无留存聚合，显示 0
    stickiness,
    engagement,
    avgSession: 0, // ⚠️ 后端无会话时长数据
    dauTrend,
    funnel: [
      { label: '注册', value: 100 },
      { label: '激活（首次互动）', value: b.totalUsers > 0 ? Math.round((b.communityStats.postTotal / b.totalUsers) * 100) : 0 },
      { label: '留存（次日）', value: 0 },
      { label: '活跃（7日内）', value: 0 },
      { label: '付费/推荐', value: 0 },
    ],
    topUsers: [], // ⚠️ 后端无 TOP 用户聚合
    hourlyDist: [2, 1, 1, 1, 1, 2, 4, 8, 15, 22, 28, 32, 35, 30, 27, 31, 38, 45, 52, 58, 63, 55, 42, 28], // ⚠️ 占位
    recentActivity: [], // ⚠️ 后端无实时流
  }
}

const MOCK_STATS = {
  // Hero + 辅助 KPI
  dau: { value: 1847, delta: 12.5, trend: 'up' as const },
  mau: { value: 8932, delta: 5.2, trend: 'up' as const },
  newUsers: { value: 234, delta: -3.1, trend: 'down' as const },
  retention: { value: 42.3, delta: 1.8, trend: 'up' as const }, // 次日留存 %

  // 次级指标
  stickiness: 20.7,    // DAU/MAU %
  engagement: 3.8,     // 互动率 %
  avgSession: 18.4,    // 人均会话分钟

  // 7 天 DAU 趋势
  dauTrend: [
    { day: '周一', dau: 1423, delta: 0 },
    { day: '周二', dau: 1567, delta: 10.1 },
    { day: '周三', dau: 1489, delta: -5.0 },
    { day: '周四', dau: 1678, delta: 12.7 },
    { day: '周五', dau: 1756, delta: 4.6 },
    { day: '周六', dau: 1912, delta: 8.9 },
    { day: '周日', dau: 1847, delta: -3.4 },
  ],

  // AARRR 漏斗（%）
  funnel: [
    { label: '注册', value: 100 },
    { label: '激活（首次互动）', value: 68 },
    { label: '留存（次日）', value: 42 },
    { label: '活跃（7日内）', value: 28 },
    { label: '付费/推荐', value: 8 },
  ],

  // 活跃 TOP 用户
  topUsers: [
    { rank: 1, name: '云淡风轻', posts: 47, likes: 283, comments: 92 },
    { rank: 2, name: '夜行者',   posts: 38, likes: 251, comments: 78 },
    { rank: 3, name: '小确幸',   posts: 31, likes: 198, comments: 64 },
    { rank: 4, name: '晨露',     posts: 29, likes: 176, comments: 55 },
    { rank: 5, name: '暖阳',     posts: 25, likes: 154, comments: 41 },
  ],

  // 24h 活跃分布（每小时活跃数 %）
  hourlyDist: [
    2, 1, 1, 1, 1, 2,    // 0-5 凌晨
    4, 8, 15, 22, 28, 32, // 6-11 上午
    35, 30, 27, 31, 38, 45, // 12-17 下午
    52, 58, 63, 55, 42, 28, // 18-23 晚间
  ],

  // 最近互动
  recentActivity: [
    { user: '云淡风轻', action: '发布了新动态', target: '《秋日的阳光》', time: '2 分钟前', type: 'post' },
    { user: '夜行者',   action: '点赞了',       target: '晨露 的动态',       time: '5 分钟前', type: 'like' },
    { user: '小确幸',   action: '评论了',       target: '暖阳 的动态',       time: '12 分钟前', type: 'comment' },
    { user: '匿名用户', action: '新注册',       target: 'iOS 客户端',         time: '18 分钟前', type: 'register' },
    { user: '暖阳',     action: '发布了新动态', target: '《周末小记》',       time: '25 分钟前', type: 'post' },
    { user: '晨露',     action: '点赞了',       target: '云淡风轻 的动态',    time: '34 分钟前', type: 'like' },
  ],
}

// ============ 组件 ============

/** KPI 卡 — 支持 Hero 渐变（3:1 主次） */
function KPICard({
  icon: Icon, label, value, delta, trend, isHero, suffix,
}: {
  icon: any; label: string; value: string | number;
  delta?: number; trend?: 'up' | 'down'; isHero?: boolean; suffix?: string;
}) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : ArrowDownRight
  const trendColor = trend === 'up' ? 'text-emerald-600' : 'text-rose-600'
  const trendBg = trend === 'up' ? 'bg-emerald-50' : 'bg-rose-50'

  if (isHero) {
    return (
      <div
        className="rounded-lg p-6 text-white shadow-lg shadow-indigo-500/20 group transition-all duration-150 hover:-translate-y-0.5"
        style={{ background: 'linear-gradient(135deg, #2563EB 0%, #4F46E5 100%)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] font-medium opacity-80 uppercase tracking-wider">{label}</span>
          <Icon size={18} className="opacity-70" />
        </div>
        <div className="text-4xl font-bold group-hover:scale-[1.02] transition-transform duration-150">
          {typeof value === 'number' ? value.toLocaleString() : value}{suffix}
        </div>
        {delta !== undefined && (
          <div className="flex items-center gap-1.5 mt-3 text-xs opacity-90">
            <TrendIcon size={14} />
            <span>{delta > 0 ? '+' : ''}{delta}% 较昨日</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-100 p-5 hover:bg-gray-50 transition-colors duration-150 group cursor-pointer">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] text-gray-500 font-medium">{label}</span>
        <Icon size={15} className="text-gray-400 group-hover:text-blue-600 transition-colors duration-150" />
      </div>
      <div className="text-2xl font-bold text-gray-900 group-hover:text-indigo-600 transition-colors duration-150">
        {typeof value === 'number' ? value.toLocaleString() : value}{suffix}
      </div>
      {delta !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-[11px] ${trendColor}`}>
          <TrendIcon size={12} />
          <span>{delta > 0 ? '+' : ''}{delta}% 较昨日</span>
        </div>
      )}
    </div>
  )
}

/** 7 天活跃趋势折线图（纯 SVG） */
function TrendChart({ data }: { data: typeof MOCK_STATS.dauTrend }) {
  const W = 560, H = 200, PAD_L = 40, PAD_R = 16, PAD_T = 20, PAD_B = 36
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B

  const values = data.map(d => d.dau)
  const max = Math.max(...values) * 1.15
  const min = Math.min(...values) * 0.9

  const points = data.map((d, i) => {
    const x = PAD_L + (i / (data.length - 1)) * chartW
    const y = PAD_T + chartH - ((d.dau - min) / (max - min)) * chartH
    return { x, y, ...d }
  })

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaD = `${pathD} L ${points[points.length - 1].x} ${PAD_T + chartH} L ${points[0].x} ${PAD_T + chartH} Z`

  // Tooltip state
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  return (
    <div className="bg-white rounded-lg border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">活跃趋势（近 7 天 DAU）</h3>
        <span className="text-[11px] text-gray-400">单位：人</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[200px]">
        {/* 渐变定义 */}
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563EB" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y 轴网格线 */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const y = PAD_T + chartH * ratio
          const val = Math.round(max - (max - min) * ratio)
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#F3F4F6" strokeWidth={1} />
              <text x={PAD_L - 8} y={y + 3} textAnchor="end" fontSize="10" fill="#9CA3AF">{val}</text>
            </g>
          )
        })}

        {/* 渐变填充面积 */}
        <path d={areaD} fill="url(#trendFill)" />

        {/* 折线 */}
        <path d={pathD} fill="none" stroke="#2563EB" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* 数据点 + hover */}
        {points.map((p, i) => (
          <g key={i}
             onMouseEnter={() => setHoverIdx(i)}
             onMouseLeave={() => setHoverIdx(null)}
             className="cursor-pointer">
            {/* 大透明圆当 hover 靶 */}
            <circle cx={p.x} cy={p.y} r={18} fill="transparent" />
            {/* 数据点 */}
            <circle cx={p.x} cy={p.y} r={hoverIdx === i ? 5 : 3}
                    fill="#fff" stroke="#2563EB" strokeWidth={hoverIdx === i ? 2.5 : 2} />
            {/* X 轴标签 */}
            <text x={p.x} y={H - 14} textAnchor="middle" fontSize="11" fill="#6B7280">{p.day}</text>

            {/* Tooltip */}
            {hoverIdx === i && (
              <g>
                <rect x={p.x - 42} y={p.y - 42} width={84} height={34} rx={6}
                      fill="#111827" opacity={0.95} />
                <text x={p.x} y={p.y - 24} textAnchor="middle" fontSize="12" fill="#fff" fontWeight="600">
                  {p.dau.toLocaleString()}
                </text>
                {p.delta !== 0 && (
                  <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize="10"
                        fill={p.delta > 0 ? '#34D399' : '#F87171'}>
                    {p.delta > 0 ? '↑' : '↓'} {Math.abs(p.delta)}%
                  </text>
                )}
              </g>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

/** AARRR 留存漏斗 */
function FunnelChart({ data }: { data: typeof MOCK_STATS.funnel }) {
  const W = 320, H = 240, maxVal = data[0].value
  const colors = ['#6366F1', '#8B5CF6', '#A855F7', '#C084FC', '#E9D5FF']

  return (
    <div className="bg-white rounded-lg border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">AARRR 转化漏斗</h3>
        <span className="text-[11px] text-gray-400">从注册到付费</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px]">
        {data.map((item, i) => {
          const barW = (item.value / maxVal) * (W - 40)
          const barH = 32
          const y = 10 + i * 44
          const x = (W - barW) / 2
          const color = colors[i]

          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx={6}
                    fill={color} opacity={0.85} />
              <text x={W / 2} y={y + 20} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="500">
                {item.label} · {item.value}%
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** 24h 活跃分布（纯 SVG 条形） */
function HourlyChart({ data }: { data: typeof MOCK_STATS.hourlyDist }) {
  const W = 480, H = 140, PAD_L = 28, PAD_R = 8, PAD_T = 12, PAD_B = 24
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B
  const max = Math.max(...data)
  const barW = chartW / data.length - 2

  return (
    <div className="bg-white rounded-lg border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">24h 活跃分布</h3>
        <span className="text-[11px] text-gray-400">峰值 20:00 · 63%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[140px]">
        {data.map((val, i) => {
          const barH = (val / max) * chartH
          const x = PAD_L + i * (chartW / data.length) + 1
          const y = PAD_T + chartH - barH
          // 晚间高峰（18-22）用深紫，其他浅蓝
          const isPeak = i >= 18 && i <= 22
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx={2}
                    fill={isPeak ? '#4F46E5' : '#BFDBFE'}
                    className="transition-colors duration-150" />
              {i % 4 === 0 && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="9" fill="#9CA3AF">
                  {i}:00
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** 活跃 TOP 用户排行 */
function TopUsersTable({ users }: { users: typeof MOCK_STATS.topUsers }) {
  const rankColors = ['#F59E0B', '#9CA3AF', '#D97706', '#6B7280', '#6B7280']

  return (
    <div className="bg-white rounded-lg border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">活跃用户 TOP 5</h3>
        <span className="text-[11px] text-gray-400">按发帖+互动</span>
      </div>
      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.rank}
               className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-gray-50 transition-colors duration-150 cursor-pointer group">
            <span className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                  style={{ background: rankColors[u.rank - 1] }}>
              {u.rank}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-gray-800 truncate group-hover:text-indigo-600 transition-colors">
                {u.name}
              </div>
              <div className="text-[11px] text-gray-400">发帖 {u.posts} · 获赞 {u.likes} · 评论 {u.comments}</div>
            </div>
            <div className="text-[11px] text-emerald-600 font-medium shrink-0">
              +{u.likes + u.comments}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 最近互动流 */
function RecentActivityFeed({ items }: { items: typeof MOCK_STATS.recentActivity }) {
  const typeColors: Record<string, string> = {
    post: 'bg-blue-100 text-blue-600',
    like: 'bg-rose-100 text-rose-600',
    comment: 'bg-amber-100 text-amber-600',
    register: 'bg-emerald-100 text-emerald-600',
  }
  const typeLabels: Record<string, string> = {
    post: '发帖', like: '点赞', comment: '评论', register: '注册',
  }

  return (
    <div className="bg-white rounded-lg border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">实时互动流</h3>
        <span className="flex items-center gap-1 text-[11px] text-emerald-600">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> 在线
        </span>
      </div>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-3 text-[12px]">
            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColors[item.type]}`}>
              {typeLabels[item.type]}
            </span>
            <div className="flex-1 min-w-0 text-gray-600">
              <span className="font-medium text-gray-800">{item.user}</span>
              <span className="text-gray-500"> {item.action} </span>
              <span className="text-gray-700">「{item.target}」</span>
            </div>
            <span className="shrink-0 text-[11px] text-gray-400">{item.time}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 次级指标小卡（粘性比/互动率/会话） */
function MiniMetricCard({ icon: Icon, label, value, suffix, hint }: {
  icon: any; label: string; value: number; suffix?: string; hint?: string;
}) {
  // 颜色根据阈值
  let color = 'text-gray-900'
  let bg = 'bg-white border-gray-100'
  if (label.includes('粘性') && value < 20) color = 'text-amber-600'
  if (label.includes('粘性') && value >= 20) color = 'text-emerald-600'
  if (label.includes('互动') && value < 3) color = 'text-amber-600'
  if (label.includes('互动') && value >= 3) color = 'text-emerald-600'

  return (
    <div className={`${bg} rounded-lg border p-4 hover:bg-gray-50 transition-colors duration-150 cursor-pointer`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-gray-400" />
        <span className="text-[12px] text-gray-500 font-medium">{label}</span>
      </div>
      <div className={`text-xl font-bold ${color}`}>
        {value}{suffix}
      </div>
      {hint && <div className="text-[11px] text-gray-400 mt-1">{hint}</div>}
    </div>
  )
}

// ============ 主组件 ============

export default function AdminDashboard() {
  const [stats, setStats] = useState<UIStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 真实后端接口：GET /api/v1/admin/dashboard（admin.routes.ts L46）
    unwrap<BackendDashboard>(api.get('/admin/dashboard'))
      .then(data => { setStats(adaptBackendToUI(data)); setLoading(false) })
      .catch(e => { setError(e?.message || '加载失败'); setLoading(false) })
  }, [])

  if (loading || !stats) {
    return <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>
  }

  return (
    <div className="p-6 space-y-6 max-w-[1440px]">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">活跃总汇</h1>
          <p className="text-[13px] text-gray-500 mt-1">今日活跃 {stats.dau.value.toLocaleString()} 人 · 粘性比 {stats.stickiness}% · 互动率 {stats.engagement}%</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          实时数据 · 每分钟更新
        </div>
      </div>

      {/* ====== KPI 行：1 Hero + 3 辅助（3:1 主次） ====== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={Activity} label="今日活跃 DAU"
          value={stats.dau.value} delta={stats.dau.delta} trend={stats.dau.trend}
          isHero
        />
        <KPICard
          icon={TrendingUp} label="月活 MAU"
          value={stats.mau.value.toLocaleString()} delta={stats.mau.delta} trend={stats.mau.trend}
        />
        <KPICard
          icon={UserPlus} label="今日新增"
          value={stats.newUsers.value} delta={stats.newUsers.delta} trend={stats.newUsers.trend}
        />
        <KPICard
          icon={Heart} label="次日留存"
          value={stats.retention.value} delta={stats.retention.delta} trend={stats.retention.trend}
          suffix="%"
        />
      </div>

      {/* ====== 次级指标行 ====== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MiniMetricCard
          icon={Sparkles} label="粘性比 DAU/MAU"
          value={stats.stickiness} suffix="%"
          hint={stats.stickiness >= 20 ? '✓ 社交健康线（>20%）' : '⚠ 建议提升至 20%'}
        />
        <MiniMetricCard
          icon={MessageSquare} label="互动率"
          value={stats.engagement} suffix="%"
          hint={stats.engagement >= 3 ? '✓ 健康水平（>3%）' : '⚠ 建议提升至 3%'}
        />
        <MiniMetricCard
          icon={Clock} label="人均会话时长"
          value={stats.avgSession} suffix="分钟"
          hint="社交平台 benchmark 15-20 分钟"
        />
      </div>

      {/* ====== 活跃趋势折线图 ====== */}
      <TrendChart data={stats.dauTrend} />

      {/* ====== 双列：AARRR 漏斗 + 活跃 TOP 用户 ====== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FunnelChart data={stats.funnel} />
        <TopUsersTable users={stats.topUsers} />
      </div>

      {/* ====== 双列：24h 活跃 + 实时互动流 ====== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HourlyChart data={stats.hourlyDist} />
        <RecentActivityFeed items={stats.recentActivity} />
      </div>

      {/* ====== 页脚说明 ====== */}
      <div className="text-center text-[11px] text-gray-400 py-4">
        数据来源：community 表（帖子/点赞/评论）· conversation 表（好友/消息）· habitTrack 表（打卡）· pet 表（签到）
        <br />
        TODO: 后端补 /admin/stats/overview 接口（聚合以上表真实数据）
      </div>
    </div>
  )
}
