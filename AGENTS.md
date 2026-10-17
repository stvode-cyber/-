# AGENTS.md — 绿角犀项目全局规则

> 所有 AI 员工共享。入场前必须读。

---

## ① 项目身份

**绿角犀（AIE）** — 桌面端优先的全能个人助理。Electron 壳 + React 前端 + Express/Prisma 后端，本地 SQLite。云端 47.116.59.141 为 AI 网关和多用户身份签发方。

- **版本**：v1.1.0（三落点对齐）
- **仓库**：`git@github.com:stvode-cyber/-.git`（仓库名是 `-`）
- **硬边界**：前端 3 产品面 × 后端 1 端口（3001 本地 / 3100 云端）

| 端口 | 产品 | Vite config | Build mode |
|---|---|---|---|
| 5173 | 电脑端（Electron） | vite.config.ts | desktop |
| 5174 | 手机端（Capacitor APK） | mobile-vite.config.ts | mobile |
| 5175 | 运营管理（AdminLayout） | admin-vite.config.ts | **必须硬 define** |
| 3001 | 后端 API（Express+Prisma+SQLite） | — | — |

---

## ② 新 AI 快速上手（5 步）

```powershell
cd D:\源码存档\助理项目\助理项目\APP-AIE
git status --short; git log --oneline -5
Invoke-RestMethod -Uri "http://localhost:3001/health"
Get-Item "C:\Program Files\aie-desktop\绿角犀.exe" | Select Length, LastWriteTime
```

**入场顺序**：本文件 → `.trae/memory/growth/handover.md` → `.trae/memory/growth/INDEX.md` → 今日 daily.md

---

## ③ 硬约束 15 条（编号铁律）

1. **版本号 5 落点同步**：改版本必须同时改 electron/backend/frontend/package.json + AGENTS.md + secrets.md + 云端 prod.db 两表（详见 secrets.md 检查清单）
2. **打包路径不能动**：electron-builder `extraResources from` 必须指向实际产物
3. **数据库初始化双校验**：`.db-version` hash **且** db 文件存在且非空
4. **LLM_API_KEY 不随安装包分发**：key 在云端 .env，别的电脑靠独立交付的 `llm.env` 放 userData/
5. **管理后台独立云端化**：`/admin/` 独立 HTML，express.static + SPA fallback
6. **内测两步走**：本机验证 → 用户确认 → 传云端生产
7. **远端下载走直连 IP**：`lujax.fun` SNI 封锁，必须 `https://47.116.59.141/...`
8. **回复大白话 + 极致简洁**：禁止套话废话，能 3 字别写 10 字
9. **Electron SHA256 必同步**：每次打包后 EXE SHA 会变，必须更新 SQLite `windows_releases` 表
10. **Android 发版走 android-auto-update SKILL**：版本号 3 处对齐 → vite build → cap sync → gradlew → SCP → seed
11. **动手前必须宣告 + 等用户确认**：例外：紧急修 bug 或用户说"不用确认"时可跳过，事后必须同步
12. **三模式 __BUILD_MODE__ 全覆盖**：desktop/mobile 用 cross-env；admin 必须硬 `define: { __BUILD_MODE__: JSON.stringify('admin') }`（2026-10-16 真 bug）
13. **用户偏好：全交给 AI + 大白话回复 + 只需确认**：AI 全权操作所有动作（跑命令、改代码、SSH 部署），用户只负责"确认/同意/好的"；回复必须大白话，不许套话废话技术术语堆砌（2026-10-17 用户明确要求）
14. **重要信息变更必须三处同步**：secrets.md + AGENTS.md + handover.md 任何一处变更，另外两处必须立刻跟上（pm2 进程名漂移就是反例）
15. **关键远程操作前必须先验证**：用户说"做过了"不代表真做了——`pm2 list` 查进程、`git ls-remote` 查仓库、curl health 查服务，必验

---

## ④ 用户行为偏好（AI 必须遵守）

| 偏好 | 执行 |
|---|---|
| AI 全权操作 | 所有命令/代码/SSH/浏览器 AI 自己干，用户只确认 |
| 大白话回复 | 禁止"执行上述验证动作"、"经比对验证结果"这类套话 |
| 任务进度编号 | 每次必须宣告 "N 个动作"，完成的标记 ✅ 带编号 |
| 新 AI 可立即接手 | 台账要精简 + 索引清晰 + 每日流水 |
| **前端简洁易懂** | UI 操作路径越短越好，按钮命名大白话，墨玉绿主题不变但交互要顺 |
| **后端先想再写** | 每个路由/Service 先想"是不是一定要写"，选最高效办法；能用 Prisma 原生就别写 raw SQL；能缓存就别重复查 |
| **联网学习借鉴** | 有问题先搜开源项目/最佳实践，不自己瞎造轮子 |

---

## ⑤ 质量基线 10 条

- ✅ TS strict 零错（前后端 `npx tsc --noEmit` 必须过）
- ✅ 后端 `npm run build` 通过（dist 启动 `/health` 200）
- ✅ 前端三模式 build 通过（desktop/mobile/admin）
- ✅ Prisma schema validate 通过
- ✅ `node smoke-all.mjs` 全过（41 路由前缀 + CRUD + 边界）
- ✅ Zod schema 校验全覆盖（输入 + refine）
- ✅ 新增页面注册三套路由（未登录/桌面端/移动端）
- ✅ 涉及协议隐私必须同步 TermsPage/PrivacyPolicyPage
- ✅ CORS OPTIONS 204 + ACAO 动态回显 + ACAC: true
- ✅ 不新增彩色（墨玉绿主题 brand #00856A，彩色占面 < 8%）

