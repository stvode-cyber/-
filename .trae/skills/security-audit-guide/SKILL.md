# SKILL: Security Audit Guide

> 安全审计员的操作手册。按"已知攻击面 → 打包产物 → 运行时"三轮过。

## 流程

### 第一轮：源码静态扫描

```powershell
# 搜密钥/密码残留
Get-ChildItem -Recurse -Include *.ts,*.tsx,*.js,*.cjs,*.json,*.env | 
  Select-String -Pattern "api_key|API_KEY|PRIVATE KEY|SECRET|password" -CaseSensitive:$false |
  Where-Object { $_.Path -notmatch "node_modules|dist|release-v" }

# 搜危险函数
Select-String -Path "backend/src/**/*.ts" -Pattern "queryRaw|eval\(|exec\(|dangerouslySetInnerHTML"
```

### 第二轮：打包产物审计

```powershell
# 解压 Setup 临时看
$temp = "$env:TEMP\绿角犀-audit"
Expand-Archive "绿角犀-Setup-1.0.1.exe" -DestinationPath $temp -Force
# 或直接看 win-unpacked
cd "electron/release-v16/win-unpacked"

# 全文搜敏感词
Get-ChildItem -Recurse -File | Select-String -Pattern "api_key|PRIVATE KEY|siliconflow|sk-" | ForEach-Object { $_.Path }

# 搜 electron 配置
Select-String -Path "**/*.js" -Pattern "nodeIntegration.*true|contextIsolation.*false" -CaseSensitive
```

### 第三轮：云端运行时审计

```bash
# 远程文件权限
ssh root@47.116.59.141 "ls -la /root/backend/.env && stat -c '%a' /root/backend/.env"
# 期望: 600

# 看 .env 里有没有不该有的
ssh root@47.116.59.141 "grep -iE 'api_key|PRIVATE' /root/backend/.env"
# 期望: 只有 LLM_API_KEY（可接受），没有 JWT_PRIVATE_KEY 以外的私钥

# 测试 rate limit
curl -s http://47.116.59.141:3001/api/v1/health
for i in {1..20}; do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://47.116.59.141:3001/api/v1/auth/register -d '{}'; done
# 期望: 后面返回 429

# Nginx 安全头
curl -skI https://47.116.59.141/apk/ | grep -iE "x-frame|content-security|x-content"
```

## 历史踩过的雷

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | PRIVATE KEY 进前端 | electron/resources 复制时带了后端 .env | .gitignore + 打包脚本显式排除 |
| 2 | LLM_API_KEY 进安装包 | 第一次打包没考虑 | .env 不走 extraResources，用独立 llm.env 交付 |
| 3 | HS256 降级风险 | 初始 jwt.sign 没强制 RS256 | 硬编码 `algorithm: 'RS256'` |
| 4 | nodeIntegration:true | electron main.js 模板默认值 | 显式 `nodeIntegration: false, contextIsolation: true, sandbox: true` |

## 报告输出

```markdown
## 安全审计 — [版本]

### 🔴 Critical
- SEC-01: xxx → 修复建议: ...

### 🟡 Medium
- SEC-10: zod 缺 .max() → 风险: DoS

### 🟢 Low
- ...

### 结论：🟢 通过 / 🟡 改后过 / 🔴 拦截
```
