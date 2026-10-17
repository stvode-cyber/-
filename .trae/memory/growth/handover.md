# 🤝 绿角犀管家 (APP-AIE) — AI 交接总览

> **新 AI 进门第一读。5 分钟内读懂项目状态，30 秒内能启动。**
> 🔴 **入场顺序**：本文件 → secrets.md → issues.md → INDEX.md → 今日 daily.md → git log --oneline -5
> 🔴 **先验证**：`git status --short` + `Invoke-RestMethod http://localhost:3001/health`

---

## ⚡ AI 接手 30 秒快照（2026-10-17 更新）

| 维度 | 当前值 |
|---|---|
| **Git HEAD** | 今日 HEAD（mobile 头部重构 + 墨玉绿主题）|
| **远程仓库** | `git@github.com:stvode-cyber/-.git`（仓库名是 `-`）|
| **版本号** | **v1.1.0**（三落点对齐 ✅）|
| **运行端口** | 3001（后端）· 5173（桌面 dev）· 5174（手机 dev）· 5175（admin dev）|
| **服务器** | 47.116.59.141 · pm2 `backend` 端口 3100 · 后端 v1.1.0 |
| **已安装桌面** | `C:\Program Files\aie-desktop\绿角犀.exe`（v1.1.0）|
| **后端健康** | 本地 http://localhost:3001/health ✅ |

### 最近大改动（7 天内）

1. **墨玉绿主题头部重构** — HomePage.tsx + 3 新组件（GreetingHeader/WeekCalendar/MissionCard）+ tailwind brand 色
2. **Android 自动更新全链路** — IntentInstallerPlugin.java + Filesystem.downloadFile + progress:true
3. **CORS 根治** — 后端 cors() 动态回显，解决 WebView 严格拒绝
4. **Capacitor JDK 17 覆盖** — afterEvaluate 覆盖所有 capacitor 插件硬写的 jvmToolchain(21)
5. **Setup.exe 弃用** — 开发者改用 win-unpacked 直拷覆盖安装

---

## 🔐 管理员账号（所有环境统一 admin/admin123）

| 环境 | 用户名 | 密码 | 数据库文件 |
|---|---|---|---|
| **本地 dev** | `admin` | `admin123` | `backend/prisma/dev.db` |
| **桌面版** | `admin` | `admin123` | `%APPDATA%\aie-desktop\data\aie.db` |
| **服务器 prod.db** | `admin` | `admin123` | `/root/backend/prisma/prod.db` |
| 手机端临时 | `testuser` | `test123A` | role=user（**正式发布前删掉** auto-login）|

---

## 🚀 启动命令

### 场景 A：本地开发（4 端口全起）

```powershell
cd D:\源码存档\助理项目\助理项目\APP-AIE\backend; npx tsx watch src/index.ts
cd ../frontend; npm run dev                   # 桌面 5173
npm run dev:mobile                            # 手机 5174
npx vite --config admin-vite.config.ts --port 5175  # admin 5175
```

### 场景 B：桌面版打包 + 覆盖安装

```powershell
$PROJ = "D:\源码存档\助理项目\助理项目\APP-AIE"; cd $PROJ
.\sync-dist.ps1
cd electron; npx electron-builder --win nsis --publish never; cd ..
Stop-Process -Name 绿角犀 -Force -EA SilentlyContinue; Start-Sleep 2
Remove-Item "C:\Program Files\aie-desktop" -Recurse -Force -EA SilentlyContinue
Copy-Item -Path "electron\release-v16\win-unpacked" -Destination "C:\Program Files\aie-desktop" -Recurse -Force
Copy-Item -Path "C:\Program Files\aie-desktop\win-unpacked\*" -Destination "C:\Program Files\aie-desktop\" -Recurse -Force
Remove-Item "C:\Program Files\aie-desktop\win-unpacked" -Recurse -Force
Start-Process "C:\Program Files\aie-desktop\绿角犀.exe"
```

### 场景 C：手机 APK 构建

```powershell
cd D:\源码存档\助理项目\助理项目\APP-AIE\frontend
$env:VITE_API_BASE_URL='http://47.116.59.141/api/v1'
npx cross-env VITE_BUILD_MODE=mobile vite build --config mobile-vite.config.ts
npx cap sync android; cd android; .\gradlew.bat assembleDebug
```

