#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UPSTREAM_URL = 'https://git.nas.verf.uk/verf/gallming.git';
const DAMA_ORDER = 'BCDFGHJKLMNPQRSTVWXY';
const DELIVERY_CHAR = (ch) => Array.from(ch).length === 1 && (ch === '〇' || /[\u4e00-\u9fff]/u.test(ch));

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
    result[char] = `${parts[0]}\t${parts[1]}`;
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

function fallbackSuffixes(chaifenText) {
  const found = new Map();
  for (const line of yamlBody(chaifenText)) {
    const [, value] = line.split('\t');
    if (!value?.startsWith('[') || !value.endsWith(']')) continue;
    const parts = value.slice(1, -1).split(',');
    const roots = Array.from(parts[0] || '');
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
    for (const root of groups.get(oldKey)) {
      if (!byRoot.has(root)) byRoot.set(root, fallback.get(`${key.toUpperCase()}\0${root}`) ?? oldKey.toLowerCase());
    }
    // 族根串是完整权威清单，顺序也来自上游；仅在其后补充声韵表中的异体。
    const orderedRoots = [...groups.get(oldKey), ...(rows.get(oldKey) || []).map((entry) => entry.f)]
      .filter((root, index, all) => all.indexOf(root) === index);
    output[key] = orderedRoots.map((f) => ({ f, s: byRoot.get(f) }));
  }
  return output;
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
  const permutation = Array.isArray(best.perm) ? best.perm.join('') : '';
  if (permutation.length !== 20 || new Set(permutation).size !== 20) throw new Error('best_perm.json 中的 perm 无效');
  const targets = {
    'assets/code-tables/mabiao-ling.txt': buildCodeTable(mainYaml),
    'assets/data/chaifen-ling.json': pythonStyleJson(parseChaifen(chaifenYaml)),
  };
  targets['assets/data/zigen-ling.json'] = pythonStyleJson(buildRoots(rootsYaml, chaifenYaml, permutation));
  const chaifen = JSON.parse(targets['assets/data/chaifen-ling.json']);
  if (targets['assets/code-tables/mabiao-ling.txt'].split('\n').filter(Boolean).length !== expected.codeEntries) throw new Error(`主码表条目数不是预期的 ${expected.codeEntries}`);
  if (Object.keys(chaifen).length !== expected.chars) throw new Error(`拆分字数不是预期的 ${expected.chars}`);
  if (!targets['assets/code-tables/mabiao-ling.txt'].includes('ftmo\t宇\n') || chaifen['宇'] !== '宀一{于下}\tFTMo') throw new Error('关键编码校验失败：应为 宇=ftmo / FTMo');
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
      try { current = readFileSync(target, 'utf8').replace(/\r\n/gu, '\n'); } catch { /* missing */ }
      if (current !== contents) {
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
