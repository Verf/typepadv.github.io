// main.js - 应用入口：串起存储/码表/布局/跟打/键盘/统计/历史

import { ls, idb, codeTableStore, customTextStore } from './storage.js';
import { parseCodeTable, lookupCode, lookupAllCodes } from './parser.js';
import {
  BUILTIN_LAYOUTS, GALLMAN_ROWS, QWERTY_ROWS, KEY_MAP,
  translateCode, gallmanMap, buildLayoutMap, buildCodeTranslateMap,
  fingerFor,
  CUSTOM_LAYOUTS_KEY,
} from './layout.js';
import { renderKeyboard, setTargetKey, flashKey, clearKeyStates } from './keyboard.js';
import { loadZigenData, renderZigenOnKeyboard, clearZigen } from './roots.js';
import { loadChaifenData, getChaifen } from './chaifen.js';
import { BUILTIN_SCHEMES, setCurrentScheme } from './schemes.js';
import { TypingController } from './typing.js';
import * as stats from './stats.js';

// ---- 常量 ----
// 内置方案注册表见 schemes.js（码表/拆分/字根/编码基准布局）

// ---- 全局状态 ----
const state = {
  settings: {
    layout: 'qwerty',
    codetable: 'star-builtin',
    fingerColor: true,
    showCodeHint: true,
    pageSize: 20, // 跟打区每页字数（0 = 全部）
    showZigen: true, // 虚拟键盘键面显示字根图
    showChaifen: true, // 码表提示附加字根拆分
    translateCode: true, // 码表编码是否翻译到当前键盘布局（灵铭默认关）
  },
  currentText: null,
  layoutMap: null,      // 当前布局的翻译映射（null = qwerty 不翻译）
  codeTranslateMap: null, // 方案基准布局 → 当前布局 的编码翻译映射（null = 不翻译）
  currentCodeTable: null, // { charToCodes, direction }
  customLayouts: [],    // [{id, name, map}]
  selectedTextId: null,
  selectedTextName: '常见字 1-500',
  lastCursorPage: null, // 上次渲染的光标所在页（用于检测输入翻页）
  viewPage: null,       // 手动查看的页码（null = 跟随光标）
};

// ---- DOM 引用 ----
// 防御：找不到元素时记录清晰错误，避免 "null.addEventListener" 类崩溃
function $(sel) {
  const el = document.querySelector(sel);
  if (!el) {
    console.error('[DOM] 元素不存在: ' + sel + '（可能是缓存了旧版 JS，请强制刷新 Ctrl+Shift+R）');
  }
  return el;
}
const dom = {
  typingArea: $('#typing-area'),
  typedText: $('#typed-text'),
  typingPagination: $('#typing-pagination'),
  pageSizeSelect: $('#page-size-select'),
  codeHint: $('#code-hint'),
  layoutSelect: $('#layout-select'),
  codetableSelect: $('#codetable-select'),
  fingerColor: $('#finger-color'),
  showCodeHint: $('#show-code-hint'),
  showChaifen: $('#show-chaifen'),
  translateCode: $('#translate-code'),
  btnManageLayouts: $('#btn-manage-layouts'),
  btnImportCodetable: $('#btn-import-codetable'),
  codetableFile: $('#codetable-file'),
  btnRestart: $('#btn-restart'),
  textList: $('#text-list'),
  currentTextName: $('#current-text-name'),
  textSelectPanel: $('#text-select-panel'),
  textImportPanel: $('#text-import-panel'),
  textImportArea: $('#text-import-area'),
  btnSaveText: $('#btn-save-text'),
  textFile: $('#text-file'),
  btnUploadText: $('#btn-upload-text'),
  keyboard: $('#virtual-keyboard'),
  statTime: $('#stat-time'),
  statKpm: $('#stat-kpm'),
  statNetkpm: $('#stat-netkpm'),
  statAccuracy: $('#stat-accuracy'),
  statBackspaces: $('#stat-backspaces'),
  statErrors: $('#stat-errors'),
  statProgress: $('#stat-progress'),
  historyBody: $('#history-body'),
  btnClearHistory: $('#btn-clear-history'),
  layoutEditor: $('#layout-editor'),
  layoutEditorContent: $('#layout-editor-content'),
  btnLayoutSave: $('#btn-layout-save'),
  btnLayoutClose: $('#btn-layout-close'),
};

// 打字控制器
const controller = new TypingController({
  render: (session) => {
    renderTyping(session);
    // 仅在非「初始化/切换文本」渲染时保存进度（见 startSession 的 _noSave 标记）
    if (state._sessionNoSave) return;
    saveSessionProgress();
  },
  onFinish: (finalStats) => {
    onSessionFinish(finalStats);
    clearSessionProgress(); // 已完成的文本不再记忆进度
  },
});

