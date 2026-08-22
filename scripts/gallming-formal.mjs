import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DAMA_ORDER = 'BCDFGHJKLMNPQRSTVWXY';
const FORMAL_KEYS = DAMA_ORDER.toLowerCase();
const DELIVERY_CHAR = (ch) => Array.from(ch || '').length === 1 && /^(?:\p{Script=Han}|〇)$/u.test(ch);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function yamlParts(text) {
  const lines = text.split(/\r?\n/u);
  const marker = lines.findIndex((line) => line === '...');
  if (marker < 0) throw new Error('YAML 缺少正文分隔符 ...');
  return { header: lines.slice(0, marker), body: lines.slice(marker + 1) };
}

function yamlVersion(text) {
  const line = yamlParts(text).header.find((item) => /^version:\s*/u.test(item));
  const match = /^version:\s*["']?([^"']+?)["']?\s*$/u.exec(line || '');
  if (!match) throw new Error('YAML 缺少 version');
  return match[1];
}

export function buildFormalCodeTable(text) {
  const lines = [];
  for (const line of yamlParts(text).body) {
    if (!line || line.startsWith('#')) continue;
    const [char, code] = line.split('\t');
    if (DELIVERY_CHAR(char) && /^[a-z]+$/u.test(code || '')) lines.push(`${code}\t${char}`);
  }
  if (!lines.length) throw new Error('gallming 主码表没有可用单字条目');
  return `${lines.join('\n')}\n`;
}

export function parseFormalChaifen(text) {
  const result = {};
  for (const line of yamlParts(text).body) {
    const [char, value] = line.split('\t');
    if (!DELIVERY_CHAR(char) || !value?.startsWith('[') || !value.endsWith(']')) continue;
    const parts = value.slice(1, -1).split(',');
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error(`拆分条目格式错误: ${char}`);
    result[char] = `${parts[0]}\t${parts[1]}\t${parts[2]}`;
  }
  if (!Object.keys(result).length) throw new Error('gallming 拆分表没有可用单字条目');
  return result;
}

