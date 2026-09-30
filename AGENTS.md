# AGENTS.md — 绿角犀项目全局规则

> 所有 AI 员工共享。任何 agent 入场前必须先读。

## 项目身份

**绿角犀（AIE）** —— 桌面端优先的全能个人助理。Electron 壳 + React 前端 + Express/Prisma 后端，本地 SQLite 数据库。云端（47.116.59.141）为可选 AI 网关和多用户身份签发方。

- 版本：1.0.6（2026-09-19）
- 主入口：`electron/release-v16/win-unpacked/绿角犀.exe`
### 产品面 × 端口（**总共 3 个前端端口 + 1 个后端端口**）

**核心设计**：后端永远是 1 个端口（不管本地还是云端），前端有 3 个独立产品面各占 1 个 Vite dev server。

#### 本地开发端口

| 端口 | 产品面 | 谁用 | 双格式 | 配置 |
|---|---|---|---|---|
| **5173** | **电脑端** | 普通用户（桌面壳） | ✅ 网页 + Electron EXE | `vite.config.ts`（DesktopLayout 深色侧边栏） |
| **5174** | **手机端** | 普通用户（手机 App） | ✅ 网页 + Capacitor APK | 应独立 `mobile-vite.config.ts`（Layout 底部 TabBar） |
| **5175** | **运营管理** | 运营/开发团队 | ✅ 网页 + 内部链接 | `admin-vite.config.ts`（AdminLayout 绿色侧边栏） |
| **3001** | **后端 API** | 上面三个都调 | — | `backend` Express + Prisma |

#### 云端端口（47.116.59.141）

| 端口 | 谁 | 说明 |
|---|---|---|
| **443** | Nginx HTTPS（用户唯一入口） | `/api/v1/*` → 3100；`/admin` → express.static；`/apk/*` → EXE 静态文件 |
| **3100** | pm2 `aie-backend`（后端 Node） | 只监听 `127.0.0.1`，Nginx 反代它 |
| **80** | Nginx HTTP → 443 301 | — |

#### 三个产品面的关系

```
        ┌──── 5173 电脑端 ────┐
        │  普通用户 · 桌面壳    │
        │  DesktopLayout        │
        └────────┬──────────────┘
                 │ HTTPS /api/v1/*
        ┌────────▼──────────────┐
        │   3001 后端 Express    │
        │   Prisma + SQLite     │
        └────────┬──────────────┘
                 │ HTTPS /api/v1/*
        ┌────────▼──────────────┐
        │ 5174 手机端  │ 5175 运营管理 │
        │ 普通用户     │ 运营/开发团队 │
        │ Layout 底部   │ AdminLayout   │
        │ Capacitor    │ 独立网页      │
        └──────────────┘└────────────┘
```

#### 关键区别（电脑 vs 手机 vs 运营）

| 维度 | 5173 电脑端 | 5174 手机端 | 5175 运营管理 |
|---|---|---|---|
| 外壳组件 | DesktopLayout（深色侧边栏 w-56） | Layout（底部 TabBar 4 项） | AdminLayout（绿色侧边栏 w-56） |
| 打包方式 | electron-builder → Setup.exe + Portable | Capacitor → APK | 不打包，静态 HTML/CSS/JS 托管 |
| 访问 URL | http://localhost:5173 | http://localhost:5174 | http://localhost:5175 |
| 云端挂载 | Electron 内置（`resources/frontend/dist`） | Capacitor 内置 | express.static `/root/backend/public/admin/` |
| 路由前缀 | `/` | `/` | `/admin/`（admin-vite `base` 选项） |

#### Dev Server 启动四件套（后端 + 3 前端各占 1 端口）

```bash
# 后端（先跑这个，三个前端都调它）
cd backend && npm run dev              # → http://127.0.0.1:3001

# 电脑端（桌面壳开发调试 · 深色侧边栏 DesktopLayout）
cd frontend && npm run dev             # → http://localhost:5173

# 手机端（Capacitor APK 开发 · 底部 TabBar Layout）
cd frontend && npm run dev:mobile      # → http://localhost:5174

# 运营管理（独立网页 · 绿色侧边栏 AdminLayout）
cd frontend && npm run dev:admin       # → http://localhost:5175/admin/
```

