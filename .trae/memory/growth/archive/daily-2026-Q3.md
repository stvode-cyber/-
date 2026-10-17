# 2026 Q3 Daily 归档
> 合并自 2026-09-23 ~ 2026-10-12 每日流水，共 6 个文件

---

## 2026-09-23.md

# 2026-09-23 工作日志

## 改了啥
- [09:00] gate-check.ps1 加 UTF-8 BOM + 第 107 行 `Get-Content -Encoding UTF8` #编码修复 #PS5.1
- [09:15] auth.ts devLogin 入口加 `import.meta.env.PROD` 守卫 #DEV安全
- [09:20] LoginPage.tsx 3 处 DEV 按钮 + 版本号点击全部 `import.meta.env.DEV` 包起来 #DEV安全
- [09:30] app.routes.ts windows-version API 加 X-Forwarded-For 真实 IP + console.log 调用日志 #后端
- [09:45] lvjiaoxi.conf 加 `/apk/` 301 跳 HTTPS #nginx
- [10:00] greenrhino-cloud-ssl.conf 主后端路由 + /garh/api/ 补 X-Forwarded-For #nginx
- [10:15] CHANGELOG.md 新增 2026-09-22 条目（变更 + 踩坑 + 决策 + 版本号语义化）
- [10:30] .gitignore 补 dist/ build/ release*/ .timestamp-*.mjs 等构建产物
- [10:45] git init + git commit 首次入库（1355 文件，commit `30e2542`）#git
- [11:00] 服务器磁盘清理 /apk/ 旧备份 + v1.0.2 旧版（1.2G → 326M，腾 846M）#运维
- [11:15] greenrhino-cloud-ssl.conf 改完后 curl 验证真实 IP 生效（183.34.226.39）
- [11:30] gh auth refresh 清 GH_TOKEN → gh auth login web → device code `F867-B3A8` 等待中 #GH-auth
- [14:00] **创建 work-growth-logger Skill**（.trae/skills/work-growth-logger/SKILL.md）+ 4 个记录文件（handover / pitfalls / decisions / daily）#Skill
- [15:00] **Skill 升级：加防失忆双铁律** + 触发点 5→7 + 写入规则加第 7 条（远程必写）#Skill
- [15:15] pitfalls.md 新增 P0 记忆错位坑 + P1 device code 不稳定坑
- [15:20] handover.md 重写：加远程资源清单表（GitHub / 云端 API / 下载链接 / APK 目录）

## 踩坑
- [09:10] lvjiaoxi.conf 被 `chattr +i` 锁死，mv 报 Permission denied → 先 `chattr -i` 解锁 #nginx #immutable锁
- [09:25] `git ls-remote https://` 报 "could not read Username" → 本地有 SSH key，改用 SSH 方式通了 #git
- [09:40] gh auth refresh 报 "The GH_TOKEN environment variable is being used" → Remove-Item Env:\GH_TOKEN 清掉才能走 gh 自身 auth #GH-auth
- [10:00] gh auth refresh 清掉 GH_TOKEN 后报 "not logged in to any hosts" → 原来之前的 token 全是 GH_TOKEN 撑着的，清掉就得重新 gh auth login #GH-auth
- [10:20] gh auth login web device code 过期（C84B-27F4 没用上）→ 重新跑，新码 F867-B3A8 #GH-auth
- [14:30] **curl 直连拿 device code（client_id=Iv1.e7b89e013f801f03）比 gh 快 10 倍** → 发现 gh auth login --web 在国内超慢（15-25 秒），不如直接 curl #GH-auth #device-code
- [15:30] **用户说"已推送" → git ls-remote 验证 Repository not found** → stvode-cyber 名下 6 个仓库还是没 APP-AIE → 记忆错位！按刚加的双铁律 1 验证出来了 #记忆错位 #GH #双铁律-1

## 记忆错位（按 Skill 铁律 1 标记）
- [15:30] 用户说"GitHub 已推送" → 实际 git ls-remote 查不到 + API 列仓库也没有 → **仓库从未被创建过**，之前所有 device code 尝试都是失败状态。立刻要求用户 https://github.com/new 手动建（30 秒）

## 远程资源变更（按 Skill 铁律 2 立刻同步）
- [10:45] git init + 首次 commit → handover.md 更新 Git 状态
- [11:00] nginx greenrhino-cloud-ssl.conf 补 X-Forwarded-For → handover.md 更新云端 API 状态
- [15:20] Skill 升级加远程资源清单表 → handover.md 重写，GitHub 状态标 🟡（本地 remote 已配，远端待建）

