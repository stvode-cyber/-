import { ReactNode } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

/**
 * 通用状态视图组件
 *
 * 用途：统一处理列表页 / 卡片页的三种非正常状态，避免每个页面重复实现：
 * - LoadingState：加载中（骨架屏或 spinner）
 * - ErrorState：加载失败（提示 + 重试按钮）
 * - EmptyState：无数据（图标 + 文案 + 可选操作）
 *
 * 使用示例：
 *   {loading ? <LoadingState text="加载中..." /> :
 *    error ? <ErrorState onRetry={load} /> :
 *    list.length === 0 ? <EmptyState icon="📋" text="暂无数据" /> :
 *    <List ... />}
 *
 * 设计原则：
 * - 不带容器 padding，由父组件控制布局
 * - 图标和文案可自定义，有合理默认值
 * - ErrorState 默认提供「重新加载」按钮，调用 onRetry
 */

/** 加载中状态 */
export function LoadingState({
  text = '加载中...',
  /** 是否使用骨架屏（默认使用 spinner） */
  skeleton = false,
  /** 骨架屏条数（skeleton=true 时生效） */
  count = 3,
}: {
  text?: string
  skeleton?: boolean
  count?: number
}) {
  if (skeleton) {
    return (
      <div className="px-3 py-3 space-y-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-full bg-gray-200" />
              <div className="flex-1">
                <div className="h-3 w-24 bg-gray-200 rounded mb-1" />
                <div className="h-2 w-16 bg-gray-100 rounded" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-3 bg-gray-100 rounded" />
              <div className="h-3 bg-gray-100 rounded w-4/5" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="py-12 text-center text-gray-400">
      <Loader2 size={24} className="animate-spin mx-auto mb-2" />
      <div className="text-sm">{text}</div>
    </div>
  )
}

/** 加载失败状态（带重试按钮） */
export function ErrorState({
  text = '数据加载失败',
  onRetry,
  retryText = '重新加载',
}: {
  text?: string
  onRetry?: () => void
  retryText?: string
}) {
  return (
    <div className="py-12 text-center text-gray-400">
      <div className="text-4xl mb-2">📡</div>
      <div className="text-sm mb-3">{text}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 text-sm text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 inline-flex items-center gap-1"
        >
          <RefreshCw size={14} />
          {retryText}
        </button>
      )}
    </div>
  )
}

/** 空状态 */
export function EmptyState({
  icon = '📭',
  text = '暂无数据',
  hint,
  action,
}: {
  icon?: string
  text?: string
  hint?: string
  /** 可选操作按钮（如"去创建"） */
  action?: ReactNode
}) {
  return (
    <div className="py-12 text-center text-gray-400">
      <div className="text-4xl mb-2">{icon}</div>
      <div className="text-sm">{text}</div>
      {hint && <div className="text-xs mt-2 text-gray-300">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
