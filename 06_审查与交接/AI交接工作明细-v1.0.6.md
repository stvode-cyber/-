# 🔑 AI 交接工作明细 — v1.0.6

> **目的**：让下一个 AI 接手时，看完这一份就能立即上手，不用重新摸石头过河。
> **版本**：2026-09-22
> **当前里程碑**：v1.0.6 内测已发布，客户端更新检查 + DEV 一键登录功能就绪，同事正在测试。

---

## 一、项目是什么

**绿角犀（lvjiaoxi）** — 一个桌面端看图 + AI 助理应用，Electron 打包成 Windows EXE。

| 维度 | 详情 |
|------|------|
| 当前版本 | **v1.0.6**（2026-09-22 发布） |
| 技术栈 | Electron + React(Vite) + NestJS(Prisma+SQLite) |
| 运行形态 | Electron 内嵌前端 + 内嵌后端（127.0.0.1:3001） |
| 云端服务 | https://47.116.59.141 （Nginx 443 反代后端 API） |

---

## 二、本地项目结构（最重要的几个目录）

```
D:\源码存档\助理项目\助理项目\APP-AIE\
├── frontend\              ← React 前端源码（1.0.6）
│   ├── src\
│   │   ├── pages\settings\AboutSettingsPage.tsx   ← 更新检查按钮在这里
│   │   ├── pages\LoginPage.tsx                     ← DEV 一键登录在这里
│   │   └── stores\auth.ts                         ← devLogin 方法在这里
│   └── package.json                                  ← version: 1.0.6
│
├── backend\               ← NestJS 后端源码（1.0.6）
│   ├── prisma\schema.prisma                          ← 数据库表结构
│   ├── prisma/prod.db                                ← ★ 生产数据库
│   └── package.json                                  ← version: 1.0.6
│
├── electron\              ← Electron 壳
│   ├── main.cjs                                      ← 主进程（路径逻辑在 L91-L104）
│   └── package.json                                  ← version: 1.0.6
│
├── build-desktop.cjs      ← ★★★ 一键打包脚本（APP-AIE 根目录，不在 electron/ 里！）
├── sync-dist.ps1          ← ★★★ 开发态同步脚本
├── gate-check.ps1         ← ★★★ 发版前 7 关铁闸
└── releases\              ← 构建产物输出目录
```

**⚠️ 易错陷阱**：构建脚本 `build-desktop.cjs` 在 **APP-AIE 根目录**，不是 electron 子目录里！

---

## 三、开发 vs 打包 的资源路径（踩过的大坑）

### 资源平铺策略（全局统一）
前端和后端资源在 `electron/resources/` 下都是**平铺**，不再有子目录 `dist/`：

| 环境 | 前端资源路径 | 后端资源路径 |
|------|-------------|-------------|
| DEV（开发态） | `electron/resources/frontend/`（index.html 直接在根） | `electron/resources/backend/`（server.js 直接在根） |
| PKG（打包后） | 同上 | 同上 |

**关键代码** — `electron/main.cjs` L100-L107：
```javascript
function getFrontendPath() {
  // DEV 也与 PKG 保持一致：sync-dist.ps1 / build-desktop.cjs 
  // 都把 dist 平铺到 resources/frontend 根目录
  ...
}
```

**为什么要平铺？** 之前试过 `resources/frontend/dist/`，导致 DEV 和 PKG 路径不一致，Electron 加载前端时找不到文件。统一平铺后两边用同一套路径逻辑。

### 同步/构建脚本

| 脚本 | 作用 | 运行位置 |
|------|------|---------|
| `sync-dist.ps1` | 开发态：前端 `npm run build` + 复制到 `electron/resources/frontend/`，后端同理 | APP-AIE 根目录 |
| `build-desktop.cjs` | 发版态：全链路 build → sync → electron-builder 打 exe | APP-AIE 根目录 |
| `gate-check.ps1` | 发版前铁闸：7 项检查全绿才能发 | APP-AIE 根目录 |

---

## 四、发版流水线（严格按顺序）

```
① 改源码（frontend/backend/electron/package.json 三处 version 同步）
② node build-desktop.cjs                    （一键全链路构建）
③ powershell -File gate-check.ps1           （7 关铁闸，全绿才过）
④ scp -C releases/绿角犀-Setup-X.X.X.exe root@47.116.59.141:/usr/share/nginx/html/apk/
⑤ scp -C releases/绿角犀-Portable-X.X.X.exe root@47.116.59.141:/usr/share/nginx/html/apk/
⑥ 服务器上建英文软链接（解决中文 URL 404）
⑦ 更新数据库 windows_releases 表的 setupUrl/portableUrl（用英文软链接）
⑧ SHA256 校验
⑨ 通知同事测试
```

