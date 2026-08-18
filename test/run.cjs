// test/run.js - 测试运行器：启静态服务器 → 跑所有测试 → 清理
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 4173;
let server = null;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('node', ['serve.cjs'], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'pipe',
    });
    // 等待端口就绪
    let tries = 0;
    const check = () => {
      try {
        execSync(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${PORT}/index.html`);
        resolve();
      } catch {
        if (++tries > 30) reject(new Error('服务器启动超时'));
        else setTimeout(check, 200);
      }
    };
    check();
    server.stderr.on('data', (d) => process.stderr.write(d));
  });
}

async function main() {
  await startServer();
  console.log('✅ 服务器已启动 http://localhost:' + PORT);
  const tests = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.cjs'));
  let failed = 0;
  for (const t of tests) {
    console.log(`\n=== 运行 ${t} ===`);
    try {
      execSync(`node ${path.join(__dirname, t)}`, { stdio: 'inherit', timeout: 90000 });
      console.log(`✅ ${t} 通过`);
    } catch (e) {
      failed++;
      console.error(`❌ ${t} 失败: ${e.message}`);
    }
  }
  if (server) { server.kill(); }
  if (failed > 0) {
    console.error(`\n${failed} 个测试失败`);
    process.exit(1);
  }
  console.log('\n🎉 全部测试通过');
}

main().catch((e) => {
  console.error('运行器错误:', e.message);
  if (server) server.kill();
  process.exit(1);
});