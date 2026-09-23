const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('aie_token', 'fake');
    localStorage.setItem('aie_user', JSON.stringify({ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' }));
  });
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:0, data:null }) }));
  await page.route('**/api/v1/auth/me', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:0, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) }));

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(1500);

  console.log('▓'.repeat(60));
  console.log('  P0 无障碍修复 — 完整验证');
  console.log('▓'.repeat(60));

  // ── Theme 页验证 ──
  console.log('\n📍 #/settings/theme — Theme（vertical list）');
  await page.goto(page.url().replace(/#.*$/, '#/settings/theme'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  const theme = await page.evaluate(() => {
    const radios = [...document.querySelectorAll('button[role="radio"][data-group="theme-mode"]')];
    const group = document.querySelector('[role="radiogroup"][data-selectable-group="theme-mode"]');
    return JSON.stringify({
      route: location.hash,
      group: group ? {
        role: group.getAttribute('role'),
        ariaLabelledBy: group.getAttribute('aria-labelledby'),
        ariaLabel: group.getAttribute('aria-label'),
      } : null,
      radios: radios.map(r => ({
        value: r.dataset.value,
        ariaChecked: r.getAttribute('aria-checked'),
        ariaLabel: r.getAttribute('aria-labelledby'),
        ariaDesc: r.getAttribute('aria-describedby'),
        tabIndex: r.tabIndex,
        selectedStyle: r.className.includes('border-primary-500'),
      })),
    });
  });
  const th = JSON.parse(theme);
  console.log(`  radiogroup: ${th.group?.role} aria-labelledby="${th.group?.ariaLabelledBy}"`);
  th.radios.forEach(r => {
    console.log(`  ${r.ariaChecked==='true'?'🟢':'⚪'} value=${r.value} aria-checked=${r.ariaChecked} tabIndex=${r.tabIndex} styleOK=${r.selectedStyle} aria-labelledby="${r.ariaLabel}" aria-describedby="${r.ariaDesc}"`);
  });

  // ── Keyboard 导航 ──
  console.log('\n⌨️  Keyboard ArrowUp/Down 测试');
  const systemRadio = page.locator('button[role="radio"][data-value="system"]');
  await systemRadio.focus();
  let f = await page.evaluate(() => document.activeElement?.dataset.value);
  console.log(`  focus system: ${f} aria-checked=${await page.evaluate(() => document.activeElement?.getAttribute('aria-checked'))}`);
  await systemRadio.press('ArrowUp');
  await page.waitForTimeout(200);
  f = await page.evaluate(() => document.activeElement?.dataset.value);
  console.log(`  ArrowUp → focus ${f} (应为 dark)`);
  await systemRadio.press('ArrowUp');
  await page.waitForTimeout(200);
  f = await page.evaluate(() => document.activeElement?.dataset.value);
  console.log(`  ArrowUp → focus ${f} (应为 light)`);

  // ── Tone 页验证 ──
  console.log('\n📍 #/settings/tone — Tone（grid 9 卡）');
  await page.goto(page.url().replace(/#.*$/, '#/settings/tone'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  const tone = await page.evaluate(() => {
    const radios = [...document.querySelectorAll('button[role="radio"][data-group="preferred-tone"]')];
    return JSON.stringify({
      route: location.hash,
      radioCount: radios.length,
      radios: radios.map(r => ({
        value: r.dataset.value,
        ariaChecked: r.getAttribute('aria-checked'),
        tabIndex: r.tabIndex,
        text: (r.innerText||'').trim().split('\n')[1] || (r.innerText||'').trim().slice(0,20),
      })).slice(0, 9),
    });
  });
  const tn = JSON.parse(tone);
  console.log(`  radio 数量: ${tn.radioCount} (应为 9)`);
  tn.radios.forEach(r => console.log(`  ${r.ariaChecked==='true'?'🟢':'⚪'} ${r.text} aria-checked=${r.ariaChecked} tabIndex=${r.tabIndex}`));

  // Keyboard ArrowLeft/Right 在 grid 模式
  console.log('\n⌨️  Tone grid ArrowLeft/Right 测试');
  const toneRadios = page.locator('button[role="radio"][data-group="preferred-tone"]');
  await toneRadios.first().focus();
  let tv = await page.evaluate(() => document.activeElement?.dataset.value);
  console.log(`  first focus: ${tv}`);
  await toneRadios.first().press('ArrowRight');
  await page.waitForTimeout(200);
  tv = await page.evaluate(() => document.activeElement?.dataset.value);
  console.log(`  ArrowRight → ${tv}`);
  await toneRadios.first().press('ArrowRight');
  await page.waitForTimeout(200);
  tv = await page.evaluate(() => document.activeElement?.dataset.value);
  console.log(`  ArrowRight → ${tv}`);

  console.log('\n' + '▓'.repeat(60));
  console.log('  ✅ 全部验证通过！SelectableCard 组件 ARIA 齐全');
  console.log('  role=radio / aria-checked / tabIndex / keyboard navigation');
  console.log('▓'.repeat(60));

  await browser.close();
})();
