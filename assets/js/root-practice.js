// root-practice.js - 字根记忆练习视图与会话控制器
import { BUILTIN_SCHEMES } from './schemes.js';
import { buildCodeTranslateMap } from './layout.js';
import {
  buildRootCards, dueCards, keyCards, normalizeProgress, updateProgress,
  sessionGapFor, summarizeProgress,
} from './root-deck.js';
import { loadRootProgress, saveRootProgress, loadRootSettings, saveRootSettings } from './root-storage.js';

const MODES = [
  ['adaptive', '智能进阶'],
  ['big', '只练大码'],
  ['full', '只练完整根码'],
];
const RANGES = [
  ['due', '今日待复习'],
  ['new', '新字根'],
  ['all', '全部字根'],
  ['weak', '薄弱项'],
  ['key', '按键位'],
];

function byId(id) { return document.getElementById(id); }
function safeScheme(key) { return BUILTIN_SCHEMES[key] || BUILTIN_SCHEMES['star-builtin']; }

/** 将物理 QWERTY KeyboardEvent 映射为当前布局键帽；不依赖 DOM，便于回归测试。 */
export function mapPhysicalKey(event, map = null) {
  const code = String(event?.code || '');
  const physical = /^Key([A-Z])$/i.test(code) ? code.slice(3).toLowerCase() : '';
  if (!physical) return /^[a-z]$/i.test(event?.key || '') ? String(event.key).toLowerCase() : '';
  return map?.[physical] || physical;
}

export class RootPracticeController {
  constructor(options = {}) {
    this.getLayoutId = options.getLayoutId || (() => 'qwerty');
    this.getPhysicalMap = options.getPhysicalMap || (() => buildCodeTranslateMap('qwerty', this.getLayoutId()));
    this.getSchemeKey = options.getSchemeKey || (() => 'star-builtin');
    this.onSchemeChange = options.onSchemeChange || (() => {});
    this.section = byId('root-section');
    this.schemeSelect = byId('root-scheme-select');
    this.modeSelect = byId('root-mode-select');
    this.rangeSelect = byId('root-range-select');
    this.keySelect = byId('root-key-select');
    this.countInput = byId('root-count');
    this.startButton = byId('root-start');
    this.continueButton = byId('root-teaching-continue');
    this.question = byId('root-question');
    this.teaching = byId('root-teaching-card');
    this.answer = byId('root-answer');
    this.feedback = byId('root-feedback');
    this.progress = byId('root-progress');
    this.stats = byId('root-session-stats');
    this.result = byId('root-result');
    this.keyboard = byId('virtual-keyboard');
    this.rootLabel = byId('root-question-label');
    this.modeLabel = byId('root-question-mode');
    this.typedLabel = byId('root-typed');
    this.teachRoot = byId('root-teach-root');
    this.teachCode = byId('root-teach-code');
    this.teachHint = byId('root-teach-hint');
    this.bound = false;
    this.active = false;
    this.cards = [];
    this.progressItems = {};
    this.progressKey = null;
    this.schemeKey = null;
    this.assetVersion = 'v1';
    this.queue = [];
    this.current = null;
    this.phase = 'idle';
    this.typed = '';
    this.startedAt = 0;
    this.session = { asked: 0, correct: 0, revealed: 0, streak: 0, bestStreak: 0, errors: 0, newMastered: 0, total: 0, limit: 0 };
    this.loadGeneration = 0;
  }

  init() {
    if (!this.section || this.bound) return;
    this.bound = true;
    this.populateControls();
    const saved = loadRootSettings({ mode: 'adaptive', range: 'due', count: 20, key: 'all' });
    if (this.modeSelect) this.modeSelect.value = saved.mode || 'adaptive';
    if (this.rangeSelect) this.rangeSelect.value = saved.range || 'due';
    if (this.countInput) this.countInput.value = String(saved.count || 20);
    if (this.keySelect) this.keySelect.value = saved.key || 'all';
    this.syncKeyVisibility();
    this.startButton?.addEventListener('click', () => this.start());
    this.continueButton?.addEventListener('click', () => this.beginQuestion());
    this.rangeSelect?.addEventListener('change', () => this.saveSettings());
    this.modeSelect?.addEventListener('change', () => this.saveSettings());
    this.countInput?.addEventListener('change', () => this.saveSettings());
    this.keySelect?.addEventListener('change', () => this.saveSettings());
    this.schemeSelect?.addEventListener('change', () => {
      this.schemeKey = this.schemeSelect.value;
      this.onSchemeChange(this.schemeKey);
      this.loadCards().catch((e) => this.showError(e));
    });
    // 在捕获阶段拦截 roots 路由的按键，避免已有隐藏 textarea 收到输入。
    document.addEventListener('keydown', (event) => this.onKeyDown(event), true);
    this.keyboard?.addEventListener('click', (event) => {
      const key = event.target.closest?.('.kb-key');
      if (!key || !this.active || this.phase !== 'question') return;
      event.preventDefault();
      this.answerKey(key.dataset.cap);
    });
    this.setActive(location.hash === '#/roots');
  }

