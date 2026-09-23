// P0 巡检 v2 — 修正 auth guard 绕过（注入 localStorage + 刷新 + mock /auth/me）
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

let pass = 0, fail = 0;

async function check(desc, fn, route) {
  try {
    const r = await fn();
    if (r) { pass++; console.log(`  ✅ ${desc}`); }
    else   { fail++; console.log(`  ❌ ${desc}`); }
  } catch (e) {
    fail++; console.log(`  ❌ ${desc} — ${e.message}`);
  }
}

async function run() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];

  // === 关键：mock auth API ===
  const mockUser = { id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle', hasPassword:true };
  await page.route('**/auth/me', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data: mockUser }) }));
  await page.route('**/api/v1/auth/me', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data: mockUser }) }));

  // === 注入 auth + 刷新（让 Zustand auth store 从 localStorage 恢复）===
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate((u) => {
    localStorage.clear();
    localStorage.setItem('aie_token', 'fake-jwt-token-for-test');
    localStorage.setItem('aie_user', JSON.stringify(u));
  }, mockUser);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 确认当前是首页（不是 login）
  const curUrl = page.url();
  if (curUrl.includes('login')) {
    console.log('❌ auth guard 没绕过，还在 login 页');
    browser.close();
    return;
  }
  console.log(`✅ 进入首页，URL: ${curUrl}`);

  console.log('\n====== P0 巡检：绿角犀管家 v1.0.2 ======\n');

  // === 全局 ===
  console.log('--- 全局（侧栏 + 顶栏）---');
  const globalInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return {
      total: buttons.length,
      iconOnlyNoAria: buttons.filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby')).length,
      allRoles: Array.from(document.querySelectorAll('[role]')).map(e => e.getAttribute('role')),
    };
  });
  console.log(`  button 总数=${globalInfo.total}, icon-only 无 aria=${globalInfo.iconOnlyNoAria}, roles=[${globalInfo.allRoles.join(',')}]`);

  // === 逐设置页 ===
  for (const r of ROUTES) {
    console.log(`\n--- ${r.label} (${r.hash}) ---`);
    await page.goto(INDEX + r.hash, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `shot-${r.hash.replace('#/settings/', '').replace(/\//g,'-')}.png`), fullPage: true });

    const info = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const plain = buttons.filter(b => !b.getAttribute('role'));
      return {
        buttons: buttons.length,
        plain: plain.length,
        iconOnly: plain.filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby')).length,
        switches: document.querySelectorAll('button[role="switch"]').length,
        radios: document.querySelectorAll('button[role="radio"]').length,
        radioGroups: document.querySelectorAll('[role="radiogroup"]').length,
        allRoles: Array.from(document.querySelectorAll('[role]')).map(e => e.getAttribute('role')),
      };
    });
    console.log(`  buttons=${info.buttons} plain=${info.plain} iconOnly=${info.iconOnly} | switches=${info.switches} radios=${info.radios} groups=${info.radioGroups}`);
    console.log(`  allRoles: [${info.allRoles.join(',')}]`);

    // P0-1 icon-only 有 aria-label
    await check('P0-1 icon-only button 有 aria-label', async () => info.iconOnly === 0, r.hash);

    // P0-2 switch aria-checked 点击后变化
    if (info.switches > 0) {
      const sw = page.locator('button[role="switch"]').first();
      const before = await sw.getAttribute('aria-checked');
      await sw.click().catch(() => {});
      await page.waitForTimeout(300);
      const after = await sw.getAttribute('aria-checked');
      await check(`P0-2 switch[0] aria-checked ${before}→${after}`, async () => before !== after, r.hash);
    } else { console.log('  ℹ️ 此页无 switch'); }

    // P0-3 radio 有 radiogroup 容器
    if (info.radios > 0) {
      await check(`P0-3 radio数=${info.radios}, radioGroup数=${info.radioGroups}`, async () => info.radioGroups >= 1 && info.radios >= 2, r.hash);
    } else { console.log('  ℹ️ 此页无 radio'); }

    // P0-4 keyboard focusable
    if (info.switches > 0 || info.radios > 0) {
      const ok = await page.evaluate(() => {
        const el = document.querySelector('button[role="switch"], button[role="radio"]');
        if (!el) return null;
        el.focus();
        return document.activeElement === el;
      });
      await check('P0-4 switch/radio 可聚焦', async () => ok, r.hash);
    } else { console.log('  ℹ️ 此页无 switch/radio'); }
  }

  console.log(`\n====== 汇总：通过 ${pass} / 失败 ${fail} ======`);
  browser.close();
}
run().catch(e => console.error('FATAL:', e.message));
