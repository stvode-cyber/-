# SKILL: Unit Test Spec

> 单元测试工程师的操作手册。后端 Jest / 前端 Vitest，不写 E2E。

## 后端（Jest + supertest）

### 配置要点

```typescript
// jest.config.js（项目已配置好）
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEach: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/*.routes.test.ts', '**/*.services.test.ts'],
}
```

### Mock Prisma

```typescript
// jest.setup.ts
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    user: { findUnique: jest.fn(), create: jest.fn(), ... },
    conversation: { ... },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  })),
}))
```

### Mock JWT

```typescript
// 测 admin 路由时伪造 token
function adminToken(userId: string) {
  // 手动 RS256 签名测试用的 key（不要用生产 key）
}
```

### 标准测试模板

```typescript
describe('POST /api/v1/auth/register', () => {
  it('✓ happy path → 200 + token', async () => { ... })
  it('✗ agreeTerms:false → 422 refine 触发', async () => { ... })
  it('✗ 重复用户名 → 409', async () => { ... })
  it('✗ 密码太短 → 400 zod', async () => { ... })
})
```

### 必测场景矩阵

| 层 | Happy Path | Zod Refine | 认证失败 | 未授权 | Prisma 异常 |
|---|---|---|---|---|---|
| 路由 | ✅ | ✅ | ✅ | 管理员路由 | ✅ 至少 1 条 |
| 服务 | ✅ | - | - | - | ✅ 至少 1 条 |
| LLM 注入 | tone 映射 9 种 | - | - | - | mock fetch 失败 |

## 前端（Vitest + RTL）

### Store 测试模板

```typescript
describe('auth store', () => {
  it('login → token 写入', () => { ... })
  it('logout → token 清除', () => { ... })
  it('401 响应 → 自动清登录态', () => { ... })
})
```

### 组件测试原则

- 只测**纯展示逻辑**（条件渲染、状态切换）
- 测**store 对接**（dispatch 是否正确）
- **不测 CSS 样式**、**不测第三方组件内部**

## 不做

- 不写 `expect(1+1).toBe(2)` 这种零价值测试
- 不 mock 整个应用的 integration test
- 不为了凑覆盖率而测试
