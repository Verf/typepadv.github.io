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
  async function t(name, fn) {
    try {
      await fn();
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
  t('lookupAllCodes 返回全部编码', () => {
    const p = parser.parseCodeTable('d\t的\ndwkd\t的\na\t就');
    assert.deepStrictEqual(parser.lookupAllCodes(p, '的'), ['d', 'dwkd']);
    assert.deepStrictEqual(parser.lookupAllCodes(p, '就'), ['a']);
    assert.strictEqual(parser.lookupAllCodes(p, '无此字'), null);
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

  t('buildCodeTranslateMap: qwerty→gallman 与 KEY_MAP 一致', () => {
    const m = layout.buildCodeTranslateMap('qwerty', 'gallman');
    assert.strictEqual(m.q, 'p');
    assert.strictEqual(m.p, 'i');
    assert.strictEqual(m.a, 'n');
    assert.strictEqual(m.n, 'q');
    // 翻译结果与 gallmanMap 等价
    const gm = layout.gallmanMap();
    for (const [k, v] of Object.entries(m)) assert.strictEqual(v, gm[k]);
  });
  t('buildCodeTranslateMap: 相同布局返回 null（不翻译）', () => {
    assert.strictEqual(layout.buildCodeTranslateMap('qwerty', 'qwerty'), null);
    assert.strictEqual(layout.buildCodeTranslateMap('gallman', 'gallman'), null);
    assert.strictEqual(layout.buildCodeTranslateMap(null, 'qwerty'), null);
  });
  t('buildCodeTranslateMap: gallman→qwerty 为反向映射（灵铭+QWERTY 场景）', () => {
    const m = layout.buildCodeTranslateMap('gallman', 'qwerty');
    // gallman 顶行第1列 p ↔ qwerty 顶行第1列 q
    assert.strictEqual(m.p, 'q');
    assert.strictEqual(m.l, 'w');
    assert.strictEqual(m.d, 'e');
    // 灵铭编码 frmo（gallman 原生）翻译到 qwerty：f→u, r→s, m→m, o→i
    assert.strictEqual(layout.translateCode('frmo', m), 'usmi');
  });
  t('translateCodeToLayout: 星陈 ifk 翻译 gallman 为 osa（与集成测试一致）', () => {
    const m = layout.buildCodeTranslateMap('qwerty', 'gallman');
    assert.strictEqual(layout.translateCode('ifk', m), 'osa');
  });
  t('translateCodeToLayout: 灵铭 osa 反向翻译 qwerty 为 ifk', () => {
    const m = layout.buildCodeTranslateMap('gallman', 'qwerty');
    assert.strictEqual(layout.translateCode('osa', m), 'ifk');
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


  // ---- 修复回归测试（reviewer 发现的问题）----
  console.log('\n[regression] 修复回归');
  await t('KPM 不再天文数字（startTime 生效）', async () => {
    const { TypingController } = await importESM('assets/js/typing.js');
    const c = new TypingController({});
    c.start('就林');
    c.handleInput('就', 1000);
    c.handleInput('就林', 5000); // 4 秒完成
    const view = c.getView();
    const kpm = view.stats.kpm;
    assert.ok(kpm < 100000, 'KPM 应为合理值，实际 ' + kpm);
  });
  await t('startSession 重置 lastLen（换文本后首字不丢）', async () => {
    const { TypingController } = await importESM('assets/js/typing.js');
    const c = new TypingController({});
    c.start('甲乙');
    c.handleInput('甲', 1000);
    c.start('丙丁'); // 切换文本
    c.resetInputTracking();
    c.handleInput('丙', 2000);
    assert.strictEqual(c.session.pos, 1);
    assert.strictEqual(c.session.charStates[0], 'correct');
  });
  await t('parser 忽略词条（只索引单字）', async () => {
    const parser2 = await importESM('assets/js/parser.js');
    const p = parser2.parseCodeTable('ab\t我们\na\t就');
    assert.strictEqual(p.charToCodes.has('我们'), false, '词条不应入库');
    assert.strictEqual(p.charToCodes.get('就')[0], 'a');
  });

  // ---- 灵铭方案（内置）----
  console.log('\n[lingming] 灵铭内置方案');
  await t('灵铭码表可解析（code-right 自动检测）', async () => {
    const fs = await import('fs');
    const text = fs.readFileSync(new URL('../assets/code-tables/mabiao-ling.txt', import.meta.url), 'utf8');
    const p = parser.parseCodeTable(text);
    assert.strictEqual(p.direction, 'code-left'); // 已转为编码在左
    assert.ok(p.stats.uniqueChars > 20000, '灵铭码表应覆盖 2 万+ 字，实际 ' + p.stats.uniqueChars);
    // 关键字编码（Gallman 原生）
    assert.deepStrictEqual(p.charToCodes.get('宇'), ['frmo']);
    assert.deepStrictEqual(p.charToCodes.get('的'), ['e', 'fbxc']);
    assert.deepStrictEqual(p.charToCodes.get('中'), ['di', 'dfi']);
    assert.deepStrictEqual(p.charToCodes.get('一'), ['ri']);
  });
  await t('灵铭拆分表已转 JSON 且结构正确', async () => {
    const fs = await import('fs');
    const raw = JSON.parse(fs.readFileSync(new URL('../assets/data/chaifen-ling.json', import.meta.url), 'utf8'));
    assert.ok(Object.keys(raw).length > 20000, '拆分表应覆盖 2 万+ 字');
    const yu = raw['宇'];
    assert.ok(yu && yu.includes('\t'), '宇 的拆分应有 \t 分隔');
    const [split, code] = yu.split('\t');
    assert.ok(split.includes('宀'), '宇 拆分含 宀');
    assert.strictEqual(code, 'FRMo'); // 灵铭全码（Gallman 原生）
  });
  await t('灵铭字根表已转 JSON（Gallman 键帽直配）', async () => {
    const fs = await import('fs');
    const raw = JSON.parse(fs.readFileSync(new URL('../assets/data/zigen-ling.json', import.meta.url), 'utf8'));
    const keys = Object.keys(raw);
    assert.strictEqual(keys.length, 20, '灵铭应为 20 个大码键');
    // 键帽为 Gallman 辅音键
    for (const k of keys) assert.ok(/^[a-z]$/.test(k), '键帽应为字母: ' + k);
    // p 键含字根
    assert.ok(raw['p'] && raw['p'].length > 0, 'p 键应有字根');
    // 声韵码字段 s 存在
    assert.ok(raw['p'].every((r) => typeof r.s === 'string' && r.s.length > 0), '每条字根应有声韵');
  });
  await t('schemes 注册表：星陈/灵铭元数据正确', async () => {
    const schemes = await importESM('assets/js/schemes.js');
    const star = schemes.BUILTIN_SCHEMES['star-builtin'];
    const ling = schemes.BUILTIN_SCHEMES['ling-builtin'];
    assert.strictEqual(star.codeBaseLayout, 'qwerty');
    assert.strictEqual(star.defaultTranslate, true);
    assert.strictEqual(ling.codeBaseLayout, 'gallman');
    assert.strictEqual(ling.defaultTranslate, false);
    assert.ok(ling.codeTable.url.includes('mabiao-ling.txt'));
    assert.ok(ling.chaifen.url.includes('chaifen-ling.json'));
    assert.ok(ling.zigen.url.includes('zigen-ling.json'));
  });
  await t('chaifen.js: 按方案多源加载', async () => {
    const chaifen = await importESM('assets/js/chaifen.js');
    const star = (await importESM('assets/js/schemes.js')).BUILTIN_SCHEMES['star-builtin'];
    const ling = (await importESM('assets/js/schemes.js')).BUILTIN_SCHEMES['ling-builtin'];
    // mock fetch（node 环境无相对路径 fetch）
    const fs = await import('fs');
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const rel = String(url).replace('assets/', '../assets/');
      const abs = new URL(rel, import.meta.url);
      const body = fs.readFileSync(abs, 'utf8');
      return { ok: true, json: async () => JSON.parse(body), text: async () => body };
    };
    try {
      // 先加载星陈，再切灵铭（重新加载）
      await chaifen.loadChaifenData(star.chaifen);
      const sInfo = chaifen.getChaifen('宇');
      assert.ok(sInfo && sInfo.code === 'IFKc', '星陈拆分: 宇=IFKc，实际 ' + (sInfo && sInfo.code));
      await chaifen.loadChaifenData(ling.chaifen);
      const lInfo = chaifen.getChaifen('宇');
      assert.ok(lInfo && lInfo.code === 'FRMo', '灵铭拆分: 宇=FRMo，实际 ' + (lInfo && lInfo.code));
      assert.ok(lInfo.split.includes('宀'), '灵铭拆分含 宀');
      // 切回星陈（再次重新加载）
      await chaifen.loadChaifenData(star.chaifen);
      const sInfo2 = chaifen.getChaifen('宇');
      assert.ok(sInfo2 && sInfo2.code === 'IFKc', '切回星陈后: 宇=IFKc，实际 ' + (sInfo2 && sInfo2.code));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 汇总
  console.log(`\n单元测试结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('单元测试执行异常:', e);
  process.exit(1);
});