/**
 * 移动端适配器
 *
 * 在 Capacitor 环境中注入 mock desktopAPI，
 * 使现有 Electron 前端代码无需修改即可在移动端运行。
 *
 * Electron 专有功能（浮窗、系统托盘等）在移动端为 no-op，
 * 移动端通过通知栏和应用内导航替代。
 */

import { isCapacitor } from './platform'

/**
 * 初始化移动端适配：注入 mock desktopAPI
 * 在应用入口（main.tsx）中调用
 */
export function initMobileAdapter() {
  if (!isCapacitor) return
  if (typeof window === 'undefined') return

  // 已有 desktopAPI（Electron 环境）则不覆盖
  if ((window as any).desktopAPI) return

  ;(window as any).desktopAPI = {
    // 移动端不是桌面环境
    isDesktop: () => false,

    // API 地址由 platform.ts 处理，这里返回空让 platform.ts 接管
    getBaseURL: () => '',

    // 浮窗控制：移动端为 no-op（通过通知/小组件替代）
    togglePetWindow: () => Promise.resolve('noop'),
    closePetWindow: () => Promise.resolve('noop'),
    toggleStickyWindow: () => Promise.resolve('noop'),
    toggleCountdownWindow: () => Promise.resolve('noop'),
    toggleTodoWindow: () => Promise.resolve('noop'),
    toggleReminderWindow: () => Promise.resolve('noop'),
    toggleWallpaperWindow: () => Promise.resolve('noop'),

    // 本地缓存：移动端使用 Capacitor Preferences 或 IndexedDB
    cacheAsset: async (_assetId: string, _fileName: string, _arrayBuffer: ArrayBuffer) => {
      // 移动端暂不支持本地资产缓存，后续可用 IndexedDB 实现
      return null
    },
    getCached: async (_assetId: string) => {
      return null
    },
    readCached: async (_assetId: string) => {
      return null
    },
    removeCached: async (_assetId: string) => {
      return false
    },
    listCached: async () => {
      return []
    },

    // 文件操作：移动端暂不支持
    selectFolder: () => Promise.resolve(null),
    scanFolder: (_folderPath: string) => Promise.resolve(null),
    readFileBytes: (_filePath: string) => Promise.resolve(null),
    watchStart: (_watchId: string, _folderPath: string) => Promise.resolve(null),
    watchStop: (_watchId: string) => Promise.resolve(null),
    onFileChanged: (_cb: Function) => {},
  }

  console.log('[Mobile Adapter] desktopAPI mock injected for Capacitor')
}
