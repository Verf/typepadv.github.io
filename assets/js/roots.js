// roots.js - 字根图：在虚拟键盘键面上渲染字根网格（按方案多源）
// 星陈数据源：assets/data/zigen-star.json（397字根，26键A-Y，Z为空）
//   结构：{ "A": [{f: 字根, s: 小码}, ...], ... } 大码 A-Y
// 灵铭（gallming）数据源：assets/data/zigen-ling.json（文件名为兼容性遗留，20个 Gallman 辅音键）
//   结构：{ "p": [{f: 字根, s: 根码后缀}, ...], ... }；成字根后缀=规范声码+韵码，构件根=韵码

import { QWERTY_ROWS } from './layout.js';

let zigenCache = null; // { 键: [{f,s}], ... }
let currentUrl = null;
let zigenGeneration = 0;
let rootCandidates = null;
let candidateIndex = new Map();
let candidateGeneration = 0;
let gallmingFamilyKeys = new Map();
let gallmingKeyFamilies = new Map();

/** 加载字根数据（幂等；url 变化时重新加载） */
export async function loadZigenData(url) {
  if (!url) return null;
  if (currentUrl === url && zigenCache) return zigenCache;
  const generation = ++zigenGeneration;
  currentUrl = url;
  zigenCache = null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();
    if (generation !== zigenGeneration || currentUrl !== url) return null;
    zigenCache = payload;
  } catch (e) {
    console.warn('字根数据加载失败', e);
    if (generation === zigenGeneration && currentUrl === url) zigenCache = {};
  }
  return zigenCache;
}

export async function loadRootCandidates(url) {
  const generation = ++candidateGeneration;
  if (!url) { rootCandidates = null; candidateIndex = new Map(); gallmingFamilyKeys = new Map(); gallmingKeyFamilies = new Map(); return null; }
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();
    if (payload?.version !== 1 || !Array.isArray(payload.candidates)) throw new Error('候选 schema/version 无效');
    const nextIndex = new Map();
    const order = payload.layout?.damaOrder;
    const perm = payload.layout?.perm;
    if (typeof order !== 'string' || typeof perm !== 'string' || order.length !== perm.length) throw new Error('候选布局字段无效');
    const familyKeys = new Map(Array.from(order, (family, index) => [family, perm[index]]));
    const glyphs = new Set();
    for (const item of payload.candidates) {
      if (!item?.canonical || !/^[A-Z][a-z]*$/u.test(item.sourceCode || '') || !Array.isArray(item.glyphs)) {
        throw new Error('候选身份字段无效');
      }
      const expectedProvenance = item.confidence === 'verified' ? 'self-chaifen'
        : item.confidence === 'reviewed' ? 'maintainer-review' : null;
      if (!expectedProvenance || item.provenance !== expectedProvenance || !item.glyphs.length
          || item.glyphs.some((glyph) => typeof glyph !== 'string' || Array.from(glyph).length !== 1)) {
        throw new Error('候选置信或字形字段无效');
      }
      if (item.key !== familyKeys.get(item.sourceCode[0]) || item.suffix !== item.sourceCode.slice(1)) throw new Error('候选键位与 sourceCode 不一致');
      const identity = `${item.canonical}\0${item.sourceCode}`;
      if (nextIndex.has(identity)) throw new Error('候选身份重复');
      for (const glyph of item.glyphs) {
        if (glyphs.has(glyph)) throw new Error('候选 glyph 重复或冲突');
        glyphs.add(glyph);
      }
      nextIndex.set(identity, item);
    }
    if (generation !== candidateGeneration) return null;
    rootCandidates = payload;
    candidateIndex = nextIndex;
    gallmingFamilyKeys = familyKeys;
    gallmingKeyFamilies = new Map(Array.from(order, (family, index) => [perm[index].toUpperCase(), family]));
  } catch (e) {
    console.warn('Gallming 字根候选加载失败', e);
    if (generation === candidateGeneration) { rootCandidates = null; candidateIndex = new Map(); gallmingFamilyKeys = new Map(); gallmingKeyFamilies = new Map(); }
  }
  return rootCandidates;
}

export function candidateForIdentity(root, sourceCode) {
  const candidate = candidateIndex.get(`${root}\0${sourceCode}`);
  return candidate && (candidate.confidence === 'verified' || candidate.confidence === 'reviewed') ? candidate : null;
}

export function gallmingKeyForSourceCode(sourceCode) {
  return gallmingFamilyKeys.get(sourceCode?.[0]) || null;
}

export function gallmingIdentityCodeForRootCode(rootCode) {
  const family = gallmingKeyFamilies.get(rootCode?.[0]);
  return family ? `${family}${rootCode.slice(1)}` : null;
}

