const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) }));
  await page.route('**/remote-access**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ enabled:true, running:true, port:3900, code:'123456', roots:['C:/Users'], urls:['http://1.2.3.4:3900'] } }) }));

  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => JSON.stringify({
    body: document.body?.innerText?.slice(0, 500),
    allSwitches: [...document.querySelectorAll('button[role="switch"]')].map(b => ({
      ariaChecked: b.getAttribute('aria-checked'),
      testId: b.dataset.testid,
    })),
    allButtons: [...document.querySelectorAll('button')].map(b => ({
      role: b.getAttribute('role'),
      text: (b.innerText||'').trim().slice(0,30),
    })).filter(b => b.text).slice(0, 20),
  }));
  const d = JSON.parse(info);
  console.log('body:', d.body);
  console.log('switches:', JSON.stringify(d.allSwitches));
  console.log('buttons:', JSON.stringify(d.allButtons));
  await browser.close();
})();
