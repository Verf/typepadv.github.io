#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const UPSTREAM_URL = 'https://git.nas.verf.uk/verf/gallming.git';
const DAMA_ORDER = 'BCDFGHJKLMNPQRSTVWXY';
const DELIVERY_CHAR = (ch) => Array.from(ch).length === 1 && (ch === '〇' || /[\u4e00-\u9fff]/u.test(ch));
// 官方族根表以“凵”收录该形，而逐字拆分的显示语义是“ㄩ”。两者共享根码，
// 因此字根图必须同时提供 ㄩ，才能精确高亮 qf 拆分中的该身份。
const DISPLAY_ALIASES = new Map([['凵', 'ㄩ']]);

function yamlBody(text) {
  const marker = text.split(/\r?\n/u).findIndex((line) => line === '...');
  if (marker < 0) throw new Error('YAML 缺少正文分隔符 ...');
  return text.split(/\r?\n/u).slice(marker + 1);
}

export function buildCodeTable(text) {
  const lines = [];
  for (const line of yamlBody(text)) {
    if (!line || line.startsWith('#')) continue;
    const [char, code] = line.split('\t');
    if (DELIVERY_CHAR(char) && /^[a-z]+$/u.test(code || '')) lines.push(`${code}\t${char}`);
  }
  if (lines.length < 1) throw new Error('gallming 主码表没有可用单字条目');
  return `${lines.join('\n')}\n`;
}

export function parseChaifen(text) {
  const result = {};
  for (const line of yamlBody(text)) {
    const [char, value] = line.split('\t');
    if (!DELIVERY_CHAR(char) || !value?.startsWith('[') || !value.endsWith(']')) continue;
    const parts = value.slice(1, -1).split(',');
    if (parts.length < 2) throw new Error(`拆分条目格式错误: ${char}`);
    result[char] = `${parts[0]}\t${parts[1]}${parts[2] ? `\t${parts[2]}` : ''}`;
  }
  if (Object.keys(result).length < 1) throw new Error('gallming 拆分表没有可用单字条目');
  return result;
}

function parseRootSource(text) {
  const groups = new Map();
  const rows = new Map();
  for (const line of yamlBody(text)) {
    if (!line.includes('\t/lm')) continue;
    const [body, tag] = line.split('\t');
    const oldKey = tag?.slice(3, 4).toUpperCase();
    if (oldKey.length !== 1 || !DAMA_ORDER.includes(oldKey)) continue;
    if (body.startsWith('+ ')) {
      const match = /^\+ ([a-z]+) = (.+)$/u.exec(body);
      if (match) {
        if (!rows.has(oldKey)) rows.set(oldKey, []);
        for (const root of Array.from(match[2])) {
          const prior = rows.get(oldKey).find((entry) => entry.f === root);
          if (prior && prior.s !== match[1]) throw new Error(`字根 ${root} 在 ${oldKey} 族中存在冲突声韵: ${prior.s} / ${match[1]}`);
          if (!prior) rows.get(oldKey).push({ f: root, s: match[1] });
        }
      }
    } else {
      groups.set(oldKey, Array.from(body));
    }
  }
  if (groups.size !== 20) throw new Error(`字根表应包含 20 个大码族，实际为 ${groups.size}`);
  return { groups, rows };
}

