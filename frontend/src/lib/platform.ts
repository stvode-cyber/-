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
  // #Hotfix mobile: __BUILD_MODE__ 是编译时常量，Rollup 会做 dead code elimination
  // mobile 构建恒为 'mobile' → 强制 capacitor，绕过运行时 window.Capacitor 注入时序问题
  if (__BUILD_MODE__ === 'mobile') return 'capacitor'
  if (__BUILD_MODE__ === 'desktop') return 'electron'

  // 纯 Web 构建（dev server 或 admin）走运行时检测
  if (typeof window === 'undefined') return 'web'
  if ((window as any).Capacitor?.isNativePlatform?.()) return 'capacitor'
  if ((window as any).desktopAPI) return 'electron'
  if (window.location.protocol === 'file:') return 'electron'
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
  // mobile 构建：直接返回 Vite 注入的 API 地址，不依赖运行时 isCapacitor
  if (__BUILD_MODE__ === 'mobile') {
    // 默认走 Nginx 443 反代的直连 IP（lujax.fun 域名 SNI 被封锁不可用）
    // TODO-PROD: 正式发版前改回 https:// — 内测阶段 HTTP 绕过自签名证书（Android WebView 不信任）
    return import.meta.env.VITE_API_BASE_URL || 'http://47.116.59.141/api/v1'
  }

  if (isElectron) {
    if ((window as any).desktopAPI?.getBaseURL) {
      return (window as any).desktopAPI.getBaseURL()
    }
    return 'http://127.0.0.1:3001/api/v1'
  }

  // Web 端使用相对路径
  return '/api/v1'
}

/**
 * 是否需要手动携带 JWT（非 Web 模式需要）
 * Web 端依赖 HttpOnly Cookie，Electron/Capacitor 使用 Authorization header
 */
export const useHeaderAuth = isElectron || isCapacitor
