import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, MapPin, Users, Flame, Timer, BookOpen, Droplets, Scale, Dumbbell } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../Toast'
import { eventScopeMeta, EVENT_SCOPES, manualEventColorMeta, MANUAL_EVENT_COLORS } from '../../lib/constants'
import { HomeData, EventDetail } from './homeTypes'
import { getTodayProgress } from '../../lib/habitStore'
import { getTodayStat } from '../../lib/pomodoroStore'
import { getStatsInRange } from '../../lib/novelStore'
import { todayStr } from '../../lib/moodStore'
import { getWaterStat } from '../../lib/waterStore'
import { getWeightStat } from '../../lib/weightStore'
import { getExerciseStat } from '../../lib/exerciseStore'

/* ─────────────────── 工具函数 ─────────────────── */

/**
 * 将秒数倒计时转为人类可读字符串
 */
export function formatCountdown(seconds: number): { text: string; status: 'upcoming' | 'ongoing' | 'ended' } {
  if (seconds < -3600) return { text: '已结束', status: 'ended' }
  if (seconds <= 0) return { text: '正在进行', status: 'ongoing' }
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return { text: `还有 ${days} 天 ${hours} 小时`, status: 'upcoming' }
  if (hours > 0) return { text: `还有 ${hours} 小时 ${minutes} 分钟`, status: 'upcoming' }
  return { text: `还有 ${minutes} 分钟`, status: 'upcoming' }
}

/** 提醒重复标签中文映射 */
export const repeatLabel: Record<string, string> = {
  once: '单次', daily: '每天', weekly: '每周', monthly: '每月',
}

/** 任务优先级中文映射 */
export const priorityLabel: Record<string, string> = {
  urgent: '紧急', high: '高', medium: '中', low: '低',
}

/* ─────────────────── 组件 ─────────────────── */

/**
 * 今日概览卡：聚合本地模块的今日数据
 * 习惯打卡进度 / 今日心情 / 专注时长 / 阅读时长，四格快捷入口
 */