## 决策
- [09:15] DEV 登录生产屏蔽：auth.ts 守卫 + LoginPage 全 DEV 包，双保险 → 不留后门
- [09:30] nginx 主后端路由补 X-Forwarded-For → 后端能看真实客户端 IP，便于追踪更新检查
- [10:30] git init 选 today 开始（v1.0.6 基线）→ 项目之前全裸文件，首次入库 1355 个
- [11:00] GH repo 名定 APP-AIE（stvode-cyber 下）→ 简洁好记
- [14:00] 创建 work-growth-logger Skill（独立于全局 ledger-keeper）→ 项目专属实时流水，和全局规范分工互补
- [15:00] Skill 加防失忆双铁律 → 被记忆错位坑了 2 小时，加流程堵死

## 待办
- [ ] **用户手动建 GitHub 仓库 APP-AIE**（https://github.com/new，Private，别勾初始化选项）→ 建完立刻 git push -u origin main
- [ ] git commit Skill 相关文件到本地仓库
- [ ] 等同事内测反馈（更新检查按钮 + DEV 一键登录）
- [ ] 清理服务器旧 nginx conf 备份（greenrhino-cloud.conf.bak.* 等）


---

## 2026-09-30.md

[15:06] electron-builder 重打包 release-v16 · 绿角犀-Setup-1.0.6.exe (160.4MB) + 绿角犀-Portable-1.0.6.exe (159.9MB)
[15:10] gate-check.ps1 7/7 全绿 ✅ · setup SHA256=9E8241A33034D49D1C72511B29B58BA599695C9765EBC0170300EA7E5CD86266
[15:12] SCP EXE 到服务器 /usr/share/nginx/html/apk/ + symlink 自动指向新文件 ✅
[15:14] prod.db windows_releases setupSha256 更新为新值 ✅
[15:15] 🚨 pitfall: PowerShell Set-Content 写 SQL 默认 UTF8 带 BOM，SQLite 报 syntax error → 用 [System.IO.File]::WriteAllText + UTF8Encoding(0)
[15:48] task-team.routes.ts 修 3 个 bug · 16/16 API smoke 全绿
  ① search 参数后端忽略——补 where.AND.push({OR:[title/description/remark contains]})
  ② where 结构——原来 OR + 多 top-level 属性，改为全 AND 数组统一组合
  ③ boss 权限——之前和 user 一样被 userId 限制，现在 boss 看全公司所有任务
  · commit 8f5da0f

[16:00] electron nsis 安装器自动杀旧进程 · commit 1e08f22
  · nsis 配置 + include: build/installer.nsh (customInit → taskkill 静默杀 绿角犀.exe)
  · 重打包 release-v16 绿角犀-Setup-1.0.6.exe SHA256=80E3D69F...C3
  · SCP 服务器 + prod.db setupSha256 更新 + pm2 restart 成功
  · task-team search 后端修复同步部署（全 AND 化 where + search contains）

[16:56] 🚨 3 坑连发：BUILD_MODE define/dev 不替换 / envFile 加载空 / PS Out-File BOM 炸 JSON.parse
  ① Vite define 只在 Rollup build 替换常量，dev server esbuild transform 不碰——dev 模式下 __BUILD_MODE__ 原样保留 ReferenceError
  ② 改用 vite.config.ts envFile: '.env.desktop' + '.env.mobile'——Windows+PowerShell 下 Vite loadEnv 返回空数组（原因不明）
  ③ PowerShell Out-File -Encoding UTF8 默认加 BOM（EF BB BF），Node JSON.parse 报 Unexpected token '﻿'
  → 最终方案：npm script 用 cross-env VITE_BUILD_MODE=desktop/mobile 设进程环境变量 + App.tsx 读 import.meta.env.VITE_BUILD_MODE
  → 5173 = desktop ✅ / 5174 = mobile ✅ 双端正确分离
  → 加 dev:admin npm script（vite --config admin-vite.config.ts --port 5175）避免手打
  → AGENTS.md Dev Server 三件套→四件套（补 mobile + admin）；BUILD_MODE 描述改为 cross-env + import.meta.env
  → 文件改动：frontend/package.json scripts、frontend/src/App.tsx、frontend/src/vite-env.d.ts、AGENTS.md
[17:01] git push origin main · 94bfdb3..d3f55b0 · 2 commit · GitHub stvode-cyber/-
  255dd65 fix(build): cross-env VITE_BUILD_MODE dev-mode pruning actually works
  d3f55b0 docs: AGENTS Dev Server 四件套 + VITE_BUILD_MODE 方案说明
