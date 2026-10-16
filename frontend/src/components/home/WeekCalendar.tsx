/**
 * WeekCalendar · 周日历横条（墨玉绿主题 + 左右滑动）
 *
 * 版式：21 天横排 — 今日前 10 天 + 今日 + 今日后 10 天
 * 滑动：overflow-x-auto + snap-x-mandatory + snap-center + scroll-smooth
 * 初始：useEffect scrollTo 让今日 pill 永远在可视区中央
 * 隐藏滚动条：::-webkit-scrollbar { display: none } + scrollbar-width: none
 *
 * 依赖主题：tailwind.config.js 追加的 brand/lgray/ink
 */
import { useEffect, useRef } from 'react'

interface Props {
  /** 有记录的日期（day-of-month 集合，来自习惯打卡/事件等） */
  recordedDays?: Set<number>
  /** 点击回调（可选） */
  onSelect?: (date: Date) => void
}

const WEEK_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const DAY_WIDTH = 52 // 每个 pill 固定宽（px），增大后更易点

export default function WeekCalendar({ recordedDays, onSelect }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const today = new Date()

  // 生成 21 天：今日前 10 天 → 今日后 10 天
  const days: Date[] = []
  for (let i = -10; i <= 10; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    days.push(d)
  }

  // 初始化：让今日 pill 居中
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    // 找到今日在 21 天数组里的 index（恒为 10，因为从 -10 开始）
    const todayIdx = 10
    const targetScroll = todayIdx * DAY_WIDTH - el.clientWidth / 2 + DAY_WIDTH / 2
    el.scrollTo({ left: Math.max(0, targetScroll), behavior: 'instant' as ScrollBehavior })
    // 再跑一次（某些浏览器首次 clientWidth 不对）
    requestAnimationFrame(() => {
      el.scrollTo({ left: Math.max(0, targetScroll), behavior: 'instant' as ScrollBehavior })
    })
  }, [])

  return (
    <div className="px-5 pb-2">
      <div
        ref={scrollerRef}
        role="group"
        aria-label="日期"
        className="flex gap-1 overflow-x-auto snap-x-mandatory snap-plc scroll-smooth no-scrollbar"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {days.map((d, i) => {
          const isToday = d.toDateString() === today.toDateString()
          const dayOfMonth = d.getDate()
          const label = WEEK_LABELS[d.getDay()]
          const hasRecord = recordedDays?.has(dayOfMonth)

          return (
            <button
              key={d.toISOString()}
              type="button"
              aria-current={isToday ? 'date' : undefined}
              onClick={() => onSelect?.(d)}
              className={`
                flex-none snap-center w-12 h-[68px] flex flex-col items-center justify-center
                gap-0.5 rounded-full border-0 bg-transparent cursor-pointer
                transition-colors flex-shrink-0
                focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-highlight
                ${isToday
                  ? 'bg-brand text-on-brand'
                  : 'text-ink hover:bg-brand-pale/40'
                }
              `}
              style={{ width: DAY_WIDTH, flexShrink: 0 }}
            >
              <span
                className={`text-[12px] leading-[1.2] ${
                  isToday ? 'text-on-brand/80' : 'text-lgray'
                }`}
              >
                {label}
              </span>
              <span className="text-[17px] font-semibold leading-[1.2]">
                {dayOfMonth}
              </span>
              {/* 有记录小点 */}
              {hasRecord && (
                <span className={`w-1 h-1 rounded-full ${isToday ? 'bg-on-brand/70' : 'bg-brand'}`} aria-hidden />
              )}
              {/* 今日小点占位（保持高度一致） */}
              {!hasRecord && <span className="w-1 h-1" aria-hidden />}
            </button>
          )
        })}
      </div>

      {/* 隐藏滚动条的全局样式 —— 注入到 index.css 更稳，这里用 style 兜底 */}
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; width: 0; height: 0; }
        .no-scrollbar { scrollbar-width: none; }
      `}</style>
    </div>
  )
}
