import { useEffect, useCallback, useState } from 'react'

/**
 * 全局键盘快捷键系统
 *
 * 注册快捷键 → 在任何页面按下组合键时触发回调
 * 同时提供快捷键帮助面板（Ctrl+/ 或 ? 唤起）
 *
 * 已注册的快捷键：
 * - Ctrl/Cmd + K : 唤起全局搜索面板
 * - Ctrl/Cmd + / : 唤起快捷键帮助面板
 * - g h : 回到首页
 * - g t : 跳转任务
 * - g f : 跳转财务
 * - g c : 跳转日历
 * - g s : 跳转搜索
 * - Escape : 关闭当前面板
 */

export interface ShortcutDef {
  keys: string
  description: string
  category: string
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: 'Ctrl+K', description: '全局搜索', category: '通用' },
  { keys: 'Ctrl+/', description: '快捷键帮助', category: '通用' },
  { keys: 'g h', description: '回到首页', category: '导航' },
  { keys: 'g t', description: '跳转任务', category: '导航' },
  { keys: 'g f', description: '跳转财务', category: '导航' },
  { keys: 'g c', description: '跳转日历', category: '导航' },
  { keys: 'g s', description: '跳转搜索', category: '导航' },
  { keys: 'g e', description: '跳转导出', category: '导航' },
  { keys: 'Escape', description: '关闭面板', category: '通用' },
]

interface UseKeyboardShortcutsOptions {
  onSearch?: () => void
  onHelp?: () => void
  onNavigate?: (path: string) => void
}

export function useKeyboardShortcuts(opts: UseKeyboardShortcutsOptions = {}) {
  const [showHelp, setShowHelp] = useState(false)
  const { onSearch, onNavigate } = opts

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey
      const tag = (e.target as HTMLElement)?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable

      // Ctrl/Cmd+K — 全局搜索（输入框内也响应）
      if (isMod && e.key === 'k') {
        e.preventDefault()
        onSearch?.()
        return
      }

      // Ctrl/Cmd+/ — 快捷键帮助（输入框内也响应）
      if (isMod && e.key === '/') {
        e.preventDefault()
        setShowHelp((v) => !v)
        return
      }

      // 输入框中不响应以下快捷键
      if (isInput) return

      // g 前缀导航快捷键
      if (e.key === 'g') {
        const handler = (ev: KeyboardEvent) => {
          const map: Record<string, string> = {
            h: '/',
            t: '/tasks',
            f: '/finance',
            c: '/calendar',
            s: '/search',
            e: '/export',
          }
          const path = map[ev.key]
          if (path) {
            ev.preventDefault()
            onNavigate?.(path)
          }
        }
        // 一次性监听下一个按键
        const wrapped = (ev: KeyboardEvent) => {
          handler(ev)
          window.removeEventListener('keydown', wrapped)
        }
        window.addEventListener('keydown', wrapped, { once: true })
        // 500ms 后自动取消
        setTimeout(() => window.removeEventListener('keydown', wrapped), 500)
        return
      }

      // ? 唤起帮助
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setShowHelp((v) => !v)
        return
      }

      // Escape 关闭帮助
      if (e.key === 'Escape' && showHelp) {
        setShowHelp(false)
      }
    },
    [onSearch, onNavigate, showHelp]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  return { showHelp, setShowHelp }
}
