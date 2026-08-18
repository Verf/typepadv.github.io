// storage.js - localStorage + IndexedDB 封装
// localStorage: 设置、布局、历史成绩（小数据）
// IndexedDB: 用户上传码表、自定义文本、码表解析缓存（大数据）

const DB_NAME = 'typepadv';
const DB_VERSION = 1;
const STORES = {
  codeTables: 'codeTables',   // 用户上传码表 {key: string, name, content, direction}
  customTexts: 'customTexts', // 自定义文本 {id, name, content, createdAt}
  codeCache: 'codeCache',     // 码表解析缓存 {key, parsed, direction}
};

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.codeTables)) {
        db.createObjectStore(STORES.codeTables, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.customTexts)) {
        db.createObjectStore(STORES.customTexts, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.codeCache)) {
        db.createObjectStore(STORES.codeCache, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function idbRequest(store, mode, op) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const s = tx.objectStore(store);
    const req = op(s);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const idb = {
  put(store, value) {
    return idbRequest(store, 'readwrite', (s) => s.put(value));
  },
  get(store, key) {
    return idbRequest(store, 'readonly', (s) => s.get(key));
  },
  getAll(store) {
    return idbRequest(store, 'readonly', (s) => s.getAll());
  },
  delete(store, key) {
    return idbRequest(store, 'readwrite', (s) => s.delete(key));
  },
  clear(store) {
    return idbRequest(store, 'readwrite', (s) => s.clear());
  },
};

// ---- localStorage 封装 ----
const LS_PREFIX = 'typepadv:';

export const ls = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  },
  remove(key) {
    localStorage.removeItem(LS_PREFIX + key);
  },
};

// ---- 码表存取 ----
export const codeTableStore = {
  async save(table) {
    await idb.put(STORES.codeTables, table);
  },
  async getAll() {
    return idb.getAll(STORES.codeTables);
  },
  async get(key) {
    return idb.get(STORES.codeTables, key);
  },
  async remove(key) {
    await idb.delete(STORES.codeTables, key);
  },
  async saveCache(key, parsed) {
    await idb.put(STORES.codeCache, { key, parsed, ts: Date.now() });
  },
  async getCache(key) {
    const c = await idb.get(STORES.codeCache, key);
    return c ? c.parsed : null;
  },
};

// ---- 自定义文本存取 ----
export const customTextStore = {
  async save(text) {
    await idb.put(STORES.customTexts, text);
  },
  async getAll() {
    return idb.getAll(STORES.customTexts);
  },
  async get(id) {
    return idb.get(STORES.customTexts, id);
  },
  async remove(id) {
    await idb.delete(STORES.customTexts, id);
  },
};

export const STORE_NAMES = STORES;