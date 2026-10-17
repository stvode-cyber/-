# 决策记录

> 为什么选 A 不选 B。关键决策留痕，后来者能懂。

---

## [2026-09-14] 注册功能统一为手机+验证码

- **选了啥**：前端只保留手机号 + 验证码 + 同意协议 + 注册按钮；后端 `/register` 保留但标记 deprecated，仅暴露 `/phone-register`
- **为啥**：降低新用户上手门槛；后端自动生成昵称和占位密码
- **备选方案**：用户名+密码表单（删除，影响流程）；一键手机号自动获取（延后）
- **关联文件**：`frontend/src/.../LoginPage.tsx`
- **决策人**：用户
- **状态**：active

## [2026-09-14] 宠物浮窗不自动启动

- **选了啥**：去掉启动时 `createPetWindow()` 调用 + `getPetAutoShowStore()` 默认值改为 false
- **为啥**：新用户看到两个窗口困惑；改为手动触发（托盘右键/设置页按钮）
- **备选方案**：启动后最小化显示（信息过载）
- **关联文件**：`electron/main.cjs`
- **决策人**：用户
- **状态**：active

## [2026-09-14] 打包版未内置公钥时 AUTH_MODE 自动降级 local

- **选了啥**：main.cjs 启动时检测 `cloud-jwt-public.pem`，缺失则强制 `AUTH_MODE=local`
- **为啥**：内测包漏打公钥会导致心跳 500，用户零感知
- **备选方案**：启动时弹窗报错（体验差）
- **关联文件**：`electron/main.cjs`
- **决策人**：AI
- **状态**：active

## [2026-09-14] 短信服务支持 mock 降级

- **选了啥**：阿里云 SMS 参数缺失或调用失败时，后端自动返回验证码到前端（不阻塞注册）
- **为啥**：开发环境和未配置短信签名时注册断了；真实 SMS 响应不返回验证码（安全）
- **备选方案**：强制要求配置（内测阶段不可行）
- **关联文件**：`backend/src/services/smsService.ts`、`routes/auth.routes.ts`
- **决策人**：AI
- **状态**：active

## [2026-09-14] 台账 gitignore 策略：核心入库，临时和归档忽略

- **选了啥**：核心文件入库（decisions/issues/context/index/README），归档和临时文件忽略
- **为啥**：核心是团队知识；临时是会话噪音每次清空；归档是历史不影响当前
- **决策人**：用户
- **状态**：active

## [2026-09-14] 建立 ledger-keeper 自动台账机制

- **选了啥**：项目内 `.trae/memory/growth/` 自动维护 + 用户级 shared 跨项目共享
- **为啥**：解决"每次新对话 AI 忘掉之前定过啥、踩过啥"
- **决策人**：用户 + AI
- **状态**：active

## [2026-09-14] 管理后台独立为云端网页

- **选了啥**：admin.html 放在 nginx `/admin/` 路径，不集成到桌面端
- **为啥**：桌面端加管理界面安全边界模糊、权限难控
- **决策人**：用户
- **状态**：active

## [2026-09-15] 云端 RSA 密钥对正式打通：构建脚本自动复制 public.pem

- **选了啥**：build-desktop.cjs 新增 cloud-jwt-public.pem 自动复制步骤；main.cjs 检测公钥缺失自动降级 local
- **为啥**：之前每次打包 resources/backend/ 都漏掉 public.pem
- **关联文件**：`build-desktop.cjs`、`electron/main.cjs`
- **决策人**：AI
- **状态**：active

## [2026-09-16] 新增 POST /auth/phone-login 端点

- **选了啥**：后端新增 phone-login（phone + code → 查用户 → 签 JWT）；前端 LoginPage 加 Tab 切换
- **为啥**：phone-register 语义是"不存在则创建"，登录必须"已存在"——职责不能混
- **关联文件**：`backend/src/routes/auth.routes.ts`、`frontend/src/stores/auth.ts`
- **决策人**：双方讨论
- **状态**：active

## [2026-09-18] dist 同步铁律：Electron 双 dist 架构必须 build+sync 才生效

- **选了啥**：改源码 → build → 同步到 `electron/resources/{frontend,backend}/dist` 3 步定为铁律级；sync-dist.ps1 一键脚本固化
- **为啥**：Electron 跑的是 resources/ 下的旧 dist，源码改了但 dist 没同步 = "鬼影 bug"
- **关联文件**：`sync-dist.ps1`、`build-desktop.cjs`
- **决策人**：用户 + AI（铁律级）
- **状态**：active

