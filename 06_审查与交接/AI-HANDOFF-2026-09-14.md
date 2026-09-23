# 绿角犀 · AI 接手交接文档

> **接手即懂。** 新 AI 读完这个文件，就能无缝继续。
> 最后更新：2026-09-14

---

## 〇 · 快速上手（3 分钟读完）

```
项目根: d:\源码存档\助理项目\助理项目\APP-AIE
技术栈: Electron 43 + React 18 + Node/Express + Prisma/SQLite + Zustand
运行模式: 本地打包版 release-v16，用户双击 EXE 使用

云端服务器: 47.116.59.141 (阿里云 ECS)
  SSH: root@47.116.59.141  key: ~/.ssh/id_ed25519  ← 本机已配好，直接能用
  PM2: aie-backend (端口 3001)
  密钥: /root/backend/cloud-jwt-{private,public}.pem (RS256)

本地路径:
  Electron EXE:  electron/release-v16/win-unpacked/绿角犀.exe
  前端源码:      frontend/src/
  后端源码:      backend/src/
  main.cjs:      electron/main.cjs
  用户数据:      %APPDATA%/aie-desktop/
  SQLite DB:     %APPDATA%/aie-desktop/aie.db
  后端日志:      %APPDATA%/aie-desktop/logs/backend.log
  云端公钥:      backend/cloud-jwt-public.pem (451 bytes, 随 release 打包)
```

---

## 一 · 已完成工作台账

### Session 2026-09-14（本次会话，约 4 小时）

| # | 任务 | 改动文件 | 状态 | 备注 |
|---|---|---|---|---|
| 1 | **注册页简化：砍掉手动注册折叠区，只留手机+验证码** | `frontend/src/pages/LoginPage.tsx` | ✅ | -82 行；后端 `/register` API 保留但前端不再暴露 |
| 2 | **修复 AUTH_MODE=cloud-proxy 导致 send-sms 返回 500** | `electron/main.cjs` L405-407 | ✅ | 原硬编码 `app.isPackaged → cloud-proxy`，但没有公钥 → authProxy 缺 CLOUD_AUTH_BASE_URL。改为**降级可选**：有公钥走 cloud-proxy，没有走 local |
| 3 | **接入云端身份源（RS256 JWT）** | `electron/main.cjs` + release 打包 | ✅ | 云端本来就跑完整后端 + RS256 签名，只是公钥没打包下来。`scp` 拿 `cloud-jwt-public.pem` → 塞进 release/backend/ |
| 4 | **接入短信网关（mock 降级模式）** | 云端新增 `dist/services/smsService.js` + patch `dist/routes/auth.routes.js` | ✅ | 已装 `@alicloud/dysmsapi20170525`；云端 `.env` 模板占位已写好；**当前 mock 模式**（等用户给阿里云凭证切 real） |
| 5 | **修复双窗口问题（根因：禁用了 requestSingleInstanceLock + 端口检测竞态）** | `electron/main.cjs` L14-43 | ✅ | 删掉 `--no-singleton` + 恢复 `app.requestSingleInstanceLock()` + `second-instance` 事件把已存在窗口拉到前台 + createWindow 加防重入守卫 |
| 6 | **关掉宠物浮窗自动启动** | `electron/main.cjs` L1234 | ✅ | 注释掉启动时那行 `createPetWindow()`；托盘右键 / 设置里手动唤出仍可用 |
| 7 | **创建 UX 测试 AI 员工 + Skill 手册** | `.trae/agents/core/ux-experience-tester.md` + `.trae/skills/ux-test-playbook/SKILL.md` | ✅ | 黑盒冒烟/异常/兼容/一键化扫描四维度 + AP-01~AP-15 反模式 + R01-R10 规则 + Nielsen 10 条 |

### 之前 Session（未在本次上下文，但结果已在代码里）

| 项 | 位置 |
|---|---|
| Electron release-v16 打包 | `electron/release-v16/win-unpacked/` |
| 本地 authRoutes（send-sms / phone-register）| `backend/src/routes/auth.routes.ts` |
| authProxy 中间件 | `backend/src/middleware/authProxy.ts` |
| Prisma schema | `backend/prisma/schema.prisma` |
| JWT RS256 验签中间件 | `backend/src/middleware/auth.ts` |

---

## 二 · 当前运行架构（理解这个就能继续开发）

