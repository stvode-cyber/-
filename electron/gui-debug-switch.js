const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('aie_token', 'fake');
    localStorage.setItem('aie_user', JSON.stringify({ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' }));
  });

  // 记录所有请求
  const requests = [];
  page.on('request', req => {
    if (req.url().includes('api')) requests.push(req.method() + ' ' + req.url().slice(-80));
  });

  // 全部放行 + 看错误
  await page.route('**/api/**', async r => {
    const url = r.request().url();
    const path = new URL(url).pathname;
    console.log('MOCK:', r.request().method(), path);

    // auth me
    if (path.includes('/auth/me')) {
      return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:0, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) });
    }
    // remote-access — 任何形式的
    if (path.includes('remote-access')) {
      return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:0, data:{ enabled:false, running:false, port:3900, code:'123456', roots:['C:/Users'], urls:['http://192.168.1.100:3900'] } }) });
    }
    // 其他 auth 相关
    if (path.includes('/auth/')) {
      return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:0, data:{ id:'1', username:'admin', role:'admin' } }) });
    }
    // 其他 — 让它 fail 但不是网络错误（返回 200 + null 会被 unwrap 处理？）
    return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:0, data:null }) });
  });

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);
  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(3000);

  console.log('\nRoute:', page.url().slice(-40));
  console.log('Requests:', requests.join('\n  '));

  // 直接看有没有 role=switch
  const roleSwitch = await page.evaluate(() => document.querySelector('button[role="switch"]')?.outerHTML?.slice(0, 300) || 'NOT FOUND');
  const bodyPreview = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || 'NO BODY');
  console.log('\nbody:', bodyPreview);
  console.log('\nrole=switch:', roleSwitch);

  await browser.close();
})();
