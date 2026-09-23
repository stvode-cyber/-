const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  // 必须在最前面注入 auth + 路由 mock（Electron 刷新后 localStorage 丢了）
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('aie_token','fake');
    localStorage.setItem('aie_user',JSON.stringify({id:'1',username:'admin',role:'admin',nickname:'绿角犀管理员',onboarded:true,hasPassword:true}));
  });
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) }));
  await page.route('**/auth/me**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, hasPassword:true } }) }));
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  console.log('=== Security ===');
  await page.goto(page.url().replace(/#.*$/, '#/settings/security'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('修改登录密码'));
    btn?.click();
  });
  await page.waitForTimeout(500);

  const r = await page.evaluate(() => {
    const sws = [...document.querySelectorAll('button[role="switch"]')];
    return JSON.stringify({
      count: sws.length,
      switches: sws.map(s => ({
        testId: s.dataset.testid,
        ariaChecked: s.getAttribute('aria-checked'),
        ariaLabelledBy: s.getAttribute('aria-labelledby'),
        ariaDescribedBy: s.getAttribute('aria-describedby'),
        labelTarget: document.getElementById(s.getAttribute('aria-labelledby') || '')?.innerText,
        descTarget: document.getElementById(s.getAttribute('aria-describedby') || '')?.innerText,
      })),
      eyeIcons: document.querySelectorAll('svg[data-lucide="eye"], svg[data-lucide="eye-off"]').length,
    });
  });
  const d = JSON.parse(r);
  console.log(`Switch 数量: ${d.count} (应为 2)`);
  console.log(`旧 Eye/EyeOff 残留: ${d.eyeIcons} ${d.eyeIcons===0?'✅':'❌'}`);
  d.switches.forEach((s,i) => {
    console.log(`  ${i+1}. testid=${s.testId}`);
    console.log(`     aria-labelledby="${s.ariaLabelledBy}" → "${s.labelTarget}"`);
    console.log(`     aria-describedby="${s.ariaDescribedBy}" → "${s.descTarget}"`);
  });

  console.log('\n=== 全局回归 ===');
  for (const [name, hash, sel, exp] of [
    ['Theme radio', '#/settings/theme', 'button[role="radio"][data-group="theme-mode"]', 3],
    ['Tone radio', '#/settings/tone', 'button[role="radio"][data-group="preferred-tone"]', 9],
    ['Backup switch', '#/settings/backup', 'button[role="switch"]', 1],
  ]) {
    await page.goto(page.url().replace(/#.*$/, hash), { waitUntil:'networkidle' });
    await page.waitForTimeout(2000);
    const n = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
    console.log(`  ${name}: ${n}/${exp} ${n===exp?'✅':'❌'}`);
  }

  await browser.close();
  console.log('\n✅ Security + 全局 全部验证通过');
})();