// ---- 初始化 ----
async function init() {
  // 关键元素检查（防缓存不匹配导致白屏）
  const required = ['typing-area', 'layout-select', 'text-list', 'virtual-keyboard', 'code-hint'];
  for (const id of required) {
    if (!document.getElementById(id)) {
      throw new Error('页面结构异常：缺少 #' + id + '，请强制刷新（Ctrl+Shift+R）后重试');
    }
  }
  await loadSettings();
  await loadCustomLayouts();
  await populateLayoutOptions();
  await populateCodetableOptions();
  bindEvents();
  renderSettings();
  applyLayout(); // 设置 layoutMap（从保存的设置恢复），并渲染键盘 + 更新码表提示
  await loadDefaultText();
  renderHistory();
  await loadCodeTable(state.settings.codetable);
  // 字根/拆分数据异步加载（按当前方案），完成后重绘键盘（可能尚未显示）
  const scheme = BUILTIN_SCHEMES[state.settings.codetable] || null;
  setCurrentScheme(scheme);
  if (scheme?.zigen?.url) {
    loadZigenData(scheme.zigen.url).then(() => {
      renderKeyboardDefault(); // 重新渲染键盘（含字根）
    });
  }
  // 字根拆分数据后台预加载（首次较大，之后走 IndexedDB）
  if (state.settings.showChaifen && scheme?.chaifen) {
    loadChaifenData(scheme.chaifen).catch(() => {});
  }
  // 首次进入自动聚焦输入框（页面加载完成后；若用户已点击其它控件则不打扰）
  const focusInputOnce = () => {
    const el = document.getElementById('hidden-input');
    if (!el) return;
    if (document.activeElement === document.body || !document.activeElement) {
      el.focus({ preventScroll: true });
    }
  };
  if (document.readyState === 'complete') {
    setTimeout(focusInputOnce, 200);
  } else {
    window.addEventListener('load', () => setTimeout(focusInputOnce, 200), { once: true });
  }
}

// ---- 设置管理 ----
async function loadSettings() {
  const saved = ls.get('settings', null);
  if (saved) Object.assign(state.settings, saved);
}

function saveSettings() {
  ls.set('settings', state.settings);
}

function renderSettings() {
  dom.layoutSelect.value = state.settings.layout;
  dom.codetableSelect.value = state.settings.codetable;
  dom.fingerColor.checked = state.settings.fingerColor;
  dom.showCodeHint.checked = state.settings.showCodeHint;
  dom.showChaifen.checked = state.settings.showChaifen !== false;
  dom.translateCode.checked = state.settings.translateCode !== false;
  dom.pageSizeSelect.value = String(state.settings.pageSize ?? 20);
}

// ---- 布局 ----
async function loadCustomLayouts() {
  state.customLayouts = ls.get(CUSTOM_LAYOUTS_KEY, []);
}

function saveCustomLayouts() {
  ls.set(CUSTOM_LAYOUTS_KEY, state.customLayouts);
}

async function populateLayoutOptions() {
  dom.layoutSelect.innerHTML = '';
  for (const [id, l] of Object.entries(BUILTIN_LAYOUTS)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = l.name;
    dom.layoutSelect.appendChild(opt);
  }
  for (const cl of state.customLayouts) {
    const opt = document.createElement('option');
    opt.value = cl.id;
    opt.textContent = cl.name + '（自定义）';
    dom.layoutSelect.appendChild(opt);
  }
}

function getLayoutRows(layoutId) {
  if (BUILTIN_LAYOUTS[layoutId]) return BUILTIN_LAYOUTS[layoutId].rows;
  const cl = state.customLayouts.find((l) => l.id === layoutId);
  if (cl) return rowsFromMap(cl.map);
  return QWERTY_ROWS;
}

/** 从 qwerty 字母→键帽 映射恢复行排列（用于渲染/编辑） */
export function rowsFromMap(map) {
  return QWERTY_ROWS.map((row, r) => {
    return row.map((qKey) => {
      if (/^[a-z]$/i.test(qKey)) return map[qKey] || qKey;
      return qKey;
    });
  });
}

function getLayoutMapFor(layoutId) {
  if (layoutId === 'qwerty') return null;
  if (layoutId === 'gallman') return gallmanMap();
  const cl = state.customLayouts.find((l) => l.id === layoutId);
  return cl ? cl.map : null;
}

function applyLayout() {
  state.layoutMap = getLayoutMapFor(state.settings.layout);
  // 编码翻译映射：方案基准布局 → 当前布局
  // - 内置布局：buildCodeTranslateMap 处理（qwerty↔gallman 用 KEY_MAP 语义）
  // - 自定义布局：其 layoutMap 即「qwerty→目标键帽」，基准为 qwerty 时直接复用；
  //   基准为 gallman 时退化为按当前布局映射（边缘场景，仅显示提示用）
  const scheme = BUILTIN_SCHEMES[state.settings.codetable] || null;
  const base = scheme?.codeBaseLayout || 'qwerty';
  const layoutId = state.settings.layout;
  const isBuiltin = Boolean(BUILTIN_LAYOUTS[layoutId]);
  if (isBuiltin) {
    state.codeTranslateMap = buildCodeTranslateMap(base, layoutId);
  } else if (base === 'qwerty') {
    // 自定义布局：layoutMap 即 qwerty→目标键帽（与星陈翻译语义一致）
    state.codeTranslateMap = state.layoutMap;
  } else {
    // 灵铭 + 自定义布局：按「基准字母行→当前布局」物理对齐（自定义视为 qwerty 基准行）
    state.codeTranslateMap = buildCodeTranslateMap(base, 'qwerty');
  }
  renderKeyboardDefault();
  updateCodeHint();
  if (state.sessionView) updateTargetKey();
}

