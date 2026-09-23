// Playwright 自己启动 Electron — evaluateOnNewDocument 才能注入
const { chromium } = require('playwright-core');
const path = require('path');

const EXE = 'd:/源码存档/助理项目/助理项目/APP-AIE/electron/release-v16/win-unpacked/绿角犀.exe';

async function main() {
  const mockUser = { id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle', hasPassword:true };

  const browser = await chromium.launch({
    executablePath: EXE,
    args: [],
    headless: false,
  });

  // evaluateOnNewDocument — Electron 加载任何脚本**之前**注入
  const ctx = browser.contexts()[0];
  await ctx.addInitScript((u) => {
    localStorage.setItem('aie_token', 'fake-jwt-token-for-test');
    localStorage.setItem('aie_user', JSON.stringify(u));
  }, mockUser);

  const page = ctx.pages()[0];
  await page.waitForTimeout(3000);

  // mock auth API
  await page.route('**/auth/me', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data: mockUser }) }));
  await page.route('**/api/v1/auth/me', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data: mockUser }) }));

  // 等 App 加载 + auth check 完成
  await page.waitForTimeout(2000);
  const url = page.url();
  console.log('初始 URL:', url);

  // 如果还在 login，手动跳
  if (url.includes('login')) {
    console.log('还在 login，手动 goto 首页...');
    // 等 1s 让 addInitScript 生效
    await page.waitForTimeout(1000);
    await page.evaluate((u) => {
      localStorage.setItem('aie_token', 'fake-jwt-token-for-test');
      localStorage.setItem('aie_user', JSON.stringify(u));
    }, mockUser);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2500);
  }

  const url2 = page.url();
  console.log('重加载后 URL:', url2);

  // 进 Theme 页
  const INDEX = 'file:///d:/源码存档/助理项目/助理项目/APP-AIE/electron/release-v16/win-unpacked/resources/frontend/index.html';
  await page.goto(INDEX + '#/settings/theme', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    roles: Array.from(document.querySelectorAll('[role]')).map(e => e.getAttribute('role')),
    bodyText: document.body.innerText.slice(0, 600),
    switchCount: document.querySelectorAll('[role="switch"]').length,
    radioCount: document.querySelectorAll('[role="radio"]').length,
    groupCount: document.querySelectorAll('[role="radiogroup"]').length,
  }));
  console.log('\n📋 Theme 页:');
  console.log('  url:', info.url);
  console.log('  title:', info.title);
  console.log('  roles:', info.roles);
  console.log('  switches:', info.switchCount, 'radios:', info.radioCount, 'groups:', info.groupCount);
  console.log('  body:', info.bodyText.slice(0, 200), '...');

  await page.screenshot({ path: 'd:/源码存档/助理项目/助理项目/APP-AIE/gui-theme-v3.png', fullPage: true });
  console.log('\n✅ screenshot → gui-theme-v3.png');

  browser.close();
}
main().catch(e => console.error('FATAL:', e.message));
