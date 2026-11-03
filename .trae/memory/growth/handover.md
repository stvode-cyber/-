# 🤝 绿角犀管家 (APP-AIE) — AI 交接总览

> **新 AI 进门第一读。5 分钟内读懂项目状态，30 秒内能启动。**
> 🔴 **入场顺序**：本文件 → secrets.md → issues.md → INDEX.md → 今日 daily.md → git log --oneline -5
> 🔴 **先验证**：`git status --short` + `Invoke-RestMethod http://localhost:3001/health`

---

## ⚡ AI 接手 30 秒快照（2026-11-03 OIDC PKCE + Express ECS 部署 · v1.2.0）

| 维度 | 当前值 |
|---|---|
| **Git HEAD** | bb8d9a3 `docs(ledger): DC-20261103-01`（本地工作区干净，4 commit 已推 GitHub）|
| **远程仓库** | `https://github.com/stvode-cyber/-.git`（HTTPS，credential-manager）|
| **版本号** | **v1.2.0**（三落点对齐 ✅）|
| **本地端口** | 3001（Express dev）· 5173/5174/5175（桌面/手机/admin dev）|
| **ECS 47.116.59.141** | ✅ **OIDC 已通！** pm2 `aie-oidc-backend` online port 3101 · Continuwuity docker Up · nginx `/api/oidc/` → 127.0.0.1:3101 ✅ |
| **公网验证** | ✅ `https://lujax.fun/api/oidc/.well-known/openid-configuration` → 200 + 完整 JSON |
| **Express 部署目录** | `/root/aie-oidc-backend/`（dist/ + keys/ + prisma/）|
| **已安装桌面** | `C:\Program Files\aie-desktop\绿角犀.exe`（v1.2.0）|
| **本地 SQLite admin** | `cSQuH83lZSy58IQq`（已和 .env + ECS dev.db 对齐）|
| **OIDC client_secret** | `334etYKd_mB9JPsBF1wsNNpw3o5UzrKMJjuRvaQOfdA` |
| **Workbench 入口** | 阿里云控制台 → ECS i-uf639nktwpt4rchwy1vg → 远程连接 → 通过Workbench远程连接 → 立即登录（root，免密已打通）|

### 今晚关键改动（OIDC Day 2 主线落地）

1. **Express 首次 ECS 部署成功** — 源码 git clone GitHub 443 timeout → frpc tunnel 穿透（本地 HTTP server 127.0.0.1:18080 + frpc remotePort=18081 + ECS curl 127.0.0.1:18081）→ tar.gz 成功（536KB）→ npm ci --omit=dev + prisma generate + db push + pm2 start `node dist/index.js` → online port 3101 ✅
2. **OIDC RSA keys 上传** — 本地 keys/oidc-private.pem + oidc-public.pem → frpc tunnel 直传（2KB）→ Express restart → Discovery 从 503 "keys not loaded" 变 200 完整 JSON ✅
3. **Continuwuity 从 Exited(1) → Up** — docker logs 全是 OIDC 502（Express 没部署根因验证）→ docker start continuwuity → Up 8s ✅ · 再无 502 报错
4. **ECS 环境真查（首次真跑 pm2/netstat/docker）** — pm2 只有 pm2-logrotate（erp-backend 也丢了！）· port 3000/3101 空 · port 8080 被 Python3 SimpleHTTP（/opt/greenrhino_download）· Node v20.20.2 · SQLite 已有 · GitHub 443 timeout
5. **frpc tunnel 方案定型** — frpc.toml 加 ecs-download proxy（remotePort=18081）· 本地 HTTP server 127.0.0.1:18080 serve $env:TEMP · ECS curl 127.0.0.1:18081 走 frps 7000 穿透 · 可复用方案：未来任何 ECS 缺 git/docker 的场景都能这么传

### 已知坑（遗留但不阻塞）

- **erp-backend (NestJS) 也丢了** — pm2 save 过期 + port 3000 空 · 今晚只救 OIDC，ERP 后续再恢复
- **port 8080 Python3 server** — 疑似之前临时启动忘了停（serve /opt/greenrhino_download）· 不影响 OIDC · 后续可清理
- **pm2 save 必须加 cron 自动存** — 重启机器会丢（erp-backend 丢了就是教训）· 后续加 systemd 或 crontab
- **PowerShell base64 有 UTF-8 BOM 坑** — Out-File -Encoding utf8 会加 BOM · ECS `base64 -d` 不认 → pem 原文件直传更稳

