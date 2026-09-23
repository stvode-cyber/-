const { chromium } = require('playwright-core');
const fs = require('fs');

const ROUTES = [
  '#/settings/theme', '#/settings/tone', '#/settings/remote-access',
  '#/settings/ai-assistant', '#/settings/security', '#/settings/vault',
  '#/settings/backup', '#/settings/server', '#/settings/about',
];

(async () => {
  console.log('=== 连接 ===');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  let page = browser.contexts()[0].pages().find(p => p.url().includes('#/'));
  if (!page) { console.log('没找到页面'); await browser.close(); return; }

  await page.evaluate(() => {
    localStorage.setItem('aie_token', 'fake');
    localStorage.setItem('aie_user', JSON.stringify({ id:'1', username:'admin', role:'admin', nickname:'绿角犀管理员', onboarded:true }));
  });
  await page.route('**/api/**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({code:0,data:null}) }));
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForTimeout(2000);

  console.log('\n' + '='.repeat(60));
  console.log('  设置子页 DOM 实测报告');
  console.log('='.repeat(60));

  for (const hash of ROUTES) {
    await page.goto(page.url().replace(/#.*$/, hash));
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    const dom = await page.evaluate(() => {
      const sc = (el) => {
        const c = el.className;
        if (typeof c === 'string') return c;
        if (c && typeof c.baseVal === 'string') return c.baseVal;
        return '';
      };
      const labelOf = (el) => {
        for (let i = 0; i < 5; i++) {
          el = el.parentElement;
          if (!el) break;
          const t = el.innerText?.trim();
          if (t && t.length < 80) return t;
        }
        return '';
      };
      const swList = [...document.querySelectorAll('button,div,span,[role]')].filter(el => {
        const c = sc(el).toLowerCase();
        return /switch|toggle/.test(c) || el.getAttribute('role')==='switch' || el.getAttribute('aria-pressed')!==null || el.getAttribute('aria-checked')!==null;
      });
      return {
        route: location.hash,
        body: document.body?.innerText?.slice(0, 1200) || '(empty)',
        cb: [...document.querySelectorAll('input[type=checkbox]')].map(c => ({ checked:c.checked, label: labelOf(c), cls: sc(c).slice(0,40) })),
        rd: [...document.querySelectorAll('input[type=radio]')].map(r => ({ checked:r.checked, name:r.name, label: labelOf(r) })),
        sw: swList.map(el => ({ tag: el.tagName, role: el.getAttribute('role'), pressed: el.getAttribute('aria-pressed'), checked: el.getAttribute('aria-checked'), cls: sc(el).slice(0,50), text: (el.innerText||'').trim().slice(0,40) })),
        htmlSwCount: (document.body?.innerHTML?.match(/switch|toggle/gi) || []).length,
        inputs: [...document.querySelectorAll('input')].map(i => ({ t:i.type, ph:(i.placeholder||'').slice(0,30), v:(i.value||'').slice(0,20) })).filter(i => i.t !== 'hidden'),
        selects: [...document.querySelectorAll('select')].map(s => ({ n:s.name, opts:[...s.options].map(o=>o.text) })),
        headings: [...document.querySelectorAll('h1,h2,h3,h4')].map(h => h.innerText.trim()).filter(Boolean),
        bodyHasSettingText: /设置|Setting|偏好|开关|Switch|Toggle|Enable/i.test(document.body?.innerText || ''),
      };
    });

    const safeName = hash.replace('#/', '').replace(/\//g, '_');
    console.log(`\n🔍 ${hash}`);
    console.log(`  📄 文本: ${dom.body?.slice(0, 100)}`);
    console.log(`  📋 checkbox=${dom.cb.length}  🔘 radio=${dom.rd.length}  🔀 switch=${dom.sw.length}  ⌨️ input=${dom.inputs.length}  🔽 select=${dom.selects.length}  html switch/toggle=${dom.htmlSwCount}`);
    if (dom.headings.length) console.log(`  📂 标题: ${dom.headings.join(' | ')}`);

    dom.cb.forEach(c => console.log(`    📋 ${c.checked?'✅':'⬜'} ${c.label}`));
    dom.rd.forEach(r => console.log(`    🔘 ${r.checked?'🟢':'⚪'} ${r.label} (name=${r.name})`));
    dom.sw.forEach(s => console.log(`    🔀 <${s.tag}> role=${s.role} pressed=${s.pressed} checked=${s.checked} cls="${s.cls}" text="${s.text}"`));
    dom.inputs.forEach(i => console.log(`    ⌨️ type=${i.t} ph="${i.ph}" v="${i.v}"`));
    dom.selects.forEach(s => console.log(`    🔽 name=${s.n} opts=${s.opts?.join('|')}`));

    try {
      const cdp = await page.context().newCDPSession(page);
      const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`d:/源码存档/助理项目/助理项目/APP-AIE/gui-${safeName}.png`, Buffer.from(ss.data,'base64'));
    } catch {}
  }

  console.log('\n' + '='.repeat(60));
  await browser.close();
  console.log('完成!');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
