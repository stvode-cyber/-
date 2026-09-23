import { X } from 'lucide-react'
import { SHORTCUTS } from '../hooks/useKeyboardShortcuts'

/**
 * 快捷键帮助面板
 * 展示所有可用的键盘快捷键，按分类分组
 */

interface ShortcutHelpPanelProps {
  open: boolean
  onClose: () => void
}

export default function ShortcutHelpPanel({ open, onClose }: ShortcutHelpPanelProps) {
  if (!open) return null

  // 按分类分组
  const grouped = SHORTCUTS.reduce<Record<string, typeof SHORTCUTS>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-accent-200 overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-accent-100">
          <h2 className="text-base font-semibold text-accent-800">键盘快捷键</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-accent-400 hover:text-accent-600 hover:bg-accent-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* 快捷键列表 */}
        <div className="px-5 py-4 space-y-5 max-h-[60vh] overflow-y-auto">
          {Object.entries(grouped).map(([category, shortcuts]) => (
            <div key={category}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-400 mb-2">
                {category}
              </div>
              <div className="space-y-1.5">
                {shortcuts.map((s) => (
                  <div key={s.keys} className="flex items-center justify-between py-1">
                    <span className="text-[13px] text-accent-600">{s.description}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.split('+').map((key, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[11px] text-accent-300">+</span>}
                          <kbd className="px-2 py-1 rounded-md bg-accent-50 border border-accent-200 text-[11px] font-mono text-accent-600 min-w-[24px] text-center">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 底部提示 */}
        <div className="px-5 py-3 border-t border-accent-100 bg-accent-50/50">
          <p className="text-[11px] text-accent-400">
            提示：在非输入框区域按 g 后再按对应字母可快速导航
          </p>
        </div>
      </div>
    </div>
  )
}
