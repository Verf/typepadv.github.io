import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, transactionalWrite } from '../scripts/sync-gallming.mjs';
import {
  buildFormalCodeTable, buildFormalRoots, generateFormalAssets, locateFormalUpstreamRoot,
  parseFormalChaifen, tokenizeFormalRoots, validateFormalCodeDelivery, validateFormalRelease,
} from '../scripts/gallming-formal.mjs';

const yaml = (name, body) => `---\nname: ${name}\nversion: "test-max5-v1"\n...\n${body}`;
const hash = (data) => createHash('sha256').update(data).digest('hex');

assert.equal(buildFormalCodeTable(yaml('test', '宇\tvfqo\t1\n宇宙\tword\t1\n𬉼\tchpc\t1\n')), 'vfqo\t宇\nchpc\t𬉼\n');
assert.deepEqual(parseFormalChaifen(yaml('test', '宇\t[宀 一 {于下},VFQo,Va-Fyi-Qo,,rank=1]\n')), {
  宇: '宀 一 {于下}\tVFQo\tVa-Fyi-Qo',
});
assert.deepEqual(tokenizeFormalRoots('宀 一 {于下} ...'), ['宀', '一', '{于下}']);

const source = mkdtempSync(join(tmpdir(), 'gallming-formal-source-'));
const project = mkdtempSync(join(tmpdir(), 'gallming-formal-project-'));
mkdirSync(join(source, 'out'), { recursive: true });
mkdirSync(join(source, 'data'), { recursive: true });

const codeRows = [
  ['的', 'e'], ['的', 'vbsl'], ['是', 'i'], ['是', 'jrfx'], ['一', 'a'], ['一', 'fyi'],
  ['中', 'go'], ['中', 'gkri'], ['为', 'le'], ['为', 'ltluw'], ['宇', 'vfqo'], ['年', 'tra'],
  ['久', 'lru'], ['其', 'kqi'],
];
writeFileSync(join(source, 'out/gallming.dict.yaml'), yaml('gallming', `${codeRows.map(([char, code]) => `${char}\t${code}\t1`).join('\n')}\n`));
const splits = [
  '的\t[白 勹 丶,VbSL,Vba-Sa-Lu,,rank=1]',
  '是\t[日,Jrfx,Jri,,rank=2]',
  '一\t[一,Fyi,Fyi,,rank=3]',
  '中\t[口,Gkri,Gko,,rank=4]',
  '为\t[丶,Ltlu+w,Lu,,rank=5]',
  '宇\t[宀 一 {于下},VFQo,Va-Fyi-Qo,,rank=6]',
  '年\t[{乞上} 㐄,TRa,To-Ra,,rank=7]',
  '久\t[⺈ 乀,LRu,Li-Ru,,rank=8]',
  '其\t[其,Kqi,Kqi,,rank=9]',
];
writeFileSync(join(source, 'out/gallming_chaifen.dict.yaml'), yaml('chaifen', `${splits.join('\n')}\n`));

const bundles = [
  ['b', '土'], ['c', '心'], ['d', '刀'], ['f', '一'], ['g', '口'], ['h', '火'], ['j', '日'],
  ['k', '其'], ['l', '丶'], ['m', '木'], ['n', '手'], ['p', '子'], ['q', '{于下}'], ['r', '㐄'],
  ['s', '勹'], ['t', '{乞上}'], ['v', '白'], ['w', '大'], ['x', '小'], ['y', '月'],
  ['v', '宀'], ['l', '⺈'], ['r', '乀'],
].map(([key, canonical]) => ({ canonical, roots: [canonical], key }));
const soundSpec = new Map([
  ['白', ['b', 'a']], ['一', ['y', 'i']], ['口', ['k', 'o']], ['日', ['r', 'i']], ['其', ['q', 'i']],
  ['宀', ['', 'a']], ['{于下}', ['', 'o']], ['{乞上}', ['', 'o']], ['㐄', ['', 'a']],
  ['⺈', ['', 'i']], ['乀', ['', 'u']], ['勹', ['', 'a']], ['丶', ['', 'u']],
]);
const sounds = bundles.map(({ canonical: root }) => {
  const [selected, rhyme] = soundSpec.get(root) || ['', 'o'];
  return { root, rhyme, ...(selected ? { selected, canonical: selected } : {}), noncanonical: false };
});
const release = {
  version: 2, release_status: 'formal', root_sound_policy: 'standalone_canonical',
  bundles, sounds,
};
const releaseText = `${JSON.stringify(release, null, 2)}\n`;
writeFileSync(join(source, 'out/max5_candidate.json'), releaseText);
const shortcutEntries = [
  ['的', 'e', 'vbsl'], ['是', 'i', 'jrfx'], ['一', 'a', 'fyi'], ['中', 'go', 'gkri'], ['为', 'le', 'ltluw'],
].map(([char, code, full_code], index) => ({ char, code, full_code, level: code.length, rank: index + 1 }));
const shortcodes = {
  version: 3, source: { candidate: 'out/max5_candidate.json', sha256: hash(releaseText) },
  two_rule: '首大＋整字韵', direct_audit_ok: true,
  metrics: { target_chars: 9, one_count: 3, two_count: 2 }, entries: shortcutEntries,
};
writeFileSync(join(source, 'out/max5_shortcodes.json'), JSON.stringify(shortcodes));

