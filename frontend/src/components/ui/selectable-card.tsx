import { forwardRef, useRef, useMemo } from 'react'
import clsx from 'clsx'

/**
 * SelectableCard — 语义化可选中卡片
 *
 * 替代项目里散落各处的 `<button onClick={() => setMode(v)}>` 写法。
 * 提供完整 ARIA 无障碍：role="radio" / aria-checked / keyboard navigation。
 *
 * 设计对齐：ThemeSettingsPage（三选一垂直列表）、ToneSettingsPage（9 选 3 列网格）。
 * 视觉由 `variant` + `selected` prop 决定 Tailwind class。
 */

type Variant = 'vertical' | 'grid' | 'toggle'
type Size = 'sm' | 'md'

export interface SelectableCardProps {
  /** 当前卡片值（与 group 的 selectedValue 对比判断选中态） */
  value: string
  /** 是否选中 */
  selected: boolean
  /** 选中回调 */
  onSelect: (value: string) => void
  /** 卡片主标题 */
  label: string
  /** 卡片描述（选填） */
  description?: string
  /** 可选的图标元素（ReactNode，lucide-react icon 或 emoji 都行） */
  icon?: React.ReactNode
  /** 禁用态 */
  disabled?: boolean
  /** 视觉风格 — vertical=列表卡, grid=网格小卡, toggle=单独开关 */
  variant?: Variant
  /** 尺寸 */
  size?: Size
  /** radio group 名（用于键盘导航时在组内切换） */
  groupName?: string
  /** 外部注入 className（用于覆盖/扩展） */
  className?: string
  /** 外部注入 icon wrapper 的 className */
  iconClassName?: string
  /** 外部注入 label 的 className */
  labelClassName?: string
  /** 自定义 checked icon（默认渲染 Check） */
  checkedIcon?: React.ReactNode
  /** 是否显示 Check icon（某些场景只想靠 class 体现状态） */
  showCheckedIcon?: boolean
  /** tabIndex 覆盖（默认: selected? 0 : -1，由 group 管理焦点） */
  tabIndex?: number
  /** 扩展 data-* 属性的便捷入口 */
  testId?: string
}

