# SKILL: Evolution Algorithms — 自我进化算法模式库

> Self-Evolution Engineer 的操作手册。每个模块给出现成代码骨架 + 触发条件 + 风险控制。

---

## 模式 1：Prompt 自动调优（Bad → Good Prompt Evolution）

### 核心算法

```
每 5 分钟 → 检查 pending feedback 数
  ≥ 30 条 → 启动 Evolution Cycle
    1. 拉最近 30 条 thumbs-down 的对话（prompt + response + feedback）
    2. LLM 分析：共性问题是啥？（"太啰嗦" "语气不对" "答非所问"）
    3. 生成 newPrompt（带 rationale）
    4. A/B 分桶：50% 用新 prompt，50% 用旧 prompt（abStats 现成）
    5. 24h 后看：新桶有用率 > 旧桶 + 10% → 全量；否则自动回滚
```

### 代码骨架

```typescript
// backend/src/services/promptEvolution.ts
import { PrismaClient } from '@prisma/client'
import { llmChatWithContext } from './llmService'

const prisma = new PrismaClient()
const CYCLE_THRESHOLD = 30   // 坏样本数量触发
const AB_MIN_DURATION_H = 24 // A/B 最短观察时长
const WIN_THRESHOLD = 0.10   // 新桶必须比旧桶好 10% 才全量

export async function collectBadFeedback() {
  // 写入本地 counter，触发时通知 scheduler
}

export async function runEvolutionCycle() {
  const badSamples = await prisma.message.findMany({
    where: { feedback: 'down' },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { chatSession: { include: { user: true } } }
  })
  const analysis = await llmChatWithContext(
    [{ role: 'system', content: EVOLUTION_ANALYZE_PROMPT },
     { role: 'user', content: JSON.stringify(badSamples) }],
    null
  )
  // 输出结构化结论 { issue, suggestion, newPrompt }
  // ... 写 evolution_candidate 表
  // ... 注册 A/B（abStats 现成）
}

const EVOLUTION_ANALYZE_PROMPT = `
你是一个 AI prompt 调优专家。下面是用户给 thumbs-down 的 30 条对话样本。
分析共性问题，输出 JSON：
{
  "mainIssue": "一句话描述主要问题",
  "newPrompt": "优化后的 system prompt（中文，≤200 字）",
  "rationale": "为什么这个改动能解决问题（≤100 字）"
}
只输出 JSON，不要其他文字。
`
```

### 风险控制表

| 风险 | 控制 |
|---|---|
| LLM 给的新 prompt 更差 | A/B 分桶 24h 观察，自动回滚 |
| LLM 幻觉编造不存在的约束 | newPrompt 里**禁止**删除 ironclad rules（进化前把原始 rules 注入 analyze prompt 当保护栏） |
| 连续 N 轮都坏 → 系统不稳 | 连续 3 轮失败 → 暂停进化 24h + 告警 admin |

---

## 模式 2：AgentCore 规则自动发现（Missing Intent Detection）

### 核心算法

```
每 24h → 扫最近 500 条 Message
  找出：AgentCore 覆盖率 < 50% 的高频意图（走了 legacy 降级）
    → LLM 分析：为什么没被覆盖？
    → 生成 candidate rule（JSON）
    → 写入 evolution_candidate_rules 表
    → admin 面板展示，审核通过后注入 AgentCore
```

### 代码骨架

