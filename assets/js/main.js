// main.js - 应用入口：串起存储/码表/布局/跟打/键盘/统计/历史

import { ls, idb, codeTableStore, customTextStore } from './storage.js';
import { parseCodeTable, lookupCode, lookupAllCodes } from './parser.js';
import {
  BUILTIN_LAYOUTS, GALLMAN_ROWS, QWERTY_ROWS, KEY_MAP,
  translateCode, gallmanMap, buildLayoutMap, fingerFor,
  CUSTOM_LAYOUTS_KEY,
} from './layout.js';
import { renderKeyboard, setTargetKey, flashKey, clearKeyStates } from './keyboard.js';
import { TypingController } from './typing.js';
import * as stats from './stats.js';

// ---- 常量 ----
const BUILTIN_CODE_TABLE = {
  key: 'star-builtin',
  name: '宇浩星陈（内置）',
  url: 'assets/code-tables/mabiao-star.txt',
  direction: 'code-left',
};

// ---- 全局状态 ----
const state = {
  settings: {
    layout: 'qwerty',
    codetable: 'star-builtin',
    fingerColor: true,
    showCodeHint: true,
  },
  currentText: null,
  layoutMap: null,      // 当前布局的翻译映射（null = qwerty 不翻译）
  currentCodeTable: null, // { charToCodes, direction }
  customLayouts: [],    // [{id, name, map}]
  selectedTextId: null,
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
  codeHint: $('#code-hint'),
  layoutSelect: $('#layout-select'),
  codetableSelect: $('#codetable-select'),
  fingerColor: $('#finger-color'),
  showCodeHint: $('#show-code-hint'),
  btnManageLayouts: $('#btn-manage-layouts'),
  btnImportCodetable: $('#btn-import-codetable'),
  codetableFile: $('#codetable-file'),
  btnRestart: $('#btn-restart'),
  textList: $('#text-list'),
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
  render: (session) => renderTyping(session),
  onFinish: (finalStats) => onSessionFinish(finalStats),
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
  renderKeyboardDefault();
  updateCodeHint();
  if (state.sessionView) updateTargetKey();
}

function renderKeyboardDefault() {
  renderKeyboard(dom.keyboard, state.settings.layout, getLayoutRows(state.settings.layout));
}

// ---- 码表 ----
async function populateCodetableOptions() {
  dom.codetableSelect.innerHTML = '';
  // 内置
  const opt = document.createElement('option');
  opt.value = BUILTIN_CODE_TABLE.key;
  opt.textContent = BUILTIN_CODE_TABLE.name;
  dom.codetableSelect.appendChild(opt);
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
    if (key === BUILTIN_CODE_TABLE.key) {
      // fetch 内置
      const resp = await fetch(BUILTIN_CODE_TABLE.url);
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
  renderTextList();
  startSession(initial);
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
        state.currentText = item.content;
        state.selectedTextId = item.id;
        renderTextList();
        startSession(item.content);
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
function startSession(text) {
  controller.start(text);
  controller.resetInputTracking();
  updateCodeHint();
  renderTyping(controller.session);
}

function renderTyping(session) {
  if (!session) return;
  state.sessionView = session;
  // 渲染逐字状态
  let html = '';
  for (let i = 0; i < session.text.length; i++) {
    const ch = session.text[i];
    const st = session.charStates[i];
    let cls = 'char ';
    if (i === session.pos) cls += 'current ';
    if (st === 'correct') cls += 'correct ';
    else if (st === 'error') cls += 'error ';
    else if (st === 'backspaced') cls += 'backspaced ';
    else cls += 'pending ';
    html += `<span class="${cls}">${ch}</span>`;
  }
  dom.typedText.innerHTML = html;
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
  // 翻译每个编码到当前布局
  const translatedList = codes.map((code) =>
    state.layoutMap ? translateCode(code, state.layoutMap) : code
  );
  // 只显示当前布局下的编码（不显示 qwerty 原码）
  dom.codeHint.innerHTML = `${ch}：<strong>${translatedList.join(', ')}</strong>`;
}

function updateTargetKey() {
  const s = controller.session;
  if (!s || !state.layoutMap) return;
  const ch = s.text[s.pos];
  if (!ch) return;
  const code = lookupCode(state.currentCodeTable, ch);
  if (!code) return;
  const translated = translateCode(code, state.layoutMap);
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
    // 同步虚拟键盘反馈（若有布局映射，flash 最后键）
    if (!state.layoutMap || !controller.session) return;
    const s = controller.session;
    const ch = s.text[s.pos - 1];
    if (ch) {
      const code = state.currentCodeTable && lookupCode(state.currentCodeTable, ch);
      if (code) {
        const translated = translateCode(code, state.layoutMap);
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