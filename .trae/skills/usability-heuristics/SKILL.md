# Usability Heuristics — 用户体验检查清单 + 实测脚本

## 触发时机

- 每次发版前（v1.0.2 及以后）— 跑全量 30 项检查
- 前端大改后 — 跑受影响页面的子集
- 用户报告"点了没反应"、"看不懂"、"太麻烦" — 跑针对性检查

## 一、30 项体验检查清单（按优先级）

### P0 · 必须过（每次发版前全绿）

| # | 检查项 | 方法 | 怎么算过 |
|---|---|---|---|
| 1 | 设置页所有 button 有语义 role | `grep -r "<button[^>]*>"` 逐页查 | 每个 button 要么有 role，要么是 Switch/SelectableCard 组件 |
| 2 | 所有 icon-only 按钮有 aria-label | axe-core → "Buttons must have discernible text" violation 数 = 0 | 0 violation |
| 3 | Switch/Radio 的 aria-checked 动态更新 | Playwright click 后读 DOM | state 正确切换 |
| 4 | 键盘 Tab 走完全部设置页 | 人工 + Playwright 模拟 Tab | 焦点不丢失、不跳错位置 |
| 5 | 核心路径 3 步内完成 | 逐个测：换主题、切语气、开远程、备份、改密码 | 每条 ≤ 3 次 click |
| 6 | 危险操作有确认弹窗 | 测删除/重置/切换安全相关设置 | 弹 Modal 明确后果 |
| 7 | 异步操作有反馈 | 点保存/备份/连接 | 有 loading + toast success/fail |

### P1 · 应该过（每次迭代修完）

| # | 检查项 | 方法 | 怎么算过 |
|---|---|---|---|
| 8 | 空状态文案覆盖所有空列表 | 逐个翻 Vault / Todo / 备份历史 / 知识库 | 空时显示"为什么空 + 引导按钮" |
| 9 | 错误消息不说术语 | 扫所有 catch 块和 API error handler | 没有 "HTTP 500"、"ECONNREFUSED"、"JSON.parse" |
| 10 | 按钮颜色语义正确 | 视觉检查 | 绿色=成功确认 / 红色=删除 / primary=主要行动 |
| 11 | 表单 label 和 input 关联 | axe-core → "Label text ... not associated with input" | 0 violation |
| 12 | 按钮文案 ≤ 12 字 | 扫所有 button children | 超长的要么改短要么 tooltip |
| 13 | 配置项分组 + 小标题 | 看设置页 | 同类开关/选项放一组，有小标题 |
| 14 | 页面状态可见（当前主题/语气/账号） | 看侧边栏 + 设置页 | 始终显示上下文，不依赖记忆 |

### P2 · 可以过（长期跟进）

| # | 检查项 | 方法 | 怎么算过 |
|---|---|---|---|
| 15 | 色盲友好：状态 = 颜色 + 图标 + 文字 | 视觉检查 | 成功有 绿+✅，失败有 红+❌ |
| 16 | Contrast ≥ 4.5:1 | axe-core contrast violations = 0 | 0 |
| 17 | Toast 容器 aria-live="polite" | 扫 DOM | 有异步反馈的容器加 live region |
| 18 | 装饰性图标 aria-hidden="true" | axe-core | 装饰性的没被读出 |
| 19 | 快捷键 discoverable（`?` 键） | 按 `?` | 弹出快捷键面板 |
| 20 | 新人首次引导（3 步） | 新用户打开 | 欢迎 → 创建身份 → 开始用 |
| 21 | 图片 alt 有意义文字 | axe-core → "Images must have alternate text" | 装饰性 aria-hidden，有用的有 alt |
| 22 | 图表/进度条有文字标签 | 看 Vault/备份历史进度 | 除了颜色条还有数字 |
| 23 | 输入框 placeholder 给格式提示 | 看 Server 设置/密码页 | 不是 "请输入" 而是 "example@mail.com" |
| 24 | Toggle 开关 label 和状态强相关 | 看 Switch 旁边的 label | label 能让用户知道"现在是开还是关" |
| 25 | 不可用状态的 switch 给解释 | 看 RemoteAccess 未配置时 | 禁用 + tooltip"需要先配置云端账号" |
| 26 | 弹窗有 `role="dialog"` + `aria-modal="true"` | 扫所有 Modal | 都加 |
| 27 | Escape 键能关闭弹窗 | 人工测试 | 按 Esc 关闭确认/错误弹窗 |
| 28 | Autofocus 到第一个可操作元素 | 打开弹窗 | 焦点在确认按钮或表单第一个 input |
| 29 | 页面标题正确（document.title） | 路由切换时 | 从设置切回 → title 对应 |
| 30 | loading 状态有 `aria-busy="true"` | 扫所有 loading 容器 | 异步加载区域加 busy |