#### 三个产品面的构建 & 打包

| 产品面 | Vite config | Dev 端口 | build 产物 | 打包工具 | 目标格式 |
|---|---|---|---|---|---|
| **电脑端** | `vite.config.ts` | 5173 | `dist/` | electron-builder | Setup.exe + Portable |
| **手机端** | `mobile-vite.config.ts` | 5174 | `mobile-dist/` | Capacitor | APK |
| **运营管理** | `admin-vite.config.ts` | 5175 | `admin-dist/` | 不打包（静态托管） | 网页 |

**编译常量 `VITE_BUILD_MODE`**：npm script 里用 `cross-env VITE_BUILD_MODE=desktop/mobile` 设进程环境变量。App.tsx 里用 `import.meta.env.VITE_BUILD_MODE === 'desktop'` 条件渲染路由块——**编译时剪枝**（Vite build 替换为字面量）+ **dev 运行时也生效**（Vite dev server 自动注入 `import.meta.env` 对象）。桌面产物不包含 Layout 底部 TabBar 路由代码，手机产物不包含 DesktopLayout 侧边栏代码。

> **为什么不用 `define`？** Vite 的 `define` 只在 Rollup build 时替换常量为字面量，dev server 用 esbuild transform 不碰它，dev 模式下 `__BUILD_MODE__` 原样留着会 ReferenceError。`cross-env` + `import.meta.env` 方案 dev 和 build 都生效。
>
> **废弃方案**：试过 `envFile: '.env.desktop'` + `.env.mobile` 配在 vite.config.ts——Windows + PowerShell 环境下 Vite `loadEnv` 返回空数组（原因不明）。废弃不用。
>
> **废弃方案 2**：PowerShell `Out-File -Encoding UTF8` 写 env/JSON 文件会加 BOM（EF BB BF），Node JSON.parse 报 `Unexpected token '﻿'`。统一用 `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))` 写无 BOM UTF8。

Capacitor 打包前先跑：`npm run build:mobile && npx cap sync android && npx cap build android`

Electron 打包前先跑：`npm run build && npm run build:backend && node electron/build-desktop.cjs`

## 对话收尾铁律（用户说"好的，执行吧"或显式结束对话前必做）

### 收尾三动作（强制执行，缺一不可）

**1. 回复贴本轮总汇**：在回复末尾追加一个简洁的完成清单，格式如下：
```
## 📋 本轮完成清单

✅ 做了什么（1-5 条，大白话）
❌ 发现什么（如果有 bug 发现，附根因）
🔧 修了什么（附 commit SHA，如果有）
📁 改了哪些文件（路径列表）
```
- 大白话，不用专业术语堆砌
- 做了啥就说啥，别虚报

**2. 台账同步（不等对话结束，改完立刻写）**：
- daily 流水追加一行：`[HH:MM] 动作简述 · 结果 · 文件/commit SHA`
- 新踩坑 → pitfalls.md 追加新条目（含路径 + 现象 + 根因 + 解法）
- 修复 bug → daily + pitfalls 都记（daily 写结果，pitfalls 写坑细节）

**3. Git 状态确认 + commit（如果有改动未提交）**：
- `git status --short` 看脏文件
- 分 1-2 个 commit（代码一个，文档/台账一个）
- commit message 格式：`<type>(<scope>): <中文或英文简述>`

### 台账格式（daily.md 每条）

```
[14:30] 后端 pm.routes.ts 加 admin 旁路 · tsc 零错 · commit abc123
[14:35] 服务器 scp dist + pm2 restart aie-backend · online · https 401 ✅
[15:02] 🚨 pitfall: PowerShell heredoc 在 SSH 引号嵌套必炸 → 改用 .sh 文件 scp 上去
[15:30] 🐛 真 Bug: ZodError 全局 handler 没接 → 加 instanceof 判断返回 422 · commit de8b142
```

## 台账铁律（每次新对话第一动作，强制执行）

### 入场动作（必做）

**入场后必须先 Invoke work-growth-logger Skill**（位于 `.trae/skills/work-growth-logger/SKILL.md`），并行 Read 以下台账文件：

