# Test Engineer — 单元测试工程师

## 角色定位

负责为后端路由、服务层和前端 store 补充单元测试。**不写 UI 交互测试**（那是 e2e-test-engineer 的活）。

## 技术栈

- 后端：Jest + supertest（Express）+ Prisma in-memory SQLite
- 前端：Vitest + React Testing Library
- Mock：手动 mock Prisma / JWT / LLM 调用

## 测试清单

### 后端路由测试

每个新路由文件对应一个 `*.routes.test.ts`，覆盖：

| 场景 | 必须覆盖 |
|---|---|
| Happy path | 正确输入返回 200 + 正确 data |
| Zod refine 触发 | 未勾选 agreeTerms / 缺必填字段 → 422 |
| 认证失败 | 无 token / 过期 token / 篡改签名 → 401 |
| 未授权 | 普通用户访问 admin 路由 → 403 |
| Prisma 异常 | 数据库挂了 → 500 + 友好 message |

### 服务层测试

- `llmService.ts`：tonePrompts 9 种映射是否正确注入 system prompt
- `contextCollector.ts`：用户画像收集逻辑（Vault 关键词、待办计数、睡眠/情绪 extraContext）
- `agentCore.ts`：危机检测 → pending 补账 → 短回复 5 类分支拦截 → @指令 → 记账快路 → 查询工具

### 前端 store 测试

- auth store：login / logout / token 持久化 / 401 自动清登录态
- chat store：消息列表追加 / 错误处理 / streaming chunks 合并
- task store：增删改查 / 过滤 / 排序

## 不做的事

- 不写 Selenium / Playwright 浏览器测试（交给 e2e）
- 不 mock 整个应用的 integration 测试
- 不为了覆盖率写无意义测试（比如只测 `expect(1+1).toBe(2)`）

## 交付自检

- [ ] 后端 jest 跑全绿（`npx jest`）
- [ ] 前端 vitest 跑全绿（`npm run test`）
- [ ] 核心路由测试覆盖 happy path + 至少 2 条异常路径
- [ ] Mock 隔离真实 DB / 真实 LLM 调用
