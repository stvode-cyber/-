/**
 * GreetingHeader · 问候头部（墨玉绿主题）
 *
 * 版式：两端对齐 + 垂直居中
 * 左：两行文字 — 小字灰问候语 + 大号加粗用户名
 * 右：圆形通知铃铛 + badge（有通知时显示）
 *
 * 依赖主题：tailwind.config.js 追加的 brand/canvas/ink/lgray
 * 写色铁律：彩色仅在 pill badge（brand），其余全中性
 */
import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface Props {
  greeting?: string       // "Good Morning 👋" 之类
  username: string        // 用户名（大号加粗主视觉）
  notifyCount?: number    // 通知数量；0 或 undefined 时隐藏 badge
}

export default function GreetingHeader({
  greeting = '早上好 👋',
  username,
  notifyCount = 0,
}: Props) {
  const navigate = useNavigate()
  const showBadge = notifyCount > 0

  return (
    <header className="flex items-center justify-between gap-4 px-5 pt-4 pb-3">
      {/* 左：问候语 + 用户名（左对齐基线对齐） */}
      <div className="min-w-0">
        <p className="text-[12px] leading-[1.4] text-lgray mb-1">
          {greeting}
        </p>
        <h1 className="text-[24px] font-bold leading-[1.2] text-ink truncate">
          {username}
        </h1>
      </div>

      {/* 右：圆形通知铃铛（与用户名视觉中线对齐） */}
      <button
        type="button"
        aria-label={`通知${showBadge ? `，${notifyCount}条未读` : ''}`}
        onClick={() => navigate('/tasks?view=reminders')}
        className="relative flex-none w-[38px] h-[38px] rounded-full bg-surface text-ink grid place-items-center hover:bg-brand-pale transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-highlight"
      >
        <Bell size={16} strokeWidth={2} className="text-ink/70" />
        {showBadge && (
          <span
            aria-hidden
            className="absolute -top-[2px] -right-[2px] min-w-[16px] h-[16px] px-1 rounded-full bg-brand text-on-brand text-[9px] font-bold leading-[16px] text-center"
          >
            {notifyCount > 99 ? '99+' : notifyCount}
          </span>
        )}
      </button>
    </header>
  )
}