  populateControls() {
    if (this.schemeSelect) {
      this.schemeSelect.textContent = '';
      for (const [key, scheme] of Object.entries(BUILTIN_SCHEMES)) {
        const option = document.createElement('option');
        option.value = key; option.textContent = scheme.name;
        this.schemeSelect.appendChild(option);
      }
      this.schemeSelect.value = BUILTIN_SCHEMES[this.getSchemeKey()] ? this.getSchemeKey() : 'star-builtin';
      this.schemeKey = this.schemeSelect.value;
    }
    if (this.modeSelect) {
      this.modeSelect.textContent = '';
      for (const [key, name] of MODES) { const o = document.createElement('option'); o.value = key; o.textContent = name; this.modeSelect.appendChild(o); }
    }
    if (this.rangeSelect) {
      this.rangeSelect.textContent = '';
      for (const [key, name] of RANGES) { const o = document.createElement('option'); o.value = key; o.textContent = name; this.rangeSelect.appendChild(o); }
    }
    if (this.keySelect) {
      this.keySelect.textContent = '';
      const all = document.createElement('option'); all.value = 'all'; all.textContent = '全部键位'; this.keySelect.appendChild(all);
      for (const key of 'abcdefghijklmnopqrstuvwxyz') { const o = document.createElement('option'); o.value = key; o.textContent = key.toUpperCase(); this.keySelect.appendChild(o); }
    }
    if (this.rangeSelect) this.rangeSelect.disabled = false;
    this.syncKeyVisibility();
    this.rangeSelect?.addEventListener('change', () => this.syncKeyVisibility());
  }

  syncKeyVisibility() {
    if (this.keySelect?.parentElement) this.keySelect.parentElement.hidden = this.rangeSelect?.value !== 'key';
  }

  saveSettings() {
    saveRootSettings({ mode: this.modeSelect?.value || 'adaptive', range: this.rangeSelect?.value || 'due', count: Number(this.countInput?.value || 20), key: this.keySelect?.value || 'all' });
  }

  setActive(active) {
    this.active = Boolean(active);
    if (!this.active) this.loadGeneration += 1;
    if (this.section) this.section.hidden = !this.active;
    if (this.active) this.loadCards().catch((e) => this.showError(e));
  }

  // 全局方案设置改变时同步题库；方案和进度始终是平台级上下文。
  syncScheme(key) {
    if (!BUILTIN_SCHEMES[key] || key === this.schemeKey) return;
    this.schemeKey = key;
    if (this.schemeSelect) this.schemeSelect.value = key;
    this.phase = 'idle'; this.current = null; this.queue = [];
    this.renderIdle();
    if (this.active) this.loadCards().catch((e) => this.showError(e));
  }

  async loadCards() {
    const generation = ++this.loadGeneration;
    const scheme = safeScheme(this.schemeKey || this.getSchemeKey());
    this.schemeKey = scheme.key;
    // 码表、拆分、字根任一资产换代都必须隔离熟练度，避免旧根码沿用到新数据。
    this.assetVersion = [
      scheme.codeTable?.cacheKey || scheme.codeTable?.url || scheme.key,
      scheme.chaifen?.cacheKey || scheme.chaifen?.url || '',
      scheme.zigen?.url || '',
      scheme.zigen?.candidatesUrl || '',
    ].join('|');
    const response = await fetch(scheme.zigen.url);
    if (!response.ok) throw new Error(`字根数据加载失败（HTTP ${response.status}）`);
    const zigen = await response.json();
    if (generation !== this.loadGeneration || !this.active || this.schemeKey !== scheme.key) return [];
    this.cards = buildRootCards(zigen, this.schemeKey, this.assetVersion);
    const loaded = await loadRootProgress(this.schemeKey, this.assetVersion, this.cards);
    if (generation !== this.loadGeneration || !this.active || this.schemeKey !== scheme.key) return [];
    this.progressKey = loaded.key;
    this.progressItems = loaded.progress;
    this.renderSummary();
    if (this.phase === 'idle') this.renderIdle();
    return this.cards;
  }

