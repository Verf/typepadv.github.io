const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

execFileSync(process.execPath, [join(__dirname, 'sync-gallming-formal.test.mjs')], { stdio: 'inherit' });
