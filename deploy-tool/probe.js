const { chromium } = require('playwright-core');
async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  // 先看看当前页是啥
  await page.waitForTimeout(2000);
  const url = page.url();
  const title = await page.title();
  console.log('当前 URL:', url);
  console.log('当前 title:', title);

  // 注入真实一点的 token（之前我们验证过能绕过 auth guard 的那个格式）
  await page.evaluate(() => {
    localStorage.setItem('aie_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsInVzZXJuYW1lIjoidGVzdGVyIiwiaWF0IjoxNzU3Nzc3Nzc3fQ.dummy');
    localStorage.setItem('aie_user', JSON.stringify({ id: 1, username: 'tester', nickname: '测试', email: 'tester@aie.local' }));
  });

  // 跳到 Theme
  const INDEX = 'file:///d:/源码存档/助理项目/助理项目/APP-AIE/electron/release-v16/win-unpacked/resources/frontend/index.html';
  await page.goto(INDEX + '#/settings/theme', { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(2000);

  console.log('\n--- Theme 页 DOM ---');
  const info = await page.evaluate(() => {
    return {
      url: location.href,
      bodyHTML: document.body.innerHTML.slice(0, 2000),
      hasRadiogroup: !!document.querySelector('[role="radiogroup"]'),
      radioCount: document.querySelectorAll('[role="radio"]').length,
      switchCount: document.querySelectorAll('[role="switch"]').length,
      allRoles: Array.from(document.querySelectorAll('[role]')).map(e => e.getAttribute('role')),
      buttons: Array.from(document.querySelectorAll('button')).map(b => ({
        role: b.getAttribute('role'),
        text: b.textContent.trim().slice(0, 30),
        ariaLabel: b.getAttribute('aria-label'),
        ariaLabelledBy: b.getAttribute('aria-labelledby'),
        classes: b.getAttribute('class')?.slice(0, 60),
      })),
    };
  });
  console.log('url:', info.url);
  console.log('allRoles:', info.allRoles);
  console.log('\nbuttons:');
  info.buttons.forEach(b => console.log(' ', JSON.stringify(b)));
  console.log('\nbodyHTML 前 2000 字符:');
  console.log(info.bodyHTML);

  await page.screenshot({ path: 'd:/源码存档/助理项目/助理项目/APP-AIE/gui-theme-probe.png', fullPage: true });
  console.log('\n截图 → gui-theme-probe.png');

  browser.close();
}
main().catch(e => console.error(e));
