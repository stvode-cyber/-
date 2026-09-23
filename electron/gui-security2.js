const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  // 直接用之前的 auth state
  await page.goto(page.url().replace(/#.*$/, '#/settings/security'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('修改登录密码'));
    btn?.click();
  });
  await page.waitForTimeout(500);

  const r = await page.evaluate(() => {
    const sws = [...document.querySelectorAll('button[role="switch"]')];
    return JSON.stringify(sws.map(s => ({
      testId: s.dataset.testid,
      ariaChecked: s.getAttribute('aria-checked'),
      ariaLabelledBy: s.getAttribute('aria-labelledby'),
      labeTargetText: document.getElementById(s.getAttribute('aria-labelledby') || '')?.innerText,
    })));
  });
  console.log(r);
  await browser.close();
})();
