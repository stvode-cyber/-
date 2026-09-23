import { useState, useMemo, useCallback } from 'react'
import {
  Dumbbell, Plus, Trash2, X, Trophy, Check, Target, Zap, CalendarCheck,
} from 'lucide-react'
import {
  getExerciseStat, addExercise, deleteExercise, listDayEntries,
  loadSettings, saveSettings, estimateCalories,
  EXERCISE_META, INTENSITY_META, QUICK_MINUTES,
  type ExerciseType, type ExerciseIntensity,
} from '../lib/exerciseStore'
import { todayStr } from '../lib/moodStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 运动记录页
 *
 * 功能：
 * 1. 今日运动：快捷记录（类型宫格 + 时长 + 强度），今日记录列表可删除
 * 2. 周目标进度：本周分钟数 / 目标（WHO 建议 150 分钟）
 * 3. 近 7 天柱状图：日均目标线
 * 4. 本周类型分布：各运动占比
 */

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 周进度颜色 */
function goalColor(pct: number): string {
  if (pct >= 100) return '#F97316'
  if (pct >= 60) return '#FB923C'
  if (pct >= 30) return '#FDBA74'
  return '#FED7AA'
}

export default function ExercisePage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const [showAdd, setShowAdd] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const stat = useMemo(() => getExerciseStat(), [version])
  const entries = useMemo(() => listDayEntries(todayStr()), [version])
  const settings = useMemo(() => loadSettings(), [version])

  const handleAdd = useCallback((type: ExerciseType, minutes: number, intensity: ExerciseIntensity, note?: string) => {
    const ok = addExercise(type, minutes, intensity, note)
    if (!ok) {
      toast('时长不合法（1-600 分钟）', 'error')
      return
    }
    const after = getExerciseStat()
    // 达标瞬间：保存前未达标、保存后达标
    if (after.weekMinutes >= settings.weeklyGoalMin && stat.weekMinutes < settings.weeklyGoalMin) {
      toast(`本周运动目标达成！🎉 累计 ${after.weekMinutes} 分钟`, 'success')
    } else {
      toast(`${EXERCISE_META[type].label} ${minutes} 分钟 +${estimateCalories(type, minutes, intensity)} kcal`, 'info')
    }
    setShowAdd(false)
    refresh()
  }, [toast, refresh, settings.weeklyGoalMin, stat.weekMinutes])

  const handleDelete = useCallback((at: number) => {
    deleteExercise(at)
    toast('已删除记录', 'info')
    refresh()
  }, [toast, refresh])

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Dumbbell size={22} className="text-orange-500" /> 运动记录
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              连续运动 {stat.streak} 天 · 本周 {stat.weekDays} 天 / {stat.weekMinutes} 分钟
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg text-gray-400 hover:text-orange-500 hover:bg-orange-50"
              title="周目标设置"
            >
              <Target size={18} />
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="px-3 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 active:scale-95 transition-all flex items-center gap-1"
            >
              <Plus size={15} /> 记一笔
            </button>
          </div>
        </div>

        {/* 今日 + 周目标合并卡 */}
        <div className="card p-5 mb-4">
          <div className="flex items-center gap-5">
            {/* 周目标环 */}
            <div className="relative w-28 h-28 flex-shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" className="stroke-accent-100" strokeWidth="10" />
                <circle
                  cx="50" cy="50" r="42" fill="none"
                  stroke={goalColor(stat.weekGoalPct)}
                  strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${(stat.weekGoalPct / 100) * 2 * Math.PI * 42} ${2 * Math.PI * 42}`}
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {stat.weekGoalPct >= 100 ? (
                  <>
                    <Trophy size={18} className="text-orange-500 mb-0.5" />
                    <span className="text-[10px] text-orange-600 font-medium">已达标</span>
                  </>
                ) : (
                  <>
                    <span className="text-xl font-bold text-gray-800 tabular-nums">{stat.weekGoalPct}%</span>
                    <span className="text-[9px] text-gray-400">周目标</span>
                  </>
                )}
              </div>
            </div>
            {/* 数值 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-gray-800 tabular-nums">{stat.weekMinutes}</span>
                <span className="text-sm text-gray-400">/ {settings.weeklyGoalMin} 分钟（本周）</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {settings.weeklyGoalMin - stat.weekMinutes > 0
                  ? `距目标还差 ${settings.weeklyGoalMin - stat.weekMinutes} 分钟`
                  : `超出目标 ${stat.weekMinutes - settings.weeklyGoalMin} 分钟，干得漂亮 💪`}
              </p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                  <Zap size={11} className="text-amber-500" /> 本周 {stat.weekCalories} kcal
                </span>
                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                  <CalendarCheck size={11} className="text-emerald-500" /> 近30天 {stat.total30d} 分
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 今日记录 */}
        <div className="card p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">今日运动</span>
            <span className="text-xs text-gray-400">
              {stat.todayCount > 0 ? `${stat.todayMinutes} 分钟 · ${stat.todayCalories} kcal` : '还没动起来'}
            </span>
          </div>
          {entries.length === 0 ? (
            <div className="text-center py-5">
              <div className="text-2xl mb-1.5">🏃</div>
              <p className="text-xs text-gray-400 mb-3">今天还没有运动记录</p>
              <button
                onClick={() => setShowAdd(true)}
                className="px-4 py-2 rounded-lg bg-orange-50 text-orange-600 text-xs font-medium hover:bg-orange-100 active:scale-95 transition-all"
              >
                + 记一次运动
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {[...entries].reverse().map((e) => {
                const meta = EXERCISE_META[e.type]
                return (
                  <div key={e.at} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0 group">
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm"
                      style={{ background: `${meta.color}1A` }}
                    >
                      {meta.emoji}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-800">{meta.label}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                          {INTENSITY_META[e.intensity].label}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        {e.note ? ` · ${e.note}` : ''}
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 tabular-nums">{e.minutes}分</span>
                    <span className="text-[11px] text-amber-600 tabular-nums w-14 text-right">{e.calories}kcal</span>
                    <button
                      onClick={() => handleDelete(e.at)}
                      className="p-1 rounded text-gray-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 近 7 天柱状图 */}
        <div className="card p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-gray-700">近 7 天</span>
            <span className="text-xs text-gray-400">日均目标 {Math.round(settings.weeklyGoalMin / 7)} 分钟</span>
          </div>
          <div className="relative h-28">
            {(() => {
              const maxMin = Math.max(...stat.last7Days.map((d) => d.minutes), Math.round(settings.weeklyGoalMin / 7), 30)
              return stat.last7Days.map((d, i) => {
                const isToday = d.date === todayStr()
                const hit = d.minutes >= settings.weeklyGoalMin / 7
                const h = d.minutes > 0 ? Math.max(6, (d.minutes / maxMin) * 88) : 0
                return (
                  <div
                    key={d.date}
                    className="absolute bottom-0 flex flex-col items-center justify-end"
                    style={{ left: `${(i / 7) * 100 + 100 / 14}%`, transform: 'translateX(-50%)', width: '10%' }}
                  >
                    {d.minutes > 0 && (
                      <span className={`text-[9px] mb-1 tabular-nums ${hit ? 'text-orange-600 font-semibold' : 'text-gray-400'}`}>
                        {d.minutes}分
                      </span>
                    )}
                    {/* 日均目标线（仅首列渲染横线） */}
                    {i === 0 && (
                      <div
                        className="absolute left-0 right-0 border-t border-dashed border-orange-300"
                        style={{ bottom: `${((settings.weeklyGoalMin / 7) / maxMin) * 88 + 18}px` }}
                      />
                    )}
                    <div
                      className="w-full rounded-t-lg transition-all"
                      style={{
                        height: `${h}px`,
                        background: hit ? '#F97316' : d.minutes > 0 ? '#FDBA74' : 'rgb(var(--color-accent-100))',
                      }}
                      title={`${d.date} ${d.minutes}分钟`}
                    />
                    <span className={`text-[10px] mt-1 ${isToday ? 'text-orange-600 font-semibold' : 'text-gray-400'}`}>
                      {WEEKDAY_LABELS[new Date(d.date + 'T00:00:00').getDay()]}
                    </span>
                  </div>
                )
              })
            })()}
          </div>
        </div>

        {/* 本周类型分布 */}
        {stat.weekByType.length > 0 && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">本周运动构成</span>
              <span className="text-xs text-gray-400">{stat.weekByType.length} 种</span>
            </div>
            {/* 堆叠条 */}
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              {stat.weekByType.map((t) => (
                <div
                  key={t.type}
                  style={{
                    width: `${(t.minutes / Math.max(stat.weekMinutes, 1)) * 100}%`,
                    background: EXERCISE_META[t.type].color,
                  }}
                  title={`${EXERCISE_META[t.type].label} ${t.minutes}分钟`}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {stat.weekByType.map((t) => (
                <div key={t.type} className="flex items-center gap-2 rounded-lg p-2 bg-gray-50">
                  <span className="text-base">{EXERCISE_META[t.type].emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-700 truncate">{EXERCISE_META[t.type].label}</div>
                    <div className="text-[10px] text-gray-400">{t.minutes}分 · {t.calories}kcal</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 添加记录弹窗 */}
      {showAdd && (
        <AddExerciseModal onClose={() => setShowAdd(false)} onSave={handleAdd} />
      )}

      {/* 目标设置弹窗 */}
      {showSettings && (
        <GoalModal
          initial={settings.weeklyGoalMin}
          onClose={() => setShowSettings(false)}
          onSave={(v) => {
            saveSettings({ weeklyGoalMin: v })
            setShowSettings(false)
            toast('周目标已更新', 'success')
            refresh()
          }}
        />
      )}
    </div>
  )
}

// ===== 添加记录弹窗 =====

const TYPE_LIST = Object.keys(EXERCISE_META) as ExerciseType[]

function AddExerciseModal({ onClose, onSave }: {
  onClose: () => void
  onSave: (type: ExerciseType, minutes: number, intensity: ExerciseIntensity, note?: string) => void
}) {
  const [type, setType] = useState<ExerciseType>('walking')
  const [minutes, setMinutes] = useState(30)
  const [intensity, setIntensity] = useState<ExerciseIntensity>('med')
  const [note, setNote] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">记录运动</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* 类型宫格 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">运动类型</label>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_LIST.map((t) => {
                const meta = EXERCISE_META[t]
                const active = type === t
                return (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className="py-2.5 rounded-xl border text-center relative transition-all active:scale-95"
                    style={active
                      ? { borderColor: meta.color, background: `${meta.color}14`, color: meta.color, fontWeight: 600 }
                      : { borderColor: 'rgb(var(--color-accent-200))', color: 'rgb(var(--color-accent-500))' }}
                  >
                    <span className="text-lg block leading-none mb-1">{meta.emoji}</span>
                    <span className="text-[11px]">{meta.label}</span>
                    {active && <Check size={11} className="absolute top-1 right-1" style={{ color: meta.color }} />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 时长 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">时长（分钟）</label>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="range"
                min={5}
                max={180}
                step={5}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="flex-1 accent-orange-500"
              />
              <span className="text-lg font-bold text-gray-800 tabular-nums w-12 text-right">{minutes}</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {QUICK_MINUTES.map((m) => (
                <button
                  key={m}
                  onClick={() => setMinutes(m)}
                  className={`py-1.5 rounded-lg text-[11px] border transition ${
                    minutes === m
                      ? 'border-orange-400 bg-orange-50 text-orange-600 font-semibold'
                      : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {m}分
                </button>
              ))}
            </div>
          </div>

          {/* 强度 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">强度</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(INTENSITY_META) as ExerciseIntensity[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setIntensity(k)}
                  className={`py-2 rounded-lg text-xs border transition ${
                    intensity === k
                      ? 'border-orange-400 bg-orange-50 text-orange-600 font-semibold'
                      : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {INTENSITY_META[k].label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              约消耗 {estimateCalories(type, minutes, intensity)} kcal（按 MET 估算，体重取自体重记录）
            </p>
          </div>

          {/* 备注 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">备注（可选）</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={50}
              placeholder="如：晨跑 5 公里"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-orange-400"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={() => onSave(type, minutes, intensity, note)}
            className="flex-1 py-2.5 text-sm rounded-lg bg-orange-500 text-white hover:bg-orange-600 active:scale-[0.98] transition-all"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 周目标设置弹窗 =====

const GOAL_OPTIONS = [100, 150, 200, 300]

function GoalModal({ initial, onClose, onSave }: {
  initial: number
  onClose: () => void
  onSave: (v: number) => void
}) {
  const [goal, setGoal] = useState(initial)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">每周运动目标</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-4 gap-2">
            {GOAL_OPTIONS.map((g) => (
              <button
                key={g}
                onClick={() => setGoal(g)}
                className="py-2.5 rounded-lg text-xs border transition relative"
                style={goal === g
                  ? { borderColor: '#F97316', background: 'rgba(249, 115, 22, 0.1)', color: '#EA580C', fontWeight: 600 }
                  : { borderColor: 'rgb(var(--color-accent-200))', color: 'rgb(var(--color-accent-500))' }}
              >
                {g}分钟
                {goal === g && <Check size={11} className="absolute top-1 right-1 text-orange-500" />}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">WHO 建议成人每周至少 150 分钟中等强度运动</p>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={() => onSave(goal)}
            className="flex-1 py-2.5 text-sm rounded-lg bg-orange-500 text-white hover:bg-orange-600"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