```
┌─────────────────────────────────────────────────────────────────┐
│ 用户电脑                                                         │
│                                                                 │
│  绿角犀.exe (Electron 主进程)                                    │
│    │                                                            │
│    ├─ BrowserWindow #1: 主窗口 (渲染 React SPA)                  │
│    │   URL: file://.../frontend/index.html#/login               │
│    │                                                            │
│    ├─ 后端子进程 (ELECTRON_RUN_AS_NODE)                          │
│    │   本地 HTTP: 127.0.0.1:3001                                │
│    │   AUTH_MODE = cloud-proxy (因为 release 里有公钥)            │
│    │   │                                                        │
│    │   ├─ /auth/*  → authProxy → http://47.116.59.141:3001      │
│    │   │              云端签发 RS256 JWT                         │
│    │   │                                                        │
│    │   └─ /* 业务路由 → 本地处理 + 用云端公钥验签 JWT             │
│    │                                                           │
│    └─ SQLite DB: %APPDATA%/aie-desktop/aie.db                  │
│       Prisma ORM，存所有业务数据（用户配置、对话历史、宠物等）     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 云端 47.116.59.141 (阿里云 ECS)                                  │
│                                                                 │
│  PM2: aie-backend (fork, pid 819361, uptime 3h, 0 重启)          │
│  Node/Express, PORT=3001, AUTH_MODE=local                      │
│                                                                 │
│  /auth/* 端点:                                                   │
│    POST /send-sms          → smsService (当前 mock, 等阿里云)     │
│    POST /phone-register    → 创建用户 + RS256 签 JWT             │
│    POST /register          → 手动注册（保留但不再前端暴露）        │
│    POST /login             → 手机号+密码登录                      │
│    GET  /me                → 返回当前用户                        │
│    POST /heartbeat         → 心跳续期                            │
│                                                                 │
│  JWT 密钥: /root/backend/cloud-jwt-{private,public}.pem         │
│    algorithm: RS256                                              │
│    private → 签发 (云端持有，绝不外发)                             │
│    public  → 验签 (打包进 Electron release)                      │
│                                                                 │
│  数据库: /root/backend/prisma/prod.db (SQLite)                   │
│  SMS SDK: @alicloud/dysmsapi20170525 (已装，未配 .env)           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三 · 关键文件索引（改代码直接找这里）

### Electron 主进程

| 文件 | 用途 | 关键位置 |
|---|---|---|
| `electron/main.cjs` | 主进程入口（启动后端/创建窗口/托盘/IPC） | **改任何 Electron 行为先看这个** |
| | | L29: `requestSingleInstanceLock()` 单实例锁 |
| | | L58: `BACKEND_PORT = 3001` |
| | | L165: `getCloudPublicKey()` 读公钥 |
| | | L405-418: **AUTH_MODE 降级逻辑**（有公钥→cloud-proxy） |
| | | L491-510: `createWindow()` + 防重入守卫 |
| | | L594-647: `createPetWindow()` 宠物浮窗（当前默认不启动） |
| | | L1070: `app.whenReady()` 启动主流程 |
| | | L1234: **宠物自动启动已注释** |
| `electron/preload.cjs` | 渲染进程桥接（暴露 `window.dam` / `window.electron` API） | |
| `electron/updater.cjs` | 自更新逻辑 | |
| `electron/cacheStore.cjs` | 离线缓存（本地资源） | |

### 后端

| 文件 | 用途 |
|---|---|
| `backend/src/index.ts` | Express 入口 |
| `backend/src/routes/auth.routes.ts` | 认证路由（send-sms / phone-register / login / me） |
| `backend/src/middleware/auth.ts` | JWT 验签（HS256 兜底 + RS256 云端公钥验签） |
| `backend/src/middleware/authProxy.ts` | cloud-proxy 模式下把 /auth/* 转发到云端 |
| `backend/src/services/smsService.js` | **云端已有**（ESM），mock 降级 + 阿里云 DYSMSAPI |
| `backend/prisma/schema.prisma` | 数据模型 |
| `backend/cloud-jwt-public.pem` | 云端公钥，打包时复制到 release/backend/ |

### 前端

| 文件 | 用途 |
|---|---|
| `frontend/src/pages/LoginPage.tsx` | 登录/注册页（**当前只有手机注册，无手动注册折叠**） |
| `frontend/src/stores/auth.ts` | Zustand auth 状态（token / user / login / logout） |
| `frontend/src/App.tsx` | HashRouter 路由 |
| `frontend/src/components/` | UI 组件（Tailwind） |

### 云端独有（不在本地）

| 路径 | 用途 | 重要性 |
|---|---|---|
| `/root/backend/cloud-jwt-private.pem` | **JWT 私钥，绝不外泄** | ⭐⭐⭐ |
| `/root/backend/cloud-jwt-public.pem` | 公钥，可分发 | ⭐⭐ |
| `/root/backend/.env` | 云端环境变量 | ⭐⭐ |
| `/root/backend/dist/services/smsService.js` | 短信发送服务（刚部署） | ⭐⭐ |
| `/root/backend/dist/routes/auth.routes.js` | 已 patch（sendVerificationCode 接入） | ⭐⭐ |
| `/root/backend/prisma/prod.db` | 云端 SQLite | ⭐ |
| `/root/backend/ecosystem.config.cjs` | PM2 配置 | ⭐ |

---

## 四 · 常用操作手册（复制粘贴就能跑）

### 连云端

```powershell
# 本机已配好 SSH key，直接用
ssh root@47.116.59.141