### 步骤⑥ 建软链接（重要！）
```bash
ssh root@47.116.59.141
cd /usr/share/nginx/html/apk/
ln -sf '绿角犀-Setup-1.0.6.exe' lvjiaoxi-setup-1.0.6.exe
ln -sf '绿角犀-Portable-1.0.6.exe' lvjiaoxi-portable-1.0.6.exe
```
**为什么**：中文文件名 URL 编码在不同浏览器/APP 里行为不一致，纯英文软链接彻底绕开 404。

### 步骤⑦ 更新数据库 URL
```bash
# 用 ASCII 编码写 SQL 文件（避免 PowerShell UTF-8 BOM 问题）
# 然后 scp 上去执行
sqlite3 /root/backend/prisma/prod.db < fix_urls.sql
```
`fix_urls.sql` 内容：
```sql
UPDATE windows_releases 
SET setupUrl='https://47.116.59.141/apk/lvjiaoxi-setup-X.X.X.exe', 
    portableUrl='https://47.116.59.141/apk/lvjiaoxi-portable-X.X.X.exe' 
WHERE isLatest=1;
```

---

## 五、gate-check.ps1 七关铁闸

| 关卡 | 检查项 | 说明 |
|------|--------|------|
| G1 | 版本号对齐 | frontend/backend/electron 三处 package.json version 一致 |
| G2 | 前端 FE PKG 路径 | `electron/resources/frontend/index.html` 存在 |
| G3 | 前端 FE DEV 路径 | 同上（开发态也平铺） |
| G4 | 后端 BE PKG 路径 | `electron/resources/backend/server.js` 存在 |
| G5 | EXE 文件存在 + 大小合理 | Setup > 100MB，Portable > 100MB |
| G6 | prisma/dev.db 存在且非空 | 防止数据库空壳 |
| G7 | cloud-jwt-public.pem 存在 | 云端账号激活需要 |

---

## 六、当前服务器状态（2026-09-22）

### 基本信息
| 项 | 值 |
|----|-----|
| IP | 47.116.59.141 |
| SSH | root@47.116.59.141 |
| 系统 | CentOS / Nginx 1.24.0 |
| 磁盘 | 40G 总，已用 25G（65%），剩余 14G |
| 内存 | 40% 占用 |

### Nginx 端口配置
| 端口 | 配置 | 说明 |
|------|------|------|
| 80 | `erp-web.conf` | ⚠️ 没有 `/apk/` location，也没跳转 HTTPS！（待修复） |
| 443 (default) | `greenrhino-cloud-ssl.conf` | ✅ 有 `/apk/` 静态托管，后端 API 反代到 3100 |
| 8091 | `greenrhino-cloud.conf` | 备用 |
| 3100 | Node 直启 | NestJS 后端（aie-backend） |
| 3001 | socat 转发 | 桌面端 APP 内嵌后端从本地 3001 出网到这里 |

### Nginx 关键配置（`greenrhino-cloud-ssl.conf`）
```nginx
# 绿角犀 安装包下载源
location /apk/ {
    root /usr/share/nginx/html;
    types { application/vnd.android.package-archive apk; }
}

# 绿角犀 后端 API
location /api/ {
    proxy_pass http://127.0.0.1:3100;
    ...
}
```

### PM2 进程
```
┌────┬───────────────┬─────────┬────────┬─────────┬──────────┐
│ id │ name          │ version │ status │ uptime  │ mem      │
├────┼───────────────┼─────────┼────────┼─────────┼──────────┤
│ 2  │ aie-backend   │ 1.0.6   │ online │ 2D      │ 88.7mb   │
│ 0  │ erp-backend   │ 0.1.0   │ online │ 8D      │ 111.5mb  │
│ 9  │ lvjiaoxi-web  │ 1.0.0   │ online │ 7D      │ 73.1mb   │
```

**重启 aie-backend**：`ssh root@47.116.59.141 "pm2 restart aie-backend && pm2 save"`

### 数据库文件
| 文件 | 路径 | 用途 |
|------|------|------|
| prod.db | `/root/backend/prisma/prod.db` | ★ 生产数据库（含 users、windows_releases 等表） |
| dev.db | `/root/backend/prisma/dev.db` | 开发数据库（不含部分表如 windows_releases） |

**★ 备份位置**：`D:\源码存档\助理项目\服务器存档\prod-db-备份\`（命名含日期）

---

## 七、已完成功能详解

### 1. 客户端更新检查

**前端**：`frontend/src/pages/settings/AboutSettingsPage.tsx`
- "关于"页面底部有「检查更新」按钮
- 点击直接请求 `https://47.116.59.141/api/v1/app/windows-version?current=X.X.X`
- ⚠️ **API 直连云端 IP，绕过本地后端**（因为桌面端本地后端可能没启动）
- 版本比较：后端返回 `hasUpdate: true/false`，前端只管展示弹窗

