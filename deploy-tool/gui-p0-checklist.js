// P0 巡检 — usability-tester 核心 7 项的 DOM 层面检查
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const FE = 'd:/源码存档/助理项目/助理项目/APP-AIE/electron/release-v16/win-unpacked/resources/frontend';
const INDEX = 'file:///' + FE.replace(/\\/g, '/') + '/index.html';
const OUT = path.join(__dirname, 'a11y-report');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { hash: '#/settings/theme',            label: 'Theme 主题模式' },
  { hash: '#/settings/tone',             label: 'Tone AI 语气' },
  { hash: '#/settings/remote-access',    label: 'RemoteAccess 远程访问' },
  { hash: '#/settings/backup',            label: 'Backup 数据备份' },
  { hash: '#/settings/security',          label: 'Security 安全中心' },
  { hash: '#/settings/vault',             label: 'Vault AI 记忆库' },
  { hash: '#/settings/server',            label: 'Server 服务器设置' },
];

const RESULTS = [];
let totalPass = 0, totalFail = 0;

async function check(desc, fn, route) {
  try {
    const r = await fn();
    const ok = r === true || (r !== false && r !== undefined && r !== null);
    if (ok) { totalPass++; console.log(`  ✅ ${desc}`); RESULTS.push({ route, desc, ok: true }); }
    else { totalFail++; console.log(`  ❌ ${desc}`); RESULTS.push({ route, desc, ok: false }); }
    return ok;
  } catch (e) {
    totalFail++; console.log(`  ❌ ${desc} — ${e.message}`);
    RESULTS.push({ route, desc, ok: false, err: e.message });
    return false;
  }
}

async function run() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];

  // 注入登录态
  await page.evaluate(() => {
    localStorage.setItem('aie_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + btoa(JSON.stringify({ sub: 1, username: 'tester', iat: Date.now()/1000 })) + '.dummy');
    localStorage.setItem('aie_user', JSON.stringify({ id: 1, username: 'tester', nickname: '测试', email: 'tester@aie.local' }));
  });

  console.log('\n====== P0 巡检：绿角犀管家 v1.0.2 ======\n');

  // === 全局：先不进设置页，看侧栏/顶栏 icon-only ===
  console.log('--- 全局（侧栏 + 顶栏）---');
  await page.goto(INDEX, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const globalInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const iconOnly = buttons.filter(b => {
      const text = b.textContent.trim();
      const ariaL = b.getAttribute('aria-label');
      const ariaLB = b.getAttribute('aria-labelledby');
      const hasIcon = b.querySelector('svg, [data-lucide]');
      return !text && !ariaL && !ariaLB && hasIcon;
    });
    const withRole = buttons.filter(b => b.getAttribute('role')).length;
    return { total: buttons.length, withRole, iconOnly: iconOnly.length, iconOnlyTexts: iconOnly.map(b => b.getAttribute('class')?.slice(0, 60)) };
  });
  console.log(`  全局 button 总数: ${globalInfo.total}`);
  console.log(`  有 role 的: ${globalInfo.withRole}`);
  console.log(`  icon-only 且无 aria-label: ${globalInfo.iconOnly} ${globalInfo.iconOnlyTexts.slice(0,3)}`);

  // === 逐设置页 ===
  for (const r of ROUTES) {
    console.log(`\n--- ${r.label} (${r.hash}) ---`);

    await page.goto(INDEX + r.hash, { waitUntil: 'networkidle', timeout: 8000 }).catch(e => console.log(`  ⚠️  navigate fail: ${e.message}`));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `shot-${r.hash.replace('#/settings/', '').replace(/\//g,'-')}.png`), fullPage: true });

    // 采集 DOM 统计
    const info = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const plainButtons = buttons.filter(b => !b.getAttribute('role'));
      const iconOnlyPlain = plainButtons.filter(b => {
        const text = b.textContent.trim();
        const ariaL = b.getAttribute('aria-label');
        const ariaLB = b.getAttribute('aria-labelledby');
        const hasIcon = b.querySelector('svg, [data-lucide]');
        return !text && !ariaL && !ariaLB && hasIcon;
      });
      return {
        buttons: buttons.length,
        plain: plainButtons.length,
        iconOnly: iconOnlyPlain.length,
        iconOnlyClasses: iconOnlyPlain.map(b => b.getAttribute('class')?.slice(0, 80)),
        switches: document.querySelectorAll('button[role="switch"]').length,
        radios: document.querySelectorAll('button[role="radio"]').length,
        radioGroups: document.querySelectorAll('[role="radiogroup"]').length,
        labels: document.querySelectorAll('label[for], [aria-labelledby]').length,
      };
    });

    console.log(`  buttons=${info.buttons} (plain=${info.plain}, iconOnly=${info.iconOnly})`);
    console.log(`  switches=${info.switches}, radios=${info.radios}, radioGroups=${info.radioGroups}`);

    // P0-1: icon-only button 无 aria-label
    await check(`P0-1 icon-only 有 aria-label`, async () => info.iconOnly === 0, r.hash);

    // P0-2: Switch aria-checked 点击后变化
    if (info.switches > 0) {
      const sw = page.locator('button[role="switch"]').first();
      const before = await sw.getAttribute('aria-checked');
      await sw.click().catch(() => {});
      await page.waitForTimeout(200);
      const after = await sw.getAttribute('aria-checked');
      await check(`P0-2 switch[0] aria-checked 动态 (${before}→${after})`, async () => before !== after, r.hash);
    } else {
      totalPass++; console.log('  ℹ️ P0-2 此页无 switch，跳过');
    }

    // P0-3: Radio + RadioGroup 对应
    if (info.radios > 0 || info.radioGroups > 0) {
      await check(`P0-3 radio 数=${info.radios}, radioGroup 数=${info.radioGroups}`,
        async () => info.radioGroups >= 1 && info.radios > 0, r.hash);
    } else {
      totalPass++; console.log('  ℹ️ P0-3 此页无 radio，跳过');
    }

    // P0-4: Tab 键盘能聚焦到 switch/radio
    const focusable = await page.evaluate(() => {
      const firstSwitch = document.querySelector('button[role="switch"], button[role="radio"]');
      if (!firstSwitch) return null;
      firstSwitch.focus();
      return document.activeElement === firstSwitch;
    });
    if (focusable !== null) {
      await check('P0-4 switch/radio 可聚焦', async () => focusable, r.hash);
    } else {
      totalPass++; console.log('  ℹ️ P0-4 此页无 switch/radio，跳过');
    }
  }

  // === 汇总 ===
  console.log(`\n====== 汇总 ======`);
  console.log(`通过: ${totalPass}  失败: ${totalFail}`);

  const report = `# 无障碍巡检报告 — v1.0.2\n\n时间: ${new Date().toISOString()}\n\n## 逐页结果\n\n` +
    RESULTS.map(r => `${r.ok ? '✅' : '❌'} **${r.route}** — ${r.desc}${r.err ? ' — ' + r.err : ''}`).join('\n\n') +
    `\n\n## 汇总\n\n通过: ${totalPass}\n失败: ${totalFail}\n`;
  fs.writeFileSync(path.join(OUT, 'report.md'), report);
  console.log(`报告 → ${OUT}\\report.md`);

  browser.close();
}

run().catch(e => console.error('FATAL:', e));