export function tokenizeFormalRoots(value) {
  const roots = [];
  for (let i = 0; i < value.length;) {
    if (/\s/u.test(value[i])) { i += 1; continue; }
    if (value.startsWith('...', i)) { i += 3; continue; }
    if (value[i] === '…') { i += 1; continue; }
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

function rootSuffix(sound) {
  if (!sound || !/^[aeiou]$/u.test(sound.rhyme || '')) throw new Error(`字根缺少规范韵码: ${sound?.root || 'unknown'}`);
  if (sound.noncanonical) throw new Error(`正式版不得包含非规范声码: ${sound.root}`);
  const selected = sound.selected || '';
  if (selected && !/^[b-df-hj-np-tv-z]$/u.test(selected)) throw new Error(`字根声码无效: ${sound.root}/${selected}`);
  return `${selected}${sound.rhyme}`;
}

export function validateFormalRelease(release, shortcodes, releaseText = '') {
  if (!release || release.version !== 2 || release.release_status !== 'formal'
      || release.root_sound_policy !== 'standalone_canonical'
      || !Array.isArray(release.bundles) || !Array.isArray(release.sounds)) {
    throw new Error('max5_candidate.json 不是纯规范声码五码正式版');
  }
  if (!shortcodes || shortcodes.version !== 3 || shortcodes.direct_audit_ok !== true
      || !Array.isArray(shortcodes.entries) || shortcodes.two_rule !== '首大＋整字韵') {
    throw new Error('max5_shortcodes.json 正式简码契约无效');
  }
  if (releaseText && shortcodes.source?.sha256 !== sha256(releaseText)) throw new Error('简码引用的 max5_candidate.json SHA-256 不匹配');

  const roots = new Set();
  const keys = new Set();
  for (const bundle of release.bundles) {
    if (!bundle?.canonical || !Array.isArray(bundle.roots) || !bundle.roots.length || !FORMAL_KEYS.includes(bundle.key)) {
      throw new Error('正式版字根束字段无效');
    }
    keys.add(bundle.key);
    for (const root of bundle.roots) {
      if (roots.has(root)) throw new Error(`正式版字根重复: ${root}`);
      roots.add(root);
    }
  }
  if (keys.size !== 20 || Array.from(FORMAL_KEYS).some((key) => !keys.has(key))) throw new Error('正式版必须覆盖 20 个辅音大码键');

  const sounds = new Map();
  for (const sound of release.sounds) {
    if (!sound?.root || sounds.has(sound.root)) throw new Error(`正式版字根读音重复或缺失: ${sound?.root || 'unknown'}`);
    rootSuffix(sound);
    sounds.set(sound.root, sound);
  }
  const missing = Array.from(roots).filter((root) => !sounds.has(root));
  const stale = Array.from(sounds.keys()).filter((root) => !roots.has(root));
  if (missing.length || stale.length) throw new Error(`正式版字根与声韵表不一致: missing=${missing.join(',')} stale=${stale.join(',')}`);
  if (shortcodes.metrics?.target_chars < 1
      || shortcodes.entries.length !== (shortcodes.metrics.one_count || 0) + (shortcodes.metrics.two_count || 0)) {
    throw new Error('正式版简码计数无效');
  }
  return release;
}

export function validateYuniversusDelivery(payload, csv, font) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.candidates) || !Array.isArray(payload.noCandidate)) {
    throw new Error('gallming 字根候选 schema/version 无效');
  }
  const order = payload.layout?.damaOrder;
  const permutation = payload.layout?.perm;
  if (order !== DAMA_ORDER || typeof permutation !== 'string' || permutation.length !== 20 || new Set(permutation).size !== 20) {
    throw new Error('gallming 字根候选布局契约无效');
  }
  const keyMap = new Map(Array.from(order, (oldKey, index) => [oldKey, permutation[index]]));
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
        if (owner && owner !== identity) throw new Error(`gallming glyph 重复或身份冲突: ${glyph}`);
        glyphOwners.set(glyph, identity);
      }
    } else if (item.status !== 'unresolved-reviewed' || typeof item.reason !== 'string') {
      throw new Error(`gallming noCandidate 状态无效: ${item.canonical}`);
    }
  }
  const meta = payload.sources;
  if (!meta || meta.version !== 1 || meta.mapping?.file !== 'yuniversus-chaipua.csv' || meta.font?.file !== 'Yuniversus.woff'
      || meta.mapping.url !== 'https://shurufa.app/fonts/yuniversus-chaipua.csv'
      || meta.font.url !== 'https://shurufa.app/fonts/Yuniversus.woff') throw new Error('Yuniversus 资源契约无效');
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

function bundleIndex(release) {
  const byRoot = new Map();
  for (const bundle of release.bundles) {
    byRoot.set(bundle.canonical, bundle);
    for (const root of bundle.roots) byRoot.set(root, bundle);
  }
  return byRoot;
}

export function buildFormalRoots(release, upstreamCandidates) {
  const byRoot = bundleIndex(release);
  const sounds = new Map(release.sounds.map((sound) => [sound.root, sound]));
  const relevant = (item) => byRoot.has(item.canonical);
  const convertCandidate = (item) => {
    const bundle = byRoot.get(item.canonical);
    const sound = sounds.get(item.canonical) || sounds.get(bundle.canonical);
    const suffix = rootSuffix(sound);
    return { ...item, sourceCode: `${bundle.key.toUpperCase()}${suffix}`, key: bundle.key, suffix };
  };
  const candidates = upstreamCandidates.candidates.filter(relevant).map(convertCandidate);
  const noCandidate = upstreamCandidates.noCandidate.filter(relevant).map(convertCandidate);
  const candidateByRoot = new Map(candidates.map((item) => [item.canonical, item]));
  const roots = Object.fromEntries(Array.from(FORMAL_KEYS, (key) => [key, []]));

  for (const bundle of release.bundles) {
    for (const root of bundle.roots) {
      const suffix = rootSuffix(sounds.get(root));
      const candidate = candidateByRoot.get(root) || candidateByRoot.get(bundle.canonical);
      const glyphs = Array.from(root).length === 1 ? [root] : (candidate?.glyphs || []);
      if (!glyphs.length) throw new Error(`结构字根缺少 Yuniversus 单字形: ${root}`);
      for (const glyph of glyphs) {
        if (!roots[bundle.key].some((entry) => entry.f === glyph && entry.s === suffix)) roots[bundle.key].push({ f: glyph, s: suffix });
      }
    }
  }

  const candidatePayload = {
    ...upstreamCandidates,
    layout: { damaOrder: DAMA_ORDER, perm: FORMAL_KEYS },
    encoding: { max_code_length: 5, root_sound_policy: 'standalone_canonical' },
    summary: {
      ...(upstreamCandidates.summary || {}),
      release_status: 'formal',
      root_sound_policy: 'standalone_canonical',
      formal_candidates: candidates.length,
      formal_no_candidate: noCandidate.length,
    },
    candidates,
    noCandidate,
  };
  return { roots, candidatePayload };
}