/**
 * 渲染字根图到虚拟键盘。
 * @param {HTMLElement} container 键盘容器（含 .kb-key 元素，dataset.cap 为键帽）
 * @param {object} layoutMap 布局翻译映射（当前布局用；字根按 qwerty 反查时用）
 * @param {boolean} enabled 是否启用字根图
 * @param {object} opts { layoutId, zigenMode }
 *   zigenMode: 'qwerty-base'（星陈：数据键=QWERTY大码，按当前布局反查键帽）
 *              'keycap'（灵铭：数据键=键帽本身，直接匹配）
 */
export function renderZigenOnKeyboard(container, layoutMap, enabled, opts = {}) {
  const data = zigenCache || {};
  const zigenMode = opts.zigenMode || 'qwerty-base';
  container.querySelectorAll('.kb-key').forEach((keyEl) => {
    const existing = keyEl.querySelector('.zigen-wrap');
    if (existing) existing.remove();

    if (!enabled) return;
    const cap = keyEl.dataset.cap;
    if (!cap || !/^[a-z]$/i.test(cap)) return; // 只对字母键显示字根

    let entries = null;
    let bigLabel = cap.toUpperCase();
    if (zigenMode === 'keycap') {
      // Gallming 数据键基于 Gallman；按与编码相同的「基准布局→当前布局」映射定位。
      const sourceCap = reverseLookup(opts.baseToCurrentMap, cap);
      entries = data[sourceCap.toLowerCase()];
      bigLabel = cap.toUpperCase();
    } else {
      // 星陈：数据键为 QWERTY 大码，反查当前布局键帽对应的原 qwerty 字母
      const qwertyLetter = reverseLookup(layoutMap, cap);
      const big = qwertyLetter.toUpperCase();
      entries = data[big];
      if (!entries || entries.length === 0) return;
      bigLabel = translateBig(qwertyLetter, layoutMap);
    }
    if (!entries || entries.length === 0) return;

    // 动态列数：按键宽自适应（字根 13px + 间距，避免文字溢出重叠）
    const keyWidth = keyEl.getBoundingClientRect().width || 80;
    const cols = Math.max(3, Math.min(6, Math.floor((keyWidth - 8) / 15)));
    const wrap = document.createElement('div');
    wrap.className = 'zigen-wrap';
    const bigEl = document.createElement('div');
    bigEl.className = 'zigen-big';
    bigEl.textContent = bigLabel;
    const grid = document.createElement('div');
    grid.className = 'zigen-grid';
    grid.style.gridTemplateColumns = `repeat(${cols},minmax(0,1fr))`;
    grid.style.gap = '2px 1px';
    for (const r of entries) {
      const small = (zigenMode === 'keycap') ? r.s : translateSmall(r.s, layoutMap);
      const item = document.createElement('span');
      item.className = 'zigen-item';
      item.dataset.root = r.f;
      item.dataset.big = cap.toLowerCase();
      item.dataset.small = r.s;
      item.title = `${r.f}（${bigLabel}${r.s}）`;
      const font = document.createElement('span');
      font.className = 'zigen-font';
      font.textContent = r.f;
      const smallEl = document.createElement('span');
      smallEl.className = 'zigen-small';
      smallEl.textContent = small;
      item.append(font, smallEl);
      grid.append(item);
    }
    wrap.append(bigEl, grid);
    keyEl.textContent = ''; // 清除原键帽字母（大码已代表）
    keyEl.prepend(wrap);
  });
}

/**
 * 反查：目标布局键帽 → qwerty 原字母。
 * layoutMap 是 qwerty→目标 映射；遍历找 value===cap 的 key。
 * 未找到（原样键帽）则返回 cap 本身。
 */
function reverseLookup(layoutMap, cap) {
  const c = cap.toLowerCase();
  if (!layoutMap) return c;
  for (const [q, target] of Object.entries(layoutMap)) {
    if (target === c) return q;
  }
  return c; // 键帽未映射（原样或符号）
}

/**
 * 把大码字母翻译为当前布局键帽。
 * @param {string} big 大码字母（A-Z）
 * @param {object} layoutMap qwerty→目标 映射（null = qwerty 不翻译）
 */
function translateBig(big, layoutMap) {
  if (!layoutMap) return big.toUpperCase();
  const m = layoutMap[big.toLowerCase()];
  return (m || big).toUpperCase();
}

/**
 * 小码翻译（单字母 → 布局键帽）。
 */
function translateSmall(small, layoutMap) {
  if (!small) return '';
  if (!layoutMap) return small;
  return layoutMap[small] || small;
}

/** 清空字根（切到非星陈方案/关闭时） */
export function clearZigen(container) {
  container.querySelectorAll('.zigen-wrap').forEach((el) => el.remove());
}

export default { loadZigenData, loadRootCandidates, candidateForIdentity, gallmingKeyForSourceCode, gallmingIdentityCodeForRootCode, renderZigenOnKeyboard, clearZigen };
