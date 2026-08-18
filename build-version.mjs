// build-version.mjs - 自动为 index.html 静态资源注入版本号（防缓存）
// 用法: node build-version.mjs
// 原理: 基于 git 提交数 + 时间戳生成版本号，重写 index.html 中
//       src/href 的 ?v= 参数。版本号每次变化 => 浏览器强制拉新资源。
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const INDEX = 'index.html';

function gitVersion() {
  try {
    // 提交数作为基础版本
    const count = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim();
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    return `${count}-${hash}`;
  } catch {
    return String(Date.now());
  }
}

const version = gitVersion();
const html = readFileSync(INDEX, 'utf8');

// 匹配 src="..." 或 href="..."（本地资源，含 assets/ 或 favicon），追加/更新 ?v=
const updated = html.replace(
  /(src|href)="(assets\/[^"?]+|favicon\.svg)(?:\?v=[^"]*)?"/g,
  (m, attr, path) => `${attr}="${path}?v=${version}"`
);

if (updated === html) {
  console.log('未发现需要版本化的资源引用，跳过');
  process.exit(0);
}

writeFileSync(INDEX, updated, 'utf8');
console.log(`✅ 已注入版本号 v=${version}`);
// 打印所有带版本的引用供确认
const refs = [...updated.matchAll(/(?:src|href)="(assets\/[^"]+?)\?v=([^"]+)"/g)].map((m) => `${m[1]} ?v=${m[2]}`);
console.log(refs.join('\n'));