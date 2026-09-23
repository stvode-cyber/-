const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  console.log('=== 连接 Electron CDP ===');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('#/login'));
  if (!page) { console.log('没找到登录页'); await browser.close(); return; }
  console.log('Found:', page.url().slice(-40));

  // 拦截所有后端 API
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    const path = new URL(url).pathname;

    if (path.includes('/auth/login') || path.includes('/auth/register')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          code: 0, message: 'ok',
          data: {
            token: 'eyJhbGciOiJIUzI1NiJ9.fake.jwt',
            user: { id: '1', username: 'admin', role: 'admin', nickname: '绿角犀管理员', onboarded: true }
          }
        })
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data: null }) });
  });
  console.log('✅ API 拦截已就位');

  // === 直接注入 aie_token + aie_user 让 auth store 通过 ===
  console.log('\n=== 注入 auth ===');
  await page.evaluate(() => {
    localStorage.setItem('aie_token', 'fake-jwt-token-for-test');
    localStorage.setItem('aie_user', JSON.stringify({
      id: '1', username: 'admin', role: 'admin',
      nickname: '绿角犀管理员', onboarded: true,
      preferredTone: '温柔', aiNickname: '小绿'
    }));
  });
  console.log('✅ 设了 aie_token + aie_user');

  // 刷新页面（auth store init() 从 localStorage 恢复）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  console.log('刷新后 URL:', page.url().slice(-40));

  // 确认不在登录页了
  const curRoute = await page.evaluate(() => location.hash);
  console.log('Route:', curRoute);
  if (curRoute.includes('#/login')) {
    console.log('❌ 还在登录页，auth 没通过！');
    await browser.close(); return;
  }

  // === 跳设置页 ===
  console.log('\n=== 跳 /settings ===');
  await page.goto(page.url().replace(/#.*$/, '#/settings'));
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  console.log('设置页 URL:', page.url().slice(-40));

  // 等 React 渲染完
  await page.waitForTimeout(1000);

  // === DOM 深扒 ===
  console.log('\n=== DOM 分析 ===');
  const result = await page.evaluate(() => {
    try {
      const safeClass = (el) => {
        const c = el.className;
        if (typeof c === 'string') return c;
        if (c && typeof c.baseVal === 'string') return c.baseVal;
        return '';
      };
      const getLabel = (el) => {
        // 尝试从 parent 获取描述文字
        for (let i = 0; i < 4; i++) {
          const p = el.parentElement;
          if (!p) break;
          const txt = p.innerText?.trim();
          if (txt && txt.length < 100) return txt;
          el = p;
        }
        return '';
      };
      return JSON.stringify({
        route: location.hash,
        title: document.title,
        bodyFull: document.body?.innerText?.slice(0, 10000) || '(empty)',
        checkboxes: [...document.querySelectorAll('input[type=checkbox]')].map(c => ({
          checked: c.checked, label: getLabel(c).slice(0, 100), id: c.id, cls: safeClass(c).slice(0, 50),
        })),
        radios: [...document.querySelectorAll('input[type=radio]')].map(r => ({
          checked: r.checked, name: r.name, label: getLabel(r).slice(0, 100),
        })),
        switches: [...document.querySelectorAll('button,div,span,[role]')].filter(el => {
          const cls = safeClass(el).toLowerCase();
          return /switch|toggle/.test(cls) || el.getAttribute('role') === 'switch' || el.getAttribute('aria-pressed') !== null || el.getAttribute('aria-checked') !== null;
        }).map(el => ({
          text: (el.innerText || '').trim().slice(0, 60), tag: el.tagName,
          role: el.getAttribute('role'), pressed: el.getAttribute('aria-pressed'),
          checked: el.getAttribute('aria-checked'), cls: safeClass(el).slice(0, 60),
        })),
        toggleClassMatches: [...document.querySelectorAll('[class]')].filter(el => /switch|toggle/i.test(safeClass(el))).slice(0, 30).map(el => ({
          tag: el.tagName, cls: safeClass(el).slice(0, 80), text: (el.innerText || '').trim().slice(0, 60),
        })),
        inputs: [...document.querySelectorAll('input')].map(i => ({
          type: i.type, placeholder: (i.placeholder || '').slice(0, 40),
          value: (i.value || '').slice(0, 30), name: i.name, cls: safeClass(i).slice(0, 40),
        })),
        selects: [...document.querySelectorAll('select')].map(s => ({
          name: s.name, cls: safeClass(s).slice(0, 40), opts: [...s.options].map(o => o.text),
        })),
        headings: [...document.querySelectorAll('h1,h2,h3,h4')].map(h => h.innerText.trim()).filter(Boolean),
        buttons: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 60),
        allSwitchClasses: [...new Set([...document.querySelectorAll('*')].map(safeClass).filter(Boolean).flatMap(c => c.split(/\s+/)).filter(c => /switch|toggle/i.test(c)))].slice(0, 30),
        allSettingClasses: [...new Set([...document.querySelectorAll('*')].map(safeClass).filter(Boolean).flatMap(c => c.split(/\s+/)).filter(c => /setting|option|preference|form/i.test(c)))].slice(0, 30),
        htmlSwitchToggleCount: (document.body?.innerHTML?.match(/switch|toggle/gi) || []).length,
        htmlPreview: document.body?.innerHTML?.slice(0, 3000),
      });
    } catch (e) { return JSON.stringify({ error: e.message }); }
  });

  let p;
  try { p = JSON.parse(result); } catch { console.log('eval parse err:', result?.slice(0, 500)); process.exit(1); }
  if (p.error) { console.log('eval runtime err:', p.error); process.exit(1); }

  console.log('\n============================================');
  console.log('       设置页 (#/settings) GUI 实测报告');
  console.log('============================================');
  console.log('📍 Route:', p.route);
  console.log('🏷️  Title:', p.title);
  console.log('📂 Headings:', p.headings?.join(' | ') || '(无)');

  console.log('\n📋 Checkbox input[type=checkbox]:', p.checkboxes?.length || 0);
  p.checkboxes?.length === 0 && console.log('  ⚠️ 没有原生 checkbox input！开关可能是 div + CSS switch 实现');
  p.checkboxes?.forEach((c, i) => console.log(`  [${i}] ${c.checked ? '✅' : '⬜'} ${c.label}`));

  console.log('\n🔘 Radio input[type=radio]:', p.radios?.length || 0);
  p.radios?.forEach((r, i) => console.log(`  [${i}] ${r.checked ? '🟢' : '⚪'} name=${r.name} ${r.label}`));

  console.log('\n🔀 语义化 Switch/Toggle:', p.switches?.length || 0);
  p.switches?.length === 0 && console.log('  ⚠️ role=switch / aria-pressed / aria-checked 全部没找到 —— 可能不是语义化实现');
  p.switches?.forEach((s, i) => console.log(`  [${i}] <${s.tag}> role=${s.role} pressed=${s.pressed} checked=${s.checked} text="${s.text}"`));

  console.log('\n🎨 class 含 switch/toggle 关键字:', p.toggleClassMatches?.length || 0);
  p.toggleClassMatches?.forEach((c, i) => console.log(`  [${i}] <${c.tag}> cls="${c.cls}" text="${c.text}"`));

  console.log('\n🔧 switch 相关 class:', p.allSwitchClasses?.join(', ') || '(无)');
  console.log('⚙️  setting/form 相关 class:', p.allSettingClasses?.join(', ') || '(无)');
  console.log('📊 HTML switch/toggle 关键字命中:', p.htmlSwitchToggleCount, '处');

  console.log('\n⌨️ Inputs:', p.inputs?.length || 0);
  p.inputs?.forEach((i, k) => console.log(`  [${k}] type=${i.type} val="${i.value}" ph="${i.placeholder}" name=${i.name}`));

  console.log('\n🔽 Selects:', p.selects?.length || 0);
  p.selects?.forEach((s, k) => console.log(`  [${k}] name=${s.name} opts=${s.opts?.join('|')}`));

  console.log('\n🔲 Buttons:', p.buttons?.join(', '));

  console.log('\n📄 页面完整文本 (前 6000 字):');
  console.log('═════════════════════════════════════════');
  console.log(p.bodyFull?.slice(0, 6000));
  console.log('═════════════════════════════════════════');

  // 截图
  try {
    const cdp = await page.context().newCDPSession(page);
    const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('d:/源码存档/助理项目/助理项目/APP-AIE/gui-settings.png', Buffer.from(ss.data, 'base64'));
    console.log('\n✅ CDP 截图 → gui-settings.png');
  } catch (e) { console.log('⚠️ 截图:', e.message); }

  await browser.close();
  console.log('\n=== 测试完成 ===');
})().catch(e => { console.error('❌ FATAL:', e.message, e.stack?.slice(0, 300)); process.exit(1); });
