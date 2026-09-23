import { useState, useMemo, useCallback } from 'react'
import type { CSSProperties } from 'react'
import {
  Plus, Flame, Check, Trash2, X, Calendar, TrendingUp, Target,
  Dumbbell, BookOpen, Code, Droplet, Apple, Footprints,
  Moon, Sun, Pencil, Music, PawPrint, Heart,
  Coffee, Cigarette, Smartphone, Gamepad2, CheckCircle,
} from 'lucide-react'
import {
  type Habit, type HabitFrequency, listHabits, addHabit, deleteHabit,
  toggleCheckin, getHabitStat, todayStr, HABIT_ICONS, HABIT_COLORS,
} from '../lib/habitStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 习惯追踪页
 *
 * 功能：
 * 1. 今日打卡：圆形按钮一键打卡/取消
 * 2. 习惯列表：显示当前连续天数、近7天打卡情况
 * 3. 新建习惯：名称 + 图标 + 颜色 + 频率
 * 4. 统计：连续天数、完成率、总打卡次数
 */

/** 习惯图标名 → 组件映射（避免 import * 拉入整个 lucide-react） */
const ICON_MAP: Record<string, typeof Plus> = {
  Dumbbell, BookOpen, Code, Droplet, Apple, Footprints,
  Moon, Sun, Pencil, Music, PawPrint, Heart,
  Coffee, Cigarette, Smartphone, Gamepad2,
}

/** 根据图标名获取 lucide 组件，找不到时回退 CheckCircle */
function getIcon(name: string): typeof Plus {
  return ICON_MAP[name] || CheckCircle
}

/** 构造带 CSS 自定义属性的 style 对象 */
function ringStyle(color: string, active: boolean): CSSProperties | undefined {
  if (!active) return undefined
  return { background: `${color}15`, color, ['--tw-ring-color' as string]: color } as CSSProperties
}

/** 星期几标签 */
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 日历单元格 */
interface CalendarCell {
  date: string
  checked: boolean
  inMonth: boolean
}

