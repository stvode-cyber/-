// P0 巡检 v3 — 抄 gui-regression.js 的 auth 绕过（mock 所有 API + reload）
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const OUT = path.join(__dirname, 'a11y-report');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { hash: '#/settings/theme',         label: 'Theme 主题模式' },
  { hash: '#/settings/tone',          label: 'Tone AI 语气' },
  { hash: '#/settings/remote-access', label: 'RemoteAccess 远程访问' },
  { hash: '#/settings/backup',        label: 'Backup 数据备份' },
  { hash: '#/settings/security',      label: 'Security 安全中心' },
  { hash: '#/settings/vault',          label: 'Vault AI 记忆库' },
  { hash: '#/settings/server',        label: 'Server 服务器设置' },
];

let pass = 0, fail = 0;

async function check(desc, fn) {
  try {
    const r = await fn();
    if (r) { pass++; console.log(`  ✅ ${desc}`); return true; }
    fail++; console.log(`  ❌ ${desc}`); return false;
  } catch (e) { fail++; console.log(`  ❌ ${desc} — ${e.message}`); return false; }
}

async function run() {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages()[0];

  // 1. 注入 localStorage
  await page.evaluate(() => {
    localStorage.setItem('aie_token', 'fake-jwt-token');
    localStorage.setItem('aie_user', JSON.stringify({ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle', hasPassword:true }));
  });

  // 2. mock 所有 API（抄 gui-regression.js）
  const mock200 = (data = null) => r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data }) });
  const mockUser = { id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle', hasPassword:true };

  await page.route('**/auth/me**', mock200(mockUser));
  await page.route('**/api/v1/auth/me**', mock200(mockUser));
  await page.route('**/remote-access**', mock200({ enabled:true, running:true, port:3900, code:'123456' }));
  await page.route('**/ai-assistant**', mock200({ name:'绿角犀', tone:'gentle', note:'你的全能助理' }));
  await page.route('**/security/**', mock200(null));
  await page.route('**/vault**', mock200([]));
  await page.route('**/backup**', mock200({ enabled:false, lastRun:null, history:[] }));
  await page.route('**/server/**', mock200({ backendUrl:'http://localhost:3000', status:'connected' }));
  // catch-all
  await page.route('**/api/**', mock200(null));
  await page.route('**/api/v1/**', mock200(null));

  // 3. reload 让 Zustand auth store init() 从 localStorage 恢复
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  const cur = page.url();
  if (cur.includes('login')) { console.log('❌ 还在 login！'); browser.close(); return; }
  console.log(`✅ 进入主界面，URL: ${cur}`);

  console.log('\n====== P0 巡检：绿角犀管家 v1.0.2 ======\n');

  // === 全局 ===
  console.log('--- 全局（侧栏 + 顶栏）---');
  const g = await page.evaluate(() => {
    const bs = Array.from(document.querySelectorAll('button'));
    return {
      total: bs.length,
      iconNoAria: bs.filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby')).length,
      plain: bs.filter(b => !b.getAttribute('role')).length,
      roles: Array.from(document.querySelectorAll('[role]')).map(e => e.getAttribute('role')),
    };
  });
  console.log(`  buttons=${g.total}, plain=${g.plain}, iconNoAria=${g.iconNoAria}`);
  console.log(`  roles: [${g.roles.join(',')}]`);
  await check('全局：icon-only button 有 aria-label', async () => g.iconNoAria === 0);

  // === 逐设置页 ===
  for (const r of ROUTES) {
    console.log(`\n--- ${r.label} (${r.hash}) ---`);
    await page.goto(page.url().replace(/#.*$/, r.hash), { waitUntil:'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `shot-${r.hash.replace('#/settings/', '').replace(/\//g,'-')}.png`), fullPage: true });

    const info = await page.evaluate(() => {
      const bs = Array.from(document.querySelectorAll('button'));
      const plain = bs.filter(b => !b.getAttribute('role'));
      return {
        buttons: bs.length,
        iconNoAria: plain.filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby')).length,
        switches: document.querySelectorAll('button[role="switch"]').length,
        radios: document.querySelectorAll('button[role="radio"]').length,
        radioGroups: document.querySelectorAll('[role="radiogroup"]').length,
        roles: Array.from(document.querySelectorAll('[role]')).map(e => e.getAttribute('role')),
      };
    });
    console.log(`  buttons=${info.buttons} iconNoAria=${info.iconNoAria} | switches=${info.switches} radios=${info.radios} groups=${info.radioGroups}`);
    console.log(`  roles: [${info.roles.join(',')}]`);

    // P0-1 icon-only 有 aria-label
    await check('P0-1 icon-only 有 aria-label', async () => info.iconNoAria === 0);

    // P0-2 switch aria-checked 动态
    if (info.switches > 0) {
      const sw = page.locator('button[role="switch"]').first();
      const before = await sw.getAttribute('aria-checked');
      await sw.click().catch(() => {});
      await page.waitForTimeout(300);
      const after = await sw.getAttribute('aria-checked');
      await check(`P0-2 switch aria-checked ${before}→${after}`, async () => before !== after);
    } else { console.log('  ℹ️ 无 switch，跳过'); }

    // P0-3 radio + radiogroup 配对
    if (info.radios > 0) {
      await check(`P0-3 radio=${info.radios} group=${info.radioGroups}`, async () => info.radioGroups >= 1 && info.radios >= 2);
    } else { console.log('  ℹ️ 无 radio，跳过'); }

    // P0-4 键盘可聚焦
    if (info.switches > 0 || info.radios > 0) {
      const ok = await page.evaluate(() => {
        const el = document.querySelector('button[role="switch"], button[role="radio"]');
        if (!el) return null;
        el.focus();
        return document.activeElement === el;
      });
      await check('P0-4 switch/radio 可聚焦', async () => ok);
    } else { console.log('  ℹ️ 无 switch/radio，跳过'); }
  }

  console.log(`\n====== 汇总：通过 ${pass} / 失败 ${fail} ======`);
  browser.close();
}
run().catch(e => console.error('FATAL:', e.message));
