// roots.js - 字根图：在虚拟键盘键面上渲染字根网格（按方案多源）
// 星陈数据源：assets/data/zigen-star.json（397字根，26键A-Y，Z为空）
//   结构：{ "A": [{f: 字根, s: 小码}, ...], ... } 大码 A-Y
// 灵铭（gallming）数据源：assets/data/zigen-ling.json（文件名为兼容性遗留，20个 Gallman 辅音键）
//   结构：{ "p": [{f: 字根, s: 声韵}, ...], ... } 键帽=Gallman物理键

import { QWERTY_ROWS } from './layout.js';

let zigenCache = null; // { 键: [{f,s}], ... }
let currentUrl = null;

/** 加载字根数据（幂等；url 变化时重新加载） */
export async function loadZigenData(url) {
  if (!url) return null;
  if (currentUrl === url && zigenCache) return zigenCache;
  currentUrl = url;
  zigenCache = null;
  try {
    const resp = await fetch(url);
    zigenCache = await resp.json();
  } catch (e) {
    console.warn('字根数据加载失败', e);
    zigenCache = {};
  }
  return zigenCache;
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
      // 灵铭：数据键即键帽（Gallman 键），直接匹配
      entries = data[cap.toLowerCase()];
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
    const gridStyle = `grid-template-columns:repeat(${cols},minmax(0,1fr));gap:2px 1px;`;

    // 字根网格
    const wrap = document.createElement('div');
    wrap.className = 'zigen-wrap';
    wrap.innerHTML = `
      <div class="zigen-big">${bigLabel}</div>
      <div class="zigen-grid" style="${gridStyle}">
        ${entries.map((r) => {
          const small = (zigenMode === 'keycap') ? r.s : translateSmall(r.s, layoutMap);
          return `<span class="zigen-item" title="${r.f}（${bigLabel}${r.s}）">` +
                 `<span class="zigen-font">${r.f}</span>` +
                 `<span class="zigen-small">${small}</span></span>`;
        }).join('')}
      </div>`;
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

export default { loadZigenData, renderZigenOnKeyboard, clearZigen };