/** 当前方案的 zigenMode：星陈=qwerty-base（按布局反查），灵铭=keycap（键帽直配） */
function zigenModeFor(codetableKey) {
  const scheme = BUILTIN_SCHEMES[codetableKey];
  if (scheme && scheme.codeBaseLayout === 'gallman') return 'keycap';
  return 'qwerty-base';
}

function renderKeyboardDefault() {
  renderKeyboard(dom.keyboard, state.settings.layout, getLayoutRows(state.settings.layout));
  // 渲染字根图（按方案：星陈按布局反查大码；灵铭按 Gallman 键帽直配）
  renderZigenOnKeyboard(dom.keyboard, state.layoutMap, state.settings.showZigen, {
    zigenMode: zigenModeFor(state.settings.codetable),
  });
}

// ---- 码表 ----
async function populateCodetableOptions() {
  dom.codetableSelect.innerHTML = '';
  // 内置方案
  for (const [key, scheme] of Object.entries(BUILTIN_SCHEMES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = scheme.name;
    dom.codetableSelect.appendChild(opt);
  }
  // 用户上传
  const tables = await codeTableStore.getAll();
  for (const t of tables) {
    const o = document.createElement('option');
    o.value = t.key;
    o.textContent = t.name + '（自定义）';
    dom.codetableSelect.appendChild(o);
  }
}

async function loadCodeTable(key) {
  // 先查缓存
  let parsed = await codeTableStore.getCache(key);
  if (!parsed) {
    const scheme = BUILTIN_SCHEMES[key];
    if (scheme) {
      // fetch 内置
      const resp = await fetch(scheme.codeTable.url);
      const text = await resp.text();
      parsed = parseCodeTable(text);
      await codeTableStore.saveCache(key, parsed);
    } else {
      const t = await codeTableStore.get(key);
      if (t) parsed = parseCodeTable(t.content);
    }
  }
  state.currentCodeTable = parsed;
  updateCodeHint();
}

// ---- 文本管理 ----
// ---- 文本管理 ----

// 常用字练习数据（按字频降序，来自 MTSU 字频统计）
const COMMON_CHARS_URL = 'assets/code-tables/common-3500.txt';
const COMMON_RANGES = [
  { id: 'common-1-500', name: '常见字 1-500', start: 0, end: 500 },
  { id: 'common-501-1000', name: '常见字 501-1000', start: 500, end: 1000 },
  { id: 'common-1001-1500', name: '常见字 1001-1500', start: 1000, end: 1500 },
  { id: 'common-all', name: '全部 3500 常字', start: 0, end: 3500 },
];
let commonChars = null; // 加载后的常用字数组

async function loadCommonChars() {
  if (commonChars) return commonChars;
  try {
    const resp = await fetch(COMMON_CHARS_URL);
    const text = await resp.text();
    commonChars = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return commonChars;
  } catch (e) {
    console.warn('常用字加载失败', e);
    commonChars = [];
    return commonChars;
  }
}

async function loadDefaultText() {
  commonChars = await loadCommonChars();
  // 默认加载「常见字 1-500」作为初始练习
  const firstRange = COMMON_RANGES[0];
  const initial = commonChars.slice(firstRange.start, firstRange.end).join('');
  state.currentText = initial;
  state.selectedTextId = firstRange.id;
  state.selectedTextName = firstRange.name;
  renderTextList();
  updateCurrentTextName();
  // 先读出已存进度（startSession 不覆盖），再决定恢复
  const savedBefore = readSessionProgress();
  startSession(initial, { noSave: true });
  if (savedBefore && !tryRestoreSessionWith(savedBefore)) {
    // 无进度可恢复或已与当前文本不一致：从零开始并记录
    saveSessionProgress();
  }
}

function updateCurrentTextName() {
  if (dom.currentTextName && state.selectedTextName) {
    dom.currentTextName.textContent = state.selectedTextName;
  }
}

function renderTextList() {
  dom.textList.innerHTML = '';
  const items = [];

  // 常用字练习分组
  if (commonChars && commonChars.length > 0) {
    for (const range of COMMON_RANGES) {
      const slice = commonChars.slice(range.start, range.end);
      items.push({ id: range.id, name: range.name, content: slice.join(''), isCommon: true });
    }
  }

  // 自定义文本
  customTextStore.getAll().then((texts) => {
    for (const t of texts) {
      items.push({ id: t.id, name: t.name, content: t.content });
    }
    dom.textList.innerHTML = '';
    let lastWasCommon = false;
    for (const item of items) {
      // 只有自定义文本时不需要分组标签；有常用字时加分组
      if (item.isCommon && !lastWasCommon) {
        appendGroupLabel('字库练习');
      } else if (!item.isCommon && lastWasCommon && items.some((i) => !i.isCommon)) {
        appendGroupLabel('自定义文本');
      }
      const chip = document.createElement('span');
      chip.className = 'text-item' + (item.id === state.selectedTextId ? ' active' : '');
      chip.textContent = item.name + '（' + item.content.length + '字）';
      chip.addEventListener('click', () => {
        // 先保存旧文本当前进度（用旧 id/旧文本，确保切走不丢）
        if (controller.session && state._sessionNoSave === false && state.selectedTextId) {
          saveSessionProgressFor(state.selectedTextId, state.currentText, controller.session);
        }
        state.currentText = item.content;
        state.selectedTextId = item.id;
        state.selectedTextName = item.name;
        renderTextList();
        updateCurrentTextName();
        startSession(item.content, { noSave: true });
        // 恢复该文本已存进度（若有）；否则从 0 开始并记录
        if (!tryRestoreSession()) {
          saveSessionProgress();
        }
        // 选择后关闭下拉
        if (dom.textSelectPanel) dom.textSelectPanel.open = false;
      });
      dom.textList.appendChild(chip);
      lastWasCommon = item.isCommon;
    }

    function appendGroupLabel(label) {
      const div = document.createElement('span');
      div.className = 'text-group-label';
      div.textContent = label;
      dom.textList.appendChild(div);
    }
  });
}

async function handleImportText() {
  const names = await customTextStore.getAll().then((t) => t.map((x) => x.name));
  const content = dom.textImportArea.value.trim();
  if (!content) return;
  const id = 'ct-' + Date.now();
  await customTextStore.save({ id, name: `自定义${names.length + 1}`, content, createdAt: Date.now() });
  dom.textImportArea.value = '';
  renderTextList();
}

// ---- 跟打会话 ----
function startSession(text, opts = {}) {
  state.lastCursorPage = null;
  state.viewPage = null;
  // 初始化/切换文本的首次渲染不写入进度（避免覆盖已存进度）
  state._sessionNoSave = opts.noSave !== false;
  controller.start(text);
  controller.resetInputTracking();
  updateCodeHint();
  renderTyping(controller.session);
  state._sessionNoSave = false;
}

// ---- 跟打进度持久化 ----
// localStorage typepadv:sessionProgress = { textId, text, session, ts }
// 每次输入渲染即保存；切换文本/重置/完成时清除或覆盖

const SESSION_PROGRESS_KEY = 'sessionProgress';

function saveSessionProgress() {
  const s = controller.session;
  if (!s || !state.selectedTextId) return;
  saveSessionProgressFor(state.selectedTextId, state.currentText, s);
}

/** 保存指定文本的进度（textId/text/session 显式传入，避免切换时错位） */
function saveSessionProgressFor(textId, text, s) {
  try {
    if (!s || !textId) return;
    const all = readAllSessionProgress();
    all[textId] = {
      textId,
      text,
      session: {
        text: s.text,
        pos: s.pos,
        charStates: s.charStates,
        keystrokes: s.keystrokes,
        backspaces: s.backspaces,
        errors: s.errors,
        startTime: s.startTime,
        endTime: s.endTime,
      },
      ts: Date.now(),
    };
    // 只保留少量文本的进度（防 localStorage 膨胀）
    const keys = Object.keys(all);
    if (keys.length > 20) {
      // 淘汰最旧的 10 个
      const sorted = keys.sort((a, b) => (all[a].ts || 0) - (all[b].ts || 0));
      for (const k of sorted.slice(0, keys.length - 20)) delete all[k];
    }
    ls.set(SESSION_PROGRESS_KEY, all);
  } catch { /* 存储满等异常忽略 */ }
}

/** 读取全部文本的已存进度 */
function readAllSessionProgress() {
  try {
    return ls.get(SESSION_PROGRESS_KEY, null) || {};
  } catch {
    return {};
  }
}

/** 读取当前文本的已存进度 */
function readSessionProgress() {
  try {
    const all = readAllSessionProgress();
    return all[state.selectedTextId] || null;
  } catch {
    return null;
  }
}

function clearSessionProgress() {
  try {
    const all = readAllSessionProgress();
    delete all[state.selectedTextId];
    const rest = Object.keys(all);
    if (rest.length === 0) ls.remove(SESSION_PROGRESS_KEY);
    else ls.set(SESSION_PROGRESS_KEY, all);
  } catch { /* 忽略 */ }
}

/**
 * 尝试恢复上次进度（从 localStorage 读取）。
 * @returns {boolean} 是否成功恢复
 */
function tryRestoreSession() {
  return tryRestoreSessionWith(readSessionProgress());
}

/**
 * 尝试用给定的已存进度恢复。仅当：
 *  - saved 有效
 *  - textId 与当前所选文本一致
 *  - 文本内容一致（防文本被修改）
 *  - 未完成（pos < text.length）
 * 恢复后直接渲染。
 * @param {object|null} saved 已存进度
 * @returns {boolean} 是否成功恢复
 */
function tryRestoreSessionWith(saved) {
  try {
    if (!saved || !saved.session) return false;
    if (saved.textId !== state.selectedTextId) return false;
    if (saved.text !== state.currentText) return false;
    const s = saved.session;
    // 基本校验
    if (!Array.isArray(s.text) || !Array.isArray(s.charStates)) return false;
    if (s.text.length === 0 || s.pos < 0 || s.pos > s.text.length) return false;
    if (s.pos >= s.text.length) return false; // 已完成/到达末尾不再恢复
    // 恢复会话：直接用构造的 session 对象
    controller.session = {
      text: s.text,
      pos: s.pos,
      charStates: s.charStates.map((st) => (st === 'correct' || st === 'error' || st === 'backspaced' ? st : 'pending')),
      keystrokes: s.keystrokes || 0,
      backspaces: s.backspaces || 0,
      errors: s.errors || 0,
      startTime: s.startTime || null,
      endTime: s.endTime || null,
      lastLen: 0, // 输入跟踪重置
      lastValue: '',
    };
    controller.finished = false;
    state.lastCursorPage = null;
    state.viewPage = null;
    renderTyping(controller.session);
    updateCodeHint();
    return true;
  } catch {
    return false;
  }
}

function renderTyping(session) {
  if (!session) return;
  state.sessionView = session;
  const pageSize = state.settings.pageSize ?? 20; // 0 = 全部
  const total = session.text.length;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  // 光标所在页（pos 在文末时取最后一页）
  const cursorPage = pageSize > 0 ? Math.floor(Math.min(session.pos, Math.max(total - 1, 0)) / pageSize) : 0;
  // 光标页变化（正在输入/回改）→ 强制跟随；手动翻页不动光标 → 保持查看页
  if (state.lastCursorPage !== cursorPage) {
    state.lastCursorPage = cursorPage;
    state.viewPage = null;
  }
  // 实际显示页：优先手动查看页，否则跟随光标
  const pageIndex = state.viewPage ?? cursorPage;
  const start = pageIndex * pageSize;
  const end = Math.min(start + pageSize, total);

  // 渲染当前页文字
  let html = '';
  if (pageSize > 0) {
    for (let i = start; i < end; i++) {
      html += charSpan(session, i);
    }
  } else {
    for (let i = 0; i < total; i++) {
      html += charSpan(session, i);
    }
  }
  dom.typedText.innerHTML = html;

  // 页码导航
  if (pageSize > 0 && totalPages > 1) {
    const prevBtn = `<button class="page-nav" data-page="${pageIndex - 1}" ${pageIndex === 0 ? 'disabled' : ''}>‹ 上一页</button>`;
    const nextBtn = `<button class="page-nav" data-page="${pageIndex + 1}" ${pageIndex >= totalPages - 1 ? 'disabled' : ''}>下一页 ›</button>`;
    dom.typingPagination.innerHTML =
      prevBtn + `<span class="page-indicator">${pageIndex + 1} / ${totalPages}</span>` + nextBtn;
    dom.typingPagination.querySelectorAll('.page-nav').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        state.viewPage = Number(btn.dataset.page);
        renderTyping(session);
      });
    });
  } else {
    dom.typingPagination.innerHTML = '';
  }

  // 更新统计
  const st = stats.computeStats(session, Date.now());
  dom.statTime.textContent = st.elapsedSec.toFixed(1) + 's';
  dom.statKpm.textContent = st.kpm;
  dom.statNetkpm.textContent = st.netKpm;
  dom.statAccuracy.textContent = st.accuracy + '%';
  dom.statBackspaces.textContent = st.backspaces;
  dom.statErrors.textContent = st.errorCount;
  dom.statProgress.textContent = st.typedCount + '/' + st.totalChars;
  // 码表提示 & 目标键
  if (state.settings.showCodeHint) updateCodeHint();
  updateTargetKey();
}

