const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('aie_token', 'fake-jwt-token');
    localStorage.setItem('aie_user', JSON.stringify({ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' }));
  });
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:0, data:null }) }));
  await page.route('**/api/v1/auth/me', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:0, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) }));

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  console.log('After reload:', page.url().slice(-50));

  // 用 React Router 的 navigate() 来跳（更可靠）
  const r = await page.evaluate(() => {
    // 找 React Fiber 或者直接改 hash
    location.hash = '#/settings/theme';
    return location.hash;
  });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);

  console.log('After hash jump:', page.url().slice(-50));

  // 直接扒 DOM
  const info = await page.evaluate(() => {
    return JSON.stringify({
      route: location.hash,
      bodyPreview: document.body?.innerText?.slice(0, 500),
      allRoles: [...new Set([...document.querySelectorAll('[role]')].map(el => el.getAttribute('role')))],
      radios: [...document.querySelectorAll('button[role="radio"]')].map(r => ({
        text: (r.innerText||'').trim().slice(0, 30),
        ariaChecked: r.getAttribute('aria-checked'),
        tabIndex: r.tabIndex,
        dataGroup: r.dataset.group,
        dataValue: r.dataset.value,
      })),
      radioGroup: document.querySelector('[role="radiogroup"]')?.outerHTML?.slice(0, 400) || null,
      // 看看有没有旧的 button（没有 role 的）
      plainButtons: [...document.querySelectorAll('button')].filter(b => !b.getAttribute('role')).map(b => (b.innerText||'').trim().slice(0, 20)).filter(Boolean),
    });
  });
  const d = JSON.parse(info);
  console.log(`\nRoute: ${d.route}`);
  console.log(`All roles on page: ${d.allRoles.join(', ') || '(无)'}`);
  console.log(`Radios (role=radio): ${d.radios.length}`);
  d.radios.forEach(r => console.log(`  value=${r.dataValue} aria-checked=${r.ariaChecked} tabIndex=${r.tabIndex} group=${r.dataGroup} text="${r.text}"`));
  console.log(`Plain buttons (no role): ${d.plainButtons.length} → ${d.plainButtons.join(', ')}`);
  console.log(`Radiogroup: ${d.radioGroup ? '✅ 有' : '❌ 无'}`);

  if (!d.radios.length) {
    console.log('\n❌ role=radio 数量为 0！检查一下 ThemeSettingsPage 的 JS 有没有加载...');
    const themeJS = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src);
      return scripts.filter(s => s.includes('Theme') || s.includes('theme') || s.includes('selectable'));
    });
    console.log('Theme 相关 script:', themeJS);

    // 手动检查 index.html 里的 script src
    const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(s => s.src));
    console.log('\n所有 scripts:', scripts);
  }

  await browser.close();
})();
