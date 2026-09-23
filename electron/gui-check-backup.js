const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.evaluate(() => { localStorage.setItem('aie_token','fake'); localStorage.setItem('aie_user',JSON.stringify({id:'1',username:'admin',role:'admin',nickname:'绿角犀管理员',onboarded:true})); });
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) }));
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(1500);
  await page.goto(page.url().replace(/#.*$/, '#/settings/backup'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => JSON.stringify({
    route: location.hash,
    bodyFull: document.body?.innerText?.slice(0, 2000),
    buttons: [...document.querySelectorAll('button')].map(b => ({
      role: b.getAttribute('role'), ariaChecked: b.getAttribute('aria-checked'),
      text: (b.innerText||'').trim().slice(0,30), cls: (b.className||'').toString().slice(0,60),
    })).filter(b => b.text),
    allRoles: [...new Set([...document.querySelectorAll('[role]')].map(el => el.getAttribute('role')))],
  }));
  const d = JSON.parse(info);
  console.log('Route:', d.route);
  console.log('All roles:', d.allRoles.join(', ') || '(无)');
  console.log('\nBody:'); console.log(d.bodyFull);
  console.log('\nButtons:');
  d.buttons.forEach(b => console.log(`  role=${b.role||'-'} aria-checked=${b.ariaChecked||'-'} "${b.text}"`));
  await browser.close();
})();
