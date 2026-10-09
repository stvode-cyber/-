# 🤝 绿角犀管家 (APP-AIE) — AI 交接总览

> **新 AI 进门第一读。5 分钟内读懂项目状态。**
> 🔴 **入场必读顺序**：本文件 → pitfalls.md → daily/今日流水
> 🔴 **先检查**：`git log --oneline -3` + `git status` + 运行端口

---

## ⚡ AI 接手 30 秒快照（2026-10-09 更新）

| 维度 | 当前值 |
|---|---|
| **Git HEAD** | `a03b355` docs(auth): admin 账号重置 — admin/admin123 |
| **远程仓库** | `git@github.com:stvode-cyber/-.git`（仓库名是 `-`） |
| **运行端口** | 3001 ✅ · 5173 ✅ · 5174 ✅ · 5175 ✅（当前全绿） |
| **版本号** | electron=1.0.6 · backend=1.0.6 · frontend=1.0.6 ✅ 三落点一致 |
| **服务器** | 47.116.59.141（公网 admin + API + EXE 全在线） |
| **admin 运营后台** | ✅ 全链路交付：Dashboard 7 真聚合 + pm 3 Tab + 项目 CRUD |
| **桌面版** | ✅ v1.0.6 Setup 已发 + 用户已安装使用（安装在 `C:\Program Files\aie-desktop\`） |
| **活跃坑 Top 5** | 见下方 §活跃坑 |

---

## 🔐 管理员账号（2026-10-09 统一重置）

### 所有环境统一

| 环境 | 用户名 | 密码 | 数据库文件 |
|---|---|---|---|
| **本地 dev（后端 npm run dev）** | `admin` | `admin123` | `backend/prisma/dev.db` |
| **桌面版 aie.db（Electron 内置）** | `admin` | `admin123` | `%APPDATA%\aie-desktop\data\aie.db` |
| **服务器 prod.db** | `admin` | `admin123` | `/root/backend/prisma/prod.db` |

### 登录入口

| 环境 | URL |
|---|---|
| 本地 admin | http://localhost:5175/admin/ |
| 公网 admin | https://47.116.59.141/admin/ |
| 本地 Desktop | http://localhost:5173（或桌面版 EXE） |
| 公网 API | https://47.116.59.141/api/v1 |

### ⚠️ 重要风险：.env ADMIN_PASSWORD 会覆盖！

`.env` 里有 `ADMIN_PASSWORD=xxx`。如果跑 `npm run seed`，**seed.ts 会用这个值 upsert 覆盖 admin 密码**。

当前 `.env ADMIN_PASSWORD=cSQuH83lZSy58IQq` 和实际 `admin123` 不一致。

**解法**（任选）：
1. 改 `.env ADMIN_PASSWORD=admin123` 对齐
2. 改 `backend/src/seed.ts`，admin 已存在时不覆盖 password 字段

---

## 🖥️ 桌面版特殊情况（Setup 安装 vs dev.db）

**Setup 安装路径**：`C:\Program Files\aie-desktop\绿角犀.exe`
**userData 目录**：`%APPDATA%\aie-desktop\`

**Setup 版 Electron 用 `aie.db` 不是 `dev.db`！** 它的数据在：
```
%APPDATA%\aie-desktop\data\aie.db    ← 桌面版内置 backend 读写
```

**首次安装后如果 aie.db schema 不对齐或没 admin 用户**，手动修复：
```powershell
# 1. 杀桌面版进程（防锁 db）
Get-Process | Where-Object { $_.ProcessName -match "绿角犀" } | Stop-Process -Force

# 2. 用正确 schema 对齐 aie.db
cd backend
$env:DATABASE_URL = "file:$env:APPDATA\aie-desktop\data\aie.db"
npx prisma db push --accept-data-loss
npx prisma generate

