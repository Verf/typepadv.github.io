// deploy.mjs - 统一发布脚本：注入版本号 → git add/commit → pull --rebase → push
// 用法: node deploy.mjs "提交信息"
// 保证每次发布资源版本号自动更新，规避 GitHub Pages 的 max-age=600 缓存问题。
import { execSync } from 'child_process';

const msg = process.argv[2];
if (!msg) {
  console.error('用法: node deploy.mjs "commit message"');
  process.exit(1);
}

function run(cmd) {
  console.log('>', cmd);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  // 1. 注入版本号（基于 git 提交数+短hash，每次变化 => 缓存失效）
  run('node build-version.mjs');

  // 2. 提交（含 version 更新与业务改动）
  run('git add -A');
  run(`git commit -m "${msg.replace(/"/g, '\\"')}"`);

  // 3. 同步远端
  run('git pull --rebase origin main');
  run('git push origin main');

  console.log('\n✅ 发布完成（版本号已自动更新）');
} catch (e) {
  console.error('\n❌ 发布失败:', e.message);
  process.exit(1);
}