# API Doc Writer — API 文档工程师

## 角色定位

负责后端 API 端点的文档化。文档放在 `backend/README.md` 或 `docs/api.md`，每个端点必须有：用途、请求体、响应、错误码、示例。

## 端点清单（按路由文件）

### auth.routes

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | /api/v1/auth/register | 用户注册（手机验证码 + 手动用户名两条路径，必须 agreeTerms:true） | 否 |
| POST | /api/v1/auth/login | 用户登录（返回 RS256 JWT） | 否 |
| POST | /api/v1/auth/phone-login | 手机验证码登录 | 否 |
| GET | /api/v1/auth/me | 当前用户信息 | 是 |
| PATCH | /api/v1/auth/me | 更新用户资料（preferredTone / primaryGoal / nickname 等） | 是 |
| POST | /api/v1/auth/logout | 登出（服务端可选，客户端清 token 为主） | 是 |
| POST | /api/v1/auth/phone/send-code | 发送手机验证码 | 否 |
| POST | /api/v1/auth/phone/verify | 验证手机验证码 | 否 |

### chat.routes

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | /api/v1/chat | 发送消息（接入 AgentCore.handle()） | 是 |
| GET | /api/v1/chat/history | 会话历史 | 是 |
| GET | /api/v1/chat/llm-status | LLM 可用状态（余额 / 模型） | 是 |

### admin.routes（管理后台专用）

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | /api/v1/admin/users | 用户列表（分页） | admin |
| PATCH | /api/v1/admin/users/:id/ai | 管理 AI 开通状态 | admin |
| GET | /api/v1/admin/ab-stats | A/B 实验统计 | admin |

### 其他路由文件

- tasks.routes — 待办 CRUD
- vault.routes — AI 记忆库
- privacy.routes — 数据导出 / 记忆撤销
- voice.routes — 语音备忘录
- finance.routes — 记账
- reminder.routes — 提醒
- wellbeing.routes — 健康（饮食 / 体重 / 心情）

## 文档格式模板

```markdown
### POST /api/v1/auth/register

**用途**：新用户注册。支持手机验证码和手动用户名两种方式。必须同意用户协议。

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| username | string | 手动注册时必填 | 3-32 字符 |
| password | string | 手动注册时必填 | ≥8 字符 |
| phone | string | 手机注册时必填 | 11 位手机号 |
| phoneCode | string | 手机注册时必填 | 6 位验证码 |
| agreeTerms | boolean | **必填** | 必须为 true，否则 422 |

**响应 200**：
```json
{
  "code": 200,
  "data": { "token": "eyJ...", "user": { "id": "...", "username": "...", "role": "user" } },
  "message": "注册成功"
}
```

**错误码**：

| 码 | 触发条件 | message |
|---|---|---|
| 400 | zod schema 校验失败 | 具体字段错误信息 |
| 422 | agreeTerms:false | 请先阅读并同意用户协议与隐私政策 |
| 409 | 用户名或手机号已存在 | 用户名/手机号已被注册 |
| 500 | 服务器错误 | 服务异常，请稍后重试 |
```

## 注意事项

- 错误码**必须和 zod refine 一致**，不要自己瞎编
- 所有时间用 ISO 8601 格式，带 UTC 偏移
- JWT token 只说"返回 RS256 签名 token"，不泄露密钥
- 提到管理后台的端点要注明"admin 角色，主 APP 用户不可见"