export default function HabitPage() {
  const toast = useToast((s) => s.show)
  const [habits, setHabits] = useState<Habit[]>(() => listHabits())
  const [showAdd, setShowAdd] = useState(false)
  const [selectedHabit, setSelectedHabit] = useState<Habit | null>(null)
  // 打卡版本号：toggleCheckin 只写 localStorage，靠版本号触发统计重算与重渲染
  const [checkVersion, setCheckVersion] = useState(0)

  const refresh = useCallback(() => setHabits(listHabits()), [])

  const handleToggle = useCallback((habitId: string) => {
    const today = todayStr()
    const checked = toggleCheckin(habitId, today)
    setCheckVersion((v) => v + 1)
    toast(checked ? '打卡成功！' : '已取消打卡', checked ? 'success' : 'info')
  }, [toast])

  const handleDelete = useCallback((habitId: string) => {
    deleteHabit(habitId)
    refresh()
    setSelectedHabit(null)
    toast('习惯已删除', 'success')
  }, [refresh, toast])

  // 今日进度（checkVersion 变化时重算）
  const todayProgress = useMemo(() => {
    let completed = 0
    const today = todayStr()
    for (const h of habits) {
      const dates = JSON.parse(localStorage.getItem('habit_checkins_v1') || '{}')
      if (dates[h.id]?.includes(today)) completed++
    }
    return { total: habits.length, completed }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habits, checkVersion])

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Flame size={22} className="text-orange-500" /> 习惯追踪
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              今日 {todayProgress.completed}/{todayProgress.total} 完成
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="btn-primary text-sm"
          >
            <Plus size={16} className="mr-1" /> 新建习惯
          </button>
        </div>

        {/* 今日进度卡片 */}
        {habits.length > 0 && (
          <div className="card p-5 mb-4 bg-gradient-to-br from-orange-50 via-white to-amber-50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500 flex items-center gap-1.5">
                <Target size={14} className="text-orange-500" /> 今日目标
              </span>
              <span className="text-xs text-gray-400">
                {todayProgress.completed === todayProgress.total && todayProgress.total > 0
                  ? '全部完成！🎉'
                  : `还差 ${todayProgress.total - todayProgress.completed} 个`}
              </span>
            </div>
            {/* 进度条 */}
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-500 transition-all duration-500"
                style={{ width: `${todayProgress.total > 0 ? (todayProgress.completed / todayProgress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="text-right text-xs text-gray-400 mt-1 tabular-nums">
              {todayProgress.total > 0 ? Math.round((todayProgress.completed / todayProgress.total) * 100) : 0}%
            </div>
          </div>
        )}

        {/* 习惯列表 */}
        {habits.length === 0 ? (
          <div className="card p-12 text-center">
            <Flame size={48} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm text-gray-400 mb-4">还没有习惯，开始创建第一个吧</p>
            <button
              onClick={() => setShowAdd(true)}
              className="btn-primary text-sm"
            >
              <Plus size={16} className="mr-1" /> 创建习惯
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {habits.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                stat={getHabitStat(habit.id)}
                onToggle={() => handleToggle(habit.id)}
                onClick={() => setSelectedHabit(habit)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 新建习惯弹窗 */}
      {showAdd && (
        <AddHabitModal
          onClose={() => setShowAdd(false)}
          onAdd={(data) => {
            addHabit(data)
            refresh()
            setShowAdd(false)
            toast('习惯已创建', 'success')
          }}
        />
      )}

      {/* 习惯详情弹窗 */}
      {selectedHabit && (
        <HabitDetailModal
          habit={selectedHabit}
          onClose={() => setSelectedHabit(null)}
          onDelete={() => handleDelete(selectedHabit.id)}
        />
      )}
    </div>
  )
}

// ===== 习惯卡片 =====

function HabitCard({ habit, stat, onToggle, onClick }: {
  habit: Habit
  stat: ReturnType<typeof getHabitStat>
  onToggle: () => void
  onClick: () => void
}) {
  const checkedToday = stat.last7Days[stat.last7Days.length - 1]?.checked
  const Icon = getIcon(habit.icon)
  const dotClass = habit.color

  return (
    <div className="card p-4 flex items-center gap-3">
      {/* 图标 */}
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${habit.color}15` }}
      >
        <Icon size={22} style={{ color: habit.color }} />
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800 truncate">{habit.name}</span>
          {stat.currentStreak > 0 && (
            <span className="badge bg-orange-50 text-orange-600 text-[10px] flex items-center gap-0.5">
              <Flame size={10} /> {stat.currentStreak}
            </span>
          )}
        </div>
        {/* 近7天打卡圆点 */}
        <div className="flex items-center gap-1 mt-1.5">
          {stat.last7Days.map((d, i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full"
              style={d.checked ? { background: dotClass } : { background: 'rgb(var(--color-accent-200))' }}
              title={`${d.date} ${d.checked ? '已打卡' : '未打卡'}`}
            />
          ))}
          <span className="text-[10px] text-gray-400 ml-1">
            {habit.frequency === 'daily' ? '每日' : `每周${habit.weeklyTarget}天`}
          </span>
        </div>
      </div>

      {/* 打卡按钮 */}
      <button
        onClick={onToggle}
        className="w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-90 flex-shrink-0"
        style={checkedToday
          ? { background: habit.color, borderColor: habit.color, color: '#fff' }
          : { border: '2px solid rgb(var(--color-accent-200))', color: 'rgb(var(--color-accent-300))' }}
        title={checkedToday ? '今日已打卡（点击取消）' : '点击打卡'}
      >
        <Check size={20} strokeWidth={3} />
      </button>
    </div>
  )
}

// ===== 新建习惯弹窗 =====

function AddHabitModal({ onClose, onAdd }: {
  onClose: () => void
  onAdd: (data: { name: string; icon: string; color: string; frequency: HabitFrequency; weeklyTarget: number }) => void
}) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<string>(HABIT_ICONS[0])
  const [color, setColor] = useState<string>(HABIT_COLORS[0])
  const [frequency, setFrequency] = useState<HabitFrequency>('daily')
  const [weeklyTarget, setWeeklyTarget] = useState(3)

  const handleSubmit = () => {
    if (!name.trim()) return
    onAdd({ name: name.trim(), icon, color, frequency, weeklyTarget })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">新建习惯</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* 名称 */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">习惯名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：每日阅读 30 分钟"
              autoFocus
              maxLength={20}
              className="input"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          {/* 图标 */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">选择图标</label>
            <div className="grid grid-cols-8 gap-2">
              {HABIT_ICONS.map((ic) => {
                const Ic = getIcon(ic)
                return (
                  <button
                    key={ic}
                    onClick={() => setIcon(ic)}
                    className="aspect-square rounded-lg flex items-center justify-center transition"
                    style={ringStyle(color, icon === ic)}
                  >
                    <Ic size={18} />
                  </button>
                )
              })}
            </div>
          </div>

          {/* 颜色 */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">选择颜色</label>
            <div className="flex gap-2">
              {HABIT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-8 h-8 rounded-full transition"
                  style={{ background: c, outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2, transform: color === c ? 'scale(1.1)' : 'none' }}
                />
              ))}
            </div>
          </div>

          {/* 频率 */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">打卡频率</label>
            <div className="flex gap-2">
              <button
                onClick={() => setFrequency('daily')}
                className="flex-1 py-2 rounded-lg text-sm border transition"
                style={frequency === 'daily'
                  ? { borderColor: '#6366F1', background: 'rgba(99, 102, 241, 0.14)', color: '#818CF8', fontWeight: 500 }
                  : { borderColor: 'rgb(var(--color-accent-200))', color: 'rgb(var(--color-accent-500))' }}
              >
                每日
              </button>
              <button
                onClick={() => setFrequency('weekly')}
                className="flex-1 py-2 rounded-lg text-sm border transition"
                style={frequency === 'weekly'
                  ? { borderColor: '#6366F1', background: 'rgba(99, 102, 241, 0.14)', color: '#818CF8', fontWeight: 500 }
                  : { borderColor: 'rgb(var(--color-accent-200))', color: 'rgb(var(--color-accent-500))' }}
              >
                每周
              </button>
            </div>
          </div>

          {/* 每周目标天数 */}
          {frequency === 'weekly' && (
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">每周目标天数：{weeklyTarget} 天</label>
              <input
                type="range" min={1} max={7} step={1} value={weeklyTarget}
                onChange={(e) => setWeeklyTarget(Number(e.target.value))}
                className="w-full accent-primary-500"
              />
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex-1 py-2.5 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 习惯详情弹窗 =====

function HabitDetailModal({ habit, onClose, onDelete }: {
  habit: Habit
  onClose: () => void
  onDelete: () => void
}) {
  const stat = useMemo(() => getHabitStat(habit.id), [habit.id])
  const Icon = getIcon(habit.icon)
  const today = todayStr()

  // 本月日历
  const calendar = useMemo<CalendarCell[][]>(() => {
    const weeks: CalendarCell[][] = []
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startWeekday = firstDay.getDay()
    const dateSet = new Set(getCheckinDatesForCalendar(habit.id))

    const current = new Date(firstDay)
    let week: CalendarCell[] = []
    // 前置空白
    for (let i = 0; i < startWeekday; i++) {
      const d = new Date(year, month, -startWeekday + i + 1)
      const ds = todayStr(d)
      week.push({ date: ds, checked: dateSet.has(ds), inMonth: false })
    }
    while (current <= lastDay) {
      const ds = todayStr(current)
      week.push({ date: ds, checked: dateSet.has(ds), inMonth: true })
      if (week.length === 7) {
        weeks.push(week)
        week = []
      }
      current.setDate(current.getDate() + 1)
    }
    if (week.length > 0) {
      // 补齐尾部
      while (week.length < 7) {
        const d = new Date(current)
        const ds = todayStr(d)
        week.push({ date: ds, checked: dateSet.has(ds), inMonth: false })
        current.setDate(current.getDate() + 1)
      }
      weeks.push(week)
    }
    return weeks
  }, [habit.id])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: `${habit.color}15` }}
            >
              <Icon size={16} style={{ color: habit.color }} />
            </div>
            <span className="font-semibold text-sm">{habit.name}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* 统计卡片 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="flex items-center justify-center text-orange-500 mb-1">
                <Flame size={16} />
              </div>
              <div className="text-xl font-bold text-gray-800">{stat.currentStreak}</div>
              <div className="text-[10px] text-gray-400">当前连续</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center text-amber-500 mb-1">
                <TrendingUp size={16} />
              </div>
              <div className="text-xl font-bold text-gray-800">{stat.longestStreak}</div>
              <div className="text-[10px] text-gray-400">最长连续</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center text-primary-500 mb-1">
                <Target size={16} />
              </div>
              <div className="text-xl font-bold text-gray-800">{stat.completionRate}%</div>
              <div className="text-[10px] text-gray-400">近30天完成率</div>
            </div>
          </div>

          {/* 总打卡次数 */}
          <div className="flex items-center justify-between text-xs text-gray-400 px-1">
            <span>总打卡次数</span>
            <span className="font-medium text-gray-600">{stat.totalCheckins} 次</span>
          </div>

          {/* 本月日历 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <Calendar size={14} className="text-gray-400" />
                {new Date().getFullYear()}年{new Date().getMonth() + 1}月
              </span>
            </div>
            {/* 星期标签 */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAY_LABELS.map((w) => (
                <div key={w} className="text-center text-[10px] text-gray-400 py-1">{w}</div>
              ))}
            </div>
            {/* 日期网格 */}
            <div className="space-y-1">
              {calendar.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1">
                  {week.map((day, di) => (
                    <div
                      key={di}
                      className="aspect-square rounded-md flex items-center justify-center text-[10px]"
                      style={{
                        color: !day.inMonth ? 'rgb(var(--color-accent-200))' : day.checked ? '#fff' : 'rgb(var(--color-accent-500))',
                        background: day.checked ? habit.color : undefined,
                        fontWeight: day.checked ? 500 : undefined,
                        boxShadow: day.date === today && day.inMonth ? '0 0 0 1px #818CF8' : undefined,
                      }}
                      title={day.date}
                    >
                      {day.inMonth ? parseInt(day.date.slice(-2), 10) : ''}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* 近 7 天详细 */}
          <div>
            <div className="text-xs text-gray-500 mb-2">近 7 天</div>
            <div className="flex items-center justify-between">
              {stat.last7Days.map((d, i) => {
                const wd = new Date(d.date + 'T00:00:00').getDay()
                return (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-gray-400">{WEEKDAY_LABELS[wd]}</span>
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px]"
                      style={d.checked
                        ? { background: habit.color, color: '#fff' }
                        : { background: 'rgb(var(--color-accent-100))', color: 'rgb(var(--color-accent-400))' }}
                    >
                      {d.checked ? <Check size={12} strokeWidth={3} /> : parseInt(d.date.slice(-2), 10)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 底部操作 */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button
            onClick={onDelete}
            className="flex-1 py-2.5 text-sm rounded-lg border border-red-200 text-red-500 hover:bg-red-50 flex items-center justify-center gap-1"
          >
            <Trash2 size={14} /> 删除习惯
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

/** 获取打卡日期集合（用于日历渲染，不暴露 store 内部结构） */
function getCheckinDatesForCalendar(habitId: string): string[] {
  try {
    const data = JSON.parse(localStorage.getItem('habit_checkins_v1') || '{}')
    return (data[habitId] || []) as string[]
  } catch {
    return []
  }
}
