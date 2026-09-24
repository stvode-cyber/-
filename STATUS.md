# STATUS.md — 工程状态汇总

> 只负责状态汇总，不堆正文。详细状态在各模块总纲。

最后更新：2026-09-24（v1.0.6 内测就绪 + GitHub 初始化 + work-growth-logger Skill）

## 下一里程碑

**v1.0.6 内测发布**（同事测试中）—— gate-check 7/7 全绿，EXE 上传服务器，SHA256 三处对齐，下载链接已发给同事。等反馈后决定下一版。

## 当前版本

**v1.0.6** — 三处版本号对齐 ✅（electron/backend/frontend 都是 1.0.6）

## Git

| 项 | 值 |
|----|-----|
| 分支 | main |
| 最新 commit | `b678fd1`（fix: 更新 Skill 记录） |
| 总 commit | 3 个 |
| remote | git@github.com:stvode-cyber/-.git |
| 工作区 | ✅ 干净 |

## 模块状态

| 模块 | 子模块 | 状态 | 最后更新 | 备注 |
|---|---|---|---|---|
| 01_后端 | 路由层 | ✅ 稳定 | 2026-09-22 | 39 路由 + windows-version API 调用日志已生效 |
| 01_后端 | 数据模型 | ✅ 稳定 | 2026-09-22 | Prisma SQLite 51 表 + windows_releases 更新表 |
| 01_后端 | 安全约束 | ✅ 稳定 | 2026-09-22 | JWT/CSP/sandbox + DEV 登录 import.meta.env.DEV 双保险 |
| 01_后端 | AgentCore P0-P4 | ✅ 已实施 | 2026-08-24 | TS 规范化 + 调度器启动 |
| 02_前端 | 页面层 | ✅ 稳定 | 2026-09-22 | ~40 页面 + 10 设置子页 + DEV 一键登录入口（连点版本号 5 次 + 登录页底部灰色按钮） |
| 02_前端 | 组件库 | ✅ 稳定 | 2026-08-21 | TabBar + FriendsPanel + PetSprite 3D |
| 02_前端 | 主题配色 v5 | ✅ 稳定 | 2026-08-21 | 黑白灰石板灰 primary + 天气横幅 |
| 02_前端 | 状态管理 | ✅ 稳定 | 2026-08-18 | Zustand stores |
| 03_桌面端 | Electron 主进程 | ✅ 稳定 | 2026-09-22 | Electron 43 + Node 22 |
| 03_桌面端 | 打包流程 | ✅ v1.0.6 | 2026-09-22 | release-v16（Setup 160.4MB + Portable 159.9MB，gate-check 7/7 全绿） |
| 03_桌面端 | L3 公网接入 | ✅ 已完成 | 2026-09-22 | socat 3001→3100 + nginx X-Forwarded-For 真实 IP |
| 03_桌面端 | 3D 宠物 | ✅ 稳定 | 2026-08-19 | 7 动作 + 4 表情 + 粒子效果 |
| 05_多平台 | Android APK | ✅ 已完成 | 2026-09-10 | 正式签名 CN=LuJiaoXi（本次 v1.0.6 未更新 APK） |
| 04_部署运维 | 部署脚本 | ✅ 稳定 | 2026-08-18 | deploy-tool step1-8 |
| 04_部署运维 | 服务器运维 | ✅ 稳定 | 2026-09-22 | nginx conf 补 X-Forwarded-For + /apk/ 301 跳 HTTPS + 清旧备份（1.2G→326M） |
| 05_功能特性 | 宠物系统 | ✅ 已合并 | 2026-08-19 | 4 合 1 完整说明 |
| 05_功能特性 | DAM 资产分类 | ✅ 已合并 | 2026-08-19 | 4 合 1 含远程提取 |
| 05_功能特性 | QQ 社交层 | ✅ 已实施 | 2026-08-21 | 好友/朋友圈/相册/TabBar |
| 06_审查与交接 | work-growth-logger | ✅ 新建 | 2026-09-23 | Skill + 防失忆双铁律 + pitfalls.md 8 条 + handover.md + decisions.md + daily/ |

## 服务器 47.116.59.141 状态

| 进程 | PM2 status | 版本 | 内存 | 最后更新 |
|------|-----------|------|------|---------|
| aie-backend | ✅ online | 1.0.6 | 82.1MB | 2026-09-23 17:09 |
| erp-backend | ✅ online | 0.1.0 | 123MB | — |
| lvjiaoxi-web | ✅ online | 1.0.0 | 70.4MB | — |

| 资源 | 路径 | 状态 |
|------|------|------|
| 后端目录 | /root/backend/ | ✅ 含最新 dist + .env |
| 生产库 | /root/backend/prisma/prod.db | ✅ SQLite，windows_releases 已更新 |
| EXE 托管 | /usr/share/nginx/html/apk/ | ✅ 两个 EXE + 两个软链接 |
| nginx conf | /etc/nginx/conf.d/greenrhino-cloud-ssl.conf | ✅ 补 X-Forwarded-For |
| 磁盘 | 72%（40G 用 27G） | ⚠️ 注意 |

## 2026-09-22~23 改动记录（v1.0.6 内测准备）

- [x] gate-check.ps1 修 UTF-8 BOM + Get-Content -Encoding UTF8（PS 5.1 编码坑复发）
- [x] LoginPage.tsx / auth.ts 加 DEV 守卫（import.meta.env.DEV 包 DEV 登录入口）
- [x] backend app.routes.ts 加 windows-version API 调用日志 + X-Forwarded-For 真实 IP
- [x] nginx greenrhino-cloud-ssl.conf 补 X-Forwarded-For + /apk/ 301 跳 HTTPS
- [x] /usr/share/nginx/html/apk/ 清旧文件（1.2G→326M）
- [x] GitHub 初始化 + 3 commit + push（仓库名 - ，自动化失败保持原名）
- [x] work-growth-logger Skill 创建（7 触发点 + 防失忆双铁律 + 8 条踩坑清单）
- [x] **重传 EXE + 更新 SQLite windows_releases SHA256**（Electron build 后 SHA 必变，三处对齐 ✅）
- [x] 内测下载链接发给同事

## 待处理项

- [ ] **等同事内测反馈**（更新检查按钮 + DEV 一键登录 + 闪退卡死）
- [ ] 清服务器旧 nginx conf 备份（15 份 .bak.*）
- [ ] （可选）GitHub 仓库改名 `-` → `APP-AIE`（Settings → Repository name）
- [ ] v1.0.6 Android APK 更新（正式签名）
- [ ] dist 同步铁律后续可考虑集成进 build-desktop.cjs 尾部（开发态保留 sync-dist.ps1 独立调用）
