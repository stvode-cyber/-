import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Activity, UtensilsCrossed, Flame, Loader2, Scale, Dumbbell,
} from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'
import { getWeightStat, bmiCategory } from '../lib/weightStore'
import { getExerciseStat, EXERCISE_META } from '../lib/exerciseStore'

/** 饮食记录（与后端 model Diet 对齐） */
interface Diet {
  id: string
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  foodName: string
  portion: string | null
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  eatenAt: string
}

const MEAL_META: Record<Diet['mealType'], { label: string; color: string }> = {
  breakfast: { label: '早餐', color: '#F59E0B' },
  lunch: { label: '午餐', color: '#10B981' },
  dinner: { label: '晚餐', color: '#6366F1' },
  snack: { label: '加餐', color: '#EC4899' },
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 取最近 N 天的日期字符串（YYYY-MM-DD），含今日，升序 */
function recentDates(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

export default function HealthAnalyticsPage() {
  const toast = useToast((s) => s.show)
  const [dietByDay, setDietByDay] = useState<Record<string, Diet[]>>({})
  const [loading, setLoading] = useState(true)

  const days = useMemo(() => recentDates(7), [])

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      // 7 天饮食逐日拉取
      const dietResults = await Promise.all(
        days.map((d) =>
          unwrap<Diet[]>(api.get(`/life/diets?date=${d}`))
            .then((list) => ({ date: d, list }))
            .catch(() => ({ date: d, list: [] as Diet[] }))
        ),
      )
      const dietMap: Record<string, Diet[]> = {}
      dietResults.forEach((r) => {
        if (r && r.date) dietMap[r.date] = r.list
      })
      setDietByDay(dietMap)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // 饮食每日热量
  const dailyCalories = days.map((d) => {
    const list = dietByDay[d] || []
    return list.reduce((s, x) => s + (x.calories || 0), 0)
  })
  const maxCalories = Math.max(...dailyCalories, 2000)

  // 今日饮食分类占比
  const todayDiets = dietByDay[days[days.length - 1]] || []
  const todayCalories = todayDiets.reduce((s, x) => s + (x.calories || 0), 0)
  const todayByMeal = useMemo(() => {
    const map: Record<string, number> = {}
    todayDiets.forEach((d) => {
      map[d.mealType] = (map[d.mealType] || 0) + (d.calories || 0)
    })
    return map
  }, [todayDiets])

  // 7 天营养总和
  const weeklyNutrition = useMemo(() => {
    let protein = 0, carbs = 0, fat = 0
    Object.values(dietByDay).forEach((list) => {
      list.forEach((d) => {
        protein += d.protein || 0
        carbs += d.carbs || 0
        fat += d.fat || 0
      })
    })
    return { protein, carbs, fat }
  }, [dietByDay])

  // 本地体重数据（离线可用）
  const weightStat = useMemo(() => getWeightStat(), [])
  const weightCat = weightStat.bmi !== null ? bmiCategory(weightStat.bmi) : null

  // 本地运动数据（离线可用）
  const exerciseStat = useMemo(() => getExerciseStat(), [])
  // 本周热量收支：饮食摄入 − 运动消耗
  const weekIntakeCal = dailyCalories.reduce((s, c) => s + c, 0)
  const weekBalance = weekIntakeCal - exerciseStat.weekCalories

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell p-4 pb-8'}>
      <div className={isDesktop() ? 'max-w-5xl mx-auto' : ''}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Link to="/" className="p-1.5 rounded-lg hover:bg-gray-100 text-accent-500">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-accent-800 flex items-center gap-2">
                <Activity size={22} className="text-rose-500" /> 健康分析
              </h1>
              <p className="text-xs text-accent-400 mt-0.5">近 7 天饮食趋势</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/diet" className="p-2 rounded-lg border border-gray-200 bg-white text-accent-700 hover:bg-gray-50" title="饮食记录">
              <UtensilsCrossed size={18} />
            </Link>
            <Link to="/weight" className="p-2 rounded-lg border border-gray-200 bg-white text-accent-700 hover:bg-gray-50" title="体重记录">
              <Scale size={18} />
            </Link>
            <Link to="/exercise" className="p-2 rounded-lg border border-gray-200 bg-white text-accent-700 hover:bg-gray-50" title="运动记录">
              <Dumbbell size={18} />
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-accent-400 text-sm">
            <Loader2 size={18} className="animate-spin mr-2" /> 加载中…
          </div>
        ) : (
          <>
            {/* 概览卡片 */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="card p-3">
                <div className="flex items-center gap-1.5 text-xs text-accent-400 mb-1">
                  <Flame size={12} /> 今日热量
                </div>
                <div className="text-base font-bold text-amber-600">
                  {todayCalories > 0 ? `${todayCalories} kcal` : '—'}
                </div>
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-1.5 text-xs text-accent-400 mb-1">
                  <Scale size={12} /> 当前体重
                </div>
                <div className="text-base font-bold" style={{ color: weightCat ? weightCat.color : '#8B5CF6' }}>
                  {weightStat.latest ? `${weightStat.latest.kg} kg` : '—'}
                </div>
                {weightStat.bmi !== null && weightCat && (
                  <div className="text-[10px] mt-0.5" style={{ color: weightCat.color }}>BMI {weightStat.bmi} · {weightCat.label}</div>
                )}
              </div>
              <div className="card p-3">
                <div className="flex items-center gap-1.5 text-xs text-accent-400 mb-1">
                  <Dumbbell size={12} /> 本周运动
                </div>
                <div className="text-base font-bold text-orange-600">
                  {exerciseStat.weekMinutes > 0 ? `${exerciseStat.weekMinutes} 分` : '—'}
                </div>
                <div className="text-[10px] mt-0.5 text-orange-500">
                  {exerciseStat.weekMinutes > 0 ? `目标 ${exerciseStat.weekGoalPct}% · ${exerciseStat.weekCalories} kcal` : '动起来'}
                </div>
              </div>
            </div>

            {/* 饮食热量柱状图 */}
            <div className="card p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-accent-700 flex items-center gap-1.5">
                  <Flame size={15} className="text-amber-500" /> 近 7 天每日热量
                </span>
                <span className="text-xs text-accent-400">建议 1800-2200 kcal</span>
              </div>
              <div className="flex items-end justify-between gap-2 h-32">
                {dailyCalories.map((c, i) => {
                  const h = Math.max(2, (c / maxCalories) * 100)
                  const over = c > 2200
                  const low = c > 0 && c < 1200
                  return (
                    <div key={days[i]} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[10px] text-accent-500 tabular-nums">{c > 0 ? c : ''}</div>
                      <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                        <div
                          className={`w-full max-w-[24px] rounded-t transition-all ${
                            over ? 'bg-rose-400' : low ? 'bg-amber-300' : 'bg-gradient-to-t from-amber-300 to-amber-500'
                          }`}
                          style={{ height: `${h}%` }}
                          title={`${days[i]}：${c} kcal`}
                        />
                      </div>
                      <div className="text-[9px] text-accent-400">{dayLabel(days[i])}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 今日餐次分布 */}
            <div className="card p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-accent-700 flex items-center gap-1.5">
                  <UtensilsCrossed size={15} className="text-emerald-500" /> 今日餐次分布
                </span>
                <span className="text-xs text-accent-400">{todayDiets.length} 条记录</span>
              </div>
              {todayDiets.length === 0 ? (
                <div className="text-center text-xs text-accent-400 py-6">今日暂无饮食记录</div>
              ) : (
                <>
                  <div className="flex h-3 rounded-full overflow-hidden mb-3">
                    {(['breakfast', 'lunch', 'dinner', 'snack'] as Diet['mealType'][]).map((mt) => {
                      const cal = todayByMeal[mt] || 0
                      if (cal === 0) return null
                      return (
                        <div
                          key={mt}
                          style={{ width: `${(cal / Math.max(todayCalories, 1)) * 100}%`, background: MEAL_META[mt].color }}
                          title={`${MEAL_META[mt].label} ${cal} kcal`}
                        />
                      )
                    })}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(['breakfast', 'lunch', 'dinner', 'snack'] as Diet['mealType'][]).map((mt) => {
                      const cal = todayByMeal[mt] || 0
                      const pct = todayCalories > 0 ? (cal / todayCalories) * 100 : 0
                      return (
                        <div key={mt} className="rounded-lg p-2 bg-gray-50">
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className="w-2 h-2 rounded-sm" style={{ background: MEAL_META[mt].color }} />
                            <span className="text-[11px] text-accent-500">{MEAL_META[mt].label}</span>
                          </div>
                          <div className="text-sm font-semibold text-accent-700 tabular-nums">
                            {cal > 0 ? `${cal}` : '—'}<span className="text-[10px] text-accent-400 ml-0.5">kcal</span>
                          </div>
                          <div className="text-[10px] text-accent-400">{pct.toFixed(0)}%</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 周营养摄入 */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-accent-700">近 7 天营养摄入累计</span>
                <span className="text-xs text-accent-400">蛋白质 / 碳水 / 脂肪</span>
              </div>
              {weeklyNutrition.protein + weeklyNutrition.carbs + weeklyNutrition.fat === 0 ? (
                <div className="text-center text-xs text-accent-400 py-4">本周暂无营养数据</div>
              ) : (
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg p-3 bg-rose-50">
                    <div className="text-xs text-accent-400 mb-0.5">蛋白质</div>
                    <div className="text-base font-bold text-rose-600">{weeklyNutrition.protein.toFixed(0)}<span className="text-[10px] ml-0.5">g</span></div>
                  </div>
                  <div className="rounded-lg p-3 bg-amber-50">
                    <div className="text-xs text-accent-400 mb-0.5">碳水</div>
                    <div className="text-base font-bold text-amber-600">{weeklyNutrition.carbs.toFixed(0)}<span className="text-[10px] ml-0.5">g</span></div>
                  </div>
                  <div className="rounded-lg p-3 bg-sky-50">
                    <div className="text-xs text-accent-400 mb-0.5">脂肪</div>
                    <div className="text-base font-bold text-sky-600">{weeklyNutrition.fat.toFixed(0)}<span className="text-[10px] ml-0.5">g</span></div>
                  </div>
                </div>
              )}
            </div>

            {/* 体重趋势（本地数据，离线可用） */}
            {weightStat.trend.length >= 2 && (
              <div className="card p-5 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-accent-700 flex items-center gap-1.5">
                    <Scale size={15} className="text-violet-500" /> 近 30 天体重趋势
                  </span>
                  <Link to="/weight" className="text-xs text-violet-500 hover:text-violet-600">详情 →</Link>
                </div>
                <WeightMiniTrend entries={weightStat.trend} />
                <div className="flex items-center justify-between mt-2 text-[11px] text-accent-400">
                  <span>区间：{weightStat.minKg} - {weightStat.maxKg} kg</span>
                  {weightStat.change30d !== null && (
                    <span className={weightStat.change30d < 0 ? 'text-emerald-600' : weightStat.change30d > 0 ? 'text-rose-500' : ''}>
                      30天变化 {weightStat.change30d > 0 ? '+' : ''}{weightStat.change30d} kg
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 本周运动 + 热量收支（本地数据，离线可用） */}
            {exerciseStat.weekMinutes > 0 && (
              <div className="card p-5 mt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-accent-700 flex items-center gap-1.5">
                    <Dumbbell size={15} className="text-orange-500" /> 本周运动
                  </span>
                  <Link to="/exercise" className="text-xs text-orange-500 hover:text-orange-600">详情 →</Link>
                </div>
                <div className="flex items-center gap-4 mb-3">
                  <div className="flex-1">
                    <div className="flex items-baseline gap-1.5 mb-1.5">
                      <span className="text-2xl font-bold text-gray-800 tabular-nums">{exerciseStat.weekMinutes}</span>
                      <span className="text-xs text-accent-400">分钟 · {exerciseStat.weekDays} 天</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-300 to-orange-500 transition-all duration-500"
                        style={{ width: `${exerciseStat.weekGoalPct}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-accent-400 mt-1">周目标完成 {exerciseStat.weekGoalPct}%</div>
                  </div>
                  <div className="text-center flex-shrink-0">
                    <div className="text-xl font-bold text-amber-600 tabular-nums">{exerciseStat.weekCalories}</div>
                    <div className="text-[10px] text-accent-400">运动消耗 kcal</div>
                  </div>
                </div>
                {/* 类型 chips */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {exerciseStat.weekByType.map((t) => (
                    <span
                      key={t.type}
                      className="text-[10px] px-2 py-1 rounded-full"
                      style={{ background: `${EXERCISE_META[t.type].color}14`, color: EXERCISE_META[t.type].color }}
                    >
                      {EXERCISE_META[t.type].emoji} {EXERCISE_META[t.type].label} {t.minutes}分
                    </span>
                  ))}
                </div>
                {/* 热量收支 */}
                <div className="rounded-lg bg-gray-50 p-3 flex items-center justify-between">
                  <div className="text-[11px] text-accent-500">
                    <span className="text-accent-700 font-semibold">热量收支</span>（本周）
                  </div>
                  <div className="text-xs text-accent-500 tabular-nums">
                    摄入 {weekIntakeCal} − 运动 {exerciseStat.weekCalories}
                    <span className={`ml-1.5 font-semibold ${weekBalance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      = {weekBalance > 0 ? '盈余 ' : '缺口 '}
                      {Math.abs(weekBalance)} kcal
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** 简易 SVG 折线图：体重趋势（近 30 天，稀疏记录连线） */
function WeightMiniTrend({ entries }: { entries: { date: string; kg: number }[] }) {
  const W = 320, H = 100, P = 8
  const values = entries.map((e) => e.kg)
  const lo = Math.min(...values) - 0.5
  const hi = Math.max(...values) + 0.5
  const stepX = (W - P * 2) / (entries.length - 1 || 1)
  const yOf = (kg: number) => H - P - ((kg - lo) / (hi - lo)) * (H - P * 2)

  const points = entries.map((e, i) => ({ x: P + i * stepX, y: yOf(e.kg), ...e }))
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <path d={path} fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={p.date}>
          <circle cx={p.x} cy={p.y} r="2.5" fill="#8B5CF6" stroke="white" strokeWidth="1">
            <title>{`${p.date}：${p.kg} kg`}</title>
          </circle>
          {i === points.length - 1 && (
            <text x={Math.min(p.x, W - 20)} y={p.y - 7} textAnchor="middle" fontSize="9" fill="#7C3AED" fontWeight="600">
              {p.kg}kg
            </text>
          )}
        </g>
      ))}
      <text x={P} y={H - 1} fontSize="8" fill="#9CA3AF">{points[0].date.slice(5).replace('-', '/')}</text>
      <text x={W - P} y={H - 1} textAnchor="end" fontSize="8" fill="#9CA3AF">{points[points.length - 1].date.slice(5).replace('-', '/')}</text>
    </svg>
  )
}