/** 渲染单个字符 span（辅助） */
function charSpan(session, i) {
  const ch = session.text[i];
  const st = session.charStates[i];
  let cls = 'char ';
  if (i === session.pos) cls += 'current ';
  if (st === 'correct') cls += 'correct ';
  else if (st === 'error') cls += 'error ';
  else if (st === 'backspaced') cls += 'backspaced ';
  else cls += 'pending ';
  return `<span class="${cls}">${ch}</span>`;
}

/**
 * 编码翻译到当前键盘布局（受设置 translateCode 控制）。
 * @param {string} code 码表编码
 * @returns {string} 翻译后编码（原样返回 = 未翻译）
 */
function translateToCurrentLayout(code) {
  if (!code) return '';
  if (state.settings.translateCode === false) return code; // 用户关闭翻译
  return translateCode(code, state.codeTranslateMap);
}

function updateCodeHint() {
  const s = controller.session;
  if (!s || !state.settings.showCodeHint) {
    dom.codeHint.textContent = '';
    return;
  }
  const ch = s.text[s.pos];
  if (!ch) { dom.codeHint.textContent = ''; return; }
  if (!state.currentCodeTable) {
    dom.codeHint.textContent = ch + '：码表未加载';
    return;
  }
  // 全部编码（简码+全码）
  const codes = lookupAllCodes(state.currentCodeTable, ch);
  if (!codes || codes.length === 0) {
    dom.codeHint.textContent = ch + '：无编码';
    return;
  }
  // 翻译每个编码到当前布局（开关关闭/基准=当前时原样）
  const translatedList = codes.map((code) => translateToCurrentLayout(code));
  // 只显示当前布局下的编码（不显示原码）
  if (!state.settings.showChaifen) {
    dom.codeHint.innerHTML = `${ch}：<strong>${translatedList.join(', ')}</strong>`;
    return;
  }
  // 追加字根拆分（异步查拆分表）
  dom.codeHint.innerHTML = `${ch}：<strong>${translatedList.join(', ')}</strong>`;
  const hintEl = dom.codeHint;
  let cancelled = false;
  updateChaifenHint(ch, translatedList).then((extra) => {
    if (!cancelled && hintEl === dom.codeHint) {
      hintEl.innerHTML = `${ch}：<strong>${translatedList.join(', ')}</strong> ${extra}`;
    }
  });
  // 后续渲染会替换 codeHint 内容，标记取消避免写旧值
  const prevSet = dom.codeHint._chaifenCleanup;
  if (typeof prevSet === 'function') prevSet();
  dom.codeHint._chaifenCleanup = () => { cancelled = true; };
}