**后端 API**：`GET /api/v1/app/windows-version?current=X.X.X`
- 数据源：`prod.db` 的 `windows_releases` 表（`isLatest=1`）
- 返回字段：
```json
{
  "code": 200,
  "data": {
    "version": "1.0.6",
    "hasUpdate": true,
    "forceUpdate": false,
    "sizeMB": 160.4,
    "setupUrl": "https://47.116.59.141/apk/lvjiaoxi-setup-1.0.6.exe",
    "portableUrl": "https://47.116.59.141/apk/lvjiaoxi-portable-1.0.6.exe",
    "setupSha256": "...",
    "notes": "v1.0.6 ...",
    "publishedAt": "2026-09-20T01:31:02.945Z"
  }
}
```

### 2. DEV 一键登录（隐藏功能）

**前端入口**：`frontend/src/pages/LoginPage.tsx`
- 登录页底部有版本号，**连续点 5 次**（3 秒内）会触发显示 DEV 按钮
- 或直接看底部有没有红色边框的「DEV 一键进入」按钮

**核心逻辑**：`frontend/src/stores/auth.ts` → `devLogin()` 方法
- 固定手机号 `13800000000`
- 流程：自动 send-sms（最多等 70 秒处理冷却） → phone-login → 失败则自动 phone-register
- 登录成功跳转主界面

### 3. 版本号三处同步（铁律）

frontend / backend / electron 的 `package.json` version **必须完全一致**。
gate-check.ps1 G1 关卡会卡，发版前别漏。

---

## 八、铁律 & 踩坑清单（别再踩了）

### 🔴 必须死记的铁律
1. **版本号三处同步**：改一处必须改另外两处，gate-check G1 会查
2. **数据库备份**：prod.db 改之前先 cp 一份到本地 `服务器存档/prod-db-备份/`
3. **软链接策略**：服务器上所有安装包必须同时有中文名和英文名软链接，彻底绕开 URL 编码坑
4. **PowerShell 写 SQL 用 ASCII**：`[System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::ASCII)`，别用 UTF-8（会带 BOM 导致 sqlite3 报语法错）
5. **改后端监听端口时**：必须同时改 nginx conf.d 里所有 proxy_pass 指向，改完双验（本地 curl 端口 + 公网 curl API）

### 🟡 容易踩的坑
1. **80 端口没配 `/apk/`**：`erp-web.conf` 没加 location，也没跳转 HTTPS。用户直接输 http://47.116.59.141/apk/xxx.exe 会 404。解决方案：让用户用 https 链接，或后续在 80 端口加 `return 301 https://$host$request_uri;`
2. **构建脚本位置**：`build-desktop.cjs` 在 APP-AIE 根目录，不是 electron 里
3. **资源路径**：DEV 和 PKG 统一平铺在 `electron/resources/frontend/` 和 `electron/resources/backend/`
4. **Electron DLL 锁定**：打包前如果开着绿角犀 APP，electron-builder 会报 DLL locked。先 `Stop-Process -Name '绿角犀' -Force`
5. **SQLite 找不到表**：后端用 `prod.db`，不是 `dev.db`。dev.db 缺很多表（如 windows_releases）
6. **send-sms 限流**：后端接口有 60 秒冷却，DEV 登录已经处理了重试，但手动调 API 时要注意

---

## 九、快速命令速查

### 本地开发
```powershell
# 跑前端 dev server
cd D:\源码存档\助理项目\助理项目\APP-AIE\frontend ; npm run dev

# 跑后端 dev server
cd D:\源码存档\助理项目\助理项目\APP-AIE\backend ; npm run start:dev

# 开发态同步资源（改了源码后）
cd D:\源码存档\助理项目\助理项目\APP-AIE ; powershell -File sync-dist.ps1
```

### 发版
```powershell
# 全链路构建
cd D:\源码存档\助理项目\助理项目\APP-AIE ; node build-desktop.cjs

# 发版前铁闸
powershell -File gate-check.ps1

# 上传安装包
scp -C releases/绿角犀-Setup-1.0.6.exe root@47.116.59.141:/usr/share/nginx/html/apk/
scp -C releases/绿角犀-Portable-1.0.6.exe root@47.116.59.141:/usr/share/nginx/html/apk/
```