# 看云端后端日志
pm2 logs aie-backend --lines 100

# PM2 重启
pm2 restart aie-backend

# 云端 .env（敏感信息不列出）
grep -E 'AUTH_MODE|JWT|ALIYUN|DATABASE_URL' /root/backend/.env
```

### 本地构建 & 同步

```powershell
$root = "d:\源码存档\助理项目\助理项目\APP-AIE"

# 1. 后端：TypeScript → dist
cd "$root\backend"; npx tsc

# 2. 前端：Vite 构建
cd "$root\frontend"; npm run build

# 3. 同步到 release
Copy-Item "$root\electron\main.cjs" "$root\electron\release-v16\win-unpacked\resources\app\main.cjs" -Force
Copy-Item "$root\backend\dist" "$root\electron\release-v16\win-unpacked\resources\backend\dist" -Recurse -Force
Copy-Item "$root\backend\cloud-jwt-public.pem" "$root\electron\release-v16\win-unpacked\resources\backend\cloud-jwt-public.pem" -Force

# 4. 启 Electron（带 CDP 调试）
Get-Process 绿角犀 -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process "$root\electron\release-v16\win-unpacked\绿角犀.exe" -ArgumentList "--remote-debugging-port=9222"

# 5. Playwright 连 CDP 测试
node -e "const { chromium } = require('playwright-core'); (async()=>{const b=await chromium.connectOverCDP('http://127.0.0.1:9222'); console.log((await b.request('http://127.0.0.1:3001/api/v1/home/today')).status());})()"
```

### 云端发版

```powershell
# 本地编译后端 → 推云端 → PM2 restart
cd "$root\backend"; npx tsc
scp -r dist root@47.116.59.141:/root/backend/
ssh root@47.116.59.141 "cd /root/backend && pm2 restart aie-backend"
```

### 短信网关切 real（拿到阿里云凭证后）

```bash
ssh root@47.116.59.141

cat >> /root/backend/.env << 'EOF'
# === 阿里云短信 ===
ALIYUN_ACCESS_KEY_ID=你的Key
ALIYUN_ACCESS_KEY_SECRET=你的Secret
ALIYUN_SMS_SIGN_NAME=绿角犀
ALIYUN_SMS_TEMPLATE_CODE=SMS_xxxxxxxxxx
EOF

pm2 restart aie-backend

# 验证：send-sms 返回不应该有 data.code（真实短信网关不回验证码）
curl -s -X POST http://127.0.0.1:3001/api/v1/auth/send-sms \
  -H 'Content-Type: application/json' \
  -d '{"phone":"你的真实手机号"}'