---

## 🔐 管理员账号（所有环境统一 admin/admin123）

| 环境 | 用户名 | 密码 | 数据库文件 |
|---|---|---|---|
| **本地 dev** | `admin` | `admin123` | `backend/prisma/dev.db` |
| **桌面版** | `admin` | `admin123` | `%APPDATA%\aie-desktop\data\aie.db` |
| **ERP 服务器** | `admin` | `admin123` | MySQL `zhiyun_erp`（NestJS/TypeORM）|
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

### ERP 服务器数据库（⚠️ 是 MySQL！不是 SQLite！）
```bash
mysql -uroot -p'ErpRoot2026@Sec' zhiyun_erp -e "SHOW TABLES;"
```
⚠️ **两个项目不能混**：看图 APP 用本地 SQLite（`backend/prisma/dev.db`），ERP 服务器用 MySQL `zhiyun_erp`。

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

## ⚠️ 活跃坑 Top 6（2026-11-03 全解 OIDC 后刷新）

1. **🟢 Continuwuity OIDC 502 根因已解** — 根因：Express backend 从来没部署到 ECS 3101（昨晚 handover 里写了但没真查）→ Express 部署 + keys 上传 + Continuwuity docker start → 公网 Discovery 200 ✅
2. **🔴 erp-backend (NestJS pm2) 丢了** — pm2 save 过期 + ECS 重启后进程没自动恢复 → port 3000 空了 → 后续需要重新 `git clone + npm ci + pm2 start + pm2 save`
3. **🟡 port 8080 Python3 SimpleHTTP 残留** — pid 675，serve /opt/greenrhino_download → 不影响 OIDC（frpc 用 18081 避开了）→ 后续可 `kill 675`
4. **🟡 GitHub 443 到 ECS timeout** — 阿里云 ECS 出网限制？→ frpc tunnel 是当前唯一远程传文件方案 → 后续考虑在 ECS 装 GitHub mirror 或用 frpc 长期代理
5. **🟡 pm2 save 必须加 cron** — pm2 save 过期会丢进程（erp-backend 丢了就是教训）→ 后续 ECS 加 `crontab -e` 每天 `pm2 save`
6. **🟢 .env 密码 hash 对齐（已解）** — 今晚 Express 部署时 .env 和 SQLite 密码都是 `cSQuH83lZSy58IQq` ✅

---

## 快速验证清单

```powershell
# 本地 Express（第一次要先 npm run dev 启动）
cd D:\源码存档\助理项目\助理项目\APP-AIE\backend
Invoke-RestMethod -Uri "http://localhost:3001/health"
# admin 密码已和 .env 对齐
$body = @{username='admin';password='cSQuH83lZSy58IQq'} | ConvertTo-Json
$res = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/auth/login" -Method POST -ContentType "application/json" -Body $body
$res.data.user.role    # 应该是 "admin"
# OIDC Discovery（公网已通！Express 3101 ECS 部署完成）
Invoke-RestMethod -Uri "https://lujax.fun/api/oidc/.well-known/openid-configuration"
# OIDC Auth（不带 cookie → Express 返回登录表单 HTML）
Invoke-RestMethod -Uri "https://lujax.fun/api/oidc/auth?response_type=code&client_id=continuwuity&redirect_uri=https://lujax.fun/callback&code_challenge=abc&code_challenge_method=S256"
# ECS 内部直验（从 Workbench 终端跑）
# curl -s http://127.0.0.1:3101/health
# curl -s http://127.0.0.1:3101/api/oidc/.well-known/openid-configuration
# docker ps | grep continuwuity
# pm2 list | grep aie-oidc
# frpc tunnel 临时上传（ECS 缺 git 时用）
# 本地 PowerShell: HTTP server 127.0.0.1:18080 serve TEMP + frpc remotePort=18081
# ECS: curl -o /tmp/pkg.tar.gz http://127.0.0.1:18081/pkg.tar.gz
```
