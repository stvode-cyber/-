# 🤝 绿角犀管家 (APP-AIE) — AI 交接总览

> **新 AI 进门第一读。5 分钟内读懂项目状态，30 秒内能启动。**
> 🔴 **入场顺序**：本文件 → secrets.md → issues.md → INDEX.md → 今日 daily.md → git log --oneline -5
> 🔴 **先验证**：`git status --short` + `Invoke-RestMethod http://localhost:3001/health`

---

## ⚡ AI 接手 30 秒快照（2026-11-03 OIDC PKCE 全链路验证 · v1.2.0）

| 维度 | 当前值 |
|---|---|
| **Git HEAD** | 72a16fb `feat(livekit): Day 9 LiveKit 预调研 12 文件`（本地工作区干净）|
| **远程仓库** | `https://github.com/stvode-cyber/-.git`（HTTPS，已改 SSH→HTTPS）|
| **版本号** | **v1.2.0**（三落点对齐 ✅）|
| **运行端口** | 3001（后端）· 5173（桌面 dev）· 5174（手机 dev）· 5175（admin dev）|
| **服务器** | 🔴 **Continuwuity 云端全挂**（lujax.fun + 3000 + 3101 全 timeout）需重启！· 47.116.59.141 pm2 状态未知 |
| **已安装桌面** | `C:\Program Files\aie-desktop\绿角犀.exe`（v1.2.0）|
| **后端健康** | Express 本地启动正常 → /health 200 ✅（刚验过，OIDC PKCE 全链路通过）|
| **本地 SQLite admin 密码** | `cSQuH83lZSy58IQq`（已和 .env 对齐）|
| **OIDC client_secret** | `334etYKd_mB9JPsBF1wsNNpw3o5UzrKMJjuRvaQOfdA`（硬编码 oidc.routes.ts）|

### 最近大改动（今天 v1.2.0 迭代）

1. **OIDC PKCE + 登录表单全链路** — Day 2 Continuwuity 强制 code_challenge(S256) → auth 端点从"强制 authRequired 中间件"升级为"可选认证：有 JWT 直发 code，无 cookie 返回登录表单 HTML" → token 端点新增 PKCE verifyPkce + userinfo 端点查 Prisma User 返回完整 OIDC Claims（sub/preferred_username/nickname/avatar/email/phone）— 本地完整链路通过 ✅
2. **17 个未提交文件一次性入库** — oidc.routes.ts (59 行改) + 台账补写 6 篇 daily + 14 个 LiveKit 预调研脚本 + 2 个 Continuwuity config.toml base/final — 3 个 commit 全推 GitHub
3. **remote 统一改 HTTPS** — 原 fetch/push 全 SSH 但这台机器没配 GitHub 公钥 → push 失败 → 改 HTTPS credential-manager 兜底成功 → 下次 fetch/push 再不会卡 SSH
4. **密码 hash 对齐** — .env ADMIN_PASSWORD 改过后 SQLite dev.db 里的 admin 还是早期 seed 的 admin123 → 今天验 OIDC 时 bcrypt.compare 失败才发现 → 用 .env 密码重新 hash 更新 → 现在对齐了
5. **Continuwuity 云端全挂** — lujax.fun 主站 + 3000 端口 + 3101 pm2 app-backend 全 timeout → 严重阻塞，需上服务器重启 pm2

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

## ⚠️ 活跃坑 Top 6（2026-11-03 真跑 OIDC 发现）

1. **🔴🔴 Continuwuity 云端全挂** — lujax.fun 主站 + :3000 + :3101 pm2 app-backend 全 timeout → 需 SSH 47.116.59.141 重启 pm2 app-backend + Continuwuity docker
2. **🔴 .env ADMIN_PASSWORD ≠ SQLite dev.db 密码** — 今天 bcrypt.compare 才发现：.env 写 cSQuH83lZSy58IQq，SQLite 还是早期 seed 的 admin123 → 已修
3. **token 端点强制要求 client_secret** — Continuwuity OIDC client 必须配 client_secret=334etYKd_mB9JPsBF1wsNNpw3o5UzrKMJjuRvaQOfdA，只带 PKCE 不够
4. **Capacitor jvmToolchain(21) 必须覆盖** — afterEvaluate 到 17
5. **Setup.exe /S 被 Defender 拦** — 改用 win-unpacked 直拷
6. **pm2 进程名漂移（本周第 3 次复发）** — 11 文件 32 处已修，根因 ecosystem.config.cjs 源头错写

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
# OIDC Discovery（Continuwuity 云端挂了，本地端点只给 Express 启动才能测）
Invoke-RestMethod -Uri "http://localhost:3001/api/oidc/.well-known/openid-configuration"
# OIDC Auth（不带 cookie → 返回登录表单）
Invoke-RestMethod -Uri "http://localhost:3001/api/oidc/auth?response_type=code&client_id=continuwuity&redirect_uri=https://lujax.fun/callback&code_challenge=abc&code_challenge_method=S256"
# Continuwuity 云端（全挂！需上 47.116.59.141 重启 pm2 + docker）
# ssh root@47.116.59.141 "pm2 list && docker ps && curl -s http://127.0.0.1:3101/health"
```
