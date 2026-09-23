---
name: "work-growth-logger"
description: "记录每日工作流水、文件变化、踩坑清单、决策记录、交接总览。每次解决问题/改完文件/对话结束自动追加。新 AI 进门先读 handover.md + 当天 daily 文件，30 秒内接手。"
---

# 成长型工作记录器

## 核心目标

**不留空白、不丢问题、新 AI 秒接手**。任何 AI 代理进来，读两个文件就能知道：
- 这个项目是啥、在啥状态
- 最近改了啥、踩了啥坑
- 接下来该干嘛、有啥不能碰

## ⚡ 防失忆双铁律（2026-09-23 新增，血泪教训）

> 用户说"这个做过了"，AI 也说"好的"，结果翻记录发现**从来没做过**。这种事必须用流程堵死。

### 铁律 1：关键操作前先查记录

做以下事情**必须先验证实际状态**，不能靠记忆或用户一句话：

| 操作 | 必须先查 | 查不到怎么办 |
|------|---------|-------------|
| 说"GitHub 推过了" | `git remote -v` + API 列仓库 | 查不到 = 没建，老老实实建 |
| 说"后端重启了" | `pm2 list` + `curl health` | 没起来 = 重启动 |
| 说"nginx 改了" | `nginx -t` + 看 conf 实际内容 | 没改 = 别吹，去改 |
| 说"这个 bug 修过" | git log / CHANGELOG / pitfalls.md | 没记录 = 没修过 |
| 说"远程仓库 XX/YY 存在" | `git ls-remote` 或 API 查 | 不存在 = 先建 |

### 铁律 2：关键操作后立刻同步

**别等对话结束才补**，改完/做完立刻追加记录：

- 改完一组文件 → **立刻**追加 daily 的"改了啥"
- 新建/删除资源（git 仓库、服务器、域名）→ **立刻**写 handover.md 的"当前状态"
- 踩了坑 → **立刻**写 pitfalls.md，别等下次踩同一个
- 用户说"之前做过"但查不到 → **立刻**写 daily 标记 `#记忆错位`

## 记录文件结构

```
<项目根>/.trae/memory/growth/
├── handover.md              # 交接总览（新 AI 进门第一读，含所有长期状态）
├── daily/
│   └── YYYY-MM-DD.md        # 当天工作流水（自动创建，按触发点实时追加）
├── pitfalls.md              # 踩坑清单（永久积累，避免重复踩）
└── decisions.md             # 决策记录（为什么选 A 不选 B）
```

## 触发时机（7 个自动触发点）

| # | 触发点 | 写入哪个文件 | 做什么 |
|---|--------|-------------|--------|
| 1 | **新对话开始** | 读 handover.md + 当天 daily + git status | 给新 AI 快速上下文，30 秒内读懂项目状态 + 当前仓库状态 |
| 2 | **改完一组文件** | 当天 daily | 记录改了哪些文件 + 改了啥（一句话）|
| 3 | **解决一个问题/踩了个坑** | pitfalls.md + 当天 daily | 追加一条，打 #标签 方便检索 |
| 4 | **做出关键选择（选 A 不选 B）** | decisions.md | 记录决策 + 理由 + 备选方案 |
| 5 | **新建/删除远程资源** | handover.md + 当天 daily | GitHub 仓库、服务器、域名、API key 位置等**长期状态必须立刻写 handover** |
| 6 | **用户说"之前做过"但查不到** | 当天 daily | 标记 `#记忆错位`，说明"实际没做，现在补做" |
| 7 | **对话即将结束** | 当天 daily 收尾 + 更新 handover.md | 补齐遗漏，handover 保持最新 |

## 格式规范（大白话，≤ 3 行）

### daily/YYYY-MM-DD.md 模板

```markdown
# 2026-09-23 工作日志

## 改了啥
- [10:30] gate-check.ps1 加 UTF-8 BOM + Get-Content -Encoding UTF8 #编码修复
- [10:45] auth.ts devLogin 入口加 import.meta.env.PROD 守卫 #DEV安全

## 踩坑
- [10:50] nginx lvjiaoxi.conf 被 chattr +i 锁死，改不了 → 先 chattr -i #nginx #immutable锁

## 决策
- [11:00] 选 GitHub SSH 推送不用 HTTPS，因为本地已配好 SSH key

## 记忆错位
- [14:00] 用户说"GitHub 仓库建过了" → 实际 API 查不到 → 立刻建 #GH #记忆错位

## 远程资源（变更时追加）
- [14:15] GitHub 仓库 stvode-cyber/APP-AIE 创建成功（private）

## 待办
- [ ] 等同事内测反馈
- [ ] 清理服务器旧 nginx conf 备份
```

### pitfalls.md 模板（永久积累，不删）

