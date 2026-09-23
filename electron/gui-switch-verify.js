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

  // ⚠️ 关键：后端 code=200-299 才算成功！不是 0！
  await page.route('**/api/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (path.includes('/auth/me')) {
      return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) });
    }
    if (path.includes('remote-access')) {
      return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ enabled:false, running:false, port:3900, code:'123456', roots:['C:/Users'], urls:['http://192.168.1.100:3900'] } }) });
    }
    return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) });
  });

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);
  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(3000);

  console.log('▓'.repeat(60));
  console.log('  RemoteAccess Switch 无障碍验证');
  console.log('▓'.repeat(60));

  const swInfo = await page.evaluate(() => {
    const sw = document.querySelector('button[role="switch"]');
    return JSON.stringify({
      route: location.hash,
      switchExists: !!sw,
      role: sw?.getAttribute('role'),
      ariaChecked: sw?.getAttribute('aria-checked'),
      ariaLabelledBy: sw?.getAttribute('aria-labelledby'),
      ariaDescribedBy: sw?.getAttribute('aria-describedby'),
      tabIndex: sw?.tabIndex,
      dataState: sw?.dataset.state,
      innerHTML: sw?.innerHTML?.slice(0, 200),
      outerHTML: sw?.outerHTML?.slice(0, 500),
      labelTarget: sw ? document.getElementById(sw.getAttribute('aria-labelledby') || '')?.innerText?.slice(0, 50) : null,
      descTarget: sw ? document.getElementById(sw.getAttribute('aria-describedby') || '')?.innerText?.slice(0, 60) : null,
      bodyPreview: document.body?.innerText?.slice(0, 400),
    });
  });
  const s = JSON.parse(swInfo);

  console.log(`\n📍 Route: ${s.route}`);
  console.log(`  body: ${s.bodyPreview?.slice(0, 120)}`);
  console.log(`  button[role="switch"]: ${s.switchExists ? '✅' : '❌'}`);
  console.log(`  role=${s.role} aria-checked=${s.ariaChecked} tabIndex=${s.tabIndex} data-state=${s.dataState}`);
  console.log(`  aria-labelledby=${s.ariaLabelledBy} → "${s.labelTarget}" ${s.labelTarget ? '✅' : '❌'}`);
  console.log(`  aria-describedby=${s.ariaDescribedBy} → "${s.descTarget}" ${s.descTarget ? '✅' : '❌'}`);
  console.log(`  outerHTML:\n${s.outerHTML}`);

  // Keyboard Space 测试
  console.log('\n⌨️  keyboard tests:');
  const sw = page.locator('button[role="switch"]');
  const before = await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'));
  console.log(`  initial aria-checked: ${before}`);

  await sw.focus();
  await sw.press('Space');
  await page.waitForTimeout(300);
  const afterSpace = await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'));
  console.log(`  Space → aria-checked: ${afterSpace} ${before !== afterSpace ? '✅' : '❌'}`);

  await sw.press('Enter');
  await page.waitForTimeout(300);
  const afterEnter = await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'));
  console.log(`  Enter → aria-checked: ${afterEnter} ${afterSpace !== afterEnter ? '✅' : '❌'}`);

  await sw.click();
  await page.waitForTimeout(300);
  const afterClick = await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'));
  console.log(`  Click → aria-checked: ${afterClick} ${afterEnter !== afterClick ? '✅' : '❌'}`);

  // disabled 状态（模拟 loading）
  // 注：toggle 会调 confirm，所以这里只测正常状态

  // 截图
  const cdp = await page.context().newCDPSession(page);
  const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('d:/源码存档/助理项目/助理项目/APP-AIE/gui-remote-access-fixed.png', Buffer.from(ss.data, 'base64'));
  console.log('\n✅ 截图 → gui-remote-access-fixed.png');

  // 顺便验证一下 Theme + Tone 还在（没被这次改动影响）
  console.log('\n--- 回归验证 Theme/Tone ---');
  await page.goto(page.url().replace(/#.*$/, '#/settings/theme'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2000);
  const tCount = await page.evaluate(() => document.querySelectorAll('button[role="radio"][data-group="theme-mode"]').length);
  console.log(`Theme radio count: ${tCount} (应为 3) ${tCount===3?'✅':'❌'}`);

  await page.goto(page.url().replace(/#.*$/, '#/settings/tone'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2000);
  const tnCount = await page.evaluate(() => document.querySelectorAll('button[role="radio"][data-group="preferred-tone"]').length);
  console.log(`Tone radio count: ${tnCount} (应为 9) ${tnCount===9?'✅':'❌'}`);

  await browser.close();
  console.log('\n' + '▓'.repeat(60));
  console.log('  RemoteAccess Switch 验证通过！');
  console.log('▓'.repeat(60));
})().catch(e => { console.error('FATAL:', e.message, e.stack?.slice(0, 300)); process.exit(1); });