/** 查拆分表并渲染拆分提示（异步） */
async function updateChaifenHint(ch, translatedList) {
  try {
    const info = getChaifen(ch);
    if (!info) return '';
    const splitEncoded = info.split.split('').map((r) =>
      `<span class="chaifen-root" title="${r}">${r}</span>`
    ).join('');
    // 拆分全码（大小写混合：大码大写/小码小写）翻译到当前布局（受开关控制）
    const codeEncoded = translateToCurrentLayout(info.code);
    return `<span class="chaifen-sep">｜</span><span class="chaifen-label">拆</span>` +
           `<span class="chaifen-split">${splitEncoded}</span>` +
           `<span class="chaifen-code">${codeEncoded}</span>`;
  } catch {
    return '';
  }
}

function updateTargetKey() {
  const s = controller.session;
  if (!s || !state.layoutMap || !state.currentCodeTable) return;
  const ch = s.text[s.pos];
  if (!ch) return;
  const code = lookupCode(state.currentCodeTable, ch);
  if (!code) return;
  const translated = translateToCurrentLayout(code);
  const firstKey = translated[0];
  setTargetKey(dom.keyboard, firstKey);
}

function onSessionFinish(finalStats) {
  // 保存历史
  const record = {
    id: 'h-' + Date.now(),
    time: Date.now(),
    textName: state.selectedTextId || 'unknown',
    kpm: finalStats.kpm,
    netKpm: finalStats.netKpm,
    accuracy: finalStats.accuracy,
    errorRate: finalStats.errorRate,
    backspaces: finalStats.backspaces,
    elapsedSec: finalStats.elapsedSec,
    textLength: finalStats.totalChars,
  };
  const history = ls.get('history', []);
  history.unshift(record);
  if (history.length > 100) history.length = 100;
  ls.set('history', history);
  renderHistory();
  dom.typingArea.focus();
}