```typescript
// backend/src/services/evolutionAutoRule.ts
export async function findMissingIntents() {
  const recent = await prisma.message.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 24*60*60*1000) } },
    take: 500,
    include: { chatSession: { include: { user: true } } }
  })

  // 统计每条 Message 的 agentCoreRoute（AgentCore 处理后写 metadata）
  const routeStats = recent.reduce((acc, m) => {
    const route = JSON.parse(m.metadata || '{}').agentCoreRoute || 'legacy'
    acc[route] = (acc[route] || 0) + 1
    return acc
  }, {})

  // 找 legacy 占比高的高频意图
  const highLegacyIntent = recent.filter(m =>
    JSON.parse(m.metadata || '{}').agentCoreRoute === 'legacy'
  ).slice(0, 100)

  // LLM 分析
  const analysis = await llmChatWithContext(
    [{ role: 'system', content: AUTO_RULE_PROMPT },
     { role: 'user', content: JSON.stringify(highLegacyIntent) }],
    null
  )
  // 输出 candidate rules
  // ... 写入 evolution_candidate_rules
}

const AUTO_RULE_PROMPT = `
你是 AgentCore 规则挖掘专家。下面是最近用户消息里走 legacy 降级的 100 条高频意图。
AgentCore 当前有 5 类规则：危机检测、pending 补账、短回复、@指令、记账快路。
找出至少 3 条高频但没被覆盖的意图，输出 JSON 数组：
[{ "intent": "用户想做什么", "trigger": "正则匹配", "handler": "JSON，agentCore.handle() 的新 case" }]
只输出 JSON，不要其他文字。
`
```

---

## 模式 3：SQL 慢查询自诊断

### Prisma middleware 埋点

```typescript
// backend/prisma/evolutionMiddleware.ts
import { PrismaClient } from '@prisma/client'

export function setupPerfMiddleware(prisma: PrismaClient) {
  prisma.$use(async (params, next) => {
    const start = Date.now()
    const result = await next(params)
    const ms = Date.now() - start

    if (ms > 100) {
      // 记录慢查询（异步，不阻塞响应）
      prisma.evolutionPerfReport.create({
        data: {
          model: params.model || 'unknown',
          action: params.action,
          avgMs: ms,
          params: JSON.stringify(params.args).slice(0, 2000),
          route: inferRouteFromStack(new Error().stack), // 从调用栈推断路由
        }
      }).catch(() => {})
    }
    return result
  })
}
```

### 每天聚合

```typescript
// 每周一 3 点（复用 weeklyAggregator 时机）
export async function aggregatePerfTop10() {
  const top = await prisma.evolutionPerfReport.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 7*24*60*60*1000) } },
    orderBy: { avgMs: 'desc' },
    take: 10,
    distinct: ['model', 'action', 'route']
  })
  // 输出到 admin 面板
  // 自动标记：avgMs 本周 vs 上周下降 ≥ 50% → resolved
}
```

---

## 模式 4：功能使用埋点

```typescript
// frontend/src/lib/usageTracker.tsx
import { useEffect } from 'react'
import { api } from './api'
import { useAuthStore } from '../stores/auth'

let routeCounts: Record<string, number> = {}
let lastFlush = Date.now()

export function UsageTracker({ path, children }: { path: string; children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  useEffect(() => {
    if (user) routeCounts[path] = (routeCounts[path] || 0) + 1
    // 每 5 分钟批量上报
    if (Date.now() - lastFlush > 300_000) {
      api.post('/api/v1/evolution/usage', { paths: routeCounts })
      routeCounts = {}
      lastFlush = Date.now()
    }
  }, [path, user])
  return <>{children}</>
}
```

### App.tsx 使用方式

```tsx
// 所有路由外层包 UsageTracker
<Route path="/settings" element={
  <UsageTracker path="/settings"><SettingsPage /></UsageTracker>
} />
<Route path="/chat" element={
  <UsageTracker path="/chat"><ChatPage /></UsageTracker>
} />
```

### Stale 判定算法

```typescript
// 每 2 周跑一次
export async function findStaleFeatures() {
  const usage = await prisma.evolutionUsage.findMany({
    where: { lastAccessed: { lt: new Date(Date.now() - 30*24*60*60*1000) } }
  })
  return usage.filter(u => u.total < 50)
  // → 写入 evolution_stale_candidates 表
  // → admin 面板展示，确认后自动从 App.tsx 移除路由
}
```

---

## 模式 5：AI 画像加深