1. `.trae/memory/growth/handover.md`      ← 当前状态 + 远程资源 + 铁律（30 秒接手）
2. `.trae/memory/growth/pitfalls.md`      ← 踩过的坑（持续积累）
3. `.trae/memory/growth/issues.md`        ← 问题工单（bug/issue 生命周期追踪）
4. `.trae/memory/growth/decisions.md`     ← 关键决策
5. `.trae/memory/growth/daily/YYYY-MM-DD.md` ← 当日流水（改了啥 + 踩了啥坑）
6. `%USERPROFILE%/.trae-cn/memory/shared-issues.md`    ← 跨项目通用坑
7. `%USERPROFILE%/.trae-cn/memory/shared-decisions.md` ← 跨项目通用决策

读完后**主动用 3-6 条 bullet 贴出提醒**：当前版本 + 进行中任务 + P0/P1 历史坑 + 硬性规则摘要。等用户反馈后再开始处理新需求。

### 每个动作前的台账前置（强制执行）

**任何实际操作前必须先 Grep/Read 对应台账**，命中历史坑就用 🚨 格式提醒后再动手：

| 动作类型 | 前置检查 | 台账 |
|---|---|---|
| **读/改源码** | Grep pitfalls.md 里的文件路径匹配 | pitfalls.md + decisions.md |
| **跑后端命令** (`npm run build` / `pm2`) | Grep pitfalls.md + handover.md 的运维章节 | pitfalls.md (GS-001~010) |
| **Prisma 操作** (`db push` / `generate`) | Grep pitfalls.md 里的 "prisma" / "schema" 条目 | pitfalls.md |
| **SSH 远程操作** | Read handover.md 完整远程章节（端口/路径/命令） | handover.md |
| **API 调远端** | Grep decisions.md 里的 "baseURL" / "代理" / "auth" 条目 | decisions.md |
| **部署/发版** | 读 STATUS.md 当前版本 + 查 github 上最新 commit SHA | STATUS.md + pitfalls.md |
| **新增路由/API** | Grep decisions.md 里的 "路由前缀" / "admin 独立" 条目 | decisions.md |
| **修改 schema** | 查当日 daily.md 是否已记录过 schema 变更（避免重复 ALTER） | daily/YYYY-MM-DD.md |

**台账没写、找不到、不知道在哪 → 先查 git log / 文件搜索 → 查完再动手，不能跳过。**

### 每个动作后的台账同步

**任何涉及文件改动、远程操作、数据库变更的动作，完成后立刻**（不等对话结束）：

1. 追加 `.trae/memory/growth/daily/YYYY-MM-DD.md` 一行：`[HH:MM] 动作简述 · 结果 · 文件/commit SHA`
2. 远程操作（SSH / pm2 / SCP / GitHub push）额外更新 handover.md 里的"远程资源"章节
3. 新踩坑 → 追加 pitfalls.md 新条目（含路径 + 现象 + 根因 + 解决方案）
4. **修了真 bug / 用户反馈线上问题 → 追加 issues.md 新工单**（含问题描述 · 影响范围 · 根因 · 解决方案 · 验证方式 · commit SHA）

### 台账格式（daily.md 每条）

```
[14:30] 后端 pm.routes.ts 加 admin 旁路 · tsc 零错 · commit abc123
[14:35] 服务器 scp dist + pm2 restart aie-backend · online · https 401 ✅
[15:02] 🚨 pitfall: PowerShell heredoc 在 SSH 引号嵌套必炸 → 改用 .sh 文件 scp 上去
```

### 问题工单格式（issues.md 每条）

```markdown
## [P0][IS-001] ZodError 全局 handler 漏接

- **发现**：YYYY-MM-DD HH:mm · 场景描述
- **状态**：✅ fixed / 🐛 open / 🔧 fixing
- **问题**：一句话说清楚出了什么问题
- **影响范围**：哪些路由/页面/用户会中招
- **根因**：为什么会出这个问题
- **解决方案**：具体改了什么
- **验证**：怎么证明修好的（curl 命令 / HTTP 码 / 对比截图）
- **commit**：sha · message
- **关联台账**：daily 日期 + pitfalls 条目号
```

