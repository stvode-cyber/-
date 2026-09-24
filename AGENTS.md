# AGENTS.md — 绿角犀项目全局规则

> 所有 AI 员工共享。任何 agent 入场前必须先读。

## 项目身份

**绿角犀（AIE）** —— 桌面端优先的全能个人助理。Electron 壳 + React 前端 + Express/Prisma 后端，本地 SQLite 数据库。云端（47.116.59.141）为可选 AI 网关和多用户身份签发方。

- 版本：1.0.6（2026-09-19）
- 主入口：`electron/release-v16/win-unpacked/绿角犀.exe`
- 本地后端端口：3001
云端后端端口：3100（Node 监听 127.0.0.1，公网 3001 由 socat 转发 + nginx 443 proxy 3100）
- 前端 dev：`cd frontend && vite` → http://127.0.0.1:5173/

## 台账铁律（每次新对话第一动作，强制执行）

**入场后必须先 Invoke work-growth-logger Skill**（位于 `.trae/skills/work-growth-logger/SKILL.md`），并行 Read 以下台账文件：

1. `.trae/memory/growth/handover.md`      ← 当前状态 + 远程资源 + 铁律（30 秒接手）
2. `.trae/memory/growth/pitfalls.md`      ← 踩过的坑（8 条：5 P0 / 3 P1，持续积累）
3. `.trae/memory/growth/decisions.md`     ← 关键决策（7 条 active）
4. `.trae/memory/growth/daily/YYYY-MM-DD.md` ← 当日流水（改了啥 + 踩了啥坑）
5. `%USERPROFILE%/.trae-cn/memory/shared-issues.md`    ← 跨项目通用坑（10 条 GS-001~010）
6. `%USERPROFILE%/.trae-cn/memory/shared-decisions.md` ← 跨项目通用决策（9 条 G-Dc-001~009）

读完后**主动用 3-6 条 bullet 贴出提醒**：当前版本 + 进行中任务 + P0/P1 历史坑 + 硬性规则摘要。等用户反馈后再开始处理新需求。

**改文件前强制扫坑**：准备编辑/运行任何具体文件前，必须 Grep pitfalls.md 里的路径匹配，命中历史坑就用 🚨 格式提醒后再动手。

**防失忆双铁律**（work-growth-logger 核心规则）：
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

8. **回复用大白话**：不说"该方案已验证完毕"、"综上所述"这种套话。直接说"搞定了"、"这里踩了个坑"、"下一步你要拍板一下"。代码和命令输出保持原样，但**给人看的解释性文字全用大白话**，能省就省。

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

