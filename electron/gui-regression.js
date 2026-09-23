const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.evaluate(() => {
    localStorage.setItem('aie_token','fake');
    localStorage.setItem('aie_user',JSON.stringify({id:'1',username:'admin',role:'admin',nickname:'绿角犀管理员',onboarded:true}));
  });
  // 正确的 mock：先匹配具体路径，catch-all 兜底
  await page.route('**/remote-access**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ enabled:true, running:true, port:3900, code:'123456', roots:[], urls:['http://1.2.3.4:3900'] } }) }));
  await page.route('**/auth/me**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) }));
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) }));
  await page.route('**/api/v1/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) }));

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  const tests = [
    ['Theme', '#/settings/theme', () => document.querySelectorAll('button[role="radio"][data-group="theme-mode"]').length],
    ['Tone', '#/settings/tone', () => document.querySelectorAll('button[role="radio"][data-group="preferred-tone"]').length],
    ['RemoteAccess', '#/settings/remote-access', () => document.querySelectorAll('button[role="switch"]').length],
    ['Backup (Auto-Switch)', '#/settings/backup', () => document.querySelectorAll('button[role="switch"]').length],
  ];

  console.log('=== 回归验证 ===');
  for (const [name, hash, fn] of tests) {
    await page.goto(page.url().replace(/#.*$/, hash), { waitUntil:'networkidle' });
    await page.waitForTimeout(2000);
    const count = await page.evaluate(fn);
    const ok = count > 0;
    console.log(`${name}: ${ok ? '✅' : '❌'} 控件数=${count}`);
  }

  await browser.close();
})();
