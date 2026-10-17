# 决策记录

> 为什么选 A 不选 B。关键决策留痕，后来者能懂。

---

## [2026-09-23] DEV 登录生产环境彻底屏蔽
- **选了啥**：auth.ts 入口加 import.meta.env.PROD 守卫 throw；LoginPage 3 处按钮 + 版本号点击全部 import.meta.env.DEV 包
- **为啥**：生产 EXE 留 DEV 后门 = 安全漏洞。用户电脑上任何人点 5 次版本号就能跳过登录
- **备选**：只在后端拦截 → 前端按钮还在；只加密码保护 → 还是暴露 + 增加复杂度

## [2026-09-23] git 仓库从今天（v1.0.6 基线）开始
- **选了啥**：git init 一次性 commit 1355 文件，commit `30e2542`
- **为啥**：项目之前全是裸文件，没有 .git 目录。今天是第一次系统性接手，正好作为基线
- **备选**：从更早的版本开始 → 没记录了；不搞 git → 改坏了回滚靠人肉

## [2026-09-23] GitHub 仓库名定 APP-AIE（stvode-cyber 下，private）
- **选了啥**：stvode-cyber/APP-AIE（仓库名实为 `-`）
- **为啥**：简洁好记，private 因为有用户数据、服务器地址等敏感信息

## [2026-09-23] Skill 加防失忆双铁律（关键操作前查记录 + 后立刻同步）
- **选了啥**：铁律 1（查记录再动手）+ 铁律 2（做完立刻同步）
- **为啥**：用户说"已推送"AI 直接信，结果 `git ls-remote` 验证仓库根本不存在。2 小时绕 device code 白等

---

## [2026-10-10] 推翻 "Capacitor v8 硬要 JDK 21" 规则
- **选了啥**：root build.gradle `subprojects { afterEvaluate { kotlin jvmToolchain(17) } }` 覆盖所有 capacitor 插件硬写的 21
- **为啥**：本机只有 JDK 17，afterEvaluate 能覆盖所有子模块包括 capacitor 插件自己的 toolchain

## [2026-10-10] 桌面版开发者用 win-unpacked 直拷，不用 Setup.exe 静默
- **选了啥**：`Copy-Item win-unpacked\* → C:\Program Files\aie-desktop\` 覆盖安装
- **为啥**：Setup.exe `/S` 静默被 Windows Defender 拦（ExitCode 0 但文件消失）

## [2026-10-10] Android 自动更新自己写 IntentInstallerPlugin
- **选了啥**：80 行 Java + 200 行 TS，调系统 Intent.ACTION_VIEW 触发安装器
- **为啥**：cordova-plugin-app-update 已停更 3 年，默认跳浏览器安装（用户要 App 内直接调系统安装器）

## [2026-10-10] 手机端 CORS 后端动态回显，删掉 nginx add_header 覆盖
- **选了啥**：后端 cors() 函数 fn(origin, cb) 动态回显，删掉 nginx 硬加的 `*`
- **为啥**：`Access-Control-Allow-Origin: *` + `Credentials: true` 违反 CORS 规范，Android Chromium 严格拒绝
