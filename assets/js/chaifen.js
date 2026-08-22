// chaifen.js - 单字字根拆分表（按方案多源加载 + IndexedDB 缓存）
// 数据源：星陈 assets/data/chaifen.json；灵铭（gallming）assets/data/chaifen-ling.json（兼容性遗留文件名）
// 结构：{字: "拆分\t编码"}，fetch 懒加载 + IndexedDB 缓存

import { idb, STORE_NAMES } from './storage.js';

let cache = null;        // Map 字 -> {split, code}
let loading = null;      // 正在加载的 Promise
let currentSource = null; // 当前加载的数据源描述（URL+cacheKey）

/** 获取拆分数据（懒加载，幂等；source 变化时重新加载） */
export async function loadChaifenData(source) {
  const url = source?.url;
  const cacheKey = source?.cacheKey;
  if (!url) return null;
  // 同一数据源：返回已加载缓存
  if (currentSource === cacheKey && cache) return cache;
  // 数据源变化：重置
  if (currentSource !== cacheKey) {
    cache = null;
    loading = null;
    currentSource = cacheKey;
  }
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    // 1. 试 IndexedDB 缓存（解析后的 Map 无法直接结构化存储，存对象）
    try {
      const saved = await idb.get(STORE_NAMES.chaifenCache, cacheKey);
      if (saved && saved.data) {
        cache = new Map(Object.entries(saved.data));
        return cache;
      }
    } catch { /* 忽略 */ }
    // 2. fetch JSON + 解析
    const resp = await fetch(url);
    const raw = await resp.json();
    cache = new Map(Object.entries(raw));
    // 3. 存入 IndexedDB（异步，不阻塞）
    try {
      await idb.put(STORE_NAMES.chaifenCache, { key: cacheKey, data: raw, ts: Date.now() });
    } catch { /* 忽略 */ }
    return cache;
  })();
  return loading;
}

/** 查询单字拆分（空 = 未找到；需先 loadChaifenData 加载对应方案数据） */
export function getChaifen(ch) {
  if (!cache) return null;
  const v = cache.get(ch);
  if (!v) return null;
  const [split, code, perRoots] = v.split('\t');
  return { split, code, rootCodes: perRoots ? perRoots.split('-') : null };
}

/** 把拆分解析为语义根；花括号结构整体占一个根位，省略标记不占位。 */
export function tokenizeChaifenRoots(split) {
  const roots = [];
  const chars = Array.from(split || '');
  for (let i = 0; i < chars.length;) {
    if (/\s/u.test(chars[i])) { i++; continue; }
    if (chars[i] === '.' && chars.slice(i, i + 3).join('') === '...') { i += 3; continue; }
    if (chars[i] === '…') { i++; continue; }
    if (chars[i] === '{') {
      const end = chars.indexOf('}', i + 1);
      if (end < 0) throw new Error(`拆分结构根缺少右括号: ${split}`);
      roots.push(chars.slice(i, end + 1).join(''));
      i = end + 1;
      continue;
    }
    if (chars[i] === '}') throw new Error(`拆分结构根存在多余右括号: ${split}`);
    roots.push(chars[i++]);
  }
  return roots;
}

/** 大写字母开始、后接零个或多个小写字母的完整根码。 */
export function tokenizeChaifenCodes(code) {
  return (code || '').match(/[A-Z][a-z]*/gu) || [];
}

/**
 * 字根拆分编码翻译到当前布局。
 * 拆分编码是大小写混合（如 DWKd，大写=大码，小写=小码），逐个字符查 layoutMap。
 * 翻译映射 = 基准布局 → 当前布局（由调用方传入，null = 不翻译）。
 */
export function translateChaifenCode(code, layoutMap) {
  if (!code) return '';
  if (!layoutMap) return code;
  let out = '';
  for (const ch of code) {
    const lower = ch.toLowerCase();
    if (/^[a-z]$/.test(lower)) {
      out += (layoutMap[lower] || lower);
    } else {
      out += ch;
    }
  }
  return out;
}

export default { loadChaifenData, getChaifen, tokenizeChaifenRoots, tokenizeChaifenCodes, translateChaifenCode };
