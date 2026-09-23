# 桌面端实跑验证状态（2026-08-11）

## 结论速览
- **代码层全部验证通过**；**原生 Electron GUI 在此沙箱无法启动**（环境限制，非代码缺陷）。
- 根因：本机可用的 electron 镜像（npmmirror）发布的 `electron@33.4.11` 包**缺 `resources/electron.asar`**，`require('electron')` 内建 API 层无法注册 → 主进程崩溃。GitHub 官方源不可达，无法补齐。

## 已完成的验证（全绿）
| 项 | 结果 |
|---|---|
| 前端 `tsc --noEmit` + `vite build` | ✅ 便签/壁纸/宠物页均入包 |
| 后端冒烟测试 | ✅ **82 / 82 通过**（含 sticky / wallpaper / pet） |
| Electron 4 个 cjs `node --check` | ✅ main / preload / collector / cacheStore |
| `main.cjs` 逻辑层 mock 跑通 | ✅ 见下 |

### `main.cjs` 逻辑层验证（mock 拦截 `require('electron')`）
- 创建 2 个窗口：主窗口「AI助理系统」+ 宠物浮窗（`#/pet?float=1`）。便签/壁纸为按需 IPC 唤出（设计如此）。
- **13 个 IPC 处理器全部连通、无遗漏**：
  `dam:cacheAsset / getCached / readCached / removeCached / listCached / selectFolder / scanFolder / readFileBytes / watchStart / watchStop` `pet:toggleFloat` `sticky:toggleFloat` `wallpaper:toggleWindow`
- 后端拉起命令正确（`prisma db push` + `dist/index.js`），路径解析全部正确，`errorBoxes: 0`。

## 唯一未验证项（环境阻断）
- 真实 Electron GUI 渲染：因 `electron.asar` 缺失，无法在此沙箱启动 `electron .`。所有窗口/浮窗的**实际像素渲染**未经真机验证。

## 在可联网（能访问 GitHub）的机器上实跑
```bash
cd electron
npm install electron          # 拉取【完整】二进制（含 electron.asar）
npm start                     # = electron . 启动桌面端
```
启动后：主窗口 + 自动宠物浮窗；个人中心「桌面工具」可唤出便签/动态壁纸浮窗。
> 当前 `electron/node_modules/electron` 为缺 `electron.asar` 的损坏态，执行上述 `npm install electron` 即修复。

## 临时诊断产物
已 rename 移出项目至 `C:\tmp\aie-cleanup\`（探针脚本、下载的 zip、解压目录、运行日志），不影响工程。
