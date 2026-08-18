// test/live.test.cjs - 线上部署验证（可选，默认不随 run.cjs 运行）
// 用法: node test/live.test.cjs [自定义URL]
// 验证 GitHub Pages 线上部署可用：页面加载、码表、键盘、布局切换无错误
const puppeteer = require('puppeteer-core');
const { chromiumPath } = require('./helpers.cjs');

const LIVE_URL = process.argv[2] || 'https://verf.github.io/typepadv.github.io/';

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });

  console.log('验证线上部署:', LIVE_URL);
  await page.goto(LIVE_URL, { waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4000));

  const result = await page.evaluate(() => ({
    title: document.title,
    kbKeys: document.querySelectorAll('.kb-key').length,
    chars: document.querySelectorAll('.char').length,
    codeHint: document.getElementById('code-hint')?.textContent.trim() || '',
    layoutOptions: [...document.querySelectorAll('#layout-select option')].map(o => o.textContent),
  }));
  console.log('结果:', JSON.stringify(result, null, 2));
  console.log('错误:', JSON.stringify(errors));

  let pass = 0, fail = 0;
  const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '  ✅ ' : '  ❌ ') + name); };
  check('页面标题正确', result.title.includes('跟打器'));
  check('虚拟键盘渲染', result.kbKeys > 0);
  check('跟打文本渲染', result.chars > 0);
  check('码表加载且编码正确', /ifk/.test(result.codeHint));
  check('布局选项含 QWERTY+Gallman', result.layoutOptions.length >= 2);
  check('无 JS/HTTP 错误', errors.length === 0);

  await browser.close();
  console.log(`\n线上验证: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('验证失败:', e.message); process.exit(1); });
