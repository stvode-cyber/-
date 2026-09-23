import { useEffect, useRef, useState } from 'react'
import { WifiOff, Wifi } from 'lucide-react'
import { useNetworkStore } from '../stores/network'
import { isElectron } from '../lib/platform'

/**
 * 全局离线状态横幅
 *
 * - 监听 window online/offline 事件，实时同步到 network store
 * - 离线：顶部显示琥珀色横幅（Electron 端提示本地功能仍可用；移动/Web 端提示进入离线模式）
 * - 恢复：显示 3 秒绿色横幅后自动消失
 * - 浮窗模式（?float=1，透明桌宠/便签等小窗）不显示，避免遮挡和视觉干扰
 */
export default function OfflineBanner() {
  const online = useNetworkStore((s) => s.online)
  const setOnline = useNetworkStore((s) => s.setOnline)
  const [recovered, setRecovered] = useState(false)
  const prevRef = useRef<boolean | null>(null)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    setOnline(navigator.onLine)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [setOnline])

  useEffect(() => {
    if (prevRef.current === null) {
      prevRef.current = online
      return
    }
    if (prevRef.current !== online) {
      prevRef.current = online
      if (online) {
        setRecovered(true)
        const timer = setTimeout(() => setRecovered(false), 3000)
        return () => clearTimeout(timer)
      }
      setRecovered(false)
    }
  }, [online])

  if (document.documentElement.classList.contains('float-mode')) return null
  if (!online) {
    return (
      <div className="fixed top-0 inset-x-0 z-[90] bg-amber-500 text-white text-center text-xs sm:text-sm py-2 px-3 flex items-center justify-center gap-1.5 shadow-md">
        <WifiOff size={15} className="shrink-0" />
        <span>
          {isElectron
            ? '离线模式：本地功能可正常使用，AI 对话等在线服务暂不可用'
            : '无网络连接，已进入离线模式，部分功能暂不可用'}
        </span>
      </div>
    )
  }
  if (recovered) {
    return (
      <div className="fixed top-0 inset-x-0 z-[90] bg-emerald-600 text-white text-center text-xs sm:text-sm py-2 px-3 flex items-center justify-center gap-1.5 shadow-md">
        <Wifi size={15} className="shrink-0" />
        <span>网络已恢复</span>
      </div>
    )
  }
  return null
}
