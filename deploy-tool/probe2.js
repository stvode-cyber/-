const { chromium } = require('playwright-core');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const FE = 'd:/源码存档/助理项目/助理项目/APP-AIE/electron/release-v16/win-unpacked/resources/frontend';
const INDEX = 'file:///' + FE.replace(/\\/g, '/') + '/index.html';

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];

  // evaluateOnNewDocument — 在页面任何 JS 执行前注入！
  await ctx.addInitScript((u) => {
    localStorage.setItem('aie_token', 'fake-jwt-token-for-test');
    localStorage.setItem('aie_user', JSON.stringify(u));
  }, { id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle', hasPassword:true });

  const page = ctx.pages()[0];

  // mock auth API
  const mockUser = { id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle', hasPassword:true };
  await page.route('**/auth/me', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data: mockUser }) }));
  await page.route('**/api/v1/auth/me', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data: mockUser }) }));

  // 先 reload 当前页（之前可能是 login 或首页）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const url = page.url();
  console.log('当前 URL:', url);

  // 看 Theme 页
  await page.goto(INDEX + '#/settings/theme', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    return {
      url: location.href,
      title: document.title,
      allRoles: Array.from(document.querySelectorAll('[role]')).map(e => `${e.getAttribute('role')}:${e.textContent.trim().slice(0,20)}`),
      buttons: Array.from(document.querySelectorAll('button')).map(b => ({
        role: b.getAttribute('role'),
        text: b.textContent.trim().slice(0, 30),
        ariaLabel: b.getAttribute('aria-label'),
        ariaLB: b.getAttribute('aria-labelledby'),
      })),
      bodySnippet: document.body.innerText.slice(0, 500),
    };
  });
  console.log('\nurl:', info.url);
  console.log('title:', info.title);
  console.log('allRoles:', info.allRoles);
  console.log('\nbuttons:');
  info.buttons.forEach(b => console.log(' ', JSON.stringify(b)));
  console.log('\nbody text:', info.bodySnippet);

  await page.screenshot({ path: 'd:/源码存档/助理项目/助理项目/APP-AIE/gui-theme-v2.png', fullPage: true });
  console.log('\n✅ screenshot 已保存');
  browser.close();
}
main().catch(e => console.error('FATAL:', e.message));
