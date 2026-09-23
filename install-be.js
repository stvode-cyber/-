// 后端 npm install 脚本
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __d = dirname(fileURLToPath(import.meta.url));
process.chdir(join(__d, 'backend'));
const nodeDir = dirname(process.execPath);
const sep = process.platform === 'win32' ? ';' : ':';
process.env.PATH = nodeDir + sep + (process.env.PATH || '');
console.log('[INSTALL-BE] cwd=' + process.cwd());
console.log('[INSTALL-BE] nodeDir added to PATH: ' + nodeDir);
const cp = spawn('npm.cmd', ['install', '--no-audit', '--no-fund', '--loglevel=info'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, shell: true });
cp.stdout.on('data', d => process.stdout.write(d));
cp.stderr.on('data', d => process.stderr.write(d));
cp.on('error', e => { console.error('[ERROR] ' + e.message); process.exit(99); });
cp.on('close', c => { console.log('\n[INSTALL-BE] exit_code=' + c); process.exit(c || 0); });

