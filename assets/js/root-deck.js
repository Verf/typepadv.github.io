// root-deck.js - 字根题库与复习调度（无 DOM，可独立单元测试）

export const ROOT_PRACTICE_VERSION = 'root-practice-v1';
export const SESSION_GAPS = [2, 5, 10];
export const REVIEW_DAYS = [1, 3, 7, 14, 30];

const DAY = 24 * 60 * 60 * 1000;

export function progressKey(schemeKey, assetVersion = 'v1') {
  return `${ROOT_PRACTICE_VERSION}:${schemeKey}:${assetVersion}`;
}

function codeForEntry(key, entry, schemeKey) {
  const big = String(key || '').toLowerCase();
  const suffix = String(entry?.s || '').toLowerCase();
  return { big, suffix, code: big + suffix, schemeKey };
}

/** 将 zigen JSON 转为稳定题卡。字根数据键本身就是方案基准布局的大码。 */
export function buildRootCards(zigen, schemeKey, assetVersion = 'v1') {
  const cards = [];
  for (const [key, entries] of Object.entries(zigen || {})) {
    if (!Array.isArray(entries) || !/^[a-z]$/i.test(key)) continue;
    for (const entry of entries) {
      const root = String(entry?.f || '');
      if (!root || Array.from(root).length !== 1) continue;
      const code = codeForEntry(key, entry, schemeKey);
      cards.push({
        id: `${schemeKey}:${assetVersion}:${root}:${code.code}`,
        root,
        big: code.big,
        suffix: code.suffix,
        code: code.code,
        schemeKey,
        assetVersion,
      });
    }
  }
  return cards;
}

export function freshProgress(cards = []) {
  const items = {};
  for (const card of cards) items[card.id] = blankItem();
  return items;
}

export function blankItem() {
  return {
    stage: 0,
    totalAttempts: 0,
    totalCorrect: 0,
    firstCorrect: null,
    consecutive: 0,
    lapses: 0,
    avgMs: null,
    reviewIndex: 0,
    dueAt: 0,
    lastSeenAt: 0,
    masteredAt: null,
  };
}

export function normalizeProgress(raw, cards = []) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const result = {};
  for (const card of cards) {
    const item = source[card.id];
    result[card.id] = item && typeof item === 'object' ? { ...blankItem(), ...item } : blankItem();
  }
  return result;
}

export function dueCards(cards, progress, now = Date.now(), range = 'due') {
  const list = cards.filter((card) => {
    const p = progress?.[card.id] || blankItem();
    if (range === 'new') return p.totalAttempts === 0;
    if (range === 'weak') return p.totalAttempts > 0 && (p.stage < 3 || p.lapses > 0);
    if (range === 'all') return true;
    if (range === 'key') return true;
    return p.dueAt <= now;
  });
  return list;
}

export function keyCards(cards, progress, key, now = Date.now()) {
  const normalized = String(key || 'all').toLowerCase();
  return normalized === 'all' ? dueCards(cards, progress, now, 'all') : dueCards(cards, progress, now, 'key').filter((card) => card.big === normalized);
}

export function updateProgress(progress, card, result, now = Date.now()) {
  const next = { ...(progress || {}) };
  const before = { ...blankItem(), ...(next[card.id] || {}) };
  const correct = Boolean(result?.correct) && !result?.revealed;
  const elapsed = Number(result?.elapsedMs);
  const item = { ...before };
  item.totalAttempts += 1;
  item.lastSeenAt = now;
  if (Number.isFinite(elapsed) && elapsed >= 0) {
    item.avgMs = item.avgMs == null ? elapsed : Math.round(item.avgMs * 0.7 + elapsed * 0.3);
  }
  if (correct) {
    item.totalCorrect += 1;
    item.consecutive += 1;
    if (item.firstCorrect == null) item.firstCorrect = now;
    item.stage = Math.min(3, item.stage + 1);
    if (item.stage >= 3 && item.masteredAt == null) item.masteredAt = now;
    if (item.stage >= 3) {
      const index = Math.min(item.reviewIndex, REVIEW_DAYS.length - 1);
      item.dueAt = now + REVIEW_DAYS[index] * DAY;
      item.reviewIndex = Math.min(REVIEW_DAYS.length - 1, item.reviewIndex + 1);
    } else {
      item.dueAt = now;
    }
  } else {
    item.consecutive = 0;
    item.lapses += 1;
    item.stage = Math.max(0, item.stage - 1);
    item.dueAt = now;
  }
  next[card.id] = item;
  return next;
}

// stage 是这次答题前的通过次数：第 1/2/3 次正确分别间隔 2/5/10 题。
export function sessionGapFor(stageOrItem) {
  const stage = typeof stageOrItem === 'number'
    ? stageOrItem
    : Math.max(0, Number(stageOrItem?.stage || 0));
  return SESSION_GAPS[Math.min(stage, SESSION_GAPS.length - 1)];
}

export function summarizeProgress(cards, progress, now = Date.now()) {
  const values = cards.map((c) => progress?.[c.id] || blankItem());
  return {
    total: cards.length,
    newCount: values.filter((p) => p.totalAttempts === 0).length,
    mastered: values.filter((p) => p.stage >= 3).length,
    learning: values.filter((p) => p.totalAttempts > 0 && p.stage < 3).length,
    due: values.filter((p) => p.dueAt <= now).length,
    attempts: values.reduce((n, p) => n + p.totalAttempts, 0),
    correct: values.reduce((n, p) => n + p.totalCorrect, 0),
  };
}
