# 问题工单 · 成长型

## 索引表

| Master ID | 主题 | 最高优先级 | 子条目数 | 状态 | 最近 |
|---|---|---|---|---|---|
| M-001 | Vite Dev Server 多 HTML 入口 + BUILD_MODE + Proxy | **P0** | 5 | ✅ fixed | 2026-09-30 |
| M-002 | 后端全局错误处理漏接 ZodError | P0 | 1 | ✅ fixed | 2026-09-30 |
| M-003 | 运维操作 / SSH / 数据库直接改 | P1 | 1 | ✅ fixed | 2026-09-30 |
| M-004 | PowerShell 5 环境特定坑 | P1 | 5 | ⚠️ recurring | 2026-10-15 |
| M-005 | Git push / 编码 / 换行符 | P1 | 2 | ⚠️ recurring | 2026-09-30 |
| M-006 | Android 自动更新全链路 | **P0** | 3 | 🔧 fixing | 2026-10-15 |
| M-007 | Continuwuity / Matrix SSO 环境依赖 | P2 | 1 | ⚠️ GAP | 2026-10-27 |

---

## [M-001] Vite Dev Server 多 HTML 入口 + BUILD_MODE + Proxy · P0

**Master 级别 P0**：影响 admin 独立后台 dev 模式完全不可用，踩坑 5 次才通。

### 背景

admin 前端是独立入口（`admin.html → admin-main.tsx → AdminLayout` 绿色侧边栏），不是 App.tsx 的分支。但 admin-vite.config.ts base='/admin/' 后，Vite dev server 默认用 root/index.html → 渲染客户端 main.tsx。

### 子条目

- **[IS-005] Vite dev 返回客户端页面不是管理后台** ✅ 根因 3 层叠加 + 5 次修复尝试
  - 子条：configureServer middleware rewrite 失败（base 处理后 req.url 不匹配）
  - 子条：configureServer 手动读 admin.html + res.end → Vite 不再处理，无 HMR 注入、script src 缺 base 前缀
  - 子条：`appType: 'custom'` → Vite 完全不 serve HTML，全 404
  - 子条：transformIndexHtml 插件返回 admin.html 原始内容 → Vite 不再 transform，结果同上
  - **最终**：middleware `req.url = '/admin/admin.html'`，让 Vite 完整处理 admin.html（注入 HMR + script src 加 base 前缀）

- **[IS-003] Vite `define` 在 dev server 不替换常量** ✅
  - rollup `define` 只在 build 时生效，dev server 用 esbuild transform 不碰
  - **解决**：cross-env 设进程环境变量 + `import.meta.env.VITE_BUILD_MODE`

- **[IS-004] admin-vite.config.ts 缺 proxy → 所有 API 404** ✅
  - 主 vite.config.ts 和 mobile-vite.config.ts 都有 `/api → localhost:3001`，admin 独缺
  - **解决**：补 proxy 块

### 修复代码

```typescript
// admin-vite.config.ts — 正确的 middleware rewrite
configureServer(server) {
  server.middlewares.use((req, _res, next) => {
    if (req.url === '/admin/' || req.url === '/admin') {
      req.url = '/admin/admin.html'  // rewrite，让 Vite 完整处理
    }
    next()
  })
}
```

### 预防规则

1. Vite rollupOptions.input 只在 build 生效，dev server 一律用 root/index.html → 多 HTML 入口项目必须在 configureServer 里 rewrite 或 transformIndexHtml
2. 3 份 vite config（desktop/mobile/admin）proxy 必须一致
3. dev 模式验证：curl `/admin/` 看 HTML 里 script src 是 main.tsx 还是 admin-main.tsx

### commit

`57fec47` admin UI 重做 + middleware rewrite

---

## [M-002] 后端全局错误处理漏接 ZodError · P0

### 子条目

