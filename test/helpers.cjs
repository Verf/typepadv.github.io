// test/helpers.js - 测试工具函数

const fs = require('fs');
const os = require('os');
const path = require('path');

/** 定位系统 chromium 可执行文件 */
function chromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('未找到 chromium，请设置 CHROMIUM_PATH');
}

/** 启动 headless 浏览器（统一封装） */
async function launchBrowser() {
  const puppeteer = require('puppeteer-core');
  return puppeteer.launch({
    executablePath: chromiumPath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
}

/** 收集页面错误 */
function collectErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });
  page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));
  return errors;
}

/** 打开应用并返回 page + errors（通过本地静态服务器） */
async function openApp(page, waitMs = 3000) {
  const URL = 'http://localhost:4173/index.html';
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(waitMs);
  return { errors: collectErrors(page) };
}

/** 原生睡眠（puppeteer-core 无 waitForTimeout） */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { chromiumPath, launchBrowser, collectErrors };