```

### 云端公钥刷新（极罕见）

```powershell
# 如果云端重新生成了密钥对，重新 scp
scp root@47.116.59.141:/root/backend/cloud-jwt-public.pem "$root\backend\cloud-jwt-public.pem"
# 然后同步到 release（见上方步骤 3）
```

---

## 五 · 已知坑 & 踩过的雷

| # | 坑 | 现象 | 怎么避 |
|---|---|---|---|
| 1 | **AUTH_MODE 降级** | 没公钥还硬设 cloud-proxy → authProxy 缺 CLOUD_AUTH_BASE_URL → send-sms 返回 500 "服务端未配置云端认证地址" | main.cjs L405-407 已修：`cloudPublicKey ? 'cloud-proxy' : 'local'` |
| 2 | **中文 userData 路径** | Electron 43 的 process_singleton lockfile 创建失败（Error code: 5 ACCESS_DENIED） | L22-26 已修：`app.setPath('userData', ..., 'aie-desktop')` 强制英文路径 |
| 3 | **端口检测竞态** | 两次快速启动间隔 <2s → 第一次后端还没 listen → 第二次也通过 → 两个实例 | L29 已修：恢复 `requestSingleInstanceLock` + `second-instance` 事件 |
| 4 | **release 同步漏文件** | 改了 main.cjs 忘了复制到 release → 跑的还是旧代码 | 用第四节的同步脚本，一次复制所有需要的文件 |
| 5 | **SMS mock 不返回验证码** | 真实模式下云端不回 data.code（安全）→ 前端应该显示 toast "验证码已发送"，但前端还没适配两种模式 | 前端 LoginPage.tsx 当前已兼容：有 data.code 显示，没有就 toast |
| 6 | **session.defaultSession 时机** | 必须在 app.whenReady 之前调用 `session.defaultSession.webRequest.onHeadersReceived` | main.cjs L1070-1089 在 app.whenReady 里面调，此时 session 已 ready |
| 7 | **Prisma 在打包版的 DLL** | 每次升级 Prisma 都得跑 `prisma generate` 再打包，否则运行时找不到 native DLL | 已写 updater.cjs 的 `regeneratePrismaIfMarked()` |

---

## 六 · 待办事项清单（按优先级）

### P0 · 必须做

| # | 任务 | 描述 | 复杂度 |
|---|---|---|---|
| T1 | **接入真实短信网关** | 用户给阿里云凭证 → 写入云端 .env → `pm2 restart aie-backend` | 极低（已配好代码） |
| T2 | **云端加 /auth/public-key 端点** | 让本地不用 SSH 就能自动拉公钥。标准 JWKS 做法。 | 低 |

### P1 · 应该做

| # | 任务 | 描述 | 复杂度 |
|---|---|---|---|
| T3 | 一键手机注册 | Electron 取本机手机号（运营商网关 / WebRTC SIM） | 中 |
| T4 | 登录页加"短信验证码登录" | 和注册对称，现在只有用户名+密码 | 低 |
| T5 | 云端数据库从 SQLite 迁 PostgreSQL | 多端同步需要真正的数据库 | 高 |
| T6 | 发布 installer（Inno Setup 6 中文界面） | 现在只有 win-unpacked 目录 | 中 |

### P2 · 远期

| # | 任务 |
|---|---|
| T7 | 多端登录同步（手机 Capacitor / 平板） |
| T8 | AgentCore 远程访问（WebDAV 3900 端口已开） |
| T9 | Pet 浮窗功能完善（默认关，需要时开） |
| T10 | UX 测试 AI 员工跑一次完整报告 |

---

## 七 · 核心安全设计（别搞反了）

```
云端持有: RSA PRIVATE KEY → 能签发 JWT → 身份源
本地持有: RSA PUBLIC KEY  → 只能验签 → 不能伪造身份令牌
Electron 安装包: 公钥（可随包分发，安全）
云端 .env: 所有密钥（绝不进前端/安装包）
```

**红线：** 永远不要把 `cloud-jwt-private.pem` 传到本地、仓库、或任何客户端能拿到的地方。

---

## 八 · AI 员工 & Skill 清单

项目里已经配好的 AI 员工和 Skill，让它们自动干活：

| 类型 | 路径 | 触发方式 |
|---|---|---|
| 🤖 AI 员工 | `.trae/agents/core/ux-experience-tester.md` | 说"UX 巡检" / "测一下注册" / "扫一键化机会" |
| 🤖 AI 员工 | `.trae/agents/usability-tester.md` | 原则审查 |
| 📘 Skill | `.trae/skills/ux-test-playbook/` | UX 测试黑盒手册（AP-01~15 + R01~10 + Nielsen 10） |
| 📘 Skill | `.trae/skills/security-audit-guide/` | 安全审计 |
| 📘 Skill | `.trae/skills/frontend-component-spec/` | 前端组件规范 |
| 📘 Skill | `.trae/skills/unit-test-spec/` | 单元测试规范 |

---

## 九 · 快速诊断命令（出问题时先跑这些）

```powershell
# 1. 本地健康链
curl -s http://127.0.0.1:3001/health
# → {"ok":true} 才算正常

# 2. 云端健康链
curl -s http://47.116.59.141:3001/health

# 3. 本地能验签云端 JWT 吗？
# 先从云端注册拿一个 token（mock 模式需要 phone + code）
# 或者直接 curl 云端 send-sms + phone-register

# 4. 云端 PM2 状态
ssh root@47.116.59.141 "pm2 status aie-backend && pm2 logs aie-backend --lines 20 --nostream"

# 5. 本地 Electron 进程和 CDP
curl -s http://127.0.0.1:9222/json/list

# 6. 本地后端日志
Get-Content "$env:APPDATA\aie-desktop\logs\backend.log" -Tail 30
```

---

**交接完毕。新 AI，请从第四节「常用操作手册」开始。**