const csv = Buffer.from('yuniversus,chaipua,ispua\n字,,\n');
const font = Buffer.from('wOFFfixture-data');
const candidates = {
  version: 1,
  layout: { damaOrder: 'BCDFGHJKLMNPQRSTVWXY', perm: 'bcdfghjklmnpqrstvwxy' },
  encoding: { legacy: true },
  sources: {
    version: 1,
    mapping: { url: 'https://shurufa.app/fonts/yuniversus-chaipua.csv', file: 'yuniversus-chaipua.csv', sha256: hash(csv) },
    font: { url: 'https://shurufa.app/fonts/Yuniversus.woff', file: 'Yuniversus.woff', sha256: hash(font) },
  },
  candidates: [
    { canonical: '{于下}', sourceCode: 'Qo', key: 'q', suffix: 'o', glyphs: ['\uE001'], confidence: 'reviewed', provenance: 'maintainer-review' },
    { canonical: '{乞上}', sourceCode: 'To', key: 't', suffix: 'o', glyphs: ['\uE002'], confidence: 'reviewed', provenance: 'maintainer-review' },
  ],
  noCandidate: [],
};
writeFileSync(join(source, 'out/gallming_root_candidates.json'), JSON.stringify(candidates));
writeFileSync(join(source, 'data/yuniversus-chaipua.csv'), csv);
writeFileSync(join(source, 'data/Yuniversus.woff'), font);

try {
  assert.equal(locateFormalUpstreamRoot(source), source);
  validateFormalRelease(release, shortcodes, releaseText);
  const built = buildFormalRoots(release, candidates);
  assert.deepEqual(built.roots.q, [{ f: '\uE001', s: 'o' }]);
  assert.deepEqual(built.roots.v, [{ f: '白', s: 'ba' }, { f: '宀', s: 'a' }]);
  assert.equal(built.candidatePayload.candidates[0].sourceCode, 'Qo');

  const generated = generateFormalAssets(source);
  assert.equal(Object.keys(generated).length, 7);
  assert.deepEqual(validateFormalCodeDelivery(
    generated['assets/code-tables/mabiao-ling.txt'],
    JSON.parse(generated['assets/data/chaifen-ling.json']), shortcodes,
  ), { chars: 9, entries: 14, shortcuts: 5 });

  main(['--source', source], { projectRoot: project });
  const metadata = JSON.parse(readFileSync(join(project, 'assets/data/gallming-release.json'), 'utf8'));
  assert.equal(metadata.version, 'test-max5-v1');
  assert.equal(metadata.root_sound_policy, 'standalone_canonical');
  main(['--source', source, '--check'], { projectRoot: project });
  writeFileSync(join(project, 'assets/code-tables/mabiao-ling.txt'), 'stale\n');
  assert.throws(() => main(['--source', source, '--check'], { projectRoot: project }), /不是最新版本/u);
} finally {
  rmSync(source, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
}

// 文件事务仍需保证安装失败时恢复全部旧文件。
{
  const dir = mkdtempSync(join(tmpdir(), 'gallming-formal-transaction-'));
  const a = join(dir, 'a.txt'); const b = join(dir, 'b.txt');
  writeFileSync(a, 'old-a'); writeFileSync(b, 'old-b');
  assert.throws(() => transactionalWrite([[a, 'new-a'], [b, 'new-b']], {
    renameSync(from, to) {
      if (from.includes('.tmp-') && to === b) throw new Error('install');
      renameSync(from, to);
    },
  }), /install/u);
  assert.equal(readFileSync(a, 'utf8'), 'old-a');
  assert.equal(readFileSync(b, 'utf8'), 'old-b');
  rmSync(dir, { recursive: true, force: true });
}

console.log('gallming 五码正式版同步工具测试通过');
