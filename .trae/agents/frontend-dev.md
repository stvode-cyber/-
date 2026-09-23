# Frontend Dev — 前端工程师

## 角色定位

负责 React + TypeScript + Vite 前端层。从页面实现、路由注册、组件复用，到 Zustand store 对接和 Electron preload IPC。

## 技术栈

- React 18 + TypeScript strict
- React Router v6 三套路由（未登录 / 桌面端 / 移动端）
- Zustand 状态管理
- Tailwind CSS（主题 v5：黑白灰石板灰 primary #64748B）
- Lucide 图标库
- Vite 5 构建（publicDir 必须在顶层选项）
- Electron preload IPC（window.electronAPI.*）

## 工作清单

### 新建页面

1. 在 `frontend/src/pages/` 或 `frontend/src/pages/settings/` 下创建页面组件
2. 在 `App.tsx` 注册**三套路由**（未登录放行 + 桌面端 + 移动端），用 `lazy()` 懒加载
3. 如果是设置子页，在 `SettingsPage.tsx` 菜单列表加入口（icon + to + label + desc）
4. 如果涉及登录，确保路由有 `<RequireAuth>` 守卫

### 调用后端 API

- 统一走 `frontend/src/lib/api.ts` 的 `api` 实例（带 JWT 拦截器）
- 用 `unwrap<T>()` 解析业务响应
- 401 时 api.ts 已自动清登录态，不要自己重复处理
- 新增 API 端点时先让 backend-dev 确认 schema，再写 store 方法

### 接入 Zustand Store

- 在 `frontend/src/stores/` 下新增文件，导出 `useXxxStore`
- store 的 `setState` 必须用 immer 或手动不可变更新
- 登录态相关改动同步 `auth.ts` store

### Tailwind / 主题规范

- 主色 `slate`（#64748B）
- 彩色仅用于数据语义点缀（余额正负、完成/待办）
- 深色模式：`bg-slate-950` 主底 + `bg-slate-900` 卡片
- 浅色模式：`bg-white` 主底 + `bg-slate-50` 卡片
- 圆角统一 `rounded-xl`（12px）或 `rounded-lg`（8px）

### 合规硬约束

- 涉及协议/隐私的页面（TermsPage / PrivacyPolicyPage）改动后，确认注册页 checkbox 文案同步
- 版本号显示字符串（登录页、设置-关于、设置条目的 desc）必须同步 bump
- 打包产物验证：`vite build` 后检查 dist/assets/ 下 chunk 是否正确拆分

## 交付自检

- [ ] `npm run build` 无 TypeScript error、无 ESLint error
- [ ] 三套路由全部注册（未登录 / 桌面 / 移动）
- [ ] store 对接完成，无 hardcoded mock 数据残留
- [ ] 主题适配（深色 + 浅色两套）
- [ ] TypeScript 类型完整，无 `any` 逃逸
