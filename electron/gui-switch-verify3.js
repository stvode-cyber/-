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

  // enabled=false → toggle 是开启 → 不弹 confirm → 直接调 API
  await page.route('**/api/**', async r => {
    const path = new URL(r.request().url()).pathname;
    if (path.includes('/auth/me')) return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) });
    if (path.includes('remote-access')) return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ enabled:false, running:false, port:3900, code:'123456', roots:['C:/Users'], urls:['http://192.168.1.100:3900'] } }) });
    return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) });
  });

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);
  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2500);

  const dom = await page.evaluate(() => {
    const sw = document.querySelector('button[role="switch"]');
    return { role:sw?.getAttribute('role'), ariaChecked:sw?.getAttribute('aria-checked'), dataState:sw?.dataset.state };
  });
  console.log(`Initial: role=${dom.role} aria-checked=${dom.ariaChecked} data-state=${dom.dataState}`);

  // evaluate click
  await page.evaluate(() => document.querySelector('button[role="switch"]')?.click());
  await page.waitForTimeout(1500);
  const afterClick = await page.evaluate(() => {
    const sw = document.querySelector('button[role="switch"]');
    return { ariaChecked:sw?.getAttribute('aria-checked'), dataState:sw?.dataset.state, bodyText: document.body?.innerText?.slice(0, 100) };
  });
  console.log(`After click: aria-checked=${afterClick.ariaChecked} data-state=${afterClick.dataState}`);
  console.log(`Body preview: ${afterClick.bodyText}`);

  // 如果 toggle 调了 API 并更新了 state → 下一次 remote-access API 请求应该带上 PUT
  // 让我们 mock 改成动态返回
  let currentEnabled = false;
  await page.route('**/remote-access', async r => {
    if (r.request().method() === 'PUT') {
      currentEnabled = !currentEnabled;
      return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ enabled:currentEnabled, running:currentEnabled, port:3900, code:'123456', roots:[], urls:['http://192.168.1.100:3900'] } }) });
    }
    return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ enabled:currentEnabled, running:currentEnabled, port:3900, code:'123456', roots:[], urls:['http://192.168.1.100:3900'] } }) });
  });

  // 再来一次
  console.log('\n--- Round 2 (dynamic mock) ---');
  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2500);

  const before = await page.evaluate(() => ({
    ariaChecked: document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'),
    dataState: document.querySelector('button[role="switch"]')?.dataset.state,
  }));
  console.log(`Initial: aria-checked=${before.ariaChecked} data-state=${before.dataState}`);

  await page.evaluate(() => document.querySelector('button[role="switch"]')?.click());
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => ({
    ariaChecked: document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'),
    dataState: document.querySelector('button[role="switch"]')?.dataset.state,
  }));
  console.log(`After click: aria-checked=${after.ariaChecked} data-state=${after.dataState} ${before.ariaChecked !== after.ariaChecked ? '✅ 切换成功!' : '❌'}`);

  // 再 click 一次切回去
  await page.evaluate(() => document.querySelector('button[role="switch"]')?.click());
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => ({
    ariaChecked: document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'),
    dataState: document.querySelector('button[role="switch"]')?.dataset.state,
  }));
  console.log(`再 click: aria-checked=${back.ariaChecked} data-state=${back.dataState} ${after.ariaChecked !== back.ariaChecked ? '✅' : '❌'}`);

  // 截图
  const cdp = await page.context().newCDPSession(page);
  const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('d:/源码存档/助理项目/助理项目/APP-AIE/gui-remote-access-fixed.png', Buffer.from(ss.data, 'base64'));

  await browser.close();
  console.log('\n✅ 完成!');
})().catch(e => { console.error('FATAL:', e.message, e.stack?.slice(0, 200)); process.exit(1); });
