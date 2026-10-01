# 🤝 绿角犀管家 — AI 交接总览

> 新 AI 进门第一读。**30 秒内读懂项目状态**。每日更新。
> 
> 🔴 **入场必读顺序**：handover.md（本文件）→ pitfalls.md（活跃坑清单）→ issues.md（当前未闭环工单）→ daily/今日流水

---

## ⚡ AI 接手 30 秒快照（每天更新一次顶部）

| 维度 | 当前值 | 上一次变更 |
|---|---|---|
| **Git HEAD** | `47cb261` feat(admin): Dashboard 社交活跃度数据中心 | 2026-09-30 |
| **运行端口** | 3001 后端 ✅ · 5173 桌面 ✅ · 5174 手机 ✅ · 5175 admin ✅ | 随时可能死，用 blocking=false + web_server 模式驻留 |
| **BUILD_MODE** | cross-env `VITE_BUILD_MODE=desktop/mobile`（已废弃 vite define 方案） | 3 坑连发修复 |
| **admin 新交付** | Dashboard 社交活跃度数据中心 + 侧边栏 4 组重新分组 | `47cb261` + `5f6df89` |
| **后端 admin 接口** | `/admin/stats/overview` ⚠️ **TODO 未实现**（Dashboard 目前是 mock） | 前端已留 fetch 注释 |
| **pm.routes.ts** | 14 条路由 ✅（departments/projects/stats/CRUD/payments/receipts/invoices） | ZodError → 422 已全局修复 |
| **issues.md** | 5 组 Master 成长型（M-001 Vite P0 聚合 5 子条） | 归并铁律：子条目≥3 自动升 P0 |
| **活跃坑 Top 3** | M-001 Vite dev proxy/入口/envFile / M-004 PS5 特定坑 / ZodError 漏接 | pitfalls.md 按 Master 分组 |
| **未闭环工单** | M-001-ZH-005 admin middleware rewrite 方案 / IS-003 BUILD_MODE | 见 issues.md |
| **下一步优先级** | 后端补 admin/stats/overview 聚合接口 → 替换 Dashboard mock | — |

---

## 项目一句话

