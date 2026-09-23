// 后端 tsc --noEmit 脚本
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __d = dirname(fileURLToPath(import.meta.url));
const proj = join(__d, 'backend');
process.chdir(proj);
const tsc = join(proj, 'node_modules/typescript/bin/tsc');
console.log('[TSC-BE] cwd=' + process.cwd());
console.log('[TSC-BE] node=' + process.execPath);
console.log('[TSC-BE] tsc=' + tsc);
const cp = spawn(process.execPath, [tsc, '--noEmit'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
let so = '', se = '';
cp.stdout.on('data', d => { const s = d.toString(); process.stdout.write(d); so += s; });
cp.stderr.on('data', d => { const s = d.toString(); process.stderr.write(d); se += s; });
cp.on('error', e => { console.error('[TSC-ERR] ' + e.message); process.exit(98); });
cp.on('close', c => {
  const all = so + se;
  const el = all.split(/\r?\n/).filter(l => /error\s*TS\d|TS\d{4,5}[^0-9]/.test(l)).length;
  console.log('\n[TSC-BE] exit_code=' + c + ' total_error_lines=' + el);
  process.exit(c || 0);
});

