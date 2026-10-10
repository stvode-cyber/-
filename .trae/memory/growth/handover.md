# 🤝 绿角犀管家 (APP-AIE) — AI 交接总览

> **新 AI 进门第一读。5 分钟内读懂项目状态，30 秒内能启动。**
> 🔴 **入场顺序**：本文件 → pitfalls.md → 今日 daily.md
> 🔴 **先检查**：`git log --oneline -3` + `git status --short` + 端口

---

## ⚡ AI 接手 30 秒快照（2026-10-10 更新）

| 维度 | 当前值 |
|---|---|
| **Git HEAD** | `1bcd54b` feat(community): QQ空间风格圈子改造 |
| **远程仓库** | `git@github.com:stvode-cyber/-.git`（仓库名是 `-`） |
| **版本号** | **v1.1.0**（electron/package.json `"version": "1.1.0"`） |
| **运行端口** | 3001 ✅（后端） · 5173 ✅（桌面） · 5174（手机） · 5175（admin） |
| **服务器** | 47.116.59.141（pm2 aie-backend 端口 3100，公网 admin + API + EXE） |
| **已打包产物** | Setup.exe 绿角犀-Setup-1.1.0.exe（168MB）+ win-unpacked 绿角犀.exe（225MB） |
| **手机 APK** | app-release.apk（13.2MB，已装到 ZY22KJLPHK） |
| **安装路径** | `C:\Program Files\aie-desktop\绿角犀.exe` |

### 最近大改动（3 天内）

1. **QQ 空间风格圈子**（1bcd54b）：CommunityPage Tab 改为「全部动态/我的说说/好友说说」，新建 SpacePage.tsx 个人空间页（封面+头像+统计+说说时间线），帖子作者头像可点击跳 `/space/:userId`
2. **团队门槛功能**（daf12b1）：`POST /team/bootstrap` 创建群立团队（6 步事务：部门→群→群成员→双向绑定→设 boss→会话），`requireTeam` 中间件无 departmentId 返回 403
3. **Electron 单实例锁修复**（a8aa9da）：删掉 main.cjs 里错误的端口探测双重兜底（dev server 也返回 200 导致误杀），只保留 `requestSingleInstanceLock`
4. **auth.ts login() 返回值修复**（f5f571d）：login() 末尾加 `return res`，interface 从 `Promise<void>` 改为 `Promise<{token,user}>`（AdminLoginPage 之前拿 undefined）
5. **auth.routes.ts 返回缺字段修复**：login/phone-login 手动组装 user 对象时补了 employeeRole 和 departmentId

---

## 🔐 管理员账号（所有环境统一 admin/admin123）

| 环境 | 用户名 | 密码 | 数据库文件 |
|---|---|---|---|
| **本地 dev** | `admin` | `admin123` | `backend/prisma/dev.db` |
| **桌面版**（Setup 安装） | `admin` | `admin123` | `%APPDATA%\aie-desktop\data\aie.db` |
| **服务器 prod.db** | `admin` | `admin123` | `/root/backend/prisma/prod.db` |

### 登录入口

| 环境 | URL |
|---|---|
| 本地 admin | http://localhost:5175/admin/ |
| 公网 admin | https://47.116.59.141/admin/ |
| 本地 Desktop | http://localhost:5173 |
| 公网 API | https://47.116.59.141/api/v1 |

### ⚠️ 风险：.env ADMIN_PASSWORD 会被 seed.ts 覆盖

`.env` 里有 `ADMIN_PASSWORD`。跑 `npm run seed` 时 seed.ts 会 upsert 覆盖 admin 密码。

**当前建议**：改 `.env ADMIN_PASSWORD=admin123` 对齐，或者改 seed.ts 让 admin 已存在时不覆盖 password。

---

## 🚀 启动命令

### 本地开发（4 端口）

```powershell
# 后端 3001（tsx watch 热重载）
cd backend
npx tsx watch src/index.ts

# 或后端 3001（tsc 编译后跑）
npx tsc && node dist/index.js

# 桌面端 5173
cd frontend
npm run dev

# 手机端 5174
npm run dev:mobile

# 管理后台 5175
npx vite --config admin-vite.config.ts --port 5175
```

### 桌面版打包 + 覆盖安装

```powershell
cd electron
# 1. build 前端
cd ../frontend; npm run build; cd ../electron
# 2. 同步到 electron/resources/frontend
robocopy ..\frontend\dist resources\frontend /MIR /NFL /NDL /NJH /NJS /NC /NS
# 3. tsc 编译后端
cd ../backend; npx tsc; cd ../electron
# 4. electron-builder（只要 nsis Setup.exe，不要 portable）
npm run dist:win
# 5. 覆盖安装目录
Stop-Process -Name 绿角犀 -Force -ErrorAction SilentlyContinue; Start-Sleep 2
Copy-Item -Path release-v16\win-unpacked\* -Destination "C:\Program Files\aie-desktop\" -Recurse -Force
```

### 手机 APK 打包（Capacitor v8）

