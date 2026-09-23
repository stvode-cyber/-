import { forwardRef, useId } from 'react'
import clsx from 'clsx'

/**
 * Switch — 语义化二选一开关（role="switch" + aria-checked）
 *
 * 适用于「开/关」切换场景（如远程访问总开关、备份自动上传、开机自启等）。
 * 与 SelectableCard（radio group）的区别：
 *   - Switch 是**单元素**二选一，无组内导航
 *   - SelectableCard 是**多元素**多选一，有 Arrow 键组内切换
 *
 * 设计对齐项目现有 tailwind 风格（从 RemoteAccessPage 的自定义 switch 改写）。
 */

export interface SwitchProps {
  /** 当前是否开启 */
  checked: boolean
  /** 切换回调 */
  onChange: (checked: boolean) => void
  /** 禁用态 */
  disabled?: boolean
  /** 尺寸 */
  size?: 'sm' | 'md'
  /** 外部 className */
  className?: string
  /** 外部 className（内部 thumb） */
  thumbClassName?: string
  /** 关联 label 的 id（aria-labelledby 从外部传入；内部也生成一个可选 id） */
  'aria-labelledby'?: string
  /** 描述 id（aria-describedby） */
  'aria-describedby'?: string
  /** 测试 id */
  testId?: string
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    {
      checked,
      onChange,
      disabled,
      size = 'md',
      className,
      thumbClassName,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      testId,
    },
    ref,
  ) {
    const generatedId = useId()

    const sizeCls = size === 'sm'
      ? 'w-9 h-5'
      : 'w-11 h-6'
    const thumbSizeCls = size === 'sm'
      ? 'w-4 h-4'
      : 'w-5 h-5'
    const thumbTranslateCls = size === 'sm'
      ? (checked ? 'translate-x-4' : 'translate-x-0.5')
      : (checked ? 'translate-x-5' : 'translate-x-0.5')

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return
      // Switch 标准交互：Space/Enter 切换（button 原生已处理 Enter）
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        onChange(!checked)
      }
    }

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={disabled ? -1 : 0}
        disabled={disabled}
        onClick={() => { if (!disabled) onChange(!checked) }}
        onKeyDown={handleKeyDown}
        data-testid={testId}
        data-state={checked ? 'on' : 'off'}
        data-disabled={disabled ? 'true' : 'false'}
        className={clsx(
          'relative rounded-full transition-colors flex-shrink-0',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1',
          'inline-flex items-center', // 确保内部 thumb 居中
          disabled && 'opacity-50 cursor-not-allowed',
          !disabled && 'cursor-pointer',
          // 选中态 vs 未选中态
          checked ? 'bg-primary-500' : 'bg-gray-200',
          // 尺寸
          sizeCls,
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={clsx(
            'absolute bg-white rounded-full shadow transition-transform',
            thumbSizeCls,
            'top-0.5',
            thumbTranslateCls,
            thumbClassName,
          )}
        />
      </button>
    )
  },
)

Switch.displayName = 'Switch'
