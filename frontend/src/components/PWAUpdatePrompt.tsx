import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, X, DownloadCloud } from 'lucide-react'

/**
 * PWA 后台更新准备组件（两阶段）
 *
 * 流程：
 * 1. 检测到新版本 → Service Worker 在后台静默下载新资源（准备阶段）
 *    → 底部显示低调状态条"正在准备新版本…"（不挡操作、无按钮）
 * 2. 新 SW 安装完成进入 waiting（准备就绪）
 *    → 弹出提示条"新版本已就绪"，用户点击"立即刷新"应用更新
 * 3. 触发时机更积极：页面加载、切回前台（visibilitychange）、定时轮询
 *
 * 使用方式：在 App 根组件中挂载一次即可
 *   <PWAUpdatePrompt />
 */
export function PWAUpdatePrompt() {
  // idle = 无更新 | preparing = 新版本后台下载中 | ready = 下载完成待用户确认
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'ready'>('idle')
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [offlineReady, setOfflineReady] = useState(false)
  const lastCheckRef = useRef(0)
  const dismissedRef = useRef(false)

  /** 用户确认：让 waiting 状态的新 SW 立即接管，激活后自动刷新 */
  const handleUpdate = useCallback(() => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
  }, [registration])

  /** 关闭提示（本次会话内延后更新） */
  const handleDismiss = useCallback(() => {
    dismissedRef.current = true
    setPhase('idle')
  }, [])

  useEffect(() => {
    if (import.meta.env.DEV || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    let registrationRef: ServiceWorkerRegistration | null = null

    /** 已有 waiting SW：直接进入就绪态 */
    const checkWaiting = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting) {
        setRegistration(reg)
        if (!dismissedRef.current) setPhase('ready')
      }
    }

    /** 新 SW 生命周期：installing = 准备中（下载新资源）→ installed = 就绪 */
    const handleUpdateFound = (reg: ServiceWorkerRegistration) => {
      const newWorker = reg.installing
      if (!newWorker) return

      if (!dismissedRef.current) setPhase('preparing')

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          setRegistration(reg)
          if (!dismissedRef.current) setPhase('ready')
        }
        // 准备失败（网络中断等）：回到待机，等待下次检查
        if (newWorker.state === 'redundant') {
          setPhase('idle')
        }
      })
    }

    const handleControllerChange = () => {
      window.location.reload()
    }

    /** 主动检查更新（带 60 秒限频，避免频繁切前台打爆服务器） */
    const checkForUpdate = () => {
      const now = Date.now()
      if (now - lastCheckRef.current < 60_000) return
      lastCheckRef.current = now
      registrationRef?.update().catch(() => {})
    }

    // 初始化：获取已有注册并挂监听
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (!reg) return
        registrationRef = reg
        checkWaiting(reg)
        reg.addEventListener('updatefound', () => handleUpdateFound(reg))
        // 页面加载即检查一次
        checkForUpdate()
      })
      .catch(() => {})

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)

    // 切回前台时检查（用户从其他 App/标签页回来时尽早发现新版本）
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    // 定期轮询（15 分钟）
    const checkInterval = setInterval(checkForUpdate, 15 * 60 * 1000)

    return () => {
      clearInterval(checkInterval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [handleDismiss])

  // 离线就绪提示（首次安装后短暂显示）
  useEffect(() => {
    if (import.meta.env.DEV) return
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    const handleOfflineReady = () => {
      setOfflineReady(true)
      setTimeout(() => setOfflineReady(false), 3000)
    }

    if (navigator.serviceWorker.controller) {
      // 已有 controller，非首次安装
    } else {
      const checkInstalled = () => {
        if (navigator.serviceWorker.controller) handleOfflineReady()
      }
      navigator.serviceWorker.addEventListener('controllerchange', checkInstalled, { once: true })
      return () => {
        navigator.serviceWorker.removeEventListener('controllerchange', checkInstalled)
      }
    }
  }, [])

  if (offlineReady) {
    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[90] px-4 py-2 bg-green-500 text-white text-sm rounded-lg shadow-lg animate-slide-up">
        ✨ 已就绪，可离线使用
      </div>
    )
  }

  // 阶段一：准备中（新版本资源后台下载，低调不打扰）
  if (phase === 'preparing') {
    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[90] animate-slide-up">
        <div className="flex items-center gap-2.5 px-4 py-2 bg-gray-800/90 text-white rounded-lg shadow-lg backdrop-blur-sm">
          <DownloadCloud size={16} className="shrink-0 animate-pulse" />
          <span className="text-sm text-gray-200">正在后台准备新版本…</span>
          <span className="flex gap-1 ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        </div>
      </div>
    )
  }

  // 阶段二：就绪（下载完成，请用户确认）
  if (phase !== 'ready') return null

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[90] animate-slide-up">
      <div className="flex items-center gap-3 px-4 py-3 bg-emerald-600 text-white rounded-lg shadow-lg max-w-sm">
        <RefreshCw size={18} className="shrink-0" />
        <div className="flex-1 text-sm">
          <div className="font-medium">新版本已就绪</div>
          <div className="text-xs text-emerald-100">已下载完成，刷新即可使用</div>
        </div>
        <button
          onClick={handleUpdate}
          className="px-3 py-1.5 bg-white text-emerald-600 text-sm font-medium rounded-md hover:bg-emerald-50 transition-colors"
        >
          立即刷新
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 text-emerald-200 hover:text-white transition-colors"
          aria-label="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
