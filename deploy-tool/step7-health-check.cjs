// 服务器综合健康检查
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '8.154.45.247';
const USER = 'root';
const PRIVATE_KEY = fs.readFileSync(path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519'), 'utf8');

function sshExec(conn, cmd, timeout = 30000) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', d => out += d.toString());
      stream.stderr.on('data', d => out += d.toString());
      const t = setTimeout(() => reject(new Error('timeout')), timeout);
      stream.on('exit', code => { clearTimeout(t); resolve({ code, out }); });
    });
  });
}

async function main() {
  const conn = await new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', reject);
    c.connect({ host: HOST, port: 22, username: USER, privateKey: PRIVATE_KEY, readyTimeout: 30000 });
  });

  console.log('========================================');
  console.log('  服务器综合健康检查');
  console.log('========================================\n');

  // 1. 系统资源
  console.log('【1】系统资源');
  const r1 = await sshExec(conn, 'echo "CPU负载:"; uptime; echo "内存:"; free -h | head -2; echo "磁盘:"; df -h / | tail -1');
  console.log(r1.out);

  // 2. PM2 进程
  console.log('【2】PM2 进程');
  const r2 = await sshExec(conn, 'pm2 list');
  console.log(r2.out);

  // 3. Nginx 状态
  console.log('【3】Nginx 状态');
  const r3 = await sshExec(conn, 'systemctl is-active nginx; nginx -v 2>&1');
  console.log(r3.out);

  // 4. 后端健康
  console.log('【4】后端健康检查');
  const r4 = await sshExec(conn, 'curl -s http://127.0.0.1:3001/health');
  console.log(r4.out);

  // 5. 前端访问
  console.log('【5】前端访问');
  const r5 = await sshExec(conn, 'curl -s -o /dev/null -w "HTTP %{http_code} - %{size_download} bytes\\n" http://127.0.0.1/');
  console.log(r5.out);

  // 6. 数据库
  console.log('【6】数据库');
  const r6 = await sshExec(conn, 'ls -lh /root/APP-AIE/backend/prisma/*.db 2>&1; echo "---表数---"; sqlite3 /root/APP-AIE/backend/prisma/prod.db "SELECT count(*) FROM sqlite_master WHERE type=\'table\'" 2>&1');
  console.log(r6.out);

  // 7. 用户数与关键数据
  console.log('【7】关键数据统计');
  const r7 = await sshExec(conn, `sqlite3 /root/APP-AIE/backend/prisma/prod.db "SELECT 'users' as t, count(*) FROM User UNION ALL SELECT 'tasks', count(*) FROM Task UNION ALL SELECT 'bills', count(*) FROM Bill UNION ALL SELECT 'messages', count(*) FROM Message UNION ALL SELECT 'reminders', count(*) FROM Reminder UNION ALL SELECT 'posts', count(*) FROM Post UNION ALL SELECT 'voice_memos', count(*) FROM VoiceMemo UNION ALL SELECT 'audits', count(*) FROM AuditLog" 2>&1`);
  console.log(r7.out);

  // 8. 后端日志最近错误
  console.log('【8】后端日志最近错误');
  const r8 = await sshExec(conn, 'tail -50 /root/APP-AIE/backend/logs/error.log 2>&1 | tail -20');
  console.log(r8.out || '(无错误日志)');

  // 9. PWA 资源
  console.log('【9】PWA 资源');
  const r9 = await sshExec(conn, 'ls -la /var/www/aie-frontend/sw.js /var/www/aie-frontend/manifest.webmanifest /var/www/aie-frontend/pwa-192x192.png /var/www/aie-frontend/pwa-512x512.png 2>&1');
  console.log(r9.out);

  // 10. 端口监听
  console.log('【10】端口监听');
  const r10 = await sshExec(conn, 'ss -tlnp | grep -E ":(80|3001) "');
  console.log(r10.out);

  conn.end();
  console.log('\n========================================');
  console.log('  检查完成');
  console.log('========================================');
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
