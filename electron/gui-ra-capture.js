const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  const reqs = [];
  page.on('request', r => {
    if (r.url().includes('remote-access') || r.url().includes('auth/me')) reqs.push(r.url());
  });
  await page.evaluate(() => {
    localStorage.setItem('aie_token','fake');
    localStorage.setItem('aie_user',JSON.stringify({id:'1',username:'admin',role:'admin',nickname:'绿角犀管理员',onboarded:true}));
  });
  await page.route('**/auth/me**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) }));
  await page.route('**/api/**', r => {
    console.log('INTERCEPTED:', r.request().method(), r.request().url());
    return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) });
  });

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(1500);
  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(3000);
  console.log('\nrequests:', reqs);
  await browser.close();
})();
