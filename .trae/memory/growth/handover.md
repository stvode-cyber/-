# 🤝 绿角犀管家 — AI 交接总览

> 新 AI 进门第一读。30 秒内读懂项目状态。每日更新。

## 项目一句话
Electron 桌面端（Windows）+ React 18 + Node.js/Express + Prisma/MySQL，本地优先的多模块助手。

## 当前状态
- **版本**：v1.0.6（内测中）
- **Git**：main 分支，最新 commit `a490a83`，remote = **git@github.com:stvode-cyber/-.git**（已 push 成功）
- **服务器**：47.116.59.141，pm2 aie-backend（3100 端口，online）
- **后端日志**：windows-version API 调用日志已生效 + X-Forwarded-For 真实 IP

## 远程资源清单
| 资源 | URL/位置 | 状态 | 备注 |
|------|---------|------|------|
| GitHub | git@github.com:stvode-cyber/-.git | ✅ 已 push | 仓库名是 `-`（自动化失败 + 误输入，保持原名），SSH key 在 C:\Users\Administrator\.ssh\id_rsa |
| 云端 API | https://47.116.59.141/api/v1 | ✅ 在线 | nginx greenrhino-cloud-ssl.conf，已补 X-Forwarded-For |
| 下载链接 | https://47.116.59.141/apk/lvjiaoxi-setup-1.0.6.exe | ✅ 生效 | 301 跳 HTTPS，软链接 lvjiaoxi-setup/portable-1.0.6 |
| APK 目录 | 服务器 /apk/ | ✅ 已清理（1.2G→326M） | 旧 v1.0.2 + 历史备份已删 |

## 服务器 SSH
```bash
ssh root@47.116.59.141
pm2 list                          # 看进程
pm2 restart aie-backend           # 重启后端
tail -f /root/backend/logs/out.log  # 看日志
lsattr /etc/nginx/conf.d/*.conf   # 查 immutable 锁
```

## 铁律（别碰）
1. **版本号三处同步**：3 个 package.json + EXE FileVersion
2. **改后端端口**：必须同步改 nginx conf.d 里所有 proxy_pass
3. **内测两步走**：本机改完 → 用户拍板 → 推服务器
4. **LLM_API_KEY 不进安装包**：新电脑手动放 userData/llm.env
5. **DEV 登录仅限开发环境**：import.meta.env.DEV 包起来（双保险：auth.ts + LoginPage）

## ⚡ 防失忆双铁律（work-growth-logger Skill）
1. **关键操作前先查记录**：`git ls-remote` / API 查 / `pm2 list`，查到才算做过
2. **关键操作后立刻同步**：别等对话结束，改完立刻追加 daily/handover

## 代码规范
- PowerShell 脚本必须 UTF-8 带 BOM
- 中文路径项目先 mklink /J 挂英文路径再构建
- 所有文件改动记录在 .trae/memory/growth/

## 下一步
- [ ] 等同事内测反馈（更新检查按钮 + DEV 一键登录）
- [ ] 清理服务器旧 nginx conf 备份（greenrhino-cloud.conf.bak.* 等 15 份）
- [ ] （可选）后续把仓库名从 `-` 改成 APP-AIE（Settings → Repository name）

## 最近踩坑标签
#编码修复 #GS-002 #nginx #PS5.1 #immutable锁 #记忆错位 #CDP #Chrome #bot防护 #device-code #user-data-dir
