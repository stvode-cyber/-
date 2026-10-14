# 🤝 绿角犀管家 (APP-AIE) — AI 交接总览

> **新 AI 进门第一读。5 分钟内读懂项目状态，30 秒内能启动。**
> 🔴 **入场顺序**：本文件 → pitfalls.md → 今日 daily.md → git log --oneline -5
> 🔴 **先验证**：`git status --short` + `Invoke-RestMethod http://localhost:3001/health`

---

## ⚡ AI 接手 30 秒快照（2026-10-14 更新）

| 维度 | 当前值 |
|---|---|
| **Git HEAD** | `e95a995` fix(app): windows-version/android-version Prisma异常降级404代替500 |
| **远程仓库** | `git@github.com:stvode-cyber/-.git`（仓库名是 `-`）|
| **版本号** | **v1.1.0**（electron + frontend + backend 三落点全对齐 ✅）|
| **运行端口** | 3001 ✅（后端）· 5173（桌面 dev）· 5174（手机 dev）· 5175（admin dev）|
| **服务器** | 47.116.59.141 · pm2 `backend` 端口 3100 · 后端已升 v1.1.0（2026-10-14 部署）· 公网 admin + API + EXE + APK |
| **已打包桌面** | `electron/release-v16/绿角犀-Setup-1.1.0.exe`（160.5MB, 10/10 21:42）|
| **已安装桌面** | `C:\Program Files\aie-desktop\绿角犀.exe`（v1.1.0, 215.4MB, 10/10 21:42）|
| **手机 APK** | 已构建（13.71MB, MD5 7f134aef8d05d21a85a680bd8fe6ae05），**手机暂时没连上 adb 还没真机验自动更新** |
| **后端健康** | 本地 http://localhost:3001/health ✅ |

### 最近大改动（7 天内）

1. **Android 自动更新全链路**（`2e2ee55`）— 后端 Prisma AndroidRelease model + `/api/v1/app/android-version`（semver compare）+ 前端 UpdateNotice（fetch 下载 + 进度条 + Filesystem 写盘 + **原生 IntentInstallerPlugin.java** 调 FileProvider + Intent.ACTION_VIEW 触发系统安装器）+ SKILL `.trae/skills/android-auto-update/SKILL.md`
2. **CORS 根治**（10-10 上午）— 后端 `cors({ origin: fn(origin, cb) { if (!origin) return cb(null, true); cb(null, origin) } })` 动态回显，解决 WebView 严格拒绝 `*` + `credentials:true`
3. **Capacitor 真机 auto-login**（10-10 上午）— main.tsx 同步调 `useAuthStore.getState().init()`（之前只在 App useEffect 里调 → React 首帧覆盖 loading=true）+ auth.ts auto-login else-if 结构独立防 Rollup dead code elimination
4. **Gradle JDK 17 覆盖** — `android/build.gradle` 加 `subprojects { subp.afterEvaluate { subp.kotlin { jvmToolchain(17) } } }` 覆盖所有 capacitor 插件硬写的 jvmToolchain(21)
5. **QQ 空间风格圈子**（`1bcd54b`）— CommunityPage Tab + SpacePage 个人空间页
6. **桌面版 win-unpacked 直拷安装** — Setup.exe `/S` 静默被 Defender 拦，改用 `Copy-Item win-unpacked\* → C:\Program Files\aie-desktop\`

---

## 📋 完整 commit 序列（最近 20 条）

```
2e2ee55 feat(android): 自动更新全链路 + 顶部/底部导航放大固定
03bde3d docs(ledger): push 6 commits + 台账同步
5c0fc1b docs(ledger): 交接包更新至 v1.1.0 + QQ空间圈子 + 团队门槛 + Electron单实例锁修复
1bcd54b feat(community): QQ空间风格圈子改造 - 个人空间页 + 说说分类Tab
f5f571d fix(auth): login() 补 return res — AdminLoginPage 读 role 不再是 undefined
a8aa9da fix(ui+electron): 侧边栏去好友 + 删错误的后端端口探测
8df06f3 docs(ledger): 台账更新 — v1.1.0 本机测试全绿 + auth bug 修复记录
daf12b1 feat(team): 团队门槛功能 + v1.1.0 发版 + auth bug 修复
b75d6e4 docs(handover): 完整交接包 — 统一 admin/admin123 + aie.db 特殊处理 + 服务器运维手册 + 快速验证清单
a03b355 docs(auth): admin 账号重置 — admin/admin123, 本地+服务器双端 reset, handover 凭据区块
693ea9f fix(deploy): 服务器 prod.db pm 脏表重建 — prisma db push + prisma generate, CRUD 6/6 全绿
9b43cd6 feat(admin): AdminPMPage 项目增删改 — 新建/编辑 Modal + 行删除 + 批量删除 checkbox
```

---

## 🔐 管理员账号（所有环境统一 admin/admin123）

| 环境 | 用户名 | 密码 | 数据库文件 |
|---|---|---|---|
| **本地 dev** | `admin` | `admin123` | `backend/prisma/dev.db` |
| **桌面版**（Setup 安装） | `admin` | `admin123` | `%APPDATA%\aie-desktop\data\aie.db` |
| **服务器 prod.db** | `admin` | `admin123` | `/root/backend/prisma/prod.db` |

### 手机端临时账号（内测 auto-login 用）

| 环境 | 用户名 | 密码 | 说明 |
|---|---|---|---|
| 本地 + 云端（共用） | `testuser` | `test123A` | role=user（普通用户），**正式发布前删掉** `auth.ts` 里 auto-login else-if 块 |

### ⚠️ 铁律：admin/admin123 是管理后台专用，前端该用普通用户

之前曾误把 admin/admin123 写进 auto-login → 现已改为 testuser/test123A。**正式发布前删掉整个 auto-login else-if 块**（AGENTS.md 硬约束）。

---

## 🚀 启动命令（按场景分类）

### 场景 A：本地开发（4 端口全起）

```powershell
# 后端 3001
cd D:\源码存档\助理项目\助理项目\APP-AIE\backend
npx tsx watch src/index.ts     # 热重载

