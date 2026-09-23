// 部署步骤4：配置PM2开机自启 + 验证整体访问
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '8.154.45.247';
const USER = 'root';
const PRIVATE_KEY = fs.readFileSync(path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519'), 'utf8');
const REMOTE_DIR = '/root/APP-AIE';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

function sshExec(conn, cmd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    log(`> ${cmd.substring(0, 120)}${cmd.length > 120 ? '...' : ''}`);
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', (d) => { stdout += d.toString(); process.stdout.write(d); });
      stream.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write(d); });
      const timer = setTimeout(() => reject(new Error(`命令超时 (${timeout}ms)`)), timeout);
      stream.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`exit ${code}: ${stderr || stdout}`));
      });
    });
  });
}

async function main() {
  const conn = await new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => { log('✅ SSH 已连接'); resolve(c); });
    c.on('error', reject);
    c.connect({ host: HOST, port: 22, username: USER, privateKey: PRIVATE_KEY, readyTimeout: 30000 });
  });

  try {
    log('=== [1/4] 配置 PM2 开机自启 ===');
    // PM2 7.x 新语法：pm2 startup [systemd]（不要 -y）
    await sshExec(conn, `pm2 startup systemd 2>&1 | tail -5`);
    // 手动执行其提示的命令
    await sshExec(conn, `command -v systemctl && systemctl enable pm2-root 2>&1 || echo "可能需要手动配置"`);

    log('=== [2/4] 检查后端健康 ===');
    await sshExec(conn, `sleep 3 && curl -s http://127.0.0.1:3001/health`);
    await sshExec(conn, `pm2 list`);

    log('=== [3/4] 检查 Nginx + 前端 ===');
    await sshExec(conn, `curl -s -o /dev/null -w "前端 HTTP %{http_code}\\n" http://127.0.0.1/`);
    await sshExec(conn, `curl -s -o /dev/null -w "API 代理 HTTP %{http_code}\\n" http://127.0.0.1/api/v1/auth/me`);

    log('=== [4/4] 端口监听状态 ===');
    await sshExec(conn, `ss -tlnp | grep -E ":80|:3001"`);

    log('✅ 部署验证完成');
    conn.end();
    process.exit(0);
  } catch (e) {
    console.error('❌ 失败:', e.message);
    conn.end();
    process.exit(1);
  }
}

main();
