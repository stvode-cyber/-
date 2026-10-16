/**
 * MissionCard · 今日任务卡（墨玉绿主题）
 *
 * 版式：标签（大写小字 + 字距）在上 → 任务卡通栏
 * 有 art 时：左文字 + 右插画位
 * 无 art 时：全宽文字（不渲染右侧）
 * 徽章 pill：brand 色背景 + on-brand 文字
 *
 * 依赖主题：tailwind.config.js 追加的 brand/surface/ink/shadow-1/radius-lg/pill
 */
import { LucideIcon } from 'lucide-react'

interface Props {
  label?: string          // 默认 "今日重点"
  title: string           // 主任务文案（大）
  badgeText?: string      // 徽章文字，如 "7 days"
  badgeIcon?: LucideIcon  // 徽章图标（lucide-react）
  /** 插画位：可传 emoji、背景图 URL、或 React 节点；不传则全宽 */
  art?: React.ReactNode
  artBg?: string          // 插画位背景色（可选，默认 brand-pale/30）
}

export default function MissionCard({
  label = "今日重点",
  title,
  badgeText,
  badgeIcon: BadgeIcon,
  art,
  artBg,
}: Props) {
  const hasArt = !!art
  return (
    <section className="px-5 pb-2">
      {/* 分区标签：全大写 + 字距放宽（非中文时才 uppercase） */}
      <p className="mb-2.5 text-[11px] font-bold tracking-[0.08em] uppercase text-lgray">
        {label}
      </p>

      {/* 任务卡：圆角通栏 */}
      <div
        className={`flex items-center ${hasArt ? 'gap-4' : ''} p-5 rounded-[14px] bg-surface`}
        style={{ boxShadow: 'var(--shadow-1, 0 2px 8px rgba(0,69,56,.06))' }}
      >
        {/* 文字区 */}
        <div className={`min-w-0 ${hasArt ? 'flex-1 pr-2' : 'w-full'}`}>
          <h2 className="text-[26px] font-bold leading-[1.25] text-ink">
            {title}
          </h2>

          {/* 徽章 pill（brand 色） */}
          {badgeText && (
            <span className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-brand text-on-brand text-[12px] font-semibold">
              {BadgeIcon && <BadgeIcon size={10} strokeWidth={2.5} />}
              {badgeText}
            </span>
          )}
        </div>

        {/* 插画位：只在传了 art 时才渲染 */}
        {hasArt && (
          <div
            className="flex-none aspect-square rounded-[12px] overflow-hidden grid place-items-center text-4xl"
            style={{
              width: '40%',
              minWidth: 96,
              maxWidth: 160,
              background: artBg ?? '#8EC4B633',
            }}
            role="img"
            aria-label="今日任务插画"
          >
            {art}
          </div>
        )}
      </div>
    </section>
  )
}
