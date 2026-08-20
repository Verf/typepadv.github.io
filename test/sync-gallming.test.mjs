import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildCodeTable, buildRoots, locateUpstreamRoot, main, mergeReviewedRoots, parseChaifen, transactionalWrite, validateCandidateDelivery } from '../scripts/sync-gallming.mjs';

const yaml = (body) => `---\nname: test\n...\n${body}`;

assert.equal(buildCodeTable(yaml('宇\tftmo\t1\n宇宙\tword\t1\n')), 'ftmo\t宇\n');
assert.deepEqual(parseChaifen(yaml('宇\t[宀一{于下},FTMo,Fa-Ti-Mo]\n')), {
  宇: '宀一{于下}\tFTMo\tFa-Ti-Mo',
});

const oldKeys = 'BCDFGHJKLMNPQRSTVWXY';
const permutation = 'vcdtphmfyjrxbgslnwkq';
const groups = Array.from(oldKeys, (key) => `${key.toLowerCase()}\t/lm${key.toLowerCase()}`).join('\n');
const rootSource = yaml(`${groups}\n+ e = 臣\t/lmb\n`);
const roots = buildRoots(rootSource, yaml('字\t[臣,Ve,Ve]\n'), permutation);
assert.deepEqual(roots.v, [{ f: 'b', s: 'b' }, { f: '臣', s: 'e' }]);
assert.deepEqual(mergeReviewedRoots(roots, { candidates: [
  { canonical: '⺈', confidence: 'reviewed', key: 'v', suffix: 'i', glyphs: ['⺈'] },
  { canonical: '臣', confidence: 'verified', key: 'v', suffix: 'e', glyphs: ['臣'] },
] }).v.at(-1), { f: '⺈', s: 'i' });

assert.throws(
  () => buildRoots(yaml(`${groups}\n+ e = 臣\t/lmb\n+ i = 臣\t/lmb\n`), yaml('字\t[臣,Ve,Ve]\n'), permutation),
  /存在冲突声韵/u,
);
assert.throws(
  () => buildRoots(rootSource, yaml('甲\t[b,Vx,Vx]\n乙\t[b,Vy,Vy]\n'), permutation),
  /冲突拆分声韵/u,
);

// 默认 clone 和 --source 都把参数视为 gallming 仓库根；同时兼容旧的父目录传法。
const rootFixture = mkdtempSync(join(tmpdir(), 'gallming-root-fixture-'));
mkdirSync(join(rootFixture, 'out'));
writeFileSync(join(rootFixture, 'out/gallming.dict.yaml'), 'fixture', 'utf8');
assert.equal(locateUpstreamRoot(rootFixture), rootFixture);
const parentFixture = mkdtempSync(join(tmpdir(), 'gallming-parent-fixture-'));
mkdirSync(join(parentFixture, 'gallming/out'), { recursive: true });
writeFileSync(join(parentFixture, 'gallming/out/gallming.dict.yaml'), 'fixture', 'utf8');
assert.equal(locateUpstreamRoot(parentFixture), join(parentFixture, 'gallming'));
rmSync(rootFixture, { recursive: true, force: true });
rmSync(parentFixture, { recursive: true, force: true });

// 最小仓库夹具覆盖 generate/main 的写入、最新检查和陈旧检查。
const e2eSource = mkdtempSync(join(tmpdir(), 'gallming-e2e-source-'));
const e2eProject = mkdtempSync(join(tmpdir(), 'gallming-e2e-project-'));
mkdirSync(join(e2eSource, 'out'), { recursive: true });
mkdirSync(join(e2eSource, 'data'), { recursive: true });
writeFileSync(join(e2eSource, 'out/gallming.dict.yaml'), yaml('宇\tftmo\t1\n'));
writeFileSync(join(e2eSource, 'out/gallming_chaifen.dict.yaml'), yaml('宇\t[宀一{于下},FTMo,Fa-Ti-Mo]\n'));
writeFileSync(join(e2eSource, 'data/yuling.roots.dict.yaml'), rootSource);
writeFileSync(join(e2eSource, 'out/best_perm.json'), JSON.stringify({ perm: Array.from(permutation) }));
const fixtureCsv = Buffer.from('yuniversus,chaipua,ispua\n字,,\n');
const fixtureWoff = Buffer.from('wOFFfixture-data');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const fixtureCandidates = { version: 1, layout: { damaOrder: oldKeys, perm: permutation }, candidates: [], noCandidate: [], sources: {
  version: 1,
  mapping: { url: 'https://shurufa.app/fonts/yuniversus-chaipua.csv', file: 'yuniversus-chaipua.csv', sha256: hash(fixtureCsv) },
  font: { url: 'https://shurufa.app/fonts/Yuniversus.woff', file: 'Yuniversus.woff', sha256: hash(fixtureWoff) },
} };
writeFileSync(join(e2eSource, 'out/gallming_root_candidates.json'), JSON.stringify(fixtureCandidates));
writeFileSync(join(e2eSource, 'data/yuniversus-chaipua.csv'), fixtureCsv);
writeFileSync(join(e2eSource, 'data/Yuniversus.woff'), fixtureWoff);
main(['--source', e2eSource], { projectRoot: e2eProject, expected: { codeEntries: 1, chars: 1 } });
assert.equal(readFileSync(join(e2eProject, 'assets/code-tables/mabiao-ling.txt'), 'utf8'), 'ftmo\t宇\n');
assert.deepEqual(readFileSync(join(e2eProject, 'assets/fonts/Yuniversus.woff')), fixtureWoff);
assert.throws(() => validateCandidateDelivery({ ...fixtureCandidates, version: 2 }, permutation, fixtureCsv, fixtureWoff), /schema\/version/u);
assert.throws(() => validateCandidateDelivery(fixtureCandidates, permutation, fixtureCsv, Buffer.from('wOFFchanged')), /SHA-256/u);
main(['--source', e2eSource, '--check'], { projectRoot: e2eProject, expected: { codeEntries: 1, chars: 1 } });
writeFileSync(join(e2eProject, 'assets/code-tables/mabiao-ling.txt'), 'stale\n');
assert.throws(() => main(['--source', e2eSource, '--check'], { projectRoot: e2eProject, expected: { codeEntries: 1, chars: 1 } }), /不是最新版本/u);