### 服务器运维
```bash
# 查看后端状态
ssh root@47.116.59.141 "pm2 list && pm2 logs aie-backend --lines 20"

# 重启后端
ssh root@47.116.59.141 "pm2 restart aie-backend && pm2 save"

# 查看 apk 目录
ssh root@47.116.59.141 "ls -lh /usr/share/nginx/html/apk/"

# 健康检查
curl -sk https://47.116.59.141/api/v1/health

# 更新数据库版本 URL（ASCII 编码写 SQL 文件）
[System.IO.File]::WriteAllText("$env:TEMP\fix.sql", "UPDATE windows_releases SET setupUrl='...', portableUrl='...' WHERE isLatest=1;", [System.Text.Encoding]::ASCII)
scp "$env:TEMP\fix.sql" root@47.116.59.141:/tmp/
ssh root@47.116.59.141 "sqlite3 /root/backend/prisma/prod.db < /tmp/fix.sql"

# SHA256 校验
certutil -hashfile releases\绿角犀-Setup-1.0.6.exe SHA256
```

### 客户端验证
```powershell
# 验证 API 返回
curl.exe -sk "https://47.116.59.141/api/v1/app/windows-version"

# 验证安装包可下载（英文软链接）
curl.exe -skI "https://47.116.59.141/apk/lvjiaoxi-setup-1.0.6.exe"
```

---

## 十、待办事项（TODO）

### 🔴 高优先级
1. **修复 HTTP 80 端口**：在 `erp-web.conf` 加 `return 301 https://$host$request_uri;` 或补 `/apk/` location，彻底解决 http 链接 404
2. **同事测试反馈跟进**：等同事测完更新检查和 DEV 登录，修 bug
3. **安全加固 DEV 登录**：`auth.ts` 里加环境判断，DEV 登录只在开发环境生效（防止生产泄露）

### 🟡 中优先级
4. **清理服务器旧备份**：`ls /usr/share/nginx/html/apk/` 里的 `.bak-*` 文件可以删
5. **CHANGELOG 更新**：补充 DEV 一键登录功能说明，注明触发方式（版本号点 5 次）
6. **后端 API 日志**：`/api/v1/app/windows-version` 调用时打印 log，方便追踪有多少人在检查更新

### 🟢 低优先级
7. **HTTPS 证书续签提醒**：自签名证书什么时候到期？（查一下 nginx ssl 文件）
8. **磁盘清理**：服务器 65% 了，定期清旧安装包
9. **版本号语义化**：当前用 `1.0.6`，后续严格遵循 semver（breaking change 升 major，新功能升 minor，bug fix 升 patch）

---

## 十一、关键文件索引（按用途）

| 我想... | 去这里改 |
|---------|---------|
| 改前端 UI / 页面逻辑 | `frontend/src/pages/` |
| 改状态管理（登录/认证） | `frontend/src/stores/auth.ts` |
| 改后端 API | `backend/src/routes/` |
| 改数据库表结构 | `backend/prisma/schema.prisma`（改完 `npx prisma migrate dev`） |
| 改 Electron 主进程 | `electron/main.cjs` |
| 改 Electron 打包配置 | `electron/electron-builder.yml` 或 `electron/package.json` 的 build 字段 |
| 改 Nginx 配置 | `ssh root@47.116.59.141` → `/etc/nginx/conf.d/greenrhino-cloud-ssl.conf` |
| 改服务器数据库 | `ssh root@47.116.59.141` → `sqlite3 /root/backend/prisma/prod.db` |
| 改版本发布信息 | 改数据库 `windows_releases` 表，或 `prisma/seed.ts` |
| 查客户端版本号常量 | 全局搜索 `"1.0.6"`（可能有硬编码） |

---

## 十二、外部依赖 & 凭据

| 项 | 说明 |
|----|------|
| 服务器 SSH | root@47.116.59.141（密钥在本机 ~/.ssh/） |
| 数据库 | SQLite，文件在服务器 `/root/backend/prisma/prod.db` |
| 自签名证书 | `/etc/nginx/ssl/greenrhino.crt` + `greenrhino.key` |
| ELECTRON_MIRROR | `https://npmmirror.com/mirrors/electron/`（已写在 build-desktop.cjs 里） |
| LLM_API_KEY | **不打包**，新电脑手动放 userData 目录的 llm.env |
| cloud-jwt-public.pem | 云端账号激活公钥，必须随客户端打包 |

---

## 最后：AI 接手 checklist

1. [ ] 看完这份文档
2. [ ] 跑一遍 `node build-desktop.cjs` → `powershell gate-check.ps1` → 确认 7 关全绿
3. [ ] SSH 登录服务器，跑 `pm2 list` 和 `curl -sk https://47.116.59.141/api/v1/health` 确认存活
4. [ ] 用 curl 验证 `/apk/lvjiaoxi-setup-1.0.6.exe` 返回 200
5. [ ] 改源码前读一下 AGENTS.md（如果项目里有的话）
6. [ ] 记住：版本号三处同步、软链接策略、SQL 用 ASCII 编码

**祝顺利。** 🦏
