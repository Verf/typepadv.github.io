// test/lingming.test.cjs - 灵铭内置方案浏览器集成测试
// 验证：
//   1. 码表下拉含灵铭
//   2. 切灵铭后：提示显示 Gallman 原生编码（不翻译）、翻译开关自动关
//   3. 拆分提示用灵铭拆分表
//   4. 键盘字根按 Gallman 键帽直配渲染
//   5. 打开翻译开关 + QWERTY 布局 → 反向翻译
//   6. 切回星陈：翻译开关恢复开、提示恢复星陈编码

const puppeteer = require('puppeteer-core');
const { chromiumPath, collectErrors } = require('./helpers.cjs');

const URL = 'http://localhost:4173/index.html';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: chromiumPath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 }); // 桌面视口（字根网格自适应依赖键宽）
  const errors = collectErrors(page);
  await page.goto(URL, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 3500)); // 等码表+字根

  let pass = 0, fail = 0;
  function check(name, cond, detail = '') {
    if (cond) { pass++; console.log('  ✅', name); }
    else { fail++; console.error('  ❌', name, detail); }
  }

  // ---- 0. 方案下拉含灵铭 ----
  const options = await page.$$eval('#codetable-select option', (els) => els.map((o) => o.value));
  check('码表下拉含 star-builtin + ling-builtin', options.includes('star-builtin') && options.includes('ling-builtin'), JSON.stringify(options));

  // ---- 1. 切到灵铭 ----
  await page.select('#codetable-select', 'ling-builtin');
  await new Promise((r) => setTimeout(r, 1500)); // 等码表+拆分+字根
  const lingState = await page.evaluate(() => ({
    hint: document.getElementById('code-hint').textContent.trim(),
    translateChecked: document.getElementById('translate-code').checked,
    codetable: document.getElementById('codetable-select').value,
    layout: document.getElementById('layout-select').value,
  }));
  console.log('灵铭初始:', JSON.stringify(lingState));
  check('切换后方案为 ling-builtin', lingState.codetable === 'ling-builtin');
  check('翻译开关自动关闭（灵铭默认）', lingState.translateChecked === false, 'checked=' + lingState.translateChecked);
  // 当前字「的」→ 灵铭编码 e（不翻译，原样）
  check('灵铭提示原样显示（的→e）', /的：e, fbxc/.test(lingState.hint), lingState.hint);
  check('灵铭拆分提示（的→白勹丶FbXC）', lingState.hint.includes('拆') && lingState.hint.includes('FbXC'), lingState.hint);

  // ---- 2. 灵铭 + Gallman 布局：字根按键帽直配 ----
  await page.select('#layout-select', 'gallman');
  await new Promise((r) => setTimeout(r, 500));
  const gallmanState = await page.evaluate(() => ({
    hint: document.getElementById('code-hint').textContent.trim(),
    zigenKeys: [...document.querySelectorAll('.zigen-big')].map((e) => e.textContent.trim()),
  }));
  console.log('灵铭+Gallman:', JSON.stringify(gallmanState));
  // Gallman 键盘上显示灵铭字根（20 个大码键）
  check('Gallman 键盘渲染灵铭字根（20键）', gallmanState.zigenKeys.length === 20, 'count=' + gallmanState.zigenKeys.length);
  // p 键应显示字根（旧G族）
  const pKeyRoots = await page.$$eval('.kb-key', (els) => {
    const p = els.find((k) => k.dataset.cap === 'p');
    return p ? (p.querySelector('.zigen-wrap') ? p.querySelector('.zigen-wrap').textContent : '') : '';
  });
  check('Gallman p 键含字根（电丰艮弓…）', pKeyRoots.includes('电') && pKeyRoots.includes('鱼'), pKeyRoots.slice(0, 60));
  // 回归：m 键（旧 J 族）应含单人旁 亻（「他」拆 Mwe，亻 需在 m 键字根表）
  const mKeyRoots = await page.$$eval('.kb-key', (els) => {
    const m = els.find((k) => k.dataset.cap === 'm');
    return m && m.querySelector('.zigen-wrap')
      ? [...m.querySelectorAll('.zigen-font')].map((e) => e.textContent).join('')
      : '';
  });
  check('Gallman m 键含单人旁 亻（他→Mwe）', mKeyRoots.includes('亻'), 'm 键字根: ' + mKeyRoots.slice(0, 60));
  // 字根网格列数自适应（键宽 83px → 5 列），字根文字不溢出格子
  const gridCheck = await page.evaluate(() => {
    const key = [...document.querySelectorAll('.kb-key')].find((k) => k.dataset.cap === 'f');
    if (!key || !key.querySelector('.zigen-grid')) return { missing: true };
    const grid = key.querySelector('.zigen-grid');
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const items = [...key.querySelectorAll('.zigen-item')];
    const overflow = items.filter((it) => {
      const f = it.querySelector('.zigen-font');
      const fr = f.getBoundingClientRect();
      const ir = it.getBoundingClientRect();
      return fr.right > ir.right + 1 || fr.left < ir.left - 1;
    }).length;
    return { cols, total: items.length, overflow };
  });
  console.log('字根网格检查:', JSON.stringify(gridCheck));
  check('灵铭字根网格列数自适应（3-6 列）', gridCheck.cols >= 3 && gridCheck.cols <= 6, 'cols=' + gridCheck.cols);
  check('灵铭字根无文字溢出重叠', gridCheck.overflow === 0, 'overflow=' + gridCheck.overflow);
  // 提示仍原样（Gallman 布局 + 灵铭 → 不翻译）
  check('灵铭+Gallman 提示仍原样（的→e）', /的：e, fbxc/.test(gallmanState.hint), gallmanState.hint);

  // ---- 3. 灵铭 + QWERTY + 手动开翻译 → 反向翻译 ----
  await page.select('#layout-select', 'qwerty');
  await page.evaluate(() => {
    const cb = document.getElementById('translate-code');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const qwertyTranslated = await page.evaluate(() => document.getElementById('code-hint').textContent.trim());
  console.log('灵铭+QWERTY+翻译开:', JSON.stringify(qwertyTranslated));
  // 的→e（韵码 e 原样）? 翻译映射 gallman→qwerty 反向：e→l（gallmanMap e→l 逆）
  // 的 简码 e（一码字韵码）→ 反向翻译 e→l
  check('灵铭+QWERTY 翻译开：的简码 e→l', /的：l,/.test(qwertyTranslated), qwertyTranslated);

  // ---- 4. 切回星陈：翻译开关恢复开、字根恢复星陈 ----
  await page.select('#codetable-select', 'star-builtin');
  await new Promise((r) => setTimeout(r, 1500));
  const starState = await page.evaluate(() => ({
    hint: document.getElementById('code-hint').textContent.trim(),
    translateChecked: document.getElementById('translate-code').checked,
    zigenKeys: [...document.querySelectorAll('.zigen-big')].map((e) => e.textContent.trim()),
  }));
  console.log('切回星陈:', JSON.stringify(starState));
  check('切回星陈翻译开关恢复开', starState.translateChecked === true);
  // 星陈 + QWERTY：不翻译（qwerty→qwerty null），的→d
  check('星陈提示恢复（的→d）', /的：d,/.test(starState.hint), starState.hint);
  // 星陈字根 25 键（QWERTY A-Y，Z 为空键）
  check('星陈字根恢复（QWERTY A-Y 25 键）', starState.zigenKeys.length === 25, 'count=' + starState.zigenKeys.length);

  check('无 JS 错误', errors.length === 0, JSON.stringify(errors));

  await page.screenshot({ path: 'test/artifacts/lingming.png', fullPage: false });
  await browser.close();
  console.log(`\n灵铭集成测试: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('灵铭集成测试异常:', e);
  process.exit(1);
});
