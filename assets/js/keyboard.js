// keyboard.js - 虚拟键盘渲染（可单测 DOM 渲染）
// 渲染所选布局的键帽，管理目标键高亮、按键三态反馈、指法着色

import { BUILTIN_LAYOUTS, fingerFor } from './layout.js';

/**
 * 渲染虚拟键盘到容器。
 * @param {HTMLElement} container
 * @param {string} layoutId 'qwerty' | 'gallman' | 自定义
 * @param {Array<Array<string>>} rows 键帽行（若提供则用，否则取内置）
 */
export function renderKeyboard(container, layoutId, rows = null) {
  const layout = BUILTIN_LAYOUTS[layoutId] || null;
  const keyRows = rows || (layout ? layout.rows : BUILTIN_LAYOUTS.qwerty.rows);
  container.innerHTML = '';
  keyRows.forEach((row, r) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'kb-row';
    row.forEach((cap, c) => {
      const key = document.createElement('div');
      key.className = 'kb-key';
      key.dataset.cap = cap;
      key.dataset.row = r;
      key.dataset.col = c;
      key.textContent = cap;
      key.title = cap;
      // 指法
      key.classList.add('f-' + fingerFor(r, c));
      rowDiv.appendChild(key);
    });
    container.appendChild(rowDiv);
  });
}

/**
 * 清除所有按键的临时状态（target/correct/error/pressed），保留指法底色。
 */
export function clearKeyStates(container) {
  container.querySelectorAll('.kb-key').forEach((k) => {
    k.classList.remove('target', 'correct-hit', 'error-hit', 'pressed');
  });
}

/**
 * 设置目标键（高亮当前应按的键帽）。
 * @param {HTMLElement} container
 * @param {string} cap 键帽字符（如 "p" 或 "i"）
 */
export function setTargetKey(container, cap) {
  clearKeyStates(container);
  if (!cap) return;
  const target = cap.toLowerCase();
  container.querySelectorAll('.kb-key').forEach((k) => {
    if (k.dataset.cap === target) k.classList.add('target');
  });
}

/**
 * 反馈一次按键结果。
 * @param {HTMLElement} container
 * @param {string} cap 按下的键帽
 * @param {boolean} correct 是否命中
 */
export function flashKey(container, cap, correct) {
  const target = cap.toLowerCase();
  container.querySelectorAll('.kb-key').forEach((k) => {
    if (k.dataset.cap === target) {
      k.classList.add(correct ? 'correct-hit' : 'error-hit', 'pressed');
      setTimeout(() => {
        k.classList.remove('correct-hit', 'error-hit', 'pressed');
      }, 180);
    }
  });
}

/**
 * 高亮指法分区显示（由 CSS 类控制，这里提供开关）。
 */
export function setFingerColoring(container, enabled) {
  container.classList.toggle('no-finger-color', !enabled);
}