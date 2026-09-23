import { useState, useMemo, useCallback } from 'react'
import {
  Droplets, Plus, Minus, Trash2, X, Settings2, Trophy, Check,
} from 'lucide-react'
import {
  getWaterStat, addWater, clearToday, listTodayEntries,
  loadSettings, saveSettings, QUICK_ADDS, todayStr,
} from '../lib/waterStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 喝水记录页
 *
 * 功能：
 * 1. 今日进度环：已饮/目标 + 快捷饮水按钮（125/250/500ml）+ 撤销
 * 2. 今日记录时间线：每次饮水的时间与容量，可清空
 * 3. 近 7 天柱状图：达标日高亮
 * 4. 目标设置：每日目标 + 默认杯容量
 */

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 进度百分比对应的主色 */
function progressColor(pct: number): string {
  if (pct >= 100) return '#0EA5E9'
  if (pct >= 60) return '#38BDF8'
  if (pct >= 30) return '#7DD3FC'
  return '#BAE6FD'
}

export default function WaterPage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const stat = useMemo(() => getWaterStat(), [version])
  const entries = useMemo(() => listTodayEntries(), [version])
  const settings = useMemo(() => loadSettings(), [version])

  const pct = Math.min(100, Math.round((stat.todayMl / stat.dailyGoal) * 100))

  const handleAdd = useCallback((ml: number) => {
    addWater(ml)
    const after = getWaterStat()
    if (ml > 0 && after.todayMl >= after.dailyGoal && after.todayMl - ml < after.dailyGoal) {
      toast(`今日饮水达标！🎉 ${after.todayMl}ml`, 'success')
    } else {
      toast(`+${ml}ml`, 'info')
    }
    refresh()
  }, [toast, refresh])

  const handleUndo = useCallback(() => {
    if (entries.length === 0) {
      toast('今日暂无记录可撤销', 'info')
      return
    }
    addWater(-1)
    toast('已撤销最近一次记录', 'info')
    refresh()
  }, [entries.length, toast, refresh])

  const handleClear = useCallback(() => {
    clearToday()
    toast('已清空今日记录', 'success')
    refresh()
  }, [toast, refresh])

  const handleSaveSettings = useCallback((dailyGoal: number, cupSize: number) => {
    saveSettings({ dailyGoal, cupSize })
    setShowSettings(false)
    toast('设置已保存', 'success')
    refresh()
  }, [toast, refresh])

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Droplets size={22} className="text-sky-500" /> 喝水记录
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              连续达标 {stat.streak} 天 · 近7天均量 {stat.average > 0 ? `${stat.average}ml` : '—'}
            </p>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg text-gray-400 hover:text-sky-500 hover:bg-sky-50"
            title="目标设置"
          >
            <Settings2 size={18} />
          </button>
        </div>

        {/* 今日进度卡 */}
        <div className="card p-6 mb-4">
          <div className="flex items-center gap-6">
            {/* 进度环 */}
            <div className="relative w-32 h-32 flex-shrink-0">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" className="stroke-accent-100" strokeWidth="12" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke={progressColor(pct)}
                  strokeWidth="12" strokeLinecap="round"
                  strokeDasharray={`${(pct / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`}
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {pct >= 100 ? (
                  <>
                    <Trophy size={20} className="text-sky-500 mb-0.5" />
                    <span className="text-[10px] text-sky-600 font-medium">已达标</span>
                  </>
                ) : (
                  <>
                    <span className="text-2xl font-bold text-gray-800 tabular-nums">{pct}%</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">今日进度</span>
                  </>
                )}
              </div>
            </div>
            {/* 数值 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-gray-800 tabular-nums">{stat.todayMl}</span>
                <span className="text-sm text-gray-400">/ {stat.dailyGoal} ml</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {stat.remaining > 0
                  ? `再喝 ${stat.remaining}ml 达标（约 ${Math.ceil(stat.remaining / settings.cupSize)} 杯）`
                  : '今日目标已完成，保持水分 💧'}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">今日已记录 {stat.todayCount} 次</p>
            </div>
          </div>

          {/* 快捷按钮 */}
          <div className="grid grid-cols-4 gap-2 mt-5">
            {QUICK_ADDS.map((ml) => (
              <button
                key={ml}
                onClick={() => handleAdd(ml)}
                className="py-3 rounded-xl border border-sky-100 bg-sky-50 text-sky-600 hover:bg-sky-100 active:scale-95 transition-all flex flex-col items-center gap-0.5"
              >
                <Plus size={16} />
                <span className="text-sm font-semibold tabular-nums">{ml}ml</span>
              </button>
            ))}
            <button
              onClick={handleUndo}
              disabled={entries.length === 0}
              className="py-3 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-40 flex flex-col items-center gap-0.5"
            >
              <Minus size={16} />
              <span className="text-sm font-semibold">撤销</span>
            </button>
          </div>
        </div>

        {/* 近 7 天柱状图 */}
        <div className="card p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-gray-700">近 7 天</span>
            <span className="text-xs text-gray-400">达标 {stat.goalDays}/7 天 · 目标 {stat.dailyGoal}ml</span>
          </div>
          <div className="relative h-28">
            {(() => {
              const maxMl = Math.max(...stat.last7Days.map((d) => d.ml), stat.dailyGoal)
              return stat.last7Days.map((d, i) => {
                const isToday = d.date === todayStr()
                const hit = d.ml >= stat.dailyGoal
                const h = d.ml > 0 ? Math.max(6, (d.ml / maxMl) * 88) : 0
                return (
                  <div
                    key={d.date}
                    className="absolute bottom-0 flex flex-col items-center justify-end"
                    style={{ left: `${(i / 7) * 100 + 100 / 14}%`, transform: 'translateX(-50%)', width: '10%' }}
                  >
                    {d.ml > 0 && (
                      <span className={`text-[9px] mb-1 tabular-nums ${hit ? 'text-sky-600 font-semibold' : 'text-gray-400'}`}>
                        {(d.ml / 1000).toFixed(1)}L
                      </span>
                    )}
                    {/* 目标线 */}
                    {i === 0 && (
                      <div
                        className="absolute left-0 right-0 border-t border-dashed border-sky-300"
                        style={{ bottom: `${(stat.dailyGoal / maxMl) * 88 + 18}px` }}
                      />
                    )}
                    <div
                      className="w-full rounded-t-lg transition-all"
                      style={{
                        height: `${h}px`,
                        background: hit ? '#0EA5E9' : d.ml > 0 ? '#7DD3FC' : 'rgb(var(--color-accent-100))',
                      }}
                      title={`${d.date} ${d.ml}ml${hit ? ' ✓达标' : ''}`}
                    />
                    <span className={`text-[10px] mt-1 ${isToday ? 'text-sky-600 font-semibold' : 'text-gray-400'}`}>
                      {WEEKDAY_LABELS[new Date(d.date + 'T00:00:00').getDay()]}
                    </span>
                  </div>
                )
              })
            })()}
          </div>
        </div>

        {/* 今日记录时间线 */}
        {entries.length > 0 && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">今日记录</span>
              <button
                onClick={handleClear}
                className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1"
              >
                <Trash2 size={12} /> 清空
              </button>
            </div>
            <div className="space-y-0.5">
              {[...entries].reverse().map((e, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="w-6 h-6 rounded-full bg-sky-50 text-sky-500 flex items-center justify-center flex-shrink-0">
                    <Droplets size={12} />
                  </span>
                  <span className="flex-1 text-xs text-gray-500">
                    {new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-sm font-semibold text-gray-700 tabular-nums">+{e.ml}ml</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 目标设置弹窗 */}
      {showSettings && (
        <SettingsModal
          initial={settings}
          onClose={() => setShowSettings(false)}
          onSave={handleSaveSettings}
        />
      )}
    </div>
  )
}

// ===== 目标设置弹窗 =====

const GOAL_OPTIONS = [1500, 2000, 2500, 3000]
const CUP_OPTIONS = [125, 250, 500]

function SettingsModal({ initial, onClose, onSave }: {
  initial: { dailyGoal: number; cupSize: number }
  onClose: () => void
  onSave: (dailyGoal: number, cupSize: number) => void
}) {
  const [dailyGoal, setDailyGoal] = useState(initial.dailyGoal)
  const [cupSize, setCupSize] = useState(initial.cupSize)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">目标设置</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* 每日目标 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">每日饮水目标</label>
            <div className="grid grid-cols-4 gap-2">
              {GOAL_OPTIONS.map((g) => (
                <button
                  key={g}
                  onClick={() => setDailyGoal(g)}
                  className="py-2 rounded-lg text-xs border transition relative"
                  style={dailyGoal === g
                    ? { borderColor: '#0EA5E9', background: 'rgba(14, 165, 233, 0.1)', color: '#0284C7', fontWeight: 600 }
                    : { borderColor: 'rgb(var(--color-accent-200))', color: 'rgb(var(--color-accent-500))' }}
                >
                  {g >= 1000 ? `${g / 1000}L` : `${g}ml`}
                  {dailyGoal === g && <Check size={11} className="absolute top-1 right-1" />}
                </button>
              ))}
            </div>
          </div>

          {/* 默认杯容量 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">默认杯容量（用于"还剩几杯"提示）</label>
            <div className="grid grid-cols-3 gap-2">
              {CUP_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCupSize(c)}
                  className="py-2 rounded-lg text-xs border transition relative"
                  style={cupSize === c
                    ? { borderColor: '#0EA5E9', background: 'rgba(14, 165, 233, 0.1)', color: '#0284C7', fontWeight: 600 }
                    : { borderColor: 'rgb(var(--color-accent-200))', color: 'rgb(var(--color-accent-500))' }}
                >
                  {c}ml
                  {cupSize === c && <Check size={11} className="absolute top-1 right-1" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={() => onSave(dailyGoal, cupSize)}
            className="flex-1 py-2.5 text-sm rounded-lg bg-sky-500 text-white hover:bg-sky-600"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