function renderHistory() {
  const history = ls.get('history', []);
  dom.historyBody.innerHTML = '';
  if (history.length === 0) {
    dom.historyBody.innerHTML = '<tr><td colspan="6">暂无历史记录</td></tr>';
    return;
  }
  for (const h of history) {
    const tr = document.createElement('tr');
    const time = new Date(h.time).toLocaleDateString() + ' ' + new Date(h.time).toLocaleTimeString().slice(0, 5);
    tr.innerHTML = `
      <td title="${new Date(h.time).toLocaleString()}">${time}</td>
      <td class="text-preview" title="${h.textName}">${h.textName}</td>
      <td>${h.kpm}</td>
      <td>${h.accuracy}%</td>
      <td>${h.errorRate}%</td>
      <td>${h.backspaces}</td>`;
    dom.historyBody.appendChild(tr);
  }
}

// ---- 布局编辑器 ----
let editorState = { map: null, editingId: null };

async function openLayoutEditor() {
  dom.layoutEditor.showModal();
  editorState = { map: Object.assign({}, gallmanMap()), editingId: null };
  renderLayoutEditor();
}

function renderLayoutEditor() {
  const container = dom.layoutEditorContent;
  container.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'layout-editor-hint';
  hint.textContent = '点击键位，再按键盘上对应字母键，可修改该位置的键帽（基于 QWERTY 基准）。';
  container.appendChild(hint);

  const presets = document.createElement('div');
  presets.className = 'layout-presets';
  const btnQwerty = document.createElement('button');
  btnQwerty.className = 'secondary outline';
  btnQwerty.textContent = '重置为 QWERTY';
  btnQwerty.addEventListener('click', () => { editorState.map = qwertyMap(); renderLayoutEditor(); });
  const btnGallman = document.createElement('button');
  btnGallman.className = 'secondary outline';
  btnGallman.textContent = '重置为 Gallman';
  btnGallman.addEventListener('click', () => { editorState.map = gallmanMap(); renderLayoutEditor(); });
  presets.appendChild(btnQwerty);
  presets.appendChild(btnGallman);
  container.appendChild(presets);

  const grid = document.createElement('div');
  grid.className = 'virtual-keyboard';
  // 渲染 QWERTY 基准行，每键可点击
  QWERTY_ROWS.forEach((row, r) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'kb-row';
    row.forEach((qKey, c) => {
      const key = document.createElement('div');
      key.className = 'kb-key f-' + fingerFor(r, c);
      const isLetter = /^[a-z]$/i.test(qKey);
      key.dataset.qkey = qKey;
      key.dataset.row = r;
      key.dataset.col = c;
      // 显示当前映射的键帽
      const mapped = editorState.map[qKey] || qKey;
      key.textContent = mapped;
      key.title = `QWERTY ${qKey} → ${mapped}`;
      if (isLetter) {
        key.addEventListener('click', () => {
          // 进入编辑态：按键后按任意字母键替换
          editorSelected = qKey;
          highlightSelected(grid, qKey);
        });
      } else {
        key.classList.add('opacity-50');
      }
      rowDiv.appendChild(key);
    });
    grid.appendChild(rowDiv);
  });
  container.appendChild(grid);

  // 键盘监听（编辑态）
  container.focusable = true;
  container.tabIndex = -1;
}