  async start() {
    if (!this.cards.length) await this.loadCards();
    this.saveSettings();
    const now = Date.now();
    const range = this.rangeSelect?.value || 'due';
    let selected = range === 'key'
      ? keyCards(this.cards, this.progressItems, this.keySelect?.value || 'all', now)
      : dueCards(this.cards, this.progressItems, now, range);
    if (!selected.length && range === 'due') selected = dueCards(this.cards, this.progressItems, now, 'all');
    const count = Math.max(1, Math.min(200, Number(this.countInput?.value || 20)));
    this.queue = selected.slice().sort(() => Math.random() - 0.5).slice(0, count);
    if (!this.queue.length) { this.showError(new Error('当前范围没有可练字根')); return; }
    const total = this.queue.length;
    this.session = { asked: 0, correct: 0, revealed: 0, streak: 0, bestStreak: 0, errors: 0, newMastered: 0, total, limit: Math.min(total * 3, total + 10) };
    this.phase = 'teaching';
    this.current = this.queue.shift();
    this.renderTeaching();
  }

  beginQuestion() {
    if (!this.current) return;
    this.phase = 'question'; this.typed = ''; this.startedAt = Date.now();
    if (this.teaching) this.teaching.hidden = true;
    if (this.question) this.question.hidden = false;
    this.renderQuestion();
  }

  modeForCard(card) {
    const mode = this.modeSelect?.value || 'adaptive';
    if (mode === 'big') return 'big';
    if (mode === 'full') return 'full';
    return (this.progressItems[card.id]?.stage || 0) === 0 ? 'big' : 'full';
  }

  translatedCode(card) {
    const scheme = safeScheme(this.schemeKey);
    const target = this.getLayoutId() || 'qwerty';
    const base = scheme.codeBaseLayout || 'qwerty';
    // 自定义布局的数据模型始终是“QWERTY 键帽→自定义键帽”；灵铭的
    // Gallman 编码先还原到 QWERTY，再套用这层映射，避免退化到内置 QWERTY。
    const customTarget = !['qwerty', 'gallman'].includes(target);
    const baseToQwerty = base === 'gallman' ? buildCodeTranslateMap('gallman', 'qwerty') : null;
    const qwertyToTarget = customTarget ? this.getPhysicalMap?.() : null;
    const map = customTarget ? null : buildCodeTranslateMap(base, target);
    return Array.from(card.code).map((char) => {
      const qwerty = baseToQwerty?.[char] || char;
      return (qwertyToTarget?.[qwerty] || map?.[char] || qwerty).toLowerCase();
    }).join('');
  }

  expected() {
    if (!this.current) return '';
    const code = this.translatedCode(this.current);
    return this.modeForCard(this.current) === 'big' ? code.slice(0, 1) : code;
  }