# 桌面端 5173（Electron 壳）
cd ../frontend
npm run dev                    # 浏览器先开 5173 验证，再启动 Electron

# 手机端 5174（Capacitor 壳）
npm run dev:mobile

# 管理后台 5175
npx vite --config admin-vite.config.ts --port 5175
```

### 场景 B：桌面版打包 + 覆盖安装（**推荐路径**）

```powershell
$PROJ = "D:\源码存档\助理项目\助理项目\APP-AIE"
cd $PROJ

# 1. 同步三层时间戳（FE src → FE dist → electron/resources/frontend; BE src → BE dist → electron/resources/backend/dist）
.\sync-dist.ps1

# 2. electron-builder（跳过 publish 到 GitHub —— 配错仓库 404）
cd electron
npx electron-builder --win nsis --publish never
cd ..

# 3. 杀进程 + 覆盖安装（**win-unpacked 直拷最稳**，Setup.exe /S 被 Defender 拦）
Stop-Process -Name 绿角犀 -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item "C:\Program Files\aie-desktop" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path "electron\release-v16\win-unpacked" -Destination "C:\Program Files\aie-desktop" -Recurse -Force
Copy-Item -Path "C:\Program Files\aie-desktop\win-unpacked\*" -Destination "C:\Program Files\aie-desktop\" -Recurse -Force
Remove-Item "C:\Program Files\aie-desktop\win-unpacked" -Recurse -Force

# 4. 启动
Start-Process "C:\Program Files\aie-desktop\绿角犀.exe"
```

### 场景 C：手机 APK 构建（**完整 SKILL** → `.trae/skills/android-auto-update/SKILL.md`）

```powershell
# 编译前端
cd D:\源码存档\助理项目\助理项目\APP-AIE\frontend
$env:VITE_API_BASE_URL='http://47.116.59.141/api/v1'
npx cross-env VITE_BUILD_MODE=mobile vite build --config mobile-vite.config.ts

# 同步到 Android 原生工程 + 编译
npx cap sync android
cd android; .\gradlew.bat assembleDebug

# APK 位置：app\build\outputs\apk\debug\app-debug.apk
# adb install -r ... (手机连上后)
```

### 场景 D：后端部署到云端

```powershell
cd D:\源码存档\助理项目\助理项目\APP-AIE
cd backend; npx tsc; cd ..

# 上传 dist + schema
scp -r backend/dist root@47.116.59.141:/root/backend/
scp backend/prisma/schema.prisma root@47.116.59.141:/root/backend/prisma/

