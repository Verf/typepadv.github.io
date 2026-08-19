// test/integration.test.cjs - 浏览器集成测试（puppeteer-core）
// 走完整跟打流程：加载应用 → 导入自定义文本 → 选 Gallman 布局 → 输入上屏文字 → 验证
//   1. 码表提示显示正确编码（Gallman 翻译后）
//   2. 打字判定正确（上屏文字 vs 原文）
//   3. 统计面板实时更新
//   4. 完成时历史记录写入
//   5. 常用字练习入口可用

const puppeteer = require('puppeteer-core');
const { chromiumPath, collectErrors } = require('./helpers.cjs');

const URL = 'http://localhost:4173/index.html';
const TEST_TEXT = '宇浩星陈跟打测试';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: chromiumPath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const errors = collectErrors(page);
  await page.goto(URL, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 3000)); // 等码表

  let pass = 0, fail = 0;
  function check(name, cond, detail = '') {
    if (cond) { pass++; console.log('  ✅', name); }
    else { fail++; console.error('  ❌', name, detail); }
  }

  // ---- 0. 常用字练习入口存在 ----
  const commonChips = await page.$$eval('.text-item', (els) =>
    els.map((e) => e.textContent).filter((t) => t.includes('常见字') || t.includes('3500'))
  );
  check('常用字练习入口（4档）', commonChips.length === 4, JSON.stringify(commonChips));

  // ---- 1. 导入自定义短文本作为跟打对象 ----
  await page.evaluate((text) => {
    const fp = document.getElementById('text-import-area');
    fp.value = text;
    document.getElementById('btn-save-text').click();
  }, TEST_TEXT);
  await new Promise((r) => setTimeout(r, 300));
  // 点击新导入的文本 chip
  await page.evaluate((text) => {
    const chip = [...document.querySelectorAll('.text-item')].find((c) => c.textContent.includes('自定义'));
    if (chip) chip.click();
  }, TEST_TEXT);
  await new Promise((r) => setTimeout(r, 300));

  const initText = await page.evaluate(() => ({
    chars: document.querySelectorAll('.char').length,
    hint: document.getElementById('code-hint').textContent.trim(),
  }));
  console.log('导入后文本:', JSON.stringify(initText));
  check('自定义文本已加载（8字）', initText.chars === 8, 'chars=' + initText.chars);
  // 第一个字「宇」→ 编码 ifk
  check('码表提示「宇」ifk', /ifk/.test(initText.hint), initText.hint);

  // ---- 2. 切换 Gallman 布局 ----
  await page.select('#layout-select', 'gallman');
  await new Promise((r) => setTimeout(r, 300));
  const gallmanHint = await page.$eval('#code-hint', (el) => el.textContent.trim());
  console.log('Gallman 码表提示:', gallmanHint);
  // ifk → i f k 查 KEY_MAP：i→o, f→s, k→a → "osa"
  check('Gallman 翻译后提示为 osa', gallmanHint.includes('osa'), gallmanHint);

  const kbCaps = await page.$$eval('.kb-key', (els) => els.map((e) => e.dataset.cap));
  check('Gallman 键盘渲染 30 键', kbCaps.length === 30, 'count=' + kbCaps.length);
  // 多键高亮：「宇」= ifk, ifkc → 翻译 osa, osac：主键 o，额外键 s/a/c
  const targetKeys = await page.$$eval('.kb-key.target', (els) => els.map((e) => e.dataset.cap));
  const extraKeys = await page.$$eval('.kb-key.target-extra', (els) => els.map((e) => e.dataset.cap));
  console.log('目标键:', JSON.stringify(targetKeys), '额外键:', JSON.stringify(extraKeys));
  check('目标主键为 o（宇→osa 首键 o）', targetKeys.includes('o'), JSON.stringify(targetKeys));
  check('额外键高亮 s/a/c（宇→osa/osac 其余键）', ['s','a','c'].every((k) => extraKeys.includes(k)), JSON.stringify(extraKeys));
  // 字根高亮：宇 拆分「宀一{于下}」→ 宀 在 i 键、一 在 f 键（qwerty→gallman 翻译后）
  const activeRoots = await page.$$eval('.zigen-item.active-root', (els) =>
    els.map((el) => el.closest('.kb-key').dataset.cap + ':' + el.querySelector('.zigen-font').textContent)
  );
  console.log('字根高亮:', JSON.stringify(activeRoots));
  check('字根条目高亮（宀/一等）', activeRoots.length >= 2, JSON.stringify(activeRoots));

  // ---- 3. 跟打判定 ----
  await page.click('#typing-area');
  await page.focus('#hidden-input');

  // 输入第一个字「宇」→ 匹配
  await page.evaluate(() => {
    const input = document.getElementById('hidden-input');
    input.value = '宇';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const s1 = await page.evaluate(() => {
    return {
      correct: document.querySelectorAll('.char.correct').length,
      current: document.querySelector('.char.current')?.textContent,
    };
  });
  console.log('输入宇后:', JSON.stringify(s1));
  check('第一个字正确匹配', s1.correct === 1, 'correct=' + s1.correct);
  check('游标前进到「浩」', s1.current === '浩', 'current=' + s1.current);

  // 第二个字「浩」的码表提示（Gallman 下：只有翻译后编码，无 qwerty 原码；含字根拆分）
  const hint2 = await page.$eval('#code-hint', (el) => el.textContent.trim());
  console.log('「浩」提示:', hint2);
  check('「浩」只显示当前布局编码（逗号分隔、无括号原码）', /^浩：qie, qiev/.test(hint2) && !hint2.includes('qie（'), hint2);
  check('「浩」含字根拆分', hint2.includes('拆') && hint2.includes('氵') && hint2.includes('qiev'), hint2);

  // 输错第二个字（原文「浩」→ 输入「木」）
  await page.evaluate(() => {
    const input = document.getElementById('hidden-input');
    input.value = '宇木';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const s2 = await page.evaluate(() => ({
    errorCount: document.querySelectorAll('.char.error').length,
    current: document.querySelector('.char.current')?.textContent,
    statErrors: document.getElementById('stat-errors').textContent,
  }));
  console.log('输错后:', JSON.stringify(s2));
  check('错字标记 error', s2.errorCount === 1, 'err=' + s2.errorCount);
  check('错字也前进（方案B）→ 「星」', s2.current === '星', 'current=' + s2.current);
  check('统计错字数=1', s2.statErrors === '1');

  // 退格回改（删掉「木」）
  await page.evaluate(() => {
    const input = document.getElementById('hidden-input');
    input.value = '宇';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const s3 = await page.evaluate(() => ({
    backspaces: document.getElementById('stat-backspaces').textContent,
    progress: document.getElementById('stat-progress').textContent,
  }));
  console.log('回改后:', JSON.stringify(s3));
  check('回改计数=1', s3.backspaces === '1', 'bs=' + s3.backspaces);
  check('进度 1/8', s3.progress === '1/8', s3.progress);

  // ---- 4. 完整打完 ----
  await page.click('#btn-restart'); // 重开会话（重置为谭浩星陈跟打测试）
  await new Promise((r) => setTimeout(r, 200));

  const fullText = await page.evaluate(() => document.querySelector('.typed-text').textContent);
  const cleanText = Array.from(fullText).join('');
  console.log('原文长度:', cleanText.length);

  const chunkSize = 3;
  let inputted = '';
  for (let i = 0; i < cleanText.length; i += chunkSize) {
    const chunk = cleanText.slice(i, i + chunkSize);
    inputted += chunk;
    await page.evaluate((val) => {
      const input = document.getElementById('hidden-input');
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, inputted);
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 300));

  const finalState = await page.evaluate(() => ({
    done: document.querySelectorAll('.char.pending').length === 0,
    progress: document.getElementById('stat-progress').textContent,
    accuracy: document.getElementById('stat-accuracy').textContent,
    historyRows: document.querySelectorAll('#history-body tr').length,
  }));
  console.log('完成状态:', JSON.stringify(finalState));
  check('全部打完无 pending', finalState.done, 'pending=' + finalState.done);
  check('进度 100%', finalState.progress.endsWith('/8'), finalState.progress);
  check('键准 100%', finalState.accuracy.includes('100'), finalState.accuracy);
  check('历史记录已写入', finalState.historyRows >= 1, 'rows=' + finalState.historyRows);
  check('无 JS 错误', errors.length === 0, JSON.stringify(errors));

  await page.screenshot({ path: 'test/artifacts/integration.png', fullPage: false });

  await browser.close();
  console.log(`\n集成测试: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('集成测试异常:', e);
  process.exit(1);
});