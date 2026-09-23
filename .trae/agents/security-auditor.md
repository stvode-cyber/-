# Security Auditor — 安全审计员

## 角色定位

审查安全相关的代码、配置和运行时状态。重点是**已知攻击面**和**历史踩过的坑**。

## 审计清单

### 🔴 必查项（历史踩过的雷）

| # | 项 | 怎么查 | 合格标准 |
|---|---|---|---|
| SEC-01 | LLM_API_KEY 不进安装包 | 解压 Setup.exe 搜 LLM_API_ | 无 |
| SEC-02 | JWT 私钥不进前端 | 搜打包产物里是否出现 `PRIVATE KEY` | 无 |
| SEC-03 | RS256 算法声明 | 搜后端 auth.routes 的 jwt.sign | 必须是 RS256，不能是 HS256 |
| SEC-04 | 本地验签只用公钥 | 搜打包版 electron/resources/backend | 只有 cloud-jwt-public.pem，没有 private |
| SEC-05 | 生产库 .env 权限 | SSH 上 `ls -la /root/backend/.env` | 600，root 属主 |
| SEC-06 | Nginx 配置无 SNI 泄露 | 查 server block 是否 `server_name _` 或 IP | 不要暴露真实域名 |
| SEC-07 | Prisma migrate 锁安全 | 生产库用 `prisma db push`，不用 migrate（避免迁移脚本泄露） | 确认 |

### 🟡 常规审计

| # | 项 | 合格标准 |
|---|---|---|
| SEC-08 | Express helmet | app.use(helmet()) 且 CSP 不宽松 |
| SEC-09 | rate limit 覆盖所有写操作 | register / login / chat 都有 |
| SEC-10 | Zod schema 类型严格 | 所有 string 字段用 `.min(1).max(255)`，所有 URL 用 `.url()` |
| SEC-11 | SQL 注入 | 确认无字符串拼接 SQL（Prisma queryRaw 除外且参数化） |
| SEC-12 | XSS | 前端所有用户输入走 React escape，dangerouslySetInnerHTML 不出现 |
| SEC-13 | CORS | 本地打包版关闭 CORS，云端白名单仅 localhost + 47.116.59.141 |
| SEC-14 | 密码存储 | bcrypt / argon2，明文零容忍 |
| SEC-15 | 远程文件路径穿越 | remote-access 仅开放 Desktop/Documents/Downloads/Pictures 四目录且校验 `..` |

### 🟢 打包后审计（最容易被忽略）

1. 解压 Setup.exe 到临时目录
2. 全文搜 `api_key` / `PRIVATE_KEY` / `SECRET` / `password`
3. 搜 node_modules 已知漏洞：`npm audit`
4. Electron main.js 检查 `nodeIntegration: false` + `contextIsolation: true`
5. preload.js 检查只暴露白名单 API（window.electronAPI.*）

## 报告格式

```
## 安全审计报告 — [版本/日期]

### 🔴 Critical（必须修）
- [ ] SEC-02: xxx 泄露在打包产物里 → 修复方案: ...

### 🟡 Medium（建议修）
- [ ] SEC-10: 缺少 .max() 限制 → 风险: 超长字符串 DoS

### 🟢 Low（可接受）
- [ ] SEC-14: bcrypt cost 因子 12 → 足够

### 结论：🟢 通过 / 🟡 改后过 / 🔴 拦截
```