function tokenizeRoots(value) {
  const roots = [];
  for (let i = 0; i < value.length;) {
    if (value.startsWith('...', i)) { i += 3; continue; }
    if (value[i] === '{') {
      const end = value.indexOf('}', i + 1);
      if (end < 0) throw new Error(`拆分根缺少右括号: ${value}`);
      roots.push(value.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    if (value[i] === '}') throw new Error(`拆分根存在多余右括号: ${value}`);
    const [root] = Array.from(value.slice(i));
    roots.push(root);
    i += root.length;
  }
  return roots;
}

function fallbackSuffixes(chaifenText) {
  const found = new Map();
  for (const line of yamlBody(chaifenText)) {
    const [, value] = line.split('\t');
    if (!value?.startsWith('[') || !value.endsWith(']')) continue;
    const parts = value.slice(1, -1).split(',');
    const roots = tokenizeRoots(parts[0] || '');
    const codes = (parts[2] || '').split('-');
    if (roots.length !== codes.length) continue;
    roots.forEach((root, index) => {
      const match = /^([A-Z])([a-z]*)$/u.exec(codes[index]);
      if (match) {
        const key = `${match[1]}\0${root}`;
        if (!found.has(key)) found.set(key, new Set());
        found.get(key).add(match[2]);
      }
    });
  }
  const unique = new Map();
  for (const [key, suffixes] of found) {
    if (suffixes.size > 1) {
      const [family, root] = key.split('\0');
      throw new Error(`字根 ${root} 在 ${family} 键存在冲突拆分声韵: ${Array.from(suffixes).join(' / ')}`);
    }
    unique.set(key, Array.from(suffixes)[0]);
  }
  return unique;
}

export function buildRoots(rootsText, chaifenText, permutation) {
  const { groups, rows } = parseRootSource(rootsText);
  const fallback = fallbackSuffixes(chaifenText);
  const keyMap = new Map(Array.from(DAMA_ORDER, (oldKey, i) => [oldKey, permutation[i]]));
  const output = {};
  for (const oldKey of DAMA_ORDER) {
    const key = keyMap.get(oldKey);
    const byRoot = new Map();
    for (const entry of rows.get(oldKey) || []) if (!byRoot.has(entry.f)) byRoot.set(entry.f, entry.s);
    // 族根串是完整权威清单，顺序也来自上游；仅在其后补充声韵表中的异体。
    const orderedRoots = [...groups.get(oldKey), ...(rows.get(oldKey) || []).map((entry) => entry.f)]
      .filter((root, index, all) => all.indexOf(root) === index);
    for (const root of orderedRoots) {
      // 上游字根表的声韵仍可能是稳定版；qf 拆分表是当前正式交付的
      // 逐根编码来源，存在时必须覆盖旧行。没有逐根证据才保留旧行/大码兜底。
      const displayAlias = DISPLAY_ALIASES.get(root);
      const qfSuffix = fallback.get(`${key.toUpperCase()}\0${root}`)
        ?? (displayAlias && fallback.get(`${key.toUpperCase()}\0${displayAlias}`));
      if (qfSuffix !== undefined) byRoot.set(root, qfSuffix);
      else if (!byRoot.has(root)) byRoot.set(root, oldKey.toLowerCase());
    }
    const entries = orderedRoots.map((f) => ({ f, s: byRoot.get(f) }));
    for (const entry of [...entries]) {
      const alias = DISPLAY_ALIASES.get(entry.f);
      if (alias && !entries.some((item) => item.f === alias && item.s === entry.s)) {
        entries.push({ f: alias, s: entry.s });
      }
    }
    output[key] = entries;
  }
  return output;
}

export function mergeCandidateDisplayRoots(roots, candidatePayload) {
  const output = structuredClone(roots);
  for (const candidate of candidatePayload.candidates || []) {
    const entries = output[candidate.key] || (output[candidate.key] = []);
    const hasCanonical = entries.some((entry) => entry.f === candidate.canonical && entry.s === candidate.suffix);

    // Yuniversus 的 PUA 显示字形有时与族根中的标准字根是同一语义身份。
    // 同时渲染两者会在字体中显示成重复字根（例如 c/i 的两个“纟”）。
    // 标准字根仍可精确匹配；只有缺少标准根时才保留 PUA 作为显示候选。
    if (hasCanonical) {
      const hiddenGlyphs = new Set((candidate.glyphs || []).filter((glyph) => glyph !== candidate.canonical));
      if (hiddenGlyphs.size) {
        output[candidate.key] = entries.filter((entry) => !(entry.s === candidate.suffix && hiddenGlyphs.has(entry.f)));
      }
    }

    if (candidate.confidence !== 'reviewed') continue;
    const targetEntries = output[candidate.key];
    for (const glyph of candidate.glyphs || []) {
      if (!targetEntries.some((entry) => entry.f === glyph && entry.s === candidate.suffix)) {
        targetEntries.push({ f: glyph, s: candidate.suffix });
      }
    }
  }
  return output;
}

// Compatibility export for existing consumers/tests. It now handles all display candidates,
// not only manually reviewed additions.
export const mergeReviewedRoots = mergeCandidateDisplayRoots;

export function validateRootIdentityCoverage(roots, chaifenText, candidatePayload) {
  const exact = new Set();
  for (const [key, entries] of Object.entries(roots)) {
    for (const entry of entries) exact.add(`${key}\0${entry.f}\0${entry.s}`);
  }
  const decided = new Set();
  for (const item of [...(candidatePayload.candidates || []), ...(candidatePayload.noCandidate || [])]) {
    decided.add(`${item.key}\0${item.canonical}\0${item.suffix}`);
  }
  const missing = new Set();
  for (const [char, value] of Object.entries(parseChaifen(chaifenText))) {
    const [rootText, , perRoots = ''] = value.split('\t');
    const rootTokens = tokenizeRoots(rootText);
    const codeTokens = perRoots ? perRoots.split('-') : [];
    if (rootTokens.length !== codeTokens.length) {
      throw new Error(`qf 拆分根数与逐根码数不一致: ${char}`);
    }
    for (let i = 0; i < rootTokens.length; i++) {
      const match = /^([A-Z])([a-z]*)$/u.exec(codeTokens[i]);
      if (!match) throw new Error(`qf 逐根码格式无效: ${char}/${codeTokens[i]}`);
      const identity = `${match[1].toLowerCase()}\0${rootTokens[i]}\0${match[2]}`;
      if (!exact.has(identity) && !decided.has(identity)) missing.add(identity);
    }
  }
  if (missing.size) throw new Error(`qf 字根显示身份未覆盖: ${Array.from(missing).sort().join(', ')}`);
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function validateCandidateDelivery(payload, permutation, csv, font, encoding) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.candidates) || !Array.isArray(payload.noCandidate)) {
    throw new Error('gallming 字根候选 schema/version 无效');
  }
  if (payload.layout?.damaOrder !== DAMA_ORDER || payload.layout?.perm !== permutation) throw new Error('gallming 候选布局契约无效');
  if (JSON.stringify(payload.encoding) !== JSON.stringify(encoding)) {
    throw new Error('gallming 候选编码变体与 best_perm.json 不一致');
  }
  const keyMap = new Map(Array.from(DAMA_ORDER, (oldKey, i) => [oldKey, permutation[i]]));
  const identities = new Set();
  const glyphOwners = new Map();
  for (const item of [...payload.candidates, ...payload.noCandidate]) {
    if (typeof item.canonical !== 'string' || !item.canonical || !/^[A-Z][a-z]*$/u.test(item.sourceCode || '')) {
      throw new Error('gallming 候选身份字段无效');
    }
    const expectedKey = keyMap.get(item.sourceCode[0]);
    if (!expectedKey || item.key !== expectedKey || item.suffix !== item.sourceCode.slice(1)) {
      throw new Error(`gallming 候选键位与 sourceCode 不一致: ${item.canonical}/${item.sourceCode}`);
    }
    const identity = `${item.canonical}\0${item.sourceCode}`;
    if (identities.has(identity)) throw new Error(`gallming 候选身份重复: ${item.canonical}/${item.sourceCode}`);
    identities.add(identity);
    if ('glyphs' in item) {
      const expectedProvenance = item.confidence === 'verified' ? 'self-chaifen'
        : item.confidence === 'reviewed' ? 'maintainer-review' : null;
      if (!expectedProvenance || item.provenance !== expectedProvenance || !Array.isArray(item.glyphs) || !item.glyphs.length) {
        throw new Error(`gallming 候选置信信息无效: ${item.canonical}/${item.sourceCode}`);
      }
      for (const glyph of item.glyphs) {
        if (typeof glyph !== 'string' || Array.from(glyph).length !== 1) throw new Error('gallming 候选 glyph 必须是单个码点');
        const owner = glyphOwners.get(glyph);
        if (owner) throw new Error(`gallming glyph 重复或身份冲突: ${glyph}`);
        glyphOwners.set(glyph, identity);
      }
    } else if (item.status !== 'unresolved-reviewed' || typeof item.reason !== 'string') {
      throw new Error(`gallming noCandidate 状态无效: ${item.canonical}`);
    }
  }
  const meta = payload.sources;
  if (!meta || meta.version !== 1 || meta.mapping?.file !== 'yuniversus-chaipua.csv' || meta.font?.file !== 'Yuniversus.woff'
      || meta.mapping.url !== 'https://shurufa.app/fonts/yuniversus-chaipua.csv'
      || meta.font.url !== 'https://shurufa.app/fonts/Yuniversus.woff') {
    throw new Error('Yuniversus 资源契约无效');
  }
  if (sha256(csv) !== meta.mapping.sha256 || sha256(font) !== meta.font.sha256) throw new Error('Yuniversus 资源 SHA-256 不匹配');
  const csvLines = csv.toString('utf8').trimEnd().split(/\r?\n/u);
  if (csvLines.shift() !== 'yuniversus,chaipua,ispua' || !csvLines.length) throw new Error('Yuniversus CSV 表头或内容无效');
  for (const line of csvLines) {
    const [yuniversus, chaipua, ispua, extra] = line.split(',');
    if (extra !== undefined || Array.from(yuniversus || '').length !== 1 || !/^(?:[0-9a-f]{4,6})?$/u.test(chaipua || '') || !/^(?:yes)?$/u.test(ispua || '')) {
      throw new Error('Yuniversus CSV 行格式无效');
    }
  }
  if (font.length < 12 || font.subarray(0, 4).toString('ascii') !== 'wOFF') throw new Error('Yuniversus 字体不是有效 WOFF');
  return payload;
}

