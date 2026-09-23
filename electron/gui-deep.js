const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];

  await page.evaluate(() => {
    localStorage.setItem('aie_token', 'fake');
    localStorage.setItem('aie_user', JSON.stringify({ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true }));
  });
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({code:0,data:null}) }));
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(1500);

  // 去 theme 页
  await page.goto(page.url().replace(/#.*$/, '#/settings/theme'));
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // 深扒 theme 页 DOM —— 找所有可点击元素 + 奇怪的 class
  const dom = await page.evaluate(() => {
    const sc = (el) => {
      const c = el.className;
      if (typeof c === 'string') return c;
      if (c && typeof c.baseVal === 'string') return c.baseVal;
      return '';
    };
    const themeTextEls = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      return (t === '浅色模式' || t === '深色模式' || t === '跟随系统') && el.children.length < 5;
    });
    return JSON.stringify({
      // 这三个主题卡片的实际元素
      themeCards: themeTextEls.map(el => ({
        tag: el.tagName,
        cls: sc(el).slice(0,80),
        parentTag: el.parentElement?.tagName,
        parentCls: sc(el.parentElement).slice(0,80),
        grandCls: sc(el.parentElement?.parentElement).slice(0,80),
        html: el.outerHTML?.slice(0,300),
      })),
      // 页面所有带 role 的元素
      allRoles: [...document.querySelectorAll('[role]')].map(el => ({ tag: el.tagName, role: el.getAttribute('role'), cls: sc(el).slice(0,40), text: (el.innerText||'').trim().slice(0,30) })).slice(0,30),
      // 页面所有 button
      allButtons: [...document.querySelectorAll('button')].map(b => ({ text: (b.innerText||'').trim().slice(0,30), cls: sc(b).slice(0,60), aria: b.getAttribute('aria-checked') || b.getAttribute('aria-pressed') || '' })),
      // 包含 active / selected / checked 关键字的 class
      activeClasses: [...new Set([...document.querySelectorAll('*')].map(sc).filter(Boolean).flatMap(c => c.split(/\s+/)).filter(c => /active|selected|checked|on|enable/i.test(c)))].slice(0,20),
      // 包含 card / item / option 的 class
      cardClasses: [...new Set([...document.querySelectorAll('*')].map(sc).filter(Boolean).flatMap(c => c.split(/\s+/)).filter(c => /card|item|option/i.test(c)))].slice(0,20),
      bodyHTMLPreview: document.body?.innerHTML?.slice(0, 5000),
    });
  });

  let d = JSON.parse(dom);
  console.log('=== theme 页 DOM 深扒 ===');
  console.log('\n🎨 主题卡片元素:');
  d.themeCards?.forEach((c,i) => console.log(`  [${i}] <${c.tag}> cls="${c.cls}"\n       parent=<${c.parentTag}> cls="${c.parentCls}"\n       ${c.html?.slice(0,200)}`));
  console.log('\n🎭 所有 role 元素:', d.allRoles?.length || 0);
  d.allRoles?.forEach(r => console.log(`  <${r.tag}> role=${r.role} text="${r.text}" cls="${r.cls}"`));
  console.log('\n🔘 所有 button:', d.allButtons?.length || 0);
  d.allButtons?.forEach(b => console.log(`  "${b.text}" cls="${b.cls}" aria=${b.aria}`));
  console.log('\n✅ active/selected/checked class:', d.activeClasses?.join(', '));
  console.log('🃏 card/item/option class:', d.cardClasses?.join(', '));

  console.log('\n\n=== 再看看 tone 页的 9 种语气 ===');
  await page.goto(page.url().replace(/#.*$/, '#/settings/tone'));
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const toneDom = await page.evaluate(() => {
    const sc = (el) => {
      const c = el.className;
      if (typeof c === 'string') return c;
      if (c && typeof c.baseVal === 'string') return c.baseVal;
      return '';
    };
    return JSON.stringify({
      // 找所有可点击的卡片（非 button 的可交互元素）
      clickables: [...document.querySelectorAll('[class*="card"], [class*="item"], [class*="option"], [class*="selectable"], [onclick], [tabindex], button')].map(el => ({
        tag: el.tagName, role: el.getAttribute('role'), text: (el.innerText||'').trim().slice(0,40), cls: sc(el).slice(0,60),
        ariaChecked: el.getAttribute('aria-checked'), ariaPressed: el.getAttribute('aria-pressed'),
        dataActive: el.getAttribute('data-active') || el.getAttribute('data-state'),
      })).slice(0, 40),
      bodyHTMLPreview: document.body?.innerHTML?.slice(0, 4000),
    });
  });
  let t = JSON.parse(toneDom);
  console.log('\n🎯 可点击元素:', t.clickables?.length || 0);
  t.clickables?.forEach(c => console.log(`  <${c.tag}> role=${c.role||''} aria-checked=${c.ariaChecked||''} aria-pressed=${c.ariaPressed||''} data-active=${c.dataActive||''} cls="${c.cls}" text="${c.text}"`));

  await browser.close();
})().catch(e => console.error(e.message, e.stack?.slice(0,200)));
