# 决策记录

> 为什么选 A 不选 B。关键决策留痕，后来者能懂。

---

## [2026-09-23] DEV 登录生产环境彻底屏蔽
- **选了啥**：auth.ts 入口加 import.meta.env.PROD 守卫 throw；LoginPage 3 处按钮 + 版本号点击全部 import.meta.env.DEV 包
- **为啥**：生产 EXE 留 DEV 后门 = 安全漏洞。用户电脑上任何人点 5 次版本号就能跳过登录
- **备选**：只在后端拦截 → 前端按钮还在，等于暴露；只加密码保护 → 还是暴露 + 增加复杂度

## [2026-09-23] git 仓库从今天（v1.0.6 基线）开始
- **选了啥**：git init 一次性 commit 1355 文件，commit `30e2542`
- **为啥**：项目之前全是裸文件，没有 .git 目录。今天是第一次系统性接手，正好作为基线
- **备选**：从更早的版本开始 → 没记录了，不知道哪个状态是"好的"；不搞 git → 改坏了回滚靠人肉

## [2026-09-23] nginx 主后端路由补 X-Forwarded-For
- **选了啥**：greenrhino-cloud-ssl.conf 的 `/` location（proxy_pass 3100）补一行 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for
- **为啥**：Express 默认读 X-Forwarded-For 获取真实 IP，只有 X-Real-IP 不够。后端日志从 `127.0.0.1` 变成真实 IP 便于追踪
- **备选**：只在 Node.js 里加信任代理 → Express trust proxy 默认开着，但没 header 还是拿不到

## [2026-09-23] GitHub 仓库名定 APP-AIE（stvode-cyber 下，private）
- **选了啥**：stvode-cyber/APP-AIE
- **为啥**：简洁好记，和本地目录名一致；private 因为有用户数据、服务器地址等敏感信息
- **备选**：lvjiaoxi-viewer（和另一个项目重名混淆）；用服务器自建 bare repo（本地 → 服务器来回迁麻烦）

## [2026-09-23] 创建 work-growth-logger Skill（独立于全局 ledger-keeper）
- **选了啥**：项目专属 Skill（.trae/skills/work-growth-logger/），和全局 ledger-keeper 分工互补
- **为啥**：ledger-keeper 只管跨项目规范模板，不管这个项目的实时流水和远程状态。每次解决的具体问题/踩的具体坑必须跟项目走，换电脑新 AI 才接得上
- **备选**：全靠 ledger-keeper → 全局文件里混各项目记录，AI 进来找不到这个项目的具体状态

## [2026-09-23] Skill 加防失忆双铁律（关键操作前查记录 + 后立刻同步）
- **选了啥**：铁律 1（查记录再动手）+ 铁律 2（做完立刻同步，不等对话结束）
- **为啥**：用户说"已推送"，AI 直接说"好的"，结果 `git ls-remote` 验证仓库根本不存在。2 小时绕 device code 白等。必须用流程堵死记忆错位
- **备选**：靠 AI 自觉验证 → 对话长了 AI 会丢上下文；靠用户记得清楚 → 用户也会记错项目或对话

## [2026-09-22] HTTP 80 端口 /apk/ 加 301 跳 HTTPS
- **选了啥**：只给 /apk/ location 加 return 301，其他 HTTP 路径不动（ERP 的 /api/ 和 / 需要继续走 HTTP）
- **为啥**：粗暴全跳 HTTPS 会崩 ERP 前端，它只配了 HTTP 代理
- **备选**：全部 301 → 崩 ERP；给 ERP 也配 HTTPS → 工作量大，ERP 是独立项目
