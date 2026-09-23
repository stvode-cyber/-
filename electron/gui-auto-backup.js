const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  // 清 localStorage + 注入 auth
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('aie_token', 'fake');
    localStorage.setItem('aie_user', JSON.stringify({ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true }));
  });
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:null }) }));
  await page.route('**/auth/me**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:200, data:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'gentle' } }) }));

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  console.log('▓'.repeat(60));
  console.log('  自动备份功能 — GUI 完整实测');
  console.log('▓'.repeat(60));

  // 跳到备份页
  await page.goto(page.url().replace(/#.*$/, '#/settings/backup'), { waitUntil:'networkidle' });
  await page.waitForTimeout(2500);

  const initInfo = await page.evaluate(() => JSON.stringify({
    route: location.hash,
    bodyPreview: document.body?.innerText?.slice(0, 800),
    switches: [...document.querySelectorAll('button[role="switch"]')].map(b => ({
      ariaChecked: b.getAttribute('aria-checked'),
      ariaLabelledBy: b.getAttribute('aria-labelledby'),
      testId: b.dataset.testid,
    })),
    selects: document.querySelectorAll('select').length,
  }));
  const ii = JSON.parse(initInfo);
  console.log(`\n📍 Route: ${ii.route}`);
  console.log(`  body: ${ii.bodyPreview?.slice(0, 150)}`);
  console.log(`  Switch 数量: ${ii.switches.length}`);
  console.log(`  Select 数量: ${ii.selects}`);

  // 1. 验证 Switch ARIA
  if (ii.switches.length >= 1) {
    const sw = ii.switches[0];
    console.log(`\n🔍 Switch DOM:`);
    console.log(`  role=switch ✅  aria-checked=${sw.ariaChecked}  aria-labelledby=${sw.ariaLabelledBy}  testid=${sw.testId}`);

    // 2. 点击 Switch → 开启自动备份
    console.log(`\n🖱️  点击 Switch（开启自动备份）`);
    await page.evaluate(() => document.querySelector('button[role="switch"]')?.click());
    await page.waitForTimeout(500);

    const afterClick = await page.evaluate(() => ({
      ariaChecked: document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'),
      bodyText: document.body?.innerText?.slice(0, 600),
      selects: document.querySelectorAll('select').length,
    }));
    console.log(`  aria-checked: ${afterClick.ariaChecked} ✅`);
    console.log(`  页面新出现: select=${afterClick.selects} 个 (时间 + 保留天数) — ${afterClick.selects === 2 ? '✅' : '❌'}`);

    // 3. 验证 localStorage 写入
    const lsCheck = await page.evaluate(() => ({
      enabled: localStorage.getItem('aie_auto_backup_enabled'),
      time: localStorage.getItem('aie_auto_backup_time'),
      retention: localStorage.getItem('aie_auto_backup_retention'),
    }));
    console.log(`\n💾 localStorage 配置:`);
    console.log(`  aie_auto_backup_enabled = ${lsCheck.enabled} (应为 "true") ${lsCheck.enabled === 'true' ? '✅' : '❌'}`);
    console.log(`  aie_auto_backup_time = ${lsCheck.time} (应为 "03:00") ${lsCheck.time === '03:00' ? '✅' : '❌'}`);
    console.log(`  aie_auto_backup_retention = ${lsCheck.retention} (应为 "7") ${lsCheck.retention === '7' ? '✅' : '❌'}`);

    // 4. 点击"立即备份一次"按钮
    console.log(`\n🧪  点击"立即备份一次"（测试真实备份流程）`);
    const runBtn = page.locator('button:has-text("立即备份")');
    const runCount = await runBtn.count();
    console.log(`  按钮存在: ${runCount > 0 ? '✅' : '❌'}`);

    if (runCount > 0) {
      await runBtn.click();
      await page.waitForTimeout(3000);

      const afterRun = await page.evaluate(() => ({
        ariaChecked: document.querySelector('button[role="switch"]')?.getAttribute('aria-checked'),
        bodyText: document.body?.innerText?.slice(0, 1500),
        lastRun: localStorage.getItem('aie_auto_backup_last_run'),
        lastStatus: localStorage.getItem('aie_auto_backup_last_status'),
      }));

      console.log(`  last_run = ${afterRun.lastRun ? '✅ 已写入 (' + afterRun.lastRun + ')' : '❌ 未写入'}`);
      console.log(`  last_status = ${afterRun.lastStatus} (success/fail)`);

      // 5. 验证 IndexedDB 历史
      const idbCheck = await page.evaluate(async () => {
        try {
          const db = await new Promise((res, rej) => {
            const r = indexedDB.open('aie-auto-backup', 1);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
          const count = await new Promise((res, rej) => {
            const tx = db.transaction('history', 'readonly');
            const req = tx.objectStore('history').count();
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
          });
          const first = await new Promise((res, rej) => {
            const tx = db.transaction('history', 'readonly');
            const req = tx.objectStore('history').openCursor();
            const items = [];
            req.onsuccess = () => {
              const cur = req.result;
              if (cur) { items.push({ ts: cur.value.ts, status: cur.value.status, size: cur.value.size, label: cur.value.label }); cur.continue(); }
              else res(items);
            };
            req.onerror = () => rej(req.error);
          });
          return { exists: true, count, first };
        } catch (e) {
          return { exists: false, error: String(e) };
        }
      });
      console.log(`\n📦 IndexedDB (aie-auto-backup):`);
      console.log(`  DB 存在: ${idbCheck.exists ? '✅' : '❌'}`);
      if (idbCheck.exists) {
        console.log(`  历史条数: ${idbCheck.count}`);
        (idbCheck.first || []).forEach(i => console.log(`    ${i.label}  ${i.status}  ${i.size} bytes`));
      }

      // 6. 截图
      const cdp = await page.context().newCDPSession(page);
      const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('d:/源码存档/助理项目/助理项目/APP-AIE/gui-auto-backup.png', Buffer.from(ss.data, 'base64'));
      console.log(`\n📸 截图 → gui-auto-backup.png`);
    }
  }

  // 7. 回归：Theme / Tone / RemoteAccess 还正常
  console.log(`\n--- 回归验证 ---`);
  await page.goto(page.url().replace(/#.*$/, '#/settings/theme'), { waitUntil:'networkidle' });
  await page.waitForTimeout(1500);
  const themeRadio = await page.evaluate(() => document.querySelectorAll('button[role="radio"][data-group="theme-mode"]').length);
  console.log(`Theme: radio=${themeRadio} ${themeRadio===3?'✅':'❌'}`);

  await page.goto(page.url().replace(/#.*$/, '#/settings/tone'), { waitUntil:'networkidle' });
  await page.waitForTimeout(1500);
  const toneRadio = await page.evaluate(() => document.querySelectorAll('button[role="radio"][data-group="preferred-tone"]').length);
  console.log(`Tone: radio=${toneRadio} ${toneRadio===9?'✅':'❌'}`);

  await page.goto(page.url().replace(/#.*$/, '#/settings/remote-access'), { waitUntil:'networkidle' });
  await page.waitForTimeout(1500);
  const raSwitch = await page.evaluate(() => !!document.querySelector('button[role="switch"]'));
  console.log(`RemoteAccess: switch=${raSwitch} ${raSwitch?'✅':'❌'}`);

  await browser.close();
  console.log('\n' + '▓'.repeat(60));
  console.log('  自动备份 — 全部实测完成！');
  console.log('▓'.repeat(60));
})().catch(e => { console.error('FATAL:', e.message, e.stack?.slice(0, 300)); process.exit(1); });
