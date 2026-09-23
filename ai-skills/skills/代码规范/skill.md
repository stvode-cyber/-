---
名称：代码规范
类型：生成型 + 全局型
触发词：写代码、改代码、加功能、重构、新建文件、函数、接口
版本：v1.0
依赖：无
---

## 这个 skill 是干啥的

只要 AI 触及写代码（生成/修改/重构），就加载这个 skill。
统一代码风格、命名、结构、安全规范，保证生成的代码一致不跑偏。
不负责：业务逻辑（听对应业务 skill）、UI 设计（听 UI 设计 skill）。

---

## 代码风格

### 通用
- 缩进：2 空格（不用 Tab）
- 引号：单引号 ' '（不用双引号）
- 分号：必加（TS/JS）
- 换行：LF（不用 CRLF）
- 编码：UTF-8

### TypeScript / JavaScript
- 用 const/let，不用 var
- 用 === 严格相等，不用 ==
- 用箭头函数（除对象方法外）
- 用模板字符串，不用字符串拼接

---

## 命名规则

| 类型 | 规则 | 例子 |
|---|---|---|
| 变量 | 驼峰，见名知义 | `userAge`, `fetchData` |
| 函数 | 动词开头 | `getUser()`, `sendEmail()` |
| 类 | 帕斯卡 | `UserService`, `OrderModel` |
| 常量 | 大写下划线 | `MAX_RETRY`, `API_BASE` |
| 文件 | 小写连字符 | `user-service.ts`, `pet-shop.ts` |
| 接口 | I 前缀（可选） | `IUser`, `User`（项目统一即可） |
| 布尔 | is/has/can 开头 | `isReady`, `hasPermission` |

### 函数命名动词表
- get 查 / set 改 / add 加 / update 更新 / delete 删
- fetch 远程取 / save 持久化 / load 读本地
- create 新建 / build 组装 / parse 解析 / format 格式化

---

## 文件组织

### 单文件限制
- 一个文件不超过 300 行
- 一个函数不超过 50 行
- 一个文件只做一件事（单一职责）

### 模块结构（业务域）
```
模块名/
├── README.md              ← 模块说明
├── xxx.routes.ts          ← 路由
├── xxx.service.ts         ← 业务逻辑
├── xxx.model.ts            ← 数据模型
└── xxx.test.ts            ← 测试
```

---

## 注释规范

### 必写注释的场景
- 函数：说明"干啥的"+"参数"+"返回值"
- 复杂逻辑：说明"为什么这么写"
- TODO：标记未完成项
- 安全相关：说明风险点

### 不用写注释的场景
- 显而易见的代码（`let count = 0`）
- 命名已经说清的（`getUserById(id)`）

### 注释格式
```typescript
/**
 * 查用户信息
 * @param userId - 用户ID
 * @returns 用户信息对象
 */
function getUser(userId: string) { ... }
```

---

## 错误处理

### 必须处理
- 外部输入：校验类型/范围/格式
- 异步操作：try/catch 或 .catch()
- 空值：用可选链 `?.` 或默认值 `??`
- 边界：数组越界、除零、溢出

### 错误处理方式
```typescript
// 好：具体处理
try {
  await saveUser(user);
} catch (err) {
  logger.error('保存用户失败', err);
  throw new Error('保存失败，请重试');
}

// 坏：吞掉错误
try { ... } catch (e) {}
```

---

## 安全规范

### 绝不能做
- 不写死密钥/token/密码（用环境变量）
- 不拼接 SQL（用参数化查询）
- 不执行用户传入的代码
- 不信任前端输入（后端必须校验）
- 不在日志里打印密码/敏感信息

### 必须做
- 密码加密存储（bcrypt）
- JWT 放 HttpOnly Cookie
- 文件操作校验路径（防目录穿越）
- 用户输入做转义（防 XSS）
- 权限校验每个敏感接口

---

## TypeScript 特定规范

### 类型
- 禁用 any（必须用 unknown 替代）
- 优先用 type 定义联合类型，interface 定义对象
- 函数必须标返回类型
- API 响应有统一的 Response<T> 类型

### 导入导出
- 用 ES Module（import/export）
- 不用 CommonJS（require/module.exports）
- 按需导入，不用 `import * as`

---

## 回答规矩

### 生成代码时
- 先说"我要写啥"，再贴代码
- 代码用代码块包裹，标语言
- 改代码时说清"改了哪几行、为啥改"

### 修改代码时
- 只改该改的部分，不动无关代码
- 删除旧代码时说明"这块不用了，因为..."
- 重构时保持外部行为不变

### 禁忌
- 不加冗余注释（命名清楚就不写）
- 不加无用错误处理（内部代码信任框架）
- 不为假设的未来需求设计（YAGNI）
- 不创建不必要的新文件（能改就不新建）