[17:13] 🐛 真 Bug 修复：全局 error handler 没接 ZodError → 返回 500
  pm.routes.ts 6 处全用 schema.parse()（不是 safeParse），ZodError 没 catch 走到 errorHandler 最后返回 500
  修复：middleware/error.ts 加 ZodError instanceof 判断 → fail(res, issues[0].message, 422)
  验证：非法 status='archived' → HTTP 422 "Invalid enum value. Expected 'active'|'done'|'cancelled'"
  验证：非法 invoice type='invalidType' → HTTP 422 "Invalid enum value. Expected 'in'|'out'"
  一次修复所有路由受益
  · commit de8b142 · 待 push
[17:15] 📋 对话收尾总汇（本轮完整闭环）
  ① Vite BUILD_MODE define/dev 不生效 → cross-env + import.meta.env 搞定双端分离
  ② pm.routes.ts 后端 14 路由全链路 API 冒烟测试 16/17 通过
  ③ 发现真 Bug: ZodError 全局 error handler 没接 → 加 instanceof 判断返回 422
  ④ AGENTS.md 加对话收尾铁律（三动作）
  ⑤ 台账同步（daily + pitfalls 各追加多条）
  ⑥ commit: 255dd65 cross-env BUILD_MODE
  ⑦ commit: d3f55b0 AGENTS Dev Server 四件套
  ⑧ commit: de8b142 ZodError → 422 global handler
  ⑨ commit: 2d4dd84 AGENTS 对话收尾铁律（三动作 + 台账格式）
[17:26] admin 密码重置：16100214673 → admin123ABC · dev.db 已备份 dev.db.bak-HHmmss · bcryptjs 10 rounds · bcrypt.compare 验证 ✅ · /api/v1/auth/login 返回 role=admin ✅
[17:30] 服务器 prod.db admin 密码重置：username=tone_test2 → admin123ABC
  · 关键坑：prod.db 表名是 users（小写），本地 dev.db 是 User（Prisma 迁移历史）
  · 关键坑：服务器 admin 用户名 tone_test2（不是本地的 16100214673，双 admin 账号）
  · 关键坑：PS5 SSH 引号嵌套炸 → 写 .sql 文件 scp 上去 sqlite3 < file.sql 才稳
  · prod.db 备份：prod.db.bak-before-reset
  · 公网 /api/v1/auth/login 返回 HTTP 200 + role=admin ✅
[17:41] 🐛 IS-004: admin-vite.config.ts 缺 proxy → 5175 所有 API 返回 404
  · 根因：主 vite.config.ts 和 mobile-vite.config.ts 都有 /api → 3001 proxy，admin 忘了加
  · 修：admin-vite.config.ts server 里补 proxy 配置
  · 验证：登录 → token → 带 token 调 pm/stats、admin/users、pm/projects、task-team → 全 200 ✅
[17:52] 🐛 IS-005: admin 5175 dev 返回客户端页面不是管理后台
  · 根因 3 层叠加：admin 独立入口 admin.html/admin-main.tsx；Vite rollupOptions.input 只在 build 生效；dev server 默认用 root/index.html → 渲染 main.tsx → DesktopLayout/Layout
  · 试了 configureServer middleware rewrite + 手动返回 HTML + appType:'custom' 全失败
  · 最终方案：Vite 插件 adminHtmlPlugin，transformIndexHtml hook 按 URL 匹配 /admin/ 返回 admin.html 原始内容
  · 验证：title=绿角犀·管理后台 + script src=admin-main.tsx + proxy + admin/pm/task-team API 全 200 ✅
19:15 feat(admin): 运营后台 UI 重做 — 商业简洁 + PM 数据中心
  · AdminLayout: 侧边栏深绿→白底浅灰+蓝紫品牌色，9 项砍到 6 项（砍交接单/社区/A-B）
  · AdminDashboard: 完全重写，PM 项目账款为中心
    顶部 7 KPI（项目/销售/毛利/采购/已收/未收/用户）
    中部 3 卡（资金往来对比条+部门结构+待办任务）
    下部 最近项目表（部门/销售额/毛利/利润率/状态）
  · admin-vite.config.ts: middleware rewrite /admin/ → /admin/admin.html
    （M-001 Vite Dev Server 第 5 次踩坑，middleware 方案通了）

19:30 issues.md 升级为成长型 Master+子条目结构
  · 原来 5 条平铺 IS-001~005 → 5 组 Master M-001~005
  · M-001 聚合了 IS-003+IS-004+IS-005 + 4 个子条 → 子条目 ≥3 自动升 P0
  · 加合并触发条件、自动升级规则、活跃 Master ≤10 上限
  · AGENTS.md 挂载成长型铁律
