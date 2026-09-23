// Electron 桌面端 preload 注入的全局 API 类型声明
export {}

declare global {
  interface Window {
    /** Electron preload 注入：桌面端能力桥接 API */
    desktopAPI?: {
      /** 后端 API 基础地址（如 http://127.0.0.1:3001/api/v1） */
      getBaseURL(): string
      /** 是否为桌面环境 */
      isDesktop(): boolean
      // ---- 本地缓存（离线可用）----
      cacheAsset(assetId: string, fileName: string, arrayBuffer: ArrayBuffer): Promise<void>
      getCached(assetId: string): Promise<boolean>
      readCached(assetId: string): Promise<ArrayBuffer | null>
      removeCached(assetId: string): Promise<void>
      listCached(): Promise<Array<{ id: string; fileName: string; size: number; mtime: number }>>
      // ---- 文件夹操作 ----
      selectFolder(): Promise<string | null>
      scanFolder(folderPath: string): Promise<Array<{ path: string; name: string; size: number; mtime: number }>>
      readFileBytes(filePath: string): Promise<ArrayBuffer>
      watchStart(watchId: string, folderPath: string): Promise<void>
      watchStop(watchId: string): Promise<void>
      onFileChanged(cb: (payload: { watchId: string; path: string; event: 'add' | 'change' | 'unlink' }) => void): () => void
      // ---- 浮窗切换 ----
      togglePetWindow(): Promise<void>
      closePetWindow(): Promise<void>
      movePetWindow(dx: number, dy: number): Promise<void>
      toggleStickyWindow(): Promise<void>
      toggleCountdownWindow(): Promise<void>
      toggleTodoWindow(): Promise<void>
      toggleReminderWindow(): Promise<void>
      toggleWallpaperWindow(): Promise<void>
      // ---- L2/L3 远程提取 Worker JWT 桥接 ----
      /** 登录成功后同步 JWT 给主进程里的 Worker（同时持久化到 userData/worker-jwt.json） */
      setWorkerJwt(jwt: string): Promise<boolean>
      /** 读取已持久化的 Worker JWT */
      getWorkerJwt(): Promise<string>
      /** 查询 Worker 运行状态（centralUrl / 在线 / 已绑定节点等） */
      getWorkerStatus(): Promise<{ running: boolean; centralUrl?: string; hasJwt?: boolean; instanceId?: string | null; reason?: string }>
    }
  }
}
