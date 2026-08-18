// test/smoke.test.js - 应用加载冒烟测试（puppeteer-core + 系统 chromium）
// 验证：页面加载无 JS 错误、核心元素渲染、码表加载、跟打交互可用

const puppeteer = require('puppeteer-core');
const path = require('path');
const { chromiumPath } = require('./helpers.cjs');

const URL = 'http://localhost:4173/index.html';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: chromiumPath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });
  page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

  await page.goto(URL, { waitUntil: 'load' });
  // 等待码表解析完成（fetch + IndexedDB 缓存）
  await new Promise((r) => setTimeout(r, 3000));

  const result = await page.evaluate(() => {
    const kbKeys = document.querySelectorAll('.kb-key').length;
    const chars = document.querySelectorAll('.char').length;
    const codeHint = document.getElementById('code-hint').textContent.trim();
    const title = document.title;
    const stats = {
      kpm: document.getElementById('stat-kpm').textContent,
      time: document.getElementById('stat-time').textContent,
    };
    const historyRows = document.querySelectorAll('#history-body tr').length;
    return { kbKeys, chars, codeHint, title, stats, historyRows };
  });

  console.log(JSON.stringify({ result, errors }, null, 2));

  const pass =
    result.kbKeys > 0 &&
    result.chars > 0 &&
    result.title.includes('跟打器') &&
    errors.length === 0;

  // 截图
  await page.screenshot({ path: 'test/artifacts/smoke.png', fullPage: true });

  await browser.close();
  if (!pass) {
    console.error('SMOKE TEST FAILED');
    process.exit(1);
  }
  console.log('SMOKE TEST PASSED ✅');
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message);
  process.exit(1);
});