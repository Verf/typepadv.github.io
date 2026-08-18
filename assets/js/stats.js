// stats.js - 跟打统计（纯逻辑，可单测）
// 统计口径（中文社群标准）：
//   KPM      = 总击键数 / 用时(分钟)
//   键准     = 无回改字符 / 总字符（未回改的正确率）
//   回改次数 = 用户按退格回改的次数
//   错字率   = 错字符 / 总字符
//   用时     = 首次击键到完成（秒）
//   正确率   = 正确字符 / 总字符（完成时的最终正确率）

/**
 * 创建跟打会话状态机（核心纯逻辑）。
 * state:
 *   text      原文数组（字符）
 *   pos       当前游标位置（下一个待打字符索引）
 *   charStates 每个字符的状态：'pending' | 'correct' | 'error' | 'backspaced'
 *   keystrokes 总击键数（含回改与无效键）
 *   backspaces 回改次数
 *   errors     错字符计数（标记为 error 的位数）
 *   startTime  首次击键时间戳
 *   endTime    完成时间戳
 */
export function createSession(text) {
  const chars = Array.from(text); // 按 Unicode 码点切分，避免代理对问题
  return {
    text: chars,
    pos: 0,
    charStates: chars.map(() => 'pending'),
    keystrokes: 0,
    backspaces: 0,
    errors: 0,
    startTime: null,
    endTime: null,
    lastInput: null, // 最近一次上屏内容（供 diff）
  };
}

/**
 * 处理一次「上屏文本」更新（输入法整段输出或逐字）。
 * 策略：与原文从 pos 处开始比较，逐字推进；错字标记 error 并继续推进（方案 B）。
 * 无法对齐时（剪切/粘贴）按整段增量处理。
 * @param {Session} s
 * @param {string} newText 输入框当前全部内容（或新增上屏内容）
 * @param {number} now 时间戳
 */
export function applyInput(s, newText, now) {
  if (!s.startTime) s.startTime = now;
  const newChars = Array.from(newText);
  const oldLength = s.pos + (s.bufferLength || 0);
  // 简化：把 newText 视为从 pos 开始的连续输入
  let matched = 0;
  let i = 0;
  // 输入法上屏内容与原文从 pos 比较
  const pendingText = newChars;
  // 记录本次「新增字符数」（相对上次已知进度）
  const prevKnown = s.pos;

  // 逐字比对
  for (; i < pendingText.length; i++) {
    const target = s.text[prevKnown + i];
    const typed = pendingText[i];
    if (target === undefined) {
      // 超出原文长度：多余输入 = 错误
      s.errors++;
      s.keystrokes++;
      continue;
    }
    s.keystrokes++;
    if (typed === target) {
      s.charStates[prevKnown + i] = 'correct';
      if (s.pos === prevKnown + i) s.pos = prevKnown + i + 1;
    } else {
      s.charStates[prevKnown + i] = 'error';
      s.errors++;
      if (s.pos <= prevKnown + i) s.pos = prevKnown + i + 1; // 方案 B：错字也前进
    }
  }

  // 若输入为空（清空）不推进
  if (pendingText.length === 0 && newText === '') {
    // 用户退格删空：回改
  }
}

/**
 * 处理退格/删除（回改）。
 * @param {Session} s
 * @param {number} now
 */
export function applyBackspace(s, now) {
  if (!s.startTime) s.startTime = now;
  if (s.pos <= 0) return;
  s.pos--;
  s.backspaces++;
  s.keystrokes++;
  const st = s.charStates[s.pos];
  // 回改的字符标记为 backspaced（已回改）
  if (st === 'error') s.errors = Math.max(0, s.errors - 1);
  s.charStates[s.pos] = 'backspaced';
}

/**
 * 计算当前统计快照。
 */
export function computeStats(s, now) {
  const elapsedMs = (s.endTime || now) - (s.startTime || now);
  const elapsedSec = Math.max(elapsedMs / 1000, 0);
  const minutes = Math.max(elapsedSec / 60, 1e-9);
  const totalChars = s.text.length;

  // 字符最终态统计
  let correctCount = 0;
  let backspacedCount = 0;
  let errorRemainCount = 0; // 留在文中的未回改错字
  for (const st of s.charStates) {
    if (st === 'correct') correctCount++;
    else if (st === 'error') errorRemainCount++;
    else if (st === 'backspaced') backspacedCount++;
  }
  const typedCount = Math.min(s.pos, totalChars);
  const kpm = Math.round((s.keystrokes / minutes) * 10) / 10;
  // 净速（字数/分钟）：打完全部的字符数 / 分钟
  const netKpm = Math.round((typedCount / minutes) * 10) / 10;
  // 键准（中文社群标准）：回改过的错字不算错，(总字符 - 未回改错误数) / 总字符
  const accuracy = totalChars > 0 ? Math.round(((totalChars - errorRemainCount) / totalChars) * 1000) / 10 : 100;
  // 错字率（首次上屏错误率）：(回改次数 + 未回改错误数) / 总字符
  const errorRate = totalChars > 0 ? Math.round(((s.backspaces + errorRemainCount) / totalChars) * 1000) / 10 : 0;
  const progress = totalChars > 0 ? Math.round((typedCount / totalChars) * 1000) / 10 : 0;
  const done = typedCount >= totalChars;

  return {
    kpm,
    netKpm,
    accuracy,
    errorRate,
    backspaces: s.backspaces,
    elapsedSec: Math.round(elapsedSec * 10) / 10,
    correctCount,
    errorCount: errorRemainCount,
    errorRemainCount,
    backspacedCount,
    typedCount,
    totalChars,
    progress,
    done,
    keystrokes: s.keystrokes,
  };
}

/**
 * 判断会话是否完成：游标到达文本末尾（input 完所有字符）即视为完成。
 * 方案 B：错字也推进，所以末字即使打错也算完成；用户可退格回改（pos 回到
 * 末尾前则回到未完成状态，可继续处理回改内容）。
 */
export function isDone(s) {
  return s.pos >= s.text.length;
}