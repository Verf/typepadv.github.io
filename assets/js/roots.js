// roots.js - 宇浩星陈字根图：在虚拟键盘键面上渲染字根网格
// 数据源：assets/data/zigen-star.json（来自官方 shurufa.app/zigen-star.csv）
// 结构：{ "A": [{f: 字根, s: 小码}, ...], ... } 大码 A-Y（无 Z，Z 官网为空键）

import { QWERTY_ROWS } from './layout.js';

const ZIGEN_URL = 'assets/data/zigen-star.json';

let zigenCache = null; // { A: [{f,s}], ... }

/** 加载字根数据（幂等，带缓存） */
export async function loadZigenData() {
  if (zigenCache) return zigenCache;
  try {
    const resp = await fetch(ZIGEN_URL);
    zigenCache = await resp.json();
  } catch (e) {
    console.warn('字根数据加载失败', e);
    zigenCache = {};
  }
  return zigenCache;
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

/**
 * 在虚拟键盘容器上渲染字根图。
 * @param {HTMLElement} container 键盘容器（含 .kb-key 键元素，dataset.cap 为键帽）
 * @param {object} layoutMap 当前布局映射（null=qwerty）
 * @param {boolean} enabled 是否启用字根图
 */
export function renderZigenOnKeyboard(container, layoutMap, enabled) {
  const data = zigenCache || {};
  container.querySelectorAll('.kb-key').forEach((keyEl) => {
    const existing = keyEl.querySelector('.zigen-wrap');
    if (existing) existing.remove();

    if (!enabled) return;
    const cap = keyEl.dataset.cap;
    if (!cap || !/^[a-z]$/i.test(cap)) return; // 只对字母键显示字根

    // 该键帽对应的 qwerty 字母（布局映射反查：目标键帽 → qwerty 原字母）
    const qwertyLetter = reverseLookup(layoutMap, cap);
    const big = qwertyLetter.toUpperCase();
    const roots = data[big];
    if (!roots || roots.length === 0) return;

    // 大码显示（翻译后）；原键帽字母由大码代替，清空 textContent
    const bigTranslated = translateBig(qwertyLetter, layoutMap);

    // 字根网格
    const wrap = document.createElement('div');
    wrap.className = 'zigen-wrap';
    wrap.innerHTML = `
      <div class="zigen-big">${bigTranslated}</div>
      <div class="zigen-grid">
        ${roots.map((r) => {
          const small = translateSmall(r.s, layoutMap);
          return `<span class="zigen-item" title="${r.f}（${big}${r.s}）">` +
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

/** 清空字根（切到非星陈方案/关闭时） */
export function clearZigen(container) {
  container.querySelectorAll('.zigen-wrap').forEach((el) => el.remove());
}

export default { loadZigenData, renderZigenOnKeyboard, clearZigen };