- **[IS-001] pm.routes.ts 6 处 schema.parse 触发 ZodError 返回 500 而非 422** ✅
  - middleware/error.ts 只接 HttpError / GatewayUpstreamError / Prisma Unique / body-parser
  - **修复**：加 ZodError instanceof 判断 → 取第一条 issue.message 返回 422
  - **一次修复覆盖 30+ 路由**（auth/pm/task-team/admin 全链路）

### 修复代码

```typescript
if (err instanceof ZodError) {
  const issue = err.issues[0]?.message || '参数校验失败'
  fail(res, issue, 422)
  return
}
```

### 预防规则

1. 所有 Zod schema.parse 路由必须经过全局 error handler
2. 新增 schema 先想：error.ts 能不能接住？

### commit

`de8b142`

---

## [M-003] 运维操作 / SSH / 数据库直接改 · P1

### 子条目

- **[IS-002] admin 密码重置 3 坑连发** ✅
  - **坑 1**：本地 dev.db 表名 `User`，服务器 prod.db 表名 `users`（小写 s）→ 先 `.tables` 确认
  - **坑 2**：本地和服务器各自独立 admin（本地 16100214673 vs 服务器 tone_test2）→ 先 `SELECT ... WHERE role='admin'` 查清
  - **坑 3**：PS5 SSH 引号嵌套必炸 → 统一写 `.sql` 文件 scp 上去再 `sqlite3 db < file.sql`

### 预防规则

1. 连库前先 `.tables` / `.schema` 确认表名，别假设和本地一样
2. 改线上数据前先 `SELECT` 确认目标记录存在
3. PS5 SSH 不写内联 SQL，一律 .sql 文件

---

## [M-004] PowerShell 5 环境特定坑 · P1

** recurring**：每次用 PowerShell 5 必踩，记下来以后直接避。

- `$PID` 是只读内置变量，别拿它当循环变量
- `Out-File -Encoding UTF8` 带 BOM → Node JSON.parse 炸 `Unexpected token '﻿'` → `[IO.File]::WriteAllText($path, $content, [Text.UTF8Encoding]::new($false))`
- ternary `? :` PS5 不支持 → 用 if/else
- `npx.cmd` vs `npx.ps1` 调用差异 → 统一 `npx.cmd`
- `$content -replace 'slate-', 'accent-'` 误伤 Tailwind `translate-x` → `tranaccent-x`。**根因**：PowerShell `-replace` 是正则子串匹配，不是单词边界。**预防**：批量替换用精确正则 `\bslate-\b` 或先 grep 确认没有包含子串的标识符，写完反向替换脚本修复残留

## [M-005] Git push / 编码 / 换行符 · P1

- Windows 下 LF/CRLF 自动转换会改 diff → `.gitattributes` 配 `* text=auto` + `*.{sh,py,ts,tsx} text eol=lf`
- GitHub SSH key 失效 → `ssh -T git@github.com` 先验

---

## [M-006] Android 自动更新全链路 · P0

### 背景

2026-10-15 用户反馈 App 自动更新弹框点"立即更新"后报 "下载失败：Failed to fetch"，截图为证。

### 子条目

- **[IS-006] fetch() 被 CapacitorHttp 原生插件拦截 → "Failed to fetch"** 🔧 fixing
  - 现象：fetch HTTP URL 失败，curl 服务器 URL 正常返回 200
  - 根因：Capacitor v8 CapacitorHttp 自动注册拦截 WebView fetch，OkHttp 对 HTTP cleartext 有额外限制
  - 修复：UpdateNotice.tsx 改 Filesystem.downloadFile 原生下载 + capacitor.config.ts 禁 CapacitorHttp
  - 状态：代码已改，clean build + install 完成，等用户真机验

- **[IS-007] IntentInstallerPlugin 注册方式不稳** ✅ fixed
  - 现象：logcat 没看到 "Registering plugin instance: IntentInstaller"
  - 根因：BridgeActivity.load() 里 registerPlugin() 可能在某些时序下不生效
  - 修复：MainActivity 改 onCreate() 里 `initialPlugins.add(IntentInstallerPlugin.class)`