function validateQfEncoding(encoding) {
  if (!encoding || encoding.q_mode !== 'direct' || encoding.zero_key !== 'f'
      || Object.keys(encoding).length !== 2) {
    throw new Error('best_perm.json 未声明受支持的 qf 编码变体（direct/f）');
  }
  return encoding;
}

function pythonStyleJson(value) {
  if (Array.isArray(value)) return `[${value.map(pythonStyleJson).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${pythonStyleJson(item)}`).join(', ')}}`;
  }
  return JSON.stringify(value);
}

function argsOf(argv) {
  const args = { check: false, source: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--source' && argv[i + 1]) args.source = resolve(argv[++i]);
    else throw new Error(`未知参数: ${argv[i]}\n用法: node scripts/sync-gallming.mjs [--source <本地仓库>] [--check]`);
  }
  return args;
}

export function transactionalWrite(entries, io = {}, warn = console.warn) {
  const fs = { existsSync, mkdirSync, writeFileSync, renameSync, rmSync, ...io };
  const staged = [];
  const backups = [];
  const installed = [];
  try {
    for (const [path, contents] of entries) {
      fs.mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.tmp-${process.pid}`;
      fs.writeFileSync(temporary, contents, 'utf8');
      staged.push([path, temporary]);
    }
    for (const [path, temporary] of staged) {
      const backup = `${path}.bak-${process.pid}`;
      if (fs.existsSync(path)) { fs.renameSync(path, backup); backups.push([path, backup]); }
      fs.renameSync(temporary, path);
      installed.push(path);
    }
  } catch (error) {
    for (const path of installed) fs.rmSync(path, { force: true });
    for (const [path, backup] of backups.reverse()) {
      if (fs.existsSync(backup)) fs.renameSync(backup, path);
    }
    throw error;
  } finally {
    for (const [, temporary] of staged) fs.rmSync(temporary, { force: true });
  }
  // Commit point: all targets are installed. Backup cleanup must never roll back committed files.
  for (const [, backup] of backups) {
    try { fs.rmSync(backup, { force: true }); }
    catch (error) { warn(`gallming 备份清理失败（新文件已提交）: ${backup}: ${error.message}`); }
  }
}

