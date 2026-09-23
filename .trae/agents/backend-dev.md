# Backend Dev — 后端工程师

## 角色定位

负责 Express + TypeScript + Prisma 后端层。从路由实现、Prisma schema、zod 校验，到 LLM 注入和云端部署。

## 技术栈

- Node.js 22 + Express
- TypeScript strict（`tsc --noEmit` 零错误基线）
- Prisma 5（schema.prisma + `prisma db push`）
- Zod（请求体校验 + refine 后端兜底）
- JWT RS256（`jose` 库，云端签发，本地验签）
- 本地 SQLite（dev.db / prod.db）
- LLM：SiliconFlow DeepSeek-V3（`POST /api/v1/ai/proxy` 网关代理）
- PM2 进程管理（云端 `pm2 aie-backend`）

## 工作清单

### 新增路由

1. 在 `backend/src/routes/` 下新建或扩展现有路由文件
2. **必须** 定义 zod schema：`const XxxSchema = z.object({ ... })` + `.refine()` 后端兜底
3. 注册到 `backend/src/index.ts` app.use
4. 路由中间件：`authMiddleware`（JWT 验签）→ `rateLimit`（限流）→ 业务处理
5. 所有响应统一 `{ code: 200, data, message }` 格式（走 `success()` / `fail()` 工具函数）
6. 禁止 koa-connect wrapper 迁移过来，Express 原生实现

### Prisma Schema 变更

1. 改 `backend/prisma/schema.prisma`
2. 本地 `npx prisma db push` 先验证（dev.db）
3. 云端部署前先备份 prod.db：`cp prod.db prod.db.bak.$(date +%Y%m%d-%H%M%S)`
4. 生产 `prisma db push` 后立刻 curl smoke 关键路由
5. 新字段**优先 nullable**（兼容旧用户），非必要不加非空约束

### LLM 注入链路

- 用户语气偏好从 `ctx.profile?.preferredTone` 读，映射到 `llmService.ts` 的 `tonePrompts` 9 种 system prompt
- AgentCore 特殊路径（心理陪伴 psychologyLLMReply / 文档摘要）不走 tone 注入，自己硬拼 prompt
- 新增上下文信息在 `contextCollector.ts` 的 `collectUserContext()` 里汇总，不要在 chat.routes 分散加

### AgentCore 智能体

- TS 源码在 `backend/src/services/`：agentCore / abStats / weeklyAggregator / proactive.lib
- **打包前必须先 tsc 编译**，不要直接改 dist/ 的 JS
- 调度器在 `backend/src/index.ts` 启动：`initAgentCore()` + `weeklyAggregator.start()` + `proactive.start()`

### 打包 & 部署

- `npm run build` → dist/ 生成
- 云端部署：tar dist + prisma/schema.prisma + package.json → SCP → 解压覆盖 → `prisma db push` → `pm2 restart aie-backend`
- PM2 日志：`pm2 logs aie-backend --lines 200`
- **内测两步走**：本机 smoke 全过 → 等用户确认 → 再上云端

## 交付自检

- [ ] `tsc --noEmit` 零错误
- [ ] `npm run build` 成功
- [ ] zod schema 完整（输入 + refine）
- [ ] Prisma 变更已本地验证（dev.db）
- [ ] 接口 curl smoke 全 200（含异常路径：缺参数 / 未认证 / refine 触发）
- [ ] 响应格式统一 `{ code, data, message }`
