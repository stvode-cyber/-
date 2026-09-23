# 踩坑清单（永不归档，持续积累）

> 每条含：现象 → 根因 → 预防规则 → 关联文件/标签

---

## [P0][GS-002] PowerShell 5.1 读 UTF-8 无 BOM 中文炸
- **现象**：Get-Content 不加 -Encoding UTF8 → 中文被当 GBK → ConvertFrom-Json 炸（PS 5.1 默认系统编码）
- **根因**：Windows 中文系统 locale 是 GBK，PS 5.1 默认用系统编码读 UTF-8 无 BOM 文件
- **预防**：PS 脚本加 UTF-8 BOM；Get-Content 一律加 `-Encoding UTF8`；nginx conf 必须 UTF-8 无 BOM（nginx 不认 BOM）
- **关联**：gate-check.ps1、所有读含中文 JSON 的脚本 #编码修复 #PS5.1

## [P0] nginx conf 被 chattr +i 锁死
- **现象**：mv/重写 conf 文件报 Permission denied，root 也不行
- **根因**：运维用 chattr +i 防误删，忘了自己也要改
- **预防**：改 nginx conf 前先 `lsattr` → 有 i 就 `chattr -i`，改完 `nginx -t && nginx -s reload && chattr +i`
- **关联**：/etc/nginx/conf.d/*.conf #nginx #immutable锁

## [P1] 多 listen 80 端口的 conf 归属 default_server
- **现象**：改了 erp-web.conf 以为生效，结果请求一直进 lvjiaoxi.conf（带 default_server 才是真接流量的）
- **根因**：服务器有多个 listen 80 的 conf，只有带 default_server 的那个才接直接 IP 访问
- **预防**：改 nginx 配置前先 `grep -n 'listen 80' /etc/nginx/conf.d/*.conf` 看归属
- **关联**：lvjiaoxi.conf、erp-web.conf #nginx #default_server

## [P1] gh auth 被 GH_TOKEN 环境变量覆盖
- **现象**：gh auth status 显示已登录，但 gh auth refresh 报 "GH_TOKEN is being used"，gh repo create 报 403
- **根因**：进程环境变量 GH_TOKEN（GitHub App token）优先于 gh 自身凭据，而且那个 token scope 不够
- **预防**：重新 gh auth 前先 `Remove-Item Env:\GH_TOKEN`；定期刷新 token scope
- **关联**：gh.exe、%USERPROFILE%/.config/gh/ #GH-auth

## [P2] Vite 构建生成 timestamp 临时文件混进 git
- **现象**：vite.config.ts.timestamp-xxx.mjs 被 git add 进去了
- **根因**：Vite 调试时生成，.gitignore 里没排除
- **预防**：.gitignore 加 `*.timestamp-*.mjs`
- **关联**：frontend/.gitignore #vite #gitignore

## [P2] nginx conf heredoc 写文件时 PowerShell 转义 `$host`
- **现象**：heredoc 里直接写 `$host` 被 PS 当变量展开成空字符串，nginx 语法错
- **根因**：PS 的 here-string 是可插值的，`$` 开头的会被当变量
- **预防**：用 PS 的 here-string 时，`$nginx_var` 必须反引号转义 `` `$host `` 或 `$$`（双 here-string 例外）；更稳的做法是本地写好无 BOM 文本文件再 scp 上去
- **关联**：所有通过 SSH heredoc 写 nginx conf 的场景 #nginx #PowerShell

## [P0] 用户说"这个做过了"实际没做 → 必须先验证再继续
- **现象**：用户说"GitHub 仓库建过了"，AI 直接说"好的"然后跑 push → Repository not found。来回搞 2 小时
- **根因**：① 对话记忆截断（之前尝试可能在旧对话里失败了）② 用户可能记成别的项目了 ③ AI 不验证就信
- **预防**：关键远程状态必须**立即验证**再继续：
  - 说 GitHub 仓库存在 → `git ls-remote git@github.com:X/Y.git HEAD` → 有输出才算存在
  - 说后端重启了 → `pm2 list && curl health` → 进程 online + 接口 200 才算
  - 说 nginx 改了 → `cat /etc/nginx/conf.d/*.conf | grep pattern` → conf 里有才算
  - 说 git push 过 → `git log origin/main` 或 GitHub API 查 → 远端有提交才算
- **关联**：所有远程状态验证场景 #记忆错位 #GH #双铁律-1

## [P1] gh auth device code 流程不稳定
- **现象**：`gh auth login --web` 超慢（15-25 秒）或直接超时；device code 出来后用户没及时输又过期；轮询 access_token 等半天拿不到
- **根因**：GitHub OAuth endpoint 国内不稳定；gh 自身请求慢；device code 有效期只有 15 分钟
- **预防**：
  1. 先 `Remove-Item Env:\GH_TOKEN` 清掉干扰
  2. 不想等 gh → 从 gh 二进制提取 client_id，`curl -X POST https://github.com/login/device/code` 直连（client_id = `Iv1.e7b89e013f801f03`）
  3. 拿到 device_code 后立刻 `curl -X POST /login/oauth/access_token` 轮询（间隔 5 秒，最长 15 分钟）
  4. 最稳：让用户浏览器手动建仓库，AI 直接 ssh push
- **关联**：所有 gh auth 场景 #GH-auth #device-code
