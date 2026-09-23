# SKILL: Competitive Features — 热门功能落地模式库

> 市场调查员的输出格式，让 frontend-dev / backend-dev 可以直接拿去落地。
> 每一条包含：**竞品来源 → 绿角犀现状 → 落地方案 → 复杂度 → 用户价值**。

## 模式 1：全局快捷键唤起（overlay 弹窗）

| 项 | 内容 |
|---|---|
| **竞品** | Claude Caps Lock（Mac） / Gemini Alt+Space（Win） / Everywhere Ctrl+Shift+E / ToDesk AI |
| **绿角犀现状** | 已有 5 文件 hotkey 相关，但非**全局 overlay** 模式（只能在应用内） |
| **落地方案** | Electron main.js 注册 `globalShortcut.register('CommandOrControl+Shift+A', () => { showOverlay() })`，overlay 是一个无边框透明小窗口（宽 400px、高 300px），里面是简化版 chat 界面。关闭：Esc 或失焦自动隐藏 |
| **复杂度** | ⭐⭐ |
| **用户价值** | 极高 — 用户不用切窗口就能召唤 AI |

**Electron 代码模板**：

```js
// electron/main.js 追加
const { globalShortcut, BrowserWindow, ipcMain } = require('electron')

let overlayWin = null
function createOverlay() {
  overlayWin = new BrowserWindow({
    width: 420, height: 340,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  })
  overlayWin.loadFile(path.join(__dirname, 'resources/frontend/index.html'), {
    hash: '/overlay-chat'   // 新路由
  })
  overlayWin.on('blur', () => overlayWin.hide())
}

app.whenReady().then(() => {
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (overlayWin?.isVisible()) overlayWin.hide()
    else createOverlay()
  })
})
app.on('will-quit', () => globalShortcut.unregisterAll())
```

---

## 模式 2：浏览器自动化（让 AI 自己逛网页）

| 项 | 内容 |
|---|---|
| **竞品** | Kimi Work 浏览器扩展 / Microsoft Scout Automates browsers / ToDesk AI |
| **绿角犀现状** | ❌ 未做 |
| **落地方案** | Electron 主进程 spawn 一个 Playwright child_process，IPC 暴露 `window.electronAI.browser.navigate(url)` / `.click(selector)` / `.extract()`。AI agent 在 backend 收到用户指令 → 调 Playwright API → 结果返回给用户 |
| **复杂度** | ⭐⭐⭐⭐（Playwright 打包体积大，可选轻量方案：原生 Puppeteer 或用系统默认浏览器 + DevTools Protocol） |
| **用户价值** | 高 — AI 帮你填表单、查价格、抓数据 |

**轻量替代方案（不用 Playwright）**：

```js
// backend/src/services/browserAgent.ts
// 用 fetch + cheerio 做纯 HTTP 层面的网页抓取（不执行 JS）
// 适合不需要点按钮的场景（读博客、查信息）
import * as cheerio from 'cheerio'
export async function scrape(url: string, selector?: string) {
  const html = await fetch(url).then(r => r.text())
  const $ = cheerio.load(html)
  return selector ? $(selector).text().trim() : $('body').text().trim().slice(0, 2000)
}
```

---

## 模式 3：GUI 可视化执行（AI 帮你点电脑）

| 项 | 内容 |
|---|---|
| **竞品** | ToDesk AI GUI 键鼠模拟 / 360 GUI Agent |
| **绿角犀现状** | ❌ 未做 |
| **落地方案** | **不建议在 v1.0.x 做**——OCR + 屏幕截图 + 坐标推理 + 键鼠注入，每一层都重。可以分两期：① 先做"让 AI 帮你打开本地文件/文件夹"（用 Electron `shell.openPath()` 就能实现）② 再考虑 GUI 操控 |
| **复杂度** | ⭐⭐⭐⭐⭐ |
| **用户价值** | 极高（杀手级功能）但成本过高 |

**v1.0.x 简化版（让 AI 打开本地东西）**：

```js
// backend/src/services/fileAgent.ts
import { exec } from 'child_process'

export async function openLocal(target: string) {
  // 用户说"帮我打开 Downloads 文件夹" → AI 解析 → 调这里
  const safePath = await sanitizePath(target)  // 防止路径穿越
  exec(`explorer "${safePath}"`)  // Windows
  return { ok: true, opened: safePath }
}
```

---

## 模式 4：多模型切换/对比