Electron 桌面端（Windows）+ React 18 + Node.js/Express + Prisma/**SQLite**，本地优先的全能个人助理。**数据库是 SQLite 不是 MySQL**。**同时是社交平台（community/conversation/habitTrack/pet 表）+ PM 项目账款工具（pm.routes.ts）**。

## 技术栈速查

| 层 | 选型 | 注意事项 |
|---|---|---|
| 前端 | React 18 + React Router v6 + Zustand + Vite | **3 份 Vite config**（vite / mobile-vite / admin-vite），cross-env 设 BUILD_MODE |
| 后端 | Node.js + Express + Prisma + SQLite | Zod schema.parse 全局 handler 在 middleware/error.ts |
| 桌面 | Electron（electron-builder NSIS） | NSIS custom installer 加 taskkill |
| 手机 | Capacitor（APK，mobile-dist 构建） | 正式签名 keystore 在 C:\path\to\keystore |
| 管理后台 | admin-vite.config.ts（端口 5175） | **middleware rewrite `/admin/ → /admin/admin.html`** 返回正确入口 |
| 数据库 | SQLite（dev.db 本地 / prod.db 服务器） | 表名漂移：本地 `User`，服务器 `users`（小写 s） |

## 三端产品面（编译常量分离）

| 产品面 | Vite Config | Dev 端口 | 构建产物 | 布局组件 | BUILD_MODE |
|---|---|---|---|---|---|
| **电脑端** | vite.config.ts | 5173 | `dist/` | `DesktopLayout` 深色侧边栏 | desktop |
| **手机端** | mobile-vite.config.ts | 5174 | `mobile-dist/` | `Layout` 底部 TabBar | mobile |
| **运营管理** | admin-vite.config.ts | 5175 | `admin-dist/` | `AdminLayout` 白底浅灰蓝紫 | admin（独立入口） |

```bash
cd frontend
npm run dev          # 桌面端 5173
npm run dev:mobile   # 手机端 5174
npx vite --config admin-vite.config.ts --port 5175  # 管理后台
```

## admin 侧边栏（社交运营视角）

```
工作台     → 活跃总汇（Dashboard 社交活跃度数据中心）
社区运营   → 社区内容（AdminCommunity）+ 用户管理（AdminUsers）
业务协作   → 团队管理（AdminTeamPage）+ 项目账款（AdminPMPage）
系统管理   → 操作日志（AdminAuditLogs）+ 系统设置（AdminAgentConfigPage）
```

## 台账体系（5 本账）

| 账 | 写什么 | 什么时候写 | 索引方式 |
|---|---|---|---|
| **handover.md**（本文件） | 项目状态快照 + 远程资源 + 铁律 | 每天更新顶部 30 秒快照 | 时间 + 版本 |
| **daily/YYYY-MM-DD.md** | 每次动作流水 + 踩坑一笔带过 | 改完立刻追加 | 时间戳 |
| **pitfalls.md** | 坑清单（现象→根因→解法），**Master+子条目归并** | 踩了才写，同类→append 子条目 | 坑类型 Master |
| **issues.md** | 问题工单（bug 生命周期），**Master+子条目** | 修了真 bug 才写 | 工单编号 IS-xxx / Master M-xxx |
| **decisions.md** | 关键决策（为什么选 A 不选 B） | 拍板时写 | 决策编号 D-xxx |

**成长型铁律**：
1. 踩坑先查 Master → 有就 append 子条目，没有才开新 Master
2. **子条目 ≥ 3 → 自动升 1 级**（P2→P1，P1→P0）
3. 活跃 Master ≤ 10 个，超过归档到 issues-archive.md

---

## 远程资源清单
| 资源 | URL/位置 | 状态 | 备注 |
|------|---------|------|------|
| GitHub | git@github.com:stvode-cyber/-.git | ✅ 已 push | 仓库名是 `-`（自动化失败 + 误输入），SSH key 在 C:\Users\Administrator\.ssh\id_rsa |
| 云端 API | https://47.116.59.141/api/v1/app/windows-version | ✅ HTTP 200 | 返回 v1.0.6 + 真实 SHA256 + 下载链接 |
| 下载链接 | https://47.116.59.141/apk/lvjiaoxi-setup-1.0.6.exe | ✅ HTTP 200 | 软链接 → 绿角犀-Setup-1.0.6.exe |
| EXE 托管 | /usr/share/nginx/html/apk/ | ✅ 两个 EXE + 软链接 | nginx root /usr/share/nginx/html + location /apk/ |
| 生产库 | /root/backend/prisma/prod.db | ✅ SQLite | **服务器表名 `users`（小写 s），本地 `User`** |
| nginx conf | /etc/nginx/conf.d/greenrhino-cloud-ssl.conf | ✅ | 补 X-Forwarded-For + /apk/ 301 跳 HTTPS |
| admin 静态 | /usr/share/nginx/html/admin/ | ⚠️ **还没部署** | 本地 admin-dist/ 还没 scp 上去 |

## 服务器 SSH
```bash
ssh root@47.116.59.141
pm2 list                          # 看进程
pm2 restart aie-backend           # 重启后端
tail -f /root/backend/logs/out.log  # 看日志
lsattr /etc/nginx/conf.d/*.conf   # 查 immutable 锁
sqlite3 /root/backend/prisma/prod.db ".schema"  # 查表结构（注意：表名 users 不是 User）
sqlite3 /root/backend/prisma/prod.db "SELECT username, role FROM users WHERE role='admin'"  # 查管理员
```

## 铁律（别碰）
1. **版本号三处同步**：electron/backend/frontend 三个 package.json + 前端 5 处硬编码
2. **改后端端口**：必须同步改 nginx conf.d 里所有 proxy_pass
3. **内测两步走**：本机改完 → 用户拍板 → 推服务器
4. **LLM_API_KEY 不进安装包**：新电脑手动放 userData/llm.env
5. **DEV 登录仅限开发环境**：import.meta.env.DEV 包起来（双保险：auth.ts + LoginPage）
6. **Electron SHA256 必同步**：build 完 EXE SHA 会变，必须 scp 传服务器 + 更新 SQLite windows_releases 表
7. **PowerShell 起 Web 进程**：**不能用 Start-Job**，必须 `RunCommand blocking=false + command_type=web_server`，否则进程会被清理
8. **admin middleware rewrite**：admin-vite.config.ts 用 middleware 把 `/admin/` rewrite 到 `/admin/admin.html`（configureServer 直接改 req.url 不生效，Vite HTML middleware 先跑了）
9. **SQLite 表名漂移**：本地 `prisma/dev.db` 默认 `User`，服务器迁移后是 `users`（小写 s），操作前先 `.tables` 确认

## ⚡ 防失忆双铁律（work-growth-logger Skill）
1. **关键操作前先查记录**：`git ls-remote` / API 查 / `pm2 list`，查到才算做过
2. **关键操作后立刻同步**：别等对话结束，改完远程资源（服务器/仓库/数据库）立刻追加 handover.md + daily

## 发版命令速查（v1.0.6 验证过）
```powershell
# 1. 本地 build
cd APP-AIE
node build-desktop.cjs

# 2. gate-check
powershell -ExecutionPolicy Bypass -File .\gate-check.ps1

# 3. 传 EXE 到服务器
scp "electron\release-v*\绿角犀-*.exe" "root@47.116.59.141:/usr/share/nginx/html/apk/"

# 4. 服务器算 SHA256 + 更新 SQLite
ssh root@47.116.59.141 "sha256sum /usr/share/nginx/html/apk/绿角犀-*.exe"
# 写临时 SQL 文件 → scp 上去 → ssh sqlite3 prod.db < update.sql

# 5. 验证 API
curl -skL https://47.116.59.141/api/v1/app/windows-version
```

## admin 密码（明牌）

| 环境 | 用户名 | 密码 |
|---|---|---|
| **本地 dev** (prisma/dev.db) | `16100214673` | `admin123ABC` |
| **公网 prod** (服务器 prod.db) | `tone_test2` | `admin123ABC` |

## 代码规范
- PowerShell 脚本必须 UTF-8 带 BOM
- **Node/Admin 工具生成文件用无 BOM UTF8**（`[System.Text.UTF8Encoding]::new($false)`）
- **PowerShell here-string / Out-File 写 JSX 会吃反引号** — 用 Edit 工具或 Node 临时 .cjs 改
- SQLite 不是 MySQL！更新用 `sqlite3 prod.db < update.sql`，引号嵌套问题写临时 SQL 文件
- Electron build 后 EXE SHA256 必变，必须同步更新服务器 + 数据库
- 所有文件改动记录在 .trae/memory/growth/

## 下一步（按优先级）
- [ ] **后端补 /admin/stats/overview 聚合接口**（聚合 community / conversation / habitTrack / pet 表真实数据，替换 Dashboard mock）
- [ ] admin 5175 部署到服务器（scp admin-dist/ → /usr/share/nginx/html/admin/ + nginx location /admin/ 配置）
- [ ] pm.routes.ts 全接口冒烟测试（后端已通，admin 前端调通）
- [ ] 清服务器旧 nginx conf 备份（15 份 .bak.*）
- [ ] （可选）GitHub 仓库改名 `-` → `APP-AIE`

## 最近踩坑标签
#编码修复 #GS-002 #nginx #PS5.1 #immutable锁 #记忆错位 #CDP #Chrome #bot防护 #device-code #user-data-dir #SQLite #Electron-SHA256 #Vite-dev #admin-middleware #BUILD_MODE #ZodError #表名漂移 #PowerShell-Start-Job