```powershell
# ⚠️ Capacitor v8 硬要 JDK 21，本机只有 JDK 17
# JDK 21 已解压在 d:\源码存档\助理项目\助理项目\APP-AIE\tools\jdk-21.0.2
$env:JAVA_HOME = 'd:\源码存档\助理项目\助理项目\APP-AIE\tools\jdk-21.0.2'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

# build mobile 前端
cd frontend; npm run build:mobile

# cap sync 同步到 android
npx cap sync android

# gradlew 打 release APK
cd android
.\gradlew.bat assembleRelease

# 安装到手机（adb devices 确认连上）
adb install -r app\build\outputs\apk\release\app-release.apk
```

**APK 位置**：`frontend/android/app/build/outputs/apk/release/app-release.apk`

---

## 📁 项目结构

```
D:\源码存档\助理项目\助理项目\APP-AIE\
├── backend/                 # Node.js + Express + Prisma + SQLite
│   ├── src/
│   │   ├── index.ts              # Express 入口（3001）
│   │   ├── middleware/           # authMiddleware + errorHandler（含 ZodError→422）
│   │   ├── routes/
│   │   │   ├── auth.routes.ts        # 登录/注册（含 phone-login）
│   │   │   ├── community.routes.ts    # 圈子：帖子+说说+个人空间（filter=mine/friends）
│   │   │   ├── team.routes.ts         # 团队门槛（bootstrap 6步事务 + requireTeam 中间件）
│   │   │   ├── pm.routes.ts           # 项目账款 17 路由
│   │   │   ├── admin.routes.ts        # /admin/dashboard 7 聚合
│   │   │   └── ...
│   │   └── seed.ts               # ⚠️ 会覆盖 admin 密码
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── dev.db                # 本地后端用的 SQLite
│   └── dist/                     # tsc 编译产物
├── frontend/               # React + Vite + Capacitor
│   ├── src/
│   │   ├── pages/
│   │   │   ├── CommunityPage.tsx      # 圈子（Tab: 全部动态/我的说说/好友说说）
│   │   │   ├── SpacePage.tsx          # 个人空间（封面+头像+统计+说说时间线）
│   │   │   ├── DesktopLayout.tsx      # 侧边栏（当前 label: "圈子"）
│   │   │   ├── admin/AdminLoginPage.tsx
│   │   │   └── ...
│   │   ├── stores/auth.ts             # Zustand auth（login() 返回 Promise<{token,user}>）
│   │   └── App.tsx                    # 路由（含 /space/:userId）
│   ├── vite.config.ts          # 桌面端 5173
│   ├── mobile-vite.config.ts   # 手机端 5174（VITE_BUILD_MODE=mobile）
│   ├── admin-vite.config.ts    # 管理后台 5175
│   ├── android/                # Capacitor Android 原生工程
│   └── capacitor.config.ts
├── electron/               # Electron 壳
│   ├── main.cjs                 # 删掉了错误的端口探测双重兜底，只留 requestSingleInstanceLock
│   ├── preload.cjs
│   ├── package.json             # "version": "1.1.0"，build.win.target 只有 nsis
│   ├── resources/backend/       # 打包进 EXE 的 backend（aie.db 在 userData）
│   ├── resources/frontend/      # 打包进 EXE 的前端（dist 同步过来）
│   └── release-v16/             # 最新打包产物
├── tools/jdk-21.0.2/        # JDK 21（Capacitor v8 需要）
└── .trae/memory/growth/
    ├── handover.md           # ← 你正在读
    ├── pitfalls.md           # 所有踩过的坑（永不归档）
    └── daily/
```

---

## 🌐 服务器信息

### SSH

```bash
ssh root@47.116.59.141   # 公钥登录（密钥在 C:\Users\Administrator\.ssh\id_rsa）
```

### pm2 进程

| 进程 | 端口 | 目录 |
|---|---|---|
| aie-backend | 3100 | `/root/backend/dist/` |

```bash
pm2 list                              # 看进程
pm2 restart aie-backend               # 重启
pm2 logs aie-backend --lines 50       # 看日志
```

### 部署流程

```powershell
# 本地
cd backend; npx tsc
cd ../frontend; npm run build
robocopy dist ..\electron\resources\frontend /MIR /NFL /NDL /NJH /NJS /NC /NS

# 打包后端
scp -r backend/dist root@47.116.59.141:/root/backend/
scp backend/prisma/schema.prisma root@47.116.59.141:/root/backend/prisma/

# 前端（如果改了 admin）
scp -r admin-dist/* root@47.116.59.141:/usr/share/nginx/html/admin/

# 服务器上
cd /root/backend; npx prisma db push; npx prisma generate; pm2 restart aie-backend
```

### 数据库

```bash
sqlite3 /root/backend/prisma/prod.db ".tables"           # ⚠️ 先查表名！
sqlite3 /root/backend/prisma/prod.db "SELECT username, role FROM users"
```

⚠️ **表名漂移**：本地 dev.db 用 Prisma 默认（如 `User`），服务器 prod.db 是迁移后的小写复数（如 `users`）。**写 SQL 前必须先 `.tables` 确认！**

### nginx conf.d

| conf | listen | 用途 |
|---|---|---|
| `greenrhino-cloud-ssl.conf` | **443 default_server** | 绿角犀主 HTTPS（/admin/ + /apk/ + /api） |

