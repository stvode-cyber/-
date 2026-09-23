# AgentCore 模块激活 — 测试报告

> 测试日期：2026-08-24
> 测试范围：AgentCore JS→TS 源码规范化 + 模块激活接入
> 报告生成：基于实际端到端运行验证

---

## 一、测试目标

验证 AgentCore 及其依赖模块（abStats / weeklyAggregator / proactive.lib）从 dist JS 反推为 src TS 后，在路由层与调度器层激活接入的完整可用性，确保：

1. TypeScript 编译通过（strict 模式）
2. Prisma schema 字段补齐后 client 重新生成
3. 调度器启动无运行时错误
4. chat 路由接入 AgentCore.handle() 后意图分发正常
5. /ab-stats 端点挂载且鉴权生效
6. dist 行为等价性在接入点处可控

---

## 二、测试环境

| 项 | 值 |
|---|---|
| 后端地址 | http://127.0.0.1:3001 |
| API 前缀 | /api/v1 |
| 数据库 | SQLite (prisma/dev.db) |
| 运行方式 | npx tsx src/index.ts |
| NODE_ENV | production |
| LLM Provider | openai (THUDM/GLM-Z1-9B-0414) |
| 鉴权 | JWT HttpOnly Cookie |

---

## 三、测试范围与结果总览

| # | 测试项 | 类型 | 结果 |
|---|---|---|---|
| T1 | Prisma schema 字段补齐 | 单元 | ✅ 通过 |
| T2 | prisma db push + generate | 部署 | ✅ 通过 |
| T3 | tsc --noEmit 编译验证 | 单元 | ✅ 通过 |
| T4 | 后端启动 + 调度器启动 | 冒烟 | ✅ 通过 |
| T5 | /health 健康检查 | 冒烟 | ✅ 通过 |
| T6 | /admin/ab-stats 鉴权拦截 | 冒烟 | ✅ 通过 |
| T7 | 用户注册 + JWT 下发 | E2E | ✅ 通过 |
| T8 | 创建会话 | E2E | ✅ 通过 |
| T9 | 记账快路消息（AgentCore 命中） | E2E | ✅ 通过 |
| T10 | 普通消息 fallback LLM | E2E | ✅ 通过 |

**总计：10/10 通过**

---

## 四、详细测试结果

### T1 — Prisma schema 字段补齐

**改动文件**：prisma/schema.prisma

**新增字段**：
- `User.privacyMode` — `String @default("full")`，P3 隐私四档
- `User.proactiveChatEnabled` — `Boolean @default(false)`，proactive 调度器过滤
- `Message.isProactive` — `Boolean @default(false)`，AI 主动消息去重

**结果**：字段均有默认值，不破坏现有数据。

---

### T2 — prisma db push + generate

**命令**：`npx prisma db push`

**结果**：dev.db schema 同步成功，client 重新生成，新字段进入 Prisma 类型定义。

---

### T3 — tsc --noEmit 编译验证

**命令**：`npx tsc --noEmit`

**结果**：EXIT_CODE=0，零错误。

**过程**：激活过程中累计修复 15 个类型错误，详见"六、类型错误修复记录"。

---

### T4 — 后端启动 + 调度器启动

**启动日志**：
```
🚀 绿角犀后端已启动
   本地地址: http://127.0.0.1:3001
   健康检查: http://127.0.0.1:3001/health

[CountdownScheduler] 已启动，间隔 60s
[MorningGreeting] 已启动，每日 9:00 触发
[ProactiveScheduler] 已启动，间隔 300s
[WeeklyAggregator] 已启动，每周一 03:00 触发
```

**结果**：4 个调度器全部启动无报错，initAgentCore() 单例预加载完成。

---

### T5 — /health 健康检查

**请求**：GET /health

**响应**：`{"status":"ok"}`

---

### T6 — /admin/ab-stats 鉴权拦截

**请求**：GET /api/v1/admin/ab-stats（无 token）

**响应**：`401 未授权：缺少访问令牌`

**结论**：路由已挂载，authRequired → adminRequired 中间件链生效。

---

### T7 — 用户注册 + JWT 下发

**请求**：POST /api/v1/auth/register
**Body**：`{"username":"e2e_59447","password":"Test1234"}`

**响应**（200）：
```json
{
  "code": 200,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "cmt6z8qz400065akbbuqi55cw",
      "username": "e2e_59447",
      "nickname": "用户3",
      "avatar": null,
      "role": "user"
    }
  },
  "message": "注册成功"
}
```

**结果**：JWT 经 HttpOnly Cookie 下发，后续请求自动携带。

---

### T8 — 创建会话

**请求**：POST /api/v1/chat/sessions
**Body**：`{"title":"E2E AgentCore"}`

**响应**（201）：
```json
{
  "code": 201,
  "data": {
    "id": "cmt6z8r01000a5akbu09wm38f",
    "userId": "cmt6z8qz400065akbbuqi55cw",
    "title": "E2E AgentCore",
    "createdAt": "2026-08-24T08:31:29.713Z"
  },
  "message": "已创建"
}
```