---

## ⑥ 云端运维速查

> 服务器 47.116.59.141 有**两套后端**：
> - **绿角犀 ERP**（pm2: `erp-backend`, MySQL `zhiyun_erp`, 端口 3000）
> - **绿角犀 APP**（Electron 内嵌，本地 SQLite，用户机器运行）

| 项 | 值 |
|---|---|
| SSH | `root@47.116.59.141` |
| 服务器后端目录 | `/root/erp/backend/`（有源码 + MySQL）|
| 服务器 ERP DB | MySQL `zhiyun_erp`（`releases` 表，appType=windows/android）|
| pm2 进程名 | `erp-backend`（**不是 backend！**） |
| pm2 端口 | **3000**（NestJS 监听，不是 3100！）|
| Electron 内嵌 DB | `%APPDATA%/aie-desktop/data/aie.db`（SQLite，首次启动空）|
| 本地开发 DB | `backend/prisma/dev.db`（Prisma 连接的实际路径，不是 backend/dev.db！）|
| 托管目录 | `/usr/share/nginx/html/apk/`（EXE + APK）|
| 更新 API | `GET /api/v1/app/windows-version?current=X.Y.Z` |

**必跑命令**：
```bash
# pm2 查/重启
pm2 list; pm2 restart erp-backend; pm2 logs erp-backend --lines 50
# MySQL 操作
mysql -uroot -p"ErpRoot2026@Sec" zhiyun_erp -e "SHOW TABLES LIKE '%release%'; SELECT * FROM releases ORDER BY id DESC LIMIT 5;"
# 公网验 EXE
curl -sI "http://47.116.59.141/apk/绿角犀-Setup-1.1.0.exe"
# Prisma 相对路径坑：prisma/dev.db 才是对的
sqlite3 backend/prisma/dev.db "SELECT version, setupSha256 FROM windows_releases"
```

---

## ⑦ 目录约定（关键）

```
APP-AIE/
├─ backend/              # Express + Prisma
│  ├─ src/routes/        # 40+ 路由文件
│  ├─ prisma/schema.prisma  # 58 表
│  └─ dist/              # tsc 编译产物
├─ frontend/             # React 前端
│  ├─ src/pages/         # ~40 页面
│  ├─ src/components/home/  # HomePage 子组件
│  ├─ src/components/pet/   # PetPage 子组件（PetGames.tsx）
│  ├─ src/components/library/ # LibraryPage 子组件（LibraryWidgets.tsx）
│  ├─ tailwind.config.js # brand/canvas/ink/surface 墨玉绿主题
│  └─ android/           # Capacitor 原生工程
├─ electron/             # Electron 壳
├─ sync-dist.ps1          # FE/BE dist 一键同步
├─ AGENTS.md             # ← 你正在读
└─ .trae/memory/growth/  # 台账（见 INDEX.md）
```

---

## ⑧ 台账体系（统一 growth/ 一套，无冗余）

所有台账文件统一在 `APP-AIE/.trae/memory/growth/` 下，**不再有第二套**。

| 文件 | 用途 | 什么时候查 |
|---|---|---|
| **handover.md** | 30 秒快照 + 启动命令 + 服务器 + 活跃坑 Top 5 | 接手第一读 |
| **issues.md** | Master 结构 bug 工单 + 独立踩坑快查 + 杂项铁律 | 改代码前查有没有类似坑 |
| **decisions.md** | 为什么选 A 不选 B | 做选择前看之前同类决策 |
| **secrets.md** | 🔐 重要信息集中表（版本号/账号/服务器/密钥路径）| 任何版本 bump、服务器操作、发版时查 |
| **INDEX.md** | 台账总索引（文件清单 + 快速跳转）| 想找东西时扫一眼 |
| **daily/** | 每日工作流水（只留最近 3 天，旧的进 archive/）| 接手上一个 AI 的活 |

### 台账维护铁律
- daily 超过 3 天 → 自动移入 archive/
- issues.md 的 Master 子条目 ≥ 3 条 → 自动升级 Master 级（P2→P1，P1→P0）
- secrets.md 变更 → 必须同步更新 AGENTS.md + handover.md（铁律 #14）

---

## ⑨ 任务追踪铁律（每次工作必做）

### 工作开始前
1. **宣告**：用大白话脑图或清单格式宣告 "这次要做 N 个动作"，每个动作带编号
2. **等确认**：用户点头后才能动手

### 工作进行中
3. **每完成一个动作**：标记 ✅ 带编号，大白话说 "X 号动作搞定了"
4. **遇到问题**：立刻停下说 "遇到 X 问题，有 Y 个选项，你选"

### 工作结束后
5. **汇总结账**：完整列出 N 个动作 + 完成几个 + 遇到什么问题 + 改了哪些文件
6. **自动写台账**：把工作总结追加到今日 daily.md

**示例格式**：
```
这次要做 6 个动作：
① 合并台账 ✅ → 搞定
② 更新 secrets.md ✅ → 搞定
③ 任务追踪机制 ✅ → 现在做
④ 升级 AGENTS.md ⏳ → 下一个
⑤ 更新 INDEX.md ⏳
⑥ 新 AI 接手测试 ⏳
```
