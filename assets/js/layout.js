// layout.js - 键盘布局定义、编码翻译、布局编辑器数据模型

// ---- 布局定义 ----
// 布局 = 物理行 × 物理列。行按 QWERTY 标准：数字行(可选)、顶行、中行、底行。
// qwertyLayout 是基准（物理位置索引）；自定义布局 = 各物理位置放什么键帽。

export const QWERTY_ROWS = [
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
];

// Gallman 布局：30 键，无数字行，3 行 × 10 列（与 QWERTY 顶/中/底行对齐）
export const GALLMAN_ROWS = [
  ['p', 'l', 'd', 'w', 'k', 'j', 'f', 'o', 'u', ';'],
  ['n', 'r', 't', 's', 'g', 'y', 'h', 'a', 'e', 'i'],
  ['z', 'x', 'c', 'v', 'b', 'q', 'm', ',', '.', '/'],
];

// 内置布局注册表
export const BUILTIN_LAYOUTS = {
  qwerty: { id: 'qwerty', name: 'QWERTY（标准）', rows: QWERTY_ROWS },
  gallman: { id: 'gallman', name: 'Gallman（自定义）', rows: GALLMAN_ROWS },
};

// 指法分区（基于 QWERTY 物理位置）：L1-L5 左手小指→拇指，R1-R5 右手
const FINGER_MAP = {};
(function buildFingerMap() {
  // 行 0（数字行）按标准指法；行 1（顶行）行 2（中行）行 3（底行）
  const rows = [
    // 数字行
    ['lp','lp','lr','lm','li','ri','ri','rm','rr','rp','rp','rp','rp'],
    // 顶行
    ['lp','lr','lm','li','li','ri','ri','rm','rr','rp','rp','rp','rp'],
    // 中行（10 键）
    ['lp','lr','lm','li','li','ri','ri','rm','rr','rp','rp'],
    // 底行（10 键）
    ['lp','lr','lm','li','li','ri','ri','rm','rr','rp','rp'], // QWERTY 底行也 10 键
  ];
  QWERTY_ROWS.forEach((row, r) => {
    row.forEach((key, c) => {
      const f = rows[r] && rows[r][c] ? rows[r][c] : 'thumb';
      FINGER_MAP[`${r},${c}`] = f;
    });
  });
})();

export function fingerFor(row, col) {
  return FINGER_MAP[`${row},${col}`] || 'thumb';
}

// ---- 编码翻译 KEY_MAP（qwerty → gallman 键帽，仅字母，未列出 = 原样） ----
export const KEY_MAP = {
  q: 'p', w: 'l', e: 'd', r: 'w', t: 'k', y: 'j', u: 'f',
  i: 'o', o: 'u', p: 'i', a: 'n', s: 'r', d: 't', f: 's',
  h: 'y', j: 'h', k: 'a', l: 'e', n: 'q',
};

/**
 * 由 KEY_MAP 生成完整「qwerty 键帽 → 目标布局键帽」映射表。
 * 对 qwerty 每个字母键：KEY_MAP 有则取之，否则原样。
 * 此表即「布局编辑器」的数据模型（基于 QWERTY 基准）。
 */
export function buildLayoutMap(rows) {
  const map = {};
  // 用 QWERTY 物理位置索引
  QWERTY_ROWS.forEach((row, r) => {
    row.forEach((qKey, c) => {
      // 目标布局可能有更少列（如 gallman 30 键），只映射存在的列
      const targetRow = rows[r];
      if (!targetRow) return;
      const targetKey = targetRow[c];
      if (targetKey === undefined) return;
      const isLetter = /^[a-z]$/i.test(qKey);
      if (isLetter) {
        map[qKey] = targetKey;
      }
      // 符号键：目标符号若在原位则原样，否则不映射（保持原样）
    });
  });
  return map;
}

/** 根据 KEY_MAP 生成 Gallman 的完整映射（未列出字母原样） */
export function gallmanMap() {
  const map = {};
  for (let i = 97; i <= 122; i++) {
    const ch = String.fromCharCode(i);
    map[ch] = KEY_MAP[ch] || ch;
  }
  return map;
}

/**
 * 编码翻译：把基于 qwerty 的编码字符串，翻译为目标布局的按键序列。
 * @param {string} code 码表里查到的编码（基于 qwerty）
 * @param {Object} layoutMap 目标布局映射（qwerty键帽 → 目标键帽）
 * @returns {string} 翻译后的按键序列（只含 26 字母，大小写按原样）
 */
export function translateCode(code, layoutMap) {
  if (!code) return '';
  // layoutMap 为 null/undefined（qwerty 布局）时不翻译
  if (!layoutMap) return code;
  let out = '';
  for (const ch of code) {
    const lower = ch.toLowerCase();
    if (/^[a-z]$/.test(lower)) {
      out += (layoutMap[lower] || lower);
    } else {
      // 符号/数字不参与编码，原样保留
      out += ch;
    }
  }
  return out;
}

// 布局选择时的翻译映射（内置）
export function getLayoutMap(layoutId) {
  if (layoutId === 'gallman') return gallmanMap();
  if (layoutId === 'qwerty') return null; // qwerty 不翻译
  // 自定义布局：从 localStorage 读取（由 main.js 注入）
  return null;
}

// ---- 布局编辑器辅助 ----
// 自定义布局存 localStorage，格式：{ id, name, map: {qwertyLetter: targetCap} }
export const CUSTOM_LAYOUTS_KEY = 'customLayouts';

export function normalizeCustomLayout(rows) {
  // rows 为 {rowIdx: [键帽...]} 或数组，转成 qwerty 字母 → 目标键帽 映射
  return buildLayoutMap(rows);
}