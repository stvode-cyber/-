# 问题工单（Issues）

> 每条必含：问题描述 · 影响范围 · 根因 · 解决方案 · 验证方式 · 状态 · 关联 commit / 台账
> 状态：open → fixing → fixed → closed
> 优先级：P0（阻塞/数据丢失）· P1（功能异常）· P2（体验/性能）

---

## [P0][IS-001] ZodError 全局 handler 漏接 → 参数校验失败返回 500

- **发现**：2026-09-30 16:30 · pm.routes.ts 全链路冒烟测试
- **状态**：✅ fixed
- **问题**：pm.routes.ts 6 处 schema.parse(req.body) 触发 ZodError，但 backend/src/middleware/error.ts 全局 errorHandler 没有 ZodError instanceof 判断，走到最后 else 分支返回 500 "服务器内部错误"，前端无法区分"参数错"还是"服务器炸"
- **影响范围**：所有用 Zod schema.parse 的后端路由（auth/pm/task-team 等 30+ 路由）
- **根因**：errorHandler 只接了 HttpError / GatewayUpstreamError / Prisma Unique Constraint Error / body-parser，漏掉了 ZodError
- **解决方案**：errorHandler 加 ZodError instanceof 分支 → fail(res, issues[0].message, 422)
- **验证**：POST /api/v1/pm/projects body 传 {status:'archived'}（非法枚举）→ 返回 HTTP 422 + "Invalid enum value. Expected 'active' | 'done' | 'cancelled'" ✅
- **commit**：de8b142 · fix(backend): ZodError -> 422 global handler
- **关联台账**：daily/2026-09-30.md · pitfalls.md（ZodError 条目）

## [P1][IS-002] admin 密码重置：表名/用户名/PS SSH 引号 3 坑连发

- **发现**：2026-09-30 17:20 · 用户忘记 admin 密码，本地 + 服务器双端重置
- **状态**：✅ fixed（本地 dev + 公网 prod 都已重置成功）
- **问题**：连续踩 3 个坑才搞定
  ① sqlite3 prod.db "UPDATE User ..." 报 no such table: User
  ② WHERE 子句里 role='admin' 匹配不到（PS SSH 引号嵌套炸，SQL 实际没进服务器）
  ③ 服务器 admin 用户名是 tone_test2（不是本地的 16100214673，双 admin 账号）
- **影响范围**：服务器 prod.db admin 账号登录；PS5 SSH 远程操作可靠性
- **根因**：
  ① 本地 dev.db 是 Prisma 默认表名 User，服务器 prod.db 迁移后表名 users（小写 s）
  ② PS5 ssh "sqlite3 db 'SELECT role='"'"'admin'"'"'"'" → bash 报 incomplete input
  ③ 本地和服务器各自独立注册了 admin（本地首位注册者 16100214673，服务器首位 tone_test2）
- **解决方案**：
  ① 先 sqlite3 .tables 确认表名，别假设和本地一致
  ② 统一写 .sql 文件 → scp 上去 → sqlite3 db < file.sql（PS SSH 引号嵌套无解）
  ③ 先 SELECT username, role FROM users WHERE role='admin' 查清楚再 UPDATE
- **验证**：
  - 本地 dev：/api/v1/auth/login username=16100214673 password=admin123ABC → HTTP 200 + role=admin ✅
  - 公网 prod：https://47.116.59.141/api/v1/auth/login username=tone_test2 password=admin123ABC → HTTP 200 + role=admin ✅
- **prod.db 备份**：prod.db.bak-before-reset
- **关联台账**：daily/2026-09-30.md · pitfalls.md（表名漂移 + 双 admin + PS SSH 引号 3 条）

## [P1][IS-003] Vite BUILD_MODE dev 模式 define 不替换

- **发现**：2026-09-30 16:00 · 4 端口全链路验证时发现 5173/5174 都报 __BUILD_MODE__ is not defined
- **状态**：✅ fixed
- **问题**：vite.config.ts define: { __BUILD_MODE__: JSON.stringify('desktop') } 只在 Rollup build 时替换常量，Vite dev server 用 esbuild transform 不碰它，dev 模式下 __BUILD_MODE__ 原样保留，浏览器 ReferenceError
- **影响范围**：4 端口分离方案（desktop/mobile/admin）dev 模式全部不可用
- **根因**：Vite define = Rollup define plugin（只 build 生效），esbuild 自己的 define 和 Rollup 的 define 走两条链路
- **解决方案**：废弃 define 方案 → 改用 cross-env VITE_BUILD_MODE=desktop + import.meta.env.VITE_BUILD_MODE（Vite 对 import.meta.env 在 dev 和 build 都做替换）
- **npm script**：
  - "dev": "cross-env VITE_BUILD_MODE=desktop vite" (5173)
  - "dev:mobile": "cross-env VITE_BUILD_MODE=mobile vite --config mobile-vite.config.ts" (5174)
  - "dev:admin": "cross-env VITE_BUILD_MODE=mobile vite --config admin-vite.config.ts" (5175)
- **关联 commit**：255dd65 · fix(build): cross-env VITE_BUILD_MODE dev-mode pruning
- **关联台账**：daily/2026-09-30.md · pitfalls.md（Vite define/dev 不生效 + envFile 加载空 + PS BOM 3 条）

---


## [P1][IS-004] admin-vite.config.ts 缺 proxy → 管理后台所有 API 404

- **发现**：2026-09-30 18:00 · 用户打开 http://localhost:5175/admin 看到 {"code":404,"message":"接口不存在"}
- **状态**：✅ fixed
- **问题**：admin 前端 dev server (5175) 调 /api/v1/pm/projects 等请求直接返回 Vite 404，没转发到后端 3001
- **影响范围**：管理后台所有 API（/admin/users, /pm/projects, /task-team 等）
- **根因**：admin-vite.config.ts 的 server 配置只有 port + strictPort，**缺 /api → http://localhost:3001 proxy**。主 vite.config.ts 和 mobile-vite.config.ts 都有这个配置，唯独 admin 忘了加
- **为什么之前没发现**：admin 前端是后来加的，当初只关心 build 能产出 admin-dist，忘了 dev 模式也要跑起来测 API
- **解决方案**：admin-vite.config.ts server 里加 proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } }
- **验证**：
  - GET /api/v1/pm/projects/stats (no token) → HTTP 401 ✅（不是 404，说明 proxy 通了）
  - 登录 → token → 带 token 调 /pm/projects/stats /admin/users /pm/projects /task-team → 全 HTTP 200 ✅
- **commit**：下一个
- **关联台账**：daily/2026-09-30.md## 挂台账索引

| 编号 | 日期 | 优先级 | 一句话摘要 | 状态 |
|---|---|---|---|---|
| IS-001 | 2026-09-30 | P0 | ZodError 全局 handler 漏接 → 500 | ✅ fixed |
| IS-002 | 2026-09-30 | P1 | admin 密码重置 3 坑连发（表名/用户名/SSH 引号） | ✅ fixed |
| IS-003 | 2026-09-30 | P1 | Vite define dev 不替换
| IS-004 | 2026-09-30 | P1 | admin-vite.config.ts 缺 proxy → 所有 API 404 | ✅ fixed | → cross-env import.meta.env | ✅ fixed |