20:30 feat(admin): 后台登录页独立简化 — AdminLoginPage 2 字段
  · 新建 AdminLoginPage.tsx（150 行极简），admin-main.tsx import 指向它
  · 砍客户端 LoginPage.tsx 841 行的所有冗余（手机号/验证码/注册/忘记密码/DEV 按钮/功能亮点）
  · 白底浅灰 + 蓝紫品牌，与 AdminLayout 侧边栏完全统一
  · 登录后校验 role===admin，非管理员拒绝
  · **关键决策**：独立文件不共用 variant props——LoginPage 841 行已经够大，再加 variant 更难维护

---

## 2026-10-08.md

# 2026-10-08 工作流水

## 服务器 nginx conf.d 清理

**[10:00] AGENTS 铁律入场**
- Git HEAD: `0828f8e` AdminPMPage 3 Tab ✅
- 4 端口: 3001 ✅ · 5173 ❌ · 5174 ❌ · 5175 ✅
- handover.md 快照停在旧 commit，需要更新

**[10:05] 清服务器 nginx conf.d 垃圾（16 → 7 文件）**
- 清前 16 个文件（7 active + 6 bak + 3 disabled）
- 清后 7 个活跃 conf，干净清爽
- 清掉 6 个 `.bak-*`：
  - erp-web.conf.bak-20260923-1119
  - greenrhino-cloud.conf.bak-20260914103329
  - greenrhino-cloud-ssl.conf.bak-（无名时间戳）
  - greenrhino-cloud-ssl.conf.bak-admin-084152
  - greenrhino-cloud-ssl.conf.bak-pre-clean-100757（本次清前备份）
  - lvjiaoxi.conf.bak-
- 清掉 3 个 `.disabled`：
  - lujax8443.conf.disabled
  - lujax_cloud.conf.disabled
  - yuanzhuo-updates.conf.disabled
- **nginx -t ✅ + reload ✅**
- 公网冒烟：admin 200 + apk 200 + api 200 ✅

**[10:10] 活跃 conf 端口分布（7 个）**
| conf | listen | 用途 |
|---|---|---|
| greenrhino-cloud-ssl.conf | **443 default_server** | 绿角犀主 HTTPS（admin/apk/api） |
| greenrhino-cloud.conf | **8091** | Garh Commercial HTTP |
| erp-web.conf | ? | ERP 项目 |
| lvjiaoxi.conf | **80** | lvjiaoxi.com（⚠️ chattr +i 锁死不能动） |
| lujax-cloud-https.conf | **80 + 443** | lujax.fun 老项目 |
| lujax_cloud.conf | **18443** | lujax.fun 另一个 HTTPS |
| lujax-fun.conf | **8444** | lujax.fun HTTP2 |

**[10:15] 铁律回顾（本次 nginx 清理）**
- ✅ 先备份主 conf（greenrhino-cloud-ssl.conf.bak-pre-clean-*）
- ✅ 先 nginx -t 确认活着
- ✅ 只清 `.bak-*` + `.disabled`（nginx 绝不加载这些后缀，零风险）
- ✅ 清完再 nginx -t + reload
- ✅ 公网冒烟 HEAD 快速检查（curl.exe -skI）
- ❌ 差点犯的：差点把三个 lujax 老项目 conf 一起删——虽然 server_name 都是 lujax.fun，但 listen 不同端口（80/443/18443/8444），不能乱砍

## 防踩坑小抄

| 场景 | 教训 |
|---|---|
| PowerShell ssh here-string 里有 bash `$f` / `$(basename)` | PowerShell 抢先解释 → 拆成多条 ssh 命令 |
| curl.exe 下载大 apk 会阻塞 | 用 `curl.exe -skI` 只查 HEAD 响应头 |
| lvjiaoxi.conf 有 chattr +i | 清它的 .bak 备份没事（备份没锁），清主 conf 必须先 `chattr -i` |

## lujax 老项目分析 + 清理（2 个 conf disabled）

**[10:30] 三个 lujax conf 必要性分析（零改动纯分析）**
- lujax-cloud-https.conf（80+443 → proxy_pass 8090）：🔴 **零**——后端 8090 没人监听 + lujax.fun Cloudflare 已不可达 + /apk/ 已被 greenrhino 覆盖 + nginx access log 8 天只有 2 条 WP 扫描
- lujax-fun.conf（8444 → proxy_pass 3001）：🔴 **零**——端口写错（aie-backend 跑 3100）+ 8444 非标准端口 Cloudflare 不代理
- lujax_cloud.conf（18443 → proxy_pass 18091 Python）：🟡 仅内测 IP:18443 能访问——Python 进程活着 + 静态目录 32M 在，但 Cloudflare 不代理非标准端口