# 3. seed admin 用户
cd ..
node -e "
const { PrismaClient } = require('./backend/node_modules/.prisma/client');
const bcrypt = require('./backend/node_modules/bcryptjs');
const prisma = new PrismaClient({ datasourceUrl: 'file:' + process.env.APPDATA.replace(/\\\\/g,'/') + '/aie-desktop/data/aie.db' });
async function main() {
  await prisma.user.deleteMany({ where: { username: 'admin' } });
  await prisma.user.create({
    data: { username: 'admin', password: bcrypt.hashSync('admin123', 10), role: 'admin', nickname: '超级管理员', employeeRole: 'admin' }
  });
  console.log('✅ admin/admin123 创建完成');
}
main().catch(console.error).finally(() => prisma.`$disconnect`());
"
```

---

## 📁 项目结构

```
D:\源码存档\助理项目\助理项目\APP-AIE\
├── backend/              # Node.js + Express + Prisma + SQLite
│   ├── src/
│   │   ├── index.ts          # Express 入口（3001）
│   │   ├── middleware/       # authMiddleware + errorHandler（含 ZodError→422）
│   │   ├── routes/
│   │   │   ├── auth.routes.ts
│   │   │   ├── admin.routes.ts   # /admin/dashboard 7 聚合
│   │   │   ├── pm.routes.ts      # /pm/* 17 路由（项目+付款+收款+发票）
│   │   │   └── ...
│   │   └── seed.ts           # 首次建库 seed（⚠️ 会覆盖 admin 密码）
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── dev.db            # 本地 SQLite（Backend dev server 用）
│   └── dist/                 # tsc 编译产物（部署用）
├── frontend/             # React 18 + Vite
│   ├── src/
│   │   ├── pages/
│   │   │   ├── admin/         # AdminLayout + AdminDashboard + AdminPMPage(3Tab)
│   │   │   └── ...
│   │   └── App.tsx
│   ├── vite.config.ts          # 桌面端 5173
│   ├── mobile-vite.config.ts   # 手机端 5174
│   └── admin-vite.config.ts    # 管理后台 5175
├── electron/             # Electron 壳（打包桌面版）
│   ├── main.ts
│   ├── preload.ts
│   ├── resources/backend/      # 打包进 EXE 的 backend（aie.db 在 userData）
│   └── release-v16/            # 打包产物（绿角犀-Setup-1.0.6.exe + Portable）
├── .trae/memory/growth/  # 台账
│   ├── handover.md           # ← 你正在读
│   ├── pitfalls.md           # 所有踩过的坑
│   └── daily/
└── build-desktop.cjs     # 一键打包（sync-dist → tsc → vite build → electron-builder）
```

---

## 🚀 启动命令

### 本地开发（4 端口全开）

```powershell
# 后端 3001
cd backend
npx tsx watch src/index.ts

# 桌面端 5173
cd frontend
npm run dev

# 手机端 5174
npm run dev:mobile

# 管理后台 5175
npx vite --config admin-vite.config.ts --port 5175
```

### 桌面版打包 + 部署

```powershell
# 1. 一键 build（sync-dist → tsc → vite → electron-builder）
node build-desktop.cjs

# 2. gate-check（7 项硬约束，不过别发）
powershell -ExecutionPolicy Bypass -File .\gate-check.ps1

# 3. 传 EXE 到服务器
scp "electron\release-v*\绿角犀-*.exe" "root@47.116.59.141:/usr/share/nginx/html/apk/"