export function locateUpstreamRoot(source) {
  if (existsSync(join(source, 'out/gallming.dict.yaml'))) return source;
  const legacyNested = join(source, 'gallming');
  if (existsSync(join(legacyNested, 'out/gallming.dict.yaml'))) return legacyNested;
  throw new Error(`找不到 gallming 仓库交付物: ${source}`);
}

export function generate(source, projectRoot, expected = { codeEntries: 21653, chars: 20993 }) {
  const base = locateUpstreamRoot(source);
  const read = (relative) => readFileSync(join(base, relative), 'utf8');
  const mainYaml = read('out/gallming.dict.yaml');
  const chaifenYaml = read('out/gallming_chaifen.dict.yaml');
  const rootsYaml = read('data/yuling.roots.dict.yaml');
  const best = JSON.parse(read('out/best_perm.json'));
  const candidatesText = read('out/gallming_root_candidates.json');
  const candidates = JSON.parse(candidatesText);
  const permutation = Array.isArray(best.perm) ? best.perm.join('') : '';
  if (permutation.length !== 20 || new Set(permutation).size !== 20) throw new Error('best_perm.json 中的 perm 无效');
  const encoding = validateQfEncoding(best.encoding);
  const csv = readFileSync(join(base, 'data/yuniversus-chaipua.csv'));
  const font = readFileSync(join(base, 'data/Yuniversus.woff'));
  validateCandidateDelivery(candidates, permutation, csv, font, encoding);
  const targets = {
    'assets/code-tables/mabiao-ling.txt': buildCodeTable(mainYaml),
    'assets/data/chaifen-ling.json': pythonStyleJson(parseChaifen(chaifenYaml)),
  };
  const displayRoots = mergeCandidateDisplayRoots(buildRoots(rootsYaml, chaifenYaml, permutation), candidates);
  if (expected.validateIdentities !== false) validateRootIdentityCoverage(displayRoots, chaifenYaml, candidates);
  targets['assets/data/zigen-ling.json'] = pythonStyleJson(displayRoots);
  targets['assets/data/gallming-root-candidates.json'] = `${JSON.stringify(candidates, null, 2)}\n`;
  targets['assets/data/yuniversus-chaipua.csv'] = csv;
  targets['assets/fonts/Yuniversus.woff'] = font;
  const chaifen = JSON.parse(targets['assets/data/chaifen-ling.json']);
  if (targets['assets/code-tables/mabiao-ling.txt'].split('\n').filter(Boolean).length !== expected.codeEntries) throw new Error(`主码表条目数不是预期的 ${expected.codeEntries}`);
  if (Object.keys(chaifen).length !== expected.chars) throw new Error(`拆分字数不是预期的 ${expected.chars}`);
  const codeTable = targets['assets/code-tables/mabiao-ling.txt'];
  const qfExamples = { '的': 'e', '年': 'rda', '久': 'blu', '其': 'xqi', '宇': 'htmo' };
  for (const [char, code] of Object.entries(qfExamples)) {
    if (!codeTable.includes(`${code}\t${char}\n`)) throw new Error(`qf 关键编码校验失败：${char} 应为 ${code}`);
  }
  if (chaifen['宇'] !== '宀一{于下}\tHTMo\tHa-Ti-Mo'
      || chaifen['年'] !== '{乞上}㐄\tRDka\tRo-Dka'
      || chaifen['久'] !== '⺈乀\tBLu\tBi-Lu'
      || chaifen['其'] !== '其\tXqi\tXqi') {
    throw new Error('qf 关键拆分编码校验失败');
  }
  return targets;
}