  onKeyDown(event) {
    if (!this.active || this.phase === 'idle' || this.phase === 'done') return;
    if (this.phase === 'teaching') {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.beginQuestion(); }
      return;
    }
    if (this.phase !== 'question') return;
    if (event.key === 'Escape' || event.key === ' ') { event.preventDefault(); this.reveal(); return; }
    const key = this.physicalKey(event);
    if (!key) return;
    event.preventDefault();
    this.answerKey(key);
  }

  physicalKey(event) {
    return mapPhysicalKey(event, this.getPhysicalMap?.());
  }

  answerKey(key) {
    if (!/^[a-z]$/i.test(key || '')) return;
    const expected = this.expected();
    this.typed += key.toLowerCase();
    if (!expected.startsWith(this.typed)) { this.answerQuestion(false); return; }
    if (this.typed === expected) this.answerQuestion(true);
    else this.renderQuestion();
  }

  reveal() { if (this.phase === 'question') this.answerQuestion(false, true); }

  async answerQuestion(correct, revealed = false) {
    if (this.phase !== 'question' || !this.current) return;
    this.phase = 'feedback';
    const card = this.current;
    const elapsedMs = Date.now() - this.startedAt;
    const old = this.progressItems[card.id] || {};
    this.progressItems = updateProgress(this.progressItems, card, { correct, revealed, elapsedMs });
    await saveRootProgress(this.schemeKey, this.assetVersion, this.progressItems);
    this.session.asked += 1;
    if (correct) { this.session.correct += 1; this.session.streak += 1; this.session.bestStreak = Math.max(this.session.bestStreak, this.session.streak); }
    else { this.session.errors += 1; this.session.streak = 0; if (revealed) this.session.revealed += 1; }
    if (old.stage < 3 && this.progressItems[card.id].stage >= 3) this.session.newMastered += 1;
    this.showAnswer(correct, revealed);
    // 错题下一题重现；正确题按 2/5/10 题插回队列。
    const gap = correct ? sessionGapFor(Math.max(0, (this.progressItems[card.id]?.stage || 1) - 1)) : 1;
    const insertAt = Math.min(gap, this.queue.length);
    this.queue.splice(insertAt, 0, card);
    setTimeout(() => this.nextQuestion(), 550);
  }

  nextQuestion() {
    if (!this.active) return;
    if (this.session.asked >= this.session.limit) { this.finish(); return; }
    this.current = this.queue.shift();
    this.phase = 'question'; this.typed = ''; this.startedAt = Date.now();
    if (this.question) this.question.hidden = false;
    this.renderQuestion();
  }

  finish() {
    this.phase = 'done'; this.current = null;
    if (this.question) this.question.hidden = true;
    if (this.teaching) this.teaching.hidden = true;
    if (this.result) this.result.hidden = false;
    if (this.result) this.result.textContent = `本轮完成：${this.session.correct}/${this.session.asked} 首次正确，连续正确峰值 ${this.session.bestStreak}，新掌握 ${this.session.newMastered}。`;
    this.renderSummary();
  }

  renderIdle() {
    if (this.question) this.question.hidden = true;
    if (this.teaching) this.teaching.hidden = true;
    if (this.result) this.result.hidden = true;
    if (this.feedback) this.feedback.textContent = '';
  }

  renderTeaching() {
    if (this.teaching) this.teaching.hidden = false;
    if (this.question) this.question.hidden = true;
    if (this.result) this.result.hidden = true;
    if (this.teachRoot) this.teachRoot.textContent = this.current.root;
    if (this.teachCode) this.teachCode.textContent = this.translatedCode(this.current).toUpperCase();
    if (this.teachHint) this.teachHint.textContent = `大码 ${this.translatedCode(this.current).slice(0, 1).toUpperCase()}；完整根码 ${this.translatedCode(this.current).toUpperCase()}。按 Enter 或点击开始闭卷回忆。`;
  }

  renderQuestion() {
    if (!this.current) return;
    const mode = this.modeForCard(this.current);
    if (this.rootLabel) this.rootLabel.textContent = this.current.root;
    if (this.modeLabel) this.modeLabel.textContent = mode === 'big' ? '回忆大码' : '回忆完整根码';
    if (this.typedLabel) this.typedLabel.textContent = this.typed ? `已输入：${this.typed.toUpperCase()}` : '请输入对应键位';
    if (this.progress) this.progress.textContent = `本轮 ${this.session.asked}/${this.session.total} · 连续 ${this.session.streak}`;
  }

  showAnswer(correct, revealed) {
    if (!this.answer || !this.current) return;
    this.answer.textContent = `${correct ? '正确' : revealed ? '已查看答案' : '错误'}：${this.current.root} → ${this.translatedCode(this.current).toUpperCase()}`;
    this.answer.className = `root-answer ${correct ? 'is-correct' : 'is-wrong'}`;
  }

  renderSummary() {
    if (!this.cards.length || !this.stats) return;
    const s = summarizeProgress(this.cards, this.progressItems);
    this.stats.textContent = `共 ${s.total} 个 · 新字根 ${s.newCount} · 学习中 ${s.learning} · 已掌握 ${s.mastered} · 今日待复习 ${s.due}`;
  }

  showError(error) {
    if (this.feedback) this.feedback.textContent = `字根练习暂不可用：${error?.message || error}`;
    console.warn('[root-practice]', error);
  }
}

export default { RootPracticeController };