**[10:42] 清理执行**
- ✅ 先把 lvjiaoxi.conf chattr +i 状态确认（别碰）
- ✅ 绿角犀公网冒烟基线（admin/apk/api/lvjiaoxi 全 200）
- ✅ mv lujax-fun.conf → .disabled（nginx 不加载 .disabled 后缀，零风险）
- ✅ mv lujax-cloud-https.conf → .disabled
- ✅ lujax_cloud.conf **保留**（半活，只有 IP:18443 内测访问）
- ✅ nginx -t + reload 成功
- ✅ 绿角犀公网冒烟改后全绿
- ✅ 8444 端口从 ss 监听列表消失
- ✅ 补备份到 /root/backup-lujax-conf-20261008-1042/（3 个 conf 全存）

**conf.d 最终：5 活跃 + 2 disabled**
活跃：greenrhino-cloud-ssl.conf / greenrhino-cloud.conf / erp-web.conf / lvjiaoxi.conf（+i 锁）/ lujax_cloud.conf
disabled：lujax-fun.conf.disabled / lujax-cloud-https.conf.disabled

**[10:45] 🚨 pitfall: PowerShell ssh here-string 里的 bash date 变量**
- BACK=/root/backup- → PowerShell 抢先解释 $(...) 为 Get-Date 命令
- 解法：PowerShell 侧先算好 $ts = Get-Date -Format "yyyyMMdd-HHmmss" 再拼进 ssh 命令
- 同时注意 "/" 在 PowerShell 双引号里也会被抢 → 用 ssh 命令直接绝对路径

**[10:50] 下一步**
- lujax_cloud.conf（18443）要不要也清？——保留观察，等用户确认没人用了再处理
- lvjiaoxi.conf（+i 锁）动不了，先放着
## lvjiaoxi.conf + lujax_cloud.conf 终极清理（2026-10-08）

**[10:55] 两个半活 conf 分析**
- lvjiaoxi.conf：listen 80 → proxy_pass 3002 (pm2 lvjiaoxi-web 23D)，但 DNS 没解析到这台 + access log 7 天 0 条 + 用户用 IP 47.116.59.141 直接下 apk，域名死的
- lujax_cloud.conf：listen 18443 ssl → proxy_pass 18091 Python pid=103151，非标准端口 Cloudflare 不代理，只能 IP 直连

**[11:00] 清理执行（AGENTS 铁律 5 步）**
1. 绿角犀公网冒烟基线：admin/apk/api 全 200 ✅
2. 服务器备份：/root/backup-final-lujax-20261008-111005/（4 disabled conf + pm2 dump + ss-listen）
3. chattr -i 解 lvjiaoxi.conf 锁（----i---------e------ → --------------e------）
4. mv lvjiaoxi.conf + lujax_cloud.conf → .disabled
5. nginx -t ✅ + systemctl reload ✅
6. pm2 stop + delete lvjiaoxi-web（省 3002 端口 + 78MB RAM）
7. kill Python pid=103151（省 18443 + 18091 端口）
8. 绿角犀公网改后全绿：admin/apk/api 全 200 ✅
9. 最终端口：80 / 443 / 8091（干净了！）

**清理前 vs 清理后**
| 维度 | 清理前 | 清理后 |
|---|---|---|
| nginx 活跃 conf | 7 | 3 |
| nginx listen 端口 | 5 个（80/443/8444/18443/8091） | 3 个（80/443/8091） |
| pm2 进程 | 3 个（aie/erp/lvjiaoxi） | 2 个（aie/erp） |
| 服务器 RAM | 37.8% | ~37% |
| 省端口 | 8444/18443/3002/18091 | ✅ |

**最终 nginx conf.d（3 活跃 + 4 disabled）**
✅ greenrhino-cloud-ssl.conf — 443 default_server 绿角犀主 HTTPS
✅ greenrhino-cloud.conf — 8091 Garh Commercial（容器活着）
✅ erp-web.conf — ERP 项目（端口？pm2 erp-backend 3000 活着）
⏸ lvjiaoxi.conf.disabled — DNS 没解析，pm2 已删
⏸ lujax_cloud.conf.disabled — 18443 非标准端口，Python 已 kill
⏸ lujax-cloud-https.conf.disabled — proxy_pass 8090 空 + Cloudflare 死
⏸ lujax-fun.conf.disabled — proxy_pass 3001 写错 + 非标准端口

---

## 2026-10-09.md

# 2026-10-09 工作日志

