// parser.js - 码表解析器（通用兼容设计）
// 支持两种方向：'编码\t汉字'（宇浩星陈） 与 '汉字\t编码'（五笔 fcitx 风格）
// 自动检测方向；兼容 tab/空格/多空格分隔；忽略空行与注释（# 开头）

/**
 * 检测一行是「编码在左」还是「编码在右」。
 * 规则：tab 分隔（或空格）后，判断第一个 token 是否为纯编码字符（字母/数字）。
 * 返回 'code-left' | 'code-right' | null（无法判断）。
 */
export function detectDirection(line) {
  if (!line || line.startsWith('#') || line.startsWith('---')) return null;
  const tokens = line.split(/[\t ]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const first = tokens[0];
  const isCode = /^[a-z0-9]+$/i.test(first); // 编码一般是字母/数字
  const isHan = /[\u4e00-\u9fff]/.test(first);
  if (isCode && !isHan) return 'code-left';
  if (isHan && !isCode) return 'code-right';
  return null;
}

/**
 * 解析码表文本为 map。
 * @param {string} text 码表文本
 * @returns {{ charToCodes: Map<string, string[]>, direction: string, stats: object }}
 *   charToCodes: 汉字 -> 编码数组（保留多码，按出现顺序）
 */
export function parseCodeTable(text) {
  const lines = text.split(/\r?\n/);
  const charToCodes = new Map();
  let direction = null;
  let detectedLines = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('---')) continue;

    // 取第一个有效行的方向作为表方向（自适应：若某行 token 结构特殊则跳过）
    const tokens = line.split(/[\t ]+/).filter(Boolean);
    if (tokens.length < 2) continue;

    let d = detectDirection(line);
    if (!d) {
      // 容忍前几行元数据（如 Rime yaml 头），继续按已检测方向处理
      d = direction;
    }
    if (d === 'code-left') {
      direction = direction || d;
      detectedLines++;
      const code = tokens[0];
      for (let i = 1; i < tokens.length; i++) {
        const ch = tokens[i];
        // 跳过可能是权重的数字 token（如 fcitx 第三列）
        if (/^\d+$/.test(ch) || !ch.trim()) continue;
        // 只索引单字（词条暂不索引，后续可扩展 phraseToCodes）
        if (isSingleHan(ch)) addEntry(charToCodes, ch, code);
      }
    } else if (d === 'code-right') {
      direction = direction || d;
      detectedLines++;
      // 编码 = 从尾部找第一个非数字 token（容错 fcitx 词-编码-权重 三列）
      let code = null;
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (!/^\d+$/.test(tokens[i])) { code = tokens[i]; break; }
      }
      if (code === null) continue;
      for (let i = 0; i < tokens.length; i++) {
        const ch = tokens[i];
        if (ch === code || /^\d+$/.test(ch) || !ch.trim()) continue;
        // 只索引单字
        if (isSingleHan(ch)) addEntry(charToCodes, ch, code);
      }
    }
    // d === null 且无 direction 时跳过（文件头）
  }

  return {
    charToCodes,
    direction: direction || 'unknown',
    stats: {
      entries: detectedLines,
      uniqueChars: charToCodes.size,
    },
  };
}

/** 判断是否为单个汉字（码点长度 1 且含汉字） */
function isSingleHan(ch) {
  return Array.from(ch).length === 1 && /[\u4e00-\u9fff]/.test(ch);
}

function addEntry(map, ch, code) {
  if (!map.has(ch)) map.set(ch, []);
  const arr = map.get(ch);
  if (!arr.includes(code)) arr.push(code);
}

/**
 * 查询单字编码（多码取第一个，可指定取第 index 个）。
 */
export function lookupCode(parsedTable, ch, index = 0) {
  const codes = parsedTable.charToCodes.get(ch);
  if (!codes || codes.length === 0) return null;
  return codes[Math.min(index, codes.length - 1)];
}

/**
 * 查询单字的全部编码（简码+全码数组，保持码表顺序）。
 * @returns {string[] | null} 全部编码数组；无则 null
 */
export function lookupAllCodes(parsedTable, ch) {
  const codes = parsedTable.charToCodes.get(ch);
  if (!codes || codes.length === 0) return null;
  return codes;
}

/**
 * 判断文本是否为码表可用的内容（含至少一个汉字）。
 */
export function hasHan(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

// ---- 独立于 DOM 的纯逻辑单元（便于测试） ----
export default { parseCodeTable, lookupCode, detectDirection, hasHan };