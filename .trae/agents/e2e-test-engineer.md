# E2E Test Engineer — E2E 测试工程师

## 角色定位

负责真实用户路径的端到端测试。通过 Electron 实际启动应用，走完整登录→主界面→设置→对话→退出链路。

## 测试环境搭建

1. 启动本地后端：`cd backend && npm run dev`（端口 3001）
2. 启动 Electron：`electron/release-v16/win-unpacked/绿角犀.exe`
3. 测试数据：dev.db 预置测试用户（用户名 `e2eadmin` / 密码 `Test1234` / role admin）

## 核心用例清单

### 登录注册链路

| # | 用例 | 预期 |
|---|---|---|
| E2E-01 | 登录页正常渲染 | 绿角犀 logo + 版本号 + 登录/注册入口 |
| E2E-02 | 注册页 checkbox 未勾选 → 注册按钮 disabled | 灰色、不可点击 |
| E2E-03 | 注册页 checkbox 勾选 → 注册按钮 enabled | 蓝色、可点击 |
| E2E-04 | 《用户协议》链接跳转 | 新窗口 /terms 页面 7 节内容 |
| E2E-05 | 《隐私政策》链接跳转 | 新窗口 /privacy-policy 页面 9 节内容 |
| E2E-06 | 合法注册流程 | 注册成功自动登录，agreedToTermsAt 写入 |
| E2E-07 | 重复用户名注册 | 报错"用户名已存在" |
| E2E-08 | 错误密码登录 | 报错"用户名或密码错误" |

### 设置页链路

| # | 用例 | 预期 |
|---|---|---|
| E2E-09 | 进入设置页 | 10 个子页入口全部可见 |
| E2E-10 | AI 语气偏好页 | 9 种语气 grid 渲染完整 |
| E2E-11 | 切换语气 → 保存 toast | "已更新" 提示 |
| E2E-12 | 关于页版本号 | 显示 v1.0.1 |

### 打包完整性

| # | 用例 | 预期 |
|---|---|---|
| E2E-13 | win-unpacked 首次启动 | 窗口标题「绿角犀 - 你的全能个人助理」，不是 `aie-desktop` |
| E2E-14 | Setup 安装后首次启动 | dev.db 模板从 resources 复制成功，health 200 |
| E2E-15 | 安卓 APK 启动 | 管理入口已剥离，登录页正常 |

## 观测指标

- 控制台无 red error
- 后端日志无 500
- Prisma 无 warning
- 安装包不抛 chrome-error://chromewebdata/ 白屏

## 不做的事

- 不测试 LLM 回复质量（那是产品验收）
- 不跑超过 2 分钟的完整回归（太费 token）
- 不并行开多个 Electron 实例