# 4. 服务器算 SHA256 + 更新 SQLite windows_releases 表
ssh root@47.116.59.141 "sha256sum /usr/share/nginx/html/apk/绿角犀-Setup-1.0.6.exe"
# 然后写 SQL 文件 scp 上去 sqlite3 prod.db < update.sql
```

---

## 🌐 服务器信息

### SSH

```bash
ssh root@47.116.59.141   # 公钥登录，无密码（密钥在 C:\Users\Administrator\.ssh\id_rsa）
```

### pm2 进程

| 进程 | 端口 | 目录 |
|---|---|---|
| aie-backend | 3100 | `/root/backend/dist/` |
| erp-backend | (ERP 项目) | ERP 目录 |

```bash
pm2 list                              # 看进程
pm2 restart aie-backend               # 重启
pm2 logs aie-backend --lines 50       # 看日志
```

### nginx conf.d（3 活跃 + 2 disabled）

| conf | listen | 用途 |
|---|---|---|
| `greenrhino-cloud-ssl.conf` | **443 default_server** | 绿角犀主 HTTPS（/admin/ + /apk/ + /api） |
| `greenrhino-cloud.conf` | 8091 | Garh Commercial HTTP |
| `erp-web.conf` | ? | ERP 项目 |
| ~~lujax-cloud-https.conf~~ | 已 disabled | proxy_pass 8090 空进程 |
| ~~lvjiaoxi.conf~~ | 已 disabled | DNS 没解析 + chattr +i |

```bash
lsattr /etc/nginx/conf.d/*.conf       # 查 immutable 锁
nginx -t && nginx -s reload           # 改完必须 reload
```

### 数据库

```bash
sqlite3 /root/backend/prisma/prod.db ".tables"           # 查表名（注意：服务器是小写复数 users 不是 User）
sqlite3 /root/backend/prisma/prod.db "SELECT username, role FROM users"  # 查用户
sqlite3 /root/backend/prisma/prod.db ".schema pm_projects"  # 查 pm 表结构
```

⚠️ **表名漂移**：本地 `prisma/dev.db` 用 Prisma 默认（如 `User`），服务器 prod.db 用迁移后的小写复数（如 `users`）。**写 SQL 前先 `.tables` 确认！**

### 服务器 admin 前端重新部署

```powershell
# 本地 build
cd frontend
npm run build:admin

# scp 到服务器
scp -r admin-dist/* root@47.116.59.141:/usr/share/nginx/html/admin/

# 后端也要重新 build（如果改了后端代码）
scp -r backend/dist root@47.116.59.141:/root/backend/
scp backend/prisma/schema.prisma root@47.116.59.141:/root/backend/prisma/
# 服务器上：
#   npx prisma db push
#   npx prisma generate
#   pm2 restart aie-backend
```

### pm 脏表重建（2026-10-08 遇到过）

如果 pm_projects / pm_payments 等表是旧 schema（手写 SQL 建的，createdAt 是 INTEGER 不是 DATETIME）：
```bash
cd /root/backend
cp prisma/prod.db prisma/prod.db.bak-$(date +%Y%m%d-%H%M%S)
sqlite3 prisma/prod.db "DROP TABLE IF EXISTS pm_payments; DROP TABLE IF EXISTS pm_receipts; DROP TABLE IF EXISTS pm_invoices; DROP TABLE IF EXISTS pm_projects; DROP TABLE IF EXISTS pm_departments;"
npx prisma db push       # 按 schema.prisma 正确重建
npx prisma generate      # 重新编译 @prisma/client
pm2 restart aie-backend
```

---

## 📊 admin 运营后台功能清单（全已交付）

### Dashboard（`/admin/` 首页）

| 聚合 | 后端字段 | 说明 |
|---|---|---|
| DAU | `dau` | lastLoginAt today 精确计数 |
| MAU | `mau` | lastLoginAt 30 天内精确计数 |
| 次日留存率 | `retention` | 昨日注册 + 今日活跃 ÷ 昨日注册 × 100 |
| 7 天活跃趋势 | `dailyTrend[]` | 每天 lastLoginAt 聚合 |
| TOP 用户 5 | `topUsers[]` | $queryRaw 4 表 union groupBy userId |
| 24h 活跃分布 | `hourlyDist[24]` | $queryRaw strftime('%H', lastLoginAt) groupBy |
| 实时互动流 | `recentActivity[]` | $queryRaw 4 表 union ORDER BY createdAt LIMIT 10 |

### 项目账款（`/admin/pm`，AdminPMPage 3 Tab）

| Tab | 功能 | 后端接口 |
|---|---|---|
| 项目列表 | CRUD + 批量删除 + 搜索 | GET/POST/PATCH/DELETE `/pm/projects` + bulk-delete |
| 收付款流水 | 合并 payments+receipts 按日期倒序 | GET `/pm/payments` + `/pm/receipts` |
| 发票流水 | 类型着色（进项/销项） | GET `/pm/invoices` |

pm.routes.ts 完整 17 路由——本地 + 服务器双端全冒烟通过。

---

## ⚠️ 活跃坑 Top 5（接手必看）

1. **prod.db pm 脏表**：手写 SQL 建的 pm_* 表 schema 不对齐，必须 `prisma db push --accept-data-loss` 重建
2. **SQLite 表名漂移**：本地 `User` vs 服务器 `users`，**写 SQL 前先 `.tables` 确认**
3. **aie.db（桌面版）首次安装后 schema 不对齐 + 没 admin**：需手动 `prisma db push` + seed（详见上方 §桌面版）
4. **.env ADMIN_PASSWORD 会被 seed.ts upsert 覆盖**：要跑 seed 先改 .env 或改 seed.ts 逻辑
5. **Prisma Client 锁 db**：`Stop-Process -Force` 杀 backend 后锁可能没释放，等 2 秒再起

**更多坑** → pitfalls.md（永不归档，持续积累）

---

## 📋 已定硬规则（别再问）

- 数据库：**SQLite 不是 MySQL**
- 三端口分离：5173 desktop · 5174 mobile · 5175 admin（各一份 vite.config）
- Build 模式：cross-env `VITE_BUILD_MODE=xxx`（不是 Vite define）
- admin middleware rewrite：admin-vite.config.ts 用 configureServer middleware 把 `/admin/` rewrite 到 `/admin/admin.html`
- 密码重置：统一用 `bcrypt.hashSync('admin123', 10)` + `prisma.user.update`
- 内测两步走：本机改完 → 用户拍板 → 推服务器

---

## 🎯 下一步（可选）

- [ ] GitHub 仓库改名 `-` → `APP-AIE`（改完 `git remote set-url origin git@github.com:stvode-cyber/APP-AIE.git`）
- [ ] 改 `.env ADMIN_PASSWORD=admin123` 对齐（防 seed 覆盖）
- [ ] pm 项目详情页（点击项目进详情看关联付款/收款/发票）
- [ ] community 管理页面（帖子列表 + 删除 + 审核）
- [ ] 今天先到这

---

## 台账索引

| 文件 | 用途 |
|---|---|
| **本文件** | 30 秒快照 + 远程资源 + 硬规则 + 启动命令 |
| **pitfalls.md** | 所有踩过的坑（永不归档，持续积累） |
| **daily/2026-10-08.md** | 今日流水（发版 + nginx 清理 + 桌面版安装） |
| **daily/2026-09-30.md** | Admin 前端首次 build + Vite envFile 踩坑 |
| **daily/2026-09-23.md** | 初始台账建立 |

---

## 最近 commit（`a03b355` → 往前）

```
a03b355 docs(auth): admin 账号重置 — admin/admin123, 本地+服务器双端 reset
693ea9f fix(deploy): 服务器 prod.db pm 脏表重建 — prisma db push + prisma generate, CRUD 6/6 全绿
9b43cd6 feat(admin): AdminPMPage 项目增删改 — 新建/编辑 Modal + 行删除 + 批量删除 checkbox
693ea9f fix(deploy): 服务器 pm 脏表重建
b79296e docs(ledger): handover 快照更新至 v1.0.6 发版 + nginx 清爽状态
9942df8 build(release): v1.0.6 桌面版发版 — gate 7/7 全绿
5d0acfc docs(ledger): lvjiaoxi + lujax_cloud 终极清理
aa37f13 feat(admin): /admin/dashboard 补全 5 组后端聚合接口
```

---

## 快速验证清单（新 AI 接手先跑一遍）

```powershell
# 1. Git 干净
git status

# 2. 端口
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3001,5173,5174,5175 }

# 3. 本地 admin 登录
$body = @{username='admin';password='admin123'} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/auth/login" -Method POST -ContentType "application/json" -Body $body

# 4. 公网 admin 登录
curl.exe -sk -X POST -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"admin123\"}" https://47.116.59.141/api/v1/auth/login

# 5. 服务器存活
ssh root@47.116.59.141 "pm2 list && curl -s http://127.0.0.1:3100/health"

# 6. EXE 下载
curl.exe -skI https://47.116.59.141/apk/lvjiaoxi-setup-1.0.6.exe
```
