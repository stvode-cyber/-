# 🗂️ 台账索引（新 AI 入门 30 秒接住）

> 本文是 `.trae/memory/growth/` 目录的**总索引**。按顺序读：handover → pitfalls → 本索引 → 今日 daily。

---

## 📂 文件清单

| 文件 | 行数 | 用途 | 什么时候查 |
|---|---|---|---|
| **handover.md** | ~160 | 30 秒快照 + 启动命令 + 账号 + 服务器 + 活跃坑 Top 5 | 接手第一读 |
| **pitfalls.md** | ~240 | 所有踩过的坑（永不归档）| 改代码前查有没有类似坑 |
| **decisions.md** | ~40 | 为什么选 A 不选 B | 做选择前看之前同类决策 |
| **issues.md** | ~180 | bug 工单（生命周期追踪）| 排查 bug 时看有没有同类 |
| **daily/2026-10-16.md** | ~31 | 今日工作流水 | 看今天做了啥 |
| **daily/2026-10-15.md** | ~27 | 昨日流水 | 接手上一个 AI 的活 |
| **daily/2026-10-14.md** | ~37 | 前日流水 | — |
| **archive/daily-2026-Q3.md** | ~500 | 9-23 ~ 10-12 旧 daily 合并归档 | 查历史（已过期） |

---

## 🔑 快速跳转锚点

### pitfalls.md 关键条目

| 标签 | 条目 |
|---|---|
| [GS-002] | PowerShell 5.1 读 UTF-8 无 BOM 中文炸 |
| [P0] | 用户说"做过了"实际没做 → 必须先验证再继续 |
| [P0] | GitHub CDP 自动化被 bot 防护拦截 |
| [P0] | Chrome user-data-dir 混用导致 CDP 连错窗口 |
| [2026-10-10] | Capacitor v8 kotlin jvmToolchain(21) → afterEvaluate 覆盖 17 |
| [2026-10-10] | Setup.exe /S 静默被 Defender 拦 → win-unpacked 直拷 |
| [2026-10-14] | pm2 进程名实际是 backend 不是 aie-backend |
| [2026-10-15] | CapacitorHttp 原生插件拦截 WebView fetch |

### decisions.md 关键条目

| 日期 | 决策 |
|---|---|
| 2026-09-23 | DEV 登录生产环境彻底屏蔽 |
| 2026-09-23 | Skill 加防失忆双铁律 |
| 2026-10-10 | 推翻 "Capacitor 硬要 JDK 21" — 17 够用 |
| 2026-10-10 | 桌面版用 win-unpacked 直拷 |
| 2026-10-10 | Android 自己写 IntentInstallerPlugin |
| 2026-10-10 | CORS 后端动态回显 |

---

## 📋 台账维护规则

| 规则 | 说明 |
|---|---|
| daily 保留最近 3 天 | 超过 3 天自动移入 archive/ |
| pitfalls 永不归档 | 踩过的坑必须能被后来者看到 |
| decisions 只留当前有效 | 过期决策（如"推翻 X 规则"）删掉 |
| handover 每次接手时更新 | commit hash + 版本号 + 服务器状态 |
| INDEX.md 只在大改动后更新 | 不频繁改，避免成为负担 |

---

## 👤 用户行为偏好（AI 必守）

> 新 AI 进门先看这个！用户只负责"确认/同意/好的"，所有脏活全交给 AI。

| 偏好 | 执行 |
|---|---|
| **AI 全权操作** | 跑命令、改代码、SSH 部署、浏览器自动化，用户只点头 |
| **大白话回复** | 禁止套话"执行上述验证动作"、"经比对验证结果"这类，直接说事 |
| **任务进度编号** | 每次宣告 "N 个动作"，完成的标记 ✅ 带编号，方便回顾 |
| **新 AI 可立即接手** | 台账精简 + 索引清晰 + 每日流水 |

---

## 🎯 下一步去哪里

| 你想 | 去 |
|---|---|
| 启动开发环境 | handover.md → 启动命令 |
| 改代码前查坑 | pitfalls.md |
| 做选择前看之前决策 | decisions.md |
| 排查 bug | issues.md + handover.md 活跃坑 Top 5 |
| 看今天做了啥 | daily/2026-10-16.md |
| 看项目身份和硬约束 | AGENTS.md |