| 项 | 内容 |
|---|---|
| **竞品** | Monica 5 模型并排 / ChatGPT vs Claude vs Gemini 对比 |
| **绿角犀现状** | ❌ 未做（当前只走 SiliconFlow DeepSeek-V3） |
| **落地方案** | 后端 LLM 网关加 provider 路由：`POST /api/v1/ai/proxy` body 里加 `model: 'deepseek' | 'qwen' | 'glm'`，每个 provider 各自有 API key。前端设置页加"默认模型"下拉 |
| **复杂度** | ⭐⭐ |
| **用户价值** | 中 — 给用户选择权 |

**后端模板**：

```ts
// backend/src/services/llmProxy.ts
const PROVIDERS = {
  deepseek: { url: 'https://api.siliconflow.cn/v1/chat/completions', model: 'deepseek-ai/DeepSeek-V3' },
  qwen:     { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
  glm:      { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
}
export async function proxyChat(provider: string, messages: any[]) {
  const cfg = PROVIDERS[provider] || PROVIDERS.deepseek
  // 统一走 SiliconFlow 聚合接口（已有）或各自直连
}
```

---

## 模式 5：实时屏幕理解（Copilot Vision 级别）

| 项 | 内容 |
|---|---|
| **竞品** | Microsoft Copilot Vision / Everywhere / ToDesk AI |
| **绿角犀现状** | 有截图相关代码，但是"用户主动上传一张图"模式 |
| **落地方案** | Electron 主进程定期截屏（`desktopCapturer.getSources` → 选当前屏幕 → 编码）→ 发送给 backend → 走多模态 LLM 分析 → 返回上下文建议。**注意隐私**：默认关闭 + 每次用户主动触发才开 |
| **复杂度** | ⭐⭐⭐ |
| **用户价值** | 高 — AI 看见你正在看的东西，才懂你 |

---

## 模式 6：AI 角色多模式（Orvo 四模式）

| 项 | 内容 |
|---|---|
| **竞品** | Orvo（关系教练 / 职业策略 / 利益相关者分析 / 会议准备）/ 绿角犀已有 tone 9 种但都是说话风格，不是角色 |
| **绿角犀现状** | tone 9 种（专业/温柔/可爱/强硬/幽默/极简/元气/教练/朋友）—— 是**语气风格**，不是**专业角色** |
| **落地方案** | AgentCore 的 system prompt 里加一层"角色 persona"：`{ personaPrompt } + { tonePrompt } + { profileContext }`。新增 persona 选项：默认助手 / 心理咨询师 / 职场导师 / 健身教练 / 金融顾问 / 考研导师 / 写作教练 |
| **复杂度** | ⭐（改 LLM 注入逻辑） |
| **用户价值** | 高 — 不同场景 AI 有不同专业视角 |

---

## 模式 7：Cron 定时任务（Kimi Work 模式）

| 项 | 内容 |
|---|---|
| **竞品** | Kimi Work Cron / Microsoft Scout Heartbeat（15-120min）/ ToDesk AI |
| **绿角犀现状** | ✅ 已有 24 文件 cron 相关 —— AgentCore + ProactiveScheduler + weeklyAggregator，已经在后台跑了 |
| **可增强** | 给用户一个**可视化定时任务配置页**（AgentCore 目前是代码硬编码的，用户没法自己加） |
| **落地方案** | `Prisma schedule_job` 新表 + 前端 `/settings/schedule` 页面 + AgentCore 调度器从 DB 读取用户自定义任务 |
| **复杂度** | ⭐⭐⭐ |
| **用户价值** | 高 — 用户自己定义"每天早上 8 点给我发今日简报" |

---

## 落地优先级推荐（2026-09）

| 优先级 | 功能 | 复杂度 | 用户价值 | 说明 |
|---|---|---|---|---|
| **P0** | 全局 overlay 快捷键 | ⭐⭐ | 极高 | 用户感知最强的升级，改 2 个文件（main.js + 新路由） |
| **P1** | AI 角色多模式（persona） | ⭐ | 高 | 改 LLM 注入逻辑 + 设置页加角色下拉，工作量最小 |
| **P2** | Cron 用户自定义配置页 | ⭐⭐⭐ | 高 | 把已经在跑的 AgentCore 开放给用户 |
| **P3** | 多模型切换 | ⭐⭐ | 中 | API 加 provider 路由 + 前端下拉 |
| **P4** | 浏览器自动化（轻量 fetch 版） | ⭐⭐ | 高 | 用 cheerio 读网页，不上 Playwright |
| **P5** | 实时屏幕理解 | ⭐⭐⭐ | 高 | Electron 截屏 + 多模态 LLM |
| ❌ 延后 | GUI 可视化执行 | ⭐⭐⭐⭐⭐ | 极高 | 成本过高，留待 v2.0 |
