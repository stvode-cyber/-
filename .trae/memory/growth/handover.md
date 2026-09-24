# 🤝 绿角犀管家 — AI 交接总览

> 新 AI 进门第一读。30 秒内读懂项目状态。每日更新。

## 项目一句话
Electron 桌面端（Windows）+ React 18 + Node.js/Express + Prisma/**SQLite**，本地优先的全能个人助理。**数据库是 SQLite 不是 MySQL**。

## 当前状态
- **版本**：v1.0.6（内测中，同事测试中）
- **Git**：main 分支，最新 commit `b678fd1`，remote = **git@github.com:stvode-cyber/-.git**（已 push，仓库名是短横线 - ）
- **服务器**：47.116.59.141，pm2 aie-backend（3100 端口，online，内存 82MB）
- **SHA256 对齐**：✅ 三处一致（本地 EXE = 服务器 EXE = API 返回）
- **后端日志**：windows-version API 调用日志已生效 + X-Forwarded-For 真实 IP

## 远程资源清单
| 资源 | URL/位置 | 状态 | 备注 |
|------|---------|------|------|
| GitHub | git@github.com:stvode-cyber/-.git | ✅ 3 commit 全推 | 仓库名是 `-`（自动化失败 + 误输入），SSH key 在 C:\Users\Administrator\.ssh\id_rsa |
| 云端 API | https://47.116.59.141/api/v1/app/windows-version | ✅ HTTP 200 | 返回 v1.0.6 + 真实 SHA256 + 下载链接 |
| 下载链接 | https://47.116.59.141/apk/lvjiaoxi-setup-1.0.6.exe | ✅ HTTP 200 | 软链接 → 绿角犀-Setup-1.0.6.exe |
| EXE 托管 | /usr/share/nginx/html/apk/ | ✅ 两个 EXE + 软链接 | nginx root /usr/share/nginx/html + location /apk/ |
| 生产库 | /root/backend/prisma/prod.db | ✅ SQLite | windows_releases 表已更新 SHA256 |
| nginx conf | /etc/nginx/conf.d/greenrhino-cloud-ssl.conf | ✅ | 补 X-Forwarded-For + /apk/ 301 跳 HTTPS |

## SHA256（三处对齐）
```
绿角犀-Setup-1.0.6.exe:   007F417EF97C808485CA26295D8F98EC53FD29756802717B8BA95580B63EDB3B
绿角犀-Portable-1.0.6.exe: C0E6C97BB65545FF6B29E400C0CE3B5E53418C7B3AF62787F6FDF4B29B56DCFE
```

## 服务器 SSH
```bash
ssh root@47.116.59.141
pm2 list                          # 看进程
pm2 restart aie-backend           # 重启后端
tail -f /root/backend/logs/out.log  # 看日志
lsattr /etc/nginx/conf.d/*.conf   # 查 immutable 锁
sqlite3 /root/backend/prisma/prod.db ".schema"  # 查数据库表
```

## 铁律（别碰）
1. **版本号三处同步**：electron/backend/frontend 三个 package.json + 前端 5 处硬编码
2. **改后端端口**：必须同步改 nginx conf.d 里所有 proxy_pass
3. **内测两步走**：本机改完 → 用户拍板 → 推服务器
4. **LLM_API_KEY 不进安装包**：新电脑手动放 userData/llm.env
5. **DEV 登录仅限开发环境**：import.meta.env.DEV 包起来（双保险：auth.ts + LoginPage）
6. **Electron SHA256 必同步**：build 完 EXE SHA 会变，必须 scp 传服务器 + 更新 SQLite windows_releases 表

## ⚡ 防失忆双铁律（work-growth-logger Skill）
1. **关键操作前先查记录**：`git ls-remote` / API 查 / `pm2 list`，查到才算做过
2. **关键操作后立刻同步**：别等对话结束，改完远程资源（服务器/仓库/数据库）立刻追加 handover.md + daily

## 发版命令速查（v1.0.6 验证过）
```powershell
# 1. 本地 build
cd APP-AIE
node build-desktop.cjs

# 2. gate-check
powershell -ExecutionPolicy Bypass -File .\gate-check.ps1

# 3. 传 EXE 到服务器
scp "electron\release-v*\绿角犀-*.exe" "root@47.116.59.141:/usr/share/nginx/html/apk/"

# 4. 服务器算 SHA256 + 更新 SQLite
ssh root@47.116.59.141 "sha256sum /usr/share/nginx/html/apk/绿角犀-*.exe"
# 写临时 SQL 文件 → scp 上去 → ssh sqlite3 prod.db < update.sql

# 5. 验证 API
curl -skL https://47.116.59.141/api/v1/app/windows-version
```

## 代码规范
- PowerShell 脚本必须 UTF-8 带 BOM
- 中文路径项目先 mklink /J 挂英文路径再构建
- SQLite 不是 MySQL！更新用 `sqlite3 prod.db < update.sql`，引号嵌套问题写临时 SQL 文件
- Electron build 后 EXE SHA256 必变，必须同步更新服务器 + 数据库
- 所有文件改动记录在 .trae/memory/growth/

## 下一步
- [ ] **等同事内测反馈**（更新检查按钮 + DEV 一键登录 + 闪退卡死）
- [ ] 清服务器旧 nginx conf 备份（15 份 .bak.*）
- [ ] （可选）GitHub 仓库改名 `-` → `APP-AIE`
- [ ] v1.0.6 Android APK 更新（正式签名）

## 最近踩坑标签
#编码修复 #GS-002 #nginx #PS5.1 #immutable锁 #记忆错位 #CDP #Chrome #bot防护 #device-code #user-data-dir #SQLite #Electron-SHA256
