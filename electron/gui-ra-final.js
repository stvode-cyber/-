const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.evaluate(() => {
    localStorage.setItem('aie_token','fake');
    localStorage.setItem('aie_user',JSON.stringify({id:'1',username:'admin',role:'admin',nickname:'绿角犀管理员',onboarded:true}));
  });
  await page.route('**/api/v1/remote-access', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ enabled:true, running:true, port:3900, code:'123456', roots:['C:/Users'], urls:['http://1.2.3.4:3900'] } }) }));
  await page.route('**/auth/me**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) }));
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) }));

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(1500);
  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2500);

  const n = await page.evaluate(() => document.querySelectorAll('button[role="switch"]').length);
  console.log('RemoteAccess switch:', n > 0 ? `✅ 存在 (${n} 个)` : '❌ 不存在');

  const bodyHasError = await page.evaluate(() => document.body?.innerText?.includes('加载失败'));
  console.log('是否显示加载失败:', bodyHasError ? '是 (说明 API 返回结构不对)' : '否 ✅');
  await browser.close();
})();