// 默认 clone 生命周期：成功、clone 失败、generate 失败都必须清理临时目录。
let cleaned = false;
main([], {
  projectRoot: e2eProject, expected: { codeEntries: 1, chars: 1 },
  makeTemp: () => e2eSource, clone: () => {}, cleanup: (path) => { cleaned = true; rmSync(path, { recursive: true, force: true }); },
});
assert.equal(cleaned, true);
assert.equal(existsSync(e2eSource), false);
const cloneFailTemp = mkdtempSync(join(tmpdir(), 'gallming-clone-fail-'));
cleaned = false;
assert.throws(() => main([], { makeTemp: () => cloneFailTemp, clone: () => { throw new Error('clone fail'); }, cleanup: (path) => { cleaned = true; rmSync(path, { recursive: true, force: true }); } }), /clone fail/u);
assert.equal(cleaned, true);
assert.equal(existsSync(cloneFailTemp), false);
const generateFailTemp = mkdtempSync(join(tmpdir(), 'gallming-generate-fail-'));
cleaned = false;
assert.throws(() => main([], { makeTemp: () => generateFailTemp, clone: () => {}, cleanup: (path) => { cleaned = true; rmSync(path, { recursive: true, force: true }); } }), /找不到 gallming/u);
assert.equal(cleaned, true);
assert.equal(existsSync(generateFailTemp), false);
rmSync(e2eProject, { recursive: true, force: true });

// 文件事务故障注入：提交点前任何失败均保留全部旧文件，提交点后清理失败保留新文件。
function transactionCase(fail) {
  const dir = mkdtempSync(join(tmpdir(), 'gallming-transaction-'));
  const a = join(dir, 'a.txt'); const b = join(dir, 'b.txt');
  writeFileSync(a, 'old-a'); writeFileSync(b, 'old-b');
  let writes = 0;
  const io = {
    writeFileSync(path, data, encoding) { writes++; if (fail === 'stage' && writes === 2) throw new Error('stage'); writeFileSync(path, data, encoding); },
    renameSync(from, to) {
      if (fail === 'backup' && to.includes('.bak-') && from === b) throw new Error('backup');
      if (fail === 'install' && from.includes('.tmp-') && to === b) throw new Error('install');
      renameSync(from, to);
    },
    rmSync(path, options) { if (fail === 'cleanup' && path.includes('.bak-')) throw new Error('cleanup'); rmSync(path, options); },
  };
  const warnings = [];
  let error = null;
  try { transactionalWrite([[a, 'new-a'], [b, 'new-b']], io, (message) => warnings.push(message)); } catch (caught) { error = caught; }
  const result = { error, a: readFileSync(a, 'utf8'), b: readFileSync(b, 'utf8'), warnings };
  rmSync(dir, { recursive: true, force: true });
  return result;
}
for (const point of ['stage', 'backup', 'install']) {
  const result = transactionCase(point);
  assert.ok(result.error, `${point} 应失败`);
  assert.deepEqual([result.a, result.b], ['old-a', 'old-b']);
}
const cleanupResult = transactionCase('cleanup');
assert.equal(cleanupResult.error, null);
assert.deepEqual([cleanupResult.a, cleanupResult.b], ['new-a', 'new-b']);
assert.equal(cleanupResult.warnings.length, 2);

// 二进制目标在安装失败时也必须逐字节回滚。
{
  const dir = mkdtempSync(join(tmpdir(), 'gallming-binary-transaction-'));
  const a = join(dir, 'a.woff'); const b = join(dir, 'b.woff');
  writeFileSync(a, Buffer.from([0, 255])); writeFileSync(b, Buffer.from([1, 254]));
  assert.throws(() => transactionalWrite([[a, Buffer.from([2, 253])], [b, Buffer.from([3, 252])]], {
    renameSync(from, to) { if (from.includes('.tmp-') && to === b) throw new Error('binary install'); renameSync(from, to); },
  }), /binary install/u);
  assert.deepEqual(readFileSync(a), Buffer.from([0, 255]));
  assert.deepEqual(readFileSync(b), Buffer.from([1, 254]));
  rmSync(dir, { recursive: true, force: true });
}

// --source 失败时也绝不能删除用户提供的本地目录。
const localSource = mkdtempSync(join(tmpdir(), 'gallming-source-safety-'));
writeFileSync(join(localSource, 'keep.txt'), 'keep', 'utf8');
try {
  assert.throws(() => execFileSync(process.execPath, [resolve('scripts/sync-gallming.mjs'), '--source', localSource, '--check'], { stdio: 'pipe' }));
  assert.equal(existsSync(join(localSource, 'keep.txt')), true);
} finally {
  rmSync(localSource, { recursive: true, force: true });
}

console.log('gallming 同步工具测试通过');
