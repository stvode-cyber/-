const { chromium } = require('playwright-core');
const fs = require('fs');

const CHECK_ROUTES = [
  { hash: '#/settings/theme',          label: '主题模式' },
  { hash: '#/settings/tone',           label: 'AI 语气偏好' },
  { hash: '#/settings/remote-access',  label: '远程访问' },
  { hash: '#/settings/ai-assistant',   label: 'AI 助理设定' },
  { hash: '#/settings/security',       label: '安全中心' },
  { hash: '#/settings/vault',          label: 'AI 记忆库' },
  { hash: '#/settings/backup',         label: '数据备份' },
  { hash: '#/settings/server',         label: '服务器设置' },
];

(async () => {
  console.log('=== 连接 ===');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  // 只拦截 auth（login 后端未配置云端认证返回 500），其他 API 放行
  await page.route('**/api/v1/auth/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/login') || path.includes('/me')) {
      return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ code:0, data:{ token:'fake-jwt', user:{ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'温柔' } } }) });
    }
    route.continue();
  });

  await page.evaluate(() => {
    localStorage.setItem('aie_token', 'fake');
    localStorage.setItem('aie_user', JSON.stringify({ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true, preferredTone:'温柔' }));
  });
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  console.log('\n' + '▓'.repeat(70));
  console.log('  绿角犀 设置页 GUI 实测 — 完整 DOM 报告');
  console.log('  后端 API 放行（除 auth 伪造登录成功）');
  console.log('▓'.repeat(70));

  for (const r of CHECK_ROUTES) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📍 ${r.label} ${r.hash}`);
    console.log('─'.repeat(70));

    await page.goto(page.url().replace(/#.*$/, r.hash));
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const sc = (el) => { const c = el.className; if (typeof c==='string') return c; if (c&&typeof c.baseVal==='string') return c.baseVal; return ''; };
      return JSON.stringify({
        route: location.hash,
        title: document.title,
        headings: [...document.querySelectorAll('h1,h2,h3,h4')].map(h => h.innerText.trim()).filter(Boolean),
        bodyText: document.body?.innerText?.slice(0, 2000) || '(empty)',
        // 原生控件
        cb: document.querySelectorAll('input[type=checkbox]').length,
        rd: document.querySelectorAll('input[type=radio]').length,
        swInput: document.querySelectorAll('input[type=switch]').length,
        // 语义化 ARIA 控件
        roleSwitch: document.querySelectorAll('[role="switch"]').length,
        roleRadio: document.querySelectorAll('[role="radio"]').length,
        ariaChecked: document.querySelectorAll('[aria-checked]').length,
        ariaPressed: document.querySelectorAll('[aria-pressed]').length,
        // button 卡片（项目里的主实现方式）
        buttons: [...document.querySelectorAll('button')].map(b => ({
          text: (b.innerText||'').trim().slice(0,50),
          cls: sc(b).slice(0,80),
          ariaChecked: b.getAttribute('aria-checked'),
          ariaPressed: b.getAttribute('aria-pressed'),
          disabled: b.disabled,
          selectedByClass: sc(b).match(/active|selected|checked|primary|border-primary/i) !== null,
        })).filter(b => b.text && b.text.length > 1 && b.text.length < 60).slice(0, 30),
        // 所有可交互 button 的选中态判断
        buttonSelectedStates: [...document.querySelectorAll('button')].filter(b => {
          const t = (b.innerText||'').trim();
          return t && t.length > 2 && t.length < 40 && b.querySelector('svg, [class*="icon"], span, div');
        }).slice(0, 20).map(b => {
          const t = (b.innerText||'').trim().split('\n')[0];
          const cls = sc(b);
          const isSelected = /primary|active|selected|checked/i.test(cls);
          return { text:t, selected:isSelected, cls:cls.slice(0,60) };
        }),
        // 错误状态
        hasError: /错误|失败|error|fail/i.test(document.body?.innerText || ''),
        hasLoading: document.body?.innerText?.includes('加载中') || false,
      });
    });

    let d; try { d = JSON.parse(data); } catch { continue; }
    if (d.hasError) console.log('  ⚠️ 页面有错误/失败状态（可能 API 返回了非预期数据）');
    if (d.hasLoading) console.log('  ⏳ 仍在加载中...');
    console.log(`  📂 标题: ${d.headings?.join(' > ') || '(无)'}`);
    console.log(`  📋 checkbox:${d.cb} 🔘 radio:${d.rd} switch-input:${d.swInput} role=switch:${d.roleSwitch} role=radio:${d.roleRadio} aria-checked:${d.ariaChecked} aria-pressed:${d.ariaPressed}`);
    console.log(`  📄 文本: ${d.bodyText?.slice(0, 150) || '(empty)'}`);
    console.log(`  🎯 主要 button 卡片 (selected=含 active/selected/checked/primary class):`);
    d.buttonSelectedStates?.forEach(b => console.log(`    ${b.selected ? '🟢' : '⚪'} "${b.text}"  cls="${b.cls?.slice(0, 50)}"`));

    try {
      const cdp = await page.context().newCDPSession(page);
      const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`d:/源码存档/助理项目/助理项目/APP-AIE/gui-${r.hash.replace('#/','').replace(/\//g,'_')}.png`, Buffer.from(ss.data,'base64'));
    } catch {}
  }

  console.log('\n' + '▓'.repeat(70));
  console.log('  📊 GUI 实测总结');
  console.log('▓'.repeat(70));

  // 汇总: 所有路由的控件统计
  const summary = await page.evaluate(async () => {
    const routes = ['#/settings/theme','#/settings/tone','#/settings/remote-access','#/settings/ai-assistant','#/settings/security','#/settings/vault','#/settings/backup','#/settings/server'];
    const results = [];
    for (const r of routes) {
      location.hash = r;
      await new Promise(res => setTimeout(res, 1500));
      results.push({
        hash: r,
        cb: document.querySelectorAll('input[type=checkbox]').length,
        rd: document.querySelectorAll('input[type=radio]').length,
        rlSwitch: document.querySelectorAll('[role=switch]').length,
        rlRadio: document.querySelectorAll('[role=radio]').length,
        ariaChecked: document.querySelectorAll('[aria-checked]').length,
        ariaPressed: document.querySelectorAll('[aria-pressed]').length,
        err: /错误|失败|error/i.test(document.body?.innerText || ''),
        btnsWithText: [...document.querySelectorAll('button')].filter(b => { const t=(b.innerText||'').trim(); return t.length>2 && t.length<40; }).length,
      });
    }
    return JSON.stringify(results);
  });
  const sum = JSON.parse(summary);
  console.log(`\n  ${'路由'.padEnd(25)} ${'checkbox'.padStart(8)} ${'radio'.padStart(6)} ${'role=switch'.padStart(11)} ${'role=radio'.padStart(10)} ${'aria-checked'.padStart(12)} ${'aria-pressed'.padStart(13)} ${'error?'.padStart(7)} ${'text-btn'.padStart(8)}`);
  console.log('  ' + '─'.repeat(100));
  sum.forEach(s => {
    console.log(`  ${s.hash.padEnd(25)} ${String(s.cb).padStart(8)} ${String(s.rd).padStart(6)} ${String(s.rlSwitch).padStart(11)} ${String(s.rlRadio).padStart(10)} ${String(s.ariaChecked).padStart(12)} ${String(s.ariaPressed).padStart(13)} ${String(s.err?'❌':'').padStart(7)} ${String(s.btnsWithText).padStart(8)}`);
  });

  const totals = sum.reduce((acc, s) => {
    acc.cb += s.cb; acc.rd += s.rd; acc.sw += s.rlSwitch; acc.ra += s.rlRadio;
    return acc;
  }, { cb:0, rd:0, sw:0, ra:0 });

  console.log(`\n  总计: checkbox=${totals.cb} radio=${totals.rd} role=switch=${totals.sw} role=radio=${totals.ra}`);
  if (totals.cb + totals.rd + totals.sw + totals.ra === 0) {
    console.log('  🔴 设置页 **完全没有原生 checkbox / radio / 语义化 switch / 语义化 radio 控件**！');
    console.log('  → 所有设置项都用 <button> + CSS class 的方式实现，无障碍完全缺失');
  }

  await browser.close();
  console.log('\n完成!');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