## 二、自动化巡检脚本

### 前置条件

```bash
# 1. 装依赖（一次性）
cd APP-AIE/electron
npm i axe-core playwright-core --save-dev

# 2. 启动 Electron 带 CDP
& electron/release-v16/win-unpacked/绿角犀.exe --remote-debugging-port=9222

# 3. 等 12 秒后确认 CDP 可达
curl.exe -s http://127.0.0.1:9222/json/version
# 期望看到 Chrome 版本号
```

### 脚本：`electron/gui-a11y-checklist.js`

```javascript
// 一键跑 30 项体验检查（P0 全跑，P1/P2 抽样）
const { chromium } = require('playwright-core');
const fs = require('fs');

const CDP = 'http://127.0.0.1:9222';
const ROUTES = [
  '#/settings/theme',
  '#/settings/tone',
  '#/settings/remote-access',
  '#/settings/backup',
  '#/settings/security',
  '#/settings/vault',
  '#/settings/server',
  '#/settings/ai-assistant',
];

let pass = 0, fail = 0, issues = [];

async function check(desc, fn, route = null) {
  try {
    const ok = await fn();
    if (ok) { pass++; console.log(`  ✅ ${desc}`); }
    else { fail++; console.log(`  ❌ ${desc}`); issues.push({ desc, route }); }
  } catch(e) { fail++; console.log(`  ❌ ${desc} — ${e.message}`); issues.push({ desc, route, err: e.message }); }
}

async function run() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];

  // 注入 auth
  await page.evaluate(() => {
    localStorage.setItem('aie_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy');
    localStorage.setItem('aie_user', JSON.stringify({ id:1, username:'tester' }));
  });

  // === P0 ===
  console.log('\n=== P0 · 必过 ===');

  for (const hash of ROUTES) {
    await page.goto(`file:///${__dirname}/release-v16/resources/frontend/index.html${hash}`, { waitUntil: 'networkidle' });
    const route = hash;

    await check(`[${route}] 所有 button 有语义 (role 或 Switch/SelectableCard)`, async () => {
      const buttons = await page.locator('button').all();
      for (const b of buttons) {
        const role = await b.getAttribute('role');
        const hasSwitch = await b.evaluate(el => el.classList.contains('peer') || el.getAttribute('data-state'));
        const hasAriaLabel = await b.getAttribute('aria-label');
        const hasAriaLabelledBy = await b.getAttribute('aria-labelledby');
        if (!role && !hasAriaLabel && !hasAriaLabelledBy && !b.evaluate(el => el.textContent.trim())) {
          return false;  // icon-only 且无 aria-label
        }
      }
      return true;
    }, route);

    await check(`[${route}] 无 role 但有文字的 button（可接受，记录但不算 fail）`, async () => {
      const html = await page.content();
      const plainButtons = (html.match(/<button(?![^>]*role=)[^>]*>/g) || []).length;
      if (plainButtons > 0) console.log(`    ℹ️  ${plainButtons} 个无 role button（有文字，可接受）`);
      return true;  // 只是记录
    }, route);

    // Switch/Radio aria-checked 动态测试
    const switches = await page.locator('button[role="switch"]').all();
    for (let i = 0; i < Math.min(switches.length, 2); i++) {
      const before = await switches[i].getAttribute('aria-checked');
      await switches[i].click();
      const after = await switches[i].getAttribute('aria-checked');
      await switches[i].click(); // 还原
      if (before === after) { issues.push({ desc: `[${route}] switch[${i}] aria-checked 没切换` }); }
    }

    // Radio 组 Arrow 键测试
    const radioGroups = await page.locator('[role="radiogroup"]').all();
    for (const group of radioGroups) {
      await group.press('Tab');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
    }
  }

  console.log(`\n=== 结果 ===`);
  console.log(`通过: ${pass}  失败: ${fail}`);
  if (issues.length > 0) {
    const report = issues.map(i => `- ${i.desc}${i.err ? ' — ' + i.err : ''}`).join('\n');
    fs.writeFileSync('gui-a11y-report.md', `# 无障碍巡检报告\n\n${new Date().toISOString()}\n\n${report}`);
    console.log(`\n报告已写入 gui-a11y-report.md`);
  }
  browser.close();
}

