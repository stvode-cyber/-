# Electron 桌面端真机验证清单（阶段 E）

> 本清单用于在**可访问 GitHub 的机器**上验证桌面端（主窗口 / 宠物浮窗 / 便签 / 动态壁纸 / PC 采集同步 / 本地缓存离线）。
> 本沙箱（2026-08-11）无法启动真实 Electron GUI，根因与排查见下文。

## 一、根因回顾（为何本沙箱跑不起来）

`require('electron')` 的内置 API 层来自 `dist/resources/electron.asar`。npmmirror 的 `electron@33.4.11`
发布包（115MB zip）解压后 `dist/resources/` **只有 `default_app.asar`，缺 `electron.asar`** → 内建 `electron`
模块无法注册，`require('electron')` 回退到 `node_modules/electron/index.js`（下载器 shim，返回路径字符串）→
`app / ipcMain / BrowserWindow` 全 `undefined` → `main.cjs` 顶层 `ipcMain.handle` 崩溃（之前日志：`TypeError:
Cannot read properties of undefined (reading 'handle')`）。GitHub 官方 Release 及所有代理在本沙箱均不可达，无法补齐。

**结论：这是环境限制，非代码缺陷。** `main.cwd` 业务逻辑已通过 mock（`_mock.cjs` 打桩 `require('electron')` +
拦截 `child_process.spawn` / `http.get`）验证：13 个 IPC 处理器全部连通、2 个窗口装配正确、后端启动命令路径正确。

## 二、在本机验证步骤

### 1. 重装完整 electron（最关键一步）
```bash
cd electron
npm install electron            # 安装器会自动下载含 electron.asar 的完整二进制
ls dist/resources/electron.asar   # 必须存在，否则仍是损坏态
```

### 2. 确认 resources 指向（Junction / 软链）
`main.cwd` 运行时会读取 `resources/frontend`（前端构建产物）与 `resources/backend`（后端）。仓库已配置：
```
electron/resources/frontend -> ../frontend/dist
electron/resources/backend  -> ../backend
```
全新 clone 后在 Windows 重建 Junction：
```powershell
cd electron/resources
cmd /c rmdir frontend backend
New-Item -ItemType Junction -Name frontend -Target ..\frontend\dist
New-Item -ItemType Junction -Name backend  -Target ..\backend
```
并确保已构建：
```bash
cd ../frontend && npm run build      # 生成 dist/
cd ../backend  && npm run build      # 生成 dist/index.js
```

### 3. 启动
```bash
npm start                            # = electron .
```

### 4. 预期主进程日志（stdout）
```
=== AI助理系统启动 ===
后端已就绪
加载前端: file://.../frontend/dist/index.html#/
宠物浮窗已创建
```
**不应**出现 `TypeError: Cannot read properties of undefined (reading 'handle')`。

## 三、逐项验证清单

| 验证项 | 预期表现 | 检查点 |
|--------|----------|--------|
| 主窗口 | 打开 AI 助理 Web 应用 | 可登录，各模块可见 |
| 宠物浮窗 | 启动即自动出现半透明小窗 | 桌面右下角 260×340，宠物 3D 在动、可摸摸互动 |
| 便签浮窗 | 宠物页头部「桌面显示」或便签页 `?float=1` | 透明便签可拖动 / 缩放 / 改色 |
| 动态壁纸 | 壁纸页「桌面启用」开关 | 全屏动画层、鼠标穿透、应用窗口在其上 |
| PC 采集同步 | LibraryPage 同步面板「添加文件夹 → 立即同步」 | 文件入库，created/updated/skipped 计数正确 |
| 本地缓存离线 | 勾选资产 → 缓存选中 → 断网 → 抽屉离线优先下载 | 断网仍可读本地副本 |

## 四、常见失败排查

- **仍报 `ipcMain is undefined`**：`electron.asar` 缺失 → 重装 electron，确认 `dist/resources/electron.asar` 存在。
- **白屏**：`resources/frontend` 链接失效或 `frontend/dist` 未构建 → 重新 `npm run build`。
- **后端起不来**：`resources/backend` 指向错误或无 `node` → 确认 `backend/dist/index.js` 存在。
- **浮窗不出现**：检查 `createPetWindow` 是否被调用；`isDesktop()` 仅在 Electron 环境返回 true。
- **宠物 3D 不渲染**：确认 `three` 已安装于 `frontend/node_modules`（`npm run build` 通过即说明依赖齐）。

## 五、本次阶段新增功能（同样需真机视觉确认）

- **A 进化视觉化**：宠物 3D 本体随进化阶段改变缩放 / 材质（传说体金色金属质感）/ 脚下发光环（grow+ 可见，颜色随阶段升级）。
- **B 等级特权**：Lv5 解锁「遛弯」、Lv8 解锁「特训」专属互动；互动 / 游戏经验随等级加成（每级 +2%，封顶 +50%）。
- **C 跨会话排行榜**：宠物页「宠物排行榜」卡片，按等级 / 经验排序，脱敏展示宠物名 + 主人昵称，高亮自己。
- **D 分类规则导入导出 + 趋势图**：资料库规则弹窗支持导出 / 导入 JSON；统计看板新增近 30 天新增趋势折线。
