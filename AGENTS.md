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

## ③ 硬约束 12 条（编号铁律）

1. **版本号三落点同步**：改版本必须同时改 electron/package.json、backend/package.json、前端 5 处硬编码
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

---

## ④ 质量基线 10 条

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

## ⑤ 云端运维速查

| 项 | 值 |
|---|---|
| SSH | `root@47.116.59.141` |
| 后端目录 | `/root/backend/` |
| 生产库 | `/root/backend/prisma/prod.db`（**SQLite！** 不是 MySQL）|
| pm2 | `backend`（端口 3100，仅监听 127.0.0.1）|
| nginx SSL | greenrhino-cloud-ssl.conf（443 default_server）|
| nginx HTTP | erp-web.conf（80，手机端必须走 HTTP 绕过证书问题）|
| 托管目录 | `/usr/share/nginx/html/apk/`（EXE + APK）|
| Admin 静态 | `/root/backend/public/admin/` |
| 更新路径 | `GET /api/v1/app/windows-version?current=X.Y.Z` |

**必跑命令**：
```bash
# 查 pm2
pm2 list; pm2 restart backend; pm2 logs backend --lines 100
# SQLite 操作
sqlite3 /root/backend/prisma/prod.db ".tables"          # 先看表名！
sqlite3 /root/backend/prisma/prod.db "SELECT username, role FROM users"
# CORS 验
curl -sv -X OPTIONS -H "Origin: http://localhost" -H "Access-Control-Request-Method: POST" http://47.116.59.141/api/v1/auth/login
```

---

## ⑥ 目录约定（关键）

```
APP-AIE/
├─ backend/              # Express + Prisma
│  ├─ src/routes/        # 40+ 路由文件
│  ├─ prisma/schema.prisma  # 58 表
│  └─ dist/              # tsc 编译产物
├─ frontend/             # React 前端
│  ├─ src/pages/         # ~40 页面
│  ├─ src/components/home/  # HomePage 子组件（墨玉绿主题）
│  ├─ tailwind.config.js # brand/canvas/ink/surface 墨玉绿主题
│  └─ android/           # Capacitor 原生工程
├─ electron/             # Electron 壳
├─ sync-dist.ps1          # FE/BE dist 一键同步
├─ AGENTS.md             # ← 你正在读
└─ .trae/memory/growth/  # 台账（见 INDEX.md）
```

---

## ⑦ 台账体系（精简）

- **handover.md**：30 秒快照 + 启动命令 + 账号 + 服务器 + 活跃坑 Top 5 + 快速验证
- **INDEX.md**：台账总索引（文件清单 + 快速跳转 + 维护规则）
- **pitfalls.md**：所有踩过的坑（永不归档）
- **decisions.md**：为什么选 A 不选 B
- **daily/**：每日流水（只留最近 3 天，旧的进 archive/）
- **issues.md**：bug 工单