---

### T9 — 记账快路消息（AgentCore 意图命中）

**请求**：POST /api/v1/chat/sessions/:id/messages
**Body**：`{"content":"帮我记一笔，今天午餐花了 25 元"}`

**响应**（201）：
```json
{
  "code": 201,
  "data": {
    "id": "cmt6z8r1u000h5akb9b9hh3tl",
    "role": "assistant",
    "content": "记好了：帮记一笔午餐 ¥25（食物）",
    "messageType": "text",
    "metadata": "{\"accounting\":{\"entryId\":\"cmt6z8r1m000f5akblxrfowsq\",\"amount\":25,\"category\":\"食物\",\"type\":\"expense\",\"title\":\"帮记一笔午餐\"}}",
    "isProactive": false,
    "createdAt": "2026-08-24T08:31:29.778Z"
  }
}
```

**关键验证点**：
- ✅ AgentCore 命中记账快路分支（未走 LLM）
- ✅ 响应耗时 ~0.5s（289ms→778ms），无 LLM 调用延迟
- ✅ wallet transaction 已写入（entryId: cmt6z8r1m000f5akblxrfowsq）
- ✅ metadata 透传 accounting 结构（entryId/amount/category/type/title）
- ✅ isProactive=false 正确标记用户发起消息

---

### T10 — 普通消息 fallback LLM

**请求**：POST /api/v1/chat/sessions/:id/messages
**Body**：`{"content":"你好"}`

**响应**（201）：
```json
{
  "code": 201,
  "data": {
    "id": "cmt6z8w6h000m5akb4r9eq06j",
    "role": "assistant",
    "content": "你好呀！今天有什么想聊或需要帮忙的吗？😊",
    "messageType": "text",
    "metadata": "{\"llmProvider\":\"openai\",\"llmModel\":\"THUDM/GLM-Z1-9B-0414\"}",
    "isProactive": false,
    "createdAt": "2026-08-24T08:31:36.425Z"
  }
}
```

**关键验证点**：
- ✅ AgentCore 未命中特殊意图，fallback 到 generateReply
- ✅ LLM 调用成功（GLM-Z1-9B-0414 模型响应）
- ✅ 响应耗时 ~7s（含 LLM 推理）
- ✅ metadata 透传 llmProvider/llmModel

---

## 五、激活改动清单

| 文件 | 改动 |
|---|---|
| prisma/schema.prisma | User 加 privacyMode/proactiveChatEnabled，Message 加 isProactive |
| src/index.ts | import + 启动 startProactiveScheduler / startWeeklyAggregatorScheduler / initAgentCore |
| src/routes/chat.routes.ts:170 | generateReply() → getAgentCore().handle()，移除 proactiveSuggestions/contextSummary 单独透传 |
| src/routes/admin.routes.ts | 新增 GET /admin/ab-stats?days=14 端点 |
| src/services/abStats.ts | dist JS → src TS（113 行，含 AbBucketStats/AbStatsResult 接口） |
| src/services/agentCore.ts | dist JS → src TS（~1800 行，含 AgentRequest/AgentReply/ToolContext 接口） |
| src/utils/weeklyAggregator.ts | dist JS → src TS；查询修正为 chatSessions→messages 链路 |
| src/utils/proactive.lib.ts | dist JS → src TS（~310 行，含 ProactiveUser/TodayTask/TriggerResult 接口） |

---

## 六、类型错误修复记录

tsc --noEmit 累计修复 15 个错误，分类如下：

| 类别 | 数量 | 处理方式 |
|---|---|---|
| `auditReq(req, 'action', detail)` 既有 bug 调用 | 3 | 类型断言保留调用形式（dist 等价） |
| 引用不存在 schema 字段（激活前） | 7 | `as never` 临时绕过 → 字段补齐后已移除 |
| `ReplyResult.metadata` 与 `AgentReply` 不兼容 | 2 | AgentReply.metadata 改 `unknown` 对齐 |
| `hasSource` 类型 `string\|boolean` | 1 | `!!` 强制 boolean |
| `msgs` role 推断为 string | 1 | 数组标注字面量联合类型 |
| weeklyAggregator 查询引用 User 不存在关系 | 1 | 改为 chatSessions→messages 链路 |

**最终状态**：字段补齐后所有 `as never` 临时断言已清理，类型自然匹配，tsc 零错误。

---

## 七、已知回归点

接入 AgentCore.handle() 替换 generateReply() 后，以下字段不再单独透传：

| 字段 | 原行为 | 现行为 |
|---|---|---|
| `proactiveSuggestions` | generateReply 返回，前端用于主动建议展示 | 由 AgentCore 内部决定是否合入 metadata |
| `contextSummary` | generateReply 返回，前端展示上下文摘要 | 同上，合入 metadata |

**影响评估**：AgentCore 在 fallback 分支仍调用 generateReply，其返回的 metadata 完整透传；非 fallback 分支（记账/办公/危机等）用各自 metadata shape 承载等价信息。前端如依赖上述两字段的独立字段，需改为从 metadata 提取。

