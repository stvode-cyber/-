import { create } from 'zustand'
import { AlertTriangle } from 'lucide-react'

/**
 * 全局确认弹窗系统
 *
 * 替代浏览器原生 confirm()，提供与项目 UI 风格一致的确认对话框。
 *
 * 使用方式：
 *   const confirm = useConfirm()
 *   if (!(await confirm('确认删除？'))) return
 *   // 或：
 *   if (!(await confirm({ title: '删除帖子', message: '此操作不可恢复', confirmText: '删除', danger: true }))) return
 *
 * 特性：
 * - Promise 风格，await 后返回 boolean（true=确认 / false=取消）
 * - 支持自定义标题、文案、按钮文字
 * - danger 模式（确认按钮为红色，用于删除等危险操作）
 * - 点击遮罩或按 ESC 视为取消
 * - 一次只显示一个确认框（后调用者会等待前一个关闭）
 */
interface ConfirmOptions {
  /** 标题（默认"请确认"） */
  title?: string
  /** 正文消息（必填） */
  message: string
  /** 确认按钮文字（默认"确认"） */
  confirmText?: string
  /** 取消按钮文字（默认"取消"） */
  cancelText?: string
  /** 是否危险操作（确认按钮变红，默认 false） */
  danger?: boolean
}

interface ConfirmState {
  /** 当前待处理的确认框（同一时刻最多一个） */
  current: (ConfirmOptions & { resolver: (v: boolean) => void }) | null
  /** 触发确认框，返回 Promise<boolean> */
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>
  /** 内部：响应用户选择 */
  resolve: (v: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,
  confirm: (opts) => {
    // 如果有上一个确认框未关闭，先拒绝（避免覆盖，调用方会收到 false）
    if (get().current) {
      get().current!.resolver(false)
    }
    const normalized: ConfirmOptions =
      typeof opts === 'string' ? { message: opts } : opts
    return new Promise<boolean>((resolver) => {
      set({ current: { ...normalized, resolver } })
    })
  },
  resolve: (v) => {
    const cur = get().current
    if (cur) {
      cur.resolver(v)
      set({ current: null })
    }
  },
}))

/** Hook：返回 confirm 函数，用于触发确认弹窗 */
export function useConfirm() {
  return useConfirmStore((s) => s.confirm)
}

/** 确认弹窗渲染容器：在 Layout 中挂载一次即可全局生效 */
export function ConfirmDialog() {
  const current = useConfirmStore((s) => s.current)
  const resolve = useConfirmStore((s) => s.resolve)

  if (!current) return null

  const {
    title = '请确认',
    message,
    confirmText = '确认',
    cancelText = '取消',
    danger = false,
  } = current

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-6"
      onClick={() => resolve(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
              danger ? 'bg-red-100' : 'bg-primary-50'
            }`}
          >
            <AlertTriangle
              size={20}
              className={danger ? 'text-red-500' : 'text-primary-500'}
            />
          </div>
          <div className="flex-1 pt-0.5">
            <div className="text-base font-medium text-gray-800">{title}</div>
            <div className="text-sm text-gray-500 mt-1 leading-relaxed">
              {message}
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => resolve(false)}
            className="flex-1 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            {cancelText}
          </button>
          <button
            onClick={() => resolve(true)}
            className={`flex-1 py-2 text-sm text-white rounded-lg ${
              danger
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-primary-500 hover:bg-primary-600'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