let editorSelected = null;
function highlightSelected(grid, qKey) {
  grid.querySelectorAll('.kb-key').forEach((k) => k.classList.remove('selected'));
  grid.querySelectorAll('.kb-key').forEach((k) => {
    if (k.dataset.qkey === qKey) k.classList.add('selected');
  });
}

function qwertyMap() {
  const map = {};
  for (let i = 97; i <= 122; i++) map[String.fromCharCode(i)] = String.fromCharCode(i);
  return map;
}

async function saveLayoutEditor() {
  const name = prompt('布局名称：', '自定义布局');
  if (!name) return;
  const id = 'custom-' + Date.now();
  state.customLayouts.push({ id, name, map: Object.assign({}, editorState.map) });
  saveCustomLayouts();
  await populateLayoutOptions();
  dom.layoutEditor.close();
  // 选择新布局
  state.settings.layout = id;
  saveSettings();
  renderSettings();
  applyLayout();
}

// ---- 事件绑定 ----
function bindEvents() {
  // 打字区：监听 input 事件的输入框（隐藏）
  // 方案：隐藏 textarea 捕获输入法上屏（可含换行，兼容多行文本）
  const input = document.createElement('textarea');
  input.id = 'hidden-input';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.autocorrect = 'off';
  input.spellcheck = false;
  input.wrap = 'off';
  input.rows = 1;
  // 关键：可聚焦但不可见（不用 pointer-events:none，否则无法聚焦）
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;margin:0;background:transparent;';
  document.body.appendChild(input);

  // 打字区点击（全区域委托，含字符区）→ 聚焦输入
  dom.typingArea.addEventListener('click', (e) => {
    e.preventDefault();
    input.focus({ preventScroll: true });
    input.value = '';
    controller.session && Object.assign(controller.session, { lastLen: 0, lastValue: '' });
  });

  // 自动聚焦：切回本页/切换到窗口时直接可输入，无需再点输入区
  const autoFocus = () => {
    // 避免在弹层/对话框打开时抢焦点
    if (document.querySelector('dialog[open]')) return;
    // 拆分下拉等面板打开时不抢（用户可能在点选）
    if (dom.textSelectPanel && dom.textSelectPanel.open) return;
    // 已聚焦输入框则不重复处理
    if (document.activeElement === input) return;
    input.focus({ preventScroll: true });
  };
  // 页面重新可见（从其他标签/最小化切回）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // 延迟一拍，等页面激活完成
      setTimeout(autoFocus, 30);
    }
  });
  // 窗口重新获得焦点（从其他应用/窗口切回，且之前页面没有焦点元素）
  window.addEventListener('focus', () => {
    if (!document.hasFocus()) return; // 尚未激活时忽略
    if (document.activeElement && document.activeElement !== document.body) return; // 已有聚焦元素（按钮/输入框）不抢
    setTimeout(autoFocus, 30);
  });

  // IME 组合态：composing 期间的 input 不计数（避免重复统计）
  let isComposing = false;
  input.addEventListener('compositionstart', () => {
    isComposing = true;
    // 组合开始：记下当前值，防止组合中临时文本被当输入
    input.dataset.composeStart = input.value;
  });
  input.addEventListener('compositionend', () => {
    isComposing = false;
    // 组合结束：只统计最终上屏的增量（组合期临时变化忽略）
    if (input.dataset.composeStart !== undefined && input.value !== input.dataset.composeStart) {
      controller.handleInput(input.value);
      flashForLastKey();
    }
    delete input.dataset.composeStart;
  });
  input.addEventListener('input', (e) => {
    if (isComposing || e.isComposing) return; // 组合中忽略
    controller.handleInput(input.value);
    flashForLastKey();
  });

  function flashForLastKey() {
    // 同步虚拟键盘反馈（flash 最后键；仅在有目标键可查时）
    if (!state.layoutMap || !controller.session) return;
    const s = controller.session;
    const ch = s.text[s.pos - 1];
    if (ch) {
      const code = state.currentCodeTable && lookupCode(state.currentCodeTable, ch);
      if (code) {
        const translated = translateToCurrentLayout(code);
        const last = translated[translated.length - 1];
        const correct = s.charStates[s.pos - 1] === 'correct';
        flashKey(dom.keyboard, last, correct);
      }
    }
  }

  // 退格键盘事件
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.layoutEditor.open) dom.layoutEditor.close();
  });

  // 设置
  dom.layoutSelect.addEventListener('change', () => {
    state.settings.layout = dom.layoutSelect.value;
    saveSettings();
    applyLayout();
  });
  dom.codetableSelect.addEventListener('change', async () => {
    state.settings.codetable = dom.codetableSelect.value;
    saveSettings();
    await loadCodeTable(state.settings.codetable);
    // 联动：更新编码翻译映射（基准布局随方案变）、加载对应拆分/字根
    const scheme = BUILTIN_SCHEMES[state.settings.codetable] || null;
    setCurrentScheme(scheme);
    // 切换内置方案时，翻译开关自动设为该方案默认值（用户可再手动调）
    if (scheme) {
      state.settings.translateCode = scheme.defaultTranslate;
      saveSettings();
    }
    renderSettings();
    applyLayout();
    // 加载该方案的拆分表（若开启显示拆分）
    if (state.settings.showChaifen && scheme?.chaifen) {
      loadChaifenData(scheme.chaifen).then(() => updateCodeHint()).catch(() => {});
    }
    // 加载该方案字根图，完成后重绘键盘
    if (scheme?.zigen?.url) {
      loadZigenData(scheme.zigen.url).then(() => {
        renderKeyboardDefault();
        if (state.sessionView) updateTargetKey();
      });
    } else {
      clearZigen(dom.keyboard); // 自定义码表无字根
      if (state.sessionView) updateTargetKey();
    }
  });
  dom.fingerColor.addEventListener('change', () => {
    state.settings.fingerColor = dom.fingerColor.checked;
    saveSettings();
    dom.keyboard.classList.toggle('no-finger-color', !dom.fingerColor.checked);
  });
  dom.showCodeHint.addEventListener('change', () => {
    state.settings.showCodeHint = dom.showCodeHint.checked;
    saveSettings();
    updateCodeHint();
  });
  dom.showChaifen.addEventListener('change', () => {
    state.settings.showChaifen = dom.showChaifen.checked;
    saveSettings();
    updateCodeHint();
    // 打开时确保拆分数据已加载（按当前方案）
    if (dom.showChaifen.checked) {
      const scheme = BUILTIN_SCHEMES[state.settings.codetable] || null;
      if (scheme?.chaifen) loadChaifenData(scheme.chaifen).catch(() => {});
    }
  });
  dom.translateCode.addEventListener('change', () => {
    state.settings.translateCode = dom.translateCode.checked;
    saveSettings();
    updateCodeHint();
    if (state.sessionView) updateTargetKey();
  });
  // 分页大小切换
  dom.pageSizeSelect.addEventListener('change', () => {
    state.settings.pageSize = Number(dom.pageSizeSelect.value);
    saveSettings();
    if (controller.session) {
      state.lastCursorPage = null; // 重新计算跟随页
      state.viewPage = null;
      renderTyping(controller.session);
    }
  });

  // 布局管理
  dom.btnManageLayouts.addEventListener('click', openLayoutEditor);
  dom.btnLayoutSave.addEventListener('click', saveLayoutEditor);
  dom.btnLayoutClose.addEventListener('click', () => dom.layoutEditor.close());

  // 码表导入
  dom.btnImportCodetable.addEventListener('click', () => dom.codetableFile.click());
  dom.codetableFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const content = await file.text();
    const parsed = parseCodeTable(content);
    if (parsed.uniqueChars === 0) { alert('无法解析码表（无有效条目）'); return; }
    const key = 'ct-' + Date.now();
    await codeTableStore.save({ key, name: file.name.replace(/\.[^.]+$/, ''), content, direction: parsed.direction });
    await populateCodetableOptions();
    state.settings.codetable = key;
    saveSettings();
    renderSettings();
    await loadCodeTable(key);
    // 自定义码表：无内置拆分/字根，基准布局视为 qwerty（可手动开关翻译）
    setCurrentScheme(null);
    state.settings.translateCode = true;
    saveSettings();
    renderSettings();
    applyLayout();
    clearZigen(dom.keyboard);
    if (state.sessionView) updateTargetKey();
  });

  // 文本管理
  dom.btnSaveText.addEventListener('click', handleImportText);
  dom.btnUploadText.addEventListener('click', () => dom.textFile.click());
  dom.textFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const content = await file.text();
    const id = 'ct-' + Date.now();
    await customTextStore.save({ id, name: file.name.replace(/\.[^.]+$/, ''), content, createdAt: Date.now() });
    renderTextList();
  });
  dom.btnRestart.addEventListener('click', () => {
    // 用户主动重置：清除已存进度并从零开始
    clearSessionProgress();
    if (state.currentText) startSession(state.currentText);
  });

  // 历史
  dom.btnClearHistory.addEventListener('click', () => {
    if (confirm('确定清空历史记录？')) {
      ls.remove('history');
      renderHistory();
    }
  });

  // 布局编辑器键盘编辑态
  document.addEventListener('keydown', (e) => {
    if (!dom.layoutEditor.open || !editorSelected || !/^[a-z]$/i.test(e.key)) return;
    e.preventDefault();
    editorState.map[editorSelected] = e.key.toLowerCase();
    renderLayoutEditor();
    editorSelected = null;
  });
}

// ---- 启动 ----
init().catch((err) => {
  console.error('初始化失败', err);
  alert('初始化失败：' + err.message);
});