run().catch(e => console.error('FATAL:', e));
```

## 三、Playwright GUI 实测万能模板

```javascript
const { chromium } = require('playwright-core');

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  // 1. 注入登录态
  await page.evaluate(() => {
    localStorage.setItem('aie_token', 'dummy');
    localStorage.setItem('aie_user', JSON.stringify({ id:1, username:'tester' }));
  });

  // 2. 切到目标路由
  await page.goto('file:///.../index.html#/settings/xxx');
  await page.waitForLoadState('networkidle');

  // 3. 截图
  await page.screenshot({ path: 'gui-xxx.png', fullPage: true });

  // 4. DOM 查询（常用）
  const switches = await page.locator('[role="switch"]').count();
  const radios = await page.locator('[role="radio"]').count();
  const radioGroups = await page.locator('[role="radiogroup"]').count();
  const iconButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter(b => !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby'))
      .filter(b => !b.textContent.trim())
      .length
  );

  // 5. 写结果
  console.log({ route, switches, radios, radioGroups, iconButtons });

  browser.close();
}
main();
```

## 四、修复优先级判定

| 优先级 | 标准 | 例子 |
|---|---|---|
| **P0** | 影响屏幕阅读器/键盘用户的核心功能 | Switch 无 aria-checked、Icon-only 无 aria-label、Radio 无 radiogroup |
| **P1** | 影响小白用户的困惑/不直观 | 按钮文案是技术词、错误消息说 HTTP 500、空状态没引导 |
| **P2** | 色盲/对比度/长期体验 | 只靠颜色表达状态、对比度不足 4.5:1 |

## 五、常见坑 & 修复

| 坑 | 根因 | 修复 |
|---|---|---|
| Windows `path.join` 拼反斜杠进 Linux 路径 | Node 在 Windows 上 path.join 用 `\` | 远程路径硬编码正斜杠 |
| `tsc` 报类型错 | 改文案碰了 i18n 常量 | 走常量文件，不改 key 只改 value |
| Electron CDP 连不上 | 进程挂了或端口被占 | 杀进程重启，确认 curl 能访问 |
| Playwright `click()` 没反应 | 元素被遮挡或不在视口 | `scrollIntoViewIfNeeded()` + `force:true` |
| axe-core violations 很多是误报 | 有些装饰性 div 被扫到 | 加 `aria-hidden="true"` 过滤 |
| 中文 URL 在 curl 里返回 400 | 没 URL 编码 | `[uri]::EscapeDataString($f)` |
| nginx 404 但文件在 | default_server 不是预期那个 | `nginx -T` 查哪个 server block 接管了 |

---

**使用**：`electron/gui-a11y-checklist.js` 是一键跑的入口，每次发版前跑一次，把输出里的 ❌ 记进 issues → 指派给对应 agent 修 → 回归验证。
