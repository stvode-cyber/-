import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X, Loader2, Clock } from 'lucide-react'
import { getCalendarMonth, type CalendarResponse, type CalendarDayEvent } from '../lib/api'
import { useToast } from '../components/Toast'
import { gregorianToLunar } from '../lib/lunar'

/**
 * 日历视图页面（万年历增强版）
 *
 * 月历展示，整合万年历信息：
 * - 每日农历日期 + 节日标记
 * - 月份前后/年份导航
 * - 事件彩色标签（任务/账单/饮食/睡眠/提醒/交接/事件 7 类）
 * - 点击日期查看当日详情（含农历/宜忌/事件）
 * - 月统计概览
 */

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const EVENT_STYLES: Record<string, { dot: string; chip: string; text: string }> = {
  task:        { dot: 'bg-purple-500',  chip: 'bg-purple-50',  text: 'text-purple-600' },
  bill:        { dot: 'bg-emerald-500', chip: 'bg-emerald-50', text: 'text-emerald-600' },
  diet:        { dot: 'bg-orange-500',  chip: 'bg-orange-50',  text: 'text-orange-600' },
  sleep:       { dot: 'bg-indigo-500',  chip: 'bg-indigo-50',  text: 'text-indigo-600' },
  reminder:    { dot: 'bg-pink-500',    chip: 'bg-pink-50',    text: 'text-pink-600' },
  handover:    { dot: 'bg-teal-500',    chip: 'bg-teal-50',    text: 'text-teal-600' },
  manualEvent: { dot: 'bg-amber-500',   chip: 'bg-amber-50',   text: 'text-amber-600' },
}
const EVENT_LABELS: Record<string, string> = {
  task: '任务', bill: '账单', diet: '饮食', sleep: '睡眠',
  reminder: '提醒', handover: '交接', manualEvent: '事件',
}
const fallbackStyle = { dot: 'bg-gray-400', chip: 'bg-gray-100', text: 'text-gray-600' }
const getStyle = (type: string) => EVENT_STYLES[type] || fallbackStyle