export function validateFormalRootCoverage(roots, chaifenText, candidatePayload) {
  const exact = new Set();
  for (const [key, entries] of Object.entries(roots)) for (const entry of entries) exact.add(`${key}\0${entry.f}\0${entry.s}`);
  const candidates = new Map((candidatePayload.candidates || []).map((item) => [`${item.canonical}\0${item.sourceCode}`, item]));
  const missing = new Set();
  for (const [char, value] of Object.entries(parseFormalChaifen(chaifenText))) {
    const [rootText, , perRoots = ''] = value.split('\t');
    const rootTokens = tokenizeFormalRoots(rootText);
    const codeTokens = perRoots.split('-').filter(Boolean);
    if (rootTokens.length !== codeTokens.length) throw new Error(`正式版拆分根数与逐根码数不一致: ${char}`);
    for (let i = 0; i < rootTokens.length; i++) {
      const match = /^([A-Z])([a-z]*)$/u.exec(codeTokens[i]);
      if (!match) throw new Error(`正式版逐根码格式无效: ${char}/${codeTokens[i]}`);
      const [root, sourceCode] = [rootTokens[i], codeTokens[i]];
      const key = match[1].toLowerCase();
      const suffix = match[2];
      if (exact.has(`${key}\0${root}\0${suffix}`)) continue;
      const candidate = candidates.get(`${root}\0${sourceCode}`);
      if (!candidate?.glyphs?.some((glyph) => exact.has(`${key}\0${glyph}\0${suffix}`))) missing.add(`${root}/${sourceCode}`);
    }
  }
  if (missing.size) throw new Error(`正式版字根显示身份未覆盖: ${Array.from(missing).sort().join(', ')}`);
}

function codeMap(codeTable) {
  const result = new Map();
  for (const line of codeTable.trimEnd().split(/\r?\n/u)) {
    const [code, char] = line.split('\t');
    if (!result.has(char)) result.set(char, []);
    if (result.get(char).includes(code)) throw new Error(`码表重复条目: ${char}/${code}`);
    result.get(char).push(code);
  }
  return result;
}

export function validateFormalCodeDelivery(codeTable, chaifen, shortcodes) {
  const codes = codeMap(codeTable);
  const targetChars = shortcodes.metrics.target_chars;
  if (codes.size !== targetChars) throw new Error(`主码表字数不是正式版目标 ${targetChars}: ${codes.size}`);
  if (Object.keys(chaifen).length !== targetChars) throw new Error(`拆分字数不是正式版目标 ${targetChars}: ${Object.keys(chaifen).length}`);
  for (const char of codes.keys()) if (!chaifen[char]) throw new Error(`主码表字符缺少拆分: ${char}`);
  for (const char of Object.keys(chaifen)) if (!codes.has(char)) throw new Error(`拆分字符缺少主码: ${char}`);

  const shortcuts = new Map(shortcodes.entries.map((entry) => [entry.char, entry]));
  if (shortcuts.size !== shortcodes.entries.length) throw new Error('正式版简码字符重复');
  let entries = 0;
  for (const [char, charCodes] of codes) {
    entries += charCodes.length;
    if (charCodes.some((code) => !/^[a-z]{1,5}$/u.test(code))) throw new Error(`码长超出 1-5 键: ${char}/${charCodes.join(',')}`);
    const shortcut = shortcuts.get(char);
    if (shortcut) {
      if (charCodes.length !== 2 || charCodes[0] !== shortcut.code || charCodes[1] !== shortcut.full_code || shortcut.code.length > 2) {
        throw new Error(`简码与全码顺序不一致: ${char}/${charCodes.join(',')}`);
      }
    } else if (charCodes.length !== 1 || charCodes[0].length < 3) {
      throw new Error(`非简码字应且仅应包含一个 3-5 键全码: ${char}/${charCodes.join(',')}`);
    }
  }
  if (entries !== targetChars + shortcodes.entries.length) throw new Error(`主码表条目数无效: ${entries}`);
  return { chars: codes.size, entries, shortcuts: shortcuts.size };
}