```markdown
# 踩坑清单（永不归档，持续积累）

## [P0][GS-002] PowerShell 5.1 读 UTF-8 无 BOM 中文炸
- **现象**：Get-Content 不加 -Encoding UTF8 → 中文被当 GBK → ConvertFrom-Json 炸
- **根因**：PS 5.1 默认用系统编码（中文系统是 GBK）
- **预防**：PS 脚本加 UTF-8 BOM；Get-Content 一律加 `-Encoding UTF8`
- **关联**：gate-check.ps1、所有读含中文 JSON 的脚本

## [P1] 用户说"做过"实际没做 → 必须先验证再继续
- **现象**：用户说"GitHub 推过了"，AI 直接说"好的"，实际仓库根本不存在
- **根因**：对话记忆截断 + AI 不加验证
- **预防**：关键操作前 `git remote -v` / API 查 / `ls-remote`，查到才算做过
- **关联**：GH 推送、服务器配置、nginx 修改等所有远程状态 #记忆错位
```

### decisions.md 模板

```markdown
# 决策记录

## [2026-09-23] DEV 登录仅限开发环境
- **选了啥**：LoginPage 3 处按钮 + 版本号点击全部用 import.meta.env.DEV 包
- **为啥**：生产 EXE 里不能留后门，DEV 登录走固定手机号 + 自动发验证码
- **备选**：只在后端拦截 → 但前端按钮还在，等于暴露
```

### handover.md 模板（新 AI 进门第一读）

```markdown
# 🤝 绿角犀管家 — AI 交接总览

> 新 AI 进门第一读。30 秒内读懂项目状态。每日更新。

## 项目一句话
Electron 桌面端（Windows）+ React 18 前端 + Node.js/Express 后端 + Prisma/MySQL

## 当前状态
- **版本**：v1.0.6（内测中）
- **Git**：main 分支，commit xxx，remote = git@github.com:stvode-cyber/APP-AIE.git
- **服务器**：47.116.59.141（root），pm2 aie-backend（3100）
- **GitHub 仓库**：stvode-cyber/APP-AIE（private）

## 远程资源清单
| 资源 | URL/位置 | 状态 | 备注 |
|------|---------|------|------|
| GitHub | git@github.com:stvode-cyber/APP-AIE.git | ✅ 已建 | SSH key 在 C:\Users\Administrator\.ssh\id_rsa |
| 云端 API | https://47.116.59.141/api/v1 | ✅ 在线 | nginx greenrhino-cloud-ssl.conf |
| 下载链接 | https://47.116.59.141/apk/lvjiaoxi-setup-1.0.6.exe | ✅ 生效 | 301 跳 HTTPS |

## 代码规范
- 版本号三处必须同步（3 个 package.json + EXE）
- 改后端端口必须同步改 nginx proxy_pass
- 内测两步走：本机改 → 用户拍板 → 推服务器
- DEV 登录用 import.meta.env.DEV 包，不进生产

## 下一步
- 等同事内测反馈（更新检查 + DEV 登录）

## 最近踩坑标签
#编码修复 #GS-002 #nginx #PS5.1 #记忆错位
```

## 写入规则

1. **大白话**：不说"进行了 X 操作"，说"改了 gate-check.ps1 的 BOM"
2. **≤ 3 行**：每条记录控制在 3 行内，太长就拆
3. **打标签**：`#标签名` 方便 grep 检索（如 `#编码修复`、`#nginx`、`#记忆错位`）
4. **增量追加**：永远只追加，不覆盖。handover.md 除外（每次重写最新状态）
5. **时间戳**：daily 文件里每条加 `[HH:MM]`，其他文件加 `[YYYY-MM-DD]`
6. **项目专属**：这些文件只跟项目走，不跨项目共享
7. **远程必写**：GitHub 仓库、服务器、域名等**长期状态变更必须立刻写 handover.md**，别等对话结束

## 新 AI 快速上手流程（必走）

1. 读 `handover.md` → 30 秒懂项目状态 + 远程资源位置
2. 读 `pitfalls.md` → 扫一眼 P0 坑 + #记忆错位 规则
3. 读当天 `daily/YYYY-MM-DD.md` → 知道最近在改啥
4. 看 git log + git remote -v → 确认代码和远端状态
5. 问用户："今天要搞啥？"

## 对话结束前必做

1. 当天 daily 文件的 `## 待办` 区保持不空（至少 1 条待办）
2. handover.md 更新（当前状态、远程资源、下一步、最近标签）
3. 把新发现的坑同步追加到 pitfalls.md
4. 如果是周一，额外更新一份周报（见 ledger-keeper）

## 与 ledger-keeper 的分工

| | work-growth-logger（本 Skill） | ledger-keeper |
|---|---|---|
| 范围 | 项目专属，实时流水 | 跨项目共享，规范模板 |
| 触发 | 每次改完文件/解决问题/对话结束/**远程资源变更** | 新对话开始/改文件前扫坑/记台账 |
| 文件 | .trae/memory/growth/ | .trae/memory/台账/（全局） |
| 风格 | 流水账、大白话、即时追加 | 结构化、规范模板、流程约束 |
| 防失忆 | ✅ 双铁律（查记录 + 立刻同步） | ❌ 只管规范不管实时性 |

**两者互补，不重复造轮子**。
