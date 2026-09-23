# 绿角犀（全能个人助理）· 新 AI 接手交接

> 目的：让**任意一台新工作台上的新 AI** 在无本会话上下文的情况下，读完本文即能定位、运行、构建、部署、排障。请按 ① 目录→② 上手→③ 构建→④ 服务器→⑤ 已知坑 顺序读。
>
> 本文最后更新：2026-09-10（管理后台独立迁移收尾）。

---

## 0. 一句话定位

`绿角犀` 是「本地数据为主 + 云端账号/AI 网关」的个人全能助理。**同一份代码**打三个端：
- 桌面端（Electron，Windows，NSIS 安装版 + 便携版）
- 安卓端（Capacitor WebView，APK）
- 管理后台（独立云端网页，浏览器访问，不随 APP 分发）

前端 React 18 + Vite + TS + Tailwind，后端 Node 22 + Express + Prisma(SQLite)，状态 zustand，移动壳 Capacitor。

---

## 1. 目录地图

项目根：`D:\源码存档\助理项目\助理项目\APP-AIE\`（注意路径有**两层** `助理项目`）

| 路径 | 作用 |
|---|---|
| `frontend/` | 前端源码（SPA + 独立管理页构建）+ Capacitor Android 工程 |
| `frontend/src/main.tsx` + `App.tsx` | 主 APP 入口与路由（无 admin 路由） |
| `frontend/admin.html` + `src/admin-main.tsx` | 管理后台独立入口 + 路由 |
| `frontend/admin-vite.config.ts` | 管理页独立构建配置（`build:admin`） |
| `frontend/.env.mobile` | 安卓端 API 基址（现为 https://lujax.fun:8444/api/v1） |
| `backend/` | Node/Express/Prisma 后端 |
| `backend/src/index.ts` | 服务入口（含 `/admin` 静态托管 + SPA fallback） |
| `backend/public/admin/` | 管理页构建产物（由 `frontend/admin-dist` 拷来，**须手工同步**） |
| `backend/.env` | 本地密钥/端口/LLM（**勿提交**，名称见 §7） |
| `electron/` | 桌面壳：`main.cjs`、`resources/backend`（打包进后端的全套）、`release-v16/`（最新安装包） |
| `electron/resources/backend/cloud-jwt-public.pem` | 随安装包分发的云端公钥（验签用） |
| `build-desktop.cjs` | 桌面端一键打包脚本 |
| `scripts/server-ssh/*.cjs` | 服务器 SSH/SFTP 执行与上传下载工具 |
| `06_审查与交接/交接记录.md` | 详细历史 + 服务器运维手册（**本文为精简索引，详档看它**） |
| `D:\源码存档\助理项目\服务器存档\` | 云端私钥、prod.db 备份归档等 |

---

## 2. 快速上手（本地跑起来）

```powershell
# 前端（开发）— 需要 VITE_API 指向本地后端
Set-Location "D:\源码存档\助理项目\助理项目\APP-AIE\frontend"
npm run dev            # http://localhost:5173

# 后端（开发）— 本地库 backend/prisma/dev.db
Set-Location "D:\源码存档\助理项目\助理项目\APP-AIE\backend"
npm run dev            # tsx watch src/index.ts, 端口 3001
# 注意：本地后端托管 /admin 需先有 backend/public/admin（见 §4.2）
```

- 本地库模板 `resources/backend/prisma/dev.db`（50 表 0 数据）；桌面首启自动复制到 `userData/data/aie.db`。
- 管理员账号：见 `backend/.env` 的 `ADMIN_USERNAME/ADMIN_PASSWORD`（仅在 seed 时生效）。

---

## 3. 构建与打包（三端）

> **版本一致性铁律**：桌面/安卓/管理页 + 安装包属性 + 更新通道的版本号必须完全一致，作区分与对标标尺。改版本务必三处同步。

### 3.1 主前端
```powershell
Set-Location "...\APP-AIE\frontend"
npm run build          # tsc --noEmit && vite build → dist/
```

### 3.2 管理后台网页（本会话新增的独立产物）
```powershell
Set-Location "...\APP-AIE\frontend"
npm run build:admin    # vite build --config admin-vite.config.ts → admin-dist/
# 产物仅 4 个文件：admin.html + assets/(2 js + 1 css)
# 关键坑：admin-vite.config.ts 顶层有 publicDir:false，禁止塞回主 APP 的贴纸/天气图等资源
# 同步到后端供本地/部署使用：
Copy-Item "frontend\admin-dist\*" "backend\public\admin\" -Recurse -Force
# （建议先清空 backend/public/admin 再拷，避免旧污染残留）
```
管理后台**不随 APP**，只作为独立网页由后端 `/admin` 托管。

### 3.3 桌面端（Electron）
```powershell
Set-Location "...\APP-AIE"        # 根目录
node build-desktop.cjs            # → electron/release-v16/ 绿角犀-Setup-1.0.0.exe + 绿角犀-Portable-1.0.0.exe
```
- 打包前务必先同步 `electron/resources/` 下的 `frontend` + `backend`（前端 dist、后端 dist、dev.db 模板）到最新。
- **需 Node ≥ 22**（`@electron/get` 为 ESM）；本机已用 `C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2`。
- 无签名警告属正常（未配代码签名证书）。

### 3.4 安卓 APK（需要 JDK + Android SDK）
```powershell
Set-Location "...\APP-AIE\frontend"
vite build --mode mobile          # 读 .env.mobile，打包 API 指向
npx cap sync android              # 同步资源到 frontend/android/app/src/main/assets/public
Set-Location "...\APP-AIE\frontend\android"
./gradlew assembleRelease         # 产物 app/build/outputs/apk/release/app-release.apk
```
- 正式签名：`frontend/android/keystore.properties` 指向 `frontend/android/keys/`（**已 gitignore，密码勿提交**）。
- 本机环境：JDK 21 `C:\aie-toolchain\jdk-21.0.12.1+1`，SDK `C:\Users\Administrator\.android-sdk`（platform-35 + build-tools;35.0.0）。
- **构建坑**：Gradle 与 `maven.google.com` 在国内可能被墙。根 `frontend/android/build.gradle` 已把 `google()` 换成**阿里云镜像**；Gradle 发行版走本地缓存（`.zip.ok` 标记）。换新环境若下载慢，同样处理。
- 最终发布 APK（版本 v1.0.1，versionCode 2）已另存 `backend\data\绿角犀-安卓端-v1.0.1-正式签名.apk`，认证 `CN=LuJiaoXi`。

---

## 4. 服务器运维（47.116.59.141，华东2 上海）

### 4.1 访问凭据与工具
- **密码认证**：root 密码 `trnepwq0101A`；运行时以环境变量注入，**不落盘不提交**。
  `scripts/server-ssh/ssh-exec.cjs`（执行命令）、`sftp-upload.cjs`、`sftp-download.cjs`。
  用法：`$env:AIDEV_SSH_PASS="<密码>"; node scripts/server-ssh/ssh-exec.cjs "命令"`
- **密钥认证**：`C:\Users\Administrator\.ssh\id_ed25519`（`ssh root@47.116.59.141`，免密；`ssh-key.cjs` / `sftp-key-up.cjs` / `sftp-key-single-up.cjs`）。
- PowerShell 引号坑：传给远端 bash 的命令含 `$(...)`、嵌套 `"`、`for` 循环时易被本地展开/截断，拆成单条、避免内嵌双引号。

### 4.2 后端部署（/root/backend）
```bash
ssh root@47.116.59.141
# 目录 /root/backend（源码、dist、node_modules、prisma、logs）；进程名 aie-backend（pm2）
pm2 status                  # 进程 aie-backend
pm2 logs aie-backend --lines 100
pm2 restart aie-backend           # 改后端代码/环境后重启
pm2 restart aie-backend --update-env   # 改 .env 后
sqlite3 /root/backend/prisma/prod.db   # 生产库（绝对路径）
```
- `.env` 关键：`HOST=0.0.0.0`（公网 3001 可达）、`DATABASE_URL=file:/root/backend/prisma/prod.db`、`JWT_PRIVATE_KEY/...`（见 §7）。
- **管理页部署**（本会话）：`frontend/admin-dist` 上传覆盖 `/root/backend/public/admin/`，然后 `pm2 restart aie-backend`。后端 `src/index.ts` 已写 `/admin` 静态托管 + `/admin/*` SPA fallback（置于 API 之后、notFound 之前，不吞 `/api`）。
- 健康检查：`curl http://47.116.59.141:3001/health` → `{status:ok}`。
- **prod.db 备份必做**：下载到 `D:\源码存档\助理项目\服务器存档\prod-db-备份\`，命名含**日期+状态**（如 `prod.db-20260909-完整备份`）。工具 `sftp-download.cjs`。

### 4.3 nginx（关键站点，改后必 `nginx -t && nginx -s reload`）
| 文件 | 监听 | 作用 |
|---|---|---|
| `greenrhino-cloud-ssl.conf` | 443 默认站 `server_name _` | `/apk/`（root `/usr/share/nginx/html`）、`/souinput.apk`、`/latest.json`、`/`→8090 |
| `lujax-cloud-https.conf` | 443 `lujax.fun` | `/`→8090、`/updates/`→`/opt/lvbiao_updates/`、**新增**`/apk/` 静态（本会话） |
| `lujax-fun.conf` | **8444** `lujax.fun` | `https://lujax.fun:8444/` → 后端 3001（托管 `/admin`） |

### 4.4 安装包分发（已上传，经直连 IP 可用）
服务器 `/usr/share/nginx/html/apk/` 现有三个包（各字节数见交接记录 11.3）：
- `https://47.116.59.141/apk/绿角犀-Setup-1.0.0.exe`
- `https://47.116.59.141/apk/绿角犀-Portable-1.0.0.exe`
- `https://47.116.59.141/apk/绿角犀-安卓端-v1.0.1-正式签名.apk`
中文名需 URL 编码；证书自签名，首次访问会提示"继续前往"。

---

## 5. 管理后台独立迁移（本会话核心改动，2026-09-10）

**目标**：管理后台与 APP 分离，独立成云端网页；APP 内彻底移除管理入口。

- **移除**：`App.tsx` 删 admin 路由分支；`LoginPage.tsx` 删桌面/移动端管理入口链接。已同步至桌面安装包与 APK。
- **新增**：`frontend/admin.html` + `src/admin-main.tsx`（独立 BrowserRouter，路由全在 `/admin` 下）+ `admin-vite.config.ts`；`frontend/package.json` 加 `build:admin`。
- **后端托管**：`backend/src/index.ts` 静态托管 `/admin` + SPA fallback；生产 `ADMIN_WEB_DIR` 可覆盖目录（默认 `backend/public/admin`）。
- **云端地址**：`https://lujax.fun:8444/admin/`（8444→后端 3001→`public/admin`）。已部署并验证 `/admin/`、深链 `/admin/users`、静态资源均 200，API 不被遮蔽。
- **管理页与主 APP 同构同源**：用同一 `useAuthStore`（HttpOnly Cookie 同源认证）、同 `LoginPage`。
- 构建坑（已修）：管理页构建**必须** `publicDir:false`，否则会把主 APP 的贴纸/天气图等 `public/` 资源混进管理产物。

---

## 6. 已知问题 / 坑 / 疑难

1. **`lujax.fun` 域名 SNI 封锁（重要）**：未 ICP 备案，本机网络出口对 SNI=`lujax.fun` 的 TLS 握手会 `Connection reset`（443/8444 均如此）。**强制 `--resolve` 到 IP 仍重置，直连 IP 正常** ⇒ 属运营商/主干网域名封锁层，**服务器/Cloudflare 都无法修**。分发**必须用直连 IP 链接**（§4.4）。治本=ICP 备案或换已备案域名。云上后端 `https://lujax.fun:8444/api/v1` 同样受此影响（本机直连 IP + 端口 3001 后端才稳）。
2. **版本一致性**：三端 + 安装包 + 更新源必须同一版本号。
3. **库初始化健壮性**：`isDbInitialized` 须同时校验 db 文件存在且非空（不能只看 `.db-version` 标记，否则 P2021）。
4. **VBS 中文乱码**：改 `.vbs` 用 PowerShell GBK 编码写，别用文本编辑器直改。
5. **Koa/Express 中间件迁移**：`koa-connect` 会泄漏 ctx，须原生 Koa/Express 实现。
6. **构建下载网络问题**：Gradle/`maven.google.com`/`services.gradle.org` 被墙 → 阿里云镜像 + 本地缓存（安卓工程）；Node 切本机 `.workbuddy` v22 以装 Electron 43。
7. **PowerShell 传参**：给 ssh 远端命令时避免 `$(...)` 与嵌套双重引号（会被本地 PowerShell/远端 bash 误解）。
8. **LLM key 不外发**：`LLM_API_KEY` 不打进安装包；别的电脑通过单独交付 `llm.env` 到 `userData\` 激活。
9. **自签名证书**：443 默认站 greenrhino.crt；`lujax .fun` 用 `lujax.fun.crt`（Let's Encrypt，本会话已实测 Verify ok）。

---

## 7. 安全与密钥模型（勿提交 / 勿分发）

| 密钥/凭据 | 位置 | 处理 |
|---|---|---|
| 服务器 root 密码 `trnepwq0101A` | 仅运行时 `AIDEV_SSH_PASS` | 不落盘 |
| `backend/.env`（JWT_SECRET / LLM_API_KEY / ADMIN_PASSWORD / ID_CARD_PEPPER） | 本地 + `/root/backend/.env` | gitignore |
| 云端 RSA 私钥 | `D:\源码存档\助理项目\服务器存档\cloud-jwt-private.pem` | **仅云端** |
| 云端 RSA 公钥 | `electron/resources/backend/cloud-jwt-public.pem` | 随安装包分发，只能验签 |
| Android 签名 keystore | `frontend/android/keys/` | gitignore |
| 访问码（远程文件）BYECPH | 运行时随机 | 重启刷新 |

- 云端角色 = 唯一身份签发方 + AI 网关（RS256 签发，`AUTH_MODE=local`；桌面 `cloud-proxy` 只验不签）。`User` 表含 `aiEnabled/aiPlan/aiExpiresAt`，admin 用 `PATCH /admin/users/:id/ai` 控制开通。

---

## 8. 交接记录线索

- **详档**：`06_审查与交接/交接记录.md` —— 11.3（部署/下载/备份）、11.4（本机链路自检）、变更日志（§11 末尾表格）最有用。
- **代码审查/总纲/开发日记**：`06_审查与交接/` 下同名文件。
- **项目级约定与踩坑**：已沉淀在记忆目录 `c:\Users\Administrator\.trae-cn\memory\projects\...`（新工作台无此记忆，以本文为准）。

---

## 9. 本会话收尾状态（2026-09-10）

- 前端 / 后端 / 桌面 / 安卓全部重新构建，管理入口已移除；三个安装包已上传 `/apk/` 并经直连 IP 验证 206。
- nginx 为 `lujax.fun` 443 站新增 `/apk/`（已 `nginx -t` + reload，备份 `lujax-cloud-https.conf.bak.apk-location-20260910`）。
- 交接记录 11.3 已写入三件套 IP 直链（含 URL 编码与字节数）+ SNI 封锁诊断段。
- 遗留事项：`lujax.fun` 域名需 ICP 备案（或换已备案域名）以便域名直连可用；安卓 APK/桌面安装包已去除管理入口。