### 场景 D：后端部署到云端

```powershell
cd D:\源码存档\助理项目\助理项目\APP-AIE
cd backend; npx tsc; cd ..
scp -r backend/dist root@47.116.59.141:/root/backend/
scp backend/prisma/schema.prisma root@47.116.59.141:/root/backend/prisma/
ssh root@47.116.59.141 "cd /root/backend && npx prisma db push && npx prisma generate && pm2 restart backend"
```

---

## 🌐 服务器信息

### SSH
```bash
ssh root@47.116.59.141
```

### pm2 进程
```bash
pm2 list && curl -s http://127.0.0.1:3100/health
pm2 restart backend
```

### nginx
- **greenrhino-cloud-ssl.conf**（443 default_server）— 主 HTTPS · `/api/v1/` → 3100 · `/apk/` 静态托管
- **erp-web.conf**（80 HTTP）— 手机端 Android 不信任 47.116.59.141 证书 → 走 HTTP 80 绕过

### 数据库（⚠️ SQLite 不是 MySQL！）
```bash
sqlite3 /root/backend/prisma/prod.db ".tables"          # 写 SQL 前先确认表名！
```
⚠️ **表名漂移铁律**：本地 dev.db 用 Prisma 默认（`User`），服务器 prod.db 是小写复数（`users`）。

### 托管目录
| 路径 | 内容 |
|---|---|
| `/usr/share/nginx/html/apk/` | EXE + APK 静态托管 |
| `/root/backend/public/admin/` | 管理后台静态文件 |

---

## 📁 项目结构（关键）

```
APP-AIE/
├── backend/                 # Express + Prisma
│   ├── src/index.ts         # CORS 动态回显
│   ├── src/middleware/error.ts  # ZodError → 422
│   └── prisma/schema.prisma # 58 表
├── frontend/                # React + Vite + Tailwind
│   ├── src/pages/HomePage.tsx         # 手机端主页（墨玉绿头部）
│   ├── src/components/home/           # 3 新组件
│   ├── tailwind.config.js             # brand/canvas/ink/surface 墨玉绿主题
│   ├── mobile-vite.config.ts          # VITE_BUILD_MODE=mobile
│   └── android/                       # Capacitor
├── electron/                # Electron 壳
├── AGENTS.md               # 全局硬约束 + 12 条铁律
└── .trae/memory/growth/    # 台账（见 INDEX.md）
```

---

## 👤 用户行为偏好（AI 必守）

| 偏好 | 执行 |
|---|---|
| **AI 全权操作** | 跑命令、改代码、SSH 部署、浏览器自动化，用户只负责"确认/同意/好的" |
| **大白话回复** | 禁止套话废话技术术语堆砌，直接说事 |
| **任务进度编号** | 每次宣告 "N 个动作"，完成的标记 ✅ 带编号 |
| **新 AI 可立即接手** | 台账精简 + 索引清晰 + 每日流水 |
| **前端简洁易懂** | UI 操作路径越短越好，按钮大白话，交互顺 |
| **后端先想再写** | 每个路由/Service 先想"是不是一定要写"，选最高效办法 |
| **联网学习借鉴** | 有问题先搜开源项目/最佳实践，不自己瞎造轮子 |

---

## ⚠️ 活跃坑 Top 5

1. **Capacitor jvmToolchain(21) 必须覆盖** — afterEvaluate 到 17
2. **Setup.exe /S 被 Defender 拦** — 改用 win-unpacked 直拷
3. **WebView CORS 严格拒绝 `*` + credentials:true** — 后端动态回显
4. **SQLite 表名漂移** — 写 SQL 前先 `.tables`
5. **pm2 进程名实际是 backend** — 不是 aie-backend

---

## 快速验证清单

```powershell
cd D:\源码存档\助理项目\助理项目\APP-AIE
git status --short; git log --oneline -5
Invoke-RestMethod -Uri "http://localhost:3001/health"
$body = @{username='admin';password='admin123'} | ConvertTo-Json
$res = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/auth/login" -Method POST -ContentType "application/json" -Body $body
$res.data.user.role    # 应该是 "admin"
Get-Item "C:\Program Files\aie-desktop\绿角犀.exe" | Select-Object Length, LastWriteTime
ssh root@47.116.59.141 "pm2 list && curl -s http://127.0.0.1:3100/health"
```