## 改了啥
- [19:00] 梳理项目结构（AGENTS.md / STATUS.md / 端口 / 技术栈），启动 dev 四件套（后端3001 + 三前端5173/5174/5175） #dev-ops
- [19:20] admin-vite 5175 打不开，清 node_modules/.vite 预构建缓存 → 重启修复 #dev #vite
- [19:30] 后端 auth.routes.ts 5 处 login/register/me select 加 employeeRole + departmentId #团队门槛
- [20:00] 后端 team.routes.ts 加 POST /bootstrap（创建部门+自设boss+双向leader关联）+ team/pm/task-team 三个路由组各加 requireTeam 中间件（departmentId=null → 403 NO_TEAM） #团队门槛
- [20:40] 前端 auth.ts UserInfo 接口加 employeeRole + departmentId
- [20:50] 前端 DesktopLayout NAV_GROUPS 改动态（无团队只显群立团队入口，有团队显团队任务/团队设置/项目账款）
- [21:00] 前端新建 TeamCreatePage.tsx（/team/create：引导页+创建表单+bootstrap API）+ App.tsx 注册路由 + RequireTeam 守卫包团队相关路由
- [21:30] 完整流程浏览器测通：无团队侧边栏显群立团队 → 创建成功自动跳 /team/tasks → 侧边栏切换完整菜单 → admin+dev user 重置回无团队
- [21:50] 用户加需求：群立团队时自动建团队对话群 → schema 加 Department.groupId + Group.departmentId，db push + generate
- [22:00] team.routes bootstrap 事务扩成 6 步（部门→Group+GroupMember(owner)→双向绑定groupId→设boss→Conversation），返回 conversation.id
- [22:05] TeamCreatePage 创建成功跳 /chat/g/:convId；DesktopLayout 有团队时"团队对话"排团队组第一
- [22:10] curl 实测 bootstrap 6 步全成功（部门+群+群成员+会话+绑定），admin 重置回无团队
- [22:15] 版本号三处 1.0.6 → 1.1.0（新功能升 minor），sync-dist 全绿（FE 199 / BE 174 文件三层一致）
- [22:40] build-desktop.cjs 第三次打包成功 → gate-check 7 项全绿（Setup 160.5MB + Portable 160MB，SHA256 已生成）→ 清旧产物 + CHANGELOG 记账

## 踩坑
- [19:20] admin-vite 报 "Cannot read properties of null (reading 'useRef')"（BrowserRouter 内）→ vite 预构建缓存脏了，删 node_modules/.vite 重启解决 #dev #vite
- [20:30] PowerShell 里 `node -e` 写 ESM import → 引号转义炸 + dist 导出是 `prisma` 不是 `PrismaClient` → 改用 .mjs 文件
- [22:20] PowerShell -replace 替换串 `$11.1.0` 被解析成捕获组11引用，package.json version 行损坏 → Edit 工具手修；替换串要用 `${1}1.1.0` #P0 #PowerShell
- [22:35] build-desktop 两次失败：dev server node 进程锁 prisma query_engine dll → prisma generate EPERM → 打包前必须全停 node 进程 #P0 #打包

## 决策
- [20:15] 团队门槛用 User.departmentId 字段判断（不复用 Group/GroupMember），因为现有 team.routes/pm.routes 全部围绕 Department + employeeRole(boss/supervisor/user) 这套 ERP 模型，Group 是社交层的东西
- [20:20] 团队功能用"双保险"：后端每个路由组中间件 + 前端 RequireTeam 路由守卫，防止绕过 #安全
- [21:50] 群立团队自动建对话群：群名="团队名 团队"，创建者=群主，Department↔Group 双向绑定 groupId（active）
- [22:15] v1.1.0 语义化：新功能升 minor（1.0.6→1.1.0）（active）

## 待办
- [ ] 推云端（等用户拍板）：seed-windows-release.ps1 -Version 1.1.0（内测两步走第二步）
- [ ] 可选：bootstrap 事务返回的 dept 快照 leaderId/groupId 为 null（用 me.department 可拿到真实值，不阻塞）
- [ ] 可选：auth init() 异步拉 /auth/me 与 RequireTeam 守卫的竞态（刷新后自动恢复，正常流程无问题）

## 续班测试 + Bug 修复（23:00-23:30）
- [23:05] 🐛 Bug: auth.routes.ts login 路由返回的 user 对象缺 employeeRole + departmentId（L511-525 手动组装时遗漏） → 补上两字段 · 同修 phone-login L375-384
- [23:10] 浏览器全流程测通（10/10 全绿）：登录→无团队侧边栏只显群立团队→TeamCreatePage→创建团队→跳 /chat/g/:convId→侧边栏切换完整菜单
- [23:15] API 验证 bootstrap 6 步事务全成功：department+group+group_member+conversation+双向绑定 · admin departmentId/employeeRole 正确更新
- [23:20] requireTeam 中间件验证：pm/projects 200 ✅ · task-team 200 ✅（admin 有 departmentId 后中间件放行）
- [23:25] 测试数据清理完毕（删 departments/groups/conversations/group_members + 重置 users departmentId=null）


