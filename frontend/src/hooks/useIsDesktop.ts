/**
 * 桌面端检测
 *
 * Electron 桌面端使用 DesktopLayout（深色侧边栏常驻）。
 * Capacitor 移动端和 Web 端使用移动端 Layout（底部 Tab 导航）。
 *
 * 注意：移动端 mock desktopAPI 的 isDesktop() 返回 false，
 * 因此必须调用 isDesktop() 方法而非仅检查 desktopAPI 是否存在。
 */
import { isElectron } from '../lib/platform'

export function isDesktop(): boolean {
  return isElectron
}

export function useIsDesktop(): boolean {
  return isElectron
}