export default function CalendarPage() {
  const toast = useToast((s) => s.show)
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const fetchCalendar = useCallback(async (y: number, m: number) => {
    setLoading(true)
    try {
      const res = await getCalendarMonth(y, m)
      setData(res)
    } catch (e: any) {
      setData(null)
      toast(e?.message || '日历加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchCalendar(year, month)
  }, [year, month, fetchCalendar])

  const prevMonth = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12) } else { setMonth((m) => m - 1) }
  }
  const nextMonth = () => {
    if (month === 12) { setYear((y) => y + 1); setMonth(1) } else { setMonth((m) => m + 1) }
  }
  const prevYear = () => setYear((y) => y - 1)
  const nextYear = () => setYear((y) => y + 1)
  const goToday = () => {
    setYear(today.getFullYear())
    setMonth(today.getMonth() + 1)
  }

  // 日历网格
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  let startWeekday = firstDay.getDay() - 1
  if (startWeekday < 0) startWeekday = 6

  const cells: Array<{ day: number | null; dateKey: string | null }> = []
  for (let i = 0; i < startWeekday; i++) cells.push({ day: null, dateKey: null })
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, dateKey: key })
  }

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const selectedEvents: CalendarDayEvent[] | undefined = selectedDay ? data?.days[selectedDay] : undefined

  // 农历缓存（避免每天重复计算）
  const lunarCache = useMemo(() => {
    const cache: Record<string, { shortText: string; festival?: string; yi: string[]; ji: string[]; zodiacYear: string; ganzhi: string }> = {}
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d)
      const lunar = gregorianToLunar(date)
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      cache[key] = {
        shortText: lunar.shortText,
        festival: lunar.festival,
        yi: lunar.yi,
        ji: lunar.ji,
        zodiacYear: lunar.zodiacYear,
        ganzhi: lunar.ganzhi,
      }
    }
    return cache
  }, [year, month, daysInMonth])

  // 月份农历信息
  const monthLunar = lunarCache[Object.keys(lunarCache)[0]] || { zodiacYear: '', ganzhi: '' }

  // 事件统计
  const typeCounts: Record<string, number> = {}
  if (data) {
    Object.values(data.days).forEach((events) => {
      events.forEach((e) => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1 })
    })
  }

  // 选中日的农历详情
  const selectedLunar = selectedDay ? lunarCache[selectedDay] : null

  return (
    <div className="space-y-3">
      {/* 月份导航 + 年份导航 */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-400 to-teal-500 flex items-center justify-center shadow-md shadow-primary-200/50">
            <CalendarIcon size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-accent-800 leading-tight">
              {year} 年 {month} 月
            </h2>
            <div className="flex items-center gap-2">
              <button onClick={goToday} className="text-[12px] text-primary-600 hover:text-primary-700 font-medium">回到今天</button>
              <span className="text-accent-200">·</span>
              <span className="text-[11px] text-accent-400">{monthLunar.zodiacYear}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* 年份导航 */}
          <button onClick={prevYear} className="w-8 h-8 flex items-center justify-center rounded-lg text-accent-400 hover:text-accent-600 hover:bg-accent-100 transition-all active:scale-95 text-xs font-mono">
            ‹‹
          </button>
          {/* 月份导航 */}
          <button onClick={prevMonth} className="w-9 h-9 flex items-center justify-center rounded-xl text-accent-500 hover:text-accent-700 hover:bg-accent-100 transition-all active:scale-95">
            <ChevronLeft size={18} />
          </button>
          <button onClick={nextMonth} className="w-9 h-9 flex items-center justify-center rounded-xl text-accent-500 hover:text-accent-700 hover:bg-accent-100 transition-all active:scale-95">
            <ChevronRight size={18} />
          </button>
          <button onClick={nextYear} className="w-8 h-8 flex items-center justify-center rounded-lg text-accent-400 hover:text-accent-600 hover:bg-accent-100 transition-all active:scale-95 text-xs font-mono">
            ››
          </button>
        </div>
      </div>

      {/* 统计概览 */}
      {data && (
        <div className="flex items-center gap-1.5 flex-wrap px-1">
          <span className="text-[12px] font-medium text-accent-400">共 {data.totalEvents} 条</span>
          <span className="text-accent-200">·</span>
          {Object.entries(typeCounts).map(([type, count]) => {
            const s = getStyle(type)
            return (
              <span key={type} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${s.chip} ${s.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                {EVENT_LABELS[type] || type} {count}
              </span>
            )
          })}
        </div>
      )}

      {/* 日历网格 */}
      <div className="bg-white rounded-2xl border border-accent-100 shadow-sm shadow-accent-100/40 overflow-hidden">
        {/* 星期表头 */}
        <div className="grid grid-cols-7 border-b border-accent-100 bg-accent-50/40">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`py-2 text-center text-[11px] font-semibold ${i >= 5 ? 'text-primary-400' : 'text-accent-400'}`}>
              {w}
            </div>
          ))}
        </div>

        {/* 日期单元格 */}
        <div className="grid grid-cols-7">
          {cells.map((cell, i) => {
            if (!cell.day) {
              return <div key={i} className="min-h-[80px] border-r border-b border-accent-50 bg-accent-50/20" />
            }
            const events = data?.days[cell.dateKey!] || []
            const isToday = cell.dateKey === todayKey
            const isSelected = cell.dateKey === selectedDay
            const lunar = lunarCache[cell.dateKey!]
            const hasFestival = lunar?.festival
            return (
              <button
                key={i}
                onClick={() => setSelectedDay(cell.dateKey)}
                className={`min-h-[80px] border-r border-b border-accent-50 p-1.5 text-left transition-colors hover:bg-primary-50/40 relative ${
                  isSelected ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' : ''
                } ${isToday ? 'bg-primary-50/30' : ''}`}
              >
                {/* 公历日期 */}
                <div className="flex items-start justify-between">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-semibold transition-all ${
                    isToday
                      ? 'bg-gradient-to-br from-primary-500 to-teal-500 text-white shadow-md shadow-primary-300/40'
                      : hasFestival
                        ? 'text-red-500'
                        : 'text-accent-600'
                  }`}>
                    {cell.day}
                  </span>
                  {/* 农历日期 */}
                  {lunar && (
                    <span className={`text-[9px] leading-tight mt-0.5 ${hasFestival ? 'text-red-500 font-medium' : 'text-accent-300'}`}>
                      {hasFestival || lunar.shortText}
                    </span>
                  )}
                </div>
                {/* 事件标签 */}
                {events.length > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    {events.slice(0, 3).map((e, idx) => {
                      const s = getStyle(e.type)
                      return (
                        <div key={idx} className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] truncate ${s.chip} ${s.text}`}>
                          <span className={`w-1 h-1 rounded-full shrink-0 ${s.dot}`} />
                          <span className="truncate font-medium">{e.title}</span>
                        </div>
                      )
                    })}
                    {events.length > 3 && (
                      <div className="text-[9px] text-accent-400 pl-1 font-medium">+{events.length - 3}</div>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* 选中日期详情面板 */}
      {selectedDay && selectedEvents !== undefined && selectedLunar && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4" onClick={() => setSelectedDay(null)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-accent-100 max-h-[70vh] overflow-hidden flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1.5 bg-gradient-to-r from-primary-400 via-teal-400 to-primary-500" />
            {/* 日期头 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-accent-100">
              <div>
                <h3 className="text-base font-semibold text-accent-800 flex items-center gap-2">
                  <CalendarIcon size={18} className="text-primary-500" />
                  {selectedDay}
                </h3>
                <div className="text-[12px] text-accent-400 mt-0.5">
                  {selectedLunar.zodiacYear} · {selectedLunar.shortText}
                  {selectedLunar.festival && <span className="text-red-500 font-medium ml-1">· {selectedLunar.festival}</span>}
                </div>
              </div>
              <button onClick={() => setSelectedDay(null)} className="w-8 h-8 flex items-center justify-center rounded-lg text-accent-400 hover:text-accent-600 hover:bg-accent-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* 宜忌 */}
              {(selectedLunar.yi.length > 0 || selectedLunar.ji.length > 0) && (
                <div className="flex gap-3 p-3 rounded-xl bg-accent-50/40 border border-accent-50">
                  {selectedLunar.yi.length > 0 && (
                    <div className="flex-1">
                      <div className="text-[11px] font-semibold text-emerald-600 mb-1">宜</div>
                      <div className="text-[12px] text-accent-500 leading-relaxed">{selectedLunar.yi.join(' · ')}</div>
                    </div>
                  )}
                  {selectedLunar.ji.length > 0 && (
                    <div className="flex-1 border-l border-accent-100 pl-3">
                      <div className="text-[11px] font-semibold text-red-500 mb-1">忌</div>
                      <div className="text-[12px] text-accent-500 leading-relaxed">{selectedLunar.ji.join(' · ')}</div>
                    </div>
                  )}
                </div>
              )}

              {/* 事件列表 */}
              <div>
                <div className="text-[12px] font-semibold text-accent-500 mb-2 flex items-center gap-1">
                  <Clock size={14} /> 当日事件 {selectedEvents.length} 条
                </div>
                {selectedEvents.length === 0 ? (
                  <div className="text-center py-4 text-sm text-accent-300">当日暂无事件</div>
                ) : (
                  <div className="space-y-2">
                    {selectedEvents.map((e, idx) => {
                      const s = getStyle(e.type)
                      return (
                        <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-accent-50/40 hover:bg-accent-50 transition-colors border border-accent-50">
                          <span className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${s.dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-medium text-accent-700">{e.title}</div>
                            {e.subtitle && <div className="text-[12px] text-accent-400 mt-0.5">{e.subtitle}</div>}
                          </div>
                          <span className={`text-[11px] font-medium shrink-0 px-2 py-0.5 rounded-full ${s.chip} ${s.text}`}>
                            {EVENT_LABELS[e.type] || e.type}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-accent-400 text-sm">
          <Loader2 size={16} className="animate-spin text-primary-500" />
          加载中...
        </div>
      )}

      {!loading && data && data.totalEvents === 0 && (
        <div className="text-center py-8 text-accent-400 text-sm">
          本月暂无事件记录
        </div>
      )}
    </div>
  )
}