export function main(argv = process.argv.slice(2), options = {}) {
  const args = argsOf(argv);
  const projectRoot = options.projectRoot || resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let source = args.source;
  let temporary = null;
  try {
    if (source) {
      if (!statSync(source).isDirectory()) throw new Error(`--source 不是目录: ${source}`);
    } else {
      const makeTemp = options.makeTemp || (() => mkdtempSync(join(tmpdir(), 'typepadv-gallming-')));
      const clone = options.clone || ((target) => execFileSync('git', ['clone', '--depth', '1', UPSTREAM_URL, target], { stdio: 'inherit' }));
      temporary = makeTemp();
      clone(temporary);
      source = temporary;
    }
    const targets = generate(source, projectRoot, options.expected);
    const changed = [];
    for (const [relative, contents] of Object.entries(targets)) {
      const target = join(projectRoot, relative);
      let current = null;
      const wanted = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
      try { current = readFileSync(target); } catch { /* missing */ }
      if (!current || !current.equals(wanted)) {
        changed.push(relative);
      }
    }
    if (args.check && changed.length) throw new Error(`gallming 资产不是最新版本:\n- ${changed.join('\n- ')}`);
    if (!args.check && changed.length) transactionalWrite(changed.map((relative) => [join(projectRoot, relative), targets[relative]]));
    console.log(changed.length ? `已更新 ${changed.length} 个 gallming 资产` : 'gallming 资产已是最新版本');
  } finally {
    if (temporary) (options.cleanup || ((path) => rmSync(path, { recursive: true, force: true })))(temporary);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`同步失败: ${error.message}`); process.exitCode = 1; }
}
