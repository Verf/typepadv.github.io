// chaifen.js - 单字字根拆分表（宇浩星陈全汉字拆分）
// 数据源：sheepduke/rime-config yustar_chaifen.dict.yaml（官方拆分表）
// 处理：解析为 {字: "拆分\t编码"}，fetch 懒加载 + IndexedDB 缓存

import { idb, STORE_NAMES } from './storage.js';

const CHAIFEN_URL = 'assets/data/chaifen.json';
const CACHE_KEY = 'star-chaifen-v1';

let cache = null;        // Map 字 -> {split, code}
let loading = null;      // 正在加载的 Promise

/** 获取拆分数据（懒加载，幂等） */
export async function loadChaifenData() {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    // 1. 试 IndexedDB 缓存（解析后的 Map 无法直接结构化存储，存对象）
    try {
      const saved = await idb.get(STORE_NAMES.chaifenCache, CACHE_KEY);
      if (saved && saved.data) {
        cache = new Map(Object.entries(saved.data));
        return cache;
      }
    } catch { /* 忽略 */ }
    // 2. fetch JSON + 解析
    const resp = await fetch(CHAIFEN_URL);
    const raw = await resp.json();
    cache = new Map(Object.entries(raw));
    // 3. 存入 IndexedDB（异步，不阻塞）
    try {
      await idb.put(STORE_NAMES.chaifenCache, { key: CACHE_KEY, data: raw, ts: Date.now() });
    } catch { /* 忽略 */ }
    return cache;
  })();
  return loading;
}

/** 查询单字拆分（空 = 未找到） */
export async function getChaifen(ch) {
  await loadChaifenData();
  const v = cache.get(ch);
  if (!v) return null;
  const [split, code] = v.split('\t');
  return { split, code };
}

/**
 * 字根拆分编码翻译到当前布局。
 * 拆分编码是大小写混合（如 DWKd，大写=大码，小写=小码），逐个字符查 layoutMap。
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

export default { loadChaifenData, getChaifen, translateChaifenCode };