- **[IS-008] 早期版本用 window.open 跳转浏览器** ✅ 废弃
  - AppShareCard.tsx 里还留着 window.open('_system') 跳转浏览器下载的旧代码
  - 但这个组件只在聊天里手动触发 app_share 消息时才用，不是自动更新链路
  - 自动更新走 UpdateNotice → Filesystem.downloadFile → IntentInstaller.install

### 修复代码

```ts
// UpdateNotice.tsx — 改前（被 CapacitorHttp 拦截）
const resp = await fetch(info.apkUrl)
const blob = await resp.blob()
const base64 = await blobToBase64(blob)
const writeResult = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Data })

// UpdateNotice.tsx — 改后（原生下载，一步到位）
const dlResult = await Filesystem.downloadFile({ url: info.apkUrl, path: fileName, directory: Directory.Data })
await IntentInstaller.install({ path: dlResult.path })
```

### 预防规则

1. Capacitor 8 项目涉及 HTTP cleartext fetch，先确认是不是被 CapacitorHttp 拦截了
2. 自定义 Capacitor 插件注册用 `initialPlugins.add()` 比 `load()→registerPlugin()` 更稳
3. APK 里搜不到 Kotlin 类名 → classes.dex 用 Mangled 格式存，UTF8 搜不准，换搜 Java 类或看 build/intermediates

---

## [M-007] Continuwuity / Matrix SSO 环境依赖 · P2 · GAP

**GAP-001 本地 Matrix 链路测试天然受限**

- 现象：本地 backend/.env.local 同步了 server admin token + room，但 Continuwuity admin token 会在两种情况下失效：
  ① Continuwuity 0.5.10 fresh reset → admin token 必然变（新 user_id + 新 session）
  ② SSH tunnel 18008→8008 不稳定（K15：tunnel 经常掉，本地 Express 连不上 Continuwuity）
- 预防规则：
  1. **不要信任本地 .env.local 的 admin token**——每次 Continuwuity reset 后必须重新 `POST /_matrix/client/v3/login` 拿新 token，更新 server .env + 本地 .env.local
  2. 本地测 Matrix 链路前，先 SSH 上 server 跑 Node.js matrix-login 脚本验环境 OK，再本地测
  3. Continuwuity Docker reset 后 admin room ID 也会变（新 fresh install 自动建 general room）——必须 `GET /_matrix/client/v3/joined_rooms` 拿新 room ID
  4. **铁律 #56 提示 vs 钩子**：可以考虑写个 preflight-check SSH 脚本——跑 D2 链路前自动验 server admin token + room 有效性

### 已知环境参数（2026-10-27 实测）

```
Continuwuity 版本：0.5.10
Server：47.116.59.141（lujax.fun）
Docker 容器名：continuwuity
Matrix homeserver URL：http://127.0.0.1:8008
Public URL：https://lujax.fun
admin 用户 Matrix ID：@admin:lujax.fun
admin 密码（derived）：SHA256("admin:greenrhino-matrix-sso-v1").slice(0,24) = a080624b0f927e969bd805ec
pm2 app-backend：pid 3004712，端口 3101
```

---

## 合并规则（AGENTS.md 已挂载）

1. 子条目 ≥ 3 条 → 自动升 Master 级别（P2→P1，P1→P0）
2. 同类问题（根因相同）归到同一 Master，不单独开新 Master
3. 每次踩坑先查 Master 索引表，有就 append 子条目，没有才开新 Master
4. 每月归档：closed 的工单移到 issues-archive.md

---

## 独立踩坑快查（未达 Master 级但已踩过）

### 🔴 P0 级（必看）