function pythonStyleJson(value) {
  if (Array.isArray(value)) return `[${value.map(pythonStyleJson).join(', ')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${pythonStyleJson(item)}`).join(', ')}}`;
  return JSON.stringify(value);
}

export function locateFormalUpstreamRoot(source) {
  if (existsSync(join(source, 'out/gallming.dict.yaml'))) return source;
  const nested = join(source, 'gallming');
  if (existsSync(join(nested, 'out/gallming.dict.yaml'))) return nested;
  throw new Error(`找不到 gallming 仓库交付物: ${source}`);
}

export function generateFormalAssets(source) {
  const base = locateFormalUpstreamRoot(source);
  const read = (relative) => readFileSync(join(base, relative), 'utf8');
  const mainYaml = read('out/gallming.dict.yaml');
  const chaifenYaml = read('out/gallming_chaifen.dict.yaml');
  const releaseText = read('out/max5_candidate.json');
  const release = JSON.parse(releaseText);
  const shortcodes = JSON.parse(read('out/max5_shortcodes.json'));
  const upstreamCandidates = JSON.parse(read('out/gallming_root_candidates.json'));
  const csv = readFileSync(join(base, 'data/yuniversus-chaipua.csv'));
  const font = readFileSync(join(base, 'data/Yuniversus.woff'));

  validateFormalRelease(release, shortcodes, releaseText);
  validateYuniversusDelivery(upstreamCandidates, csv, font);
  const mainVersion = yamlVersion(mainYaml);
  if (mainVersion !== yamlVersion(chaifenYaml) || !/max5/u.test(mainVersion)) throw new Error('主码表与拆分表不是同一五码正式版本');

  const codeTable = buildFormalCodeTable(mainYaml);
  const chaifen = parseFormalChaifen(chaifenYaml);
  const { roots, candidatePayload } = buildFormalRoots(release, upstreamCandidates);
  validateFormalRootCoverage(roots, chaifenYaml, candidatePayload);
  const stats = validateFormalCodeDelivery(codeTable, chaifen, shortcodes);

  const examples = {
    的: ['e', 'vbsl'], 是: ['i', 'jrfx'], 一: ['a', 'fyi'], 中: ['go', 'gkri'],
    宇: ['vfqo'], 年: ['tra'], 久: ['lru'], 其: ['kqi'], 为: ['le', 'ltluw'],
  };
  const parsedCodes = codeMap(codeTable);
  for (const [char, expected] of Object.entries(examples)) {
    if (JSON.stringify(parsedCodes.get(char)) !== JSON.stringify(expected)) throw new Error(`五码正式版关键编码校验失败: ${char}`);
  }
  const chaifenExamples = {
    宇: '宀 一 {于下}\tVFQo\tVa-Fyi-Qo',
    年: '{乞上} 㐄\tTRa\tTo-Ra',
    久: '⺈ 乀\tLRu\tLi-Ru',
    其: '其\tKqi\tKqi',
  };
  for (const [char, expected] of Object.entries(chaifenExamples)) if (chaifen[char] !== expected) throw new Error(`五码正式版关键拆分校验失败: ${char}`);

  const metadata = {
    name: 'gallming', version: mainVersion, release_status: release.release_status,
    root_sound_policy: release.root_sound_policy, max_code_length: 5,
    target_chars: stats.chars, code_entries: stats.entries, shortcodes: stats.shortcuts,
    root_entries: Object.values(roots).reduce((sum, entries) => sum + entries.length, 0),
  };
  return {
    'assets/code-tables/mabiao-ling.txt': codeTable,
    'assets/data/chaifen-ling.json': pythonStyleJson(chaifen),
    'assets/data/zigen-ling.json': pythonStyleJson(roots),
    'assets/data/gallming-root-candidates.json': `${JSON.stringify(candidatePayload, null, 2)}\n`,
    'assets/data/gallming-release.json': `${JSON.stringify(metadata, null, 2)}\n`,
    'assets/data/yuniversus-chaipua.csv': csv,
    'assets/fonts/Yuniversus.woff': font,
  };
}
