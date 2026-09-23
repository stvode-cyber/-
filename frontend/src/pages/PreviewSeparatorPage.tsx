/**
 * 分隔设计预览页
 *
 * 用途：本地快速查看"天气 → 分隔 → 快捷入口"分隔设计在不同背景下的颜色效果。
 * 不依赖任何后端数据，所有内容为 mock。
 *
 * 访问：/preview-separator
 */
import { CheckSquare, Utensils, Moon, Plus, Wallet, Calendar, ClipboardList, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'

// 与 HomePage 状态栏一致的主题色背景
const STATUS_GRADIENT = 'bg-gradient-to-br from-gray-900 via-gray-800 to-primary-600'

// 快捷入口 mock（与 HomePage 一致）
const quickActions = [
  { icon: CheckSquare, label: '添加任务', gradient: 'from-primary-400 to-teal-400' },
  { icon: Utensils, label: '记录饮食', gradient: 'from-orange-400 to-amber-400' },
  { icon: Moon, label: '记录睡眠', gradient: 'from-indigo-400 to-blue-400' },
  { icon: Plus, label: '记一笔账', gradient: 'from-green-400 to-emerald-400' },
  { icon: Wallet, label: '充值钱包', gradient: 'from-yellow-400 to-orange-400' },
  { icon: Calendar, label: '新建提醒', gradient: 'from-sky-400 to-blue-400' },
  { icon: ClipboardList, label: '工作交接', gradient: 'from-primary-500 to-teal-500' },
  { icon: Clock, label: '倒计时', gradient: 'from-purple-400 to-pink-400' },
]

/** 分隔设计：当前线上版本（颜色错开） */
function SeparatorCurrent() {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-[2px] rounded-full bg-gradient-to-r from-transparent via-white/40 to-primary-400" />
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-primary-500 text-white shadow-md shadow-primary-900/40 ring-1 ring-white/30">
          快捷入口
        </span>
        <div className="flex-1 h-[2px] rounded-full bg-gradient-to-l from-transparent via-white/40 to-primary-400" />
      </div>
    </div>
  )
}

/** 天气卡片 mock */
function WeatherMock() {
  return (
    <div className="px-4 pb-3 pt-2 mt-2 border-t border-white/10">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1 text-xs opacity-90">
          <span className="truncate">📍 北京市海淀区</span>
        </div>
        <div className="text-xs opacity-80">18° / 28°</div>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-4xl leading-none">☀️</div>
        <div className="flex items-baseline">
          <span className="text-4xl font-bold tabular-nums">24</span>
          <span className="text-xl ml-0.5">°C</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">晴朗</div>
          <div className="text-xs opacity-80 mt-0.5">体感 26°</div>
        </div>
      </div>
    </div>
  )
}