| 标签 | 问题 | 预防 |
|---|---|---|
| 用户说做过了实际没做 | 必须先 `git ls-remote` / `pm2 list` / curl health 验证远程状态，不能信口头 | 关键远程操作前必验 |
| GitHub CDP bot 防护 | Runtime.evaluate setter 被检测，关键操作让用户手动点浏览器 | 仓库/设置类用用户手动 |
| Chrome user-data-dir 混用 | 启动 CDP Chrome 前 `Stop-Process chrome -Force` | 避免端口被其他 Chrome 抢 |
| SFTP path.join 反斜杠 | Windows path.join 输出 \ 被 SFTP 当文件名，必须用 `/` 或 path.posix.join | 跨平台文件传输禁用 path.join |
| VBS 中文乱码 | 改 .vbs 必须 PowerShell + GBK 读写 | 纯 GBK，不许 UTF-8 |
| Server 备份丢失 | 每次 prod.db 备份必须 3 份（本地+服务器+归档） | 至少保留 3 份不同日期 |
| auth 路由泄漏 | /register 保留但加 deprecated 标记 + 限流 | 废弃前端入口时后端同步处理 |

### 🟠 P1 级

| 标签 | 问题 | 预防 |
|---|---|---|
| 空 DB 假 hash | 初始化先校验 DB 非空 + 表存在，不只看 .db-version hash | 双校验：hash + 文件 |
| koacontext 泄漏 | Express → Koa 迁移优先重写，不要 koa-connect wrapper | 直接写原生 Koa |
| SNI 被封 | lujax.fun 封锁，必须用 `https://47.116.59.141/apk/` 直连 IP | 内测下载统一直连 IP |
| nginx conf chattr +i | 改前 `lsattr` → `chattr -i`，改完 reload + `chattr +i` | 三步不能少 |
| 多 listen 80 的 conf 归属 | 只有带 default_server 的才接直连 IP 流量 | 改前 grep 看归属 |
| gh auth GH_TOKEN 覆盖 | Remove-Item Env:\GH_TOKEN 再登录 | 环境变量优先于凭据 |
| gh auth device code 慢 | 让用户浏览器手动建仓库，AI 只负责 git push | device code 等 25s 超时 |
| nginx heredoc $host 被 PS 展开 | 用反引号转义 `` `$host `` 或本地写文件再 scp | 别在 PowerShell heredoc 里写 nginx 变量 |
| AUTH_MODE cloud-proxy 覆盖新端点 | 本地先加的新端点云端还没 → 强制 AUTH_MODE=local | 不能假设云端永远最新 |
| NSIS vs InnoSetup 参数混淆 | 先二进制搜 `Nullsoft` 确认类型 → NSIS 用 `/S /D=<path>` | 不许默认 InnoSetup |
| SQLite DATETIME 空字符串 | 手动 seed 用 Prisma Client，别 SQL 直接插空串 | Prisma 类型检查更严 |
| Prisma DateTime 比较失效 | 必须 `CAST(col AS INTEGER)` raw SQL，不能 Client `lt: new Date()` | SQLite DateTime 存 INTEGER 毫秒 |
| PM2 kill -9 无效 | 必须 `pm2 restart <name>`，kill 子进程 PM2 会自动拉起 | 查进程名 `pm2 list` 再操作 |
| Capacitor jvmToolchain(21) | root build.gradle `subprojects afterEvaluate kotlin jvmToolchain(17)` 覆盖 | JDK 17 够用！ |
| pm2 进程名漂移 | 文档写 aie-backend 实际叫 backend | 任何远程操作前先 pm2 list |
| 打包版心跳 500 | electron-builder extraResources 漏 cloud-jwt-public.pem | build-desktop.cjs 有自动复制步骤 |
| Vite manualChunks 对象式不匹配 | `'react-vendor': ['react','react-dom']` 只匹配精确路径，node_modules 子路径全漏掉 | 必须用函数式 `(id) => { if(id.includes('pdfjs-dist')) return 'pdfjs-vendor' }` |
| React.lazy 静态声明删路由没用 | `const X = lazy(import(A))` 不管路由用不用都会被 Rollup 打包 | 用条件表达式让 lazy 变 dead code：`const X = BUILD_MODE==='mobile' ? () => null : lazy(import(A))` |

### 🟡 P2 级

| 标签 | 问题 | 预防 |
|---|---|---|
| electronBuilder 进程占用 | 打包前 Stop-Process 绿角犀 -Force | 文件锁没释放 |
| Vite publicDir 位置错 | publicDir 必须和 root 同级，不能放 build 对象里 | Vite 3+ 硬约束 |
| smsService 语法损坏 | 新建含模板字符串的 TS 后立刻 `npx tsc` 验 | 编码转换可能破坏 |
| 版本号漏更 | 5 处同步：constants + package.json×2 + AGENTS + API 返回 | bump 时自动扫 5 落点 |
| Glob 中文路径返空 | 中文路径先 LS 再直接 Read 绝对路径 | 别全量 Glob 中文根 |
| res.json 双序列化 | response 工具函数已返回对象，别再 `res.json(success())` | 检查 helper 是否 wrap |
| PowerShell here-string 破坏模板字符串 | 用 base64 中转 / Node.js 写文件 / 字符串拼接避 ${} | PS 和 JS 模板串同语法必炸 |
| electron-builder publish repo 错 | 加 `--publish never` 跳过 GitHub push 尝试 | electron/package.json publish.repo 要对 |
| Setup.exe /S 被 Defender 拦 | 开发者用 win-unpacked 直拷，不用静默安装 | 无签名 EXE /S 被 SmartScreen 拦 |
| dist 旧版鬼影 | 改源码必须 sync-dist.ps1 → build → 同步 resources | Electron 跑 resources 下的 dist |
| FRP 公网中继 | frpc 没启动 → 3900 超时；schtasks 开机自启 | 公网 3900 不通先查 frpc |
| 后端子路径路由 404 不算 bug | chat.routes.ts 只注册 /chat/sessions 不注册 /chat 根路径，smoke-all 测根会 404 | smoke-all 只测子路径或在路由文件加 `router.get('/', (req,res)=>res.json({ok:true}))` |
| phone 字段漏写 | /register 路由 username 像手机号时同步写 phone | PHONE_RE 正则防御 |
| PowerShell curl 中文 ANSI | 禁止用 curl 发中文 JSON，前端 axios 自动 UTF-8 | PS5 默认 ANSI 编码 |
| Vite timestamp 临时文件混 git | .gitignore 加 `*.timestamp-*.mjs` | Vite 调试时生成 |

---

## 杂项铁律（高频易错）

1. **SQLite 不是 MySQL** — 服务器直接 `sqlite3 prod.db < update.sql`
2. **SQL 带 BOM 头炸** — UTF8Encoding($false) 写无 BOM
3. **表名漂移** — 本地 PascalCase，服务器小写复数，写 SQL 前先 `.tables`
4. **LLM_API_KEY 不进安装包** — key 在服务器 .env，新电脑手动放 llm.env 到 userData/
5. **内测两步走** — 本机验证 → 用户确认 → 传云端
6. **CORS 严格拒绝 `*` + credentials** — 后端动态回显
7. **Nginx 不追加 Access-Control-Allow-Origin** — 避免与后端动态头冲突
8. **PowerShell heredoc 在 SSH 引号嵌套时必炸** — 写 .sh 文件 scp 上去
9. **Electron 每次 build SHA256 变** — 打完包必须更新 prod.db windows_releases 表
10. **重要信息变更必跑 secrets-sync-checklist SKILL** — 改完 secrets.md → Grep 全项目扫残留旧值（pm2 三次漂移教训）
11. **后端生产用 Pino 替换 console.error/warn** — Express 官方推荐，比 Winston 快 5-10x，内置 redact 脱敏
12. **绿角犀有两个项目不能混** — 看图 APP=Express/SQLite 本地跑（端口 3001），ERP=NestJS/MySQL 在 47.116.59.141（端口 3000）（2026-10-18 严重教训：搞混导致 SSH 命令全错）
