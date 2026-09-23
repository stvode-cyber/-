import { useSearchParams } from 'react-router-dom'
import StickyBoard from '../components/StickyBoard'
import { isDesktop } from '../lib/localCache'
import { useToast } from '../components/Toast'
import { StickyNote as StickyIcon, MonitorSmartphone } from 'lucide-react'

export default function StickyPage() {
  const [params] = useSearchParams()
  const float = params.get('float') === '1'
  const toast = useToast((s) => s.show)

  // ---- 浮窗精简模式（桌面专属：透明背景，仅便签层）----
  if (float) {
    return (
      <div className="w-full h-full bg-transparent">
        <StickyBoard
          compact
          onClose={() => {
            ;(window as any).desktopAPI?.toggleStickyWindow?.()
          }}
        />
      </div>
    )
  }

  const toggleFloat = () => {
    try {
      ;(window as any).desktopAPI?.toggleStickyWindow?.()
    } catch {
      toast('仅桌面端支持浮窗', 'error')
    }
  }

  return (
    <div className="app-shell flex flex-col h-screen">
      <div className="bg-gradient-to-br from-primary-500 to-teal-500 text-white px-4 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StickyIcon size={20} />
            <span className="text-lg font-bold">桌面便签</span>
          </div>
          {isDesktop() && (
            <button
              onClick={toggleFloat}
              className="px-3 py-1.5 bg-white/20 rounded-full hover:bg-white/30 text-xs flex items-center gap-1"
              title="在桌面显示便签浮窗"
            >
              <MonitorSmartphone size={14} /> 桌面显示
            </button>
          )}
        </div>
        <p className="mt-1 text-sm opacity-90">随手记 · 可拖动 · 换色 · 置顶，自动保存在云端</p>
      </div>

      <StickyBoard />
    </div>
  )
}
