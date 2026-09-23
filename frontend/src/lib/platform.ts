/**
 * 平台检测工具
 *
 * 三种运行环境：
 * 1. Electron 桌面端 — window.desktopAPI 存在，协议为 file: 或 http://127.0.0.1
 * 2. Capacitor 移动端 — window.Capacitor 存在，协议为 capacitor:// 或 https://localhost
 * 3. Web 浏览器 — 以上都不满足
 */

type Platform = 'electron' | 'capacitor' | 'web'

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'web'

  // Capacitor 注入 window.Capacitor
  if ((window as any).Capacitor?.isNativePlatform?.()) return 'capacitor'

  // Electron 注入 window.desktopAPI
  if ((window as any).desktopAPI) return 'electron'

  // Electron 子窗口可能 desktopAPI 未注入，用协议兜底
  if (window.location.protocol === 'file:') return 'electron'

  // Capacitor Android 使用 https://localhost 协议
  if (window.location.protocol === 'capacitor:' || (window.location.hostname === 'localhost' && (window as any).Capacitor)) {
    return 'capacitor'
  }

  return 'web'
}

export const platform: Platform = detectPlatform()

export const isElectron = platform === 'electron'
export const isCapacitor = platform === 'capacitor'
export const isWeb = platform === 'web'

export const isMobile = isCapacitor

/**
 * 获取 API 基础地址
 *
 * - Electron: 通过 desktopAPI 或硬编码 127.0.0.1:3001
 * - Capacitor: 通过环境变量 VITE_API_BASE_URL 配置远程服务器地址
 * - Web: 相对路径 /api/v1（由 vite proxy 或 Nginx 转发）
 */
export function getAPIBaseURL(): string {
  if (isElectron) {
    if ((window as any).desktopAPI?.getBaseURL) {
      return (window as any).desktopAPI.getBaseURL()
    }
    return 'http://127.0.0.1:3001/api/v1'
  }

  if (isCapacitor) {
    // 移动端连接远程后端服务器
    // 通过 vite 环境变量配置：VITE_API_BASE_URL=https://api.example.com/api/v1
    return import.meta.env.VITE_API_BASE_URL || 'https://lujax.fun:8444/api/v1'
  }

  // Web 端使用相对路径
  return '/api/v1'
}

/**
 * 是否需要手动携带 JWT（非 Web 模式需要）
 * Web 端依赖 HttpOnly Cookie，Electron/Capacitor 使用 Authorization header
 */
export const useHeaderAuth = isElectron || isCapacitor
