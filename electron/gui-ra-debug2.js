const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.evaluate(() => {
    localStorage.setItem('aie_token','fake');
    localStorage.setItem('aie_user',JSON.stringify({id:'1',username:'admin',role:'admin',nickname:'绿角犀管理员',onboarded:true}));
  });

  // 用 console 收集错误
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });

  // 拦截所有 API，看 remote-access 实际收到的是什么
  await page.route('**/remote-access**', async r => {
    console.log('→', r.request().method(), r.request().url());
    const body = r.request().postData();
    const res = { code:200, data:{ enabled:true, running:true, port:3900, code:'123456', roots:[], urls:['http://1.2.3.4:3900'] } };
    console.log('← RESPONSE:', JSON.stringify(res).slice(0, 100));
    return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(res) });
  });
  await page.route('**/auth/me**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) }));
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) }));

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(1500);
  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => ({
    body: document.body?.innerText?.slice(0, 600),
    hasSwitch: !!document.querySelector('button[role="switch"]'),
  }));
  console.log('\nbody:', info.body);
  console.log('hasSwitch:', info.hasSwitch);
  console.log('errs:', errs);
  await browser.close();
})();
