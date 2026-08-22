// test/gallming.test.cjs - 灵铭（gallming）内置方案浏览器集成测试
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
  // 当前字「的」→ 正式版简码 e、全码 vbsl（不翻译，原样）
  check('五码灵铭提示原样显示（的→e, vbsl）', /的：e, vbsl/.test(lingState.hint), lingState.hint);
  check('五码灵铭拆分提示（的→白勹丶/VbSL）', lingState.hint.includes('拆') && lingState.hint.includes('VbSL'), lingState.hint);

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
  // p 键应显示正式版分布
  const pKeyRoots = await page.$$eval('.kb-key', (els) => {
    const p = els.find((k) => k.dataset.cap === 'p');
    return p ? (p.querySelector('.zigen-wrap') ? p.querySelector('.zigen-wrap').textContent : '') : '';
  });
  check('Gallman p 键含正式版字根（子方申贝）', ['子','方','申','贝'].every((root) => pKeyRoots.includes(root)), pKeyRoots.slice(0, 60));
  // 纯规范声码：成字根 人=Kre，构件根 亻=Ke。
  const kKeyRoots = await page.$$eval('.kb-key', (els) => {
    const k = els.find((item) => item.dataset.cap === 'k');
    return k && k.querySelector('.zigen-wrap')
      ? [...k.querySelectorAll('.zigen-item')].map((e) => ({ root: e.dataset.root, suffix: e.dataset.small }))
      : '';
  });
  check('成字根保留规范声码、构件根省略声码',
    kKeyRoots.some((x) => x.root === '人' && x.suffix === 're') && kKeyRoots.some((x) => x.root === '亻' && x.suffix === 'e'), JSON.stringify(kKeyRoots));
  const formalGlyphs = await page.$$eval('.zigen-item', (els) => els.map((e) => e.dataset.root));
  check('结构根使用 Yuniversus 单字形（{乍下}→U+F502）', formalGlyphs.includes('\uF502') && !formalGlyphs.includes('{乍下}'));
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
  // 提示仍原样（Gallman 布局 + 五码灵铭 → 不翻译）
  check('五码灵铭+Gallman 提示仍原样（的→e, vbsl）', /的：e, vbsl/.test(gallmanState.hint), gallmanState.hint);
  // 多键高亮：灵铭「的」= e, vbsl → 主键 e，额外键 v/b/s/l
  const targetKeys = await page.$$eval('.kb-key.target', (els) => els.map((e) => e.dataset.cap));
  const extraKeys = await page.$$eval('.kb-key.target-extra', (els) => els.map((e) => e.dataset.cap));
  console.log('灵铭目标键:', JSON.stringify(targetKeys), '额外键:', JSON.stringify(extraKeys));
  check('灵铭目标主键为 e', targetKeys.includes('e'), JSON.stringify(targetKeys));
  check('五码灵铭额外键高亮 v/b/s/l', ['v','b','s','l'].every((k) => extraKeys.includes(k)), JSON.stringify(extraKeys));
  // 字根高亮：的 拆分「白 勹 丶」→ 白(v键)、勹(s键)、丶(l键)
  const activeRoots = await page.$$eval('.zigen-item.active-root', (els) =>
    els.map((el) => el.closest('.kb-key').dataset.cap + ':' + el.querySelector('.zigen-font').textContent)
  );
  console.log('灵铭字根高亮:', JSON.stringify(activeRoots));
  check('五码灵铭字根条目高亮（白/勹/丶）', ['v:白','s:勹','l:丶'].every((s) => activeRoots.includes(s)), JSON.stringify(activeRoots));

  async function selectCustomText(text) {
    await page.evaluate((value) => {
      document.getElementById('text-import-area').value = value;
      document.getElementById('btn-save-text').click();
    }, text);
    await new Promise((r) => setTimeout(r, 600));
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.text-item')].filter((el) => el.textContent.includes('自定义'));
      items.at(-1)?.click();
    });
    await new Promise((r) => setTimeout(r, 400));
  }

  // 结构根 tokenizer + 正式身份候选：年={乞上} 㐄 / TRa。
  await selectCustomText('年');
  const yearState = await page.evaluate(() => ({
    target: [...document.querySelectorAll('.kb-key.target,.kb-key.target-extra')].map((e) => e.dataset.cap),
    active: [...document.querySelectorAll('.zigen-item.active-root')].map((e) => ({
      key: e.closest('.kb-key').dataset.cap, root: e.dataset.root,
    })),
  }));
  check('五码年按全码高亮 T/R/A 键', ['t', 'r', 'a'].every((key) => yearState.target.includes(key)), JSON.stringify(yearState.target));
  check('年精确高亮 {乞上} 的 Yuniversus U+F600 与 㐄',
    yearState.active.some((x) => x.key === 't' && x.root === '\uF600') && yearState.active.some((x) => x.key === 'r' && x.root === '㐄'), JSON.stringify(yearState.active));

  const reviewedRoots = await page.$$eval('.zigen-item', (els) => els.map((e) => e.dataset.root));
  check('正式版基础根已渲染', ['⺈','冫','卄','ㄗ','亻','扌'].every((root) => reviewedRoots.includes(root)));
  await selectCustomText('久');
  let reviewedActive = await page.$$eval('.zigen-item.active-root', (els) => els.map((e) => `${e.closest('.kb-key').dataset.cap}:${e.dataset.root}`));
  check('五码正式根可真实高亮（久→⺈）', reviewedActive.includes('l:⺈'), JSON.stringify(reviewedActive));
  await selectCustomText('其');
  const qiState = await page.evaluate(() => ({
    hint: document.getElementById('code-hint').textContent.trim(),
    target: [...document.querySelectorAll('.kb-key.target,.kb-key.target-extra')].map((e) => e.dataset.cap),
    active: [...document.querySelectorAll('.zigen-item.active-root')]
      .map((e) => `${e.closest('.kb-key').dataset.cap}:${e.dataset.root}`),
  }));
  check('规范声码关键例（其→kqi）', /其：kqi/.test(qiState.hint), qiState.hint);
  check('五码其高亮 k/q/i 键', ['k', 'q', 'i'].every((key) => qiState.target.includes(key)), JSON.stringify(qiState.target));
  check('五码其精确高亮字根图 k/其', qiState.active.includes('k:其'), JSON.stringify(qiState.active));

  // 结构根必须按正式键位精确匹配，不能只亮大码而不亮字形。
  await selectCustomText('乍');
  const structuralActive = await page.$$eval('.zigen-item.active-root', (els) =>
    els.map((e) => `${e.closest('.kb-key').dataset.cap}:${e.dataset.root}`));
  check('乍精确高亮 {乞上}/{乍下} 两个 Yuniversus 字形',
    structuralActive.includes('t:\uF600') && structuralActive.includes('w:\uF502'), JSON.stringify(structuralActive));

  await selectCustomText('的');

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
  const starCandidateLeak = await page.$$eval('.zigen-item.active-root', (els) => els.some((e) => e.dataset.root === '\uF502'));
  check('星陈不使用 Gallming 候选身份', starCandidateLeak === false);

  // 快速切换时，较早 Gallming 请求完成也不得覆盖当前星陈字根。
  await page.select('#codetable-select', 'ling-builtin');
  await page.select('#codetable-select', 'star-builtin');
  await new Promise((r) => setTimeout(r, 1200));
  const rapidSwitch = await page.evaluate(() => ({
    scheme: document.getElementById('codetable-select').value,
    keys: [...document.querySelectorAll('.zigen-big')].length,
    // 星陈官方字根表已知缺 亻，可作为灵铭请求是否越代回写的区分标记。
    gallmingOnly: [...document.querySelectorAll('.zigen-item')].some((e) => e.dataset.root === '亻'),
  }));
  check('快速切方案保持星陈字根原子生效', rapidSwitch.scheme === 'star-builtin' && rapidSwitch.keys === 25 && !rapidSwitch.gallmingOnly, JSON.stringify(rapidSwitch));

  check('无 JS 错误', errors.length === 0, JSON.stringify(errors));

  await page.screenshot({ path: 'test/artifacts/gallming.png', fullPage: false });
  await browser.close();
  console.log(`\n灵铭集成测试: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('灵铭集成测试异常:', e);
  process.exit(1);
});