```bash
nginx -t && nginx -s reload           # 改完必须 reload
```

---

## ⚠️ 活跃坑 Top 5（接手必看）

1. **Electron main.cjs 端口探测误判**：旧代码 `isPortInUse(3001)` + `probeBackend('/health')` 返回 200 就弹"已在运行"。**dev server（同一份后端）也返回 200** → 误杀。已删，只留 `requestSingleInstanceLock`
2. **auth.ts login() 不返回值**：旧代码只做缓存没 `return res`，AdminLoginPage `const res = await login()` 拿到 undefined → `res?.user?.role` 短路成 undefined → 报"无管理员权限"。已修，但如果再改 auth.ts 别忘记 interface 也要改
3. **SQLite 表名漂移**：本地 `User` vs 服务器 `users`，**写 SQL 前先 `.tables` 确认**
4. **seed.ts 会覆盖 admin 密码**：`.env ADMIN_PASSWORD` 和实际 admin123 不一致，跑 seed 会 upsert 覆盖
5. **Prisma Client 锁 db**：`Stop-Process -Force` 杀 backend 后锁可能没释放，等 2 秒再起

**更多坑** → pitfalls.md（永不归档，持续积累）

---

## 📋 已定硬规则（别再问）

- 数据库：**SQLite 不是 MySQL**
- 桌面版打包产物：**只要 NSIS Setup.exe，不要 Portable 绿色版**（electron/package.json 已移除 portable target）
- 内测两步走：本机改完测通 → 用户拍板 → 推服务器
- Build 模式：cross-env `VITE_BUILD_MODE=xxx`（不是 Vite define）
- 三端口分离：5173 desktop · 5174 mobile · 5175 admin（各一份 vite.config）
- Capacitor v8：**硬要 JDK 21**，本机 JDK 17 不行，临时解压在 `tools/jdk-21.0.2`
- 密码重置：`bcrypt.hashSync('admin123', 10)` + `prisma.user.update`
- 公网访问：**必须直连 IP 47.116.59.141**（lujax.fun 域名 SNI 封锁）
- admin 运营后台：**独立 React SPA**（入口 `/admin/`，不是 `/api/v1/admin`）
- 版本号三落点对齐：electron/package.json + backend package.json + frontend package.json

---

## 🎯 下一步建议

- [x] ~~**git push 到 GitHub**~~（2026-10-10 16:00 push 6 commits → `5c0fc1b`，main 与 origin 完全同步）
- [ ] **圈子功能在真机验证**（手机已装 APK，打开试 Tab + 点头像进空间）
- [ ] **圈子数据初始化**（如果圈子没帖子，可以先手动 seed 几条）
- [ ] **SpacePage 加 bio 字段**（User 表当前没有 bio，想加个人简介要先改 schema）
- [ ] **好友功能完善**（当前 isFriend 只读，加好友按钮还没实现）
- [ ] **Circle CI 自动打包**（可选，省得每次手动 gradlew）

---

## 快速验证清单（新 AI 接手先跑一遍）

```powershell
# 1. Git 干净
git status --short

# 2. 后端健康
Invoke-RestMethod -Uri "http://localhost:3001/health"

# 3. admin 登录
$body = @{username='admin';password='admin123'} | ConvertTo-Json
$res = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/auth/login" -Method POST -ContentType "application/json" -Body $body
$res.data.user.role    # 应该是 "admin"
$res.data.user.employeeRole    # 应该有值
$res.data.user.departmentId    # null（没群立团队）

# 4. 圈子接口
$token = $res.data.token
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/community/posts?filter=mine" -Headers @{Authorization="Bearer $token"}
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/community/users/$($res.data.user.id)" -Headers @{Authorization="Bearer $token"}

# 5. 服务器存活
ssh root@47.116.59.141 "pm2 list && curl -s http://127.0.0.1:3100/health"

# 6. 前端路由（5173）
Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing | Select-Object StatusCode

# 7. 桌面版 EXE 路径
Get-Item "C:\Program Files\aie-desktop\绿角犀.exe" | Select-Object Length, LastWriteTime
```

---

## 最近 commit（`1bcd54b` → 往前）

```
1bcd54b feat(community): QQ空间风格圈子改造 - 个人空间页 + 说说分类Tab
f5f571d fix(auth): login() 补 return res — AdminLoginPage 读 role 不再是 undefined
a8aa9da fix(ui+electron): 侧边栏去好友 + 删错误的后端端口探测
8df06f3 docs(ledger): 台账更新 — v1.1.0 本机测试全绿 + auth bug 修复记录
daf12b1 feat(team): 团队门槛功能 + v1.1.0 发版 + auth bug 修复
```

---

## 台账索引

| 文件 | 用途 |
|---|---|
| **本文件** | 30 秒快照 + 启动命令 + 账号 + 服务器 + 活跃坑 + 硬规则 |
| **pitfalls.md** | 所有踩过的坑（永不归档，持续积累） |
| **daily/2026-10-09.md** | 今日流水（QQ 空间圈子改造 + 手机 APK 打包） |