/** 快捷入口 mock */
function QuickActionsMock() {
  return (
    <div className="px-3 pt-1 pb-3">
      <div className="grid grid-cols-4 gap-2">
        {quickActions.map((a) => {
          const Icon = a.icon
          return (
            <div key={a.label} className="flex flex-col items-center gap-1 py-1.5">
              <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${a.gradient} flex items-center justify-center text-white shadow-sm`}>
                <Icon size={16} strokeWidth={2.5} />
              </div>
              <span className="text-[10px] text-white/90 font-medium">{a.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PreviewSeparatorPage() {
  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="max-w-md mx-auto px-4">
        <h1 className="text-xl font-bold text-gray-800 mb-1">分隔设计预览</h1>
        <p className="text-sm text-gray-500 mb-6">
          展示"天气 → 分隔 → 快捷入口"在多种背景下的颜色效果对比。
        </p>

        {/* 1. 真实状态栏背景（与首页一致） */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            1. 真实首页状态栏（黑→深灰→橙渐变）
          </h2>
          <div className="rounded-2xl overflow-hidden shadow-lg">
            <div className={`${STATUS_GRADIENT} text-white`}>
              {/* 状态栏顶栏 */}
              <div className="flex items-center justify-between h-11 px-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-mint-300 animate-pulse" />
                  <span className="opacity-90 font-medium">日常模式</span>
                </div>
                <div className="text-xs opacity-80">8月5日 周三</div>
              </div>
              {/* 问候语 */}
              <div className="px-4 pb-3">
                <div className="text-lg font-semibold">下午好，朋友 👋</div>
                <div className="text-xs opacity-80 mt-0.5">今日还有 3 件待办</div>
              </div>
              {/* 天气 mock */}
              <WeatherMock />
              {/* 分隔设计 */}
              <SeparatorCurrent />
              {/* 快捷入口 mock */}
              <QuickActionsMock />
            </div>
          </div>
        </section>

        {/* 2. 不同纯色背景下的分隔设计对比 */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            2. 分隔设计在不同背景下的对比
          </h2>
          <div className="space-y-3">
            {[
              { label: '纯黑 #000000', bg: 'bg-black text-white' },
              { label: '深灰 #1F2937', bg: 'bg-gray-800 text-white' },
              { label: '中灰 #6B7280', bg: 'bg-gray-500 text-white' },
              { label: '浅灰 #E5E7EB', bg: 'bg-gray-200 text-gray-900' },
              { label: '橙黄 #F59E0B', bg: 'bg-primary-500 text-white' },
              { label: '白 #FFFFFF', bg: 'bg-white text-gray-900 border border-gray-200' },
            ].map((c) => (
              <div key={c.label} className="rounded-xl overflow-hidden shadow-sm">
                <div className={`px-3 py-1.5 text-[10px] font-medium bg-gray-50 text-gray-500 border-b border-gray-200`}>
                  {c.label}
                </div>
                <div className={c.bg}>
                  <SeparatorCurrent />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 3. 几种分隔设计候选样式 */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            3. 其他候选样式（用于对比挑选）
          </h2>
          <div className="space-y-3">
            {/* A. 当前版本（橙胶囊 + 双向渐变线） */}
            <div className="rounded-xl overflow-hidden shadow-sm">
              <div className="px-3 py-1.5 text-[10px] font-medium bg-gray-50 text-gray-500 border-b border-gray-200">
                A. 当前版本：橙胶囊 + 双向渐变线
              </div>
              <div className={`${STATUS_GRADIENT} text-white`}>
                <WeatherMock />
                <SeparatorCurrent />
                <QuickActionsMock />
              </div>
            </div>

            {/* B. 简洁细线版 */}
            <div className="rounded-xl overflow-hidden shadow-sm">
              <div className="px-3 py-1.5 text-[10px] font-medium bg-gray-50 text-gray-500 border-b border-gray-200">
                B. 简洁细线版
              </div>
              <div className={`${STATUS_GRADIENT} text-white`}>
                <WeatherMock />
                <div className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-white/20" />
                    <span className="text-[10px] text-white/60 tracking-wider">快捷入口</span>
                    <div className="flex-1 h-px bg-white/20" />
                  </div>
                </div>
                <QuickActionsMock />
              </div>
            </div>

            {/* C. 实色分隔条版 */}
            <div className="rounded-xl overflow-hidden shadow-sm">
              <div className="px-3 py-1.5 text-[10px] font-medium bg-gray-50 text-gray-500 border-b border-gray-200">
                C. 实色分隔条版（橙色横条 + 阴影）
              </div>
              <div className={`${STATUS_GRADIENT} text-white`}>
                <WeatherMock />
                <div className="px-3 py-2">
                  <div className="h-1 rounded-full bg-gradient-to-r from-primary-400 via-primary-300 to-primary-400 shadow-lg shadow-primary-900/50" />
                </div>
                <QuickActionsMock />
              </div>
            </div>

            {/* D. 点状装饰版 */}
            <div className="rounded-xl overflow-hidden shadow-sm">
              <div className="px-3 py-1.5 text-[10px] font-medium bg-gray-50 text-gray-500 border-b border-gray-200">
                D. 点状装饰版
              </div>
              <div className={`${STATUS_GRADIENT} text-white`}>
                <WeatherMock />
                <div className="px-3 py-2">
                  <div className="flex items-center justify-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
                    <span className="w-2 h-2 rounded-full bg-primary-400" />
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-white/15 text-white backdrop-blur ring-1 ring-white/30">
                      快捷入口
                    </span>
                    <span className="w-2 h-2 rounded-full bg-primary-400" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
                  </div>
                </div>
                <QuickActionsMock />
              </div>
            </div>
          </div>
        </section>

        <div className="text-center mt-8">
          <Link to="/" className="text-sm text-primary-600 hover:underline">
            ← 返回首页
          </Link>
        </div>
      </div>
    </div>
  )
}
