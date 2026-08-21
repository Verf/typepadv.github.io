// root-storage.js - 字根练习设置与版本化进度
import { ls, rootPracticeStore } from './storage.js';
import { progressKey, normalizeProgress } from './root-deck.js';

const SETTINGS_KEY = 'root-practice-settings-v1';

export function loadRootSettings(fallback = {}) {
  return { ...fallback, ...(ls.get(SETTINGS_KEY, {}) || {}) };
}

export function saveRootSettings(settings) {
  ls.set(SETTINGS_KEY, settings || {});
}

export async function loadRootProgress(schemeKey, assetVersion, cards) {
  const key = progressKey(schemeKey, assetVersion);
  try {
    const record = await rootPracticeStore.get(key);
    return { key, progress: normalizeProgress(record?.items, cards), updatedAt: record?.updatedAt || 0 };
  } catch (error) {
    // 私密浏览/旧浏览器没有 IndexedDB 时仍允许单次学习，并保留小数据兜底。
    const fallback = ls.get(`root-progress:${key}`, null);
    return { key, progress: normalizeProgress(fallback?.items || fallback, cards), updatedAt: fallback?.updatedAt || 0, fallback: true };
  }
}

export async function saveRootProgress(schemeKey, assetVersion, progress) {
  const key = progressKey(schemeKey, assetVersion);
  const record = { key, version: 1, schemeKey, assetVersion, items: progress, updatedAt: Date.now() };
  try {
    await rootPracticeStore.save(record);
  } catch {
    ls.set(`root-progress:${key}`, record);
  }
  return record;
}

