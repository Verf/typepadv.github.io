// typing.js - 跟打核心逻辑（输入法上屏 diff + 判定 + 完成处理）
// 模式：用户开着中文输入法，应用监听输入框 input 事件，
// 以「上屏文字」与原文字符逐字比对；错字标记并推进（方案 B）；退格回改被计入。
// 判定与键盘布局无关。

import { createSession, applyInput, applyBackspace, computeStats, isDone } from './stats.js';

export class TypingController {
  /**
   * @param {object} opts
   *   render: (view) => void  渲染回调
   *   onFinish: (stats) => void  完成回调
   */
  constructor(opts = {}) {
    this.render = opts.render || (() => {});
    this.onFinish = opts.onFinish || (() => {});
    this.session = null;
    this.finished = false;
  }

  start(text) {
    this.session = createSession(text);
    this.finished = false;
    this.render(this.session);
  }

  /** 重置输入跟踪状态（切换文本/重新开始时调用） */
  resetInputTracking() {
    if (this.session) {
      this.session.lastLen = 0;
      this.session.lastValue = '';
    }
  }

  getView() {
    const s = this.session;
    return {
      session: s,
      stats: computeStats(s, Date.now()),
    };
  }

  /** 核心：输入框内容变化时调用 */
  handleInput(inputValue, now = Date.now()) {
    if (!this.session) return;
    const s = this.session;

    let changed = false;
    // 退格回改检测：输入内容长度减少 → 回改
    const prevLen = s.lastLen || 0;
    if (inputValue.length < prevLen) {
      const diff = prevLen - inputValue.length;
      for (let i = 0; i < diff; i++) {
        applyBackspace(s, now);
      }
      this.finished = false; // 回改后回到未完成态
      changed = true;
    } else if (inputValue.length > prevLen) {
      // 新增上屏内容：取新增部分（从 prevLen 开始）
      const added = inputValue.slice(prevLen);
      // applyInput 会与原文从 pos 对比并推进
      this._applyAdded(added, now);
      if (this.finished) this.finished = false; // 有新输入则继续会话
      changed = true;
    }
    // 内容长度不变但内容变化（替换）——按整体重新比对（少见，简化处理）
    else if (prevLen > 0 && inputValue !== s.lastValue) {
      // 替换场景：把整体作为新增处理（重新对齐从 pos 开始）
      this._applyAdded(inputValue.slice(s.pos), now);
      changed = true;
    }

    // 首次有效输入即计时开始
    if (changed && !s.startTime) s.startTime = now;

    s.lastLen = inputValue.length;
    s.lastValue = inputValue;
    if (changed) this.render(this.session);

    // 完成检测
    if (changed && !this.finished && isDone(s)) {
      s.endTime = now;
      this.finished = true;
      this.onFinish(computeStats(s, now));
    }
  }

  /** 处理新增上屏片段：与原文从 pos 逐个比对 */
  _applyAdded(added, now) {
    const s = this.session;
    if (!added) return;
    const addedChars = Array.from(added);
    const appended = [];
    for (let i = 0; i < addedChars.length; i++) {
      const target = s.text[s.pos];
      const typed = addedChars[i];
      s.keystrokes++;
      if (target === undefined) {
        // 超出原文：多余输入计错，不推进（避免越界）
        s.errors++;
        appended.push({ typed, correct: false });
        continue;
      }
      if (typed === target) {
        s.charStates[s.pos] = 'correct';
        appended.push({ typed, correct: true });
        s.pos++;
      } else {
        s.charStates[s.pos] = 'error';
        s.errors++;
        appended.push({ typed, correct: false });
        s.pos++; // 方案 B：错字也前进
      }
    }
    return appended;
  }

  /** 立即完成（中止） */
  finishEarly(now = Date.now()) {
    if (!this.session || this.finished) return null;
    this.session.endTime = now;
    this.finished = true;
    return computeStats(this.session, now);
  }
}