**什么时候记 issues.md**：
- 修了真 bug（不是临时 workaround）→ daily 写结果 + pitfalls 写坑细节 + **issues 写工单**
- 用户反馈的线上问题复现并修复 → issues 必记
- 一次操作踩 2 个以上坑 → issues 合并记录（避免 daily 太碎）
- 纯代码重构/优化（无 bug）→ 不用记 issues，daily 提一行就行

### 防失忆双铁律（work-growth-logger 核心规则）

1. **关键操作前先查记录**：`git ls-remote` / API 查 / `pm2 list`，查到才算做过
2. **关键操作后立刻同步**：别等对话结束，改完远程资源（服务器/仓库/数据库）立刻追加 handover.md + daily

## 技术栈速查

| 层 | 技术 | 版本 |
|---|---|---|
| 桌面壳 | Electron | 43 |
| 前端 | React + TypeScript + Vite | React 18 / Vite 5 |
| 状态管理 | Zustand | 4 |
| 路由 | React Router | 6 |
| 后端 | Express + TypeScript | Node 22 |
| ORM | Prisma | 5 |
| 数据库 | SQLite | - |
| 安全 | JWT (RS256) + CSP + sandbox | - |
| LLM | SiliconFlow (DeepSeek-V3) | - |
| 打包 | electron-builder | - |

## 目录约定

```
APP-AIE/
├─ backend/                  # Express + Prisma 后端
│  ├─ src/routes/            # 39 路由文件（含 /api/v1/app/windows-version 桌面端更新检查）
│  ├─ src/services/          # llmService / agentCore / contextCollector
│  ├─ prisma/schema.prisma   # User / Conversation / VaultNote / WindowsRelease 等 51 表
│  └─ dist/                  # tsc 编译产物（打包进 resources/backend）
├─ frontend/                 # React 前端
│  ├─ src/pages/             # 约 40 个页面
│  ├─ src/pages/settings/    # 10 个设置子页
│  ├─ src/stores/            # auth / chat / task 等 zustand stores
│  └─ dist/                  # vite build 产物（打包进 resources/frontend）
├─ electron/                 # Electron 主进程 + 打包
│  ├─ main.js                # BrowserWindow + spawn 后端
│  ├─ build-desktop.cjs          # 一键构建脚本
├─ sync-dist.ps1              # FE/BE dist 一键同步（三层时间戳验证）
├─ gate-check.ps1             # 发版启动闸 7 项自动门禁
├─ seed-windows-release.ps1   # 发版后 SCP EXE + seed 后端 windows_releases 表 + 公网 API 回查
│  ├─ resources/              # 打包输入（frontend/dist + backend/dist 复制到这里）
│  └─ release-v16/           # 最新打包产物
└─ .trae/
   ├─ agents/                # AI 员工（Subagent）
   ├─ skills/                # 员工操作手册（本地 Skill 需 workspace reload 才被 Skill tool 识别）
   └─ documents/             # 历史方案文档
```

## 硬约束（所有 agent 必须遵守）

1. **版本号三落点同步**：改版本必须同时改 `electron/package.json`、`backend/package.json`、前端 5 处硬编码显示字符串。

2. **打包路径不能动**：electron-builder `extraResources` 的 `from` 路径必须指向**实际产物所在目录**。历史 bug：写了 `resources/frontend/dist` 但 build-desktop.cjs 把前端直接复制到 `resources/frontend/` → 白屏。

3. **数据库初始化必须双校验**：全新首启从 `resources/backend/prisma/dev.db` 复制模板 → 校验 `.db-version` hash **且** db 文件存在且非空 → 不能只校验 hash。

4. **LLM_API_KEY 不随安装包分发**：打包版用 `AUTH_MODE=cloud-proxy`，key 在云端 .env。别的电脑启用 AI 靠独立交付的 `llm.env` 放 `userData/` 目录。

5. **管理后台独立云端化**：`/admin/` 路由已从主 APP 剥离为独立 HTML，后端托管用 `express.static + SPA fallback`，不能吞 `/api/v1/*`。