```typescript
// backend/src/services/profileDeepening.ts
export async function extractProfileSignals(conversationId: string) {
  const msgs = await prisma.message.findMany({
    where: { chatSessionId: conversationId },
    orderBy: { createdAt: 'asc' }
  })
  const signalAnalysis = await llmChatWithContext(
    [{ role: 'system', content: PROFILE_SIGNAL_PROMPT },
     { role: 'user', content: msgs.map(m => `${m.role}: ${m.content}`).join('\n') }],
    null
  )
  // 输出：{ newHobbies, newGoals, newLocations, workChange }
  const { userId } = msgs[0].chatSession
  // 追加到 user.profileSignals（JSON append，不覆盖）
  await prisma.user.update({
    where: { id: userId },
    data: {
      profileSignals: {
        push: ...signalAnalysis.data.filter(Boolean).map(v => ({ ...v, detectedAt: new Date() }))
      }
    }
  })
}

const PROFILE_SIGNAL_PROMPT = `
从下面的用户对话里提取可能的新画像信号。用户没有直接说，但可以合理推断的：
- Hobbies（新爱好：摄影/跑步/钢琴...）
- Goals（新目标：换工作/减肥/学英语...）
- Locations（新地点：杭州/成都/东京...）
- Work（工作变动：升职/跳槽/失业...）
只输出你有 70% 以上把握的，不确定就不输出。
JSON 格式：{ newHobbies: [], newGoals: [], newLocations: [], workChange: null }
`
```

---

## 模式 6：SystemGuardian（自监控 + 安全恢复）

```typescript
// backend/src/services/systemGuardian.ts
export async function runHealthCheck() {
  const issues = []

  // 1. PM2 进程状态（从本机 PM2 API 读，部署时在同一台机）
  try {
    const { execSync } = require('child_process')
    const status = execSync('pm2 status aie-backend --json').toString()
    if (JSON.parse(status)[0]?.pm2_env?.status !== 'online') {
      issues.push('pm2_stopped')
    }
  } catch {
    issues.push('pm2_check_failed')
  }

  // 2. DB 健康
  try {
    await prisma.$queryRaw`SELECT 1`  // Prisma 已经启动时可用
  } catch {
    issues.push('db_corrupted')
  }

  // 3. 恢复
  for (const issue of issues) {
    switch (issue) {
      case 'pm2_stopped':
        execSync('pm2 restart aie-backend')
        logRestore(issue, 'auto-restart')
        break
      case 'db_corrupted':
        execSync('cp /root/backend/prisma/prod.db.bak.* /root/backend/prisma/prod.db')  // 最新备份
        execSync('pm2 restart aie-backend')
        logRestore(issue, 'auto-restore-from-backup')
        break
    }
  }

  // 4. 告警
  if (issues.length > 0) {
    await prisma.evolutionLog.create({
      data: { type: 'auto-restore', details: JSON.stringify(issues) }
    })
  }
}
```

---

## Prisma Schema 增量（只列新表/新字段）

```prisma
model EvolutionPerfReport {
  id        String   @id @default(cuid())
  model     String
  action    String
  route     String?
  avgMs     Int
  params    String?
  createdAt DateTime @default(now())
  resolved  Boolean  @default(false)
  resolvedAt DateTime?
}

model EvolutionCandidateRule {
  id        String   @id @default(cuid())
  intent    String
  trigger   String
  handler   String   // JSON
  rationale String
  status    String   @default("pending") // pending / approved / rejected
  createdAt DateTime @default(now())
  reviewedAt DateTime?
}

model EvolutionLog {
  id        String   @id @default(cuid())
  type      String   // auto-restore / prompt-update / rollback / ab-result
  details   String   // JSON
  createdAt DateTime @default(now())
}

model Message {
  // ... existing fields
  feedback  String?  // 'up' | 'down' | null
  metadata  String?  // JSON (agentCoreRoute, evolutionSignals...)
}

model User {
  // ... existing fields
  profileSignals String?  // JSON append-only
}
```

---

## 部署步骤（按顺序，别跳）

1. 先做**模块 6（SystemGuardian）**—— 最简单、没有依赖、立即见效（PM2 挂了自动拉起）
2. 模块 3（慢查询诊断）—— middleware 埋点 + 聚合，1 天内可跑完
3. 模块 4（Stale 功能）—— 埋点 + 2 周后看数据（要有耐心等 2 周）
4. 模块 5（画像加深）—— 改动小，复用已有 VaultService
5. 模块 1（Prompt 调优）—— 依赖 A/B 实验基础设施（已有），但要等 30 条坏样本才触发
6. 模块 2（AgentCore 规则候选）—— 最复杂，放在最后