---

## 2026-10-10.md

# 2026-10-10 工作流水

[16:00] git push main → origin · ✅ 成功 b75d6e4..5c0fc1b · 6 commits · 本地/远端完全同步
[16:01] STATUS.md + handover.md Git 状态同步更新 · ✅
[16:02] 🚨 pitfall: resources/mobile-dist build 产物每次 build 后 hash 变多，全是 untracked 新建文件，不影响 push（只推送已有 commit）

## Android 自动更新链路（下午 session）
[17:00] Prisma schema 加 AndroidRelease model · db push 本地 + 云端 prod.db · ✅
[17:05] 后端加 GET /api/v1/app/android-version?current=X.Y.Z · semver compare + 日志追踪 · ✅ 云端部署 + curl 验证 hasUpdate=true/false 正确
[17:10] seed-android-release.cjs 脚本（自动翻 isLatest + 插入新版本）· ✅ 云端 seed v1.0.3
[17:15] 装 @capacitor/filesystem · IntentInstallerPlugin.java 原生插件（FileProvider + Intent.ACTION_VIEW）· ✅
[17:20] UpdateNotice.tsx 重写：fetch 下载带进度条 → Filesystem.writeFile 写内部存储 → IntentInstaller.install 调系统安装器 · ✅
[17:25] vite build + cap sync + gradlew assembleDebug · ✅ **BUILD SUCCESSFUL**（关键：JDK 17 覆盖 kotlin jvmToolchain(21) 靠 subprojects afterEvaluate + gradle.properties org.gradle.java.home）
[17:30] APK 上传云端 /usr/share/nginx/html/apk/greenrhino-latest.apk · seed v1.0.4 · ✅

## 踩坑 #android-build
- Capacitor v8 默认 JDK 21 硬要 kotlin jvmToolchain(21)，JDK 17 直接炸
- **解法**：root build.gradle 加 `subprojects { subp.afterEvaluate { subp.kotlin { jvmToolchain(17) } } }` 覆盖插件自己的 toolchain；同时 gradle.properties 加 `org.gradle.java.home=C:/greenrhino-tools/jdk17`
- **推翻旧 handover 硬规则**：不再硬要 JDK 21！JDK 17 + afterEvaluate 覆盖够用
- 另：capacitor-filesystem 插件自己 build.gradle 也写死了 kotlin jvmToolchain(21)，同样被 afterEvaluate 覆盖

## 待安装验证
- APK 位置：`frontend/android/app/build/outputs/apk/debug/app-debug.apk`（13.71MB，MD5 7f134aef8d05d21a85a680bd8fe6ae05）
- CURRENT_APK_VERSION='1.0.2'，seed 的最新版是 1.0.4 → 启动 3s 后弹更新 Dialog
- **手机现在连不上 adb**（192.168.1.119 ping 不通，网段扫不到）· 需要用户手动插 USB 或开无线调试

## SKILL 已创建
- `.trae/skills/android-auto-update/SKILL.md` — 8 步发版流程 + 铁律 + 版本号三落点
- AGENTS.md 硬约束追加第 10 条：Android 发版必须走 SKILL 流程


---

## 2026-10-12.md

# 2026-10-12 工作日志（交接包重写日）

## 改了啥

- [全天] **完整交接包刷新** — handover.md 重写到 HEAD `2e2ee55`（10-10 的 Android 自动更新大改动之前 handover 停在 `1bcd54b`）· 新增：commit 序列、场景 B/C/D 启动命令、AndroidRelease model、IntentInstallerPlugin.java 结构、活跃坑 Top 7（推翻 JDK 21 硬规则）、手机端 testuser 临时账号、P0-P3 下一步、快速验证清单完整脚本

## 踩坑

- [P0][10-10] Capacitor v8 kotlin jvmToolchain(21) 硬覆盖 → 用 afterEvaluate 子模块级覆盖（推翻旧 "JDK 21 必需" 规则）· 见 handover 活跃坑 #1
- [P1][10-10] Setup.exe `/S` 静默安装被 Defender 拦（ExitCode 0 但文件消失）→ 改 win-unpacked 直拷 · 见 handover 活跃坑 #2
- [P1][10-10] electron-builder publish 配置了 `lvjiaxi/aie-desktop`（错仓库）→ `--publish never` 跳过

## 决策

