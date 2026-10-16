/**
 * WeekCalendar · 周日历横条（墨玉绿主题）
 *
 * 版式：7 等分列；每列「星期缩写 + 日期数字」竖排居中
 * 今日：pill 背景高亮（仅背景，不加边框）
 * 有记录：日期下方 brand 色小点
 *
 * 依赖主题：tailwind.config.js 追加的 brand/lgray/ink/radius-pill
 */
interface Props {
  /** 有记录的日期（day-of-month 集合，来自习惯打卡/事件等） */
  recordedDays?: Set<number>
  /** 点击回调（可选） */
  onSelect?: (date: Date) => void
}

const WEEK_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export default function WeekCalendar({ recordedDays, onSelect }: Props) {
  const today = new Date()
  // 周起点：以今日为中心，前后各 3 天 → 共 7 天
  const days: Date[] = []
  for (let i = -3; i <= 3; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    days.push(d)
  }

  return (
    <div role="group" aria-label="本周" className="flex gap-1 px-4 py-2">
      {days.map((d) => {
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
              flex-1 min-w-0 h-16 flex flex-col items-center justify-center
              gap-0.5 rounded-full border-0 bg-transparent cursor-pointer
              transition-colors
              focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-highlight
              ${isToday
                ? 'bg-brand text-on-brand'
                : 'text-ink hover:bg-brand-pale/40'
              }
            `}
          >
            <span
              className={`text-[10px] leading-[1.2] ${
                isToday ? 'text-on-brand/80' : 'text-lgray'
              }`}
            >
              {label}
            </span>
            <span className="text-[15px] font-semibold leading-[1.2]">
              {dayOfMonth}
            </span>
            {/* 有记录小点（4×4 pill） */}
            {!isToday && hasRecord && (
              <span className="w-1 h-1 rounded-full bg-brand" aria-hidden />
            )}
            {isToday && hasRecord && (
              <span className="w-1 h-1 rounded-full bg-on-brand/70" aria-hidden />
            )}
          </button>
        )
      })}
    </div>
  )
}