export function TodayOverviewCard() {
  const habit = getTodayProgress()
  const focus = getTodayStat()
  const readSec = getStatsInRange(todayStr(), todayStr())[0]?.seconds || 0
  const readMin = Math.round(readSec / 60)
  const water = getWaterStat()
  const waterPct = Math.min(100, Math.round((water.todayMl / water.dailyGoal) * 100))
  const weight = getWeightStat()
  const exercise = getExerciseStat()

  const hasAny = habit.total > 0 || focus.focusMinutes > 0 || readMin > 0 || water.todayMl > 0 || weight.latest !== null || exercise.todayMinutes > 0
  if (!hasAny) return null

  return (
    <div className="mx-3 mt-3 p-3.5 rounded-3xl bg-white border border-gray-100"
      style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)' }}>
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <span className="text-xs font-semibold text-gray-700">今日概览</span>
        <Link to="/review" className="text-[10px] text-gray-400 flex items-center gap-0.5 active:text-primary-500">
          每周回顾 <ChevronRight size={10} />
        </Link>
      </div>
      <div className="grid grid-cols-6 gap-1">
        <Link to="/habit" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <Flame size={17} className={habit.total > 0 && habit.completed >= habit.total ? 'text-orange-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${habit.completed > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
            {habit.completed}/{habit.total}
          </span>
          <span className="text-[9px] text-gray-400">习惯</span>
        </Link>
        <Link to="/pomodoro" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <Timer size={17} className={focus.focusMinutes > 0 ? 'text-rose-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${focus.focusMinutes > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
            {focus.focusMinutes > 0 ? `${focus.focusMinutes}分` : '—'}
          </span>
          <span className="text-[9px] text-gray-400">专注</span>
        </Link>
        <Link to="/novel" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <BookOpen size={17} className={readMin > 0 ? 'text-blue-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${readMin > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
            {readMin > 0 ? `${readMin}分` : '—'}
          </span>
          <span className="text-[9px] text-gray-400">阅读</span>
        </Link>
        <Link to="/water" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <Droplets size={17} className={water.todayMl > 0 ? 'text-sky-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${water.todayMl > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
            {water.todayMl > 0 ? `${waterPct}%` : '—'}
          </span>
          <span className="text-[9px] text-gray-400">饮水</span>
        </Link>
        <Link to="/weight" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <Scale size={17} className={weight.recordedToday ? 'text-violet-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${weight.latest ? 'text-gray-800' : 'text-gray-300'}`}>
            {weight.latest ? `${weight.latest.kg}` : '—'}
          </span>
          <span className="text-[9px] text-gray-400">体重</span>
        </Link>
        <Link to="/exercise" className="flex flex-col items-center gap-1 py-1.5 rounded-2xl active:bg-gray-50">
          <Dumbbell size={17} className={exercise.todayMinutes > 0 ? 'text-orange-500' : 'text-gray-300'} />
          <span className={`text-xs font-bold ${exercise.todayMinutes > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
            {exercise.todayMinutes > 0 ? `${exercise.todayMinutes}分` : '—'}
          </span>
          <span className="text-[9px] text-gray-400">运动</span>
        </Link>
      </div>
    </div>
  )
}

/**
 * EV-06 添加事件弹层
 */
export function AddEventModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast((s) => s.show)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [scope, setScope] = useState<typeof EVENT_SCOPES[number]>('life')
  const [location, setLocation] = useState('')
  const [attendeesText, setAttendeesText] = useState('')
  const [color, setColor] = useState<typeof MANUAL_EVENT_COLORS[number]>('blue')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!title.trim()) return toast('请填写事件标题', 'error')
    if (!startTime) return toast('请选择开始时间', 'error')
    const startISO = new Date(startTime).toISOString()
    const endISO = endTime ? new Date(endTime).toISOString() : undefined
    if (endISO && new Date(endISO).getTime() < new Date(startISO).getTime()) {
      return toast('结束时间不能早于开始时间', 'error')
    }
    const attendees = attendeesText.split(/[,，;；\s]+/).map((s) => s.trim()).filter(Boolean)
    setLoading(true)
    try {
      await unwrap(api.post('/manual-events', {
        title: title.trim(),
        description: description.trim() || undefined,
        startTime: startISO,
        endTime: endISO,
        scope,
        location: location.trim() || undefined,
        attendees: attendees.length > 0 ? attendees : undefined,
        color,
      }))
      toast('事件已添加', 'success')
      onAdded()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white w-full max-w-[480px] mx-auto rounded-t-2xl p-5 animate-slide-up max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">添加事件</h3>
        <div className="space-y-3">
          <input autoFocus className="input" placeholder="事件标题（如：朋友聚餐）" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input min-h-[60px] resize-none" placeholder="备注（可选）" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-gray-500">开始时间</label><input type="datetime-local" className="input mt-1" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
            <div><label className="text-xs text-gray-500">结束时间（可选）</label><input type="datetime-local" className="input mt-1" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
          </div>
          <div>
            <label className="text-xs text-gray-500">视角</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {EVENT_SCOPES.map((s) => (
                <button key={s} onClick={() => setScope(s)} className={`py-2 rounded-lg text-xs border ${scope === s ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-gray-200'}`}>
                  {eventScopeMeta[s].emoji} {eventScopeMeta[s].label}
                </button>
              ))}
            </div>
          </div>
          <input className="input" placeholder="地点（可选）" value={location} onChange={(e) => setLocation(e.target.value)} />
          <input className="input" placeholder="参与人物（用逗号分隔，可选）" value={attendeesText} onChange={(e) => setAttendeesText(e.target.value)} />
          <div>
            <label className="text-xs text-gray-500">颜色标识</label>
            <div className="flex gap-2 mt-1 flex-wrap">
              {MANUAL_EVENT_COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} className={`w-7 h-7 rounded-full flex items-center justify-center border-2 ${color === c ? 'border-gray-800 scale-110' : 'border-transparent'} transition-transform`} title={manualEventColorMeta[c].label}>
                  <span className={`w-4 h-4 rounded-full ${manualEventColorMeta[c].dot}`} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary flex-1">取消</button>
          <button onClick={submit} disabled={loading} className="btn-primary flex-1 disabled:opacity-50">{loading ? '创建中...' : '创建'}</button>
        </div>
      </div>
    </div>
  )
}

export type { HomeData, EventDetail }
