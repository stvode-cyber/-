import { create } from 'zustand'

/**
 * 全局网络状态（Zustand）
 *
 * 基于 navigator.onLine + window online/offline 事件实时同步。
 * 离线时各端表现：
 * - Electron：本地后端（127.0.0.1）仍可用，本地功能正常，AI 等在线服务不可用
 * - Capacitor/Web：远程后端不可达，仅本地缓存可读
 */
interface NetworkState {
  online: boolean
  setOnline: (online: boolean) => void
}

export const useNetworkStore = create<NetworkState>((set) => ({
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  setOnline: (online) => set({ online }),
}))
