import { useState, useMemo, useCallback } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  BarChart3, ChevronLeft, ChevronRight, Flame, Smile, Timer, BookOpen, Lightbulb, CheckCircle2,
} from 'lucide-react'
import { getWeekReview, formatWeekRange, moodColor } from '../lib/reviewStore'
import { MOOD_META, todayStr, type MoodLevel } from '../lib/moodStore'
import { isDesktop } from '../lib/localCache'

/**
 * 每周回顾页
 *
 * 聚合本地模块数据生成个人周报：
 * 1. 周导航：左右翻周（未来周禁用）
 * 2. 综合评分卡：活跃天数 + 评分 + 等级
 * 3. 四大模块概览：习惯打卡 / 心情均值 / 专注时长 / 阅读时长
 * 4. 每日活动总览：7 列时间线（习惯/心情/专注/阅读一行一格）
 * 5. 习惯明细表：每个习惯的 7 天打卡点阵
 * 6. 智能建议：基于数据生成的简单洞察
 */

/** 评分对应的主题色 */
function scoreColor(score: number): string {
  if (score >= 80) return '#10B981'
  if (score >= 60) return '#3B82F6'
  if (score >= 40) return '#F59E0B'
  return '#F97316'
}

export default function ReviewPage() {
  const [weekOffset, setWeekOffset] = useState(0)
  const review = useMemo(() => getWeekReview(weekOffset), [weekOffset])

  const prevWeek = useCallback(() => setWeekOffset((o) => o - 1), [])
  const nextWeek = useCallback(() => setWeekOffset((o) => Math.min(0, o + 1)), [])

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <BarChart3 size={22} className="text-primary-500" /> 每周回顾
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">汇总习惯 · 心情 · 专注 · 阅读 · 饮水的一周表现</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={prevWeek} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title="上一周">
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[104px] text-center tabular-nums">
              {formatWeekRange(review)}
            </span>
            <button
              onClick={nextWeek}
              disabled={weekOffset >= 0}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30"
              title="下一周"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* 无数据提示 */}
        {review.activeDays === 0 && (
          <div className="card p-8 text-center mb-4">
            <BarChart3 size={40} className="mx-auto text-gray-200 mb-2" />
            <p className="text-sm text-gray-400">这一周还没有活动记录</p>
            <p className="text-xs text-gray-300 mt-1">记心情、打习惯卡或专注一会儿，周报就会丰富起来</p>
          </div>
        )}

        {/* 综合评分卡 */}
        {review.activeDays > 0 && (
          <div className="card p-5 mb-4 bg-gradient-to-br from-indigo-50 via-white to-blue-50">
            <div className="flex items-center gap-5">
              {/* 环形评分 */}
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                  <circle cx="40" cy="40" r="34" fill="none" className="stroke-accent-200" strokeWidth="8" />
                  <circle
                    cx="40" cy="40" r="34" fill="none"
                    stroke={scoreColor(review.score)}
                    strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${(review.score / 100) * 2 * Math.PI * 34} ${2 * Math.PI * 34}`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold" style={{ color: scoreColor(review.score) }}>{review.score}</span>
                  <span className="text-[9px] text-gray-400">综合分</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-bold text-gray-800">{review.scoreLabel}</div>
                <div className="text-xs text-gray-500 mt-1">
                  本周活跃 <span className="font-semibold text-gray-700">{review.activeDays}</span> 天
                  {review.isCurrent && <span className="text-gray-400">（截至今天）</span>}
                </div>
                {/* 四模块迷你指标 */}
                <div className="grid grid-cols-4 gap-2 mt-3">
                  <MiniMetric icon={<Flame size={12} />} label="打卡" value={`${review.habitTotalCheckins}次`} color="#F97316" />
                  <MiniMetric icon={<Smile size={12} />} label="心情" value={review.moodAverage > 0 ? `${review.moodAverage}` : '—'} color="#F59E0B" />
                  <MiniMetric icon={<Timer size={12} />} label="专注" value={formatMinutes(review.focusMinutes)} color="#EF4444" />
                  <MiniMetric icon={<BookOpen size={12} />} label="阅读" value={formatMinutes(review.readMinutes)} color="#3B82F6" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 每日活动总览 */}
        {review.activeDays > 0 && (
          <div className="card p-5 mb-4">
            <div className="text-sm font-medium text-gray-700 mb-3">每日总览</div>
            <div className="grid grid-cols-7 gap-1.5">
              {review.days.map((d) => {
                const isFuture = d.date > todayStr()
                const isToday = d.date === todayStr()
                const hasActivity = d.habitChecked > 0 || d.mood !== null || d.focusMinutes > 0 || d.readMinutes > 0 || d.waterMl > 0
                return (
                  <div
                    key={d.date}
                    className="rounded-lg p-1.5 flex flex-col items-center gap-1"
                    style={{
                      background: isFuture ? undefined : hasActivity ? 'rgb(var(--color-accent-100))' : undefined,
                      opacity: isFuture ? 0.35 : 1,
                      boxShadow: isToday ? '0 0 0 1.5px #818CF8' : undefined,
                    }}
                    title={`${d.date}：打卡${d.habitChecked}/${d.habitTotal} · ${d.mood ? MOOD_META[d.mood].label : '未记心情'} · 专注${d.focusMinutes}分钟 · 阅读${d.readMinutes}分钟 · 饮水${d.waterMl}ml`}
                  >
                    <span className="text-[10px] text-gray-400">{d.weekday}</span>
                    {/* 习惯 */}
                    <span className={`text-[10px] ${d.habitChecked > 0 ? 'text-orange-600 font-semibold' : 'text-gray-300'}`}>
                      {review.habitWeekly.length > 0 ? `${d.habitChecked}/${d.habitTotal}` : '—'}
                    </span>
                    {/* 心情 */}
                    <span className="text-sm leading-none">
                      {d.mood !== null ? MOOD_META[d.mood].emoji : <span className="text-gray-200 text-[10px]">·</span>}
                    </span>
                    {/* 专注 + 阅读 + 饮水 */}
                    <span className="text-[9px] text-center leading-tight text-gray-500">
                      {d.focusMinutes > 0 && <span className="text-red-400">{d.focusMinutes}分</span>}
                      {d.focusMinutes > 0 && d.readMinutes > 0 && <br />}
                      {d.readMinutes > 0 && <span className="text-blue-400">{d.readMinutes}分</span>}
                      {d.readMinutes > 0 && d.waterMl > 0 && <br />}
                      {d.waterMl > 0 && <span className="text-sky-500">{d.waterMl >= 1000 ? `${(d.waterMl / 1000).toFixed(1)}L` : `${d.waterMl}ml`}</span>}
                      {d.focusMinutes === 0 && d.readMinutes === 0 && d.waterMl === 0 && <span className="text-gray-200">·</span>}
                    </span>
                  </div>
                )
              })}
            </div>
            {/* 图例 */}
            <div className="flex items-center justify-center gap-3 mt-3 text-[10px] text-gray-400 flex-wrap">
              <span><span className="text-orange-600">n/m</span> 习惯打卡</span>
              <span>😊 心情</span>
              <span><span className="text-red-400">n分</span> 专注</span>
              <span><span className="text-blue-400">n分</span> 阅读</span>
              <span><span className="text-sky-500">nml</span> 饮水</span>
            </div>
          </div>
        )}

        {/* 习惯明细 */}
        {review.habitWeekly.length > 0 && (
          <div className="card p-5 mb-4">
            <div className="text-sm font-medium text-gray-700 mb-3">习惯打卡明细</div>
            <div className="space-y-2.5">
              {review.habitWeekly.map((h) => (
                <div key={h.habitId} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 w-24 truncate flex-shrink-0">{h.name}</span>
                  <div className="flex items-center gap-1 flex-1">
                    {h.daily.map((checked, i) => (
                      <div
                        key={i}
                        className="flex-1 h-5 rounded-md flex items-center justify-center"
                        style={{ background: checked ? `${h.color}30` : 'rgb(var(--color-accent-100))' }}
                        title={`${review.days[i].date} ${checked ? '已打卡' : '未打卡'}`}
                      >
                        {checked && <CheckCircle2 size={12} style={{ color: h.color }} />}
                      </div>
                    ))}
                  </div>
                  <span className="text-xs font-semibold text-gray-700 w-8 text-right flex-shrink-0">{h.days}/7</span>
                </div>
              ))}
              {/* 星期表头 */}
              <div className="flex items-center gap-2 pt-1 border-t border-gray-50">
                <span className="w-24 flex-shrink-0" />
                <div className="flex gap-1 flex-1">
                  {review.days.map((d) => (
                    <span key={d.date} className="flex-1 text-center text-[9px] text-gray-300">{d.weekday}</span>
                  ))}
                </div>
                <span className="w-8 flex-shrink-0" />
              </div>
            </div>
          </div>
        )}

        {/* 心情趋势 */}
        {review.moodRecordedDays > 0 && (
          <div className="card p-5 mb-4">
            <div className="text-sm font-medium text-gray-700 mb-3">心情走势</div>
            <div className="relative h-20">
              {/* 参考线 */}
              {[1, 2, 3, 4, 5].map((lv) => (
                <div
                  key={lv}
                  className="absolute left-0 right-0 border-t border-dashed border-gray-100"
                  style={{ bottom: `${((lv - 1) / 4) * 100}%` }}
                />
              ))}
              {/* 点位 */}
              <div className="absolute inset-0 flex justify-between items-center px-1">
                {review.days.map((d) => (
                  d.mood !== null ? (
                    <div
                      key={d.date}
                      className="w-3 h-3 rounded-full"
                      style={{
                        background: moodColor(d.mood),
                        alignSelf: 'flex-end',
                        marginBottom: `calc(${((d.mood - 1) / 4) * 100}% - 6px)`,
                      }}
                      title={`${d.date} ${MOOD_META[d.mood].label}`}
                    />
                  ) : (
                    <span key={d.date} className="text-gray-200 text-[10px] self-center">·</span>
                  )
                ))}
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>周一</span>
              <span>均值 {review.moodAverage}</span>
              <span>周日</span>
            </div>
            {review.moodWorstDay && review.moodWorstDay.mood !== null && (
              <div className="text-xs text-gray-500 mt-2">
                状态最佳：周{review.moodBestDay?.weekday} {MOOD_META[review.moodBestDay!.mood as MoodLevel].emoji} · 状态低谷：周{review.moodWorstDay.weekday} {MOOD_META[review.moodWorstDay.mood as MoodLevel].emoji}
              </div>
            )}
          </div>
        )}

        {/* 专注 & 阅读 & 饮水柱状图 */}
        {(review.focusMinutes > 0 || review.readMinutes > 0 || review.waterMl > 0) && (
          <div className="card p-5 mb-4">
            <div className="text-sm font-medium text-gray-700 mb-3">专注 · 阅读 · 饮水</div>
            <div className="relative h-28">
              {(() => {
                const maxVal = Math.max(
                  ...review.days.map((d) => Math.max(d.focusMinutes, d.readMinutes, d.waterMl / 10)),
                  1,
                )
                return review.days.map((d, i) => (
                  <div
                    key={d.date}
                    className="absolute bottom-0 flex flex-col justify-end items-center gap-0.5"
                    style={{ left: `${(i / 7) * 100 + 100 / 14}%`, transform: 'translateX(-50%)', width: '9%' }}
                  >
                    {d.focusMinutes > 0 && (
                      <div
                        className="w-full rounded-t bg-red-400"
                        style={{ height: `${Math.max(4, (d.focusMinutes / maxVal) * 80)}px` }}
                        title={`周${d.weekday} 专注 ${d.focusMinutes} 分钟`}
                      />
                    )}
                    {d.readMinutes > 0 && (
                      <div
                        className="w-full rounded-t bg-blue-400"
                        style={{ height: `${Math.max(4, (d.readMinutes / maxVal) * 80)}px` }}
                        title={`周${d.weekday} 阅读 ${d.readMinutes} 分钟`}
                      />
                    )}
                    {d.waterMl > 0 && (
                      <div
                        className="w-full rounded-t bg-sky-400"
                        style={{ height: `${Math.max(4, (d.waterMl / 10 / maxVal) * 80)}px` }}
                        title={`周${d.weekday} 饮水 ${d.waterMl}ml`}
                      />
                    )}
                    <span className="text-[9px] text-gray-400">{d.weekday}</span>
                  </div>
                ))
              })()}
            </div>
            <div className="flex items-center justify-center gap-3 mt-2 text-[10px] text-gray-400 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400" /> 专注 {formatMinutes(review.focusMinutes)}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400" /> 阅读 {formatMinutes(review.readMinutes)}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-400" /> 饮水 {(review.waterMl / 1000).toFixed(1)}L</span>
            </div>
          </div>
        )}

        {/* 智能建议 */}
        {review.insights.length > 0 && (
          <div className="card p-5">
            <div className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-1.5">
              <Lightbulb size={15} className="text-amber-500" /> 本周洞察
            </div>
            <div className="space-y-2">
              {review.insights.map((text, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-600 leading-relaxed">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-1.5 flex-shrink-0" />
                  {text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 迷你指标 =====

function MiniMetric({ icon, label, value, color }: {
  icon: ReactNode
  label: string
  value: string
  color: string
}) {
  const style: CSSProperties = { color }
  return (
    <div className="text-center rounded-lg py-1.5" style={{ background: 'rgb(var(--color-card-bg) / 0.7)' }}>
      <div className="flex items-center justify-center gap-0.5" style={style}>
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <div className="text-xs font-bold text-gray-700 mt-0.5">{value}</div>
    </div>
  )
}

/** 分钟数格式化：<60 显示 n分，≥60 显示 h小时m分 */
function formatMinutes(min: number): string {
  if (min === 0) return '—'
  if (min < 60) return `${min}分`
  return `${Math.floor(min / 60)}时${min % 60 > 0 ? `${min % 60}分` : ''}`
}