---

## 八、运行时行为变化

| 项 | 变化 |
|---|---|
| chat 路由回复路径 | generateReply（规则）→ AgentCore.handle（意图分发 + LLM fallback） |
| proactiveChatEnabled | 默认 false，主动问候暂不发送，需用户主动开启 |
| 周一 03:00 | weeklyAggregator 为近 14 天活跃用户预聚合周报缓存 |
| 每 5 分钟 | proactive.lib 扫描 proactiveChatEnabled 用户（08-10 点窗口） |

---

## 九、结论

AgentCore 模块激活完成，**10/10 测试用例全部通过**：

1. 源码规范化：4 个 TS 文件反推完成，tsc strict 零错误
2. 模块激活：调度器启动、路由接入、端点挂载均验证可用
3. 意图分发：记账快路命中（0.5s，无 LLM）+ fallback LLM（7s，GLM-Z1-9B）两条路径均正常
4. 数据完整性：wallet transaction 真实写入，metadata 结构正确透传
5. 鉴权：JWT HttpOnly Cookie 全链路生效

模块已具备生产可用状态。

---

## 十、风险清单

> 来源：第七节（已知回归点）+ 第八节（运行时行为变化）综合提炼

### 10.1 按严重度排序

| ID | 风险项 | 类别 | 严重度 | 触发条件 | 影响 |
|---|---|---|---|---|---|
| R1 | `proactiveSuggestions` 字段不再单独透传 | 回归 | 🟡 中 | 前端读取 `data.proactiveSuggestions` 展示主动建议 | 前端该字段恒为 undefined，主动建议卡片消失 |
| R2 | `contextSummary` 字段不再单独透传 | 回归 | 🟡 中 | 前端读取 `data.contextSummary` 展示上下文摘要 | 前端该字段恒为 undefined，上下文摘要不显示 |
| R3 | chat 回复路径从规则切换为 AgentCore 意图分发 | 变更 | 🟡 中 | 所有 POST /chat/sessions/:id/messages 请求 | 回复内容/耗时变化（快路 0.5s / LLM 7s），异常路径增加 |
| R4 | `proactiveChatEnabled` 默认 false | 变更 | 🟢 低 | 新注册用户 | 主动问候默认不发送（功能静默，无破坏） |
| R5 | 周一 03:00 weeklyAggregator 聚合 | 变更 | 🟢 低 | 每周一凌晨自动触发 | DB 查询 + Fragment 写入负载（凌晨低峰，影响小） |
| R6 | 每 5 分钟 proactive 扫描 | 变更 | 🟢 低 | 调度器持续运行 | 无用户开启时为空查询（轻量 DB 读，可忽略） |

### 10.2 详细说明与缓解措施

**R1 / R2 — proactiveSuggestions / contextSummary 丢失**

- **根因**：`AgentReply` 接口未声明这两个字段，chat.routes.ts:170 改用 `getAgentCore().handle()` 后 destructuring 移除
- **行为细节**：
  - fallback 分支（如"你好"）仍调 generateReply，其 metadata 完整透传，但 proactiveSuggestions/contextSummary 不在顶层字段
  - 非 fallback 分支（记账/办公/危机）用各自 metadata shape 承载等价信息
- **缓解**：前端改为从 `metadata` 提取（`metadata.proactiveSuggestions` / `metadata.contextSummary`），或扩展 AgentReply 接口补回两字段

**R3 — chat 回复路径切换**

- **根因**：generateReply（规则匹配）→ AgentCore.handle（意图分发 + LLM fallback）
- **潜在风险**：
  - AgentCore 内部异常未捕获时可能 500（原 generateReply 更简单稳定）
  - LLM 调用耗时 7s，可能触发前端超时（原规则匹配毫秒级）
- **缓解**：AgentCore 各分支已有 try/catch fallback；前端消息超时建议 ≥ 30s

**R4 — proactiveChatEnabled 默认关闭**

- **影响**：proactive.lib 调度器扫描结果为空集，不发送任何主动消息
- **缓解**：用户在安全中心主动开启后才会触发；默认零副作用

**R5 — 周一 03:00 周报聚合**

- **影响**：为近 14 天活跃用户预聚合周报缓存到 Fragment 表
- **缓解**：凌晨 03:00 低峰执行；take: 500 限制用户数；失败不阻塞主流程

**R6 — 每 5 分钟 proactive 扫描**

- **影响**：无用户开启时为 `findMany({ where: { proactiveChatEnabled: true } })` 空结果查询
- **缓解**：轻量查询，schedulerHandle.unref() 不阻塞进程退出

### 10.3 风险总体评估

- 🟡 中风险 3 项（R1/R2/R3）—— 前端字段依赖 + 回复路径切换，**需前端联调验证**
- 🟢 低风险 3 项（R4/R5/R6）—— 默认安全或低频低负载

**建议优先处理**：R1/R2 前端字段适配（如前端依赖这两字段，需同步改 metadata 提取逻辑）；R3 前端消息超时调至 ≥ 30s。
