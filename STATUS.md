# STATUS.md — 工程状态汇总

> 只负责状态汇总，不堆正文。详细状态在各模块总纲。

最后更新：2026-09-18（L3 公网接入全链路完成 + P0-A/B/C 内测就绪 + dist 同步铁律固化）

## 下一里程碑

**v1.0.4 内测发布**（待用户拍板）—— P0-A 联调 / P0-B UI 验收 / P0-C 打包全部就绪，dist 同步铁律已用 sync-dist.ps1 固化，可进入内测分发流程。

## 当前版本

**v1.0.3** — 5 处版本号对齐 ✅（待办：v1.0.4 内测发布）

## 模块状态

| 模块 | 子模块 | 状态 | 最后更新 | 备注 |
|---|---|---|---|---|
| 01_后端 | 路由层 | ✅ 稳定 | 2026-09-10 | 38 路由 + conversation 好友双向 API + chat /llm-status + /admin 独立静态托管（express.static + SPA fallback，不吞 /api/v1/*） |
| 01_后端 | 数据模型 | ✅ 稳定 | 2026-08-18 | Prisma schema |
| 01_后端 | 安全约束 | ✅ 稳定 | 2026-08-18 | JWT/CSP/sandbox |
| 01_后端 | 测试脚本 | ✅ 已清理 | 2026-08-19 | 5 条 smoke (package.json 引用) |
| 01_后端 | AgentCore P0-P4 | ✅ 已实施（TS） | 2026-08-24 | src/services 4 文件 TS 规范化完成（agentCore/abStats/weeklyAggregator/proactive.lib）+ index.ts 调度器启动（proactive/weeklyAggregator/initAgentCore）+ chat.routes 接入 getAgentCore().handle() + admin /ab-stats 端点；tsc strict 零错误；E2E 验证通过（详见 TEST_REPORT_AgentCore_Activation.md）|
| 02_前端 | 页面层 | ✅ 稳定 | 2026-09-10 | 主 APP（MomentsPage/AlbumPage/OfficeDocPage/ProfilePanelPage/PrivacyPage/WeeklyReportPage + FriendPanel）+ 独立管理后台（admin.html + admin-main.tsx + admin-vite.config.ts，独立构建不混入主 APP） |
| 02_前端 | 组件库 | ✅ 稳定 | 2026-08-21 | TabBar (QQ风激活光条) + FriendsPanel + PetSprite 3D + DesktopLayout 深色侧边栏 + avatarChange 共享工具 |
| 02_前端 | 主题配色 v5 | ✅ 稳定 | 2026-08-21 | 黑白灰石板灰 primary (#64748B) + 天气横幅 5 图切换 + 彩色仅数据语义点缀 |
| 02_前端 | 状态管理 | ✅ 稳定 | 2026-08-18 | Zustand stores |
| 03_桌面端 | Electron 主进程 | ✅ 稳定 | 2026-08-19 | Node 22 + Electron 43 |
| 03_桌面端 | 浮窗系统 | ✅ 稳定 | 2026-08-19 | 6 类浮窗入口整合到 TasksPage header |
| 03_桌面端 | 打包流程 | ✅ 已完成 | 2026-09-18 | release-v16（绿角犀-Setup-1.0.3.exe **160MB** + 绿角犀-Portable-1.0.3.exe **160MB**，修复 extraResources from 路径 bug，GUI 实测通过）；UI v5 + AgentCore P0-P4 + 管理入口已剥离 + 用户协议 checkbox；**dist 同步铁律**用 sync-dist.ps1 一键脚本固化（Full/FrontendOnly/BackendOnly/SyncOnly/DryRun 5 模式 + 三层时间戳验证） |
| 03_桌面端 | L3 公网接入 | ✅ 已完成 | 2026-09-18 | 双轨架构：云端 socat 3001→3100 + frpc 3900 隧道；Scheduler 修复（Prisma SQLite DateTime 改 raw SQL INTEGER 比较）；PM2 + aie-socat.service + schtasks "绿角犀-frpc" 全部开机自启 |
| 03_桌面端 | 3D 宠物 | ✅ 稳定 | 2026-08-19 | 7 动作 + 4 表情 + 粒子效果 |
| 05_多平台 | Android APK | ✅ 已完成 | 2026-09-10 | JDK 21 + SDK 35 环境已补齐；vite --mode mobile + cap sync + gradle assembleRelease；正式签名 CN=LuJiaoXi；绿角犀-安卓端-v1.0.1-正式签名.apk（13.2MB，versionCode 2）；管理入口已移除 |
| 04_部署运维 | 部署脚本 | ✅ 稳定 | 2026-08-18 | deploy-tool step1-8 |
| 04_部署运维 | 数据库模板 | ✅ 稳定 | 2026-08-18 | clean-template 流程 |
| 05_功能特性 | 宠物系统 | ✅ 已合并 | 2026-08-19 | 4合1 完整说明 |
| 05_功能特性 | DAM资产分类 | ✅ 已合并 | 2026-08-19 | 4合1 含远程提取 |
| 05_功能特性 | QQ社交层 | ✅ 已实施 | 2026-08-21 | 好友双向关系/朋友圈九宫格/相册按月网格/我的页QQ空间式/提醒并入待办视图 |
| 06_审查与交接 | 代码审查 | ✅ 归档 | 2026-08-18 | 2026-08 初报告 |
| 06_审查与交接 | 开发日记 | ✅ 归档 | 2026-08-18 | 过程记录 |
| 06_审查与交接 | 交接记录 | ✅ 归档 | 2026-09-10 | 工作点（含安装包公网链接、SNI 封锁诊断） |
| 07_设计文档 | V2.3 完整设计 | ✅ 归档 | 2026-08-18 | 109KB |
| 08_多平台评估 | 字体/图表 | ✅ 归档 | 2026-08-18 | Jura/Lora+Echarts |
| 09_工具 | 抠图工具 | ✅ 稳定 | 2026-08-18 | rmbg14.onnx |

## 待处理项

- [x] backend/ 脚本清理（Step 5）✅ 2026-08-19 删 16 个冗余+保留 14 个活跃
- [x] electron/ 调试产物清理（Step 5）✅ 2026-08-19 删 11 个 log/txt/db/test
- [x] 宠物系统 4 文档合并（Step 4）✅ 2026-08-19
- [x] DAM 系统 4 文档合并（Step 4）✅ 2026-08-19
- [x] 3D 宠物动态化（7 动作 + 4 表情）✅ 2026-08-19
- [x] 桌面端侧边栏深色化 + 圆角升级 ✅ 2026-08-19
- [x] 浮窗入口整合到 TasksPage header ✅ 2026-08-19
- [x] 随手记 deep link 集成（aie://quick-note）✅ 2026-08-19
- [x] 桌面端 v15 重新打包（Setup + Portable）✅ 2026-08-19
- [x] UI v5 黑白灰配色改版（石板灰 primary + 天气横幅）✅ 2026-08-21
- [x] QQ式社交层（好友/朋友圈/相册/TabBar/我的页/提醒并入待办）✅ 2026-08-21
- [x] AgentCore 智能体核心后端 P0-P4 ✅ 2026-08-21（JS 版：dist/services 5 模块 + chat/admin 路由接入 + 4 smoke 脚本 + agent-config.json；⚠️ TS 源码待补下次规范化）
- [x] 桌面端 v16 重新打包（含 UI v5 + AgentCore P0-P4）✅ 2026-08-21 release-v16/绿角犀-Setup-1.0.0.exe (165.82 MB) + 绿角犀-Portable-1.0.0.exe (165.35 MB)
- [x] Android APK 重建（JDK 21 + SDK 35 环境补齐）✅ 2026-09-10（vite --mode mobile + cap sync + gradle assembleRelease；正式签名 CN=LuJiaoXi；绿角犀-安卓端-v1.0.1-正式签名.apk 13.2MB；maven.google.com 走阿里云镜像）
- [x] AgentCore JS→TS 源码规范化 + 模块激活 ✅ 2026-08-24（src/services 4 文件 TS + index.ts 调度器启动 + chat/admin 路由接入 + schema 字段补齐；详见 TEST_REPORT_AgentCore_Activation.md）
- [x] 管理后台独立成云端网页 ✅ 2026-09-10（前端删除 admin 路由+登录页入口；新增 admin.html+admin-main.tsx+admin-vite.config.ts 独立构建；后端 /admin express.static+SPA fallback；访问 https://lujax.fun:8444/admin/）
- [x] 桌面端 release-v16 重打包（管理入口已剥离）✅ 2026-09-10（绿角犀-Setup-1.0.0.exe 159.4MB + 绿角犀-Portable-1.0.0.exe 158.9MB）
- [x] 三个安装包上传公网下载 + Nginx /apk/ location ✅ 2026-09-10（47.116.59.141 /usr/share/nginx/html/apk/；直连 IP 分发；域名因 SNI 封锁不可用）

## 2026-09-18 待办（下一版 v1.0.4）

- 🔲 同步云端后端 phone-login 端点 → 恢复 AUTH_MODE=cloud-proxy（ scp dist + pm2 restart + main.cjs 切回 cloud-proxy + 重打包）
- 🔲 绿角犀办公软件（另一项目）端口冲突 → 换 3002 或 4000
- 🔲 v1.0.4 内测发布（P0-A/B/C 已就绪，等用户拍板）
- 🔲 dist 同步铁律后续可考虑集成进 build-desktop.cjs 尾部（开发态保留 sync-dist.ps1 独立调用）