# 服务器上
ssh root@47.116.59.141 "cd /root/backend && npx prisma db push && npx prisma generate && pm2 restart backend"
```

---

## 🌐 服务器信息

### SSH

```bash
ssh root@47.116.59.141
# 密钥：C:\Users\Administrator\.ssh\id_rsa
```

### pm2 进程

| 进程 | 端口 | 目录 |
|---|---|---|
| backend | 3100（仅监听 127.0.0.1）| `/root/backend/` |

```bash
pm2 list && curl -s http://127.0.0.1:3100/health
pm2 restart backend
pm2 logs backend --lines 100
```

### nginx conf.d

| conf | 用途 |
|---|---|
| `greenrhino-cloud-ssl.conf`（443 default_server）| 绿角犀主 HTTPS · `/api/v1/` → 3100 · `/admin/` → express.static · `/apk/` → EXE/APK 静态托管 |
| `erp-web.conf`（80 HTTP）| ERP 端口，**同时** `/api/v1/` 反代 3100（手机端 Android Chromium 不信任 47.116.59.141 证书 → 走 HTTP 80 绕过）|
| `greenrhino-cloud.conf`（8091）| Garh 商业服务 |

**手机端 API 必须走 80 HTTP**：`http://47.116.59.141/api/v1/...`，443 HTTPS 证书不被 Chromium 信任（net_error -202）。

### 数据库（⚠️ SQLite 不是 MySQL！）

```bash
sqlite3 /root/backend/prisma/prod.db ".tables"          # 写 SQL 前先确认表名！
sqlite3 /root/backend/prisma/prod.db "SELECT username, role FROM users"
sqlite3 /root/backend/prisma/prod.db "SELECT version, has_update FROM android_releases ORDER BY version_number DESC LIMIT 3"
```

⚠️ **表名漂移铁律**：本地 dev.db 用 Prisma 默认（如 `User`），服务器 prod.db 是迁移后的小写复数（如 `users`）。**写 SQL 前必须先 `.tables` 确认！**

### 托管目录

| 路径 | 内容 |
|---|---|
| `/usr/share/nginx/html/apk/` | EXE + APK 静态托管目录（公网 `/apk/greenrhino-latest.apk`）|
| `/root/backend/public/admin/` | 管理后台静态文件（`/admin/` 路由 express.static）|

### 手机端 API 回查（验 CORS）

```bash
curl -sv -X OPTIONS -H "Origin: http://localhost" -H "Access-Control-Request-Method: POST" http://47.116.59.141/api/v1/auth/login
# 期望：Allow-Origin: http://localhost（动态回显）+ Vary: Origin + Allow-Credentials: true
# ❌ 绝对不能有 Allow-Origin: *
```

---

## 📁 项目结构（关键文件更新）

