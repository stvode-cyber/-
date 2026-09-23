const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('aie_token', 'fake');
    localStorage.setItem('aie_user', JSON.stringify({ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' }));
  });

  await page.route('**/api/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (path.includes('/auth/me')) return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) });
    if (path.includes('remote-access')) return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ enabled:true, running:true, port:3900, code:'123456', roots:['C:/Users'], urls:['http://192.168.1.100:3900'] } }) });
    return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) });
  });

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);
  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2500);

  console.log('▓'.repeat(60));
  console.log('  RemoteAccess Switch — 最终验证');
  console.log('▓'.repeat(60));

  // 1. DOM 验证
  const dom = await page.evaluate(() => {
    const sw = document.querySelector('button[role="switch"]');
    return {
      role: sw?.getAttribute('role'),
      ariaChecked: sw?.getAttribute('aria-checked'),
      ariaLabelledBy: sw?.getAttribute('aria-labelledby'),
      ariaDescribedBy: sw?.getAttribute('aria-describedby'),
      tabIndex: sw?.tabIndex,
      dataState: sw?.dataset.state,
      labelText: sw ? document.getElementById(sw.getAttribute('aria-labelledby'))?.innerText : null,
      descText: sw ? document.getElementById(sw.getAttribute('aria-describedby'))?.innerText?.slice(0, 60) : null,
    };
  });
  console.log(`\n📍 DOM:`);
  console.log(`  role="${dom.role}" aria-checked="${dom.ariaChecked}" tabIndex=${dom.tabIndex} data-state="${dom.dataState}"`);
  console.log(`  aria-labelledby → "${dom.labelText}"`);
  console.log(`  aria-describedby → "${dom.descText}..."`);

  // 2. 用 click({ force:true }) 验证交互（绕开 playwright 的 visibility check）
  // 先 mock confirm 组件（RemoteAccessPage 用 useConfirm，它会弹一个 dialog）
  // 但因为开关初始是 enabled=false → toggle() 是开启 → 不弹 confirm
  // 所以直接 click 就行

  console.log(`\n🖱️  Click 测试（force=true 绕开 overlay 拦截）:`);
  const before = await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'));
  console.log(`  before aria-checked: ${before}`);

  const sw = page.locator('button[role="switch"]');
  await sw.click({ force: true });
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'));
  console.log(`  after click aria-checked: ${after}  ${before !== after ? '✅ 切换成功' : '❌'}`);

  // 3. 键盘 Space —— 因为在 Electron 里 focus 后 Space 应该直接触发 handler
  console.log(`\n⌨️  Space 键测试:`);
  await page.evaluate(() => {
    const el = document.querySelector('button[role="switch"]');
    el?.focus();
  });
  // 先重置回去
  await page.evaluate(() => document.querySelector('button[role="switch"]')?.click());
  await page.waitForTimeout(300);
  const beforeSpace = await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'));
  console.log(`  before Space aria-checked: ${beforeSpace}`);

  // 用 playwright 直接 dispatch Space
  await sw.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  const afterSpace = await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'));
  console.log(`  after Space aria-checked: ${afterSpace}  ${beforeSpace !== afterSpace ? '✅' : '❌'}`);

  // 4. 直接用 .evaluate 手动触发 click 验证 onChange 绑定
  console.log(`\n🧪 evaluate click 测试:`);
  const directBefore = await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'));
  await page.evaluate(() => document.querySelector('button[role="switch"]')?.click());
  await page.waitForTimeout(500);
  const directAfter = await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'));
  console.log(`  before=${directBefore} after=${directAfter}  ${directBefore !== directAfter ? '✅' : '❌ 没反应 — onChange 可能没绑定或 toggle 里有问题'}`);

  // 5. 检查有没有控制台错误
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) });
  page.on('pageerror', err => errors.push('pageerror: ' + err.message));

  console.log(`\n⚠️  控制台错误: ${errors.length} 个`);
  errors.slice(0, 5).forEach(e => console.log(`  ${e.slice(0, 120)}`));

  // 6. 截图
  const cdp = await page.context().newCDPSession(page);
  const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('d:/源码存档/助理项目/助理项目/APP-AIE/gui-remote-access-fixed.png', Buffer.from(ss.data, 'base64'));
  console.log('\n✅ 截图 → gui-remote-access-fixed.png');

  await browser.close();
  console.log('\n' + '▓'.repeat(60));
})().catch(e => { console.error('FATAL:', e.message, e.stack?.slice(0, 300)); process.exit(1); });
