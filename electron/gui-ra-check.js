const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) }));
  await page.route('**/remote-access**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ enabled:false, running:false, port:3900, code:'', roots:[], urls:['http://1.2.3.4:3900'] } }) }));

  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2500);

  const sw = await page.evaluate(() => {
    const el = document.querySelector('button[role="switch"]');
    return el ? {
      ariaChecked: el.getAttribute('aria-checked'),
      testId: el.dataset.testid,
      ariaLabelledBy: el.getAttribute('aria-labelledby'),
      exists: true,
    } : { exists: false };
  });
  console.log('RemoteAccess switch:', sw.exists ? `存在 ✅ aria-checked=${sw.ariaChecked} testid=${sw.testId} aria-labelledby=${sw.ariaLabelledBy}` : '❌ 不存在');
  await browser.close();
})();