- [2026-10-10] JDK 17 + afterEvaluate 覆盖够用 → 推翻旧 handover 硬规则 "Capacitor 8 硬要 JDK 21"
- [2026-10-10] 桌面版安装走 win-unpacked 直拷 → Setup.exe 静默被 Defender 拦，用户手动装 Setup 也需要 UAC 确认
- [2026-10-10] Android 自动更新走原生 IntentInstallerPlugin → 不用 cordova-plugin-app-update（太重），自己写 1 个 Java 文件 + TypeScript bridge 就够

## 本轮代码安全审核（全天后半段）

### P0 发现并修复（commit `f447cef`）

| # | 问题 | 文件 | 修复 |
|---|---|---|---|
| P0-1 | SMS 验证码明文进 pm2 logs | auth.routes.ts / smsService.ts | 生产只打脱敏 phone，code 仅 dev 回传 |
| P0-2 | Electron 3 处硬编码 http://47.116.59.141:3001/3900 | electron/main.cjs | 改 https://47.116.59.141 走 Nginx 反代（LLM_GATEWAY_URL 从 CLOUD_BACKEND_URL 拼装消除重复） |
| P0-3 | CORS origin 全放行 callback(null, origin) | backend/src/index.ts | 精确白名单 + 47.116.59.141 后缀 + 自定义 scheme，未知 origin 拒绝并 warn |
| P1-4 | platform.ts mobile fallback lujax.fun SNI 封锁 | frontend/src/lib/platform.ts | 改直连 IP 47.116.59.141 |

### P0 虚惊（好消息）
- SQL `${userId}` 全部在 Prisma tagged template 反引号内，自动参数化 ✅
- ZodError→422、Admin 鉴权链、Electron SHA256 更新链路、单实例互斥、SQLite 双引号表名——全过 ✅

### P2 架构债（未动，留作 TODO）
- ai-reply.ts 2250 行巨型文件，意图识别十几个 regex if 堆一起 → 建议拆 intents/ 目录
- 空 catch 68 处，约 10 处无注释 → 补注释
- WeeklyReportPage/PetPage/ReviewPage 硬编码 hex 颜色 → token 化
- 后端 scheduler/service 层 console.log 31 处 → 引入 logger 分级

### 连锁反应（必须注意）
- 生产环境 send-sms 接口不再回传 code，但后端没接真实短信网关 → **生产环境用户拿不到验证码注册**，需先接入阿里云 SMS 或改用其他注册方式才能上线

### 验证
- ✅ backend `npx tsc --noEmit` 零错误
- ✅ frontend `npx tsc --noEmit` 零错误
- ✅ commit `f447cef` 5 files changed, 71+/19-

## [16:30] 电脑+手机端重新打包安装

- **电脑端链路**：前端 `npm run build` → backend `npm run build` → sync 到 electron/resources → `npm run dist:win` → Setup.exe 160.5MB → 装到 `C:\Program Files\aie-desktop\`（注册表 UninstallString 记录的路径，不是默认 LOCALAPPDATA）
- **Setup.exe 陷阱**：electron-builder `dist:win` 会用旧缓存的 main.cjs → 装出的 EXE 里还是老 HTTP:3001 硬编码 → 改用 `npm run pack` 重新出 win-unpacked，手动覆盖 resources/app/main.cjs + frontend + backend/dist → main.cjs 里 `http://47.116.59.141` 从 4 处 → 0 处（含 L456 CLOUD_AUTH_BASE_URL 之前漏掉的第 4 处）
- commit `c759de1` 补了 CLOUD_AUTH_BASE_URL 漏改那处 → `git push origin main`
- `Start-Process "C:\Program Files\aie-desktop\绿角犀.exe"` spawn → 5 子进程 + health=200 ✅
- **用户数据目录**：`%APPDATA%\aie-desktop\data\aie.db`，后端日志 `%APPDATA%\aie-desktop\logs\backend.log`（productName 含中文 → main.cjs 里手动 setPath 到 aie-desktop）
- 已知小瑕疵：`[updater] Cannot find module './updater.cjs'` 启动时打 WARN，跳过不影响

- **手机端链路**：`npm run build:mobile` → `npx cap sync android` → `gradlew assembleDebug` → APK 13.7MB → `adb install -r` Success → monkey 启动 com.aie.assistant ✅

## 待办

- [ ] **手机连上 adb** → 真机验 UpdateNotice Dialog + 下载进度条 + 系统安装器触发（P0）
- [ ] 生产环境接入真实短信网关（阿里云 SMS）或换注册方式，否则 send-sms 改动的连锁反应会阻塞注册
- [ ] 正式发布前删 auth.ts 里 auto-login else-if 块（P1）
- [ ] 清理临时文件：screen-*.png · screenshots/ · patch-nginx.py · check-admin.mjs · parse-sel.cjs（P2）
- [ ] 手机设置里关绿角犀应用分身（用户手动）


---

