import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, ChevronLeft, ChevronRight, BarChart3, Loader2, Sparkles } from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { formatTime, mealTypeMeta } from '../lib/utils'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'

interface Diet {
  id: string
  mealType: string
  foodName: string
  portion?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  note?: string
  eatenAt: string
}

/**
 * 饮食记录页
 *
 * 功能：
 * 1. 日期切换：上一日 / 下一日 / 回到今日
 * 2. 今日热量摘要：总卡路里 + 餐数 + 营养素汇总
 * 3. 记录列表：按餐次分组展示，支持删除
 * 4. 新建饮食记录（底部弹层）：餐次、食物、分量、热量、三大营养素
 */
export default function DietPage() {
  const toast = useToast((s) => s.show)
  const [diets, setDiets] = useState<Diet[]>([])
  // 加载与错误状态兜底
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    load()
    // 来自 HomePage 快捷入口 ?new=1 → 自动打开新增弹层
    if (searchParams.get('new') === '1') {
      setShowAdd(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [date])

  const load = async () => {
    // 进入加载态，清除上一次错误
    setLoading(true)
    setError(false)
    try {
      const list = await unwrap<Diet[]>(api.get(`/life/diets?date=${date}`))
      setDiets(list)
    } catch (err) {
      // 标记错误状态并提示，渲染区将展示重试入口
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await unwrap(api.delete(`/life/diets/${id}`))
      toast('已删除', 'success')
      load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  /** 切换到上一日 */
  const prevDay = () => {
    const d = new Date(date)
    d.setDate(d.getDate() - 1)
    setDate(d.toISOString().slice(0, 10))
  }

  /** 切换到下一日 */
  const nextDay = () => {
    const d = new Date(date)
    d.setDate(d.getDate() + 1)
    setDate(d.toISOString().slice(0, 10))
  }

  const isToday = date === new Date().toISOString().slice(0, 10)

  /** 格式化日期显示：2026-08-03 → 8月3日 / 今天 */
  const formatDateLabel = (d: string) => {
    if (d === new Date().toISOString().slice(0, 10)) return '今天'
    const [, m, day] = d.split('-')
    return `${Number(m)}月${Number(day)}日`
  }

  const totalCalories = diets.reduce((s, d) => s + (d.calories || 0), 0)
  const totalProtein = diets.reduce((s, d) => s + (d.protein || 0), 0)
  const totalCarbs = diets.reduce((s, d) => s + (d.carbs || 0), 0)
  const totalFat = diets.reduce((s, d) => s + (d.fat || 0), 0)

  return (
    <div className="app-shell">
      <Header
        title="饮食记录"
        right={
          <div className="flex items-center">
            <Link to="/health/analytics" className="p-2 text-accent-600" title="健康分析">
              <BarChart3 size={20} />
            </Link>
            <button onClick={() => setShowAdd(true)} className="p-2 text-primary-600">
              <Plus size={20} />
            </button>
          </div>
        }
      />
      <div className="px-4 py-3">
        {/* 日期切换器 */}
        <div className="card flex items-center justify-between py-2 mb-3">
          <button
            onClick={prevDay}
            className="p-2 rounded-lg hover:bg-gray-50 text-gray-500"
            aria-label="上一日"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="text-center">
            <div className="text-sm font-medium text-gray-800">{formatDateLabel(date)}</div>
            {!isToday && (
              <button
                onClick={() => setDate(new Date().toISOString().slice(0, 10))}
                className="text-[10px] text-primary-500"
              >
                回到今天
              </button>
            )}
          </div>
          <button
            onClick={nextDay}
            disabled={isToday}
            className="p-2 rounded-lg hover:bg-gray-50 text-gray-500 disabled:opacity-30"
            aria-label="下一日"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* 热量摘要 */}
        <div className="card bg-gradient-to-br from-orange-50 to-white mb-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">{formatDateLabel(date)}摄入</div>
              <div className="text-2xl font-bold text-orange-500">{totalCalories} kcal</div>
            </div>
            <div className="text-4xl">🔥</div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            {diets.length} 餐 · 建议 1800-2200 kcal/天
          </div>
          {/* 三大营养素汇总 */}
          {diets.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-orange-100 text-center">
              <div>
                <div className="text-xs text-gray-400">蛋白质</div>
                <div className="text-sm font-medium text-red-400">{totalProtein.toFixed(1)}g</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">碳水</div>
                <div className="text-sm font-medium text-yellow-500">{totalCarbs.toFixed(1)}g</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">脂肪</div>
                <div className="text-sm font-medium text-green-500">{totalFat.toFixed(1)}g</div>
              </div>
            </div>
          )}
        </div>

        {/* 记录列表：loading / error / empty / 正常列表 四态兜底 */}
        {loading ? (
          <LoadingState skeleton count={3} />
        ) : error ? (
          <ErrorState onRetry={load} />
        ) : diets.length === 0 ? (
          <EmptyState
            icon="🍽️"
            text={isToday ? '今天还没有记录' : '当日无记录'}
            hint={isToday ? '点击右上角 + 记录饮食' : undefined}
          />
        ) : (
          <div className="space-y-2">
            {diets.map((d) => {
              const meta = mealTypeMeta[d.mealType] || { label: d.mealType, icon: '🍴' }
              return (
                <div key={d.id} className="card group">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">{meta.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="badge bg-orange-50 text-orange-600">{meta.label}</span>
                        <span className="text-xs text-gray-400">{formatTime(d.eatenAt)}</span>
                      </div>
                      <div className="text-sm text-gray-800 mt-1">{d.foodName}</div>
                      {d.portion && <div className="text-xs text-gray-500">分量：{d.portion}</div>}
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                        {d.calories && <span>🔥 {d.calories}kcal</span>}
                        {d.protein && <span>🥩 {d.protein}g</span>}
                        {d.carbs && <span>🍚 {d.carbs}g</span>}
                        {d.fat && <span>🥑 {d.fat}g</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => remove(d.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showAdd && <AddDietModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  )
}

function AddDietModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast((s) => s.show)
  const [mealType, setMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('breakfast')
  const [foodName, setFoodName] = useState('')
  const [portion, setPortion] = useState('')
  const [calories, setCalories] = useState<number | ''>('')
  const [protein, setProtein] = useState<number | ''>('')
  const [carbs, setCarbs] = useState<number | ''>('')
  const [fat, setFat] = useState<number | ''>('')
  const [loading, setLoading] = useState(false)
  /** AI 分析中 */
  const [analyzing, setAnalyzing] = useState(false)
  /** 是否已通过 AI 计算营养 */
  const [aiAnalyzed, setAiAnalyzed] = useState(false)

  /** AI 分析食物营养：调用后端 /life/diets/analyze */
  const analyzeFood = async () => {
    if (!foodName.trim()) {
      toast('请先输入食物名称', 'warning')
      return
    }
    setAnalyzing(true)
    try {
      const result = await unwrap<{
        foodName: string
        calories: number
        protein: number
        carbs: number
        fat: number
      }>(api.post('/life/diets/analyze', { foodName: foodName.trim(), portion: portion || undefined }))
      setCalories(Math.round(result.calories))
      setProtein(Math.round(result.protein))
      setCarbs(Math.round(result.carbs))
      setFat(Math.round(result.fat))
      setAiAnalyzed(true)
      toast('AI 已计算营养信息', 'success')
    } catch (err) {
      toast((err as Error).message || 'AI 分析失败，可手动填写', 'error')
    } finally {
      setAnalyzing(false)
    }
  }

  const submit = async () => {
    if (!foodName.trim()) {
      toast('请输入食物名称', 'error')
      return
    }
    setLoading(true)
    try {
      await unwrap(api.post('/life/diets', {
        mealType,
        foodName,
        portion: portion || undefined,
        calories: calories || undefined,
        protein: protein || undefined,
        carbs: carbs || undefined,
        fat: fat || undefined,
      }))
      toast('已记录', 'success')
      onAdded()
      onClose()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white w-full max-w-[480px] mx-auto rounded-t-2xl p-5 animate-slide-up max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">记录饮食</h3>
        <div className="space-y-3">
          {/* 餐次 */}
          <div>
            <label className="text-xs text-gray-500">餐次</label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMealType(m)}
                  className={`py-2 rounded-lg text-xs border ${
                    mealType === m ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {mealTypeMeta[m].icon} {mealTypeMeta[m].label}
                </button>
              ))}
            </div>
          </div>

          {/* 食物名称 + 分量 */}
          <div className="flex gap-2">
            <input
              autoFocus
              className="input flex-1"
              placeholder="食物名称（如 红烧肉）"
              value={foodName}
              onChange={(e) => { setFoodName(e.target.value); setAiAnalyzed(false) }}
            />
            <input
              className="input w-28"
              placeholder="分量"
              value={portion}
              onChange={(e) => { setPortion(e.target.value); setAiAnalyzed(false) }}
            />
          </div>

          {/* AI 算热量按钮 */}
          <button
            onClick={analyzeFood}
            disabled={analyzing || !foodName.trim()}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-primary-500 to-teal-500 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {analyzing ? (
              <>
                <Loader2 size={15} className="animate-spin" /> AI 正在分析营养...
              </>
            ) : (
              <>
                <Sparkles size={15} /> {aiAnalyzed ? '重新 AI 计算' : 'AI 算热量'}
              </>
            )}
          </button>

          {/* 营养信息：AI 计算后自动显示，也可手动微调 */}
          <div className={`rounded-lg p-3 space-y-2 transition-colors ${aiAnalyzed ? 'bg-primary-50 border border-primary-100' : 'bg-gray-50'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">营养信息</span>
              {aiAnalyzed && <span className="text-[10px] text-primary-500 flex items-center gap-0.5"><Sparkles size={10} /> AI 已计算</span>}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { label: '热量', value: calories, set: setCalories, unit: 'kcal', color: 'text-orange-600' },
                { label: '蛋白质', value: protein, set: setProtein, unit: 'g', color: 'text-blue-600' },
                { label: '碳水', value: carbs, set: setCarbs, unit: 'g', color: 'text-amber-600' },
                { label: '脂肪', value: fat, set: setFat, unit: 'g', color: 'text-red-600' },
              ].map((n) => (
                <div key={n.label} className="text-center">
                  <input
                    type="number"
                    inputMode="decimal"
                    className="w-full text-center text-sm bg-white rounded-lg border border-gray-200 py-1.5"
                    placeholder="0"
                    value={n.value}
                    onChange={(e) => n.set(e.target.value ? Number(e.target.value) : '')}
                  />
                  <div className={`text-[10px] mt-0.5 ${n.color} font-medium`}>{n.label}</div>
                  <div className="text-[9px] text-gray-400">{n.unit}</div>
                </div>
              ))}
            </div>
            {!aiAnalyzed && (
              <p className="text-[10px] text-gray-400 text-center">点击上方「AI 算热量」自动计算，或手动填写</p>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn-secondary flex-1">取消</button>
          <button onClick={submit} disabled={loading} className="btn-primary flex-1 disabled:opacity-50">
            {loading ? '记录中...' : '记录'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 text-center mt-2">输入食物名，点「AI 算热量」自动计算营养</p>
      </div>
    </div>
  )
}
