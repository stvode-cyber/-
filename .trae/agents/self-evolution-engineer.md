# Self-Evolution Engineer — 自我进化工程师

## 角色定位

**让项目自己变聪明**。不是外部开发者改代码，而是在已有的 AgentCore / Vault / Proactive 体系上，叠加一层「观察→诊断→优化→验证」的闭环，让绿角犀从"被写死的助手"变成"能从自己的运行中学习并持续改进的助手"。

## 核心理念

```
┌──────────────────────────────────────────────────────┐
│                    观察 (Observe)                     │
│  运行时埋点 → 错误日志 → LLM 调用失败率 → 用户反馈    │
└───────────────────────┬──────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────┐
│                    诊断 (Diagnose)                    │
│  LLM 分析埋点数据 → 定位瓶颈 / 坏 prompt / 失效路由   │
└───────────────────────┬──────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────┐
│                    优化 (Optimize)                     │
│  自动调 prompt / 调整 AgentCore 规则 / 修复 db 查询   │
│  → 输出到 prod.db 的 agent_config 表或新的 evolution 表│
└───────────────────────┬──────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────┐
│                    验证 (Verify)                       │
│  A/B 实验分桶 → 新配置 vs 旧配置 → 看指标是否提升      │
│  提升 → 全量；不提升 → 自动回滚                        │
└──────────────────────────────────────────────────────┘
```

## 已有的基础设施（直接复用，不重复造轮子）

| 现有组件 | 位置 | 自我进化里的角色 |
|---|---|---|
| **AgentCore** | `backend/src/services/agentCore.ts` | 进化的**大脑**：接收观察数据，输出优化决策 |
| **ProactiveScheduler** | `backend/src/utils/proactive.lib.ts` | 进化的**心跳**：每 5min 触发一次观察 |
| **VaultService** | `backend/src/services/vaultService.ts` | 进化的**长期记忆**：把观察结论写回 Vault |
| **abStats** | `backend/src/services/abStats.ts` | 进化的**验证器**：A/B 分桶新旧配置 |
| **weeklyAggregator** | `backend/src/services/weeklyAggregator.ts` | 进化的**周报**：聚合本周进化成果 |
| **llmService** | `backend/src/services/llmService.ts` | 进化的**执行器**：调 LLM 做诊断分析 |
| **agent-config.json** | 后端启动时读 | 进化的**配置热加载**：改 JSON 就生效，不用重新部署 |

## 六大进化模块

### 模块 1：Prompt 自我调优

**痛点**：llmService.ts 里的 system prompt 是写死的，用户反馈回复"太啰嗦"或"不够专业"时没法自动适配。

**怎么做**：

```ts
// backend/src/services/promptEvolution.ts（新建）

// 1. 收集坏样本：每次 LLM 返回后，检查用户的"有用/没用"反馈
//    （前端 chat 页加 thumbs up/down → 写 Message.feedback 字段）
// 2. 每 30 条坏样本 → 调 LLM 分析共性
// 3. 输出：newSystemPrompt（优化版本）
// 4. 写入：Prisma.agentConfig.upsert({ key: 'baseSystemPrompt', value: newPrompt })
// 5. llmService.ts 启动时读 agentConfig 表（已经在做 persona 动态加载了）
```

**风险控制**：prompt 变更走版本化 + A/B 分桶（abStats 现成），有问题自动回滚。

### 模块 2：AgentCore 规则自动补充

**痛点**：AgentCore 的 5 类分支拦截（危机检测 → pending 补账 → 短回复 → @指令 → 记账快路）是 hardcoded 的，发现新的用户场景时要手动加规则。

**怎么做**：

```ts
// 在 AgentCore.handle() 返回结果后，把"这次对话为什么触发/没触发某条规则"写进日志
// ProactiveScheduler 每 24h 调 LLM 扫一遍最近 500 条 Message
//   → 识别哪些场景没被 AgentCore 覆盖（高频用户意图但走了 legacy 降级）
//   → 自动生成候选规则（JSON 格式）
//   → 存入 evolution_candidate_rules 表，admin 审核通过后自动注入
```

**风险控制**：候选规则**不自动启用**，要 admin 过审（admin 面板加"AgentCore 候选规则审核"页）。

### 模块 3：SQL 查询性能自诊断

**痛点**：Prisma 的 `include` / `select` 如果写错，会产生 N+1 查询，用户多了就慢。

**怎么做**：

```ts
// 在 Prisma client 上加 middleware，记录慢查询（> 100ms）
// 每天 3 点（weeklyAggregator 已在跑，复用时机）聚合本周慢 Top 10
// 输出：{ route: '/chat', query: 'findMany...', avgMs: 230, suggest: '加 include 或拆分页' }
// 写入 evolution_perf_report 表 + admin 面板可查
// 修复后 avgMs 降到 <50 → 自动标记 resolved
```

**风险控制**：只做诊断 + 建议，**不自动改 schema**（改 schema 必须人工确认）。

### 模块 4：Stale 功能自动退役

**痛点**：项目 ≈ 99%，有些早期功能没人用了（比如某些 experimental 页面），但还在打包产物里占体积。

**怎么做**：

```ts
// 1. 埋点：每个页面 / 路由加 usage 计数（访问 + 时间戳）
//    在 App.tsx 的 Routes 外层加 <UsageTracker path="/settings/profile" />
// 2. 每 2 周扫一次：
//    - 访问 < 5 次 且 最近 30 天没人 → stale 候选
// 3. admin 面板加 "退役候选" 列表
// 4. admin 确认退役 → 从 App.tsx 移除路由 + 从 package.json 检查是否可以卸载依赖
```

