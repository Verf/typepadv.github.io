// test/unit.test.js - 纯逻辑单元测试（node ESM，直接导入 ES 模块）
// 覆盖：parser / layout / stats / typing 核心逻辑

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assert = require('assert');

async function importESM(rel) {
  const full = path.resolve(__dirname, '..', rel);
  return import('file://' + full);
}

(async () => {
  let pass = 0, fail = 0;
  function t(name, fn) {
    try {
      fn();
      pass++;
      console.log('  ✅', name);
    } catch (e) {
      fail++;
      console.error('  ❌', name, '-', e.message);
    }
  }

  // ===== parser 测试 =====
  console.log('\n[parser] 码表解析器');
  const parser = await importESM('assets/js/parser.js');

  t('检测方向：编码在左（宇浩星陈）', () => {
    assert.strictEqual(parser.detectDirection('a\t就'), 'code-left');
    assert.strictEqual(parser.detectDirection('aa\t林'), 'code-left');
  });
  t('检测方向：编码在右（五笔风格）', () => {
    assert.strictEqual(parser.detectDirection('就\ta'), 'code-right');
    assert.strictEqual(parser.detectDirection('工\taaaa'), 'code-right');
  });
  t('parse: 宇浩星陈格式解析正确', () => {
    const p = parser.parseCodeTable('a\t就\naa\t林\naaa\t森');
    assert.strictEqual(p.direction, 'code-left');
    assert.strictEqual(p.charToCodes.get('就')[0], 'a');
    assert.strictEqual(p.charToCodes.get('林')[0], 'aa');
    assert.strictEqual(p.charToCodes.get('森')[0], 'aaa');
  });
  t('parse: 五笔格式（编码在右）解析正确', () => {
    const p = parser.parseCodeTable('工\taaaa\n大\tdddd');
    assert.strictEqual(p.direction, 'code-right');
    assert.strictEqual(p.charToCodes.get('工')[0], 'aaaa');
  });
  t('parse: 多码保留（同字多个编码）', () => {
    const p = parser.parseCodeTable('ai\t就\na\t就\naj\t就');
    assert.strictEqual(p.charToCodes.get('就').length, 3);
    assert.deepStrictEqual(p.charToCodes.get('就'), ['ai', 'a', 'aj']);
  });
  t('parse: 忽略注释与空行', () => {
    const p = parser.parseCodeTable('# 注释\n\na\t就\n\n# 尾注释');
    assert.strictEqual(p.charToCodes.size, 1);
    assert.strictEqual(p.charToCodes.get('就')[0], 'a');
  });
  t('parse: fcitx 三列（词 编码 权重）容忍', () => {
    const p = parser.parseCodeTable('工\taaaa\t100\n大\tdddd\t200');
    assert.strictEqual(p.charToCodes.get('工')[0], 'aaaa'); // 权重被跳过
  });
  t('lookupCode 取多码第一个', () => {
    const p = parser.parseCodeTable('ai\t就\na\t就');
    assert.strictEqual(parser.lookupCode(p, '就'), 'ai');
    assert.strictEqual(parser.lookupCode(p, '就', 1), 'a');
    assert.strictEqual(parser.lookupCode(p, '不存在'), null);
  });

  // ===== layout 测试 =====
  console.log('\n[layout] 键盘布局与翻译');
  const layout = await importESM('assets/js/layout.js');

  t('KEY_MAP 完整（19项字母映射）', () => {
    assert.strictEqual(Object.keys(layout.KEY_MAP).length, 19);
    assert.strictEqual(layout.KEY_MAP.q, 'p');
    assert.strictEqual(layout.KEY_MAP.p, 'i');
    assert.strictEqual(layout.KEY_MAP.a, 'n');
    assert.strictEqual(layout.KEY_MAP.n, 'q');
  });
  t('gallmanMap: 覆盖全部 26 字母且单射', () => {
    const m = layout.gallmanMap();
    assert.strictEqual(Object.keys(m).length, 26);
    const vals = Object.values(m);
    assert.strictEqual(new Set(vals).size, 26, '映射必须是一一对应');
  });
  t('translateCode: gallman 翻译正确', () => {
    const m = layout.gallmanMap();
    assert.strictEqual(layout.translateCode('a', m), 'n');
    assert.strictEqual(layout.translateCode('aa', m), 'nn');
    assert.strictEqual(layout.translateCode('pq', m), 'ip');
  });
  t('translateCode: qwerty 布局不翻译（map=null）', () => {
    assert.strictEqual(layout.translateCode('ifk', null), 'ifk');
  });
  t('translateCode: 无映射字母原样', () => {
    const m = layout.gallmanMap();
    assert.strictEqual(layout.translateCode('gb', m), 'gb'); // g、b 未映射
  });
  t('GALLMAN_ROWS 结构与 30 键', () => {
    const total = layout.GALLMAN_ROWS.reduce((n, r) => n + r.length, 0);
    assert.strictEqual(total, 30);
    assert.deepStrictEqual(layout.GALLMAN_ROWS[0], ['p','l','d','w','k','j','f','o','u',';']);
  });
  t('fingerFor 返回有效分区', () => {
    assert.ok(layout.fingerFor(1, 0).startsWith('l')); // q 左手
    assert.ok(layout.fingerFor(1, 9).startsWith('r')); // p 右手
  });

  // ===== stats 测试 =====
  console.log('\n[stats] 统计逻辑');
  const statsMod = await importESM('assets/js/stats.js');

  t('createSession 初始化', () => {
    const s = statsMod.createSession('测试文本');
    assert.strictEqual(s.text.length, 4);
    assert.strictEqual(s.charStates.length, 4);
    assert.ok(s.charStates.every((st) => st === 'pending'));
    assert.strictEqual(s.pos, 0);
  });
  t('applyInput 正确逐字推进', () => {
    const s = statsMod.createSession('就林森');
    statsMod.applyInput(s, '就', 1000);
    assert.strictEqual(s.pos, 1);
    assert.strictEqual(s.charStates[0], 'correct');
    statsMod.applyInput(s, '木', 2000); // 错字
    assert.strictEqual(s.charStates[1], 'error');
    assert.strictEqual(s.errors, 1);
    assert.strictEqual(s.pos, 2); // 方案B：错字也前进
    statsMod.applyInput(s, '森', 3000);
    assert.strictEqual(s.pos, 3);
    assert.strictEqual(s.charStates[2], 'correct');
  });
  t('applyBackspace 回改统计', () => {
    const s = statsMod.createSession('就林');
    statsMod.applyInput(s, '就', 1000);
    statsMod.applyInput(s, '木', 2000); // 错
    assert.strictEqual(s.pos, 2);
    statsMod.applyBackspace(s, 3000);
    assert.strictEqual(s.backspaces, 1);
    assert.strictEqual(s.charStates[1], 'backspaced');
    assert.strictEqual(s.pos, 1);
  });
  t('computeStats 基本口径', () => {
    // 模拟：打错一个字，回改 2 次
    const s = statsMod.createSession('就林');
    statsMod.applyInput(s, '就', 1000);
    statsMod.applyInput(s, '木', 2000); // 错
    statsMod.applyBackspace(s, 3000);
    statsMod.applyBackspace(s, 4000); // 回退到第一个字？pos=0
    statsMod.applyInput(s, '就林', 5000);
    const st = statsMod.computeStats(s, 6000);
    assert.strictEqual(st.typedCount, 2);
    assert.strictEqual(st.backspaces, 2); // 回改计数保留
    assert.strictEqual(st.totalChars, 2);
    assert.ok(st.kpm >= 0);
    assert.strictEqual(st.done, true);
  });
  t('computeStats 全程正确 → 键准100% 无错', () => {
    const s = statsMod.createSession('就林');
    statsMod.applyInput(s, '就林', 0);
    const st = statsMod.computeStats(s, 60000); // 1分钟
    assert.strictEqual(st.accuracy, 100);
    assert.strictEqual(st.errorRate, 0);
    assert.strictEqual(st.done, true);
  });
  t('isDone 识别完成', () => {
    const s = statsMod.createSession('就');
    assert.strictEqual(statsMod.isDone(s), false);
    statsMod.applyInput(s, '就', 1000);
    assert.strictEqual(statsMod.isDone(s), true);
  });

  // ===== typing 集成逻辑测试 =====
  console.log('\n[typing] 跟打控制器');
  const { TypingController } = await importESM('assets/js/typing.js');

  t('handleInput 正常跟打流程', () => {
    const rendered = [];
    const c = new TypingController({ render: (s) => rendered.push(s.pos) });
    c.start('就林森');
    c.handleInput('就', 1000);
    c.handleInput('就木', 2000); // 输入法一次上屏 2 字（木错）
    // 由于输入框整体是"就木"，diff 追加的是"木"
    assert.strictEqual(c.session.pos, 2);
    assert.strictEqual(c.session.charStates[0], 'correct');
    assert.strictEqual(c.session.charStates[1], 'error');
    c.handleInput('就木森', 3000); // 追加 森
    assert.strictEqual(c.session.pos, 3);
    assert.strictEqual(c.session.charStates[2], 'correct');
    assert.ok(c.finished);
  });

  t('退格回改计入次数', () => {
    const c = new TypingController({});
    c.start('就林');
    c.handleInput('就', 1000);
    c.handleInput('就木', 2000); // 错（第二个字错，pos=2 → 已完成但允许回改）
    assert.strictEqual(c.finished, true); // 方案B：错字也视为打完全部
    c.handleInput('就', 3000);   // 删掉 木 → 回改（pos 2→1，回到未完成）
    assert.strictEqual(c.session.backspaces, 1);
    assert.strictEqual(c.session.pos, 1);
    assert.strictEqual(c.finished, false);
    c.handleInput('就林', 4000);
    assert.ok(c.finished);
  });

  // 汇总
  console.log(`\n单元测试结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('单元测试执行异常:', e);
  process.exit(1);
});