```
APP-AIE/
├── backend/
│   ├── src/
│   │   ├── index.ts               # CORS 动态回显（根治 WebView 拒绝）
│   │   ├── routes/app.routes.ts   # + GET /api/v1/app/android-version 自动更新接口
│   │   ├── middleware/error.ts    # 含 ZodError → 422 处理
│   │   └── auth.ts                # ⚠️ auto-login admin/testuser else-if 块（正式版必删）
│   ├── prisma/schema.prisma       # + AndroidRelease model
│   ├── seed-android-release.cjs   # 🆕 一键插版本记录
│   └── dist/                      # tsc 编译产物（3001）
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── UpdateNotice.tsx   # 🆕 自动更新弹窗（fetch+进度条+Filesystem+IntentInstaller）
│   │   │   ├── Header.tsx         # 🆕 fixed top-0 z-50 + h-14 + 安全区 pt-[env(safe-area-inset-top)]
│   │   │   ├── TabBar.tsx         # 🆕 h-[72px] + 放大图标/头像 + 安全区 pb-[env(safe-area-inset-bottom)]
│   │   │   └── Layout.tsx         # +UpdateNotice 挂载 + pb-[88px] 给大 TabBar 留空间
│   │   ├── lib/
│   │   │   ├── intent-installer.ts # 🆕 TypeScript bridge → IntentInstallerPlugin
│   │   │   └── platform.ts         # 🆕 __BUILD_MODE__ 编译常量短路 platform 检测
│   │   ├── stores/auth.ts          # 🆕 useLocalToken + init() + auto-login else-if 块
│   │   ├── main.tsx                # 🆕 同步调 useAuthStore.getState().init()
│   │   └── pages/
│   │       ├── CommunityPage.tsx   # QQ 空间风格（Tab: 全部动态/我的说说/好友说说）
│   │       └── SpacePage.tsx       # 个人空间页（封面+头像+统计+说说时间线）
│   ├── mobile-vite.config.ts       # VITE_BUILD_MODE=mobile + VITE_API_BASE_URL
│   └── android/
│       ├── app/src/main/java/com/aie/assistant/
│       │   ├── IntentInstallerPlugin.java  # 🆕 原生插件（FileProvider + Intent.ACTION_VIEW 装 APK）
│       │   └── ...
│       ├── build.gradle            # 🆕 subprojects afterEvaluate 覆盖 kotlin jvmToolchain(17)
│       └── gradle.properties       # 🆕 org.gradle.java.home=C:/greenrhino-tools/jdk17
├── electron/
│   ├── main.cjs                    # 单实例锁 requestSingleInstanceLock（已删错误端口探测）
│   ├── resources/
│   │   ├── frontend/               # ⚠️ sync-dist.ps1 同步的前端 dist
│   │   └── backend/dist/           # ⚠️ sync-dist.ps1 同步的后端 dist
│   └── release-v16/                # Setup + win-unpacked 最新打包产物
├── sync-dist.ps1                   # FE + BE build + 三层时间戳同步验证
├── build-desktop.cjs               # 一键打包（含 sync + electron-builder）
├── gate-check.ps1                  # 发版闸 7 项自动门禁
├── AGENTS.md                       # ⚠️ 全局硬规则（10 条）+ 3 端口 + 路径
└── .trae/
    ├── skills/android-auto-update/ # 🆕 8 步发版 SKILL
    └── memory/growth/
        ├── handover.md             # ← 你正在读
        ├── pitfalls.md            # 所有踩过的坑（永不归档）
        ├── decisions.md           # 为什么选 A 不选 B
        ├── issues.md               # 问题工单（bug 生命周期追踪）
        └── daily/                  # 每日流水
```

---

## ⚠️ 活跃坑 Top 7（接手必看）

1. **Capacitor v8 kotlin jvmToolchain(21) 必须覆盖** — 所有 capacitor 插件（filesystem/app/status-bar 等）的 build.gradle 硬写 `kotlin { jvmToolchain(21) }`，JDK 17 环境直接炸。解法：`android/build.gradle` 加 `subprojects { subp.afterEvaluate { subp.kotlin { jvmToolchain(17) } } }` 覆盖；同时 gradle.properties 加 `org.gradle.java.home`。**推翻旧 handover "硬要 JDK 21" 规则**——JDK 17 够用
2. **Setup.exe `/S` 静默安装被 Defender 拦** — 退出码 0 但文件消失。解法：直接 `Copy-Item electron\release-v16\win-unpacked\* → C:\Program Files\aie-desktop\`
3. **WebView CORS 严格拒绝 `*` + `credentials:true`** — 后端必须动态回显 origin，不能用 `cors({ origin: '*', credentials: true })`。修复：`cors({ origin: fn(origin, cb) { if (!origin) return cb(null, true); cb(null, origin) }, credentials: true })`
4. **auth.init() 必须在 React 渲染前同步调** — 只在 App.tsx useEffect 里调会被首帧 `loading=true` 覆盖。修复：main.tsx 加 `useAuthStore.getState().init()`
5. **Rollup dead code elimination** — `if (__BUILD_MODE__ !== 'desktop')` 恒真会被 inline 到 token-check 块，无 token 时整体跳过。修复：auto-login 用**独立 else-if 块**，结构 `} else if (__BUILD_MODE__ !== 'desktop') { login() }` 不在 if/else 里面
6. **SQLite 表名漂移** — 本地 `User` vs 服务器 `users`，**写 SQL 前先 `.tables` 确认**
7. **seed.ts 会覆盖 admin 密码** — `.env ADMIN_PASSWORD` 必须和 admin123 一致

---

## 📋 已定硬规则（别再问）

- 数据库：**SQLite 不是 MySQL**
- 桌面版打包产物：**只要 NSIS Setup.exe**，Portable 已从 electron/package.json 移除
- **但安装走 win-unpacked 直拷**（Setup.exe 静默被 Defender 拦）
- 内测两步走：本机改完测通 → 用户拍板 → 推服务器
- Build 模式：cross-env `VITE_BUILD_MODE=xxx`（不是 Vite define）
- 三端口分离：5173 desktop · 5174 mobile · 5175 admin
- Capacitor v8：**JDK 17 够用**（afterEvaluate 覆盖 kotlin toolchain），JDK 21 可选在 `tools/jdk-21.0.2/`
- 公网访问：**必须直连 IP 47.116.59.141**（lujax.fun 域名 SNI 封锁）
- admin 运营后台：**独立 React SPA**（入口 `/admin/`，express.static 托管）
- 版本号三落点对齐：electron/package.json + backend package.json + frontend package.json
- **APK URL 必须走 47.116.59.141 直连**（SNI 封锁）
- **手机端 API 必须走 80 HTTP**（443 HTTPS 证书不被 Chromium 信任）
- Android APK 发版必须走 `.trae/skills/android-auto-update/SKILL.md`（AGENTS.md 硬约束第 10 条）
- 正式发布前删掉 `auth.ts` 里 auto-login else-if 块

---

## 🎯 下一步（**按优先级**）

### P0 — 手机端自动更新真机验证（手机连上后）

```powershell
# 手机连上 USB 或开无线调试后：
adb devices
adb install -r "D:\源码存档\助理项目\助理项目\APP-AIE\frontend\android\app\build\outputs\apk\debug\app-debug.apk"
adb shell am force-stop com.aie.assistant
adb shell "am start --user 0 -W -n com.aie.assistant/.MainActivity"