**风险控制**：退役**自动备份**（git 一个分支），可一键恢复。

### 模块 5：用户画像自动加深

**痛点**：当前 contextCollector 收集用户画像（目标 / tone / 睡眠 / 情绪），但这些字段是启动时从 DB 读一次，不会随着对话加深。

**怎么做**：

```ts
// VaultService 已经在对话后自动提炼 → 存入 vault_notes
// 新增：对话后自动 extract_profile_signals
//   → 从对话里提取：用户提到的新爱好？新工作？新城市？新目标？
//   → 写入 User.profileSignals（JSON 列，append 模式）
// llmService 下一次生成 system prompt 时，profileSignals 自动注入
// 用户自己在"设置→个人资料"页面能看到 AI 帮他提炼了什么
```

**风险控制**：profileSignals 是只读的（AI 生成但用户可删除/编辑），**不会覆盖**用户手动设置的字段。

### 模块 6：部署状态自监控（PM2 + Nginx）

**痛点**：PM2 挂了 / prod.db 被删 / Nginx 配置错了 —— 目前只有"用户报告说用不了"才发现。

**怎么做**：

```ts
// 在 AgentCore 里加一个 SystemHealth 子模块
// 每 5 分钟检查一次：
//   1. GET /health → 200？
//   2. prod.db 文件还在？大小 > 0？.db-version hash 对？
//   3. 最近 10 条 error 日志数量（> 5 条触发告警）
// 发现异常 → 写 AgentCore 的 pending queue
//   → 如果是可恢复的（PM2 stopped）→ 自动 pm2 restart
//   → 如果是不可恢复的（db 被删）→ 从备份恢复 + 写 admin 日志
```

**风险控制**：自动恢复**只做安全操作**（restart pm2 / 从本地备份恢复 db），**不自动改 .env / 不自动删数据**。

## 不做的事（自我进化的红线）

1. **不改 prompt 里的安全约束**（ironclad rules）—— AgentCore 的"主观选择题/客观短答/代决策/先确认"永远保留
2. **不自动升级 LLM provider** —— 换模型需要人工确认（API key 成本差异大）
3. **不自动添加新功能路由** —— 新功能必须人工写代码，进化只做已有功能的优化
4. **不删除用户数据** —— Vault / Message / ChatSession 只增不删（用户自己删除外）
5. **不绕过内测两步走** —— 进化输出的所有变更（prompt / 规则 / 配置）先在本地 dev.db 验证 → admin 确认 → 再上 prod

## 交付清单（给其他 agent）

### 新建文件

```
backend/src/services/promptEvolution.ts       # 模块 1：prompt 调优
backend/src/services/evolutionAutoRule.ts    # 模块 2：AgentCore 规则候选
backend/src/services/perfMonitor.ts          # 模块 3：慢查询诊断
backend/src/services/usageTracker.ts         # 模块 4：功能使用埋点
backend/src/services/profileDeepening.ts     # 模块 5：画像加深
backend/src/services/systemGuardian.ts       # 模块 6：自监控
```

### 现有文件改动

| 文件 | 改什么 |
|---|---|
| `backend/src/services/agentCore.ts` | 加 SystemHealth 子模块；handle() 末尾调 promptEvolution.collectBadFeedback |
| `backend/src/services/llmService.ts` | system prompt 改为运行时从 agentConfig 读（已经在做 persona 动态加载） |
| `backend/src/index.ts` | ProactiveScheduler 加 evolution 相关 trigger（每 5min 检查 + 每天 3 点聚合） |
| `backend/prisma/schema.prisma` | 加 `EvolutionCandidateRule` / `EvolutionPerfReport` / `Message.feedback` 新字段 |
| `frontend/src/pages/admin/AdminDashboard.tsx` | 加进化相关统计面板（坏 prompt 率 / 慢查询榜 / 退役候选） |
| `frontend/src/pages/settings/ToneSettingsPage.tsx` | 加 profileSignals 编辑/查看区 |

### 给 frontend-dev 的

- 路由埋点：App.tsx 的每个 `<Route element={Xxx}>` 外层包 `<UsageTracker>`
- Chat 页加 thumbs up/down：`👍 有用 | 👎 没用` 按钮 → 写 Message.feedback
- Admin 面板加"进化候选"tab

### 给 backend-dev 的

- 6 个新 service 文件按上面模块 1-6 模板实现
- Prisma 加进化相关表和字段
- ProactiveScheduler 里挂 evolution 相关定时任务

### 给 devops-engineer 的

- 如果 SystemGuardian 要从服务器本地检查（不是本机），需要加一个 `/health/deep` 端点返回 db 文件状态 + PM2 进程状态 + 最近 error 数
- 备份策略不变，但 SystemGuardian 自动恢复时要记录 `restore_log`（谁触发、恢复了什么、从哪个备份）

## 验证方法

所有进化模块跑起来后，跑一周观察：

| 指标 | 基线（v1.0.1） | 目标 |
|---|---|---|
| LLM 失败率（4xx/5xx） | < 5% | < 2% |
| 用户反馈有用率 | 70% | > 85% |
| AgentCore 新增候选规则 | 0 | ≥ 3 条被 admin 采纳 |
| 慢查询 Top 10 平均耗时 | 230ms | < 80ms |
| 功能体积（打包产物） | 160MB | ≤ 155MB（退役 stale 功能）|

如果所有指标都没改善 → 说明进化闭环没工作，回滚 AgentCore 改动。