/** 默认 Check icon（inline SVG，避免新增 lucide-react import 依赖链） */
const DefaultCheck = () => (
  <svg
    width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

/** 小尺寸 Check（grid 模式） */
const SmallCheck = () => (
  <svg
    width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export const SelectableCard = forwardRef<HTMLButtonElement, SelectableCardProps>(
  function SelectableCard(
    {
      value,
      selected,
      onSelect,
      label,
      description,
      icon,
      disabled,
      variant = 'vertical',
      size = variant === 'grid' ? 'sm' : 'md',
      groupName,
      className,
      iconClassName,
      labelClassName,
      checkedIcon,
      showCheckedIcon = true,
      tabIndex,
      testId,
    },
    forwardedRef,
  ) {
    // 内部 ref — 让 group 能通过 focus() 移动焦点
    const innerRef = useRef<HTMLButtonElement>(null)
    const ref = (forwardedRef as React.RefObject<HTMLButtonElement>) ?? innerRef

    // id 关联 aria-describedby（描述）+ aria-labelledby（标题）
    const labelId = useMemo(() => `selcard-${groupName || 'grp'}-${value}-label`, [groupName, value])
    const descId = useMemo(() => description ? `selcard-${groupName || 'grp'}-${value}-desc` : undefined, [groupName, value, description])

    /** keyboard: ArrowUp/Down/Left/Right 在同组内找下一个/上一个可聚焦的 SelectableCard */
    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return
      if (!groupName) return // 无 group 名不做组内导航

      const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
      if (!arrowKeys.includes(e.key)) return
      e.preventDefault()

      // 找同组所有 SelectableCard（通过 role="radio" + data-group）
      const root = (e.currentTarget.closest('[data-selectable-group]') as HTMLElement) || document
      const siblings = Array.from(
        root.querySelectorAll<HTMLButtonElement>(`button[role="radio"][data-group="${groupName}"]`),
      ).filter(b => !b.disabled)
      if (siblings.length < 2) return

      const idx = siblings.indexOf(e.currentTarget)
      if (idx === -1) return

      let nextIdx = idx
      // 根据 variant 判断方向映射
      const isHorizontal = variant === 'grid' // grid 模式用 Left/Right；vertical 用 Up/Down
      if (isHorizontal) {
        if (e.key === 'ArrowRight') nextIdx = (idx + 1) % siblings.length
        else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + siblings.length) % siblings.length
      } else {
        if (e.key === 'ArrowDown') nextIdx = (idx + 1) % siblings.length
        else if (e.key === 'ArrowUp') nextIdx = (idx - 1 + siblings.length) % siblings.length
      }

      const target = siblings[nextIdx]
      target.focus()
      // 自动选中（符合 radio group 标准行为：focus 即选中）
      target.click()
    }

    // ─── 视觉 class（完全复用现有 Tailwind 风格，不引入新 token）───
    const base = clsx(
      // vertical (Theme 页): w-full flex items-center gap-3 p-3 rounded-lg border transition-colors
      'rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1',
      // disabled
      disabled && 'opacity-50 cursor-not-allowed',
      !disabled && 'cursor-pointer',
      // selected vs unselected（两种 variant 都用这套）
      selected
        ? 'border-primary-500 bg-primary-50'
        : 'border-gray-200 hover:bg-gray-50',
    )

    // variant 特定 class
    const variantCls = clsx(
      variant === 'vertical' && 'w-full flex items-center gap-3 p-3',
      variant === 'grid' && 'flex flex-col items-center gap-1 py-3',
    )

    // icon 容器 class
    const iconWrapCls = clsx(
      'flex items-center justify-center flex-shrink-0',
      variant === 'vertical' ? 'w-10 h-10 rounded-xl' : '',
      variant === 'grid' && size === 'sm' ? '' : '',
      selected ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-500',
      iconClassName,
    )

    const labelCls = clsx(
      'font-medium',
      variant === 'vertical' && 'text-sm',
      variant === 'grid' && 'text-xs',
      selected ? 'text-primary-700' : 'text-gray-800',
      labelClassName,
    )

    const descCls = clsx(
      'text-xs text-gray-400 mt-0.5',
    )

    const handleClick = () => {
      if (disabled) return
      onSelect(value)
    }

    // 由 group 控制焦点顺序：selected 是 tabIndex=0，其他 -1
    const effectiveTabIndex = tabIndex ?? (selected ? 0 : -1)

    return (
      <button
        ref={ref as React.RefObject<HTMLButtonElement>}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-disabled={disabled || undefined}
        aria-labelledby={labelId}
        aria-describedby={descId}
        tabIndex={effectiveTabIndex}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        data-value={value}
        data-group={groupName}
        data-selected={selected ? 'true' : 'false'}
        data-testid={testId}
        className={clsx(base, variantCls, className)}
      >
        {/* icon */}
        {icon && (
          <div className={iconWrapCls} aria-hidden="true">
            {icon}
          </div>
        )}

        {/* 中间：label + description */}
        <div className={clsx(
          variant === 'vertical' && 'flex-1 text-left',
          variant === 'grid' && 'text-center',
        )}>
          <div id={labelId} className={labelCls}>{label}</div>
          {description && (
            <div id={descId} className={descCls}>{description}</div>
          )}
        </div>

        {/* 选中 Check 图标（仅 vertical 右侧，grid 底部） */}
        {showCheckedIcon && selected && (
          <span
            className={clsx(
              'text-primary-500 flex-shrink-0',
              variant === 'vertical' ? 'ml-2' : 'mt-0.5',
            )}
            aria-hidden="true"
          >
            {checkedIcon || (variant === 'grid' ? <SmallCheck /> : <DefaultCheck />)}
          </span>
        )}
      </button>
    )
  },
)

SelectableCard.displayName = 'SelectableCard'

/**
 * SelectableCardGroup — 容器，提供 group context 给内部 SelectableCard
 * 作用：自动生成唯一 groupName + data-selectable-group 供 keyboard 查询同组元素。
 *
 * 用法：
 * <SelectableCardGroup name="theme" variant="vertical">
 *   {MODES.map(m => (
 *     <SelectableCard key={m.value} value={m.value} selected={...} onSelect={...} label={m.label} ... />
 *   ))}
 * </SelectableCardGroup>
 */
export interface SelectableCardGroupProps {
  /** 组名（用于 data-group 属性 + keyboard 查询） */
  name: string
  /** 子组件 */
  children: React.ReactNode
  /** variant — 决定 grid 或 vertical 容器 class */
  variant?: 'vertical' | 'grid'
  /** gap */
  gap?: number
  /** 外部 className */
  className?: string
  /** 作为 role="radiogroup" 容器，提供 aria-label */
  ariaLabel?: string
  /** aria-labelledby（如果有外部标题） */
  ariaLabelledBy?: string
}

export function SelectableCardGroup({
  name,
  children,
  variant = 'vertical',
  gap,
  className,
  ariaLabel,
  ariaLabelledBy,
}: SelectableCardGroupProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      data-selectable-group={name}
      data-group={name}
      className={clsx(
        variant === 'vertical' && 'space-y-2',
        variant === 'grid' && 'grid grid-cols-3 gap-2',
        gap !== undefined && `gap-${gap}`,
        className,
      )}
    >
      {children}
    </div>
  )
}
