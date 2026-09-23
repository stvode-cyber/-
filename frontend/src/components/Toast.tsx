import { create } from 'zustand'
import { X } from 'lucide-react'

/**
 * 全局 Toast 通知系统
 *
 * 基于 Zustand 全局状态，任意组件可通过 useToast((s) => s.show) 调用。
 *
 * 使用方式：
 *   const toast = useToast((s) => s.show)
 *   toast('保存成功', 'success')
 *   toast('保存失败', 'error')
 *   toast('提示信息', 'info')
 *   toast('登录失败次数过多', 'error', 4000) // 自定义停留时长
 *
 * 特性：
 * - 自动消失（默认 2s；可传 duration 自定义）
 * - 右侧 X 按钮可手动关闭，整体点击也可关闭
 * - 三种类型：success（绿）/ error（红）/ info（深灰）
 * - 多条 Toast 垂直堆叠，顶部居中显示
 * - warning 类型：橙黄（用于多次密码错误等需要用户关注的提示）
 */
interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  duration: number
}

interface ToastState {
  toasts: ToastItem[]
  show: (message: string, type?: ToastItem['type'], duration?: number) => void
  remove: (id: number) => void
}

/** 默认停留时长（毫秒），按需求设置为 2 秒 */
const DEFAULT_DURATION = 2000

let nextId = 1

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  show: (message, type = 'info', duration = DEFAULT_DURATION) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }))
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    }
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Toast 渲染容器：在 Layout 中挂载一次即可全局生效 */
export function Toaster() {
  const { toasts, remove } = useToast()
  if (toasts.length === 0) return null
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 pl-4 pr-2 py-2 rounded-lg shadow-lg text-sm text-white animate-slide-up pointer-events-auto ${
            t.type === 'success'
              ? 'bg-green-500'
              : t.type === 'error'
              ? 'bg-red-500'
              : t.type === 'warning'
              ? 'bg-amber-500'
              : 'bg-gray-800'
          }`}
        >
          <span className="flex-1 min-w-0 break-words">{t.message}</span>
          <button
            onClick={() => remove(t.id)}
            aria-label="关闭提示"
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
