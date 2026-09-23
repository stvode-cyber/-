import { useState, useMemo, useCallback } from 'react'
import {
  Scale, Plus, Minus, Trash2, X, Settings2, Check, TrendingDown, TrendingUp, Target,
} from 'lucide-react'
import {
  getWeightStat, saveWeight, deleteWeight, getWeight,
  loadSettings, saveSettings, bmiCategory, todayStr, KG_MIN, KG_MAX,
} from '../lib/weightStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 体重记录页
 *
 * 功能：
 * 1. 今日称重：数字输入 + 快捷步进（±0.1 / ±0.5），每日一条（重复为更新）
 * 2. BMI 卡：中国标准分区（偏瘦/正常/超重/肥胖）+ 位置指示条
 * 3. 目标进度：以首条记录为基线，距目标剩余 kg
 * 4. 近 30 天趋势：SVG 折线 + 目标虚线 + 最值标注
 * 5. 记录列表：差值展示，可删除
 * 6. 设置弹窗：身高（BMI 用）+ 目标体重
 */

/** 变化值（kg）展示组件颜色 */
function changeColor(diff: number): string {
  return diff > 0 ? 'text-rose-500' : diff < 0 ? 'text-emerald-600' : 'text-gray-400'
}

function fmtDiff(diff: number): string {
  return diff > 0 ? `+${diff}` : `${diff}`
}

