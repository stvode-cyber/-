// 预加载脚本：暴露 API 基础地址给前端
// 前端通过 window.desktopAPI.getBaseURL() 获取后端地址

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  // 后端 API 基础地址
  getBaseURL: () => 'http://127.0.0.1:3001/api/v1',
  // 是否为桌面环境
  isDesktop: () => true,
  // 本地缓存（离线可用）：缓存 API 走主进程 fs
  cacheAsset: (assetId, fileName, arrayBuffer) =>
    ipcRenderer.invoke('dam:cacheAsset', assetId, fileName, Buffer.from(arrayBuffer)),
  getCached: (assetId) => ipcRenderer.invoke('dam:getCached', assetId),
  readCached: (assetId) => ipcRenderer.invoke('dam:readCached', assetId),
  removeCached: (assetId) => ipcRenderer.invoke('dam:removeCached', assetId),
  listCached: () => ipcRenderer.invoke('dam:listCached'),
  // 桌面端采集：指定文件夹抓取 / 扫描 / 读字节 / 监听
  selectFolder: () => ipcRenderer.invoke('dam:selectFolder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('dam:scanFolder', folderPath),
  readFileBytes: (filePath) => ipcRenderer.invoke('dam:readFileBytes', filePath),
  watchStart: (watchId, folderPath) => ipcRenderer.invoke('dam:watchStart', watchId, folderPath),
  watchStop: (watchId) => ipcRenderer.invoke('dam:watchStop', watchId),
  onFileChanged: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('dam:fileChanged', listener)
    return () => ipcRenderer.removeListener('dam:fileChanged', listener)
  },
  // 桌面宠物浮窗：切换显隐
  togglePetWindow: () => ipcRenderer.invoke('pet:toggleFloat'),
  // 桌面宠物浮窗：关闭（完全销毁窗口）
  closePetWindow: () => ipcRenderer.invoke('pet:closeFloat'),
  // 桌面宠物浮窗：相对拖动（dx/dy 像素位移），实现整个宠物区域可拖拽
  movePetWindow: (dx, dy) => ipcRenderer.invoke('pet:moveBy', dx, dy),
  // 桌面便签浮窗：切换显隐
  toggleStickyWindow: () => ipcRenderer.invoke('sticky:toggleFloat'),
  // 桌面倒计时浮窗：切换显隐
  toggleCountdownWindow: () => ipcRenderer.invoke('countdown:toggleFloat'),
  // 桌面待办浮窗：切换显隐
  toggleTodoWindow: () => ipcRenderer.invoke('todo:toggleFloat'),
  // 桌面提醒浮窗：切换显隐
  toggleReminderWindow: () => ipcRenderer.invoke('reminder:toggleFloat'),
  // 桌面动态壁纸层：切换显隐
  toggleWallpaperWindow: () => ipcRenderer.invoke('wallpaper:toggleWindow'),
  // L2/L3 远程提取 Worker：前端登录/登出时同步 JWT 给主进程里的 Worker
  setWorkerJwt: (jwt) => ipcRenderer.invoke('worker:setJwt', jwt),
  getWorkerJwt: () => ipcRenderer.invoke('worker:getJwt'),
  getWorkerStatus: () => ipcRenderer.invoke('worker:getStatus'),
});
