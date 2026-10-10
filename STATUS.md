# STATUS.md — 工程状态汇总

最后更新：2026-10-10（v1.1.0 + QQ空间圈子 + 团队门槛）

## 当前版本

**v1.1.0** — electron/package.json `"version": "1.1.0"`

## Git

| 项 | 值 |
|---|---|
| 分支 | main |
| 最新 commit | `1bcd54b` feat(community): QQ空间风格圈子改造 |
| 领先 origin | 5 个 commit（未 push） |
| remote | git@github.com:stvode-cyber/-.git |
| 工作区 | 源码干净，electron/resources/ 有 build 产物变动（正常） |

## 模块状态

| 模块 | 状态 | 最后更新 | 备注 |
|---|---|---|---|
| 后端 3001 | ✅ 稳定 | 2026-10-10 | +community.users/:userId +filter=mine/friends +requireTeam 中间件 |
| 桌面端 5173 | ✅ 稳定 | 2026-10-10 | +SpacePage.tsx + 侧边栏"圈子" |
| 手机端 5174 | ✅ 稳定 | 2026-10-10 | Capacitor v8 + assembleRelease APK 13.2MB |
| 管理后台 5175 | ✅ 稳定 | 2026-10-10 | auth.ts login() 补 return res |
| Electron 壳 | ✅ v1.1.0 | 2026-10-10 | 删端口探测误判，只留 requestSingleInstanceLock |
| 桌面版打包 | ✅ v1.1.0 | 2026-10-10 | Setup.exe 168MB 覆盖 C:\Program Files\aie-desktop\ |
| 服务器 47.116.59.141 | ✅ online | — | pm2 aie-backend 端口 3100 |

## 2026-10-09~10 改动记录（v1.1.0）

- [x] QQ 空间风格圈子：CommunityPage Tab 改 全部动态/我的说说/好友说说，标题改"圈子"
- [x] 新建 SpacePage.tsx 个人空间页（封面+头像+统计+说说时间线）
- [x] 后端 GET /community/posts 加 filter=mine/friends（基于 Friendship 表过滤）
- [x] 后端新增 GET /community/users/:userId（资料+统计+关系）+ GET /community/users/:userId/posts（说说时间线）
- [x] DesktopLayout.tsx 侧边栏 label "圈子"，帖子作者头像可点击跳 /space/:userId
- [x] 团队门槛功能：POST /team/bootstrap（6 步事务）+ requireTeam 中间件
- [x] Electron main.cjs 删错误的端口探测双重兜底（dev server 也返回 200 导致误杀）
- [x] auth.ts login() 补 return res + interface 从 Promise<void> 改为 Promise<{token,user}>
- [x] auth.routes.ts login/phone-login 补 employeeRole 和 departmentId 返回字段
- [x] Setup.exe v1.1.0 打包 + 覆盖安装目录
- [x] Android APK 打包（Capacitor v8 + JDK 21）+ adb install 到 ZY22KJLPHK

## 活跃坑 Top 5

1. Electron main.cjs 端口探测误判（已删，只留 requestSingleInstanceLock）
2. auth.ts login() 不返回值 → AdminLoginPage 拿 undefined
3. 表名漂移：本地 PascalCase vs 服务器小写复数，写 SQL 前先 `.tables`
4. seed.ts 会覆盖 admin 密码（.env ADMIN_PASSWORD）
5. Prisma Client 锁 db，杀进程后等 2 秒再起

## 下一步

- [ ] git push 到 GitHub（main 领先 origin 5 个 commit）
- [ ] 真机验证圈子功能（手机已装 APK）
- [ ] SpacePage 加 bio 字段（User 表当前没有）
- [ ] 好友功能完善（当前 isFriend 只读，加好友按钮未实现）