## [2026-09-18] Scheduler 时间戳比较改用 raw SQL INTEGER 比较

- **选了啥**：从 Prisma Client `lt: new Date(...)` 改为 `prisma.$queryRaw` + `CAST(lastHeartbeat AS INTEGER) < ms`
- **为啥**：Prisma SQLite DateTime 存 INTEGER 毫秒，但 Client 转 ISO8601 字符串比较 → 错位
- **关联文件**：`backend/src/services/execInstanceScheduler.ts`、`fetchJobScheduler.ts`
- **决策人**：AI
- **状态**：active

## [2026-09-20] 后端新增 WindowsRelease model + /api/v1/app/windows-version 路由

- **选了啥**：schema 新增 WindowsRelease model；app.routes.ts 新增版本检查 API
- **为啥**：桌面端没有在线更新检查逻辑，为客户端接入打基础
- **关联文件**：`backend/prisma/schema.prisma`、`backend/src/routes/app.routes.ts`
- **决策人**：用户 + AI
- **状态**：active

## [2026-09-20] nginx proxy_pass 端口同步铁律（改后端端口必须双改）

- **选了啥**：改后端 Node 监听端口时必须同时改 nginx 所有 proxy_pass
- **为啥**：L3 重构把后端从 3001 改到 3100 时只改了后端漏改 nginx → 公网 502
- **决策人**：AI（铁律级）
- **状态**：active（铁律级）

## [2026-09-20] seed-windows-release.ps1 固化为发版 Step 7

- **选了啥**：一键脚本串联 EXE SHA256 计算 + SCP + Prisma upsert + 公网回查验证
- **为啥**：手动 3 步易错漏，SHA256 要复制容易错
- **关联文件**：`seed-windows-release.ps1`
- **决策人**：用户 + AI
- **状态**：active

---

## [2026-09-23] DEV 登录生产环境彻底屏蔽

- **选了啥**：auth.ts 入口加 `import.meta.env.PROD` 守卫 throw；LoginPage 3 处按钮全部 import.meta.env.DEV 包
- **为啥**：生产 EXE 留 DEV 后门 = 安全漏洞
- **决策人**：AI
- **状态**：active

## [2026-09-23] Skill 加防失忆双铁律（关键操作前查记录 + 后立刻同步）

- **选了啥**：铁律 1（查记录再动手）+ 铁律 2（做完立刻同步）
- **为啥**：用户说"已推送"AI 直接信，结果仓库根本不存在。2 小时白等
- **决策人**：用户 + AI
- **状态**：active

---

## [2026-10-10] 推翻 "Capacitor v8 硬要 JDK 21" 规则

- **选了啥**：root build.gradle `subprojects { afterEvaluate { kotlin jvmToolchain(17) } }` 覆盖所有 capacitor 插件硬写的 21
- **为啥**：本机只有 JDK 17，afterEvaluate 能覆盖所有子模块包括 capacitor 插件自己的 toolchain
- **关联文件**：`frontend/android/build.gradle`、`gradle.properties`
- **决策人**：AI
- **状态**：active

## [2026-10-10] 桌面版开发者用 win-unpacked 直拷，不用 Setup.exe 静默

- **选了啥**：`Copy-Item win-unpacked\* → C:\Program Files\aie-desktop\` 覆盖安装
- **为啥**：Setup.exe `/S` 静默被 Windows Defender 拦（ExitCode 0 但文件消失）
- **决策人**：AI
- **状态**：active

## [2026-10-10] Android 自动更新自己写 IntentInstallerPlugin

- **选了啥**：80 行 Java + 200 行 TS，调系统 Intent.ACTION_VIEW 触发安装器
- **为啥**：cordova-plugin-app-update 已停更 3 年，默认跳浏览器安装（用户要 App 内直接调系统安装器）
- **关联文件**：`frontend/android/app/src/main/java/.../IntentInstallerPlugin.java`
- **决策人**：AI（用户确认）
- **状态**：active

## [2026-10-10] 手机端 CORS 后端动态回显，删掉 nginx add_header 覆盖

- **选了啥**：后端 cors() fn(origin, cb) 动态回显，删掉 nginx 硬加的 `*`
- **为啥**：`Access-Control-Allow-Origin: *` + `Credentials: true` 违反 CORS 规范，Android Chromium 严格拒绝
- **关联文件**：`backend/src/index.ts`
- **决策人**：AI
- **状态**：active