export default function WeightPage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const stat = useMemo(() => getWeightStat(), [version])
  const settings = useMemo(() => loadSettings(), [version])
  const history = useMemo(() => [...stat.trend].reverse(), [stat.trend])

  // 输入值：默认今日已有 > 最新一条 > 空
  const [inputKg, setInputKg] = useState<string>(() => {
    const t = getWeight(todayStr())
    if (t) return String(t.kg)
    if (stat.latest) return String(stat.latest.kg)
    return ''
  })

  const parsedKg = parseFloat(inputKg)
  const validKg = Number.isFinite(parsedKg) && parsedKg >= KG_MIN && parsedKg <= KG_MAX

  const step = useCallback((delta: number) => {
    setInputKg((prev) => {
      const base = parseFloat(prev)
      const next = Math.round(((Number.isFinite(base) ? base : 0) + delta) * 10) / 10
      return String(Math.max(KG_MIN, Math.min(KG_MAX, next)))
    })
  }, [])

  const handleSave = useCallback(() => {
    if (!validKg) {
      toast(`请输入 ${KG_MIN}-${KG_MAX} 之间的体重`, 'error')
      return
    }
    const ok = saveWeight(todayStr(), parsedKg)
    if (!ok) {
      toast('保存失败，数值非法', 'error')
      return
    }
    toast(stat.recordedToday ? `已更新今日体重 ${parsedKg}kg` : `已记录 ${parsedKg}kg`, 'success')
    refresh()
  }, [validKg, parsedKg, stat.recordedToday, toast, refresh])

  const handleDelete = useCallback((date: string) => {
    deleteWeight(date)
    if (date === todayStr()) setInputKg(stat.latest && stat.latest.date !== todayStr() ? String(stat.latest.kg) : '')
    toast('记录已删除', 'info')
    refresh()
  }, [stat.latest, toast, refresh])

  const handleSaveSettings = useCallback((heightCm: number, goalKg: number | null) => {
    saveSettings({ heightCm, goalKg })
    setShowSettings(false)
    toast('设置已保存', 'success')
    refresh()
  }, [toast, refresh])

  const bmiCat = stat.bmi !== null ? bmiCategory(stat.bmi) : null

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Scale size={22} className="text-violet-500" /> 体重记录
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {stat.latest
                ? `最新 ${stat.latest.kg}kg（${stat.latest.date.slice(5).replace('-', '.')}）`
                : '记录每次称重，观察长期趋势'}
            </p>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg text-gray-400 hover:text-violet-500 hover:bg-violet-50"
            title="身高与目标设置"
          >
            <Settings2 size={18} />
          </button>
        </div>

        {/* 今日称重卡 */}
        <div className="card p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-gray-700">今日称重</span>
            {stat.recordedToday && (
              <span className="text-[10px] text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5 flex items-center gap-0.5">
                <Check size={10} /> 已记录
              </span>
            )}
          </div>
          <div className="flex items-center justify-center gap-3 mb-4">
            <button
              onClick={() => step(-0.5)}
              className="w-11 h-11 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 active:scale-95 transition-all flex flex-col items-center justify-center"
              title="-0.5"
            >
              <Minus size={13} />
              <span className="text-[9px] leading-none mt-0.5">0.5</span>
            </button>
            <button
              onClick={() => step(-0.1)}
              className="w-11 h-11 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 active:scale-95 transition-all flex flex-col items-center justify-center"
              title="-0.1"
            >
              <Minus size={13} />
              <span className="text-[9px] leading-none mt-0.5">0.1</span>
            </button>
            <div className="flex items-baseline gap-1 min-w-[120px] justify-center">
              <input
                value={inputKg}
                onChange={(e) => setInputKg(e.target.value)}
                onBlur={() => {
                  const v = parseFloat(inputKg)
                  if (Number.isFinite(v)) setInputKg(String(Math.round(v * 10) / 10))
                }}
                inputMode="decimal"
                className={`w-24 text-center text-4xl font-bold tabular-nums bg-transparent outline-none border-b-2 pb-1 focus:border-violet-400 transition-colors ${
                  validKg || inputKg === '' ? 'text-gray-800 border-gray-200' : 'text-rose-500 border-rose-300'
                }`}
                placeholder="0.0"
              />
              <span className="text-sm text-gray-400">kg</span>
            </div>
            <button
              onClick={() => step(0.1)}
              className="w-11 h-11 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 active:scale-95 transition-all flex flex-col items-center justify-center"
              title="+0.1"
            >
              <Plus size={13} />
              <span className="text-[9px] leading-none mt-0.5">0.1</span>
            </button>
            <button
              onClick={() => step(0.5)}
              className="w-11 h-11 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 active:scale-95 transition-all flex flex-col items-center justify-center"
              title="+0.5"
            >
              <Plus size={13} />
              <span className="text-[9px] leading-none mt-0.5">0.5</span>
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={!validKg}
            className="w-full py-3 rounded-xl bg-violet-500 text-white font-medium hover:bg-violet-600 active:scale-[0.98] transition-all disabled:opacity-40"
          >
            {stat.recordedToday ? '更新今日体重' : '保存记录'}
          </button>
          {/* 变化摘要 */}
          {(stat.change7d !== null || stat.change30d !== null) && (
            <div className="flex items-center justify-center gap-6 mt-4 text-xs">
              {stat.change7d !== null && (
                <span className="text-gray-500 flex items-center gap-1">
                  较7天前
                  <span className={`font-semibold flex items-center gap-0.5 ${changeColor(stat.change7d)}`}>
                    {stat.change7d === 0 ? '持平' : (
                      <>{stat.change7d > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {fmtDiff(stat.change7d)}kg</>
                    )}
                  </span>
                </span>
              )}
              {stat.change30d !== null && (
                <span className="text-gray-500 flex items-center gap-1">
                  较30天前
                  <span className={`font-semibold flex items-center gap-0.5 ${changeColor(stat.change30d)}`}>
                    {stat.change30d === 0 ? '持平' : (
                      <>{stat.change30d > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {fmtDiff(stat.change30d)}kg</>
                    )}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* BMI 卡 */}
        <div className="card p-5 mb-4">
          <div className="text-sm font-medium text-gray-700 mb-3">BMI 身体质量指数</div>
          {bmiCat ? (
            <>
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-3xl font-bold tabular-nums" style={{ color: bmiCat.color }}>
                  {stat.bmi}
                </span>
                <span className="text-sm font-semibold rounded-full px-2.5 py-0.5" style={{ color: bmiCat.color, background: `${bmiCat.color}1A` }}>
                  {bmiCat.label}
                </span>
              </div>
              {/* 分区色条 + 位置指示 */}
              <div className="relative">
                <div className="flex h-2 rounded-full overflow-hidden">
                  <div className="flex-[18.5] bg-amber-400" title="偏瘦 <18.5" />
                  <div className="flex-[5.5] bg-emerald-500" title="正常 18.5-24" />
                  <div className="flex-[4] bg-orange-500" title="超重 24-28" />
                  <div className="flex-[3] bg-rose-500" title="肥胖 ≥28" />
                </div>
                {stat.bmi !== null && (
                  <div
                    className="absolute -top-1 w-4 h-4 rounded-full bg-white border-[3px] shadow-sm transition-all"
                    style={{
                      borderColor: bmiCat.color,
                      left: `calc(${Math.min(97, Math.max(1, (stat.bmi / 35) * 100))}% - 8px)`,
                    }}
                  />
                )}
              </div>
              <div className="flex justify-between text-[9px] text-gray-400 mt-2">
                <span>偏瘦 &lt;18.5</span>
                <span>正常 18.5-24</span>
                <span>超重 24-28</span>
                <span>肥胖 ≥28</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-2">按中国成人标准，身高 {settings.heightCm}cm</p>
            </>
          ) : (
            <div className="text-center py-3">
              <p className="text-xs text-gray-400">{stat.latest ? '请先在设置中填写身高，以计算 BMI' : '记录体重并填写身高后，这里会显示 BMI'}</p>
              <button onClick={() => setShowSettings(true)} className="mt-2 text-xs text-violet-500 hover:text-violet-600">
                去设置身高 →
              </button>
            </div>
          )}
        </div>

        {/* 目标进度卡 */}
        {settings.goalKg !== null && stat.latest && stat.goalProgress !== null && (
          <div className="card p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <Target size={14} className="text-violet-500" /> 目标进度
              </span>
              <span className="text-xs text-gray-400">目标 {settings.goalKg}kg</span>
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-2xl font-bold text-gray-800 tabular-nums">{stat.latest.kg}</span>
              <span className="text-xs text-gray-400">kg</span>
              <span className="text-xs text-gray-400 ml-1">
                {stat.goalRemaining === 0 ? '已达成目标 🎉' : stat.goalRemaining! > 0 ? `还需减 ${stat.goalRemaining}kg` : `还需增 ${-stat.goalRemaining!}kg`}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-600 transition-all duration-500"
                style={{ width: `${stat.goalProgress}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
              <span>起点 {stat.first?.kg ?? '—'}kg</span>
              <span>{stat.goalProgress}%</span>
            </div>
          </div>
        )}

        {/* 近 30 天趋势 */}
        {stat.trend.length >= 2 && (
          <div className="card p-5 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">近 30 天趋势</span>
              <span className="text-xs text-gray-400">
                {stat.minKg !== null && stat.maxKg !== null ? `${stat.minKg} - ${stat.maxKg} kg` : ''}
              </span>
            </div>
            <WeightTrendChart entries={stat.trend} goalKg={settings.goalKg} />
          </div>
        )}

        {/* 记录列表 */}
        {history.length > 0 && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">记录列表</span>
              <span className="text-xs text-gray-400">近 30 天 {history.length} 条</span>
            </div>
            <div className="space-y-0.5">
              {history.map((e, i) => {
                const prev = i + 1 < history.length ? history[i + 1] : null
                const diff = prev ? Math.round((e.kg - prev.kg) * 10) / 10 : null
                const isToday = e.date === todayStr()
                return (
                  <div key={e.date} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0 group">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${isToday ? 'bg-violet-100 text-violet-600' : 'bg-violet-50 text-violet-400'}`}>
                      <Scale size={12} />
                    </span>
                    <span className={`flex-1 text-xs ${isToday ? 'text-gray-800 font-semibold' : 'text-gray-500'}`}>
                      {e.date.slice(5).replace('-', '/')}
                      {isToday && <span className="text-[9px] text-violet-500 ml-1">今天</span>}
                    </span>
                    {diff !== null && (
                      <span className={`text-[10px] tabular-nums ${changeColor(diff)}`}>
                        {diff === 0 ? '持平' : fmtDiff(diff)}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-gray-700 tabular-nums w-14 text-right">{e.kg}kg</span>
                    <button
                      onClick={() => handleDelete(e.date)}
                      className="p-1 rounded text-gray-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 设置弹窗 */}
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

/** 近 30 天体重趋势 SVG 折线（含目标虚线） */
function WeightTrendChart({ entries, goalKg }: { entries: { date: string; kg: number }[]; goalKg: number | null }) {
  const W = 320, H = 130, P = 10
  const values = entries.map((e) => e.kg)
  const minV = Math.min(...values, goalKg ?? Infinity)
  const maxV = Math.max(...values, goalKg ?? -Infinity)
  const pad = Math.max(0.5, (maxV - minV) * 0.15)
  const lo = minV - pad
  const hi = maxV + pad
  const stepX = (W - P * 2) / (entries.length - 1 || 1)
  const yOf = (kg: number) => H - P - ((kg - lo) / (hi - lo)) * (H - P * 2 - 8)

  const points = entries.map((e, i) => ({ x: P + i * stepX, y: yOf(e.kg), ...e }))
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${path} L ${points[points.length - 1].x} ${H - P} L ${points[0].x} ${H - P} Z`

  // 极值点
  const minIdx = values.indexOf(minV)
  const maxIdx = values.indexOf(maxV)

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: '280px' }}>
        <defs>
          <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 目标虚线 */}
        {goalKg !== null && goalKg >= lo && goalKg <= hi && (
          <>
            <line x1={P} x2={W - P} y1={yOf(goalKg)} y2={yOf(goalKg)} stroke="#8B5CF6" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="4 3" />
            <text x={W - P} y={yOf(goalKg) - 3} textAnchor="end" fontSize="8" fill="#8B5CF6">目标 {goalKg}kg</text>
          </>
        )}
        <path d={areaPath} fill="url(#weightGrad)" />
        <path d={path} fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.date}>
            <circle cx={p.x} cy={p.y} r="2.5" fill="#8B5CF6" stroke="white" strokeWidth="1" />
            {/* 最新点加大 + 标注 */}
            {i === points.length - 1 && (
              <>
                <circle cx={p.x} cy={p.y} r="4" fill="none" stroke="#8B5CF6" strokeWidth="1.5" />
                <text x={Math.min(p.x, W - 26)} y={p.y - 8} textAnchor="middle" fontSize="9" fill="#7C3AED" fontWeight="600">
                  {p.kg}kg
                </text>
              </>
            )}
            {i === minIdx && minIdx !== points.length - 1 && (
              <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize="8" fill="#10B981">低 {p.kg}</text>
            )}
            {i === maxIdx && maxIdx !== minIdx && maxIdx !== points.length - 1 && (
              <text x={p.x} y={p.y - 6} textAnchor="middle" fontSize="8" fill="#F59E0B">高 {p.kg}</text>
            )}
          </g>
        ))}
        {/* 首尾日期 */}
        <text x={P} y={H - 1} fontSize="8" fill="#9CA3AF">{points[0].date.slice(5).replace('-', '/')}</text>
        <text x={W - P} y={H - 1} textAnchor="end" fontSize="8" fill="#9CA3AF">{points[points.length - 1].date.slice(5).replace('-', '/')}</text>
      </svg>
    </div>
  )
}

// ===== 设置弹窗 =====

function SettingsModal({ initial, onClose, onSave }: {
  initial: { heightCm: number; goalKg: number | null }
  onClose: () => void
  onSave: (heightCm: number, goalKg: number | null) => void
}) {
  const [height, setHeight] = useState(initial.heightCm > 0 ? String(initial.heightCm) : '')
  const [goal, setGoal] = useState(initial.goalKg !== null ? String(initial.goalKg) : '')

  const hVal = parseFloat(height)
  const hOk = height === '' || (Number.isFinite(hVal) && hVal >= 80 && hVal <= 250)
  const gVal = parseFloat(goal)
  const gOk = goal === '' || (Number.isFinite(gVal) && gVal >= 20 && gVal <= 300)

  const submit = () => {
    if (!hOk || !gOk) return
    onSave(
      hOk && height !== '' ? Math.round(hVal) : 0,
      gOk && goal !== '' ? Math.round(gVal * 10) / 10 : null,
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">身高与目标</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* 身高 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">身高（cm，用于计算 BMI）</label>
            <div className="flex items-center gap-2">
              <input
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                onBlur={() => { if (hOk && height !== '') setHeight(String(Math.round(hVal))) }}
                inputMode="numeric"
                placeholder="如 170"
                className={`flex-1 px-3 py-2.5 rounded-lg text-sm border outline-none focus:border-violet-400 ${
                  hOk ? 'border-gray-200' : 'border-rose-300 text-rose-500'
                }`}
              />
              <span className="text-xs text-gray-400">cm</span>
            </div>
            {!hOk && <p className="text-[10px] text-rose-500 mt-1">身高范围 80-250</p>}
          </div>

          {/* 目标体重 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">目标体重（kg，留空表示暂不设目标）</label>
            <div className="flex items-center gap-2">
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                inputMode="decimal"
                placeholder="如 65"
                className={`flex-1 px-3 py-2.5 rounded-lg text-sm border outline-none focus:border-violet-400 ${
                  gOk ? 'border-gray-200' : 'border-rose-300 text-rose-500'
                }`}
              />
              <span className="text-xs text-gray-400">kg</span>
            </div>
            {!gOk && <p className="text-[10px] text-rose-500 mt-1">体重范围 20-300</p>}
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!hOk || !gOk}
            className="flex-1 py-2.5 text-sm rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
