# 🗂️ 台账索引（新 AI 入门 30 秒接住）

> 本文是 `.trae/memory/growth/` 目录的**总索引**。
> 🔴 **入场顺序**：AGENTS.md → handover.md → secrets.md → 本索引 → issues.md → 今日 daily.md

---

## 📂 文件清单

| 文件 | 用途 | 什么时候查 |
|---|---|---|
| **handover.md** | 30 秒快照 + 启动命令 + 服务器 + 活跃坑 Top 5 | 接手第一读 |
| **secrets.md** | 🔐 重要信息集中表（版本号/账号/服务器/密钥路径）| 版本 bump、服务器操作、发版时必查 |
| **issues.md** | Master bug 工单 + 独立踩坑快查（P0/P1/P2）+ 杂项铁律 | 改代码前扫坑、排查 bug |
| **decisions.md** | 为什么选 A 不选 B（20 条关键决策）| 做选择前看之前同类决策 |
| **daily/2026-10-17.md** | 今日工作流水 | 看今天做了啥 |
| **archive/daily-2026-Q3.md** | 9-23 ~ 10-12 旧 daily 合并归档 | 查历史（已过期）|

---

## 🔑 快速跳转锚点

### issues.md Master 结构（按类型）

| Master ID | 主题 | 最高 P 级 | 状态 |
|---|---|---|---|
| M-001 | Vite Dev Server 多 HTML + BUILD_MODE + Proxy | **P0** | ✅ fixed |
| M-002 | 后端全局错误处理漏接 ZodError | P0 | ✅ fixed |
| M-003 | 运维操作 / SSH / 数据库直接改 | P1 | ✅ fixed |
| M-004 | PowerShell 5 环境特定坑 | P1 | ⚠️ recurring |
| M-005 | Git push / 编码 / 换行符 | P1 | ⚠️ recurring |
| M-006 | Android 自动更新全链路 | **P0** | 🔧 fixing |

### issues.md 独立踩坑快查（高频必看）

| P 级 | 坑标签 | 预防一句话 |
|---|---|---|
| 🔴 P0 | 用户说做过了实际没做 | 远程操作前必须 pm2 list / git ls-remote 验证 |
| 🔴 P0 | GitHub CDP bot 防护 | 仓库/设置类让用户手动点浏览器 |
| 🔴 P0 | SFTP path.join 反斜杠 | 跨平台文件传输用 `/` 不用 path.join |
| 🟠 P1 | SNI 被封 | 内测下载统一直连 `https://47.116.59.141/apk/` |
| 🟠 P1 | NSIS vs InnoSetup 参数混淆 | 先搜 Nullsoft 确认 → NSIS 用 `/S /D=<path>` |
| 🟠 P1 | Capacitor jvmToolchain(21) | afterEvaluate 覆盖成 JDK 17 |
| 🟠 P1 | pm2 进程名漂移 | 实际叫 `backend`，文档写 aie-backend 是旧名 |
| 🟡 P2 | 版本号漏更 | bump 时扫 secrets.md 检查清单 10 项 |
| 🟡 P2 | dist 旧版鬼影 | 改源码必须 sync-dist.ps1 |
| 🟡 P2 | PowerShell here-string 炸模板字符串 | 用 base64 中转 / Node.js 写文件 |

### decisions.md 关键决策

| 日期 | 决策 |
|---|---|
| 2026-09-14 | 注册功能统一为手机+验证码 |
| 2026-09-18 | dist 同步铁律（sync-dist.ps1 固化）|
| 2026-09-20 | nginx proxy_pass 端口同步铁律 |
| 2026-09-23 | Skill 加防失忆双铁律 |
| 2026-10-10 | 推翻 "Capacitor 硬要 JDK 21" — 17 够用 |
| 2026-10-10 | Android 自动更新自己写 IntentInstallerPlugin |

---

## 📋 台账维护规则

| 规则 | 说明 |
|---|---|
| daily 保留最近 3 天 | 超过自动移入 archive/ |
| issues 永不全归档 | Master 工单 closed 移 archive，独立踩坑快查永不归档 |
| secrets.md 三处同步 | 任何变更必须同步 AGENTS.md + handover.md（铁律 #14）|
| INDEX.md 只在大改动后更新 | 不频繁改，避免成为负担 |
| 新坑必注入 TODO | issues.md 新条目的预防规则必须注入关联文件 `// TODO: [坑标签]` 注释 |

---

## 🎯 下一步去哪里

| 你想 | 去 |
|---|---|
| 启动开发环境 | handover.md → 启动命令 |
| 服务器操作 | secrets.md → 服务器清单 + 健康检查清单 |
| 发版本 | secrets.md → 版本同步检查清单（10 项打勾）|
| 改代码前扫坑 | issues.md |
| 做选择前看之前决策 | decisions.md |
| 排查 bug | issues.md Master 工单 + 独立踩坑快查 |
| 看今天做了啥 | daily/2026-10-17.md |
| 看项目硬约束 | AGENTS.md → 15 条铁律 |
| 想知道 pm2 叫啥 | secrets.md → pm2 进程名 `backend` |
