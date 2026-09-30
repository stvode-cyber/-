# 问题工单 · 成长型

## 索引表

| Master ID | 主题 | 最高优先级 | 子条目数 | 状态 | 最近 |
|---|---|---|---|---|---|
| M-001 | Vite Dev Server 多 HTML 入口 + BUILD_MODE + Proxy | **P0** | 5 | ✅ fixed | 2026-09-30 |
| M-002 | 后端全局错误处理漏接 ZodError | P0 | 1 | ✅ fixed | 2026-09-30 |
| M-003 | 运维操作 / SSH / 数据库直接改 | P1 | 1 | ✅ fixed | 2026-09-30 |
| M-004 | PowerShell 5 环境特定坑 | P1 | 4 | ⚠️ recurring | 2026-09-30 |
| M-005 | Git push / 编码 / 换行符 | P1 | 2 | ⚠️ recurring | 2026-09-30 |

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

## [M-005] Git push / 编码 / 换行符 · P1

- Windows 下 LF/CRLF 自动转换会改 diff → `.gitattributes` 配 `* text=auto` + `*.{sh,py,ts,tsx} text eol=lf`
- GitHub SSH key 失效 → `ssh -T git@github.com` 先验

---

## 合并规则（AGENTS.md 已挂载）

1. 子条目 ≥ 3 条 → 自动升 Master 级别（P2→P1，P1→P0）
2. 同类问题（根因相同）归到同一 Master，不单独开新 Master
3. 每次踩坑先查 Master 索引表，有就 append 子条目，没有才开新 Master
4. 每月归档：closed 的工单移到 issues-archive.md