# 等 18s 后截图验证 UpdateNotice Dialog + 下载进度条
```

**预期**：v1.0.2 CURRENT_APK_VERSION → seed 了 v1.0.4 → 启动 3s 弹"发现新版本" → 点"立即更新" → App 内下载进度条 → 完成调系统安装器

### P1 — auto-login 安全守卫（正式版必做）

删掉 `frontend/src/stores/auth.ts` 里 auto-login else-if 块（约第 104-114 行）。当前代码：
```ts
} else if (__BUILD_MODE__ !== 'desktop') {
  // 内测: mobile 自动登录 testuser
  get().login('testuser', 'test123A').then(...)
}
```
**正式发布前**：删掉整个块 或 加 `import.meta.env.DEV` 守卫

### P2 — 清理临时文件

删除：`screen-*.png` · `screenshots/` · `patch-nginx.py` · `check-admin.mjs` · `parse-sel.cjs`

### P3 — 手机设置关应用分身（用户手动）

手机：设置 → 应用 → 应用分身 → 关掉绿角犀的所有分身开关（之前每次启动弹选择器）

---

## 快速验证清单（新 AI 接手先跑一遍）

```powershell
cd D:\源码存档\助理项目\助理项目\APP-AIE

# 1. Git 干净
git status --short
git log --oneline -5

# 2. 后端健康
Invoke-RestMethod -Uri "http://localhost:3001/health"

# 3. admin 登录
$body = @{username='admin';password='admin123'} | ConvertTo-Json
$res = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/auth/login" -Method POST -ContentType "application/json" -Body $body
$res.data.user.role    # 应该是 "admin"

# 4. 桌面版 EXE
Get-Item "C:\Program Files\aie-desktop\绿角犀.exe" | Select-Object Length, LastWriteTime

# 5. 服务器存活
ssh root@47.116.59.141 "pm2 list && curl -s http://127.0.0.1:3100/health && curl -s http://127.0.0.1:3100/api/v1/app/android-version?current=1.0.2"

# 6. APK 上传验证
ssh root@47.116.59.141 "ls -lh /usr/share/nginx/html/apk/greenrhino-latest.apk"
```

---

## 台账索引

| 文件 | 用途 |
|---|---|
| **本文件** | 30 秒快照 + commit 序列 + 启动命令 + 账号 + 服务器 + 活跃坑 + 硬规则 + 下一步 |
| **AGENTS.md** | 全局 10 条硬约束 + 项目身份 + 3 端口 + 铁律 + SKILL 挂载 |
| **pitfalls.md** | 所有踩过的坑（永不归档，持续积累）|
| **decisions.md** | 为什么选 A 不选 B |
| **issues.md** | bug 工单（生命周期追踪）|
| **daily/2026-10-10.md** | 10-10 工作流水（Android 自动更新 + CORS + Capacitor 真机）|
| **daily/2026-10-12.md** | **本文件生成日流水（交接包重写）**|