6. **内测两步走**：任何功能改动先本机验证通过，再等用户确认后才能上传云端生产环境。

7. **远端下载走直连 IP**：`lujax.fun` 域名因 SNI 封锁不可用，安装包分发必须用 `https://47.116.59.141/apk/`。

8. **回复大白话 + 极致简洁**（违反直接不合格）：
   - 禁止套话：不说"该方案已验证完毕"、"综上所述"、"经过仔细分析"、"值得一提的是"
   - 直接说事："搞定了"、"这里踩了个坑"、"下一步你拍板"、"有个问题要确认"
   - 能用 3 字别写 10 字："OK" > "好的已经成功完成了"；"要改" > "这里需要进行修改"
   - 表格/代码块保留原样，**只有解释性文字砍到最短**
   - 禁止"感谢您的提问"、"希望这个回答对你有帮助"这类结尾废话
   - AI 自己加的 emoji 也别乱塞，除非确实需要

9. **Electron SHA256 必同步**：每次 electron-builder 重新打包后，EXE 的 SHA256 会变（Electron 每次打包产物 SHA 不固定），必须立刻 `sha256sum /usr/share/nginx/html/apk/*.exe` + 更新 SQLite `windows_releases` 表。否则客户端校验 SHA 对不上。

## 质量基线

- TypeScript strict 零错误
- 后端 `npm run build` 通过
- 前端 `npm run build` 通过（无 ESLint error、无 TS error）
- `prisma db push` 不破坏已有数据
- 新增路由必须有 zod schema 校验（输入 + refine）
- 新增页面必须注册三套路由（未登录 / 桌面端 / 移动端）
- 涉及用户协议/隐私的改动必须同步更新 TermsPage / PrivacyPolicyPage

## 云端运维速查

- SSH：`root@47.116.59.141`
- 后端目录：`/root/backend/`
- 生产库：`/root/backend/prisma/prod.db`（**SQLite**，不是 MySQL！更新用 `sqlite3 prod.db < update.sql`）
- GitHub：`git@github.com:stvode-cyber/-.git`（仓库名是短横线，SSH key 在 C:\Users\Administrator\.ssh\id_rsa）
- PM2：`pm2 aie-backend`（restart / logs，Node 监听 127.0.0.1:3100）
- 后端在线更新 API：`GET /api/v1/app/windows-version?current=X.Y.Z`（Prisma WindowsRelease model 数据源）
- Nginx：`/etc/nginx/conf.d/greenrhino-cloud-ssl.conf`（443 location /apk/ 托管安装包 → `root /usr/share/nginx/html`，实际路径 `/usr/share/nginx/html/apk/`；location / proxy_pass 3100 API）
- EXE 托管目录：`/usr/share/nginx/html/apk/`（两个中文文件名 + 两个软链接：`lvjiaoxi-setup-1.0.6.exe` → `绿角犀-Setup-1.0.6.exe`）
- EXE 传服务器：本地 `scp "electron/release-v*/绿角犀-*.exe" root@47.116.59.141:/usr/share/nginx/html/apk/`
- 更新 SHA256：服务器 `sha256sum /usr/share/nginx/html/apk/绿角犀-Setup-1.0.6.exe` → 写临时 SQL → `sqlite3 prod.db < update.sql`
- 公网 API：`https://47.116.59.141/api/v1/app/windows-version?current=X.Y.Z`（返回最新桌面版本 + 下载链接 + SHA256）
- 备份：本地 `D:\源码存档\助理项目\服务器存档\prod-db-备份\`

## 交接文档（AI 接手必读，从这里开始）

> **任何新 AI 入场，读完 AGENTS.md 立即 Read 下面这份。** 接手即懂，覆盖项目结构、发版流水线、服务器状态、踩过的坑、命令速查。

- 🌟 **AI 交接工作明细（v1.0.6）**：`06_审查与交接/AI交接工作明细-v1.0.6.md` ← **先读这个**（12 章节，接手即懂）
- 工程全量记录：`06_审查与交接/交接记录.md`
- 变更日志：`CHANGELOG.md`
- 状态汇总：`STATUS.md`
- 方案存档：`.trae/documents/`

