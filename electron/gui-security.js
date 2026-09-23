const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  await page.evaluate(() => {
    localStorage.setItem('aie_token','fake');
    localStorage.setItem('aie_user',JSON.stringify({id:'1',username:'admin',role:'admin',nickname:'绿角犀管理员',onboarded:true,hasPassword:true}));
  });
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) }));
  await page.route('**/auth/me**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, hasPassword:true } }) }));

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  await page.goto(page.url().replace(/#.*$/, '#/settings/security'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  // 点修改密码按钮
  await page.getByRole('button', { name: /修改登录密码|设置登录密码/ }).click().catch(() => {
    // 兜底：直接 evaluate
    return page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find(b => b.innerText.includes('修改登录密码') || b.innerText.includes('设置登录密码'));
      b?.click();
    });
  });
  await page.waitForTimeout(800);

  // 检查弹窗
  const r = await page.evaluate(() => JSON.stringify({
    switches: [...document.querySelectorAll('button[role="switch"]')].map(s => ({
      ariaChecked: s.getAttribute('aria-checked'),
      ariaLabelledBy: s.getAttribute('aria-labelledby'),
      testId: s.dataset.testid,
    })),
    labelOld: document.getElementById('old-pwd-label')?.innerText,
    labelNew: document.getElementById('new-pwd-label')?.innerText,
    descOld: document.getElementById('old-pwd-desc')?.innerText,
    descNew: document.getElementById('new-pwd-desc')?.innerText,
    eyeIcons: document.querySelectorAll('svg[data-lucide="eye"], svg[data-lucide="eye-off"]').length,
  }));
  const d = JSON.parse(r);
  console.log('Switch 数量:', d.switches.length, '(应为 2)');
  d.switches.forEach((s,i) => console.log(`  ${i+1}. aria-checked=${s.ariaChecked} aria-labelledby=${s.ariaLabelledBy} testid=${s.testId}`));
  console.log('label 关联: old="${d.labelOld}" new="${d.labelNew}"');
  console.log('sr-only 状态: old="${d.descOld}" new="${d.descNew}"');
  console.log('旧 Eye/EyeOff 图标残留:', d.eyeIcons, d.eyeIcons===0 ? '✅' : '❌');

  // 点击第一个 switch 测交互
  const before = await page.evaluate(() => ({
    ariaChecked: document.querySelectorAll('button[role="switch"]')[0]?.getAttribute('aria-checked'),
    inputType: document.querySelector('input[placeholder*="旧密码"]')?.getAttribute('type'),
  }));
  await page.evaluate(() => document.querySelectorAll('button[role="switch"]')[0]?.click());
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    ariaChecked: document.querySelectorAll('button[role="switch"]')[0]?.getAttribute('aria-checked'),
    inputType: document.querySelector('input[placeholder*="旧密码"]')?.getAttribute('type'),
  }));
  console.log(`\n交互: aria-checked ${before.ariaChecked} → ${after.ariaChecked}  input.type ${before.inputType} → ${after.inputType} ${after.inputType==='text'?'✅':'❌'}`);

  // 截图
  const cdp = await page.context().newCDPSession(page);
  const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('d:/源码存档/助理项目/助理项目/APP-AIE/gui-security-switches.png', Buffer.from(ss.data, 'base64'));
  console.log('\n📸 → gui-security-switches.png');

  // 全局回归
  console.log('\n--- 全局控件回归 ---');
  for (const [name, hash, sel] of [
    ['Theme radio', '#/settings/theme', 'button[role="radio"][data-group="theme-mode"]'],
    ['Tone radio', '#/settings/tone', 'button[role="radio"][data-group="preferred-tone"]'],
    ['Backup switch', '#/settings/backup', 'button[role="switch"]'],
  ]) {
    await page.goto(page.url().replace(/#.*$/, hash), { waitUntil:'networkidle' });
    await page.waitForTimeout(1500);
    const n = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
    console.log(`  ${name}: ${n} ${n>0?'✅':'❌'}`);
  }

  await browser.close();
  console.log('\n✅ 全部完成');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
